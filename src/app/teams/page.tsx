import { AppShell } from "@/components/app-shell";
import { TeamAssignmentAdmin } from "@/components/team-assignment-admin";
import { requirePageRoles } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function TeamsPage() {
  const { role, session } = await requirePageRoles(["ADMIN", "MANAGER", "ACCOUNTANT"]);

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

  const organizationTeams = await prisma.team.findMany({
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
        />
      </section>
    </AppShell>
  );
}
