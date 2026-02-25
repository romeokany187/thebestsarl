import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { approvalSchema } from "@/lib/validators";
import { requireApiRoles } from "@/lib/rbac";

export async function POST(request: NextRequest) {
  const access = await requireApiRoles(["ADMIN", "MANAGER"]);
  if (access.error) {
    return access.error;
  }

  const body = await request.json();
  const parsed = approvalSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const report = await prisma.workerReport.update({
    where: { id: parsed.data.reportId },
    data: {
      reviewerId: parsed.data.reviewerId,
      reviewerComment: parsed.data.reviewerComment,
      status: parsed.data.status,
      approvedAt: parsed.data.status === "APPROVED" ? new Date() : null,
    },
  });

  return NextResponse.json({ data: report });
}
