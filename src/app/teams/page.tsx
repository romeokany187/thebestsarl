import { AppShell } from "@/components/app-shell";
import { TeamAssignmentAdmin } from "@/components/team-assignment-admin";
import { requirePageRoles } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function containsAny(value: string, terms: string[]) {
  const normalized = value.toUpperCase();
  return terms.some((term) => normalized.includes(term));
}

function roleLabel(role: string) {
  if (role === "ADMIN") return "Admin";
  if (role === "MANAGER") return "Manager";
  if (role === "ACCOUNTANT") return "Comptable";
  return "Agent";
}

export default async function TeamsPage() {
  const { role } = await requirePageRoles(["ADMIN", "MANAGER", "ACCOUNTANT"]);

  const [teams, sites, users] = await Promise.all([
    prisma.team.findMany({
      include: {
        users: {
          select: { id: true, name: true, role: true, email: true },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.workSite.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        teamId: true,
        team: { select: { name: true } },
      },
      where: { role: { in: ["EMPLOYEE", "MANAGER", "ADMIN"] } },
      orderBy: { name: "asc" },
    }),
  ]);

  const headOffice = sites.find((site) =>
    site.type === "OFFICE" && containsAny(site.name, ["KINSHASA", "DIRECTION", "DG"]),
  );

  const branches = sites.filter((site) =>
    site.type === "OFFICE" && site.id !== headOffice?.id,
  );

  const partners = sites.filter((site) => site.type === "PARTNER");

  const fallbackPartners = ["HKSERVICE", "Mr SAMMY"];
  const displayedPartners = partners.length > 0
    ? partners.map((partner) => partner.name)
    : fallbackPartners;

  return (
    <AppShell
      role={role}
      accessNote="Vue organisation: structure des équipes, répartition des rôles et contacts internes."
    >
      <section className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Équipes</h1>
        <p className="text-sm text-black/60 dark:text-white/60">Gestion des équipes, collaborateurs et responsabilités.</p>
      </section>

      <section className="mb-6 rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <h2 className="text-lg font-semibold">Réseau d&apos;agences et partenaires</h2>
        <p className="mt-1 text-xs text-black/60 dark:text-white/60">Organisation opérationnelle: direction générale, succursales et partenaires externes.</p>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <article className="rounded-xl border border-black/10 p-4 dark:border-white/10">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Direction générale</p>
              <span className="rounded-full border border-black/15 bg-black/5 px-2 py-0.5 text-[10px] font-semibold dark:border-white/20 dark:bg-white/10">DG</span>
            </div>
            <p className="mt-2 text-sm font-semibold">{headOffice?.name ?? "Agence de Kinshasa (Direction Générale)"}</p>
          </article>

          <article className="rounded-xl border border-black/10 p-4 dark:border-white/10">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Succursales</p>
              <span className="rounded-full border border-black/15 bg-black/5 px-2 py-0.5 text-[10px] font-semibold dark:border-white/20 dark:bg-white/10">Agence</span>
            </div>
            <ul className="mt-2 space-y-2 text-sm">
              {(branches.length > 0
                ? branches.map((branch) => branch.name)
                : ["Agence de Mbujimayi", "Agence de Lubumbashi"]
              ).map((branch) => (
                <li key={branch} className="flex items-center justify-between rounded-md border border-black/10 px-2 py-1 dark:border-white/10">
                  <span>{branch}</span>
                  <span className="rounded-full border border-black/15 bg-black/5 px-2 py-0.5 text-[10px] font-semibold dark:border-white/20 dark:bg-white/10">Succursale</span>
                </li>
              ))}
            </ul>
          </article>

          <article className="rounded-xl border border-black/10 p-4 dark:border-white/10">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Partenaires</p>
              <span className="rounded-full border border-black/15 bg-black/5 px-2 py-0.5 text-[10px] font-semibold dark:border-white/20 dark:bg-white/10">Externe</span>
            </div>
            <ul className="mt-2 space-y-2 text-sm">
              {displayedPartners.map((partner) => (
                <li key={partner} className="flex items-center justify-between rounded-md border border-black/10 px-2 py-1 dark:border-white/10">
                  <span>{partner}</span>
                  <span className="rounded-full border border-black/15 bg-black/5 px-2 py-0.5 text-[10px] font-semibold dark:border-white/20 dark:bg-white/10">Partenaire</span>
                </li>
              ))}
            </ul>
          </article>
        </div>
      </section>

      <section className="mb-6">
        <TeamAssignmentAdmin
          users={users.map((user) => ({
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            teamId: user.teamId,
            teamName: user.team?.name ?? "Sans équipe",
          }))}
          teams={teams.map((team) => ({ id: team.id, name: team.name }))}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {teams.map((team) => (
          <article key={team.id} className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">{team.name}</h2>
              <span className="rounded-full border border-black/15 bg-black/5 px-2 py-0.5 text-[10px] font-semibold dark:border-white/20 dark:bg-white/10">
                {team.users.length} membre(s)
              </span>
            </div>
            <ul className="mt-4 space-y-2 text-sm">
              {team.users.map((user) => (
                <li key={user.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-black/10 px-3 py-2 dark:border-white/10">
                  <span className="font-medium">{user.name}</span>
                  <span className="inline-flex items-center gap-1 text-xs text-black/60 dark:text-white/60">
                    <span className="rounded-full border border-black/15 bg-black/5 px-2 py-0.5 text-[10px] font-semibold dark:border-white/20 dark:bg-white/10">{roleLabel(user.role)}</span>
                    <span>• {user.email}</span>
                  </span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </AppShell>
  );
}
