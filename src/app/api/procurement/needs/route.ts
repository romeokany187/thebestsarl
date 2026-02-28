import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRoles } from "@/lib/rbac";
import { needRequestSchema } from "@/lib/validators";

export async function GET(request: NextRequest) {
  const access = await requireApiRoles(["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) return access.error;

  const status = request.nextUrl.searchParams.get("status");

  const needs = await prisma.needRequest.findMany({
    where: {
      ...(status ? { status: status as never } : {}),
      ...(access.role === "EMPLOYEE" ? { requesterId: access.session.user.id } : {}),
    },
    include: {
      requester: { select: { id: true, name: true, jobTitle: true, role: true } },
      reviewedBy: { select: { id: true, name: true, role: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return NextResponse.json({ data: needs });
}

export async function POST(request: NextRequest) {
  const access = await requireApiRoles(["ADMIN", "MANAGER", "EMPLOYEE"]);
  if (access.error) return access.error;

  const body = await request.json();
  const parsed = needRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const me = await prisma.user.findUnique({
    where: { id: access.session.user.id },
    select: { id: true, role: true, jobTitle: true },
  });

  if (!me) {
    return NextResponse.json({ error: "Utilisateur introuvable." }, { status: 404 });
  }

  if (me.role === "EMPLOYEE" && me.jobTitle !== "APPROVISIONNEMENT_MARKETING") {
    return NextResponse.json({ error: "Seul le service approvisionnement peut émettre un état de besoin." }, { status: 403 });
  }

  const need = await prisma.needRequest.create({
    data: {
      ...parsed.data,
      status: "SUBMITTED",
      requesterId: me.id,
      submittedAt: new Date(),
    },
  });

  return NextResponse.json({ data: need }, { status: 201 });
}
