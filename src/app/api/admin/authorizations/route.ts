import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import {
  AUTHORIZATION_MODULE_OPTIONS,
  ensureUserModuleAccessTable,
  type ModuleAccessLevel,
} from "@/lib/user-module-access";
import { writeActivityLog } from "@/lib/activity-log";

const userModuleAccessClient = (prisma as unknown as { userModuleAccess: any }).userModuleAccess;

const moduleValues = AUTHORIZATION_MODULE_OPTIONS.map((item) => item.value) as [string, ...string[]];
const accessLevelValues = ["READ", "WRITE", "FULL"] as const;

const updateSchema = z.object({
  userId: z.string().min(1),
  module: z.enum(moduleValues),
  accessLevel: z.enum(accessLevelValues).nullable(),
});

export async function GET() {
  const access = await requireApiModuleAccess("admin", ["ADMIN"]);
  if (access.error) return access.error;

  await ensureUserModuleAccessTable();

  const [users, rows] = await Promise.all([
    prisma.user.findMany({
      include: { team: { select: { name: true } } },
      orderBy: { name: "asc" },
      take: 1000,
    }),
    userModuleAccessClient.findMany({
      select: {
        id: true,
        userId: true,
        module: true,
        accessLevel: true,
        updatedAt: true,
      },
      orderBy: [{ userId: "asc" }, { module: "asc" }],
      take: 5000,
    }),
  ]);

  return NextResponse.json({
    data: {
      modules: AUTHORIZATION_MODULE_OPTIONS,
      accessLevels: accessLevelValues,
      users: users.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        jobTitle: user.jobTitle,
        teamName: user.team?.name ?? "Sans equipe",
      })),
      assignments: (rows as Array<{ id: string; userId: string; module: string; accessLevel: string; updatedAt: Date }>).map((row) => ({
        id: row.id,
        userId: row.userId,
        module: row.module,
        accessLevel: row.accessLevel,
        updatedAt: row.updatedAt.toISOString(),
      })),
    },
  });
}

export async function PATCH(request: NextRequest) {
  const access = await requireApiModuleAccess("admin", ["ADMIN"]);
  if (access.error) return access.error;

  await ensureUserModuleAccessTable();

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { userId, module, accessLevel } = parsed.data;

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true } });
  if (!user) {
    return NextResponse.json({ error: "Employe introuvable." }, { status: 404 });
  }

  if (accessLevel === null) {
    await userModuleAccessClient.deleteMany({ where: { userId, module } });

    await writeActivityLog({
      actorId: access.session.user.id,
      action: "USER_MODULE_ACCESS_REMOVED",
      entityType: "USER",
      entityId: userId,
      summary: `Autorisation retiree pour ${user.name} sur ${module}.`,
      payload: {
        module,
        removedBy: access.session.user.name ?? "Administrateur",
      },
    });

    return NextResponse.json({ data: { userId, module, accessLevel: null } });
  }

  const saved = await userModuleAccessClient.upsert({
    where: {
      userId_module: {
        userId,
        module,
      },
    },
    update: {
      accessLevel,
      createdById: access.session.user.id,
    },
    create: {
      userId,
      module,
      accessLevel,
      createdById: access.session.user.id,
    },
    select: {
      id: true,
      userId: true,
      module: true,
      accessLevel: true,
      updatedAt: true,
    },
  });

  await writeActivityLog({
    actorId: access.session.user.id,
    action: "USER_MODULE_ACCESS_UPDATED",
    entityType: "USER",
    entityId: userId,
    summary: `Autorisation ${accessLevel} accordee pour ${user.name} sur ${module}.`,
    payload: {
      module,
      accessLevel: accessLevel as ModuleAccessLevel,
      grantedBy: access.session.user.name ?? "Administrateur",
    },
  });

  return NextResponse.json({
    data: {
      id: saved.id,
      userId: saved.userId,
      module: saved.module,
      accessLevel: saved.accessLevel,
      updatedAt: saved.updatedAt.toISOString(),
    },
  });
}
