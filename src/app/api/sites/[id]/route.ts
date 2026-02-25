import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRoles } from "@/lib/rbac";
import { workSiteUpdateSchema } from "@/lib/validators";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const access = await requireApiRoles(["ADMIN"]);
  if (access.error) {
    return access.error;
  }

  const { id } = await context.params;
  const body = await request.json();
  const parsed = workSiteUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const site = await prisma.workSite.update({
    where: { id },
    data: parsed.data,
  });

  return NextResponse.json({ data: site });
}
