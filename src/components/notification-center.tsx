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
    return { href: `/inbox/validate#payment-${paymentOrderId}`, label: "Aller à la section OP à approuver" };
  }

  if (notification.type === "PAYMENT_ORDER_EXECUTION_REQUIRED" && paymentOrderId) {
    return { href: `/inbox/execute#payment-${paymentOrderId}`, label: "Aller à la section OP à exécuter" };
  }

  if (notification.type.startsWith("PAYMENT_ORDER_") && paymentOrderId) {
    return { href: `/inbox/history#payment-${paymentOrderId}`, label: "Aller à l'historique OP" };
  }

  if (notification.type === "PROCUREMENT_APPROVAL" && needRequestId) {
    return { href: `/inbox/validate#need-${needRequestId}`, label: "Aller à la section EDB à approuver" };
  }

  if (notification.type === "PROCUREMENT_FINANCE_EXECUTION" && needRequestId) {
    return { href: `/inbox/execute#need-${needRequestId}`, label: "Aller à la section EDB à exécuter" };
  }

  if (notification.type.startsWith("PROCUREMENT_") && needRequestId) {
    return { href: `/inbox/history#need-${needRequestId}`, label: "Aller à l'historique EDB" };
  }

  if (notification.type === "NEWS") {
    return { href: "/news", label: "Ouvrir le communiqué" };
  }

  if (notification.type === "PAYMENT_ENTRY" || notification.type.startsWith("CASH_OPERATION")) {
    return { href: "/payments", label: "Ouvrir le module Paiements" };
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
    <section className="space-y-3">
      {notifications.length === 0 ? (
        <div className="rounded-2xl border border-black/10 bg-white p-5 text-sm text-black/60 shadow-sm dark:border-white/10 dark:bg-zinc-900 dark:text-white/60">
          Aucune notification pour le moment.
        </div>
      ) : notifications.map((notification) => {
        const target = notificationTarget(notification);

        return (
          <Link key={notification.id} href={target.href} className="block">
            <article className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm transition hover:border-black/20 hover:bg-black/[0.02] dark:border-white/10 dark:bg-zinc-900 dark:hover:border-white/20 dark:hover:bg-white/[0.02]">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{notification.title}</p>
                    {!notification.isRead ? (
                      <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-semibold text-white">Nouveau</span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[11px] text-black/50 dark:text-white/50">{formatWhen(notification.createdAt)}</p>
                </div>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${notificationBadgeClass(notification.type)}`}>
                  {notificationTypeLabel(notification.type)}
                </span>
              </div>

              <p className="mt-3 text-sm text-black/70 dark:text-white/70">{notification.message}</p>

              <div className="mt-3 flex items-center justify-between gap-2 text-[11px] font-semibold text-black/55 dark:text-white/55">
                <span>{target.label}</span>
                <span aria-hidden="true">→</span>
              </div>
            </article>
          </Link>
        );
      })}
    </section>
  );
}
