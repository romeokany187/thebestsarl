import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { NotificationCenter } from "@/components/notification-center";
import { prisma } from "@/lib/prisma";
import { requirePageModuleAccess } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const { role, session } = await requirePageModuleAccess("profile", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  const userId = session.user.id;

  await prisma.userNotification.updateMany({
    where: {
      userId,
      isRead: false,
    },
    data: { isRead: true },
  });

  const notifications = await prisma.userNotification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 60,
  });

  return (
    <AppShell role={role}>
      <section className="mb-6 space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
          <span className="rounded-full border border-black bg-black px-3 py-1 text-white dark:border-white dark:bg-white dark:text-black">Notifications</span>
          {(role === "ADMIN" || role === "DIRECTEUR_GENERAL") ? (
            <Link href="/admin/approvals" className="rounded-full border border-black/15 px-3 py-1 dark:border-white/20">À approuver</Link>
          ) : null}
          <Link href="/inbox/execute" className="rounded-full border border-black/15 px-3 py-1 dark:border-white/20">À exécuter</Link>
          <Link href="/inbox/history" className="rounded-full border border-black/15 px-3 py-1 dark:border-white/20">Historique</Link>
        </div>

        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Centre des notifications</h1>
          <p className="text-sm text-black/60 dark:text-white/60">Des lignes d'information qui vous amènent directement au bon écran.</p>
        </div>
      </section>

      <NotificationCenter
        notifications={notifications.map((notification) => ({
          id: notification.id,
          title: notification.title,
          message: notification.message,
          type: notification.type,
          isRead: notification.isRead,
          createdAt: notification.createdAt.toISOString(),
          metadata: (notification.metadata ?? null) as Record<string, unknown> | null,
        }))}
      />
    </AppShell>
  );
}
