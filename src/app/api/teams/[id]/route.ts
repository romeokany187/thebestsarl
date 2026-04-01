import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function isProtectedTeam(name: string) {
  const normalized = name.trim().toUpperCase();
  return normalized.includes("KINSHASA") && normalized.includes("DIRECTION");
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const access = await requireApiModuleAccess("teams", ["ADMIN", "DIRECTEUR_GENERAL"]);
  if (access.error) return access.error;

  const { id } = await context.params;

  const team = await prisma.team.findUnique({
    where: { id },
    include: {
      users: {
        select: { id: true },
        take: 1,
      },
    },
  });

  if (!team) {
    return NextResponse.json({ error: "Équipe introuvable." }, { status: 404 });
  }

  if (isProtectedTeam(team.name)) {
    return NextResponse.json({ error: "L'équipe de la direction générale ne peut pas être supprimée." }, { status: 400 });
  }

  if (team.users.length > 0) {
    return NextResponse.json({ error: "Désaffectez d'abord tous les membres avant de supprimer l'équipe." }, { status: 400 });
  }

  await prisma.team.delete({ where: { id } });

  return NextResponse.json({ success: true }, { status: 200 });
}
