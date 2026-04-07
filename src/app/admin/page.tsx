import { AppShell } from "@/components/app-shell";
import { AdminCommissionQuickForm } from "@/components/admin-commission-quick-form";
import { UserJobTitleAdmin } from "@/components/user-job-title-admin";
import { WorkSiteAdmin } from "@/components/worksite-admin";
import { prisma } from "@/lib/prisma";
import { requirePageModuleAccess } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const { role } = await requirePageModuleAccess("admin", ["ADMIN"]);

  const [users, airlines, sites] = await Promise.all([
    prisma.user.findMany({
      include: { team: true },
      orderBy: { createdAt: "desc" },
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Administration</h1>
            <p className="text-sm text-black/60 dark:text-white/60">
              Référentiel des utilisateurs, équipes et paramètres essentiels.
            </p>
          </div>
          <a
            href="/admin/approvals"
            className="rounded-md border border-black/20 px-3 py-2 text-sm font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Ouvrir OP & EDB à approuver
          </a>
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
          }))}
        />
      </section>

      <section className="mt-6">
        <WorkSiteAdmin sites={sites} />
      </section>
    </AppShell>
  );
}
