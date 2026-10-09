import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { isCashierJobTitle } from "@/lib/assignment";
import { isDeskAllowedForUser, resolveExecutionCashDesk } from "@/lib/payments-desk";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { getUserModuleAccessMap, hasRequiredModuleAccessLevel } from "@/lib/user-module-access";
import { needExecutionSchema } from "@/lib/validators";
import { writeActivityLog } from "@/lib/activity-log";

export async function POST(request: NextRequest) {
  const access = await requireApiModuleAccess("payments", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"], "WRITE");
  if (access.error) return access.error;

  const me = await prisma.user.findUnique({
    where: { id: access.session.user.id },
    select: { id: true, name: true, jobTitle: true },
  });

  if (!me) {
    return NextResponse.json({ error: "Utilisateur introuvable." }, { status: 404 });
  }

  if (access.role !== "ADMIN" && access.role !== "ACCOUNTANT" && !hasRequiredModuleAccessLevel(access.customModuleAccess, "FULL") && !isCashierJobTitle(me.jobTitle) && me.jobTitle !== "COMPTABLE") {
    return NextResponse.json({ error: "Exécution réservée à l'administrateur, au comptable ou aux profils caisse autorisés." }, { status: 403 });
  }

  const body = await request.json();
  const parsed = needExecutionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const need = await prisma.needRequest.findUnique({
    where: { id: parsed.data.needRequestId },
    include: {
      requester: { select: { id: true, name: true, jobTitle: true } },
      reviewedBy: { select: { id: true, name: true, jobTitle: true } },
    },
  });

  if (!need) {
    return NextResponse.json({ error: "État de besoin introuvable." }, { status: 404 });
  }

  if (need.status !== "APPROVED") {
    return NextResponse.json({ error: "Seul un EDB approuvé peut être exécuté." }, { status: 400 });
  }

  if ((need.reviewComment ?? "").includes("EXECUTION_CAISSE:")) {
    return NextResponse.json({ error: "Cet état de besoin est déjà marqué exécuté en caisse." }, { status: 400 });
  }

  const moduleAccessMap = await getUserModuleAccessMap(access.session.user.id);
  const executionCashDesk = resolveExecutionCashDesk({
    requestedDesk: parsed.data.cashDesk,
    jobTitle: me.jobTitle,
    role: access.role,
    customModuleAccessLevel: access.customModuleAccess,
    customModuleAccessMap: moduleAccessMap,
  });

  if (!isDeskAllowedForUser({
    desk: executionCashDesk,
    jobTitle: me.jobTitle,
    role: access.role,
    customModuleAccessLevel: access.customModuleAccess,
    customModuleAccessMap: moduleAccessMap,
  })) {
    return NextResponse.json({ error: "Accès refusé pour cette caisse." }, { status: 403 });
  }

  const now = new Date();
  const executionAmount = need.estimatedAmount ?? 0;

  const executionMemoParts = [
    `EXECUTION_CAISSE: ${now.toISOString()}`,
    "Exécution indicative — aucune écriture caisse ni impact sur le journal.",
    `Caisse (suivi): ${executionCashDesk}`,
    `Référence caisse: ${parsed.data.referenceDoc}`,
    `Exécuté par: ${me.name}`,
    parsed.data.executionComment?.trim() ? `Commentaire caisse: ${parsed.data.executionComment.trim()}` : null,
  ].filter(Boolean);

  const previousComment = need.reviewComment?.trim() ?? "";
  const reviewComment = [previousComment, ...executionMemoParts]
    .filter((part): part is string => Boolean(part && part.length > 0))
    .join("\n\n");

  const updated = await prisma.needRequest.update({
    where: { id: need.id },
    data: {
      status: "APPROVED",
      reviewComment,
      sealedAt: now,
    },
  });

  const accountants = await prisma.user.findMany({
    where: {
      OR: [
        { role: "ACCOUNTANT" },
        { jobTitle: "COMPTABLE" },
      ],
    },
    select: { id: true },
    take: 120,
  });

  if (accountants.length > 0) {
    const message = [
      `EDB: ${need.code ?? need.title} - ${need.title}`,
      `Demandeur: ${need.requester.name} (${need.requester.jobTitle})`,
      `Soumis: ${need.submittedAt ? new Date(need.submittedAt).toLocaleString("fr-FR") : "-"}`,
      `Validation DG: ${need.reviewedBy?.name ?? "-"} (${need.approvedAt ? new Date(need.approvedAt).toLocaleString("fr-FR") : "-"})`,
      `Marqué exécuté en caisse (indicatif, sans écriture caisse): ${now.toLocaleString("fr-FR")}`,
      `Agent finance: ${me.name}`,
      `Référence caisse: ${parsed.data.referenceDoc}`,
      parsed.data.executionComment?.trim() ? `Commentaire caisse: ${parsed.data.executionComment.trim()}` : null,
    ].filter(Boolean).join(" | ");

    await prisma.userNotification.createMany({
      data: accountants.map((accountant) => ({
        userId: accountant.id,
        title: "EDB — exécution caisse (indicatif)",
        message,
        type: "PROCUREMENT_ACCOUNTING_APPROVAL",
        metadata: {
          needRequestId: updated.id,
          needStatus: updated.status,
          needTitle: updated.title,
          source: "INBOX_ACCOUNTING_APPROVAL",
          executedAt: now.toISOString(),
          executedByUserId: me.id,
          referenceDoc: parsed.data.referenceDoc,
          cashDesk: executionCashDesk,
          informationalExecution: true,
        } as Prisma.InputJsonValue,
      })),
    });
  }

  await writeActivityLog({
    actorId: access.session.user.id,
    action: "NEED_REQUEST_EXECUTED",
    entityType: "NEED_REQUEST",
    entityId: updated.id,
    summary: `EDB ${need.code ?? updated.id} marqué exécuté en caisse (indicatif): ${need.title}.`,
    payload: {
      code: need.code,
      title: need.title,
      amount: executionAmount,
      currency: need.currency,
      referenceDoc: parsed.data.referenceDoc,
      informationalExecution: true,
      executionComment: parsed.data.executionComment ?? null,
      cashDesk: executionCashDesk,
    } as Prisma.InputJsonValue,
  });

  return NextResponse.json({ data: updated });
}
