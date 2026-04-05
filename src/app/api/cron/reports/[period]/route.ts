import { NextRequest, NextResponse } from "next/server";
import { PaymentStatus, PresenceLocationStatus } from "@prisma/client";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { prisma } from "@/lib/prisma";
import { isMailConfigured, sendMailBatch } from "@/lib/mail";
import { computeCaaCommissionMap } from "@/lib/caa-commission";

type Frequency = "daily" | "weekly" | "monthly";
type Params = { params: Promise<{ period: string }> };

type AiInsight = {
  level: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  detail: string;
  action: string;
};

function parseFrequency(value: string): Frequency | null {
  if (value === "daily" || value === "weekly" || value === "monthly") {
    return value;
  }
  return null;
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function getPreviousPeriodRange(frequency: Frequency, now = new Date()) {
  if (frequency === "daily") {
    const end = startOfUtcDay(now);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 1);
    return {
      start,
      end,
      label: `Journalier ${start.toISOString().slice(0, 10)}`,
    };
  }

  if (frequency === "weekly") {
    const currentDayStart = startOfUtcDay(now);
    const day = currentDayStart.getUTCDay();
    const diffToMonday = day === 0 ? 6 : day - 1;
    const currentWeekStart = new Date(currentDayStart);
    currentWeekStart.setUTCDate(currentWeekStart.getUTCDate() - diffToMonday);

    const end = currentWeekStart;
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 7);

    return {
      start,
      end,
      label: `Hebdomadaire ${start.toISOString().slice(0, 10)} au ${new Date(end.getTime() - 1).toISOString().slice(0, 10)}`,
    };
  }

  const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = currentMonthStart;
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1, 1));

  return {
    start,
    end,
    label: `Mensuel ${start.toISOString().slice(0, 7)}`,
  };
}

function formatMoney(value: number) {
  return `${value.toFixed(2)} USD`;
}

function formatMoneyCdf(value: number) {
  return `${value.toFixed(2)} CDF`;
}

function normalizeMoneyCurrency(value: string | null | undefined): "USD" | "CDF" {
  const normalized = (value ?? "USD").trim().toUpperCase();
  return normalized === "CDF" || normalized === "XAF" || normalized === "FC" ? "CDF" : "USD";
}

function isVirtualMethod(methodRaw: string | null | undefined) {
  const method = (methodRaw ?? "").trim().toUpperCase();
  return method.includes("AIRTEL")
    || method.includes("ORANGE")
    || method.includes("M-PESA")
    || method.includes("MPESA")
    || method.includes("M PESA")
    || method.includes("EQUITY");
}

function computeCashOpeningBalance(
  ticketPayments: Array<{ amount: number; currency?: string | null; method?: string | null; paidAt?: Date | string | null }>,
  cashOperations: Array<{ amount: number; currency?: string | null; method?: string | null; direction: string; category?: string | null; occurredAt?: Date | string | null }>,
) {
  const events = [
    ...ticketPayments
      .filter((payment) => !isVirtualMethod(payment.method))
      .map((payment) => ({
        at: new Date(payment.paidAt ?? new Date(0)),
        currency: normalizeMoneyCurrency(payment.currency),
        amount: payment.amount,
        direction: "INFLOW" as const,
        category: null,
      })),
    ...cashOperations
      .filter((operation) => !isVirtualMethod(operation.method))
      .map((operation) => ({
        at: new Date(operation.occurredAt ?? new Date(0)),
        currency: normalizeMoneyCurrency(operation.currency),
        amount: operation.amount,
        direction: operation.direction === "OUTFLOW" ? "OUTFLOW" as const : "INFLOW" as const,
        category: operation.category ?? null,
      })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  return events.reduce(
    (sum, event) => {
      if (event.category === "OPENING_BALANCE") {
        if (event.currency === "USD") {
          sum.usd = event.amount;
        } else {
          sum.cdf = event.amount;
        }
        return sum;
      }

      if (event.currency === "USD") {
        sum.usd += event.direction === "INFLOW" ? event.amount : -event.amount;
      } else {
        sum.cdf += event.direction === "INFLOW" ? event.amount : -event.amount;
      }

      return sum;
    },
    { usd: 0, cdf: 0 },
  );
}

async function buildSimplePdfAttachment(title: string, subtitle: string, sections: Array<{ heading: string; lines: string[] }>) {
  const pdf = await PDFDocument.create();
  const pageSize: [number, number] = [595, 842];
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const textColor = rgb(0.1, 0.1, 0.1);
  const muted = rgb(0.4, 0.4, 0.4);

  let page = pdf.addPage(pageSize);
  let y = 800;

  const ensureSpace = (needed = 18) => {
    if (y > needed + 24) return;
    page = pdf.addPage(pageSize);
    y = 800;
  };

  page.drawText(title, { x: 36, y, size: 16, font: bold, color: textColor });
  y -= 20;
  page.drawText(subtitle, { x: 36, y, size: 10, font, color: muted });
  y -= 24;

  for (const section of sections) {
    ensureSpace(40);
    page.drawText(section.heading, { x: 36, y, size: 12, font: bold, color: textColor });
    y -= 18;

    for (const line of section.lines) {
      ensureSpace(18);
      page.drawText(line, { x: 44, y, size: 9, font, color: textColor });
      y -= 13;
    }

    y -= 8;
  }

  return Buffer.from(await pdf.save());
}

function percent(part: number, total: number) {
  if (total <= 0) return 0;
  return (part / total) * 100;
}

function buildAiInsights(input: {
  attendanceTotal: number;
  lateCount: number;
  offsiteSigns: number;
  ticketsCount: number;
  totalSalesAmount: number;
  paidAmount: number;
  partialAmount: number;
  unpaidAmount: number;
  topSellerSharePct: number;
}) {
  const lateRate = percent(input.lateCount, input.attendanceTotal);
  const offsiteRate = percent(input.offsiteSigns, input.attendanceTotal);
  const collectionRate = percent(input.paidAmount + input.partialAmount * 0.5, input.totalSalesAmount);
  const unpaidExposureRate = percent(input.unpaidAmount + input.partialAmount * 0.5, input.totalSalesAmount);

  const insights: AiInsight[] = [];
  let score = 100;

  if (lateRate >= 25) {
    score -= 20;
    insights.push({
      level: "WARNING",
      title: "Retards élevés",
      detail: `${lateRate.toFixed(1)}% des pointages ont du retard.`,
      action: "Renforcer le contrôle d'arrivée par équipe et rappeler l'heure limite.",
    });
  } else if (lateRate >= 10) {
    score -= 10;
    insights.push({
      level: "INFO",
      title: "Retards modérés",
      detail: `${lateRate.toFixed(1)}% des pointages sont en retard.`,
      action: "Suivre les personnes récurrentes sur les 7 prochains jours.",
    });
  }

  if (offsiteRate >= 30) {
    score -= 25;
    insights.push({
      level: "CRITICAL",
      title: "Pointages hors site anormaux",
      detail: `${offsiteRate.toFixed(1)}% des signatures sont hors site.`,
      action: "Vérifier les affectations et faire une revue managériale immédiate.",
    });
  } else if (offsiteRate >= 15) {
    score -= 12;
    insights.push({
      level: "WARNING",
      title: "Pointages hors site à surveiller",
      detail: `${offsiteRate.toFixed(1)}% des signatures sont hors site.`,
      action: "Contrôler les équipes avec plus de 2 pointages hors site.",
    });
  }

  if (unpaidExposureRate >= 45) {
    score -= 30;
    insights.push({
      level: "CRITICAL",
      title: "Risque de recouvrement élevé",
      detail: `${unpaidExposureRate.toFixed(1)}% des ventes sont exposées (non payé/partiel).`,
      action: "Prioriser le recouvrement sur les dossiers non payés avant nouvelles ventes à crédit.",
    });
  } else if (unpaidExposureRate >= 25) {
    score -= 14;
    insights.push({
      level: "WARNING",
      title: "Encaissement sous pression",
      detail: `Taux d'encaissement estimé: ${collectionRate.toFixed(1)}%.`,
      action: "Lancer un rappel paiement automatique pour les dossiers partiels.",
    });
  }

  if (input.totalSalesAmount <= 0) {
    score -= 8;
    insights.push({
      level: "INFO",
      title: "Activité commerciale nulle",
      detail: "Aucune vente sur la période.",
      action: "Analyser disponibilité commerciale et pipeline clients.",
    });
  }

  if (input.topSellerSharePct >= 60 && input.ticketsCount >= 5) {
    score -= 8;
    insights.push({
      level: "INFO",
      title: "Dépendance à un seul vendeur",
      detail: `Le top vendeur concentre ${input.topSellerSharePct.toFixed(1)}% des ventes.`,
      action: "Rééquilibrer la charge commerciale sur l'équipe.",
    });
  }

  if (insights.length === 0) {
    insights.push({
      level: "INFO",
      title: "Situation saine",
      detail: "Les indicateurs de présence, ventes et paiement restent stables.",
      action: "Maintenir le suivi hebdomadaire standard.",
    });
  }

  const normalizedScore = Math.max(0, Math.min(100, score));
  const riskLabel = normalizedScore >= 80 ? "Faible" : normalizedScore >= 60 ? "Modéré" : "Élevé";

  return {
    score: normalizedScore,
    riskLabel,
    insights,
    collectionRate,
    unpaidExposureRate,
  };
}

function readBearerToken(request: NextRequest) {
  const header = request.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) {
    return "";
  }
  return header.slice(7).trim();
}

function isAuthorizedCronCall(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return process.env.NODE_ENV !== "production";
  }

  return readBearerToken(request) === secret;
}

function getReportsRecipient() {
  const email =
    process.env.REPORTS_TO_EMAIL?.trim()
    || process.env.MAIL_FROM_EMAIL?.trim()
    || process.env.SMTP_USER?.trim()
    || "";

  return email.toLowerCase();
}

export async function GET(request: NextRequest, { params }: Params) {
  const { period } = await params;
  const frequency = parseFrequency(period);

  if (!frequency) {
    return NextResponse.json({ error: "Période cron invalide." }, { status: 400 });
  }

  if (!isAuthorizedCronCall(request)) {
    return NextResponse.json({ error: "Unauthorized cron request." }, { status: 401 });
  }

  if (!isMailConfigured()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "smtp_not_configured",
      frequency,
    });
  }

  const range = getPreviousPeriodRange(frequency, new Date());

  const [attendanceRows, tickets] = await Promise.all([
    prisma.attendance.findMany({
      where: {
        date: {
          gte: range.start,
          lt: range.end,
        },
      },
      select: {
        status: true,
        latenessMins: true,
        overtimeMins: true,
        locationStatus: true,
      },
    }),
    prisma.ticketSale.findMany({
      where: {
        soldAt: {
          gte: range.start,
          lt: range.end,
        },
      },
      select: {
        id: true,
        airlineId: true,
        soldAt: true,
        amount: true,
        commissionAmount: true,
        commissionRateUsed: true,
        paymentStatus: true,
        sellerName: true,
        seller: {
          select: { name: true },
        },
      },
    }),
  ]);

  const caaAirline = await prisma.airline.findUnique({
    where: { code: "CAA" },
    select: {
      id: true,
      commissionRules: {
        where: { isActive: true },
        orderBy: { startsAt: "desc" },
        select: {
          commissionMode: true,
          depositStockTargetAmount: true,
          batchCommissionAmount: true,
        },
      },
    },
  });

  const caaRule = caaAirline?.commissionRules.find((rule) => rule.commissionMode === "AFTER_DEPOSIT");
  const caaCommissionMap = caaAirline && caaRule
    ? computeCaaCommissionMap({
      periodTicketIds: tickets.filter((ticket) => ticket.airlineId === caaAirline.id).map((ticket) => ticket.id),
      orderedCaaTicketsUntilPeriodEnd: await prisma.ticketSale.findMany({
        where: {
          airlineId: caaAirline.id,
          soldAt: { lt: range.end },
        },
        select: { id: true, soldAt: true, amount: true },
        orderBy: [{ soldAt: "asc" }, { id: "asc" }],
      }),
      targetAmount: caaRule.depositStockTargetAmount ?? 0,
      batchCommissionAmount: caaRule.batchCommissionAmount ?? 0,
    })
    : new Map<string, number>();

  const ticketCommission = (ticket: { id: string; airlineId: string; amount: number; commissionAmount: number | null; commissionRateUsed: number }) => {
    if (caaAirline && ticket.airlineId === caaAirline.id && caaCommissionMap.has(ticket.id)) {
      return caaCommissionMap.get(ticket.id) ?? 0;
    }
    return ticket.commissionAmount ?? ticket.amount * (ticket.commissionRateUsed / 100);
  };

  const reportsRecipient = getReportsRecipient();
  const financeRecipients = await prisma.user.findMany({
    where: {
      email: { not: "" },
      OR: [
        { role: "ADMIN" },
        { role: "DIRECTEUR_GENERAL" },
        { jobTitle: "DIRECTION_GENERALE" },
      ],
    },
    select: { email: true, name: true },
    orderBy: { createdAt: "asc" },
  });

  const recipients = Array.from(
    new Map(
      [
        ...financeRecipients,
        ...(reportsRecipient ? [{ email: reportsRecipient, name: "Application THEBEST SARL" }] : []),
      ].map((recipient) => [recipient.email.trim().toLowerCase(), recipient]),
    ).values(),
  );

  if (recipients.length === 0) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "no_reports_recipient",
      frequency,
      range,
    });
  }

  const attendance = {
    totalRecords: attendanceRows.length,
    presentCount: attendanceRows.filter((row) => row.status === "PRESENT").length,
    lateCount: attendanceRows.filter((row) => row.latenessMins > 0).length,
    overtimeTotalMins: attendanceRows.reduce((sum, row) => sum + row.overtimeMins, 0),
    officeSigns: attendanceRows.filter((row) => row.locationStatus === PresenceLocationStatus.OFFICE).length,
    offsiteSigns: attendanceRows.filter((row) => row.locationStatus === PresenceLocationStatus.OFFSITE).length,
  };

  const totalSalesAmount = tickets.reduce((sum, ticket) => sum + ticket.amount, 0);
  const totalCommission = tickets.reduce((sum, ticket) => sum + ticketCommission(ticket), 0);

  const paidCount = tickets.filter((ticket) => ticket.paymentStatus === PaymentStatus.PAID).length;
  const partialCount = tickets.filter((ticket) => ticket.paymentStatus === PaymentStatus.PARTIAL).length;
  const unpaidCount = tickets.filter((ticket) => ticket.paymentStatus === PaymentStatus.UNPAID).length;

  const paidAmount = tickets
    .filter((ticket) => ticket.paymentStatus === PaymentStatus.PAID)
    .reduce((sum, ticket) => sum + ticket.amount, 0);
  const partialAmount = tickets
    .filter((ticket) => ticket.paymentStatus === PaymentStatus.PARTIAL)
    .reduce((sum, ticket) => sum + ticket.amount, 0);
  const unpaidAmount = tickets
    .filter((ticket) => ticket.paymentStatus === PaymentStatus.UNPAID)
    .reduce((sum, ticket) => sum + ticket.amount, 0);

  const sellerAggregation = new Map<string, { tickets: number; amount: number }>();
  tickets.forEach((ticket) => {
    const sellerName = ticket.sellerName ?? ticket.seller?.name ?? "Inconnu";
    const existing = sellerAggregation.get(sellerName) ?? { tickets: 0, amount: 0 };
    existing.tickets += 1;
    existing.amount += ticket.amount;
    sellerAggregation.set(sellerName, existing);
  });

  const topSellers = Array.from(sellerAggregation.entries())
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  const topSellerSharePct = totalSalesAmount > 0 && topSellers[0]
    ? (topSellers[0].amount / totalSalesAmount) * 100
    : 0;

  const ai = buildAiInsights({
    attendanceTotal: attendance.totalRecords,
    lateCount: attendance.lateCount,
    offsiteSigns: attendance.offsiteSigns,
    ticketsCount: tickets.length,
    totalSalesAmount,
    paidAmount,
    partialAmount,
    unpaidAmount,
    topSellerSharePct,
  });

  const subject = `Rapport automatique ${range.label} - ${frequency === "daily" ? "Présences, Ventes & Caisse" : "Présences & Ventes"}`;

  const dailyAttachments = frequency === "daily"
    ? await (async () => {
      const [cashPayments, cashOperations, ticketPaymentsBeforeStart, cashOperationsBeforeStart] = await Promise.all([
        prisma.payment.findMany({
          where: { paidAt: { gte: range.start, lt: range.end } },
          select: {
            paidAt: true,
            amount: true,
            currency: true,
            method: true,
            reference: true,
            ticket: { select: { ticketNumber: true, customerName: true, currency: true } },
          },
          orderBy: { paidAt: "asc" },
          take: 2000,
        }),
        prisma.cashOperation.findMany({
          where: { occurredAt: { gte: range.start, lt: range.end } },
          select: {
            occurredAt: true,
            description: true,
            reference: true,
            amount: true,
            direction: true,
            category: true,
            method: true,
            currency: true,
          },
          orderBy: { occurredAt: "asc" },
          take: 2000,
        }),
        prisma.payment.findMany({
          where: { paidAt: { lt: range.start } },
          select: { paidAt: true, amount: true, currency: true, method: true },
          take: 5000,
        }),
        prisma.cashOperation.findMany({
          where: { occurredAt: { lt: range.start } },
          select: { occurredAt: true, amount: true, currency: true, method: true, direction: true, category: true },
          take: 5000,
        }),
      ]);

      const opening = computeCashOpeningBalance(ticketPaymentsBeforeStart, cashOperationsBeforeStart);
      const cashTicketEntries = cashPayments.filter((payment) => !isVirtualMethod(payment.method));
      const cashOpsEntries = cashOperations.filter((operation) => !isVirtualMethod(operation.method));

      const ticketUsd = cashTicketEntries
        .filter((payment) => normalizeMoneyCurrency(payment.currency ?? payment.ticket.currency) === "USD")
        .reduce((sum, payment) => sum + payment.amount, 0);
      const ticketCdf = cashTicketEntries
        .filter((payment) => normalizeMoneyCurrency(payment.currency ?? payment.ticket.currency) === "CDF")
        .reduce((sum, payment) => sum + payment.amount, 0);
      const cashInflowUsd = cashOpsEntries
        .filter((operation) => operation.direction === "INFLOW" && normalizeMoneyCurrency(operation.currency) === "USD")
        .reduce((sum, operation) => sum + operation.amount, 0);
      const cashOutflowUsd = cashOpsEntries
        .filter((operation) => operation.direction === "OUTFLOW" && normalizeMoneyCurrency(operation.currency) === "USD")
        .reduce((sum, operation) => sum + operation.amount, 0);
      const cashInflowCdf = cashOpsEntries
        .filter((operation) => operation.direction === "INFLOW" && normalizeMoneyCurrency(operation.currency) === "CDF")
        .reduce((sum, operation) => sum + operation.amount, 0);
      const cashOutflowCdf = cashOpsEntries
        .filter((operation) => operation.direction === "OUTFLOW" && normalizeMoneyCurrency(operation.currency) === "CDF")
        .reduce((sum, operation) => sum + operation.amount, 0);

      const closingUsd = opening.usd + ticketUsd + cashInflowUsd - cashOutflowUsd;
      const closingCdf = opening.cdf + ticketCdf + cashInflowCdf - cashOutflowCdf;

      const journalRows = [
        ...cashTicketEntries.map((payment) => ({
          at: new Date(payment.paidAt),
          label: `Paiement billet ${payment.ticket.ticketNumber} - ${payment.ticket.customerName}`,
          reference: payment.reference ?? "-",
          usdIn: normalizeMoneyCurrency(payment.currency ?? payment.ticket.currency) === "USD" ? payment.amount : 0,
          usdOut: 0,
          cdfIn: normalizeMoneyCurrency(payment.currency ?? payment.ticket.currency) === "CDF" ? payment.amount : 0,
          cdfOut: 0,
        })),
        ...cashOpsEntries.map((operation) => ({
          at: new Date(operation.occurredAt),
          label: operation.description,
          reference: operation.reference ?? "-",
          usdIn: operation.direction === "INFLOW" && normalizeMoneyCurrency(operation.currency) === "USD" ? operation.amount : 0,
          usdOut: operation.direction === "OUTFLOW" && normalizeMoneyCurrency(operation.currency) === "USD" ? operation.amount : 0,
          cdfIn: operation.direction === "INFLOW" && normalizeMoneyCurrency(operation.currency) === "CDF" ? operation.amount : 0,
          cdfOut: operation.direction === "OUTFLOW" && normalizeMoneyCurrency(operation.currency) === "CDF" ? operation.amount : 0,
        })),
      ].sort((a, b) => a.at.getTime() - b.at.getTime());

      const journalPdf = await buildSimplePdfAttachment(
        "Journal de caisse quotidien",
        `${range.start.toISOString().slice(0, 10)} • ouverture USD ${opening.usd.toFixed(2)} / CDF ${opening.cdf.toFixed(2)}`,
        [
          {
            heading: "Écritures du jour",
            lines: journalRows.length > 0
              ? journalRows.slice(0, 180).map((row) => `${row.at.toLocaleString("fr-FR")} • ${row.label} • USD +${row.usdIn.toFixed(2)} / -${row.usdOut.toFixed(2)} • CDF +${row.cdfIn.toFixed(2)} / -${row.cdfOut.toFixed(2)} • Réf ${row.reference}`)
              : ["Aucune écriture de caisse sur la période."],
          },
        ],
      );

      const summaryPdf = await buildSimplePdfAttachment(
        "Synthèse journalière de caisse",
        `${range.start.toISOString().slice(0, 10)} • clôture USD ${closingUsd.toFixed(2)} / CDF ${closingCdf.toFixed(2)}`,
        [
          {
            heading: "Soldes",
            lines: [
              `Ouverture USD: ${formatMoney(opening.usd)}`,
              `Ouverture CDF: ${formatMoneyCdf(opening.cdf)}`,
              `Clôture USD: ${formatMoney(closingUsd)}`,
              `Clôture CDF: ${formatMoneyCdf(closingCdf)}`,
            ],
          },
          {
            heading: "Mouvements du jour",
            lines: [
              `Billets encaissés USD: ${formatMoney(ticketUsd)}`,
              `Billets encaissés CDF: ${formatMoneyCdf(ticketCdf)}`,
              `Autres entrées USD: ${formatMoney(cashInflowUsd)}`,
              `Autres sorties USD: ${formatMoney(cashOutflowUsd)}`,
              `Autres entrées CDF: ${formatMoneyCdf(cashInflowCdf)}`,
              `Autres sorties CDF: ${formatMoneyCdf(cashOutflowCdf)}`,
            ],
          },
        ],
      );

      return [
        { filename: `journal-caisse-${range.start.toISOString().slice(0, 10)}.pdf`, content: journalPdf, contentType: "application/pdf" },
        { filename: `synthese-caisse-${range.start.toISOString().slice(0, 10)}.pdf`, content: summaryPdf, contentType: "application/pdf" },
      ];
    })()
    : undefined;
  const topSellerText = topSellers.length
    ? topSellers.map((seller, index) => `${index + 1}. ${seller.name}: ${seller.tickets} billets / ${formatMoney(seller.amount)}`).join("\n")
    : "Aucun vendeur sur la période.";

  const text = [
    "Bonjour,",
    "",
    `Voici le rapport automatique ${range.label}.`,
    ...(dailyAttachments?.length ? ["", "Pièces jointes du jour:", "- Journal de caisse (PDF)", "- Synthèse de caisse (PDF)"] : []),
    "",
    "Présences:",
    `- Pointages: ${attendance.totalRecords}`,
    `- Présents: ${attendance.presentCount}`,
    `- Retards: ${attendance.lateCount}`,
    `- Heures supp: ${attendance.overtimeTotalMins} min`,
    `- Au bureau: ${attendance.officeSigns}`,
    `- Hors site: ${attendance.offsiteSigns}`,
    "",
    "Ventes:",
    `- Billets vendus: ${tickets.length}`,
    `- Montant ventes: ${formatMoney(totalSalesAmount)}`,
    `- Commission brute: ${formatMoney(totalCommission)}`,
    "",
    "Statut de paiement:",
    `- Payé: ${paidCount} billets / ${formatMoney(paidAmount)}`,
    `- Partiel: ${partialCount} billets / ${formatMoney(partialAmount)}`,
    `- Non payé: ${unpaidCount} billets / ${formatMoney(unpaidAmount)}`,
    "",
    "Analyse IA:",
    `- Score santé opérationnelle: ${ai.score}/100 (Risque ${ai.riskLabel})`,
    `- Taux encaissement estimé: ${ai.collectionRate.toFixed(1)}%`,
    `- Exposition impayés estimée: ${ai.unpaidExposureRate.toFixed(1)}%`,
    ...ai.insights.map((insight, index) => `${index + 1}. [${insight.level}] ${insight.title} — ${insight.detail} Action: ${insight.action}`),
    "",
    "Top vendeurs:",
    topSellerText,
    "",
    "Message automatique THEBEST SARL.",
  ].join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">
      <h2 style="margin:0 0 8px">${subject}</h2>
      <p style="margin:0 0 12px">Période: <strong>${range.start.toISOString().slice(0, 10)}</strong> au <strong>${new Date(range.end.getTime() - 1).toISOString().slice(0, 10)}</strong></p>
      ${dailyAttachments?.length ? '<p style="margin:0 0 12px"><strong>Pièces jointes :</strong> journal de caisse quotidien + synthèse de caisse (PDF).</p>' : ''}
      <h3 style="margin:14px 0 6px">Présences</h3>
      <ul>
        <li>Pointages: <strong>${attendance.totalRecords}</strong></li>
        <li>Présents: <strong>${attendance.presentCount}</strong></li>
        <li>Retards: <strong>${attendance.lateCount}</strong></li>
        <li>Heures supp: <strong>${attendance.overtimeTotalMins} min</strong></li>
        <li>Au bureau: <strong>${attendance.officeSigns}</strong></li>
        <li>Hors site: <strong>${attendance.offsiteSigns}</strong></li>
      </ul>
      <h3 style="margin:14px 0 6px">Ventes</h3>
      <ul>
        <li>Billets vendus: <strong>${tickets.length}</strong></li>
        <li>Montant ventes: <strong>${formatMoney(totalSalesAmount)}</strong></li>
        <li>Commission brute: <strong>${formatMoney(totalCommission)}</strong></li>
      </ul>
      <h3 style="margin:14px 0 6px">Statut de paiement</h3>
      <ul>
        <li>Payé: <strong>${paidCount}</strong> billets / <strong>${formatMoney(paidAmount)}</strong></li>
        <li>Partiel: <strong>${partialCount}</strong> billets / <strong>${formatMoney(partialAmount)}</strong></li>
        <li>Non payé: <strong>${unpaidCount}</strong> billets / <strong>${formatMoney(unpaidAmount)}</strong></li>
      </ul>
      <h3 style="margin:14px 0 6px">Analyse IA</h3>
      <p style="margin:0 0 6px">Score santé opérationnelle: <strong>${ai.score}/100</strong> (Risque <strong>${ai.riskLabel}</strong>)</p>
      <ul>
        <li>Taux encaissement estimé: <strong>${ai.collectionRate.toFixed(1)}%</strong></li>
        <li>Exposition impayés estimée: <strong>${ai.unpaidExposureRate.toFixed(1)}%</strong></li>
      </ul>
      <ol>
        ${ai.insights.map((insight) => `<li><strong>[${insight.level}] ${insight.title}</strong> — ${insight.detail}<br/>Action recommandée: ${insight.action}</li>`).join("")}
      </ol>
      <h3 style="margin:14px 0 6px">Top vendeurs</h3>
      <ol>
        ${topSellers.map((seller) => `<li>${seller.name}: ${seller.tickets} billets / ${formatMoney(seller.amount)}</li>`).join("") || "<li>Aucun vendeur sur la période.</li>"}
      </ol>
      <p style="margin-top:16px;color:#555">Message automatique THEBEST SARL.</p>
    </div>
  `;

  const mailResult = await sendMailBatch({
    recipients,
    subject,
    text,
    html,
    ...(dailyAttachments?.length ? { attachments: dailyAttachments } : {}),
  });

  return NextResponse.json({
    ok: true,
    frequency,
    range,
    attendance,
    sales: {
      ticketsCount: tickets.length,
      totalSalesAmount,
      totalCommission,
      paymentStatus: {
        paid: { count: paidCount, amount: paidAmount },
        partial: { count: partialCount, amount: partialAmount },
        unpaid: { count: unpaidCount, amount: unpaidAmount },
      },
    },
    topSellers,
    ai,
    mail: mailResult,
  });
}
