import { PaymentStatus, PrismaClient } from "@prisma/client";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { sendMailBatch, isMailConfigured } from "@/lib/mail";

const prisma = new PrismaClient();
const MONTH_START = new Date(Date.UTC(2026, 3, 1, 0, 0, 0, 0));
const SYSTEM_EMAIL = (process.env.REPORTS_TO_EMAIL ?? process.env.MAIL_FROM_EMAIL ?? "").trim();

type TicketRow = Awaited<ReturnType<typeof fetchUnpaidTickets>>[number];

type DigestGroup = {
  monthKey: string;
  monthLabel: string;
  teamKey: string;
  teamName: string;
  tickets: TicketRow[];
};

function normalize(value: string | null | undefined) {
  return (value ?? "").trim();
}

function monthKeyFromDate(date: Date) {
  return date.toISOString().slice(0, 7);
}

function monthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map((part) => Number.parseInt(part, 10));
  const date = new Date(Date.UTC(year, month - 1, 1));
  return date.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

function teamKeyFromTicket(ticket: TicketRow) {
  return ticket.seller?.teamId ?? `NO_TEAM:${ticket.seller?.team?.name ?? "Sans équipe"}`;
}

function teamNameFromTicket(ticket: TicketRow) {
  return ticket.seller?.team?.name ?? "Sans équipe";
}

async function fetchUnpaidTickets() {
  return prisma.ticketSale.findMany({
    where: {
      paymentStatus: { in: [PaymentStatus.UNPAID, PaymentStatus.PARTIAL] },
      soldAt: { gte: MONTH_START },
    },
    select: {
      id: true,
      ticketNumber: true,
      customerName: true,
      route: true,
      soldAt: true,
      amount: true,
      currency: true,
      paymentStatus: true,
      payerName: true,
      sellerName: true,
      seller: {
        select: {
          id: true,
          name: true,
          email: true,
          teamId: true,
          team: { select: { id: true, name: true } },
        },
      },
      airline: { select: { code: true, name: true } },
      payments: { select: { amount: true, currency: true } },
    },
    orderBy: [{ soldAt: "asc" }, { ticketNumber: "asc" }],
  });
}

function remainingAmountUsd(ticket: TicketRow) {
  const paidUsd = ticket.payments.reduce((sum, payment) => {
    if (payment.currency !== "USD") return sum;
    return sum + payment.amount;
  }, 0);
  return ticket.currency === "USD" ? Math.max(ticket.amount - paidUsd, 0) : 0;
}

function groupTickets(tickets: TicketRow[]) {
  const groups = new Map<string, DigestGroup>();

  for (const ticket of tickets) {
    const monthKey = monthKeyFromDate(ticket.soldAt);
    const teamKey = teamKeyFromTicket(ticket);
    const key = `${monthKey}::${teamKey}`;
    const existing = groups.get(key);
    if (existing) {
      existing.tickets.push(ticket);
      continue;
    }

    groups.set(key, {
      monthKey,
      monthLabel: monthLabel(monthKey),
      teamKey,
      teamName: teamNameFromTicket(ticket),
      tickets: [ticket],
    });
  }

  return Array.from(groups.values()).sort((left, right) => {
    const monthCompare = left.monthKey.localeCompare(right.monthKey);
    if (monthCompare !== 0) return monthCompare;
    return left.teamName.localeCompare(right.teamName, "fr");
  });
}

async function buildMonthlyPdf(group: DigestGroup) {
  const pdf = await PDFDocument.create();
  const normalFont = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595, 842]);
  const left = 40;
  let y = 810;
  const lineHeight = 13;
  const maxChars = 96;

  const drawLine = (text: string, options?: { bold?: boolean; size?: number }) => {
    if (y < 60) {
      return;
    }
    page.drawText(text, {
      x: left,
      y,
      size: options?.size ?? 9,
      font: options?.bold ? boldFont : normalFont,
      color: rgb(0, 0, 0),
    });
    y -= lineHeight;
  };

  const drawWrapped = (text: string, options?: { bold?: boolean; size?: number }) => {
    if (text.length <= maxChars) {
      drawLine(text, options);
      return;
    }

    let remaining = text;
    while (remaining.length > 0 && y > 60) {
      const chunk = remaining.slice(0, maxChars);
      if (remaining.length <= maxChars) {
        drawLine(remaining, options);
        break;
      }
      const lastSpace = chunk.lastIndexOf(" ");
      const line = lastSpace > 18 ? chunk.slice(0, lastSpace) : chunk;
      drawLine(line, options);
      remaining = remaining.slice(line.length).trimStart();
    }
  };

  const unpaidCount = group.tickets.filter((ticket) => ticket.paymentStatus === PaymentStatus.UNPAID).length;
  const partialCount = group.tickets.filter((ticket) => ticket.paymentStatus === PaymentStatus.PARTIAL).length;
  const totalRemainingUsd = group.tickets.reduce((sum, ticket) => sum + remainingAmountUsd(ticket), 0);

  drawLine("THEBEST SARL - Suivi mensuel des billets non payés", { bold: true, size: 14 });
  drawLine(`Mois: ${group.monthLabel}`, { bold: true, size: 11 });
  drawLine(`Équipe: ${group.teamName}`, { bold: true, size: 11 });
  drawLine(`Date d'émission: ${new Date().toLocaleDateString("fr-FR")}`);
  drawLine(`Nombre de billets: ${group.tickets.length}`);
  drawLine(`Non payés: ${unpaidCount} | Partiels: ${partialCount}`);
  if (totalRemainingUsd > 0) {
    drawLine(`Reste estimé (USD): ${totalRemainingUsd.toFixed(2)}`);
  }
  drawLine("", { size: 8 });
  drawLine("Détail des billets:", { bold: true });
  drawLine("", { size: 8 });

  for (const [index, ticket] of group.tickets.entries()) {
    const statusLabel = ticket.paymentStatus === PaymentStatus.UNPAID ? "Non payé" : "Partiel";
    drawWrapped(
      `${index + 1}. ${ticket.ticketNumber} | Client: ${ticket.customerName} | Route: ${ticket.route} | ${ticket.amount.toFixed(2)} ${ticket.currency} | Statut: ${statusLabel}`,
      { bold: true },
    );
    drawWrapped(`   Payant: ${normalize(ticket.payerName) || normalize(ticket.seller?.name) || "N/A"}`);
    drawWrapped(`   Vendeur: ${normalize(ticket.sellerName) || normalize(ticket.seller?.name) || "N/A"}`);
    drawWrapped(`   Équipe: ${ticket.seller?.team?.name ?? "Sans équipe"}`);
    drawWrapped(`   Compagnie: ${ticket.airline.code}`);
    const remaining = remainingAmountUsd(ticket);
    if (remaining > 0) {
      drawWrapped(`   Reste estimé: ${remaining.toFixed(2)} USD`);
    }
    drawLine("", { size: 8 });
  }

  return Buffer.from(await pdf.save());
}

async function sendDigest() {
  if (!isMailConfigured()) {
    throw new Error("SMTP non configuré.");
  }

  if (!SYSTEM_EMAIL) {
    throw new Error("REPORTS_TO_EMAIL ou MAIL_FROM_EMAIL doit être défini.");
  }

  const tickets = await fetchUnpaidTickets();
  if (tickets.length === 0) {
    return { sent: 0, skipped: 0, groups: 0, message: "Aucun billet non payé depuis avril." };
  }

  const groups = groupTickets(tickets);
  const summary: Array<{ monthKey: string; teamName: string; sent: boolean }> = [];

  for (const group of groups) {
    const dispatchKey = `${group.monthKey}:${group.teamKey}`;
    const existing = await prisma.unpaidMonthlyDigestDispatch.findUnique({
      where: {
        monthKey_teamKey_recipientEmail: {
          monthKey: group.monthKey,
          teamKey: group.teamKey,
          recipientEmail: SYSTEM_EMAIL,
        },
      },
    });

    if (existing) {
      summary.push({ monthKey: group.monthKey, teamName: group.teamName, sent: false });
      continue;
    }

    const attachment = await buildMonthlyPdf(group);
    const unpaidCount = group.tickets.filter((ticket) => ticket.paymentStatus === PaymentStatus.UNPAID).length;
    const partialCount = group.tickets.filter((ticket) => ticket.paymentStatus === PaymentStatus.PARTIAL).length;
    const totalRemainingUsd = group.tickets.reduce((sum, ticket) => sum + remainingAmountUsd(ticket), 0);

    const subject = `THEBEST SARL - Impayés ${group.monthLabel} - ${group.teamName}`;
    const text = [
      `Rapport mensuel des billets non payés`,
      `Mois: ${group.monthLabel}`,
      `Équipe: ${group.teamName}`,
      `Billets concernés: ${group.tickets.length}`,
      `Non payés: ${unpaidCount}`,
      `Partiels: ${partialCount}`,
      totalRemainingUsd > 0 ? `Reste estimé: ${totalRemainingUsd.toFixed(2)} USD` : null,
      "",
      "Le fichier PDF détaillé est joint.",
      "",
      "Détail des personnes/équipes payantes figure dans le PDF joint.",
    ].filter((line): line is string => Boolean(line)).join("\n");

    const delivery = await sendMailBatch({
      recipients: [{ email: SYSTEM_EMAIL, name: "Système THEBEST SARL" }],
      subject,
      text,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto">
          <h2 style="color:#111827;margin-bottom:8px">THEBEST SARL - Impayés ${group.monthLabel}</h2>
          <p><strong>Équipe:</strong> ${group.teamName}</p>
          <p><strong>Billets concernés:</strong> ${group.tickets.length}</p>
          <p><strong>Non payés:</strong> ${unpaidCount} | <strong>Partiels:</strong> ${partialCount}</p>
          ${totalRemainingUsd > 0 ? `<p><strong>Reste estimé:</strong> ${totalRemainingUsd.toFixed(2)} USD</p>` : ""}
          <p>Le PDF détaillé est joint à ce message.</p>
        </div>
      `,
      attachments: [{
        filename: `impayes-${group.monthKey}-${group.teamName.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "equipe"}.pdf`,
        content: attachment,
        contentType: "application/pdf",
      }],
    });

    if (delivery.sent.length > 0) {
      await prisma.unpaidMonthlyDigestDispatch.create({
        data: {
          monthKey: group.monthKey,
          teamKey: group.teamKey,
          teamName: group.teamName,
          recipientEmail: SYSTEM_EMAIL,
          ticketCount: group.tickets.length,
          unpaidCount,
          partialCount,
          sentAt: new Date(),
        },
      });
    }

    summary.push({ monthKey: group.monthKey, teamName: group.teamName, sent: delivery.sent.length > 0 });
  }

  return {
    sent: summary.filter((item) => item.sent).length,
    skipped: summary.filter((item) => !item.sent).length,
    groups: summary.length,
    message: `Digest traité pour ${summary.length} groupe(s).`,
    summary,
  };
}

async function main() {
  const result = await sendDigest();
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
