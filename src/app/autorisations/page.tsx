import { AppShell } from "@/components/app-shell";
import { UserAuthorizationsAdmin } from "@/components/user-authorizations-admin";
import { prisma } from "@/lib/prisma";
import { requirePageModuleAccess } from "@/lib/rbac";
import { AUTHORIZATION_MODULE_OPTIONS, ensureUserModuleAccessTable } from "@/lib/user-module-access";

const userModuleAccessClient = (prisma as unknown as { userModuleAccess: any }).userModuleAccess;

export const dynamic = "force-dynamic";

export default async function AuthorizationsPage() {
  const { role } = await requirePageModuleAccess("admin", ["ADMIN"]);

  await ensureUserModuleAccessTable();

  const [users, assignments] = await Promise.all([
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

  return (
    <AppShell role={role} accessNote="Administration des droits par service et par niveau d'acces pour chaque employe affecte.">
      <section className="mb-5">
        <h1 className="text-2xl font-semibold">Autorisations</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Configure les acces par employe: service cible, lecture seulement, ecriture & lecture, ou acces complet.
        </p>
      </section>

      <UserAuthorizationsAdmin
        users={users.map((user) => ({
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          jobTitle: user.jobTitle,
          teamName: user.team?.name ?? "Sans equipe",
        }))}
        modules={AUTHORIZATION_MODULE_OPTIONS}
        assignments={(assignments as Array<{ id: string; userId: string; module: string; accessLevel: "READ" | "WRITE" | "FULL"; updatedAt: Date }>).map((item) => ({
          id: item.id,
          userId: item.userId,
          module: item.module,
          accessLevel: item.accessLevel,
          updatedAt: item.updatedAt.toISOString(),
        }))}
      />
    </AppShell>
  );
}
