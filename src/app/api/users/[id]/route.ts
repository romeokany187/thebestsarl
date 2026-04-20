import { JobTitle, Role } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { isMailConfigured, sendMailBatch } from "@/lib/mail";
import { writeActivityLog } from "@/lib/activity-log";

const CASHIER_ASSIGNMENT_JOB_TITLES = new Set(["CAISSE_2_SIEGE", "CAISSE_AGENCE"]);

function isMySqlFamilyDatabase() {
  const databaseUrl = process.env.DATABASE_URL?.trim().toLowerCase() ?? "";
  return databaseUrl.startsWith("mysql://") || databaseUrl.startsWith("mariadb://");
}

function isJobTitleSchemaIssue(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /jobtitle|enum|caisse_2_siege|caisse_agence|data truncated|invalid value for enum/i.test(message);
}

async function ensureAssignableCashJobTitles() {
  if (isMySqlFamilyDatabase()) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE \`User\`
      MODIFY COLUMN \`jobTitle\` ENUM(
        'COMMERCIAL',
        'COMPTABLE',
        'AUDITEUR',
        'CAISSIER',
        'CAISSE_2_SIEGE',
        'CAISSE_AGENCE',
        'RELATION_PUBLIQUE',
        'APPROVISIONNEMENT',
        'AGENT_TERRAIN',
        'DIRECTION_GENERALE',
        'CHEF_AGENCE'
      ) NOT NULL DEFAULT 'AGENT_TERRAIN';
    `);
    return;
  }

  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_enum e
        JOIN pg_type t ON e.enumtypid = t.oid
        WHERE t.typname = 'JobTitle' AND e.enumlabel = 'CAISSE_2_SIEGE'
      ) THEN
        ALTER TYPE "JobTitle" ADD VALUE 'CAISSE_2_SIEGE';
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_enum e
        JOIN pg_type t ON e.enumtypid = t.oid
        WHERE t.typname = 'JobTitle' AND e.enumlabel = 'CAISSE_AGENCE'
      ) THEN
        ALTER TYPE "JobTitle" ADD VALUE 'CAISSE_AGENCE';
      END IF;
    END
    $$;
  `);
}

const userUpdateSchema = z.object({
  jobTitle: z.nativeEnum(JobTitle).optional(),
  teamId: z.string().min(1).nullable().optional(),
  role: z.nativeEnum(Role).optional(),
  canImportTicketWorkbook: z.boolean().optional(),
  resetPassword: z.boolean().optional(),
}).refine((value) => value.jobTitle !== undefined || value.teamId !== undefined || value.role !== undefined || value.canImportTicketWorkbook !== undefined || value.resetPassword !== undefined, {
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

  const canManageAssignment = actor.role === "ADMIN" || actor.role === "DIRECTEUR_GENERAL";
  if (!canManageAssignment) {
    return NextResponse.json({ error: "Affectation réservée à l'administrateur ou au Directeur Général." }, { status: 403 });
  }

  const { id } = await context.params;
  const body = await request.json();
  const parsed = userUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
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

  if (parsed.data.role !== undefined && actor.role !== "ADMIN") {
    if (parsed.data.role === "ADMIN") {
      return NextResponse.json(
        { error: "La nomination au rôle administrateur est réservée à un administrateur." },
        { status: 403 },
      );
    }

    if (existing.role === "ADMIN") {
      return NextResponse.json(
        { error: "Seul un administrateur peut modifier le rôle d'un administrateur." },
        { status: 403 },
      );
    }
  }

  if (parsed.data.resetPassword) {
    if (actor.role !== "ADMIN") {
      return NextResponse.json({ error: "La réinitialisation du mot de passe est réservée à l'administrateur." }, { status: 403 });
    }

    if (existing.role === "ADMIN") {
      return NextResponse.json({ error: "Réinitialisation du mot de passe d'un administrateur interdite." }, { status: 400 });
    }

    try {
      const updated = await prisma.$transaction(async (tx) => {
        await tx.passwordSetupCode.updateMany({
          where: {
            userId: id,
            consumedAt: null,
          },
          data: {
            consumedAt: new Date(),
          },
        });

        return tx.user.update({
          where: { id },
          data: { passwordHash: "" },
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
      });

      await prisma.userNotification.create({
        data: {
          userId: updated.id,
          title: "Mot de passe réinitialisé",
          type: "SECURITY",
          message: "Votre mot de passe a été réinitialisé par l'administrateur. Reconnectez-vous avec Google pour définir un nouveau mot de passe.",
          metadata: {
            resetBy: actor.id,
            resetByName: actor.name,
          },
        },
      });

      await writeActivityLog({
        actorId: access.session.user.id,
        action: "USER_PASSWORD_RESET",
        entityType: "USER",
        entityId: updated.id,
        summary: `Mot de passe réinitialisé pour ${updated.name}.`,
        payload: {
          name: updated.name,
          email: updated.email,
          changedBy: actor.name,
        },
      });

      return NextResponse.json({ data: updated, passwordReset: true });
    } catch (error) {
      console.error("PATCH /api/users/[id] resetPassword failed", error);
      return NextResponse.json({ error: "Échec de la réinitialisation du mot de passe." }, { status: 500 });
    }
  }

  if (parsed.data.teamId) {
    const team = await prisma.team.findUnique({ where: { id: parsed.data.teamId }, select: { id: true } });
    if (!team) {
      return NextResponse.json({ error: "Équipe introuvable." }, { status: 404 });
    }
  }

  let assignmentMessage = "";

  const applyAssignmentUpdate = async () => {
    assignmentMessage = "";

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

    await writeActivityLog({
      actorId: access.session.user.id,
      action: "USER_ASSIGNMENT_UPDATED",
      entityType: "USER",
      entityId: updated.id,
      summary: `Affectation mise à jour pour ${updated.name}.`,
      payload: {
        name: updated.name,
        email: updated.email,
        role: updated.role,
        jobTitle: updated.jobTitle,
        teamName: updated.team?.name ?? null,
        changedBy: actor.name,
        assignmentMessage,
      },
    });

    return updated;
  };

  try {
    let updated;

    try {
      updated = await applyAssignmentUpdate();
    } catch (error) {
      const requestedJobTitle = parsed.data.jobTitle;
      if (requestedJobTitle && CASHIER_ASSIGNMENT_JOB_TITLES.has(requestedJobTitle) && isJobTitleSchemaIssue(error)) {
        await ensureAssignableCashJobTitles();
        updated = await applyAssignmentUpdate();
      } else {
        throw error;
      }
    }

    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error("PATCH /api/users/[id] failed", error);

    return NextResponse.json(
      {
        error: isJobTitleSchemaIssue(error)
          ? "Affectation impossible: la base de production n'était pas encore synchronisée pour ce poste. Réessayez après le déploiement en cours."
          : "Échec de la mise à jour de l'affectation.",
      },
      { status: 500 },
    );
  }
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

  const canDeleteUser = actor.role === "ADMIN" || actor.role === "DIRECTEUR_GENERAL";
  if (!canDeleteUser) {
    return NextResponse.json({ error: "Suppression réservée à l'administrateur ou au Directeur Général." }, { status: 403 });
  }

  const { id } = await context.params;
  if (id === actor.id) {
    return NextResponse.json({ error: "Vous ne pouvez pas supprimer votre propre compte." }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
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
          paymentOrdersIssued: true,
          paymentOrdersApproved: true,
          paymentOrdersExecuted: true,
          cashOperations: true,
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

  try {
    await prisma.$transaction(async (tx) => {
      await tx.userNotification.deleteMany({ where: { userId: id } });
      await tx.auditLog.deleteMany({ where: { actorId: id } });
      await tx.workerReport.updateMany({ where: { authorId: id }, data: { authorId: actor.id } });
      await tx.workerReport.updateMany({ where: { reviewerId: id }, data: { reviewerId: null } });
      await tx.attendance.deleteMany({ where: { userId: id } });
      await tx.newsPost.updateMany({ where: { authorId: id }, data: { authorId: actor.id } });
      await tx.needRequest.updateMany({ where: { requesterId: id }, data: { requesterId: actor.id } });
      await tx.needRequest.updateMany({ where: { reviewedById: id }, data: { reviewedById: null } });
      await tx.paymentOrder.updateMany({ where: { issuedById: id }, data: { issuedById: actor.id } });
      await tx.paymentOrder.updateMany({ where: { approvedById: id }, data: { approvedById: null } });
      await tx.paymentOrder.updateMany({ where: { executedById: id }, data: { executedById: null } });
      await tx.cashOperation.updateMany({ where: { createdById: id }, data: { createdById: actor.id } });
      await tx.stockMovement.updateMany({ where: { performedById: id }, data: { performedById: actor.id } });
      await tx.archiveDocument.updateMany({ where: { createdById: id }, data: { createdById: null } });
      await tx.airlineDepositMovement.updateMany({ where: { createdById: id }, data: { createdById: null } });
      await tx.ticketSale.updateMany({ where: { sellerId: id, sellerName: null }, data: { sellerName: existing.name } });
      await tx.ticketSale.updateMany({ where: { sellerId: id }, data: { sellerId: null } });
      await tx.user.delete({ where: { id } });
    });

    await writeActivityLog({
      actorId: access.session.user.id,
      action: "USER_DELETED",
      entityType: "USER",
      entityId: existing.id,
      summary: `Compte utilisateur supprimé: ${existing.name}.`,
      payload: {
        name: existing.name,
        role: existing.role,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/users/[id] failed", error);
    return NextResponse.json(
      { error: "Suppression impossible pour cet utilisateur. Les liaisons historiques n'ont pas pu être nettoyées." },
      { status: 500 },
    );
  }
}
