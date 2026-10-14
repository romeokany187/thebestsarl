import { PaymentStatus } from "@prisma/client";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { prisma } from "@/lib/prisma";
import { isMailConfigured, sendMailBatch } from "@/lib/mail";
import { buildTicketReceivableBalance, type TicketReceivableBalance } from "@/lib/ticket-payment-balance";

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
  rows: OpenReceivableRow[];
}) {
  const { recipientName, payerLabel, periodLabel, rows } = params;
  const pdfDoc = await PDFDocument.create();
  const normalFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage([595, 842]);
  let y = 810;
  const left = 40;
  const lineHeight = 14;
  const maxChars = 95;

  const drawLine = (
    text: string,
    options?: { bold?: boolean; size?: number; color?: { r: number; g: number; b: number } },
  ) => {
    if (y < 60) {
      page = pdfDoc.addPage([595, 842]);
      y = 810;
    }
    page.drawText(text, {
      x: left,
      y,
      size: options?.size ?? 10,
      font: options?.bold ? boldFont : normalFont,
      color: options?.color ? rgb(options.color.r, options.color.g, options.color.b) : rgb(0, 0, 0),
    });
    y -= lineHeight;
  };

  const drawWrapped = (text: string, options?: { bold?: boolean; size?: number }) => {
    if (text.length <= maxChars) {
      drawLine(text, options);
      return;
    }

    let remaining = text;
    while (remaining.length > 0) {
      const chunk = remaining.slice(0, maxChars);
      if (remaining.length <= maxChars) {
        drawLine(remaining, options);
        break;
      }
      const lastSpace = chunk.lastIndexOf(" ");
      const line = lastSpace > 20 ? chunk.slice(0, lastSpace) : chunk;
      drawLine(line, options);
      remaining = remaining.slice(line.length).trimStart();
    }
  };

  const totalUnpaid = rows.filter(({ balance }) => balance.computedStatus === PaymentStatus.UNPAID).length;
  const totalPartial = rows.filter(({ balance }) => balance.computedStatus === PaymentStatus.PARTIAL).length;
  const totalRemainingUsd = rows.reduce((sum, { balance }) => sum + balance.remainingUsd, 0);

  drawLine("THEBEST SARL - Recouvrement billets", { bold: true, size: 14 });
  drawLine(`Destinataire: ${recipientName}`, { bold: true, size: 11 });
  drawLine(`Payant: ${payerLabel}`, { bold: true, size: 11 });
  drawLine(`Periode: ${periodLabel}`, { size: 10 });
  drawLine(`Date: ${new Date().toLocaleDateString("fr-FR")}`, { size: 10 });
  drawLine("Statut calcule depuis les encaissements caisse (Payment).", { size: 9 });
  drawLine("", { size: 8 });
  drawLine(`Nombre de billets: ${rows.length}`, { bold: true });
  drawLine(`Non payes: ${totalUnpaid} | Partiels: ${totalPartial}`);
  if (totalRemainingUsd > 0) {
    drawLine(`Reste estime (USD eq.): ${totalRemainingUsd.toFixed(2)}`);
  }
  drawLine("", { size: 8 });
  drawLine("Details des billets:", { bold: true });
  drawLine("", { size: 8 });

  rows.forEach(({ ticket, balance }, index) => {
    const statusLabel = balance.computedStatus === PaymentStatus.UNPAID ? "Non paye" : "Partiel";
    const soldAt = ticket.soldAt.toLocaleDateString("fr-FR");
    drawWrapped(
      `${index + 1}. ${ticket.ticketNumber} | Client: ${ticket.customerName} | Cie: ${ticket.airline.code} | ${balance.totalTicketAmount.toFixed(2)} ${balance.currency} | ${statusLabel}`,
      { bold: true },
    );
    drawWrapped(`   Vendu le: ${soldAt} | Route: ${ticket.route}`);
    if (balance.remainingUsd > 0) {
      drawWrapped(`   Reste: ${balance.remainingAmount.toFixed(2)} ${balance.currency} (~ ${balance.remainingUsd.toFixed(2)} USD)`);
    }
    drawLine("", { size: 8 });
  });

  return Buffer.from(await pdfDoc.save());
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
  if (isMailConfigured()) {
    const appUrl = process.env.NEXTAUTH_URL?.trim() || "";
    const recouvrementUrl = appUrl ? `${appUrl}/recouvrement?month=${monthKey}` : `/recouvrement?month=${monthKey}`;

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

  return {
    sent: recipients.length,
    notified: recipients.length,
    mailsSent,
    message: `Recouvrement envoye a ${recipients.length} utilisateur(s) Kinshasa.`,
  };
}
