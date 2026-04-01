import { JobTitle, Role } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { isMailConfigured, sendMailBatch } from "@/lib/mail";

const userUpdateSchema = z.object({
  jobTitle: z.nativeEnum(JobTitle).optional(),
  teamId: z.string().min(1).nullable().optional(),
  role: z.nativeEnum(Role).optional(),
  canImportTicketWorkbook: z.boolean().optional(),
}).refine((value) => value.jobTitle !== undefined || value.teamId !== undefined || value.role !== undefined || value.canImportTicketWorkbook !== undefined, {
  message: "Aucune donnée à mettre à jour.",
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const access = await requireApiModuleAccess("teams", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) {
    return access.error;
  }

  const actor = await prisma.user.findUnique({
    where: { id: access.session.user.id },
    select: { id: true, role: true, jobTitle: true, name: true, email: true },
  });

  if (!actor) {
    return NextResponse.json({ error: "Utilisateur courant introuvable." }, { status: 404 });
  }

  const canManageAssignment = actor.role === "ADMIN" || actor.jobTitle === "DIRECTION_GENERALE";
  if (!canManageAssignment) {
    return NextResponse.json({ error: "Affectation réservée à l'administrateur ou à la Direction Générale." }, { status: 403 });
  }

  const { id } = await context.params;
  const body = await request.json();
  const parsed = userUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (actor.role !== "ADMIN" && parsed.data.role !== undefined) {
    return NextResponse.json({ error: "Seul un administrateur peut changer le rôle." }, { status: 403 });
  }

  const existing = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      role: true,
      teamId: true,
      team: { select: { id: true, name: true } },
      jobTitle: true,
      canImportTicketWorkbook: true,
    },
  });
  if (!existing) {
    return NextResponse.json({ error: "Utilisateur introuvable." }, { status: 404 });
  }

  if (parsed.data.teamId) {
    const team = await prisma.team.findUnique({ where: { id: parsed.data.teamId }, select: { id: true } });
    if (!team) {
      return NextResponse.json({ error: "Équipe introuvable." }, { status: 404 });
    }
  }

  let assignmentMessage = "";

  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id },
      data: {
        ...(parsed.data.jobTitle !== undefined ? { jobTitle: parsed.data.jobTitle } : {}),
        ...(parsed.data.teamId !== undefined ? { teamId: parsed.data.teamId } : {}),
        ...(parsed.data.role !== undefined ? { role: parsed.data.role } : {}),
        ...(parsed.data.canImportTicketWorkbook !== undefined ? { canImportTicketWorkbook: parsed.data.canImportTicketWorkbook } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        jobTitle: true,
        canImportTicketWorkbook: true,
        team: { select: { id: true, name: true } },
      },
    });

    const teamChanged = parsed.data.teamId !== undefined && parsed.data.teamId !== existing.teamId;
    const jobChanged = parsed.data.jobTitle !== undefined && parsed.data.jobTitle !== existing.jobTitle;
    const roleChanged = parsed.data.role !== undefined && parsed.data.role !== existing.role;
    const importPermissionChanged = parsed.data.canImportTicketWorkbook !== undefined && parsed.data.canImportTicketWorkbook !== existing.canImportTicketWorkbook;

    if (teamChanged || jobChanged || roleChanged || importPermissionChanged) {
      const title = "Nouvelle affectation";
      const fromTeam = existing.team?.name ?? "Sans équipe";
      const toTeam = user.team?.name ?? "Sans équipe";
      const fromJob = existing.jobTitle;
      const toJob = user.jobTitle;
      const fromRole = existing.role;
      const toRole = user.role;
      const messageParts: string[] = [];

      if (teamChanged) messageParts.push(`Équipe ${fromTeam} → ${toTeam}`);
      if (jobChanged) messageParts.push(`Fonction ${fromJob} → ${toJob}`);
      if (roleChanged) messageParts.push(`Rôle ${fromRole} → ${toRole}`);
      if (importPermissionChanged) messageParts.push(`Import Excel billets ${existing.canImportTicketWorkbook ? "autorisé" : "interdit"} → ${user.canImportTicketWorkbook ? "autorisé" : "interdit"}`);

      assignmentMessage = `Votre affectation a été mise à jour: ${messageParts.join("; ")}.`;

      await tx.userNotification.create({
        data: {
          userId: user.id,
          title,
          type: "ASSIGNMENT",
          message: assignmentMessage,
          metadata: {
            fromTeam,
            toTeam,
            fromJob,
            toJob,
            fromRole,
            toRole,
            importPermissionChanged,
            fromCanImportTicketWorkbook: existing.canImportTicketWorkbook,
            toCanImportTicketWorkbook: user.canImportTicketWorkbook,
            changedBy: actor.id,
          },
        },
      });
    }

    return user;
  });

  if (assignmentMessage && isMailConfigured()) {
    try {
      await sendMailBatch({
        recipients: [{ email: updated.email, name: updated.name }],
        subject: "Mise à jour de votre affectation",
        text: [
          `Bonjour ${updated.name},`,
          "",
          assignmentMessage,
          "",
          `Mis à jour par: ${actor.name}`,
        ].join("\n"),
        html: `
          <p>Bonjour ${updated.name},</p>
          <p>${assignmentMessage}</p>
          <p><strong>Mis à jour par:</strong> ${actor.name}</p>
        `,
        replyTo: actor.email,
      });
    } catch {
      // Ne pas bloquer la mise à jour d'affectation si l'email échoue.
    }
  }

  return NextResponse.json({ data: updated });
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const access = await requireApiModuleAccess("teams", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) {
    return access.error;
  }

  const actor = await prisma.user.findUnique({
    where: { id: access.session.user.id },
    select: { id: true, role: true, jobTitle: true },
  });

  if (!actor) {
    return NextResponse.json({ error: "Utilisateur courant introuvable." }, { status: 404 });
  }

  const canDeleteUser = actor.role === "ADMIN" || actor.jobTitle === "DIRECTION_GENERALE";
  if (!canDeleteUser) {
    return NextResponse.json({ error: "Suppression réservée à l'administrateur ou à la Direction Générale." }, { status: 403 });
  }

  const { id } = await context.params;
  if (id === actor.id) {
    return NextResponse.json({ error: "Vous ne pouvez pas supprimer votre propre compte." }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      role: true,
      _count: {
        select: {
          reports: true,
          approvals: true,
          attendances: true,
          ticketsSold: true,
          logs: true,
          notifications: true,
          newsPosts: true,
          needRequests: true,
          needReviews: true,
          stockMovements: true,
          archiveUploads: true,
        },
      },
    },
  });

  if (!existing) {
    return NextResponse.json({ error: "Utilisateur introuvable." }, { status: 404 });
  }

  if (existing.role === "ADMIN") {
    return NextResponse.json({ error: "Suppression d'un administrateur interdite." }, { status: 400 });
  }

  const dependencyTotal = Object.values(existing._count).reduce((sum, count) => sum + count, 0);
  if (dependencyTotal > 0) {
    return NextResponse.json(
      {
        error: "Suppression impossible: cet utilisateur possède déjà des données liées (rapports, billets, présences, etc.).",
      },
      { status: 400 },
    );
  }

  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
