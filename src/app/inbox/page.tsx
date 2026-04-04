import { AppShell } from "@/components/app-shell";
import { NotificationCenter } from "@/components/notification-center";
import { prisma } from "@/lib/prisma";
import { requirePageModuleAccess } from "@/lib/rbac";

export const dynamic = "force-dynamic";

type InboxTab = "notifications" | "validate" | "execute" | "history";

function hasNeedExecutionMarker(value?: string | null) {
  return (value ?? "").includes("EXECUTION_CAISSE:");
}

function resolveInitialTab(
  requestedTab: string | undefined,
  validateCount: number,
  executeCount: number,
  historyCount: number,
  role: string,
  jobTitle: string,
): InboxTab {
  if (requestedTab === "notifications" || requestedTab === "validate" || requestedTab === "execute" || requestedTab === "history") {
    return requestedTab;
  }

  if ((role === "ADMIN" || role === "DIRECTEUR_GENERAL") && validateCount > 0) {
    return "validate";
  }

  if (jobTitle === "CAISSIER" && executeCount > 0) {
    return "execute";
  }

  if ((role === "ACCOUNTANT" || jobTitle === "COMPTABLE") && historyCount > 0) {
    return "history";
  }

  return "notifications";
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const params = await searchParams;
  const { role, session } = await requirePageModuleAccess("profile", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  const userId = session.user.id;
  const currentJobTitle = session.user.jobTitle ?? "AGENT_TERRAIN";

  await prisma.userNotification.updateMany({
    where: {
      userId,
      isRead: false,
    },
    data: { isRead: true },
  });

  const canValidatePaymentOrders = role === "ADMIN";
  const canValidateNeeds = role === "ADMIN" || role === "DIRECTEUR_GENERAL";
  const canExecuteFromCash = currentJobTitle === "CAISSIER";
  const canViewHistory = role === "ADMIN" || role === "DIRECTEUR_GENERAL" || role === "ACCOUNTANT" || currentJobTitle === "CAISSIER" || currentJobTitle === "COMPTABLE";

  const paymentOrderClient = (prisma as unknown as { paymentOrder: any }).paymentOrder;

  const [notifications, pendingApprovalOrders, pendingApprovalNeeds, pendingExecutionOrders, pendingExecutionNeeds, completedOrders, completedNeeds] = await Promise.all([
    prisma.userNotification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 60,
    }),
    canValidatePaymentOrders
      ? paymentOrderClient.findMany({
          where: { status: "SUBMITTED" },
          include: {
            issuedBy: { select: { name: true, jobTitle: true } },
            approvedBy: { select: { name: true, jobTitle: true } },
            executedBy: { select: { name: true, jobTitle: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 120,
        })
      : Promise.resolve([]),
    canValidateNeeds
      ? prisma.needRequest.findMany({
          where: { status: "SUBMITTED" },
          include: {
            requester: { select: { name: true, jobTitle: true } },
            reviewedBy: { select: { name: true, jobTitle: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 120,
        })
      : Promise.resolve([]),
    canExecuteFromCash
      ? paymentOrderClient.findMany({
          where: { status: "APPROVED" },
          include: {
            issuedBy: { select: { name: true, jobTitle: true } },
            approvedBy: { select: { name: true, jobTitle: true } },
            executedBy: { select: { name: true, jobTitle: true } },
          },
          orderBy: { approvedAt: "desc" },
          take: 120,
        })
      : Promise.resolve([]),
    canExecuteFromCash
      ? prisma.needRequest.findMany({
          where: { status: "APPROVED" },
          include: {
            requester: { select: { name: true, jobTitle: true } },
            reviewedBy: { select: { name: true, jobTitle: true } },
          },
          orderBy: { approvedAt: "desc" },
          take: 120,
        })
      : Promise.resolve([]),
    canViewHistory
      ? paymentOrderClient.findMany({
          where: { status: { in: ["APPROVED", "EXECUTED", "REJECTED"] } },
          include: {
            issuedBy: { select: { name: true, jobTitle: true } },
            approvedBy: { select: { name: true, jobTitle: true } },
            executedBy: { select: { name: true, jobTitle: true } },
          },
          orderBy: [{ executedAt: "desc" }, { approvedAt: "desc" }, { createdAt: "desc" }],
          take: 120,
        })
      : Promise.resolve([]),
    canViewHistory
      ? prisma.needRequest.findMany({
          where: { status: { in: ["APPROVED", "REJECTED"] } },
          include: {
            requester: { select: { name: true, jobTitle: true } },
            reviewedBy: { select: { name: true, jobTitle: true } },
          },
          orderBy: [{ sealedAt: "desc" }, { approvedAt: "desc" }, { createdAt: "desc" }],
          take: 120,
        })
      : Promise.resolve([]),
  ]);

  const filteredExecutionNeeds = pendingExecutionNeeds.filter((need: any) => !hasNeedExecutionMarker(need.reviewComment));
  const filteredCompletedNeeds = completedNeeds.filter((need: any) => need.status === "REJECTED" || need.approvedAt || hasNeedExecutionMarker(need.reviewComment));

  const initialTab = resolveInitialTab(
    params.tab,
    pendingApprovalOrders.length + pendingApprovalNeeds.length,
    pendingExecutionOrders.length + filteredExecutionNeeds.length,
    completedOrders.length + filteredCompletedNeeds.length,
    role,
    currentJobTitle,
  );

  return (
    <AppShell
      role={role}
      accessNote="Centre de notifications: vue compacte type réseau social, ouverture des actions en modal et accès direct aux circuits OP / EDB par statut."
    >
      <section className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Notifications & Actions</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Ouvrez ici vos alertes, traitez une seule fois les OP / EDB et accédez ensuite aux sections métier appropriées.
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
        pendingApprovalOrders={pendingApprovalOrders.map((order: any) => ({
          ...order,
          createdAt: order.createdAt.toISOString(),
          submittedAt: order.submittedAt?.toISOString() ?? null,
          approvedAt: order.approvedAt?.toISOString() ?? null,
          executedAt: order.executedAt?.toISOString() ?? null,
        }))}
        pendingApprovalNeeds={pendingApprovalNeeds.map((need) => ({
          ...need,
          createdAt: need.createdAt.toISOString(),
          submittedAt: need.submittedAt?.toISOString() ?? null,
          approvedAt: need.approvedAt?.toISOString() ?? null,
          sealedAt: need.sealedAt?.toISOString() ?? null,
        }))}
        pendingExecutionOrders={pendingExecutionOrders.map((order: any) => ({
          ...order,
          createdAt: order.createdAt.toISOString(),
          submittedAt: order.submittedAt?.toISOString() ?? null,
          approvedAt: order.approvedAt?.toISOString() ?? null,
          executedAt: order.executedAt?.toISOString() ?? null,
        }))}
        pendingExecutionNeeds={filteredExecutionNeeds.map((need: any) => ({
          ...need,
          createdAt: need.createdAt.toISOString(),
          submittedAt: need.submittedAt?.toISOString() ?? null,
          approvedAt: need.approvedAt?.toISOString() ?? null,
          sealedAt: need.sealedAt?.toISOString() ?? null,
        }))}
        completedOrders={completedOrders.map((order: any) => ({
          ...order,
          createdAt: order.createdAt.toISOString(),
          submittedAt: order.submittedAt?.toISOString() ?? null,
          approvedAt: order.approvedAt?.toISOString() ?? null,
          executedAt: order.executedAt?.toISOString() ?? null,
        }))}
        completedNeeds={filteredCompletedNeeds.map((need: any) => ({
          ...need,
          createdAt: need.createdAt.toISOString(),
          submittedAt: need.submittedAt?.toISOString() ?? null,
          approvedAt: need.approvedAt?.toISOString() ?? null,
          sealedAt: need.sealedAt?.toISOString() ?? null,
        }))}
        initialTab={initialTab}
      />
    </AppShell>
  );
}
