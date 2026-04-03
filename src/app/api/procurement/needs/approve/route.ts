import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRoles } from "@/lib/rbac";
import { needApprovalSchema } from "@/lib/validators";

export async function POST(request: NextRequest) {
  const access = await requireApiRoles(["DIRECTEUR_GENERAL"]);
  if (access.error) return access.error;

  const me = await prisma.user.findUnique({
    where: { id: access.session.user.id },
    select: { id: true, role: true, jobTitle: true },
  });

  if (!me) {
    return NextResponse.json({ error: "Utilisateur introuvable." }, { status: 404 });
  }

  const canValidate = access.role === "DIRECTEUR_GENERAL" || access.role === "ADMIN";
  if (!canValidate) {
    return NextResponse.json({ error: "Validation réservée au Directeur Général." }, { status: 403 });
  }

  const body = await request.json();
  const parsed = needApprovalSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const need = await prisma.needRequest.findUnique({
    where: { id: parsed.data.needRequestId },
    select: { id: true, status: true },
  });

  if (!need) {
    return NextResponse.json({ error: "État de besoin introuvable." }, { status: 404 });
  }

  if (need.status !== "SUBMITTED") {
    return NextResponse.json(
      { error: "Cet état de besoin a déjà été traité. Une décision DG ne peut être faite qu'une seule fois." },
      { status: 400 },
    );
  }

  const now = new Date();
  const nextStatus = parsed.data.status;

  const updated = await prisma.needRequest.update({
    where: { id: parsed.data.needRequestId },
    data: {
      status: nextStatus,
      reviewedById: me.id,
      reviewComment: parsed.data.reviewComment,
      reviewedAt: now,
      approvedAt: nextStatus === "APPROVED" ? now : null,
      sealedAt: nextStatus === "APPROVED" ? now : null,
    },
  });

  const notifications: Array<{
    userId: string;
    title: string;
    message: string;
    type: string;
    metadata: { needRequestId: string; needStatus: string; needTitle: string; source: string };
  }> = [];

  if (updated.requesterId) {
    notifications.push({
      userId: updated.requesterId,
      title: "Décision sur votre EDB",
      message: `Votre état de besoin \"${updated.title}\" a été ${nextStatus === "APPROVED" ? "approuvé" : "rejeté"}.`,
      type: "PROCUREMENT_DECISION",
      metadata: {
        needRequestId: updated.id,
        needStatus: updated.status,
        needTitle: updated.title,
        source: "INBOX_DECISION",
      },
    });
  }

  if (nextStatus === "APPROVED") {
    const cashierUsers = await prisma.user.findMany({
      where: {
        jobTitle: "CAISSIER",
      },
      select: { id: true },
      take: 160,
    });

    cashierUsers.forEach((cashier) => {
      notifications.push({
        userId: cashier.id,
        title: "EDB approuvé à exécuter",
        message: `L'état de besoin \"${updated.title}\" est approuvé par le Directeur Général. Exécuter la caisse depuis votre inbox.`,
        type: "PROCUREMENT_FINANCE_EXECUTION",
        metadata: {
          needRequestId: updated.id,
          needStatus: updated.status,
          needTitle: updated.title,
          source: "INBOX_FINANCE_EXECUTION",
        },
      });
    });
  }

  if (nextStatus === "REJECTED") {
    const financeUsers = await prisma.user.findMany({
      where: {
        OR: [
          { role: "ACCOUNTANT" },
          { jobTitle: { in: ["CAISSIER", "COMPTABLE"] } },
        ],
      },
      select: { id: true },
      take: 160,
    });

    financeUsers.forEach((finance) => {
      notifications.push({
        userId: finance.id,
        title: "EDB rejeté",
        message: `L'état de besoin \"${updated.title}\" a été rejeté par la Direction. Ne pas exécuter ce dossier.` ,
        type: "PROCUREMENT_REJECTION",
        metadata: {
          needRequestId: updated.id,
          needStatus: updated.status,
          needTitle: updated.title,
          source: "INBOX_REJECTED",
        },
      });
    });
  }

  if (notifications.length > 0) {
    const unique = notifications.filter((notification, index, list) => {
      return list.findIndex((item) => item.userId === notification.userId && item.type === notification.type) === index;
    });

    await prisma.userNotification.createMany({
      data: unique,
    });
  }

  return NextResponse.json({ data: updated });
}
