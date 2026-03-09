import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRoles } from "@/lib/rbac";
import { needApprovalSchema } from "@/lib/validators";

export async function POST(request: NextRequest) {
  const access = await requireApiRoles(["ADMIN", "MANAGER", "ACCOUNTANT", "EMPLOYEE"]);
  if (access.error) return access.error;

  const me = await prisma.user.findUnique({
    where: { id: access.session.user.id },
    select: { id: true, role: true, jobTitle: true },
  });

  if (!me) {
    return NextResponse.json({ error: "Utilisateur introuvable." }, { status: 404 });
  }

  const validatorJobTitles = new Set(["DIRECTION_GENERALE", "CAISSIERE", "COMPTABLE", "AUDITEUR"]);
  const canValidate = me.role === "ADMIN" || validatorJobTitles.has((me.jobTitle ?? "").toUpperCase());
  if (!canValidate) {
    return NextResponse.json({ error: "Validation réservée à la Direction, caisse, comptabilité ou audit." }, { status: 403 });
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

  if (updated.requesterId) {
    await prisma.userNotification.create({
      data: {
        userId: updated.requesterId,
        title: "Décision sur votre EDB",
        message: `Votre état de besoin \"${updated.title}\" a été ${nextStatus === "APPROVED" ? "approuvé" : "rejeté"}.`,
        type: "PROCUREMENT_DECISION",
        metadata: {
          needRequestId: updated.id,
          needStatus: updated.status,
        },
      },
    });
  }

  return NextResponse.json({ data: updated });
}
