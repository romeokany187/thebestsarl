"use client";

import Link from "next/link";

type WorkflowNotification = {
  id: string;
  title: string;
  message: string;
  type: string;
  isRead: boolean;
  createdAt: string;
  metadata: Record<string, unknown> | null;
};

function formatWhen(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("fr-FR");
}

function notificationTypeLabel(type: string) {
  if (type === "PAYMENT_ORDER_APPROVAL_REQUIRED") return "OP à approuver";
  if (type === "PAYMENT_ORDER_EXECUTION_REQUIRED") return "OP à exécuter";
  if (type === "PAYMENT_ORDER_EXECUTED_NOTIFICATION") return "OP exécuté";
  if (type === "PROCUREMENT_APPROVAL") return "EDB à approuver";
  if (type === "PROCUREMENT_FINANCE_EXECUTION") return "EDB à exécuter";
  if (type === "NEWS") return "Annonce";
  return type.replaceAll("_", " ");
}

function notificationBadgeClass(type: string) {
  if (type.includes("EXECUTED") || type.includes("APPROVED")) {
    return "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700/50 dark:bg-emerald-950/30 dark:text-emerald-300";
  }

  if (type.includes("EXECUTION")) {
    return "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700/50 dark:bg-blue-950/30 dark:text-blue-300";
  }

  if (type.includes("APPROVAL")) {
    return "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-300";
  }

  return "border-black/15 bg-black/5 text-black/70 dark:border-white/20 dark:bg-white/10 dark:text-white/70";
}

function notificationTarget(notification: WorkflowNotification) {
  const paymentOrderId = typeof notification.metadata?.paymentOrderId === "string"
    ? notification.metadata.paymentOrderId
    : null;
  const needRequestId = typeof notification.metadata?.needRequestId === "string"
    ? notification.metadata.needRequestId
    : null;

  if (notification.type === "PAYMENT_ORDER_APPROVAL_REQUIRED" && paymentOrderId) {
    return { href: `/admin/approvals#payment-${paymentOrderId}`, label: "Ouvrir la route admin d'approbation OP" };
  }

  if (notification.type === "PAYMENT_ORDER_EXECUTION_REQUIRED" && paymentOrderId) {
    return { href: "/payments", label: "Ouvrir Paiements pour exécuter l'OP" };
  }

  if (notification.type.startsWith("PAYMENT_ORDER_") && paymentOrderId) {
    return { href: `/inbox/history#payment-${paymentOrderId}`, label: "Aller à l'historique OP" };
  }

  if (notification.type === "PROCUREMENT_APPROVAL" && needRequestId) {
    return { href: `/admin/approvals#need-${needRequestId}`, label: "Ouvrir la route admin d'approbation EDB" };
  }

  if (notification.type === "PROCUREMENT_FINANCE_EXECUTION" && needRequestId) {
    return { href: "/payments", label: "Ouvrir Paiements pour exécuter l'EDB" };
  }

  if (notification.type.startsWith("PROCUREMENT_") && needRequestId) {
    return { href: `/inbox/history#need-${needRequestId}`, label: "Aller à l'historique EDB" };
  }

  if (notification.type === "NEWS") {
    return { href: "/news", label: "Ouvrir le communiqué" };
  }

  if (notification.type === "PAYMENT_ENTRY" || notification.type.startsWith("CASH_OPERATION")) {
    return { href: "/comptabilite#journal", label: "Ouvrir le livre journal comptable" };
  }

  if (notification.type === "ASSIGNMENT") {
    return { href: "/teams", label: "Ouvrir les affectations" };
  }

  if (notification.type === "MAIL") {
    return { href: "/profile", label: "Ouvrir votre profil" };
  }

  return { href: "/inbox", label: "Ouvrir les notifications" };
}

export function NotificationCenter({
  notifications,
}: {
  notifications: WorkflowNotification[];
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900">
      {notifications.length === 0 ? (
        <div className="p-5 text-sm text-black/60 dark:text-white/60">
          Aucune notification pour le moment.
        </div>
      ) : (
        <div className="divide-y divide-black/10 dark:divide-white/10">
          {notifications.map((notification) => {
            const target = notificationTarget(notification);

            return (
              <Link key={notification.id} href={target.href} className="block px-4 py-3 transition hover:bg-black/3 dark:hover:bg-white/3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] text-black/50 dark:text-white/50">{formatWhen(notification.createdAt)}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${notificationBadgeClass(notification.type)}`}>
                        {notificationTypeLabel(notification.type)}
                      </span>
                      {!notification.isRead ? (
                        <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-semibold text-white">Nouveau</span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm font-medium text-black/85 dark:text-white/85">{notification.title}</p>
                    <p className="mt-1 text-sm text-black/70 dark:text-white/70">{notification.message}</p>
                    <p className="mt-1 text-[11px] font-semibold text-black/55 dark:text-white/55">{target.label} →</p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
