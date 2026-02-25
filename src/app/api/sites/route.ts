import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRoles } from "@/lib/rbac";
import { workSiteCreateSchema } from "@/lib/validators";

export async function GET() {
  const access = await requireApiRoles(["ADMIN", "MANAGER", "ACCOUNTANT"]);
  if (access.error) {
    return access.error;
  }

  const sites = await prisma.workSite.findMany({
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ data: sites });
}

export async function POST(request: NextRequest) {
  const access = await requireApiRoles(["ADMIN"]);
  if (access.error) {
    return access.error;
  }

  const body = await request.json();
  const parsed = workSiteCreateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const site = await prisma.workSite.create({
    data: {
      ...parsed.data,
      isActive: parsed.data.isActive ?? true,
    },
  });

  return NextResponse.json({ data: site }, { status: 201 });
}
