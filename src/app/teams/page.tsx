import { AppShell } from "@/components/app-shell";
import { TeamAssignmentAdmin } from "@/components/team-assignment-admin";
import { requirePageModuleAccess } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type SearchParams = {
  manageTeam?: string;
};

function containsAny(value: string, terms: string[]) {
  const normalized = value.toUpperCase();
  return terms.some((term) => normalized.includes(term));
}

function isAgencyOrPartnerTeamName(name: string) {
  const normalized = name.trim().toUpperCase();
  return normalized !== "OPERATIONS" && normalized !== "OPERATION" && normalized !== "SALES";
}

export default async function TeamsPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const { role, session } = await requirePageModuleAccess("teams", ["ADMIN", "MANAGER", "ACCOUNTANT"]);
  const resolvedSearchParams = (await searchParams) ?? {};

  const [sites, users] = await Promise.all([
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
        jobTitle: true,
        teamId: true,
        team: { select: { name: true } },
      },
      where: { role: { in: ["EMPLOYEE", "MANAGER", "ADMIN", "ACCOUNTANT"] } },
      orderBy: { name: "asc" },
    }),
  ]);

  const organizationSites = sites.filter((site) => site.type === "OFFICE" || site.type === "PARTNER");
  const partnerNames = organizationSites.filter((site) => site.type === "PARTNER").map((site) => site.name);
  const agencyNames = organizationSites.filter((site) => site.type === "OFFICE").map((site) => site.name);

  if (organizationSites.length > 0) {
    await prisma.team.createMany({
      data: organizationSites.map((site) => ({
        name: site.name,
        kind: site.type === "PARTNER" ? "PARTENAIRE" : "AGENCE",
      })),
      skipDuplicates: true,
    });

    if (partnerNames.length > 0) {
      await prisma.team.updateMany({
        where: { name: { in: partnerNames } },
        data: { kind: "PARTENAIRE" },
      });
    }

    if (agencyNames.length > 0) {
      await prisma.team.updateMany({
        where: { name: { in: agencyNames } },
        data: { kind: "AGENCE" },
      });
    }
  }

  const allTeams = await prisma.team.findMany({
    include: {
      users: {
        select: {
          id: true,
          name: true,
          role: true,
          email: true,
          jobTitle: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const headOffice = sites.find((site) =>
    site.type === "OFFICE" && containsAny(site.name, ["KINSHASA", "DIRECTION", "DG"]),
  );

  const branches = sites.filter((site) =>
    site.type === "OFFICE" && site.id !== headOffice?.id,
  );

  const partners = sites.filter((site) => site.type === "PARTNER");

  const displayedPartners = partners.map((partner) => partner.name);

  const manageTeamName = resolvedSearchParams.manageTeam?.trim() ?? "";

  const organizationTeams = allTeams.filter((team) => isAgencyOrPartnerTeamName(team.name));

  const selectedManagedTeam = manageTeamName
    ? organizationTeams.find((team) => team.name.toUpperCase() === manageTeamName.toUpperCase())
    : null;

  const assignmentTargets = organizationTeams.map((team) => ({
    id: team.id,
    name: team.name,
    kind: team.kind,
    createdAt: team.createdAt.toISOString(),
  }));

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
            {headOffice ? (
              <a
                href={`/teams?manageTeam=${encodeURIComponent(headOffice.name)}`}
                className="mt-3 inline-flex rounded-md border border-black/15 px-2.5 py-1 text-[11px] font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
              >
                Gérer
              </a>
            ) : null}
          </article>

          <article className="rounded-xl border border-black/10 p-4 dark:border-white/10">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Succursales</p>
              <span className="rounded-full border border-black/15 bg-black/5 px-2 py-0.5 text-[10px] font-semibold dark:border-white/20 dark:bg-white/10">Agence</span>
            </div>
            <ul className="mt-2 space-y-2 text-sm">
              {(branches.length > 0
                ? branches.map((branch) => branch.name)
                : []
              ).map((branch) => (
                <li key={branch} className="flex items-center justify-between rounded-md border border-black/10 px-2 py-1 dark:border-white/10">
                  <span>{branch}</span>
                  <span className="inline-flex items-center gap-2">
                    <span className="rounded-full border border-black/15 bg-black/5 px-2 py-0.5 text-[10px] font-semibold dark:border-white/20 dark:bg-white/10">Succursale</span>
                    <a
                      href={`/teams?manageTeam=${encodeURIComponent(branch)}`}
                      className="rounded-md border border-black/15 px-2 py-0.5 text-[10px] font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                    >
                      Gérer
                    </a>
                  </span>
                </li>
              ))}
              {branches.length === 0 ? (
                <li className="rounded-xl border border-dashed border-black/15 px-3 py-2 text-xs text-black/55 dark:border-white/20 dark:text-white/55">
                  Aucune succursale disponible.
                </li>
              ) : null}
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
                  <span className="inline-flex items-center gap-2">
                    <span className="rounded-full border border-black/15 bg-black/5 px-2 py-0.5 text-[10px] font-semibold dark:border-white/20 dark:bg-white/10">Partenaire</span>
                    <a
                      href={`/teams?manageTeam=${encodeURIComponent(partner)}`}
                      className="rounded-md border border-black/15 px-2 py-0.5 text-[10px] font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                    >
                      Gérer
                    </a>
                  </span>
                </li>
              ))}
              {displayedPartners.length === 0 ? (
                <li className="rounded-xl border border-dashed border-black/15 px-3 py-2 text-xs text-black/55 dark:border-white/20 dark:text-white/55">
                  Aucun partenaire disponible.
                </li>
              ) : null}
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
            jobTitle: user.jobTitle,
            teamId: user.teamId,
            teamName: user.team?.name ?? "Sans équipe",
          }))}
          teams={assignmentTargets}
          actorRole={role}
          actorTeamName={session.user.teamName ?? null}
          initialSelectedTeamId={selectedManagedTeam?.id}
        />
      </section>
    </AppShell>
  );
}
