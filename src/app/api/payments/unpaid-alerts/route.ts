import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRoles } from "@/lib/rbac";
import { isMailConfigured, sendMailBatch } from "@/lib/mail";

export async function POST(_req: NextRequest) {
  const access = await requireApiRoles(["ADMIN", "DIRECTEUR_GENERAL"]);
  if (access.error) return access.error;

  // Query all unpaid/partial tickets
  const unpaidTickets = await prisma.ticketSale.findMany({
    where: {
      paymentStatus: { in: ["UNPAID", "PARTIAL"] },
    },
    include: {
      airline: { select: { code: true, name: true } },
      payments: { select: { amount: true, currency: true } },
    },
    orderBy: { soldAt: "asc" },
  });

  if (unpaidTickets.length === 0) {
    return NextResponse.json({ message: "Aucun billet non payé trouvé.", sent: 0 });
  }

  // Compute summary
  const totalUnpaid = unpaidTickets.filter((t) => t.paymentStatus === "UNPAID").length;
  const totalPartial = unpaidTickets.filter((t) => t.paymentStatus === "PARTIAL").length;
  const totalAmountUsd = unpaidTickets.reduce((sum, t) => {
    const paid = t.payments.reduce((s, p) => s + (p.currency === "USD" ? p.amount : 0), 0);
    return sum + (t.currency === "USD" ? t.amount - paid : 0);
  }, 0);

  // Find target users: accountants + cashiers
  const targetUsers = await prisma.user.findMany({
    where: {
      OR: [
        { role: "ACCOUNTANT" },
        { jobTitle: "COMPTABLE" },
        { jobTitle: "CAISSIER" },
        { jobTitle: "CAISSE_2_SIEGE" },
        { jobTitle: "CAISSE_AGENCE" },
      ],
    },
    select: { id: true, name: true, email: true, role: true, jobTitle: true },
  });

  if (targetUsers.length === 0) {
    return NextResponse.json({ message: "Aucun comptable/caissier trouvé.", sent: 0 });
  }

  const title = `🚨 URGENT — ${unpaidTickets.length} billet${unpaidTickets.length > 1 ? "s" : ""} non payé${unpaidTickets.length > 1 ? "s" : ""}`;
  const message = [
    `Non payés: ${totalUnpaid} | Partiels: ${totalPartial}`,
    totalAmountUsd > 0 ? `Reste à encaisser ≈ ${totalAmountUsd.toFixed(2)} USD` : null,
    `Veuillez procéder au recouvrement immédiatement.`,
  ]
    .filter(Boolean)
    .join(" — ");

  // Delete previous unread unpaid-ticket alerts for these users to avoid pile-up of duplicates
  await prisma.userNotification.deleteMany({
    where: {
      userId: { in: targetUsers.map((u) => u.id) },
      type: "UNPAID_TICKET_ALERT",
      isRead: false,
    },
  });

  // Create fresh notifications
  await prisma.userNotification.createMany({
    data: targetUsers.map((user) => ({
      userId: user.id,
      title,
      message,
      type: "UNPAID_TICKET_ALERT",
      isRead: false,
      metadata: {
        totalCount: unpaidTickets.length,
        unpaidCount: totalUnpaid,
        partialCount: totalPartial,
        totalAmountUsd,
        sentBy: access.session.user.name ?? "Admin",
        sentAt: new Date().toISOString(),
      },
    })),
  });

  // Send email alerts if mail is configured
  if (isMailConfigured()) {
    try {
      const appUrl = process.env.NEXTAUTH_URL?.trim() || "";
      const ticketsUrl = appUrl ? `${appUrl}/payments` : "/payments";

      const ticketLines = unpaidTickets
        .slice(0, 20)
        .map(
          (t, i) =>
            `${i + 1}. ${t.ticketNumber} — ${t.customerName} — ${t.airline.code} — ${t.amount.toFixed(2)} ${t.currency} [${t.paymentStatus === "UNPAID" ? "Non payé" : "Partiel"}]`,
        )
        .join("\n");

      const moreCount = unpaidTickets.length > 20 ? `\n... et ${unpaidTickets.length - 20} autre(s).` : "";

      await sendMailBatch({
        recipients: targetUsers.map((u) => ({ email: u.email, name: u.name })),
        subject: `URGENT — ${unpaidTickets.length} billet(s) non payé(s) à recouvrer`,
        text: [
          `ALERTE RECOUVREMENT — ${new Date().toLocaleDateString("fr-FR")}`,
          ``,
          `${unpaidTickets.length} billet(s) nécessitent un recouvrement urgent:`,
          `  - Non payés: ${totalUnpaid}`,
          `  - Partiels: ${totalPartial}`,
          totalAmountUsd > 0 ? `  - Reste estimé: ${totalAmountUsd.toFixed(2)} USD` : "",
          ``,
          `Détail (20 premiers):`,
          ticketLines,
          moreCount,
          ``,
          `Accéder à la page paiements: ${ticketsUrl}`,
        ]
          .filter((l) => l !== undefined)
          .join("\n"),
        html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:#dc2626;color:white;padding:16px 20px;border-radius:8px 8px 0 0">
    <h2 style="margin:0;font-size:18px">🚨 URGENT — Recouvrement billets</h2>
    <p style="margin:4px 0 0;font-size:13px;opacity:0.9">${new Date().toLocaleDateString("fr-FR", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
  </div>
  <div style="background:#fff5f5;border:1px solid #fecaca;padding:20px;border-radius:0 0 8px 8px">
    <p style="margin:0 0 12px;font-size:15px"><strong>${unpaidTickets.length} billet(s)</strong> nécessitent un recouvrement immédiat.</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr style="background:#fee2e2">
        <td style="padding:6px 10px;font-weight:bold">Non payés</td>
        <td style="padding:6px 10px;color:#dc2626;font-weight:bold">${totalUnpaid}</td>
      </tr>
      <tr style="background:#fff">
        <td style="padding:6px 10px;font-weight:bold">Partiels</td>
        <td style="padding:6px 10px;color:#ea580c;font-weight:bold">${totalPartial}</td>
      </tr>
      ${totalAmountUsd > 0 ? `<tr style="background:#fee2e2"><td style="padding:6px 10px;font-weight:bold">Reste estimé</td><td style="padding:6px 10px;color:#dc2626;font-weight:bold">${totalAmountUsd.toFixed(2)} USD</td></tr>` : ""}
    </table>
    <div style="margin-top:16px;background:#fff;border:1px solid #fca5a5;border-radius:6px;padding:12px">
      <p style="margin:0 0 8px;font-weight:bold;font-size:13px">Premiers billets :</p>
      <pre style="margin:0;font-size:12px;white-space:pre-wrap;color:#374151">${ticketLines}${moreCount}</pre>
    </div>
    <div style="margin-top:16px;text-align:center">
      <a href="${ticketsUrl}" style="display:inline-block;background:#dc2626;color:white;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:14px">Voir les paiements</a>
    </div>
    <p style="margin:16px 0 0;font-size:11px;color:#9ca3af;text-align:center">Alerte envoyée par ${access.session.user.name ?? "Admin"} · The Best SARL</p>
  </div>
</div>`,
      });
    } catch {
      // Mail failure doesn't block the notification
    }
  }

  return NextResponse.json({
    message: `Alertes envoyées à ${targetUsers.length} utilisateur(s).`,
    sent: targetUsers.length,
    ticketCount: unpaidTickets.length,
  });
}

// Cron-safe endpoint: GET for automated daily alerts (no auth required when called by Vercel Cron)
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const unpaidTickets = await prisma.ticketSale.findMany({
    where: { paymentStatus: { in: ["UNPAID", "PARTIAL"] } },
    include: {
      airline: { select: { code: true, name: true } },
      payments: { select: { amount: true, currency: true } },
    },
    orderBy: { soldAt: "asc" },
  });

  if (unpaidTickets.length === 0) {
    return NextResponse.json({ message: "Aucun billet non payé.", sent: 0 });
  }

  const totalUnpaid = unpaidTickets.filter((t) => t.paymentStatus === "UNPAID").length;
  const totalPartial = unpaidTickets.filter((t) => t.paymentStatus === "PARTIAL").length;
  const totalAmountUsd = unpaidTickets.reduce((sum, t) => {
    const paid = t.payments.reduce((s, p) => s + (p.currency === "USD" ? p.amount : 0), 0);
    return sum + (t.currency === "USD" ? t.amount - paid : 0);
  }, 0);

  const targetUsers = await prisma.user.findMany({
    where: {
      OR: [
        { role: "ACCOUNTANT" },
        { jobTitle: "COMPTABLE" },
        { jobTitle: "CAISSIER" },
        { jobTitle: "CAISSE_2_SIEGE" },
        { jobTitle: "CAISSE_AGENCE" },
      ],
    },
    select: { id: true, name: true, email: true },
  });

  if (targetUsers.length === 0) {
    return NextResponse.json({ message: "Aucun destinataire.", sent: 0 });
  }

  const title = `🚨 URGENT — ${unpaidTickets.length} billet${unpaidTickets.length > 1 ? "s" : ""} non payé${unpaidTickets.length > 1 ? "s" : ""}`;
  const message = [
    `Non payés: ${totalUnpaid} | Partiels: ${totalPartial}`,
    totalAmountUsd > 0 ? `Reste à encaisser ≈ ${totalAmountUsd.toFixed(2)} USD` : null,
    `Veuillez procéder au recouvrement immédiatement.`,
  ]
    .filter(Boolean)
    .join(" — ");

  // Replace previous unread alerts
  await prisma.userNotification.deleteMany({
    where: {
      userId: { in: targetUsers.map((u) => u.id) },
      type: "UNPAID_TICKET_ALERT",
      isRead: false,
    },
  });

  await prisma.userNotification.createMany({
    data: targetUsers.map((user) => ({
      userId: user.id,
      title,
      message,
      type: "UNPAID_TICKET_ALERT",
      isRead: false,
      metadata: {
        totalCount: unpaidTickets.length,
        unpaidCount: totalUnpaid,
        partialCount: totalPartial,
        totalAmountUsd,
        sentBy: "cron",
        sentAt: new Date().toISOString(),
      },
    })),
  });

  if (isMailConfigured()) {
    try {
      const appUrl = process.env.NEXTAUTH_URL?.trim() || "";
      const ticketsUrl = appUrl ? `${appUrl}/payments` : "/payments";
      const ticketLines = unpaidTickets
        .slice(0, 20)
        .map(
          (t, i) =>
            `${i + 1}. ${t.ticketNumber} — ${t.customerName} — ${t.airline.code} — ${t.amount.toFixed(2)} ${t.currency} [${t.paymentStatus === "UNPAID" ? "Non payé" : "Partiel"}]`,
        )
        .join("\n");
      const moreCount = unpaidTickets.length > 20 ? `\n... et ${unpaidTickets.length - 20} autre(s).` : "";

      await sendMailBatch({
        recipients: targetUsers.map((u) => ({ email: u.email, name: u.name })),
        subject: `URGENT — ${unpaidTickets.length} billet(s) non payé(s) à recouvrer`,
        text: [
          `ALERTE QUOTIDIENNE — ${new Date().toLocaleDateString("fr-FR")}`,
          `${unpaidTickets.length} billet(s) non payés: ${totalUnpaid} non payés, ${totalPartial} partiels.`,
          totalAmountUsd > 0 ? `Reste estimé: ${totalAmountUsd.toFixed(2)} USD` : "",
          ``,
          ticketLines,
          moreCount,
          ``,
          ticketsUrl,
        ]
          .filter((l) => l !== undefined)
          .join("\n"),
      });
    } catch {
      // Silent fail on mail
    }
  }

  return NextResponse.json({ sent: targetUsers.length, ticketCount: unpaidTickets.length });
}
