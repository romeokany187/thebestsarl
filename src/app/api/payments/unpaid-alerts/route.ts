import { NextRequest, NextResponse } from "next/server";
import { PaymentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireApiRoles } from "@/lib/rbac";
import { isMailConfigured, sendMailBatch } from "@/lib/mail";
import { buildTicketReceivableBalance } from "@/lib/ticket-payment-balance";
import { loadPayerRecoveryTargetUsers, matchPayerToWorkspaceUsers } from "@/lib/ticket-payer-recovery-targets";
import { buildRecoveryPdf, type OpenReceivableRow as RecoveryPdfRow } from "@/lib/ticket-recovery-dispatch";

const APRIL_START_2026 = new Date(2026, 3, 1); // April 1, 2026

const TICKET_PAYMENT_SELECT = {
  amount: true,
  currency: true,
  amountUsd: true,
  amountCdf: true,
  fxRateUsdToCdf: true,
} as const;

type OpenReceivableRow = Awaited<ReturnType<typeof fetchOpenReceivableTickets>>[number];

/** Billets impayés / partiels selon les encaissements caisse uniquement. */
async function fetchOpenReceivableTickets() {
  const tickets = await prisma.ticketSale.findMany({
    where: { soldAt: { gte: APRIL_START_2026 } },
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
      payments: { select: TICKET_PAYMENT_SELECT },
    },
    orderBy: { soldAt: "asc" },
  });

  return tickets
    .map((ticket) => ({
      ticket,
      balance: buildTicketReceivableBalance(ticket),
    }))
    .filter(
      ({ balance }) =>
        balance.computedStatus === PaymentStatus.UNPAID || balance.computedStatus === PaymentStatus.PARTIAL,
    );
}

function toRecoveryPdfRows(rows: OpenReceivableRow[]): RecoveryPdfRow[] {
  return rows.map(({ ticket, balance }) => ({
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
    balance,
  }));
}

async function dispatchUnpaidAlerts(senderName: string) {
  const openRows = await fetchOpenReceivableTickets();

  if (openRows.length === 0) {
    return { message: "Aucune créance ouverte depuis avril (selon paiements caisse).", sent: 0, ticketCount: 0 };
  }

  const workspaceUsers = await loadPayerRecoveryTargetUsers();
  const usersById = new Map(workspaceUsers.map((user) => [user.id, user]));

  const rowByTicketId = new Map(openRows.map((row) => [row.ticket.id, row]));
  const userTicketIds = new Map<string, Set<string>>();

  const addAssignment = (userId: string, ticketId: string) => {
    if (!usersById.has(userId)) return;
    const assigned = userTicketIds.get(userId) ?? new Set<string>();
    assigned.add(ticketId);
    userTicketIds.set(userId, assigned);
  };

  for (const { ticket } of openRows) {
    const payerLabel = ticket.payerName?.trim() ?? "";
    if (!payerLabel) continue;
    const payerMatches = matchPayerToWorkspaceUsers(payerLabel, workspaceUsers);
    for (const payer of payerMatches) {
      addAssignment(payer.id, ticket.id);
    }
  }

  const targetUserIds = Array.from(userTicketIds.keys());
  if (targetUserIds.length === 0) {
    return {
      message: "Aucun utilisateur ne correspond au payant renseigné sur les créances ouvertes.",
      sent: 0,
      ticketCount: openRows.length,
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

      const scopedRows = Array.from(ticketIds)
        .map((ticketId) => rowByTicketId.get(ticketId))
        .filter((row): row is OpenReceivableRow => Boolean(row));

      const scopedUnpaid = scopedRows.filter(({ balance }) => balance.computedStatus === PaymentStatus.UNPAID).length;
      const scopedPartial = scopedRows.filter(({ balance }) => balance.computedStatus === PaymentStatus.PARTIAL).length;
      const scopedRemainingUsd = scopedRows.reduce((sum, { balance }) => sum + balance.remainingUsd, 0);

      const title = `Recouvrement — ${scopedRows.length} billet${scopedRows.length > 1 ? "s" : ""} (payant)`;
      const message = [
        `Billets concernés: ${scopedRows.length}`,
        `Non payés: ${scopedUnpaid} | Partiels: ${scopedPartial}`,
        scopedRemainingUsd > 0 ? `Reste à encaisser ≈ ${scopedRemainingUsd.toFixed(2)} USD (caisse)` : null,
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
          totalCount: scopedRows.length,
          unpaidCount: scopedUnpaid,
          partialCount: scopedPartial,
          totalAmountUsd: scopedRemainingUsd,
          sentBy: senderName,
          sentAt: new Date().toISOString(),
          since: APRIL_START_2026.toISOString(),
          ticketIds: scopedRows.map(({ ticket }) => ticket.id),
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

        const scopedRows = Array.from(ticketIds)
          .map((ticketId) => rowByTicketId.get(ticketId))
          .filter((row): row is OpenReceivableRow => Boolean(row));

        if (scopedRows.length === 0) continue;

        const scopedUnpaid = scopedRows.filter(({ balance }) => balance.computedStatus === PaymentStatus.UNPAID).length;
        const scopedPartial = scopedRows.filter(({ balance }) => balance.computedStatus === PaymentStatus.PARTIAL).length;
        const scopedRemainingUsd = scopedRows.reduce((sum, { balance }) => sum + balance.remainingUsd, 0);

        const ticketLines = scopedRows
          .slice(0, 30)
          .map(({ ticket, balance }, index) => {
            const status = balance.computedStatus === PaymentStatus.UNPAID ? "Non payé" : "Partiel";
            return `${index + 1}. ${ticket.ticketNumber} — ${ticket.customerName} — ${ticket.airline.code} — ${balance.totalTicketAmount.toFixed(2)} ${balance.currency} [${status}]`;
          })
          .join("\n");

        const moreCount = scopedRows.length > 30 ? `\n... et ${scopedRows.length - 30} autre(s).` : "";
        const payerLabel = scopedRows[0]?.ticket.payerName?.trim() || user.name;
        const attachment = await buildRecoveryPdf({
          recipientName: user.name,
          payerLabel,
          periodLabel: "Depuis avril 2026",
          generatedBy: senderName,
          rows: toRecoveryPdfRows(scopedRows),
        });

        await sendMailBatch({
          recipients: [{ email: user.email, name: user.name }],
          subject: `Recouvrement — ${scopedRows.length} billet(s) au nom payant`,
          text: [
            `RECOUVREMENT BILLETS (encaissements caisse) — ${new Date().toLocaleDateString("fr-FR")}`,
            "",
            `Bonjour ${user.name},`,
            `${scopedRows.length} billet(s) ouverts vous sont rattachés en tant que payant:`,
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
  <div style="background:#1d4ed8;color:white;padding:16px 20px;border-radius:8px 8px 0 0">
    <h2 style="margin:0;font-size:18px">Recouvrement billets (caisse)</h2>
    <p style="margin:4px 0 0;font-size:13px;opacity:0.9">${new Date().toLocaleDateString("fr-FR", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
  </div>
  <div style="background:#f8fafc;border:1px solid #e2e8f0;padding:20px;border-radius:0 0 8px 8px">
    <p style="margin:0 0 12px;font-size:15px">Bonjour <strong>${user.name}</strong>,</p>
    <p style="margin:0 0 12px;font-size:15px"><strong>${scopedRows.length} billet(s)</strong> restent ouverts (statut calculé depuis la caisse).</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr style="background:#e2e8f0">
        <td style="padding:6px 10px;font-weight:bold">Non payés</td>
        <td style="padding:6px 10px;font-weight:bold">${scopedUnpaid}</td>
      </tr>
      <tr style="background:#fff">
        <td style="padding:6px 10px;font-weight:bold">Partiels</td>
        <td style="padding:6px 10px;font-weight:bold">${scopedPartial}</td>
      </tr>
      ${scopedRemainingUsd > 0 ? `<tr style="background:#e2e8f0"><td style="padding:6px 10px;font-weight:bold">Reste estimé</td><td style="padding:6px 10px;font-weight:bold">${scopedRemainingUsd.toFixed(2)} USD eq.</td></tr>` : ""}
    </table>
    <p style="margin:12px 0 0;font-size:13px">Le détail complet est joint en PDF.</p>
    <div style="margin-top:16px;text-align:center">
      <a href="${ticketsUrl}" style="display:inline-block;background:#1d4ed8;color:white;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:14px">Voir les paiements</a>
    </div>
    <p style="margin:16px 0 0;font-size:11px;color:#9ca3af;text-align:center">Envoyé par ${senderName} · The Best SARL</p>
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
    ticketCount: openRows.length,
  };
}

export async function POST(_req: NextRequest) {
  const access = await requireApiRoles(["ADMIN", "DIRECTEUR_GENERAL", "ACCOUNTANT"]);
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
