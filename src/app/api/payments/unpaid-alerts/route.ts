import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRoles } from "@/lib/rbac";
import { isMailConfigured, sendMailBatch } from "@/lib/mail";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const APRIL_START_2026 = new Date(2026, 3, 1); // April 1, 2026

type UnpaidTicket = Awaited<ReturnType<typeof fetchUnpaidTickets>>[number];

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function remainingUsd(ticket: UnpaidTicket) {
  const paid = ticket.payments.reduce((sum, payment) => {
    return sum + (payment.currency === "USD" ? payment.amount : 0);
  }, 0);
  return ticket.currency === "USD" ? Math.max(ticket.amount - paid, 0) : 0;
}

async function fetchUnpaidTickets() {
  return prisma.ticketSale.findMany({
    where: {
      paymentStatus: { in: ["UNPAID", "PARTIAL"] },
      soldAt: { gte: APRIL_START_2026 },
    },
    include: {
      airline: { select: { code: true, name: true } },
      seller: {
        select: {
          id: true,
          name: true,
          email: true,
          teamId: true,
          team: { select: { id: true, name: true } },
        },
      },
      payments: { select: { amount: true, currency: true } },
    },
    orderBy: { soldAt: "asc" },
  });
}

async function buildRecipientPdf(recipientName: string, tickets: UnpaidTicket[]) {
  const pdfDoc = await PDFDocument.create();
  const normalFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage([595, 842]); // A4 portrait
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

  const totalUnpaid = tickets.filter((ticket) => ticket.paymentStatus === "UNPAID").length;
  const totalPartial = tickets.filter((ticket) => ticket.paymentStatus === "PARTIAL").length;
  const totalRemainingUsd = tickets.reduce((sum, ticket) => sum + remainingUsd(ticket), 0);

  drawLine("THEBEST SARL - Alerte Recouvrement", { bold: true, size: 14 });
  drawLine(`Destinataire: ${recipientName}`, { bold: true, size: 11 });
  drawLine(`Date: ${new Date().toLocaleDateString("fr-FR")}`, { size: 10 });
  drawLine("", { size: 8 });
  drawLine(`Nombre de billets a traiter: ${tickets.length}`, { bold: true });
  drawLine(`Non payes: ${totalUnpaid} | Partiels: ${totalPartial}`);
  if (totalRemainingUsd > 0) {
    drawLine(`Reste estime (USD): ${totalRemainingUsd.toFixed(2)}`);
  }
  drawLine("", { size: 8 });
  drawLine("Details des billets:", { bold: true });
  drawLine("", { size: 8 });

  tickets.forEach((ticket, index) => {
    const statusLabel = ticket.paymentStatus === "UNPAID" ? "Non paye" : "Partiel";
    const soldAt = ticket.soldAt.toLocaleDateString("fr-FR");
    drawWrapped(
      `${index + 1}. ${ticket.ticketNumber} | Client: ${ticket.customerName} | Cie: ${ticket.airline.code} | ${ticket.amount.toFixed(2)} ${ticket.currency} | Statut: ${statusLabel}`,
      { bold: true },
    );
    drawWrapped(`   Vendu le: ${soldAt} | Route: ${ticket.route} | Payant: ${ticket.payerName ?? "N/A"}`);
    const remaining = remainingUsd(ticket);
    if (remaining > 0) {
      drawWrapped(`   Reste estime: ${remaining.toFixed(2)} USD`);
    }
    drawLine("", { size: 8 });
  });

  return Buffer.from(await pdfDoc.save());
}

async function dispatchUnpaidAlerts(senderName: string) {
  const unpaidTickets = await fetchUnpaidTickets();

  if (unpaidTickets.length === 0) {
    return { message: "Aucun billet non payé trouvé depuis avril.", sent: 0, ticketCount: 0 };
  }

  const allUsers = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, teamId: true },
  });

  const usersById = new Map(allUsers.map((user) => [user.id, user]));
  const usersByEmail = new Map<string, typeof allUsers>();
  const usersByName = new Map<string, typeof allUsers>();
  const managersByTeamId = new Map<string, typeof allUsers>();

  for (const user of allUsers) {
    const emailKey = normalize(user.email);
    if (emailKey) {
      usersByEmail.set(emailKey, [...(usersByEmail.get(emailKey) ?? []), user]);
    }

    const nameKey = normalize(user.name);
    if (nameKey) {
      usersByName.set(nameKey, [...(usersByName.get(nameKey) ?? []), user]);
    }

    if (user.role === "MANAGER" && user.teamId) {
      managersByTeamId.set(user.teamId, [...(managersByTeamId.get(user.teamId) ?? []), user]);
    }
  }

  const ticketById = new Map(unpaidTickets.map((ticket) => [ticket.id, ticket]));
  const userTicketIds = new Map<string, Set<string>>();

  const addAssignment = (userId: string, ticketId: string) => {
    if (!usersById.has(userId)) return;
    const assigned = userTicketIds.get(userId) ?? new Set<string>();
    assigned.add(ticketId);
    userTicketIds.set(userId, assigned);
  };

  for (const ticket of unpaidTickets) {
    const payerKey = normalize(ticket.payerName);
    if (payerKey) {
      const payerMatches = [...(usersByEmail.get(payerKey) ?? []), ...(usersByName.get(payerKey) ?? [])];
      for (const payer of payerMatches) {
        addAssignment(payer.id, ticket.id);
      }
    }

    if (ticket.sellerId) {
      addAssignment(ticket.sellerId, ticket.id);
    }

    if (ticket.seller?.teamId) {
      const managers = managersByTeamId.get(ticket.seller.teamId) ?? [];
      for (const manager of managers) {
        addAssignment(manager.id, ticket.id);
      }
    }
  }

  const targetUserIds = Array.from(userTicketIds.keys());
  if (targetUserIds.length === 0) {
    return {
      message: "Aucune cible d'alerte trouvée (payant, vendeur, chef d'équipe).",
      sent: 0,
      ticketCount: unpaidTickets.length,
    };
  }

  // Replace previous unread alerts for all recipients to avoid duplicates.
  await prisma.userNotification.deleteMany({
    where: {
      userId: { in: targetUserIds },
      type: "UNPAID_TICKET_ALERT",
      isRead: false,
    },
  });

  const notificationData = targetUserIds
    .map((userId) => {
      const user = usersById.get(userId);
      const ticketIds = userTicketIds.get(userId);
      if (!user || !ticketIds || ticketIds.size === 0) return null;

      const scopedTickets = Array.from(ticketIds)
        .map((ticketId) => ticketById.get(ticketId))
        .filter((ticket): ticket is UnpaidTicket => Boolean(ticket));

      const scopedUnpaid = scopedTickets.filter((ticket) => ticket.paymentStatus === "UNPAID").length;
      const scopedPartial = scopedTickets.filter((ticket) => ticket.paymentStatus === "PARTIAL").length;
      const scopedRemainingUsd = scopedTickets.reduce((sum, ticket) => sum + remainingUsd(ticket), 0);

      const title = `🚨 URGENT — ${scopedTickets.length} billet${scopedTickets.length > 1 ? "s" : ""} à recouvrer`;
      const message = [
        `Billets concernés: ${scopedTickets.length}`,
        `Non payés: ${scopedUnpaid} | Partiels: ${scopedPartial}`,
        scopedRemainingUsd > 0 ? `Reste à encaisser ≈ ${scopedRemainingUsd.toFixed(2)} USD` : null,
      ]
        .filter(Boolean)
        .join(" — ");

      return {
        userId,
        title,
        message,
        type: "UNPAID_TICKET_ALERT",
        isRead: false,
        metadata: {
          totalCount: scopedTickets.length,
          unpaidCount: scopedUnpaid,
          partialCount: scopedPartial,
          totalAmountUsd: scopedRemainingUsd,
          sentBy: senderName,
          sentAt: new Date().toISOString(),
          since: APRIL_START_2026.toISOString(),
          ticketIds: scopedTickets.map((ticket) => ticket.id),
        },
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  if (notificationData.length > 0) {
    await prisma.userNotification.createMany({ data: notificationData });
  }

  if (isMailConfigured()) {
    try {
      const appUrl = process.env.NEXTAUTH_URL?.trim() || "";
      const ticketsUrl = appUrl ? `${appUrl}/payments` : "/payments";

      for (const userId of targetUserIds) {
        const user = usersById.get(userId);
        const ticketIds = userTicketIds.get(userId);
        if (!user || !ticketIds || ticketIds.size === 0) continue;

        const scopedTickets = Array.from(ticketIds)
          .map((ticketId) => ticketById.get(ticketId))
          .filter((ticket): ticket is UnpaidTicket => Boolean(ticket));

        if (scopedTickets.length === 0) continue;

        const scopedUnpaid = scopedTickets.filter((ticket) => ticket.paymentStatus === "UNPAID").length;
        const scopedPartial = scopedTickets.filter((ticket) => ticket.paymentStatus === "PARTIAL").length;
        const scopedRemainingUsd = scopedTickets.reduce((sum, ticket) => sum + remainingUsd(ticket), 0);

        const ticketLines = scopedTickets
          .slice(0, 30)
          .map((ticket, index) => {
            const status = ticket.paymentStatus === "UNPAID" ? "Non payé" : "Partiel";
            return `${index + 1}. ${ticket.ticketNumber} — ${ticket.customerName} — ${ticket.airline.code} — ${ticket.amount.toFixed(2)} ${ticket.currency} [${status}]`;
          })
          .join("\n");

        const moreCount = scopedTickets.length > 30 ? `\n... et ${scopedTickets.length - 30} autre(s).` : "";
        const attachment = await buildRecipientPdf(user.name, scopedTickets);

        await sendMailBatch({
          recipients: [{ email: user.email, name: user.name }],
          subject: `URGENT — ${scopedTickets.length} billet(s) non payé(s) vous concernant`,
          text: [
            `ALERTE RECOUVREMENT — ${new Date().toLocaleDateString("fr-FR")}`,
            "",
            `Bonjour ${user.name},`,
            `${scopedTickets.length} billet(s) non payé(s) vous sont assignés pour suivi:`,
            `  - Non payés: ${scopedUnpaid}`,
            `  - Partiels: ${scopedPartial}`,
            scopedRemainingUsd > 0 ? `  - Reste estimé: ${scopedRemainingUsd.toFixed(2)} USD` : "",
            "",
            "Le fichier PDF joint contient le détail complet.",
            "",
            `Détail (30 premiers):`,
            ticketLines,
            moreCount,
            "",
            `Accéder à la page paiements: ${ticketsUrl}`,
          ]
            .filter((line) => line !== undefined)
            .join("\n"),
          html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:#dc2626;color:white;padding:16px 20px;border-radius:8px 8px 0 0">
    <h2 style="margin:0;font-size:18px">🚨 URGENT — Recouvrement billets</h2>
    <p style="margin:4px 0 0;font-size:13px;opacity:0.9">${new Date().toLocaleDateString("fr-FR", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
  </div>
  <div style="background:#fff5f5;border:1px solid #fecaca;padding:20px;border-radius:0 0 8px 8px">
    <p style="margin:0 0 12px;font-size:15px">Bonjour <strong>${user.name}</strong>,</p>
    <p style="margin:0 0 12px;font-size:15px"><strong>${scopedTickets.length} billet(s)</strong> non payé(s) vous concernent.</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr style="background:#fee2e2">
        <td style="padding:6px 10px;font-weight:bold">Non payés</td>
        <td style="padding:6px 10px;color:#dc2626;font-weight:bold">${scopedUnpaid}</td>
      </tr>
      <tr style="background:#fff">
        <td style="padding:6px 10px;font-weight:bold">Partiels</td>
        <td style="padding:6px 10px;color:#ea580c;font-weight:bold">${scopedPartial}</td>
      </tr>
      ${scopedRemainingUsd > 0 ? `<tr style="background:#fee2e2"><td style="padding:6px 10px;font-weight:bold">Reste estimé</td><td style="padding:6px 10px;color:#dc2626;font-weight:bold">${scopedRemainingUsd.toFixed(2)} USD</td></tr>` : ""}
    </table>
    <p style="margin:12px 0 0;font-size:13px">Le détail complet est joint en PDF.</p>
    <div style="margin-top:16px;text-align:center">
      <a href="${ticketsUrl}" style="display:inline-block;background:#dc2626;color:white;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:14px">Voir les paiements</a>
    </div>
    <p style="margin:16px 0 0;font-size:11px;color:#9ca3af;text-align:center">Alerte envoyée par ${senderName} · The Best SARL</p>
  </div>
</div>`,
          attachments: [
            {
              filename: `alerte-billets-non-payes-${new Date().toISOString().slice(0, 10)}.pdf`,
              content: attachment,
              contentType: "application/pdf",
            },
          ],
        });
      }
    } catch {
      // Mail failure doesn't block app notifications.
    }
  }

  return {
    message: `Alertes envoyées à ${targetUserIds.length} utilisateur(s).`,
    sent: targetUserIds.length,
    ticketCount: unpaidTickets.length,
  };
}

export async function POST(_req: NextRequest) {
  const access = await requireApiRoles(["ADMIN", "DIRECTEUR_GENERAL"]);
  if (access.error) return access.error;

  const result = await dispatchUnpaidAlerts(access.session.user.name ?? "Admin");
  return NextResponse.json(result);
}

// Cron-safe endpoint: GET for automated daily alerts (no auth required when called by Vercel Cron)
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await dispatchUnpaidAlerts("cron");
  return NextResponse.json(result);
}
