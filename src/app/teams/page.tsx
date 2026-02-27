import { AppShell } from "@/components/app-shell";
import { KpiCard } from "@/components/kpi-card";
import { TeamAssignmentAdmin } from "@/components/team-assignment-admin";
import { requirePageRoles } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function containsAny(value: string, terms: string[]) {
  const normalized = value.toUpperCase();
  return terms.some((term) => normalized.includes(term));
}

export default async function TeamsPage() {
  const { role } = await requirePageRoles(["ADMIN", "MANAGER", "ACCOUNTANT"]);

  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));

  const [teams, sites, users, tickets] = await Promise.all([
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
    prisma.ticketSale.findMany({
      where: {
        soldAt: { gte: startOfMonth },
      },
      include: {
        seller: {
          select: {
            id: true,
            name: true,
            teamId: true,
            team: { select: { name: true } },
          },
        },
      },
      orderBy: { soldAt: "desc" },
      take: 3000,
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

  const performanceByAgent = Array.from(
    tickets.reduce((map, ticket) => {
      const key = ticket.seller.id;
      const commission = ticket.commissionAmount ?? ticket.amount * (ticket.commissionRateUsed / 100);
      const existing = map.get(key) ?? {
        userId: ticket.seller.id,
        name: ticket.seller.name,
        teamName: ticket.seller.team?.name ?? "Sans équipe",
        tickets: 0,
        sales: 0,
        commissions: 0,
      };
      existing.tickets += 1;
      existing.sales += ticket.amount;
      existing.commissions += commission;
      map.set(key, existing);
      return map;
    }, new Map<string, { userId: string; name: string; teamName: string; tickets: number; sales: number; commissions: number }>()),
  ).map((entry) => entry[1]).sort((a, b) => b.sales - a.sales);

  const performanceByTeam = Array.from(
    tickets.reduce((map, ticket) => {
      const key = ticket.seller.team?.name ?? "Sans équipe";
      const commission = ticket.commissionAmount ?? ticket.amount * (ticket.commissionRateUsed / 100);
      const existing = map.get(key) ?? {
        teamName: key,
        tickets: 0,
        sales: 0,
        commissions: 0,
      };
      existing.tickets += 1;
      existing.sales += ticket.amount;
      existing.commissions += commission;
      map.set(key, existing);
      return map;
    }, new Map<string, { teamName: string; tickets: number; sales: number; commissions: number }>()),
  ).map((entry) => entry[1]).sort((a, b) => b.sales - a.sales);

  const topAgent = performanceByAgent[0] ?? null;
  const topTeam = performanceByTeam[0] ?? null;
  const totalSales = tickets.reduce((sum, ticket) => sum + ticket.amount, 0);
  const totalCommissions = tickets.reduce(
    (sum, ticket) => sum + (ticket.commissionAmount ?? ticket.amount * (ticket.commissionRateUsed / 100)),
    0,
  );

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
            <p className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Direction générale</p>
            <p className="mt-2 text-sm font-semibold">{headOffice?.name ?? "Agence de Kinshasa (Direction Générale)"}</p>
          </article>

          <article className="rounded-xl border border-black/10 p-4 dark:border-white/10">
            <p className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Succursales</p>
            <ul className="mt-2 space-y-1 text-sm">
              {(branches.length > 0
                ? branches.map((branch) => branch.name)
                : ["Agence de Mbujimayi", "Agence de Lubumbashi"]
              ).map((branch) => (
                <li key={branch}>• {branch}</li>
              ))}
            </ul>
          </article>

          <article className="rounded-xl border border-black/10 p-4 dark:border-white/10">
            <p className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Partenaires</p>
            <ul className="mt-2 space-y-1 text-sm">
              {displayedPartners.map((partner) => (
                <li key={partner}>• {partner}</li>
              ))}
            </ul>
          </article>
        </div>
      </section>

      <section className="mb-6 rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <h2 className="text-lg font-semibold">Évaluation de performance (mois en cours)</h2>
        <p className="mt-1 text-xs text-black/60 dark:text-white/60">Basée sur le volume billets, ventes et commissions.</p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Ventes équipes" value={`${totalSales.toFixed(2)} USD`} />
          <KpiCard label="Commissions équipes" value={`${totalCommissions.toFixed(2)} USD`} />
          <KpiCard label="Top agent" value={topAgent ? `${topAgent.name}` : "-"} hint={topAgent ? `${topAgent.sales.toFixed(2)} USD` : undefined} />
          <KpiCard label="Top équipe" value={topTeam ? topTeam.teamName : "-"} hint={topTeam ? `${topTeam.sales.toFixed(2)} USD` : undefined} />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <article className="rounded-xl border border-black/10 p-4 dark:border-white/10">
            <h3 className="text-sm font-semibold">Classement agents</h3>
            <ul className="mt-2 space-y-2 text-sm">
              {performanceByAgent.slice(0, 8).map((agent) => (
                <li key={agent.userId} className="rounded-md border border-black/10 px-3 py-2 dark:border-white/10">
                  <p className="font-medium">{agent.name}</p>
                  <p className="text-xs text-black/60 dark:text-white/60">
                    {agent.teamName} • {agent.tickets} billets • {agent.sales.toFixed(2)} USD • Comm {agent.commissions.toFixed(2)} USD
                  </p>
                </li>
              ))}
            </ul>
          </article>

          <article className="rounded-xl border border-black/10 p-4 dark:border-white/10">
            <h3 className="text-sm font-semibold">Classement équipes</h3>
            <ul className="mt-2 space-y-2 text-sm">
              {performanceByTeam.slice(0, 8).map((teamMetric) => (
                <li key={teamMetric.teamName} className="rounded-md border border-black/10 px-3 py-2 dark:border-white/10">
                  <p className="font-medium">{teamMetric.teamName}</p>
                  <p className="text-xs text-black/60 dark:text-white/60">
                    {teamMetric.tickets} billets • {teamMetric.sales.toFixed(2)} USD • Comm {teamMetric.commissions.toFixed(2)} USD
                  </p>
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
