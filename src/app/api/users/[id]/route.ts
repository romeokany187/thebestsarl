import { JobTitle } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiRoles } from "@/lib/rbac";

const userUpdateSchema = z.object({
  jobTitle: z.nativeEnum(JobTitle).optional(),
  teamId: z.string().min(1).nullable().optional(),
}).refine((value) => value.jobTitle !== undefined || value.teamId !== undefined, {
  message: "Aucune donnée à mettre à jour.",
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const access = await requireApiRoles(["ADMIN", "MANAGER"]);
  if (access.error) {
    return access.error;
  }

  const { id } = await context.params;
  const body = await request.json();
  const parsed = userUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    return NextResponse.json({ error: "Utilisateur introuvable." }, { status: 404 });
  }

  if (parsed.data.teamId) {
    const team = await prisma.team.findUnique({ where: { id: parsed.data.teamId }, select: { id: true } });
    if (!team) {
      return NextResponse.json({ error: "Équipe introuvable." }, { status: 404 });
    }
  }

  const updated = await prisma.user.update({
    where: { id },
    data: {
      ...(parsed.data.jobTitle !== undefined ? { jobTitle: parsed.data.jobTitle } : {}),
      ...(parsed.data.teamId !== undefined ? { teamId: parsed.data.teamId } : {}),
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      jobTitle: true,
      team: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({ data: updated });
}
