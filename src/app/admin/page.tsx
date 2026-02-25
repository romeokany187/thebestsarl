import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/prisma";
import { requirePageRoles } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const { role } = await requirePageRoles(["ADMIN"]);

  const [users, teams, airlines, rules] = await Promise.all([
    prisma.user.findMany({
      include: { team: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.team.findMany({
      include: { users: true },
      orderBy: { name: "asc" },
    }),
    prisma.airline.findMany({
      orderBy: { name: "asc" },
    }),
    prisma.commissionRule.findMany({
      include: { airline: true },
      where: { isActive: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <AppShell role={role} accessNote="Accès administrateur: gestion complète des utilisateurs, équipes et règles de commission.">
      <section className="mb-6">
        <h1 className="text-2xl font-semibold">Administration</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Référentiel des utilisateurs, équipes, compagnies et règles de commission.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
          <h2 className="text-lg font-semibold">Utilisateurs & rôles</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {users.map((user) => (
              <li key={user.id} className="rounded-md border border-black/10 px-3 py-2 dark:border-white/10">
                {user.name} • {user.role} • {user.team?.name ?? "Sans équipe"}
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

        <div className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
          <h2 className="text-lg font-semibold">Compagnies</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {airlines.map((airline) => (
              <li key={airline.id} className="rounded-md border border-black/10 px-3 py-2 dark:border-white/10">
                {airline.code} - {airline.name}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
          <h2 className="text-lg font-semibold">Règles de commission actives</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {rules.map((rule) => (
              <li key={rule.id} className="rounded-md border border-black/10 px-3 py-2 dark:border-white/10">
                {rule.airline.code} • {rule.ratePercent}%
              </li>
            ))}
          </ul>
        </div>
      </div>
    </AppShell>
  );
}
