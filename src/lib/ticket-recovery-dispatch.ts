import { PaymentStatus } from "@prisma/client";
import { PDFDocument } from "pdf-lib";
import { prisma } from "@/lib/prisma";
import { isMailConfigured, sendMailBatch } from "@/lib/mail";
import { buildTicketReceivableBalance, normalizeMoneyCurrency, type TicketReceivableBalance } from "@/lib/ticket-payment-balance";
import {
  THEBEST_PDF_COLORS,
  drawTheBestDocumentFooter,
  loadTheBestDocumentFonts,
  shortPdfLabel,
} from "@/lib/thebest-pdf";

export const TICKET_PAYMENT_SELECT = {
  amount: true,
  currency: true,
  amountUsd: true,
  amountCdf: true,
  fxRateUsdToCdf: true,
} as const;

export type OpenReceivableRow = {
  ticket: {
    id: string;
    ticketNumber: string;
    customerName: string;
    payerName: string | null;
    route: string;
    soldAt: Date;
    amount: number;
    currency: string;
    airline: { code: string; name: string };
  };
  balance: TicketReceivableBalance;
};

export async function fetchOpenReceivableRowsForSoldAtRange(
  start: Date,
  end: Date,
): Promise<OpenReceivableRow[]> {
  const tickets = await prisma.ticketSale.findMany({
    where: { soldAt: { gte: start, lt: end } },
    include: {
      airline: { select: { code: true, name: true } },
      payments: { select: TICKET_PAYMENT_SELECT },
    },
    orderBy: { soldAt: "asc" },
  });

  return tickets
    .map((ticket) => ({
      ticket: {
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        customerName: ticket.customerName,
        payerName: ticket.payerName,
        route: ticket.route,
        soldAt: ticket.soldAt,
        amount: ticket.amount,
        currency: ticket.currency,
        airline: ticket.airline,
      },
      balance: buildTicketReceivableBalance(ticket),
    }))
    .filter(
      ({ balance }) =>
        balance.computedStatus === PaymentStatus.UNPAID || balance.computedStatus === PaymentStatus.PARTIAL,
    );
}

export async function buildRecoveryPdf(params: {
  recipientName: string;
  payerLabel: string;
  periodLabel: string;
  generatedBy: string;
  rows: OpenReceivableRow[];
}) {
  const { recipientName, payerLabel, periodLabel, generatedBy, rows } = params;
  const { textBlack, lineGray } = THEBEST_PDF_COLORS;
  const pdf = await PDFDocument.create();
  const { body: font, bold: fontBold } = await loadTheBestDocumentFonts(pdf);

  const totalUnpaid = rows.filter(({ balance }) => balance.computedStatus === PaymentStatus.UNPAID).length;
  const totalPartial = rows.filter(({ balance }) => balance.computedStatus === PaymentStatus.PARTIAL).length;
  const totalBilledUsd = rows.reduce((sum, { balance }) => sum + balance.amountUsd, 0);
  const totalPaidUsd = rows.reduce((sum, { balance }) => sum + balance.paidAmountUsd, 0);
  const totalRemainingUsd = rows.reduce((sum, { balance }) => sum + balance.remainingUsd, 0);
  const issuedOn = new Date().toLocaleDateString("fr-FR");

  let page = pdf.addPage([842, 595]);
  const pageWidth = 842;

  const drawHeader = (continuation = false) => {
    page.drawText(`THEBEST SARL - Recouvrement billets${continuation ? " (suite)" : ""}`, {
      x: 24,
      y: 566,
      size: 13,
      font: fontBold,
      color: textBlack,
    });
    page.drawText(`${periodLabel} • Payant : ${payerLabel} • Destinataire : ${recipientName}`, {
      x: 24,
      y: 550,
      size: 9,
      font,
      color: textBlack,
    });
    page.drawText(`Émis le ${issuedOn} • Statut calculé depuis les encaissements caisse`, {
      x: 24,
      y: 538,
      size: 8.2,
      font,
      color: textBlack,
    });
    page.drawLine({ start: { x: 24, y: 532 }, end: { x: pageWidth - 24, y: 532 }, thickness: 0.8, color: lineGray });
  };

  const drawSummary = () => {
    page.drawText("Synthèse", { x: 24, y: 518, size: 8.8, font: fontBold, color: textBlack });
    page.drawText(`Billets ouverts : ${rows.length}`, { x: 120, y: 518, size: 8.4, font, color: textBlack });
    page.drawText(`Impayés : ${totalUnpaid} • Partiels : ${totalPartial}`, { x: 280, y: 518, size: 8.4, font, color: textBlack });
    page.drawText(`Facturé : ${totalBilledUsd.toFixed(2)} USD eq.`, { x: 24, y: 505, size: 8.4, font: fontBold, color: textBlack });
    page.drawText(`Encaissé : ${totalPaidUsd.toFixed(2)} USD eq.`, { x: 190, y: 505, size: 8.4, font: fontBold, color: textBlack });
    page.drawText(`Reste : ${totalRemainingUsd.toFixed(2)} USD eq.`, { x: 360, y: 505, size: 8.4, font: fontBold, color: textBlack });
    page.drawLine({ start: { x: 24, y: 451 }, end: { x: pageWidth - 24, y: 451 }, thickness: 0.7, color: lineGray });
  };

  const headers = ["Date", "PNR", "Client", "Compagnie", "Route", "Facturé", "Encaissé", "Reste", "Statut"];
  const x = [24, 92, 158, 248, 308, 408, 488, 568, 648];
  const drawTableHeader = (topY: number) => {
    headers.forEach((header, index) => {
      page.drawText(header, { x: x[index], y: topY, size: 8, font: fontBold, color: textBlack });
    });
    page.drawLine({ start: { x: 24, y: topY - 4 }, end: { x: pageWidth - 24, y: topY - 4 }, thickness: 0.6, color: lineGray });
  };

  drawHeader();
  drawSummary();
  drawTableHeader(436);
  let y = 420;

  for (const { ticket, balance } of rows) {
    if (y < 38) {
      page = pdf.addPage([842, 595]);
      drawHeader(true);
      drawTableHeader(516);
      y = 500;
    }

    const currency = normalizeMoneyCurrency(balance.currency);
    const billedLabel = `${balance.totalTicketAmount.toFixed(2)} ${currency}`;
    const paidLabel = `${balance.paidAmount.toFixed(2)} ${currency}`;
    const remainingLabel = `${balance.remainingAmount.toFixed(2)} ${currency}`;
    const statusLabel =
      balance.computedStatus === PaymentStatus.UNPAID
        ? "NON PAYÉ"
        : balance.computedStatus === PaymentStatus.PARTIAL
          ? "PARTIEL"
          : "PAYÉ";

    const values = [
      new Date(ticket.soldAt).toISOString().slice(0, 10),
      shortPdfLabel(ticket.ticketNumber, 10),
      shortPdfLabel(ticket.customerName, 22),
      ticket.airline.code,
      shortPdfLabel(ticket.route, 14),
      billedLabel,
      paidLabel,
      remainingLabel,
      statusLabel,
    ];

    values.forEach((value, index) => {
      page.drawText(value, { x: x[index], y, size: 7.7, font, color: textBlack });
    });
    page.drawLine({ start: { x: 24, y: y - 3 }, end: { x: pageWidth - 24, y: y - 3 }, thickness: 0.25, color: lineGray });
    y -= 11.5;
  }

  drawTheBestDocumentFooter(pdf, font, generatedBy);
  return Buffer.from(await pdf.save());
}

type RecoveryRecipient = { id: string; name: string; email: string };

export async function dispatchRecoveryToRecipients(params: {
  recipients: RecoveryRecipient[];
  rows: OpenReceivableRow[];
  payerLabel: string;
  periodLabel: string;
  monthKey: string;
  senderName: string;
}) {
  const { recipients, rows, payerLabel, periodLabel, monthKey, senderName } = params;
  if (recipients.length === 0 || rows.length === 0) {
    return { sent: 0, notified: 0, message: "Aucun destinataire ou aucun billet." };
  }

  const scopedUnpaid = rows.filter(({ balance }) => balance.computedStatus === PaymentStatus.UNPAID).length;
  const scopedPartial = rows.filter(({ balance }) => balance.computedStatus === PaymentStatus.PARTIAL).length;
  const scopedRemainingUsd = rows.reduce((sum, { balance }) => sum + balance.remainingUsd, 0);
  const recipientIds = recipients.map((user) => user.id);

  await prisma.userNotification.deleteMany({
    where: {
      userId: { in: recipientIds },
      type: "UNPAID_TICKET_ALERT",
      isRead: false,
    },
  });

  const title = `Recouvrement ${periodLabel} — ${rows.length} billet(s)`;
  const message = [
    `Payant: ${payerLabel}`,
    `Non payes: ${scopedUnpaid} | Partiels: ${scopedPartial}`,
    scopedRemainingUsd > 0 ? `Reste ~ ${scopedRemainingUsd.toFixed(2)} USD (caisse)` : null,
  ]
    .filter(Boolean)
    .join(" — ");

  await prisma.userNotification.createMany({
    data: recipients.map((user) => ({
      userId: user.id,
      title,
      message,
      type: "UNPAID_TICKET_ALERT",
      isRead: false,
      metadata: {
        payerLabel,
        monthKey,
        periodLabel,
        totalCount: rows.length,
        unpaidCount: scopedUnpaid,
        partialCount: scopedPartial,
        totalAmountUsd: scopedRemainingUsd,
        sentBy: senderName,
        sentAt: new Date().toISOString(),
        ticketIds: rows.map(({ ticket }) => ticket.id),
        scope: "kinshasa_team",
      },
    })),
  });

  let mailsSent = 0;
  const appUrl = process.env.NEXTAUTH_URL?.trim() || "";
  const recouvrementUrl = appUrl ? `${appUrl}/recouvrement?month=${monthKey}` : `/recouvrement?month=${monthKey}`;

  if (isMailConfigured()) {
    for (const user of recipients) {
      const ticketLines = rows
        .slice(0, 30)
        .map(({ ticket, balance }, index) => {
          const status = balance.computedStatus === PaymentStatus.UNPAID ? "Non paye" : "Partiel";
          return `${index + 1}. ${ticket.ticketNumber} — ${ticket.customerName} — ${balance.totalTicketAmount.toFixed(2)} ${balance.currency} [${status}]`;
        })
        .join("\n");
      const moreCount = rows.length > 30 ? `\n... et ${rows.length - 30} autre(s).` : "";
      const attachment = await buildRecoveryPdf({
        recipientName: user.name,
        payerLabel,
        periodLabel,
        generatedBy: senderName,
        rows,
      });

      await sendMailBatch({
        recipients: [{ email: user.email, name: user.name }],
        subject: `Recouvrement ${periodLabel} — payant ${payerLabel}`,
        text: [
          `RECOUVREMENT BILLETS — ${periodLabel}`,
          "",
          `Bonjour ${user.name},`,
          `En tant que payant « ${payerLabel} », ${rows.length} billet(s) vendu(s) sur la periode restent ouverts selon les encaissements caisse.`,
          `  - Non payes: ${scopedUnpaid}`,
          `  - Partiels: ${scopedPartial}`,
          scopedRemainingUsd > 0 ? `  - Reste estime: ${scopedRemainingUsd.toFixed(2)} USD eq.` : "",
          "",
          "Le PDF joint reprend le detail (statut calcule depuis les paiements saisis en caisse).",
          "",
          ticketLines,
          moreCount,
          "",
          `Espace recouvrement: ${recouvrementUrl}`,
        ]
          .filter((line) => line !== undefined)
          .join("\n"),
        html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:#1d4ed8;color:white;padding:16px 20px;border-radius:8px 8px 0 0">
    <h2 style="margin:0;font-size:18px">Recouvrement billets</h2>
    <p style="margin:4px 0 0;font-size:13px">${periodLabel} · Payant: ${payerLabel}</p>
  </div>
  <div style="background:#f8fafc;border:1px solid #e2e8f0;padding:20px;border-radius:0 0 8px 8px">
    <p style="margin:0 0 12px">Bonjour <strong>${user.name}</strong>,</p>
    <p style="margin:0 0 12px"><strong>${rows.length} billet(s)</strong> ouverts (calcule caisse).</p>
    <p style="margin:0 0 12px;font-size:13px">Non payes: ${scopedUnpaid} · Partiels: ${scopedPartial}${scopedRemainingUsd > 0 ? ` · Reste ~ ${scopedRemainingUsd.toFixed(2)} USD` : ""}</p>
    <p style="margin:0;font-size:13px">Detail en PDF joint.</p>
    <div style="margin-top:16px;text-align:center">
      <a href="${recouvrementUrl}" style="display:inline-block;background:#1d4ed8;color:white;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:bold">Voir recouvrement</a>
    </div>
    <p style="margin:16px 0 0;font-size:11px;color:#9ca3af;text-align:center">Envoye par ${senderName}</p>
  </div>
</div>`,
        attachments: [
          {
            filename: `recouvrement-${monthKey}-${payerLabel.replace(/\s+/g, "-").slice(0, 40)}.pdf`,
            content: attachment,
            contentType: "application/pdf",
          },
        ],
      });
      mailsSent += 1;
    }
  }

  const parts = [
    `Notification in-app : ${recipients.length}`,
    mailsSent > 0 ? `E-mails : ${mailsSent}` : isMailConfigured() ? null : "E-mail non configuré",
  ].filter(Boolean);

  return {
    sent: recipients.length,
    notified: recipients.length,
    mailsSent,
    message: parts.join(" · "),
  };
}
