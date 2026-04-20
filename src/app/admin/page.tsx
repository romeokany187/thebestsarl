import { AppShell } from "@/components/app-shell";
import { AdminCommissionQuickForm } from "@/components/admin-commission-quick-form";
import { AdminOpeningBalances } from "@/components/admin-opening-balances";
import { UserJobTitleAdmin } from "@/components/user-job-title-admin";
import { prisma } from "@/lib/prisma";
import { requirePageModuleAccess } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const { role, session } = await requirePageModuleAccess("admin", ["ADMIN"]);

  const [users, airlines, openingBalances] = await Promise.all([
    prisma.user.findMany({
      include: { team: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.airline.findMany({
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    prisma.cashOperation.findMany({
      where: { category: "OPENING_BALANCE" },
      include: { createdBy: { select: { name: true } } },
      orderBy: { occurredAt: "desc" },
      take: 200,
    }),
  ]);

  return (
    <AppShell role={role} accessNote="Accès administrateur: gestion des utilisateurs, équipes et paramétrage rapide des commissions.">
      <section className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Administration</h1>
            <p className="text-sm text-black/60 dark:text-white/60">
              Référentiel des utilisateurs, équipes et paramètres essentiels.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href="/admin/approvals"
              className="rounded-md border border-black/20 px-3 py-2 text-sm font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
            >
              Ouvrir OP & EDB à approuver
            </a>
            <a
              href="/admin/ordres-paiement"
              className="rounded-md border border-black/20 px-3 py-2 text-sm font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
            >
              Ouvrir OP Admin
            </a>
          </div>
        </div>
      </section>

      <section className="mb-6">
        <AdminCommissionQuickForm airlines={airlines} />
      </section>

      <section className="mt-6">
        <UserJobTitleAdmin
          users={users.map((user) => ({
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            jobTitle: user.jobTitle,
            teamName: user.team?.name ?? "Sans équipe",
            passwordConfigured: Boolean(user.passwordHash?.trim()),
          }))}
          currentUserId={session.user.id}
        />
      </section>

      <section className="mt-6">
        <AdminOpeningBalances
          entries={openingBalances.map((entry) => ({
            id: entry.id,
            occurredAt: entry.occurredAt.toISOString(),
            method: entry.method,
            currency: entry.currency,
            amount: entry.amount,
            reference: entry.reference ?? null,
            description: entry.description,
            createdByName: entry.createdBy?.name ?? null,
          }))}
        />
      </section>
    </AppShell>
  );
}
