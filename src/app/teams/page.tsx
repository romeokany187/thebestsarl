import { AppShell } from "@/components/app-shell";
import { requirePageRoles } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function TeamsPage() {
  const { role } = await requirePageRoles(["ADMIN", "MANAGER", "ACCOUNTANT"]);

  const teams = await prisma.team.findMany({
    include: {
      users: {
        select: { id: true, name: true, role: true, email: true },
      },
    },
    orderBy: { name: "asc" },
  });

  return (
    <AppShell
      role={role}
      accessNote="Vue organisation: structure des équipes, répartition des rôles et contacts internes."
    >
      <section className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Équipes</h1>
        <p className="text-sm text-black/60 dark:text-white/60">Gestion des équipes, collaborateurs et responsabilités.</p>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {teams.map((team) => (
          <article key={team.id} className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
            <h2 className="text-lg font-semibold">{team.name}</h2>
            <p className="mt-1 text-xs text-black/60 dark:text-white/60">{team.users.length} membre(s)</p>
            <ul className="mt-4 space-y-2 text-sm">
              {team.users.map((user) => (
                <li key={user.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-black/10 px-3 py-2 dark:border-white/10">
                  <span className="font-medium">{user.name}</span>
                  <span className="text-xs text-black/60 dark:text-white/60">{user.role} • {user.email}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </AppShell>
  );
}
