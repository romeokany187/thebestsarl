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
    <AppShell
      role={role}
      accessNote="Notifications simples: un clic sur chaque notification redirige vers la section OP / EDB appropriée."
    >
      <section className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Ici, vous voyez uniquement vos notifications. Chaque notification a une seule action: cliquer pour être redirigé vers la bonne section de traitement.
        </p>
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
