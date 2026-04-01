import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireApiRoles } from "@/lib/rbac";
import { needExecutionSchema } from "@/lib/validators";

export async function POST(request: NextRequest) {
  const access = await requireApiRoles(["MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) return access.error;

  const me = await prisma.user.findUnique({
    where: { id: access.session.user.id },
    select: { id: true, name: true, jobTitle: true },
  });

  if (!me) {
    return NextResponse.json({ error: "Utilisateur introuvable." }, { status: 404 });
  }

  if (me.jobTitle !== "CAISSIERE") {
    return NextResponse.json({ error: "Exécution réservée à la Caissière." }, { status: 403 });
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
    return NextResponse.json({ error: "Cet état de besoin est déjà exécuté en caisse." }, { status: 400 });
  }

  const now = new Date();
  const executionMemoParts = [
    `EXECUTION_CAISSE: ${now.toISOString()}`,
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
      `Commentaire DG: ${need.reviewComment?.trim() || "-"}`,
      `Exécution caisse: ${now.toLocaleString("fr-FR")}`,
      `Caissière: ${me.name}`,
      `Référence caisse: ${parsed.data.referenceDoc}`,
      parsed.data.executionComment?.trim() ? `Commentaire caisse: ${parsed.data.executionComment.trim()}` : null,
    ].filter(Boolean).join(" | ");

    await prisma.userNotification.createMany({
      data: accountants.map((accountant) => ({
        userId: accountant.id,
        title: "EDB exécuté - validation comptable requise",
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
        } as Prisma.InputJsonValue,
      })),
    });
  }

  return NextResponse.json({ data: updated });
}
