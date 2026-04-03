import { AppShell } from "@/components/app-shell";
import { ProcurementHub } from "@/components/procurement-hub";
import { prisma } from "@/lib/prisma";
import { requirePageModuleAccess } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function ApprovisionnementPage() {
  const { role, session } = await requirePageModuleAccess("procurement", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);

  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { jobTitle: true, role: true },
  });

  const [needs, stockItems, movements, allUsersRaw] = await Promise.all([
    prisma.needRequest.findMany({
      include: {
        requester: { select: { id: true, name: true, jobTitle: true } },
        reviewedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.stockItem.findMany({
      orderBy: [{ category: "asc" }, { name: "asc" }],
      take: 300,
    }),
    prisma.stockMovement.findMany({
      include: {
        stockItem: { select: { id: true, name: true, category: true, unit: true } },
        performedBy: { select: { id: true, name: true } },
        needRequest: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 400,
    }),
    prisma.user.findMany({
      where: { teamId: { not: null } },
      select: { id: true, name: true, team: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
  ]);

  const allUsers = allUsersRaw.map((u) => ({ id: u.id, name: u.name, teamName: u.team?.name ?? null }));

  const isAdminReadOnly = role === "ADMIN";
  const canCreateNeed = !isAdminReadOnly && (role === "MANAGER" || me?.jobTitle === "APPROVISIONNEMENT");
  const canApproveNeed = false;
  const canManageStock = !isAdminReadOnly && (role === "MANAGER" || me?.jobTitle === "APPROVISIONNEMENT");

  return (
    <AppShell
      role={role}
      accessNote={isAdminReadOnly
        ? "Mode lecture: consultation des états de besoin, fiche stock et rapports PDF uniquement."
        : "Approvisionnement: émission des états de besoin, validation du Directeur Général via inbox, puis exécution financière et suivi stock avec traçabilité."}
    >
      <section className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Approvisionnement</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          État de besoin, validation, passage à l&apos;achat et gestion dynamique des biens matériels.
        </p>
      </section>

      <ProcurementHub
        initialNeeds={needs.map((need) => ({
          ...need,
          submittedAt: need.submittedAt?.toISOString() ?? null,
          approvedAt: need.approvedAt?.toISOString() ?? null,
          sealedAt: need.sealedAt?.toISOString() ?? null,
          createdAt: need.createdAt.toISOString(),
        }))}
        initialStock={stockItems.map((item) => ({
          ...item,
          updatedAt: item.updatedAt.toISOString(),
        }))}
        initialMovements={movements.map((movement) => ({
          ...movement,
          createdAt: movement.createdAt.toISOString(),
        }))}
        canCreateNeed={canCreateNeed}
        canApproveNeed={canApproveNeed}
        canManageStock={canManageStock}
        hideNeedWorkflow={isAdminReadOnly}
        hideDynamicStock={isAdminReadOnly}
        allUsers={allUsers}
      />
    </AppShell>
  );
}
