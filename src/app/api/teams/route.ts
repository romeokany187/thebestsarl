import { NextRequest, NextResponse } from "next/server";
import { TeamKind } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";

const teamCreateSchema = z.object({
  name: z.string().min(2).max(120),
  kind: z.nativeEnum(TeamKind).default(TeamKind.AGENCE),
});

function normalizeTeamName(value: string) {
  return value.trim().toUpperCase();
}

function isLegacyPlaceholderTeam(name: string) {
  const normalized = normalizeTeamName(name);
  return normalized === "OPERATIONS" || normalized === "OPERATION" || normalized === "SALES";
}

export async function GET() {
  const access = await requireApiModuleAccess("teams", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "ACCOUNTANT"]);
  if (access.error) return access.error;

  const teams = await prisma.team.findMany({
    where: {
      NOT: [
        { name: "Operations" },
        { name: "Operation" },
        { name: "Sales" },
      ],
    },
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
  const access = await requireApiModuleAccess("teams", ["ADMIN", "DIRECTEUR_GENERAL"]);
  if (access.error) return access.error;

  const body = await request.json();
  const parsed = teamCreateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const normalizedName = normalizeTeamName(parsed.data.name);
  if (isLegacyPlaceholderTeam(normalizedName)) {
    return NextResponse.json(
      { error: "Utilisez uniquement des équipes de type agence ou partenaire." },
      { status: 400 },
    );
  }

  const cleanName = parsed.data.name.trim();
  const existing = await prisma.team.findUnique({ where: { name: cleanName } });
  if (existing) {
    return NextResponse.json({ error: "Cette équipe existe déjà." }, { status: 400 });
  }

  const team = await prisma.team.create({
    data: { name: cleanName, kind: parsed.data.kind },
    include: {
      users: {
        select: { id: true, name: true, role: true },
      },
    },
  });

  return NextResponse.json({ data: team }, { status: 201 });
}
