import { JobTitle } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiRoles } from "@/lib/rbac";

const userJobTitleSchema = z.object({
  jobTitle: z.nativeEnum(JobTitle),
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const access = await requireApiRoles(["ADMIN"]);
  if (access.error) {
    return access.error;
  }

  const { id } = await context.params;
  const body = await request.json();
  const parsed = userJobTitleSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    return NextResponse.json({ error: "Utilisateur introuvable." }, { status: 404 });
  }

  const updated = await prisma.user.update({
    where: { id },
    data: { jobTitle: parsed.data.jobTitle },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      jobTitle: true,
    },
  });

  return NextResponse.json({ data: updated });
}
