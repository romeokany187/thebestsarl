import { AppShell } from "@/components/app-shell";
import { requirePageRoles } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const { role } = await requirePageRoles(["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);

  const [latestReports, latestLogs] = await Promise.all([
    prisma.workerReport.findMany({
      include: { author: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
      take: 6,
    }),
    prisma.auditLog.findMany({
      include: { actor: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 6,
    }),
  ]);

  return (
    <AppShell role={role} accessNote="Inbox opérationnelle: dernières activités, validations et événements système.">
      <section className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
        <p className="text-sm text-black/60 dark:text-white/60">Centre de notifications et historique des actions récentes.</p>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <h2 className="mb-4 text-lg font-semibold">Rapports récents</h2>
          <ul className="space-y-3 text-sm">
            {latestReports.map((report) => (
              <li key={report.id} className="rounded-xl border border-black/10 px-3 py-3 dark:border-white/10">
                <p className="font-medium">{report.title}</p>
                <p className="text-xs text-black/60 dark:text-white/60">{report.author.name} • {report.status}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <h2 className="mb-4 text-lg font-semibold">Journal d&apos;activité</h2>
          <ul className="space-y-3 text-sm">
            {latestLogs.map((log) => (
              <li key={log.id} className="rounded-xl border border-black/10 px-3 py-3 dark:border-white/10">
                <p className="font-medium">{log.action}</p>
                <p className="text-xs text-black/60 dark:text-white/60">{log.actor.name} • {new Date(log.createdAt).toLocaleString()}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </AppShell>
  );
}
