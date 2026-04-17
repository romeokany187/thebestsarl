import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { getTicketCommissionAmount, getTicketTotalAmount } from "@/lib/ticket-pricing";

type SearchParams = {
  startDate?: string;
  endDate?: string;
};

type ReportKind = "DAILY" | "WEEKLY" | "MONTHLY" | "ANNUAL" | "CUSTOM";

type ExecutiveAnalysis = {
  title: string;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  advances: string[];
  regressions: string[];
  recommendations: string[];
};

function parseSearchParams(url: URL): SearchParams {
  return {
    startDate: url.searchParams.get("startDate") ?? undefined,
    endDate: url.searchParams.get("endDate") ?? undefined,
  };
}

function fmtNumber(value: number) {
  return value.toFixed(2);
}

function formatFrenchDate(value: Date) {
  return value.toLocaleDateString("fr-FR", { timeZone: "UTC" });
}

function formatFrenchMonthYear(start: Date) {
  return start.toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).toUpperCase();
}

function buildReportTitle(kind: ReportKind, start: Date, endExclusive: Date) {
  const endInclusive = new Date(endExclusive.getTime() - 1);
  if (kind === "DAILY") return `RAPPORT VENTE BILLETS ${formatFrenchDate(start)}`;
  if (kind === "WEEKLY") return `RAPPORT DE LA SEMAINE DU ${formatFrenchDate(start)} AU ${formatFrenchDate(endInclusive)}`;
  if (kind === "MONTHLY") return `RAPPORT MENSUEL DE VENTE DES BILLETS ${formatFrenchMonthYear(start)}`;
  if (kind === "ANNUAL") return `RAPPORT ANNUEL DE VENTE DES BILLETS ${start.getUTCFullYear()}`;
  return `RAPPORT DE VENTE DES BILLETS ${formatFrenchDate(start)} AU ${formatFrenchDate(endInclusive)}`;
}

function buildTableFirstColumnHeader(kind: ReportKind) {
  if (kind === "WEEKLY") return "DATE";
  if (kind === "MONTHLY") return "SEMAINES";
  if (kind === "ANNUAL") return "PERIODES";
  return "DATE / PERIODE";
}

function drawFooter(page: PDFPage, fontRegular: PDFFont, reportTitle: string, generatedBy: string) {
  const { width } = page.getSize();
  const textBlack = rgb(0, 0, 0);
  page.drawText(`Imprimé par: ${generatedBy}`, {
    x: 26,
    y: 24,
    size: 9,
    font: fontRegular,
    color: textBlack,
  });

  const rightTextWidth = fontRegular.widthOfTextAtSize(reportTitle, 9);
  page.drawText(reportTitle, {
    x: width - rightTextWidth - 26,
    y: 24,
    size: 9,
    font: fontRegular,
    color: textBlack,
  });
}

function drawTopInfo(
  page: PDFPage,
  fontBold: PDFFont,
  fontRegular: PDFFont,
  subtitle: string,
  logoImage: PDFImage | null,
) {
  const textBlack = rgb(0, 0, 0);
  if (logoImage) {
    const scaled = logoImage.scale(0.14);
    page.drawImage(logoImage, {
      x: 26,
      y: 534,
      width: scaled.width,
      height: scaled.height,
    });
  }

  const titleX = logoImage ? 106 : 26;

  page.drawText("THE BEST SARL", {
    x: titleX,
    y: 560,
    size: 14,
    font: fontBold,
    color: textBlack,
  });

  page.drawText("RAPPORT DE VENTES BILLETS", {
    x: titleX,
    y: 545,
    size: 9,
    font: fontBold,
    color: textBlack,
  });

  page.drawText(subtitle, {
    x: titleX,
    y: 532,
    size: 8.5,
    font: fontRegular,
    color: textBlack,
  });

  page.drawLine({
    start: { x: 26, y: 522 },
    end: { x: 816, y: 522 },
    thickness: 0.8,
    color: rgb(0.75, 0.75, 0.75),
  });
}

function normalizeStatus(status: string) {
  if (status === "PAID") return "PAYE";
  if (status === "PARTIAL") return "PARTIEL";
  return "NON PAYE";
}

function dateRangeFromParams(params: SearchParams) {
  const now = new Date();
  const defaultDay = now.toISOString().slice(0, 10);

  const startRaw = params.startDate ?? defaultDay;
  const endRaw = params.endDate ?? startRaw;
  const start = new Date(`${startRaw}T00:00:00.000Z`);
  const end = new Date(`${endRaw}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);

  return {
    start,
    end,
    startRaw,
    endRaw,
  };
}

function inferReportKind(start: Date, endExclusive: Date): ReportKind {
  const ms = endExclusive.getTime() - start.getTime();
  const days = Math.max(1, Math.round(ms / (24 * 60 * 60 * 1000)));
  if (days === 1) return "DAILY";
  if (days <= 7) return "WEEKLY";
  if (days >= 365 && days <= 366) return "ANNUAL";
  if (days <= 31) return "MONTHLY";
  return "CUSTOM";
}

function weekLabel(start: Date, endExclusive: Date) {
  const end = new Date(endExclusive.getTime() - 1);
  return `SEMAINE DU ${formatFrenchDate(start)} AU ${formatFrenchDate(end)}`;
}

function getWeekStart(baseStart: Date, date: Date) {
  const diffMs = date.getTime() - baseStart.getTime();
  const diffDays = Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
  const block = Math.floor(diffDays / 7);
  const start = new Date(baseStart);
  start.setUTCDate(baseStart.getUTCDate() + block * 7);
  return start;
}

function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 0, 0, 0, 0));
}

function buildDailyTimeline(start: Date, endExclusive: Date) {
  const days: string[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), 0, 0, 0, 0));
  const end = new Date(Date.UTC(
    endExclusive.getUTCFullYear(),
    endExclusive.getUTCMonth(),
    endExclusive.getUTCDate(),
    0,
    0,
    0,
    0,
  ));

  while (cursor < end) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return days;
}

function sparklinePoints(values: number[], width: number, height: number) {
  if (values.length === 0) return [] as Array<{ x: number; y: number }>;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 1);

  return values.map((value, index) => {
    const x = values.length === 1 ? 0 : (index / (values.length - 1)) * width;
    const y = ((value - min) / range) * height;
    return { x, y };
  });
}

function pct(current: number, previous: number) {
  if (previous > 0) return ((current - previous) / previous) * 100;
  return current > 0 ? 100 : 0;
}

function signed(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function clampList(items: string[], fallback: string) {
  const cleaned = items
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 5);
  return cleaned.length > 0 ? cleaned : [fallback];
}

function extractJsonObject(raw: string) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return trimmed.slice(first, last + 1);
  }

  return null;
}

function buildFallbackExecutiveAnalysis(input: {
  reportKind: ReportKind;
  startRaw: string;
  endRaw: string;
  totalCount: number;
  totalAmount: number;
  totalCommission: number;
  paymentPaid: number;
  paymentPartial: number;
  paymentUnpaid: number;
  previousCount: number;
  previousAmount: number;
  previousCommission: number;
  topAirlines: Array<{ code: string; amount: number; count: number }>;
  topAgencies: Array<{ name: string; amount: number; count: number }>;
}): ExecutiveAnalysis {
  const ticketsTrend = pct(input.totalCount, input.previousCount);
  const amountTrend = pct(input.totalAmount, input.previousAmount);
  const commissionTrend = pct(input.totalCommission, input.previousCommission);
  const unpaidRisk = input.totalCount > 0 ? ((input.paymentUnpaid + input.paymentPartial) / input.totalCount) * 100 : 0;
  const topAirline = input.topAirlines[0];
  const topAgency = input.topAgencies[0];

  return {
    title: `Analyse ${input.reportKind} • ${input.startRaw} → ${input.endRaw}`,
    summary: [
      `Sur la période, ${input.totalCount} billets ont été vendus pour ${input.totalAmount.toFixed(2)} USD, avec ${input.totalCommission.toFixed(2)} USD de commissions.`,
      `Par rapport à la période précédente équivalente, l'évolution est de ${signed(amountTrend)} sur le chiffre d'affaires et ${signed(commissionTrend)} sur les commissions.`,
      `Le niveau de risque d'encaissement (partiel + impayé) est estimé à ${unpaidRisk.toFixed(1)}% des billets de la période.`,
    ].join(" "),
    strengths: clampList([
      topAirline ? `La compagnie ${topAirline.code} tire le portefeuille avec ${topAirline.amount.toFixed(2)} USD (${topAirline.count} billets).` : "Le volume de ventes reste stable sur la période.",
      topAgency ? `L'agence/équipe ${topAgency.name} contribue majoritairement avec ${topAgency.amount.toFixed(2)} USD.` : "La contribution des agences reste équilibrée.",
      amountTrend >= 0 ? `Le chiffre d'affaires progresse de ${signed(amountTrend)} sur période comparable.` : "La base de revenus reste significative malgré un contexte plus contraint.",
    ], "Performance commerciale globalement solide sur la période."),
    weaknesses: clampList([
      unpaidRisk >= 25 ? `Le taux partiel/impayé est élevé (${unpaidRisk.toFixed(1)}%), ce qui pèse sur la trésorerie.` : "La qualité d'encaissement doit rester sous surveillance.",
      commissionTrend < 0 ? `La commission recule de ${signed(commissionTrend)}, signalant une pression sur la marge.` : "La marge commissionnelle reste sensible à la structure des ventes.",
      input.topAirlines.length <= 1 ? "La concentration sur un nombre limité de compagnies augmente le risque de dépendance." : "La concentration des ventes doit être pilotée pour limiter le risque de dépendance.",
    ], "Quelques fragilités opérationnelles exigent un suivi rapproché."),
    advances: clampList([
      ticketsTrend > 0 ? `Le volume billets progresse de ${signed(ticketsTrend)} par rapport à la période de référence.` : "Le volume billets se maintient sans rupture.",
      amountTrend > 0 ? `L'activité commerciale est en progression nette (${signed(amountTrend)}).` : "Les acquis commerciaux sont globalement conservés.",
      input.paymentPaid > 0 ? `${input.paymentPaid} billets totalement payés soutiennent la stabilité des encaissements.` : "La discipline d'encaissement progresse progressivement.",
    ], "Des avancées sont visibles dans l'exécution commerciale."),
    regressions: clampList([
      ticketsTrend < 0 ? `Le volume billets recule de ${signed(ticketsTrend)} sur période comparable.` : "Pas de régression majeure sur le volume.",
      amountTrend < 0 ? `Le chiffre d'affaires recule de ${signed(amountTrend)}.` : "Pas de régression majeure sur le chiffre d'affaires.",
      input.paymentUnpaid > 0 ? `${input.paymentUnpaid} billets restent non payés à date et fragilisent le cycle cash.` : "Le niveau d'impayé reste contenu.",
    ], "Les signaux de recul restent contenus mais doivent être pilotés."),
    recommendations: clampList([
      "Renforcer le suivi quotidien des créances (partiel/impayé) avec relances structurées et échéancier documenté.",
      "Fixer des objectifs de diversification commerciale par compagnie et par agence pour réduire la concentration du risque.",
      "Institutionnaliser un comité de performance hebdomadaire (ventes, marge, encaissement) avec plan d'actions daté.",
      "Standardiser ce rapport pour diffusion aux associés et autorités avec indicateurs de tendance et mesures correctives.",
    ], "Mettre en place un pilotage plus resserré des revenus et de l'encaissement."),
  };
}

async function generateExecutiveAnalysis(input: {
  reportKind: ReportKind;
  startRaw: string;
  endRaw: string;
  totalCount: number;
  totalAmount: number;
  totalCommission: number;
  paymentPaid: number;
  paymentPartial: number;
  paymentUnpaid: number;
  previousCount: number;
  previousAmount: number;
  previousCommission: number;
  byAirline: Array<{ code: string; amount: number; count: number; commission: number }>;
  byAgency: Array<{ name: string; amount: number; count: number }>;
}) {
  const topAirlines = input.byAirline.slice(0, 6).map((item) => ({
    code: item.code,
    amount: Number(item.amount.toFixed(2)),
    count: item.count,
    commission: Number(item.commission.toFixed(2)),
  }));
  const topAgencies = input.byAgency.slice(0, 6).map((item) => ({
    name: item.name,
    amount: Number(item.amount.toFixed(2)),
    count: item.count,
  }));

  const fallback = buildFallbackExecutiveAnalysis({
    reportKind: input.reportKind,
    startRaw: input.startRaw,
    endRaw: input.endRaw,
    totalCount: input.totalCount,
    totalAmount: input.totalAmount,
    totalCommission: input.totalCommission,
    paymentPaid: input.paymentPaid,
    paymentPartial: input.paymentPartial,
    paymentUnpaid: input.paymentUnpaid,
    previousCount: input.previousCount,
    previousAmount: input.previousAmount,
    previousCommission: input.previousCommission,
    topAirlines,
    topAgencies,
  });

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return fallback;
  }

  const model = process.env.SALES_REPORT_AI_MODEL?.trim() || "gpt-4o-mini";
  const payload = {
    reportKind: input.reportKind,
    period: { from: input.startRaw, to: input.endRaw },
    totals: {
      tickets: input.totalCount,
      amountUSD: Number(input.totalAmount.toFixed(2)),
      commissionUSD: Number(input.totalCommission.toFixed(2)),
      paymentStatus: {
        paid: input.paymentPaid,
        partial: input.paymentPartial,
        unpaid: input.paymentUnpaid,
      },
    },
    comparisonPreviousEquivalentPeriod: {
      tickets: input.previousCount,
      amountUSD: Number(input.previousAmount.toFixed(2)),
      commissionUSD: Number(input.previousCommission.toFixed(2)),
      growth: {
        ticketsPct: Number(pct(input.totalCount, input.previousCount).toFixed(1)),
        amountPct: Number(pct(input.totalAmount, input.previousAmount).toFixed(1)),
        commissionPct: Number(pct(input.totalCommission, input.previousCommission).toFixed(1)),
      },
    },
    topAirlines,
    topAgencies,
  };

  const systemPrompt = [
    "Tu es directeur de la stratégie et analyste financier senior d'une agence de voyages aériens de référence en Afrique centrale.",
    "Tu rédiges des analyses executives EXTRÊMEMENT DOCUMENTÉES, factuelless, rigoureuses et présentables à un conseil d'administration, aux associés et aux autorités régulatrices.",
    "CHAQUE puce/phrase DOIT CITER EXPLICITEMENT les chiffres et données issues du payload. Pas de généralités. Pas de suppositions.",
    "Structure chaque puce comme: [ASSERTION OBSERVÉE] (chiffre 1: X, chiffre 2: Y) → [INTERPRÉTATION CAUSALE] avec données à l'appui.",
    "Exemple BON: 'Les commissions ont reculé de -20.3% (2604.50 USD vs 3735.40 USD période référence), attestant une érosion de la marge directement liée à la baisse du volume compagnies premium (-15 billets CAA).'",
    "Exemple MAUVAIS: 'La marge commissionnelle a diminué. Il faut surveiller.'",
    "Chaque section doit avoir 4 à 6 puces, CHACUNE SOLIDEMENT ARGUMENTÉE AVEC DONNÉES NUMÉRIQUES DIRECTES.",
    "N'invente aucun chiffre. N'ajoute aucune interprétation au-delà des données fournies. Réponds STRICTEMENT en JSON valide sans texte additionnel.",
  ].join(" ");

  const userPrompt = [
    "Produis une analyse exécutive EXTRÊMEMENT DOCUMENTÉE en français avec ce schéma JSON EXACT:",
    "{",
    '  "title": "string (titre court du rapport avec période)",',
    '  "summary": "string (MINIMUM 6 phrases denses: contexte opérationnel, chiffres clés période CITES, comparaison vs période précédente CHIFFRÉE, taux encaissement, impact commissions CAA/autres, conclusion direction)",',
    '  "strengths": ["string (4-6 puces: CHACUNE CITE les données du payload - chiffres précis, compagnies nommées, % de croissance, impact absolu)"],',
    '  "weaknesses": ["string (4-6 puces: CHACUNE CITE données concrètes - montants, taux %, causes observées, impact estimé)"],',
    '  "advances": ["string (4-6 puces: DONNÉES CHIFFRÉES de progression - billets +X, montant +Y USD, justification par données factuelles)"],',
    '  "regressions": ["string (4-6 puces: DONNÉES CHIFFRÉES de recul - montants absolus, %, causes détectables dans données, impact business)"],',
    '  "recommendations": ["string (4-6 actions CONCRÈTES: action précise, responsable ou département, délai (jours/semaines), KPI mesurable lié aux données)"]',
    "}",
    "",
    "CONTRAINTE STRICTE: CHAQUE puce = [OBSERVABLE FACTUEL cité du payload] + [IMPACT QUANTIFIÉ] + [CAUSE ou INTERPRÉTATION fondée sur données].",
    "Pas de généralité vague type 'surveiller', 'améliorer', 'augmenter'. Chaque affirmation doit être supportée par un chiffre du payload.",
    "Données de la période analysée:",
    JSON.stringify(payload),
  ].join("\n");

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      return fallback;
    }

    const completion = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = completion.choices?.[0]?.message?.content?.trim() ?? "";
    const jsonPayload = extractJsonObject(content);
    if (!jsonPayload) {
      return fallback;
    }

    const parsed = JSON.parse(jsonPayload) as Partial<ExecutiveAnalysis>;
    if (!parsed.summary || !Array.isArray(parsed.strengths)) {
      return fallback;
    }

    return {
      title: parsed.title?.trim() || fallback.title,
      summary: parsed.summary.trim(),
      strengths: clampList(parsed.strengths ?? [], fallback.strengths[0]),
      weaknesses: clampList(parsed.weaknesses ?? [], fallback.weaknesses[0]),
      advances: clampList(parsed.advances ?? [], fallback.advances[0]),
      regressions: clampList(parsed.regressions ?? [], fallback.regressions[0]),
      recommendations: clampList(parsed.recommendations ?? [], fallback.recommendations[0]),
    };
  } catch {
    return fallback;
  }
}

export async function GET(request: NextRequest) {
  const access = await requireApiModuleAccess("sales", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) {
    return access.error;
  }

  const params = parseSearchParams(request.nextUrl);
  const dateRange = dateRangeFromParams(params);
  const reportKind = inferReportKind(dateRange.start, dateRange.end);

  const tickets = await prisma.ticketSale.findMany({
    where: {
      ...(access.role === "EMPLOYEE" ? { sellerId: access.session.user.id } : {}),
      soldAt: {
        gte: dateRange.start,
        lt: dateRange.end,
      },
    },
    include: {
      airline: { select: { id: true, code: true, name: true } },
      seller: { select: { name: true, team: { select: { name: true } } } },
    },
    orderBy: [{ soldAt: "asc" }, { airline: { code: "asc" } }],
  });

  const rangeDurationMs = dateRange.end.getTime() - dateRange.start.getTime();
  const previousRangeStart = new Date(dateRange.start.getTime() - rangeDurationMs);
  const previousRangeEnd = new Date(dateRange.start.getTime());

  const previousTickets = await prisma.ticketSale.findMany({
    where: {
      ...(access.role === "EMPLOYEE" ? { sellerId: access.session.user.id } : {}),
      soldAt: {
        gte: previousRangeStart,
        lt: previousRangeEnd,
      },
    },
    select: {
      soldAt: true,
      amount: true,
      baseFareAmount: true,
      commissionBaseAmount: true,
      commissionAmount: true,
      commissionRateUsed: true,
      agencyMarkupAmount: true,
      commissionCalculationStatus: true,
      commissionModeApplied: true,
      airline: { select: { code: true } },
    },
  });

  const ticketCommission = (ticket: { amount: number; commissionAmount?: number | null; commissionRateUsed?: number | null; agencyMarkupAmount?: number | null; commissionCalculationStatus?: string | null; baseFareAmount?: number | null; commissionBaseAmount?: number | null }) => (
    getTicketCommissionAmount(ticket)
  );

  // Common aggregates
  const byAgency = new Map<string, { count: number; amount: number }>();
  const airlineTotals = new Map<string, { count: number; amount: number; commission: number }>();
  const byDateAirline = new Map<string, Map<string, { count: number; amount: number; commission: number }>>();
  const byWeekAirline = new Map<string, Map<string, { count: number; amount: number; commission: number }>>();

  for (const ticket of tickets) {
    const dateStr = new Date(ticket.soldAt).toISOString().slice(0, 10);
    const weekStart = getWeekStart(dateRange.start, new Date(ticket.soldAt));
    const weekEndExclusive = new Date(weekStart);
    weekEndExclusive.setUTCDate(weekEndExclusive.getUTCDate() + 7);
    const weekKey = weekLabel(weekStart, weekEndExclusive);
    const airlineCode = ticket.airline.code.toUpperCase();
    const agencyKey = ticket.seller?.team?.name ?? "Sans agence";
    const effectiveCommission = ticketCommission(ticket);
    const billedAmount = getTicketTotalAmount(ticket, effectiveCommission);

    // Group by date -> airline
    if (!byDateAirline.has(dateStr)) {
      byDateAirline.set(dateStr, new Map());
    }
    const dateMap = byDateAirline.get(dateStr)!;

    if (!dateMap.has(airlineCode)) {
      dateMap.set(airlineCode, { count: 0, amount: 0, commission: 0 });
    }
    const row = dateMap.get(airlineCode)!;
    row.count += 1;
    row.amount += billedAmount;
    row.commission += effectiveCommission;

    if (!byWeekAirline.has(weekKey)) {
      byWeekAirline.set(weekKey, new Map());
    }
    const weekMap = byWeekAirline.get(weekKey)!;
    if (!weekMap.has(airlineCode)) {
      weekMap.set(airlineCode, { count: 0, amount: 0, commission: 0 });
    }
    const weekRow = weekMap.get(airlineCode)!;
    weekRow.count += 1;
    weekRow.amount += billedAmount;
    weekRow.commission += effectiveCommission;

    // Airline totals
    if (!airlineTotals.has(airlineCode)) {
      airlineTotals.set(airlineCode, { count: 0, amount: 0, commission: 0 });
    }
    const airlineTotal = airlineTotals.get(airlineCode)!;
    airlineTotal.count += 1;
    airlineTotal.amount += billedAmount;
    airlineTotal.commission += effectiveCommission;

    // Agency totals
    if (!byAgency.has(agencyKey)) {
      byAgency.set(agencyKey, { count: 0, amount: 0 });
    }
    const agencyData = byAgency.get(agencyKey)!;
    agencyData.count += 1;
    agencyData.amount += billedAmount;
  }

  const totalCount = tickets.length;
  const totalAmount = tickets.reduce((sum, ticket) => sum + getTicketTotalAmount(ticket, ticketCommission(ticket)), 0);
  const totalCommission = tickets.reduce((sum, ticket) => sum + ticketCommission(ticket), 0);
  const previousCount = previousTickets.length;
  const previousAmount = previousTickets.reduce((sum, ticket) => sum + getTicketTotalAmount(ticket), 0);
  const previousCommission = previousTickets.reduce((sum, ticket) => sum + (ticket.commissionAmount ?? 0), 0);
  const paymentPaid = tickets.filter((ticket) => ticket.paymentStatus === "PAID").length;
  const paymentPartial = tickets.filter((ticket) => ticket.paymentStatus === "PARTIAL").length;
  const paymentUnpaid = tickets.filter((ticket) => ticket.paymentStatus === "UNPAID").length;

  const currentDailyMap = tickets.reduce((map, ticket) => {
    const day = new Date(ticket.soldAt).toISOString().slice(0, 10);
    const existing = map.get(day) ?? { sales: 0, commissions: 0 };
    existing.sales += getTicketTotalAmount(ticket, ticketCommission(ticket));
    existing.commissions += ticketCommission(ticket);
    map.set(day, existing);
    return map;
  }, new Map<string, { sales: number; commissions: number }>());

  const comparisonDailyMap = previousTickets.reduce((map, ticket) => {
    const day = new Date(ticket.soldAt).toISOString().slice(0, 10);
    const existing = map.get(day) ?? { sales: 0, commissions: 0 };
    existing.sales += getTicketTotalAmount(ticket);
    existing.commissions += ticket.commissionAmount ?? 0;
    map.set(day, existing);
    return map;
  }, new Map<string, { sales: number; commissions: number }>());

  const currentTimeline = buildDailyTimeline(startOfUtcDay(dateRange.start), startOfUtcDay(dateRange.end));
  const comparisonTimeline = buildDailyTimeline(startOfUtcDay(previousRangeStart), startOfUtcDay(previousRangeEnd));

  let currentRunningSales = 0;
  let currentRunningCommissions = 0;
  const currentCumulativeSales: number[] = [];
  const currentCumulativeCommissions: number[] = [];
  currentTimeline.forEach((day) => {
    const row = currentDailyMap.get(day);
    currentRunningSales += row?.sales ?? 0;
    currentRunningCommissions += row?.commissions ?? 0;
    currentCumulativeSales.push(currentRunningSales);
    currentCumulativeCommissions.push(currentRunningCommissions);
  });

  let comparisonRunningSales = 0;
  let comparisonRunningCommissions = 0;
  const comparisonCumulativeSales: number[] = [];
  const comparisonCumulativeCommissions: number[] = [];
  comparisonTimeline.forEach((day) => {
    const row = comparisonDailyMap.get(day);
    comparisonRunningSales += row?.sales ?? 0;
    comparisonRunningCommissions += row?.commissions ?? 0;
    comparisonCumulativeSales.push(comparisonRunningSales);
    comparisonCumulativeCommissions.push(comparisonRunningCommissions);
  });

  // ─── Create PDF ────────────────────────────────────────────────────────────
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  const [fontFile, fontBoldFile] = await Promise.all([
    readFile(path.join(process.cwd(), "public/fonts/Montserrat-Regular.ttf")).catch(() =>
      readFile(path.join(process.cwd(), "public/branding/fonts/Montserrat-Regular.ttf")),
    ),
    readFile(path.join(process.cwd(), "public/fonts/Montserrat-Bold.ttf")).catch(() =>
      readFile(path.join(process.cwd(), "public/branding/fonts/Montserrat-Bold.ttf")),
    ),
  ]);
  const fontRegular = await pdf.embedFont(fontFile);
  const fontBold = await pdf.embedFont(fontBoldFile);
  const logoFile = await readFile(path.join(process.cwd(), "public/logo thebest.png")).catch(() => null);
  const logoImage = logoFile ? await pdf.embedPng(logoFile).catch(() => null) : null;
  const generatedBy = access.session.user.name ?? access.session.user.email ?? "Compte inconnu";
  const generatedByWithRole = `${generatedBy} (${access.role})`;
  const textBlack = rgb(0, 0, 0);

  // ─── Portrait constants ─────────────────────────────────────────────────────
  const PW = 595;
  const PH = 842;
  const PM = 40; // portrait margin
  const bodySize = 12;
  const titleSize = 14;
  const bodyLeading = 7; // gap between lines (body)
  const titleLeading = 10;

  let pPage = pdf.addPage([PW, PH]);
  let pY = PH - PM;

  const pEnsureSpace = (needed: number) => {
    if (pY - needed < PM + 20) {
      pPage = pdf.addPage([PW, PH]);
      pY = PH - PM;
    }
  };

  const drawPortraitText = (text: string, x: number, yy: number, size: number, bold = false) => {
    pPage.drawText(text, { x, y: yy, size, font: bold ? fontBold : fontRegular, color: rgb(0, 0, 0) });
  };

  const drawPortraitCentered = (text: string, yy: number, size: number, bold = false) => {
    const usedFont = bold ? fontBold : fontRegular;
    const textWidth = usedFont.widthOfTextAtSize(text, size);
    const x = Math.max(PM, (PW - textWidth) / 2);
    drawPortraitText(text, x, yy, size, bold);
  };

  const wrapPortrait = (text: string, size: number, maxWidth: number, bold = false): string[] => {
    const usedFont = bold ? fontBold : fontRegular;
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0) return [""];
    const lines: string[] = [];
    let current = words[0];
    for (let i = 1; i < words.length; i++) {
      const candidate = `${current} ${words[i]}`;
      if (usedFont.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
      } else {
        lines.push(current);
        current = words[i];
      }
    }
    lines.push(current);
    return lines;
  };

  const drawPortraitSection = (heading: string, bullets: string[]) => {
    const contentW = PW - PM * 2;
    const lineH = bodySize + bodyLeading;
    const bulletIndent = 12;
    const bulletContentW = contentW - bulletIndent;

    // Estimate height needed
    const bulletLineCount = bullets.reduce((total, b) => {
      return total + wrapPortrait(`• ${b}`, bodySize, bulletContentW).length;
    }, 0);
    const needed = titleSize + titleLeading + 6 + bulletLineCount * lineH + 16;
    pEnsureSpace(needed);

    // Section heading
    drawPortraitText(heading.toUpperCase(), PM, pY, titleSize, true);
    pY -= titleSize + 10;

    // Bullets
    for (const bullet of bullets) {
      const lines = wrapPortrait(`• ${bullet}`, bodySize, bulletContentW);
      for (let li = 0; li < lines.length; li++) {
        pEnsureSpace(lineH);
        const xOffset = li === 0 ? PM : PM + bulletIndent;
        const lineText = li === 0 ? lines[li] : `  ${lines[li]}`;
        drawPortraitText(lineText, xOffset, pY, bodySize);
        pY -= lineH;
      }
      pY -= 4; // extra gap between bullets
    }
    pY -= 16;
  };

  const drawPortraitBody = (text: string) => {
    const contentW = PW - PM * 2;
    const lineH = bodySize + bodyLeading;
    const lines = wrapPortrait(text, bodySize, contentW);
    for (const line of lines) {
      pEnsureSpace(lineH);
      drawPortraitText(line, PM, pY, bodySize);
      pY -= lineH;
    }
    pY -= 10;
  };

  const drawPerformanceSparkCard = (opts: {
    title: string;
    currentValue: number;
    previousValue: number;
    currentSeries: number[];
    previousSeries: number[];
    previousPeriodLabel: string;
    unit: string;
    mainColor: { r: number; g: number; b: number };
  }) => {
    const cardX = PM;
    const cardW = PW - PM * 2;
    const cardH = 186;
    const chartX = cardX + 18;
    const chartY = pY - cardH + 36;
    const chartW = cardW - 36;
    const chartH = 62;
    const trend = signed(pct(opts.currentValue, opts.previousValue));

    pEnsureSpace(cardH + 16);

    pPage.drawRectangle({
      x: cardX,
      y: pY - cardH,
      width: cardW,
      height: cardH,
      color: rgb(0.985, 0.985, 0.985),
      borderColor: rgb(0.84, 0.84, 0.84),
      borderWidth: 1,
    });

    drawPortraitText(opts.title.toUpperCase(), cardX + 14, pY - 22, 11, true);
    drawPortraitText(
      trend,
      cardX + cardW - 14 - fontBold.widthOfTextAtSize(trend, 11),
      pY - 22,
      11,
      true,
    );
    drawPortraitText(`${opts.currentValue.toFixed(2)} ${opts.unit}`, cardX + 14, pY - 46, 22, true);
    drawPortraitText(
      `${dateRange.startRaw} → ${dateRange.endRaw} · Réf ${opts.previousPeriodLabel}: ${opts.previousValue.toFixed(2)} ${opts.unit}`,
      cardX + 14,
      pY - 63,
      9,
    );

    [0, 0.5, 1].forEach((ratio) => {
      const gy = chartY + chartH * ratio;
      pPage.drawLine({
        start: { x: chartX, y: gy },
        end: { x: chartX + chartW, y: gy },
        thickness: 0.6,
        color: rgb(0.9, 0.9, 0.9),
      });
    });

    const currentPts = sparklinePoints(opts.currentSeries, chartW, chartH);
    const previousPts = sparklinePoints(opts.previousSeries, chartW, chartH);

    for (let i = 1; i < previousPts.length; i++) {
      pPage.drawLine({
        start: { x: chartX + previousPts[i - 1].x, y: chartY + previousPts[i - 1].y },
        end: { x: chartX + previousPts[i].x, y: chartY + previousPts[i].y },
        thickness: 1,
        color: rgb(0.82, 0.82, 0.82),
      });
    }

    const accent = rgb(opts.mainColor.r, opts.mainColor.g, opts.mainColor.b);
    const fill = rgb(
      Math.min(1, opts.mainColor.r + 0.22),
      Math.min(1, opts.mainColor.g + 0.22),
      Math.min(1, opts.mainColor.b + 0.22),
    );

    if (currentPts.length > 1) {
      for (let i = 1; i < currentPts.length; i++) {
        pPage.drawRectangle({
          x: chartX + currentPts[i - 1].x,
          y: chartY,
          width: Math.max(1, currentPts[i].x - currentPts[i - 1].x),
          height: Math.max(0, chartH - currentPts[i].y),
          color: fill,
          opacity: 0.18,
        });
      }
    }

    for (let i = 1; i < currentPts.length; i++) {
      pPage.drawLine({
        start: { x: chartX + currentPts[i - 1].x, y: chartY + currentPts[i - 1].y },
        end: { x: chartX + currentPts[i].x, y: chartY + currentPts[i].y },
        thickness: 1.8,
        color: accent,
      });
    }

    if (currentPts.length > 0) {
      const last = currentPts[currentPts.length - 1];
      pPage.drawCircle({
        x: chartX + last.x,
        y: chartY + last.y,
        size: 2.4,
        color: accent,
      });
    }

    drawPortraitText(dateRange.startRaw.slice(5), chartX, chartY - 10, 8);
    drawPortraitText(dateRange.endRaw.slice(5), chartX + chartW - 24, chartY - 10, 8);
    drawPortraitText(`Ligne claire: ${opts.previousPeriodLabel}`, chartX, chartY - 22, 8);

    pY -= cardH + 22;
  };

  // ─── Landscape page: direct sheet-style report ──────────────────────────────
  const preferredAirlines = ["CAA", "AIRCONGO", "ETHIOPIAN", "MG", "KP", "KENYA", "SA", "UR"];
  const soldCodes = Array.from(airlineTotals.keys());
  const extraCodes = soldCodes.filter((code) => !preferredAirlines.includes(code)).sort();
  const airlineColumns = [...preferredAirlines.filter((code) => soldCodes.includes(code)), ...extraCodes];
  const reportTitle = buildReportTitle(reportKind, dateRange.start, dateRange.end);
  const generatedAt = new Date().toLocaleString("fr-FR", { timeZone: "Africa/Kinshasa" });
  const reportSubtitle = `${dateRange.startRaw} au ${dateRange.endRaw}`;

  let lPage = pdf.addPage([842, 595]);
  const LW = lPage.getWidth();
  const LH = lPage.getHeight();
  const LM = 20;
  let lY = LH - 136;
  const rowH = 15;
  const TABLE_CENTER_MIN_TOP = 120;
  const TABLE_CENTER_MAX_HEIGHT = 420;
  const centeredStartY = (estimatedHeight: number) => {
    const effectiveHeight = Math.min(Math.max(estimatedHeight, 0), TABLE_CENTER_MAX_HEIGHT);
    return Math.min(LH - 150, Math.max(TABLE_CENTER_MIN_TOP, (LH + effectiveHeight) / 2));
  };

  const drawLandscapeFrame = (suffix?: string) => {
    drawTopInfo(lPage, fontBold, fontRegular, `${reportSubtitle}${suffix ? ` • ${suffix}` : ""}`, logoImage);
    drawFooter(lPage, fontRegular, reportTitle, generatedByWithRole);

    const titleWidth = fontBold.widthOfTextAtSize(reportTitle, 13);
    lPage.drawText(reportTitle, {
      x: Math.max(LM, (LW - titleWidth) / 2),
      y: LH - 84,
      size: 13,
      font: fontBold,
      color: textBlack,
    });

    const metaText = `Généré le ${generatedAt}`;
    const metaWidth = fontRegular.widthOfTextAtSize(metaText, 8.5);
    lPage.drawText(metaText, {
      x: Math.max(LM, (LW - metaWidth) / 2),
      y: LH - 98,
      size: 8.5,
      font: fontRegular,
      color: textBlack,
    });

    lY = LH - 136;
  };

  drawLandscapeFrame();

  const lEnsureSpace = (rows: number) => {
    if (lY - rows * rowH < 45) {
      lPage = pdf.addPage([842, 595]);
      drawLandscapeFrame("suite");
    }
  };

  const drawLandText = (text: string, x: number, yy: number, size = 8, bold = false) => {
    lPage.drawText(text, { x, y: yy, size, font: bold ? fontBold : fontRegular, color: rgb(0, 0, 0) });
  };

  const fitText = (text: string, size: number, maxWidth: number) => {
    if (fontRegular.widthOfTextAtSize(text, size) <= maxWidth) return text;
    const ellipsis = "…";
    let output = text;
    while (output.length > 0 && fontRegular.widthOfTextAtSize(`${output}${ellipsis}`, size) > maxWidth) {
      output = output.slice(0, -1);
    }
    return output.length > 0 ? `${output}${ellipsis}` : "";
  };

  const drawCellText = (
    text: string,
    x: number,
    cellWidth: number,
    yy: number,
    size = 8,
    align: "left" | "right" = "left",
    bold = false,
  ) => {
    const padding = 2;
    const maxWidth = Math.max(0, cellWidth - padding * 2);
    const safeText = fitText(text, size, maxWidth);
    const usedFont = bold ? fontBold : fontRegular;
    const textWidth = usedFont.widthOfTextAtSize(safeText, size);
    const textX = align === "right" ? x + cellWidth - padding - textWidth : x + padding;
    lPage.drawText(safeText, { x: textX, y: yy, size, font: usedFont, color: rgb(0, 0, 0) });
  };

  const drawLandRule = (thickness = 0.5, startX = LM, endX = LW - LM) => {
    lPage.drawLine({
      start: { x: startX, y: lY },
      end: { x: endX, y: lY },
      thickness,
      color: rgb(0.75, 0.75, 0.75),
    });
  };

  if (reportKind === "DAILY") {
    const headers = ["N°", "EMETEUR", "COMPAGNIE", "BENEFICIAIRE", "PNR", "ITINERAIRE", "MONTANT", "NATURE", "PAYANT", "STATUT", "COM."];
    const colWidths = [24, 62, 54, 78, 48, 54, 44, 42, 52, 42, 30];
    const tableWidth = colWidths.reduce((sum, w) => sum + w, 0);
    const startX = (LW - tableWidth) / 2;
    const estimatedHeight = 18 + (rowH + 9) + tickets.length * (rowH + 9) + 48;
    lY = centeredStartY(estimatedHeight);
    drawLandRule(1, startX, startX + tableWidth);
    lY -= 14;

    const xs: number[] = [];
    let cursor = startX;
    colWidths.forEach((w) => {
      xs.push(cursor);
      cursor += w;
    });

    lEnsureSpace(2);
    headers.forEach((header, idx) => drawLandText(header, xs[idx], lY, 8, true));
    lY -= rowH;
    drawLandRule(0.5, startX, startX + tableWidth);
    lY -= 9;

    tickets.forEach((ticket, index) => {
      lEnsureSpace(2);
      const values = [
        String(index + 1),
        ticket.sellerName ?? ticket.seller?.name ?? "-",
        ticket.airline.code,
        ticket.customerName,
        ticket.ticketNumber,
        ticket.route,
        fmtNumber(getTicketTotalAmount(ticket, ticketCommission(ticket))),
        ticket.saleNature,
        ticket.payerName ?? "-",
        normalizeStatus(ticket.paymentStatus),
        fmtNumber(ticket.commissionAmount ?? 0),
      ];
      values.forEach((value, idx) => drawLandText(value.slice(0, 26), xs[idx], lY, 8));
      lY -= rowH;
      drawLandRule(0.25, startX, startX + tableWidth);
      lY -= 9;
    });

    lEnsureSpace(3);
    drawLandRule(1, startX, startX + tableWidth);
    lY -= 10;
    drawLandText(`Nbr billets: ${totalCount}`, LM + 260, lY, 10, true);
    lY -= rowH;
    drawLandText(`Total General: ${fmtNumber(totalAmount)} USD`, LM + 260, lY, 10, true);
    lY -= rowH;
    drawLandText(`Commission: ${fmtNumber(totalCommission)} USD`, LM + 260, lY, 10, true);
  } else {
    const headers = [buildTableFirstColumnHeader(reportKind), "BILLETS", ...airlineColumns, "MONTANTS", "COMMISSION"];
    const airlineCount = airlineColumns.length;
    const usableWidth = Math.min(730, LW - 2 * LM);

    const billetsW = 50;
    const montantsW = 78;
    const commissionW = 78;
    const minAirlineW = 40;
    const maxAirlineW = 56;

    let airlineW = airlineCount > 0
      ? (usableWidth - billetsW - montantsW - commissionW - 160) / airlineCount
      : 0;
    airlineW = Math.max(minAirlineW, Math.min(maxAirlineW, airlineW));

    let firstColW = usableWidth - billetsW - montantsW - commissionW - airlineW * airlineCount;
    if (firstColW < 130) {
      firstColW = 130;
      const remainingForAirlines = usableWidth - billetsW - montantsW - commissionW - firstColW;
      airlineW = airlineCount > 0 ? Math.max(34, remainingForAirlines / airlineCount) : 0;
    }

    const colWidths = [firstColW, billetsW, ...airlineColumns.map(() => airlineW), montantsW, commissionW];
    const tableWidth = colWidths.reduce((sum, w) => sum + w, 0);
    const startX = (LW - tableWidth) / 2;
    const xs: number[] = [];
    const lineCount = (reportKind === "WEEKLY"
      ? Array.from(byDateAirline.entries()).length
      : Array.from(byWeekAirline.entries()).length);
    const estimatedHeight = 18 + (rowH + 9) + lineCount * (rowH + 9) + 28;
    lY = centeredStartY(estimatedHeight);
    drawLandRule(1, startX, startX + tableWidth);
    lY -= 14;

    let cursor = startX;
    colWidths.forEach((w) => {
      xs.push(cursor);
      cursor += w;
    });
    const xOf = (i: number) => xs[i];
    const wOf = (i: number) => colWidths[i];

    lEnsureSpace(2);
    headers.forEach((header, idx) => {
      const align = idx >= 2 ? "right" : "left";
      drawCellText(header, xOf(idx), wOf(idx), lY, 8, align, true);
    });
    lY -= rowH;
    drawLandRule(0.5, startX, startX + tableWidth);
    lY -= 9;

    const lines = reportKind === "WEEKLY"
      ? Array.from(byDateAirline.entries()).sort(([a], [b]) => a.localeCompare(b))
      : Array.from(byWeekAirline.entries()).sort(([a], [b]) => a.localeCompare(b));

    lines.forEach(([label, airlineMap]) => {
      lEnsureSpace(2);
      const totalBillets = Array.from(airlineMap.values()).reduce((sum, v) => sum + v.count, 0);
      const totalLineAmount = Array.from(airlineMap.values()).reduce((sum, v) => sum + v.amount, 0);
      const totalLineCommission = Array.from(airlineMap.values()).reduce((sum, v) => sum + v.commission, 0);

      drawCellText(label, xOf(0), wOf(0), lY, 8, "left");
      drawCellText(String(totalBillets), xOf(1), wOf(1), lY, 8, "right");
      airlineColumns.forEach((code, codeIdx) => {
        const amount = airlineMap.get(code)?.amount ?? 0;
        drawCellText(amount > 0 ? fmtNumber(amount) : "-", xOf(2 + codeIdx), wOf(2 + codeIdx), lY, 8, "right");
      });
      drawCellText(fmtNumber(totalLineAmount), xOf(2 + airlineColumns.length), wOf(2 + airlineColumns.length), lY, 8, "right");
      drawCellText(fmtNumber(totalLineCommission), xOf(3 + airlineColumns.length), wOf(3 + airlineColumns.length), lY, 8, "right");

      lY -= rowH;
      drawLandRule(0.25, startX, startX + tableWidth);
      lY -= 9;
    });

    lEnsureSpace(4);
    drawLandRule(1.1, startX, startX + tableWidth);
    lY -= 10;
    drawCellText("TOTAL GENERAL", xOf(0), wOf(0), lY, 9, "left", true);
    drawCellText(String(totalCount), xOf(1), wOf(1), lY, 9, "right", true);
    airlineColumns.forEach((code, codeIdx) => {
      const amount = airlineTotals.get(code)?.amount ?? 0;
      drawCellText(amount > 0 ? fmtNumber(amount) : "-", xOf(2 + codeIdx), wOf(2 + codeIdx), lY, 9, "right", true);
    });
    drawCellText(fmtNumber(totalAmount), xOf(2 + airlineColumns.length), wOf(2 + airlineColumns.length), lY, 9, "right", true);
    drawCellText(fmtNumber(totalCommission), xOf(3 + airlineColumns.length), wOf(3 + airlineColumns.length), lY, 9, "right", true);
  }

  const bytes = await pdf.save();
  return new NextResponse(Uint8Array.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="rapport-vente-${dateRange.startRaw}-${dateRange.endRaw}.pdf"`,
      "Cache-Control": "private, max-age=60",
    },
  });
}
