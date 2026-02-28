import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRoles } from "@/lib/rbac";
import { needApprovalSchema } from "@/lib/validators";

export async function POST(request: NextRequest) {
  const access = await requireApiRoles(["ADMIN", "MANAGER", "ACCOUNTANT"]);
  if (access.error) return access.error;

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
      reviewedById: access.session.user.id,
      reviewComment: parsed.data.reviewComment,
      reviewedAt: now,
      approvedAt: nextStatus === "APPROVED" ? now : null,
      sealedAt: nextStatus === "APPROVED" ? now : null,
    },
  });

  return NextResponse.json({ data: updated });
}
