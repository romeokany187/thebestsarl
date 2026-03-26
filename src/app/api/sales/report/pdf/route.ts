import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";

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
  return `SEMAINE DU ${start.toISOString().slice(0, 10)} AU ${end.toISOString().slice(0, 10)}`;
}

function getWeekStart(baseStart: Date, date: Date) {
  const diffMs = date.getTime() - baseStart.getTime();
  const diffDays = Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
  const block = Math.floor(diffDays / 7);
  const start = new Date(baseStart);
  start.setUTCDate(baseStart.getUTCDate() + block * 7);
  return start;
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
    "Tu rédiges des analyses executives de haut niveau, substantielles, factuelless, rigoureuses et présentables à un conseil d'administration, aux associés et aux autorités régulatrices.",
    "Chaque section doit être DÉVELOPPÉE : au moins 4 à 6 phrases ou puces denses par rubrique. Pas de superficialité ni de généralités vides.",
    "Cite systématiquement les chiffres clés de la période dans chaque section. Contextualise les tendances avec des interprétations causales concrètes.",
    "Dans les recommandations, propose des mesures concrètes avec responsables suggérés, délais et KPIs de suivi.",
    "N'invente aucun chiffre au-delà des données fournies. Réponds STRICTEMENT en JSON valide sans aucun texte additionnel.",
  ].join(" ");

  const userPrompt = [
    "Produis une analyse exécutive complète et détaillée en français avec ce schéma JSON EXACT:",
    "{",
    '  "title": "string (titre court du rapport avec période)",',
    '  "summary": "string (MINIMUM 6 phrases: contexte opérationnel, chiffres clés période, comparaison période précédente, qualité encaissement, structure commissions, conclusion direction)",',
    '  "strengths": ["string (4 à 6 puces développées chacune en 2-3 phrases avec chiffres)"],',
    '  "weaknesses": ["string (4 à 6 puces développées chacune en 2-3 phrases avec analyse causale)"],',
    '  "advances": ["string (4 à 6 puces développées: description de la progression et son impact business)"],',
    '  "regressions": ["string (4 à 6 puces développées: description du recul, causes probables, impact estimé)"],',
    '  "recommendations": ["string (4 à 6 actions concrètes avec: quoi faire, qui porte la responsabilité, délai cible, KPI de succès)"]',
    "}",
    "",
    "IMPERATIF: Chaque puce doit être substantielle (2 à 3 phrases au minimum). Pas de bullet point vague de type 'surveiller les ventes'.",
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
      amount: true,
      commissionAmount: true,
    },
  });

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
    const airlineCode = ticket.airline.code;
    const agencyKey = ticket.seller?.team?.name ?? "Sans agence";

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
    row.amount += ticket.amount;
    row.commission += ticket.commissionAmount ?? 0;

    if (!byWeekAirline.has(weekKey)) {
      byWeekAirline.set(weekKey, new Map());
    }
    const weekMap = byWeekAirline.get(weekKey)!;
    if (!weekMap.has(airlineCode)) {
      weekMap.set(airlineCode, { count: 0, amount: 0, commission: 0 });
    }
    const weekRow = weekMap.get(airlineCode)!;
    weekRow.count += 1;
    weekRow.amount += ticket.amount;
    weekRow.commission += ticket.commissionAmount ?? 0;

    // Airline totals
    if (!airlineTotals.has(airlineCode)) {
      airlineTotals.set(airlineCode, { count: 0, amount: 0, commission: 0 });
    }
    const airlineTotal = airlineTotals.get(airlineCode)!;
    airlineTotal.count += 1;
    airlineTotal.amount += ticket.amount;
    airlineTotal.commission += ticket.commissionAmount ?? 0;

    // Agency totals
    if (!byAgency.has(agencyKey)) {
      byAgency.set(agencyKey, { count: 0, amount: 0 });
    }
    const agencyData = byAgency.get(agencyKey)!;
    agencyData.count += 1;
    agencyData.amount += ticket.amount;
  }

  const totalCount = tickets.length;
  const totalAmount = tickets.reduce((sum, t) => sum + t.amount, 0);
  const totalCommission = tickets.reduce((sum, t) => sum + (t.commissionAmount ?? 0), 0);
  const previousCount = previousTickets.length;
  const previousAmount = previousTickets.reduce((sum, t) => sum + t.amount, 0);
  const previousCommission = previousTickets.reduce((sum, t) => sum + (t.commissionAmount ?? 0), 0);
  const paymentPaid = tickets.filter((ticket) => ticket.paymentStatus === "PAID").length;
  const paymentPartial = tickets.filter((ticket) => ticket.paymentStatus === "PARTIAL").length;
  const paymentUnpaid = tickets.filter((ticket) => ticket.paymentStatus === "UNPAID").length;

  const sortedAirlinesForAnalysis = Array.from(airlineTotals.entries())
    .map(([code, data]) => ({ code, amount: data.amount, count: data.count, commission: data.commission }))
    .sort((a, b) => b.amount - a.amount);
  const sortedAgenciesForAnalysis = Array.from(byAgency.entries())
    .map(([name, data]) => ({ name, amount: data.amount, count: data.count }))
    .sort((a, b) => b.amount - a.amount);

  const executiveAnalysis = await generateExecutiveAnalysis({
    reportKind,
    startRaw: dateRange.startRaw,
    endRaw: dateRange.endRaw,
    totalCount,
    totalAmount,
    totalCommission,
    paymentPaid,
    paymentPartial,
    paymentUnpaid,
    previousCount,
    previousAmount,
    previousCommission,
    byAirline: sortedAirlinesForAnalysis,
    byAgency: sortedAgenciesForAnalysis,
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

  const drawPortraitRule = (thickness = 0.5, color = rgb(0.7, 0.7, 0.7)) => {
    pPage.drawLine({
      start: { x: PM, y: pY },
      end: { x: PW - PM, y: pY },
      thickness,
      color,
    });
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
    pY -= titleSize + 4;
    drawPortraitRule(1, rgb(0.2, 0.2, 0.2));
    pY -= 8;

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

  // ─── Report title label ─────────────────────────────────────────────────────
  const reportTitle = reportKind === "DAILY"
    ? `RAPPORT DE VENTE DU ${dateRange.startRaw}`
    : reportKind === "WEEKLY"
      ? `RAPPORT DE LA SEMAINE DU ${dateRange.startRaw} AU ${dateRange.endRaw}`
      : reportKind === "MONTHLY"
        ? `RAPPORT MENSUEL DU ${dateRange.startRaw} AU ${dateRange.endRaw}`
        : reportKind === "ANNUAL"
          ? `RAPPORT ANNUEL DU ${dateRange.startRaw} AU ${dateRange.endRaw}`
          : `RAPPORT DE PERFORMANCE DU ${dateRange.startRaw} AU ${dateRange.endRaw}`;

  // ─── Portrait page 1: header ────────────────────────────────────────────────
  // Company name
  drawPortraitText("THE BEST S.A.R.L", PM, pY, 20, true);
  pY -= 28;

  // Report title
  drawPortraitText(reportTitle, PM, pY, titleSize, true);
  pY -= titleSize + 6;

  // Generated at
  const generatedAt = new Date().toLocaleString("fr-FR", { timeZone: "Africa/Kinshasa" });
  drawPortraitText(`Généré le ${generatedAt}`, PM, pY, 10);
  pY -= 14;

  // Totals summary line
  drawPortraitText(
    `Billets : ${totalCount}   |   Total : ${fmtNumber(totalAmount)} USD   |   Commission : ${fmtNumber(totalCommission)} USD`,
    PM,
    pY,
    10,
  );
  pY -= 10;

  drawPortraitRule(2, rgb(0.1, 0.1, 0.1));
  pY -= 22;

  // ─── Portrait pages: AI executive analysis ──────────────────────────────────
  // Analyse executive title
  pEnsureSpace(titleSize + 20);
  drawPortraitText("ANALYSE EXECUTIVE", PM, pY, titleSize, true);
  pY -= titleSize + 4;
  drawPortraitRule(1.5, rgb(0.1, 0.1, 0.1));
  pY -= 6;
  drawPortraitText(executiveAnalysis.title, PM, pY, bodySize, false);
  pY -= bodySize + bodyLeading + 16;

  // 1. Synthèse
  pEnsureSpace(titleSize + 20);
  drawPortraitText("1. SYNTHESE", PM, pY, titleSize, true);
  pY -= titleSize + 4;
  drawPortraitRule(1, rgb(0.2, 0.2, 0.2));
  pY -= 8;
  drawPortraitBody(executiveAnalysis.summary);

  // 2. Points forts
  drawPortraitSection("2. Points forts", executiveAnalysis.strengths);

  // 3. Points faibles
  drawPortraitSection("3. Points faibles", executiveAnalysis.weaknesses);

  // 4. Avancées
  drawPortraitSection("4. Avancees", executiveAnalysis.advances);

  // 5. Régressions
  drawPortraitSection("5. Regressions", executiveAnalysis.regressions);

  // 6. Recommandations
  drawPortraitSection("6. Recommandations", executiveAnalysis.recommendations);

  // ─── Landscape page: data table ─────────────────────────────────────────────
  const preferredAirlines = ["CAA", "AIRCONGO", "ETHIOPIAN", "MG", "KP", "KENYA", "SA", "UR"];
  const allCodes = Array.from(new Set(tickets.map((ticket) => ticket.airline.code.toUpperCase())));
  const extraCodes = allCodes.filter((code) => !preferredAirlines.includes(code)).sort();
  const airlineColumns = [...preferredAirlines.filter((code) => allCodes.includes(code)), ...extraCodes];

  let lPage = pdf.addPage([842, 595]);
  const LW = lPage.getWidth();
  const LH = lPage.getHeight();
  const LM = 20;
  let lY = LH - 28;
  const rowH = 15;

  const lEnsureSpace = (rows: number) => {
    if (lY - rows * rowH < 45) {
      lPage = pdf.addPage([842, 595]);
      lY = LH - 28;
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

  const drawLandRule = (thickness = 0.5) => {
    lPage.drawLine({
      start: { x: LM, y: lY },
      end: { x: LW - LM, y: lY },
      thickness,
      color: rgb(0.75, 0.75, 0.75),
    });
  };

  // Table header title
  drawLandText(reportTitle, LM, lY, 12, true);
  lY -= 16;
  drawLandRule(1);
  lY -= 14;

  if (reportKind === "DAILY") {
    const headers = ["N°", "EMETEUR", "COMPAGNIE", "BENEFICIAIRE", "PNR", "ITINERAIRE", "MONTANT", "NATURE", "PAYANT", "STATUT", "COM."];
    const colWidths = [24, 62, 54, 78, 48, 54, 44, 42, 52, 42, 30];
    const xs: number[] = [];
    let cursor = LM;
    colWidths.forEach((w) => {
      xs.push(cursor);
      cursor += w;
    });

    lEnsureSpace(2);
    headers.forEach((header, idx) => drawLandText(header, xs[idx], lY, 8, true));
    lY -= rowH;
    drawLandRule();
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
        fmtNumber(ticket.amount),
        ticket.saleNature,
        ticket.payerName ?? "-",
        normalizeStatus(ticket.paymentStatus),
        fmtNumber(ticket.commissionAmount ?? 0),
      ];
      values.forEach((value, idx) => drawLandText(value.slice(0, 26), xs[idx], lY, 8));
      lY -= rowH;
      drawLandRule(0.25);
      lY -= 9;
    });

    lEnsureSpace(3);
    drawLandRule(1);
    lY -= 10;
    drawLandText(`Nbr billets: ${totalCount}`, LM + 260, lY, 10, true);
    lY -= rowH;
    drawLandText(`Total General: ${fmtNumber(totalAmount)} USD`, LM + 260, lY, 10, true);
    lY -= rowH;
    drawLandText(`Commission: ${fmtNumber(totalCommission)} USD`, LM + 260, lY, 10, true);
  } else {
    const headers = ["DATE / PERIODE", "BILLETS", ...airlineColumns, "MONTANTS", "COMMISSION"];
    const airlineCount = airlineColumns.length;
    const usableWidth = LW - 2 * LM;

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
    const xs: number[] = [];
    let cursor = LM;
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
    drawLandRule();
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
      drawLandRule(0.25);
      lY -= 9;
    });

    lEnsureSpace(4);
    drawLandRule(1.1);
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
