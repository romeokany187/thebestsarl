import { AppShell } from "@/components/app-shell";
import { assignmentCapabilities, jobTitleLabel } from "@/lib/assignment";
import { requirePageRoles } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const { role, session } = await requirePageRoles(["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  const userId = session.user.id;
  const currentJobTitle = session.user.jobTitle ?? "AGENT_TERRAIN";
  const capabilities = assignmentCapabilities(currentJobTitle);

  const [notifications, latestLogs] = await Promise.all([
    prisma.userNotification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 12,
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
        <p className="text-sm text-black/60 dark:text-white/60">Centre de notifications, affectations et historique des actions récentes.</p>
      </section>

      <section className="mb-4 rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <h2 className="text-lg font-semibold">Fonction actuelle: {jobTitleLabel(currentJobTitle)}</h2>
        <ul className="mt-3 flex flex-wrap gap-2 text-xs">
          {capabilities.map((capability) => (
            <li key={capability} className="rounded-full border border-black/15 bg-black/5 px-2.5 py-1 font-medium dark:border-white/20 dark:bg-white/10">
              {capability}
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <h2 className="mb-4 text-lg font-semibold">Mes notifications</h2>
          <ul className="space-y-3 text-sm">
            {notifications.length > 0 ? (
              notifications.map((notification) => (
                <li key={notification.id} className="rounded-xl border border-black/10 px-3 py-3 dark:border-white/10">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{notification.title}</p>
                    <span className="rounded-full border border-black/15 bg-black/5 px-2 py-0.5 text-[10px] font-semibold dark:border-white/20 dark:bg-white/10">
                      {notification.type}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-black/70 dark:text-white/70">{notification.message}</p>
                  <p className="mt-1 text-[11px] text-black/50 dark:text-white/50">{new Date(notification.createdAt).toLocaleString()}</p>
                </li>
              ))
            ) : (
              <li className="rounded-xl border border-black/10 px-3 py-3 text-xs text-black/60 dark:border-white/10 dark:text-white/60">
                Aucune notification pour le moment.
              </li>
            )}
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
