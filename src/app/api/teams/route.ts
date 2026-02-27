import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiRoles } from "@/lib/rbac";

const teamCreateSchema = z.object({
  name: z.string().min(2).max(120),
});

export async function GET() {
  const access = await requireApiRoles(["ADMIN", "MANAGER", "ACCOUNTANT"]);
  if (access.error) return access.error;

  const teams = await prisma.team.findMany({
    include: {
      users: {
        select: { id: true, name: true, role: true },
      },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ data: teams });
}

export async function POST(request: NextRequest) {
  const access = await requireApiRoles(["ADMIN", "MANAGER"]);
  if (access.error) return access.error;

  const body = await request.json();
  const parsed = teamCreateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.team.findUnique({ where: { name: parsed.data.name } });
  if (existing) {
    return NextResponse.json({ error: "Cette équipe existe déjà." }, { status: 400 });
  }

  const team = await prisma.team.create({
    data: { name: parsed.data.name },
    include: {
      users: {
        select: { id: true, name: true, role: true },
      },
    },
  });

  return NextResponse.json({ data: team }, { status: 201 });
}
