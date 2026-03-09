import { AppShell } from "@/components/app-shell";
import { AdminSeedDemoButton } from "@/components/admin-seed-demo-button";
import { AdminCommissionQuickForm } from "@/components/admin-commission-quick-form";
import { UserJobTitleAdmin } from "@/components/user-job-title-admin";
import { WorkSiteAdmin } from "@/components/worksite-admin";
import { prisma } from "@/lib/prisma";
import { requirePageModuleAccess } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const { role } = await requirePageModuleAccess("admin", ["ADMIN"]);

  const [users, teams, airlines, sites] = await Promise.all([
    prisma.user.findMany({
      include: { team: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.team.findMany({
      include: { users: true },
      orderBy: { name: "asc" },
    }),
    prisma.airline.findMany({
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    prisma.workSite.findMany({
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <AppShell role={role} accessNote="Accès administrateur: gestion des utilisateurs, équipes et paramétrage rapide des commissions.">
      <section className="mb-6">
        <h1 className="text-2xl font-semibold">Administration</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Référentiel des utilisateurs, équipes et paramètres essentiels.
        </p>
      </section>

      <section className="mb-6">
        <AdminSeedDemoButton />
      </section>

      <section className="mb-6">
        <AdminCommissionQuickForm airlines={airlines} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
          <h2 className="text-lg font-semibold">Utilisateurs & rôles</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {users.map((user) => (
              <li key={user.id} className="rounded-md border border-black/10 px-3 py-2 dark:border-white/10">
                {user.name} • {user.role} • {user.jobTitle} • {user.team?.name ?? "Sans équipe"}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
          <h2 className="text-lg font-semibold">Equipes</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {teams.map((team) => (
              <li key={team.id} className="rounded-md border border-black/10 px-3 py-2 dark:border-white/10">
                {team.name} • {team.users.length} membres
              </li>
            ))}
          </ul>
        </div>
      </div>

      <section className="mt-6">
        <UserJobTitleAdmin
          users={users.map((user) => ({
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            jobTitle: user.jobTitle,
            teamName: user.team?.name ?? "Sans équipe",
          }))}
        />
      </section>

      <section className="mt-6">
        <WorkSiteAdmin sites={sites} />
      </section>
    </AppShell>
  );
}
