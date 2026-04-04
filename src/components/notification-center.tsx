"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PaymentOrderAdminActions } from "@/components/payment-order-admin-actions";
import { PaymentOrderCashExecutionActions } from "@/components/payment-order-cash-execution-actions";
import { ProcurementInboxActions } from "@/components/procurement-inbox-actions";
import { ProcurementCashExecutionActions } from "@/components/procurement-cash-execution-actions";

type InboxTab = "notifications" | "validate" | "execute" | "history";

type WorkflowNotification = {
  id: string;
  title: string;
  message: string;
  type: string;
  isRead: boolean;
  createdAt: string;
  metadata: Record<string, unknown> | null;
};

type PaymentOrderItem = {
  id: string;
  code?: string | null;
  beneficiary: string;
  purpose: string;
  assignment: string;
  description: string;
  amount: number;
  currency?: string | null;
  status: string;
  createdAt: string;
  submittedAt?: string | null;
  approvedAt?: string | null;
  executedAt?: string | null;
  reviewComment?: string | null;
  issuedBy?: { name?: string | null; jobTitle?: string | null } | null;
  approvedBy?: { name?: string | null; jobTitle?: string | null } | null;
  executedBy?: { name?: string | null; jobTitle?: string | null } | null;
};

type NeedItem = {
  id: string;
  code?: string | null;
  title: string;
  category: string;
  estimatedAmount?: number | null;
  currency?: string | null;
  status: string;
  createdAt: string;
  submittedAt?: string | null;
  approvedAt?: string | null;
  sealedAt?: string | null;
  reviewComment?: string | null;
  requester?: { name?: string | null; jobTitle?: string | null } | null;
  reviewedBy?: { name?: string | null; jobTitle?: string | null } | null;
};

type ActionModal = {
  kind: "payment-approve" | "payment-execute" | "need-approve" | "need-execute";
  id: string;
  title: string;
  pdfUrl: string;
};

function formatWhen(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("fr-FR");
}

function normalizeMoneyCurrency(value?: string | null): "USD" | "CDF" {
  const normalized = (value ?? "CDF").trim().toUpperCase();
  return normalized === "USD" ? "USD" : "CDF";
}

function paymentOrderAssignmentLabel(value?: string | null) {
  const normalized = (value ?? "A_MON_COMPTE").trim().toUpperCase();
  if (normalized === "VISAS") return "Visas";
  if (normalized === "SAFETY") return "Safety";
  if (normalized === "BILLETTERIE") return "Billetterie";
  if (normalized === "TSL") return "TSL";
  return "À mon compte";
}

function hasNeedExecutionMarker(value?: string | null) {
  return (value ?? "").includes("EXECUTION_CAISSE:");
}

function paymentStatusLabel(status: string) {
  if (status === "SUBMITTED") return "À valider";
  if (status === "APPROVED") return "À exécuter";
  if (status === "EXECUTED") return "Exécuté";
  if (status === "REJECTED") return "Rejeté";
  return status;
}

function needStatusLabel(status: string, reviewComment?: string | null) {
  if (status === "SUBMITTED") return "À valider";
  if (status === "REJECTED") return "Rejeté";
  if (hasNeedExecutionMarker(reviewComment)) return "Exécuté";
  if (status === "APPROVED") return "Approuvé";
  return status;
}

function statusBadgeClass(status: string) {
  if (["APPROVED", "EXECUTED"].includes(status)) {
    return "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700/50 dark:bg-emerald-950/30 dark:text-emerald-300";
  }
  if (status === "REJECTED") {
    return "border-red-300 bg-red-50 text-red-700 dark:border-red-700/50 dark:bg-red-950/30 dark:text-red-300";
  }
  return "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-300";
}

function groupByLabel<T>(items: T[], getLabel: (item: T) => string) {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    const key = getLabel(item);
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});
}

export function NotificationCenter({
  notifications,
  pendingApprovalOrders,
  pendingApprovalNeeds,
  pendingExecutionOrders,
  pendingExecutionNeeds,
  completedOrders,
  completedNeeds,
  initialTab,
}: {
  notifications: WorkflowNotification[];
  pendingApprovalOrders: PaymentOrderItem[];
  pendingApprovalNeeds: NeedItem[];
  pendingExecutionOrders: PaymentOrderItem[];
  pendingExecutionNeeds: NeedItem[];
  completedOrders: PaymentOrderItem[];
  completedNeeds: NeedItem[];
  initialTab: InboxTab;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<InboxTab>(initialTab);
  const [modal, setModal] = useState<ActionModal | null>(null);

  const paymentApprovalGroups = useMemo(
    () => groupByLabel(pendingApprovalOrders, (order) => paymentOrderAssignmentLabel(order.assignment)),
    [pendingApprovalOrders],
  );
  const paymentExecutionGroups = useMemo(
    () => groupByLabel(pendingExecutionOrders, (order) => paymentOrderAssignmentLabel(order.assignment)),
    [pendingExecutionOrders],
  );
  const needApprovalGroups = useMemo(
    () => groupByLabel(pendingApprovalNeeds, (need) => need.category || "GENERAL"),
    [pendingApprovalNeeds],
  );
  const needExecutionGroups = useMemo(
    () => groupByLabel(pendingExecutionNeeds, (need) => need.category || "GENERAL"),
    [pendingExecutionNeeds],
  );

  const tabCounts = {
    notifications: notifications.length,
    validate: pendingApprovalOrders.length + pendingApprovalNeeds.length,
    execute: pendingExecutionOrders.length + pendingExecutionNeeds.length,
    history: completedOrders.length + completedNeeds.length,
  };

  function switchTab(tab: InboxTab) {
    setActiveTab(tab);
    const params = new URLSearchParams(searchParams.toString());
    if (tab === "notifications") {
      params.delete("tab");
    } else {
      params.set("tab", tab);
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function openAction(kind: ActionModal["kind"], id: string, title: string, pdfUrl: string) {
    setModal({ kind, id, title, pdfUrl });
  }

  function notificationPdfUrl(notification: WorkflowNotification) {
    const paymentOrderId = typeof notification.metadata?.paymentOrderId === "string"
      ? notification.metadata.paymentOrderId
      : null;
    const needRequestId = typeof notification.metadata?.needRequestId === "string"
      ? notification.metadata.needRequestId
      : null;

    if (paymentOrderId) return `/api/payment-orders/${paymentOrderId}/pdf`;
    if (needRequestId) return `/api/procurement/needs/${needRequestId}/pdf`;
    return null;
  }

  function renderNotificationActions(notification: WorkflowNotification) {
    const paymentOrderId = typeof notification.metadata?.paymentOrderId === "string"
      ? notification.metadata.paymentOrderId
      : null;
    const needRequestId = typeof notification.metadata?.needRequestId === "string"
      ? notification.metadata.needRequestId
      : null;
    const pdfUrl = notificationPdfUrl(notification);

    return (
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {pdfUrl ? (
          <a
            href={pdfUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-black/20 px-2.5 py-1 text-[11px] font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Lire le PDF
          </a>
        ) : null}

        {notification.type === "PAYMENT_ORDER_APPROVAL_REQUIRED" && paymentOrderId && pdfUrl ? (
          <button
            type="button"
            onClick={() => openAction("payment-approve", paymentOrderId, notification.title, pdfUrl)}
            className="rounded-md border border-emerald-300 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700/60 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
          >
            Ouvrir l'action
          </button>
        ) : null}

        {notification.type === "PAYMENT_ORDER_EXECUTION_REQUIRED" && paymentOrderId && pdfUrl ? (
          <button
            type="button"
            onClick={() => openAction("payment-execute", paymentOrderId, notification.title, pdfUrl)}
            className="rounded-md border border-blue-300 px-2.5 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-50 dark:border-blue-700/60 dark:text-blue-300 dark:hover:bg-blue-950/30"
          >
            Ouvrir l'action
          </button>
        ) : null}

        {notification.type === "PROCUREMENT_APPROVAL" && needRequestId && pdfUrl ? (
          <button
            type="button"
            onClick={() => openAction("need-approve", needRequestId, notification.title, pdfUrl)}
            className="rounded-md border border-emerald-300 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700/60 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
          >
            Ouvrir l'action
          </button>
        ) : null}

        {notification.type === "PROCUREMENT_FINANCE_EXECUTION" && needRequestId && pdfUrl ? (
          <button
            type="button"
            onClick={() => openAction("need-execute", needRequestId, notification.title, pdfUrl)}
            className="rounded-md border border-blue-300 px-2.5 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-50 dark:border-blue-700/60 dark:text-blue-300 dark:hover:bg-blue-950/30"
          >
            Ouvrir l'action
          </button>
        ) : null}

        {notification.type.startsWith("PAYMENT_ORDER_") ? (
          <Link
            href="/inbox?tab=history"
            className="rounded-md border border-black/20 px-2.5 py-1 text-[11px] font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Voir le circuit OP
          </Link>
        ) : null}

        {notification.type.startsWith("PROCUREMENT_") ? (
          <Link
            href="/inbox?tab=history"
            className="rounded-md border border-black/20 px-2.5 py-1 text-[11px] font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Voir le circuit EDB
          </Link>
        ) : null}
      </div>
    );
  }

  function renderPaymentCard(order: PaymentOrderItem, mode: "validate" | "execute" | "history") {
    const pdfUrl = `/api/payment-orders/${order.id}/pdf`;
    return (
      <article key={order.id} className="rounded-xl border border-black/10 bg-white p-3 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-semibold">{order.code ?? `OP-${order.id.slice(0, 8).toUpperCase()}`}</p>
            <p className="text-xs text-black/60 dark:text-white/60">
              {order.beneficiary} • {paymentOrderAssignmentLabel(order.assignment)}
            </p>
          </div>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusBadgeClass(order.status)}`}>
            {paymentStatusLabel(order.status)}
          </span>
        </div>

        <p className="mt-2 text-sm">{order.purpose}</p>
        <p className="mt-1 text-xs text-black/70 dark:text-white/70">{order.description}</p>
        <p className="mt-2 text-xs text-black/60 dark:text-white/60">
          Montant: <span className="font-semibold">{order.amount.toFixed(2)} {normalizeMoneyCurrency(order.currency)}</span>
        </p>
        <p className="text-[11px] text-black/50 dark:text-white/50">
          DG: {order.issuedBy?.name ?? "-"} • Créé le {formatWhen(order.createdAt)}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <a
            href={pdfUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-black/20 px-2.5 py-1 text-[11px] font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Lire PDF OP
          </a>
          {mode === "validate" ? (
            <button
              type="button"
              onClick={() => openAction("payment-approve", order.id, order.code ?? "OP", pdfUrl)}
              className="rounded-md border border-emerald-300 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700/60 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
            >
              Traiter une seule fois
            </button>
          ) : null}
          {mode === "execute" ? (
            <button
              type="button"
              onClick={() => openAction("payment-execute", order.id, order.code ?? "OP", pdfUrl)}
              className="rounded-md border border-blue-300 px-2.5 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-50 dark:border-blue-700/60 dark:text-blue-300 dark:hover:bg-blue-950/30"
            >
              Exécuter une seule fois
            </button>
          ) : null}
          {mode === "history" ? (
            <Link
              href="/payments"
              className="rounded-md border border-black/20 px-2.5 py-1 text-[11px] font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
            >
              Ouvrir Paiements
            </Link>
          ) : null}
        </div>
      </article>
    );
  }

  function renderNeedCard(need: NeedItem, mode: "validate" | "execute" | "history") {
    const pdfUrl = `/api/procurement/needs/${need.id}/pdf`;
    const labelStatus = needStatusLabel(need.status, need.reviewComment);
    const badgeStatus = labelStatus === "Exécuté" ? "EXECUTED" : need.status;

    return (
      <article key={need.id} className="rounded-xl border border-black/10 bg-white p-3 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-semibold">{need.code ?? `EDB-${need.id.slice(0, 8).toUpperCase()}`}</p>
            <p className="text-xs text-black/60 dark:text-white/60">
              {need.title} • {need.category}
            </p>
          </div>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusBadgeClass(badgeStatus)}`}>
            {labelStatus}
          </span>
        </div>

        <p className="mt-2 text-xs text-black/70 dark:text-white/70">
          Demandeur: {need.requester?.name ?? "-"} • Montant estimé: {typeof need.estimatedAmount === "number" ? `${need.estimatedAmount.toFixed(2)} ${normalizeMoneyCurrency(need.currency)}` : "-"}
        </p>
        <p className="text-[11px] text-black/50 dark:text-white/50">
          Soumis le {formatWhen(need.submittedAt ?? need.createdAt)}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <a
            href={pdfUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-black/20 px-2.5 py-1 text-[11px] font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Lire PDF EDB
          </a>
          {mode === "validate" ? (
            <button
              type="button"
              onClick={() => openAction("need-approve", need.id, need.code ?? need.title, pdfUrl)}
              className="rounded-md border border-emerald-300 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700/60 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
            >
              Traiter une seule fois
            </button>
          ) : null}
          {mode === "execute" ? (
            <button
              type="button"
              onClick={() => openAction("need-execute", need.id, need.code ?? need.title, pdfUrl)}
              className="rounded-md border border-blue-300 px-2.5 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-50 dark:border-blue-700/60 dark:text-blue-300 dark:hover:bg-blue-950/30"
            >
              Exécuter une seule fois
            </button>
          ) : null}
          {mode === "history" ? (
            <Link
              href="/approvisionnement"
              className="rounded-md border border-black/20 px-2.5 py-1 text-[11px] font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
            >
              Ouvrir Approvisionnement
            </Link>
          ) : null}
        </div>
      </article>
    );
  }

  const tabs: Array<{ key: InboxTab; label: string; count: number }> = [
    { key: "notifications", label: "Notifications", count: tabCounts.notifications },
    { key: "validate", label: "À valider", count: tabCounts.validate },
    { key: "execute", label: "À exécuter", count: tabCounts.execute },
    { key: "history", label: "Validé & exécuté", count: tabCounts.history },
  ];

  return (
    <>
      <section className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Centre de notifications</h2>
            <p className="text-sm text-black/60 dark:text-white/60">
              Lecture compacte, actions en modal, puis accès direct aux circuits OP / EDB.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-semibold">
            <Link href="/inbox?tab=validate" className="rounded-full border border-black/15 px-3 py-1 dark:border-white/20">À valider</Link>
            <Link href="/inbox?tab=execute" className="rounded-full border border-black/15 px-3 py-1 dark:border-white/20">À exécuter</Link>
            <Link href="/inbox?tab=history" className="rounded-full border border-black/15 px-3 py-1 dark:border-white/20">Historique</Link>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => switchTab(tab.key)}
              className={`rounded-xl border px-3 py-3 text-left transition ${activeTab === tab.key ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black" : "border-black/10 bg-black/5 hover:bg-black/10 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"}`}
            >
              <p className="text-[11px] font-medium opacity-80">{tab.label}</p>
              <p className="mt-1 text-xl font-semibold">{tab.count}</p>
            </button>
          ))}
        </div>
      </section>

      <section className="mt-4">
        {activeTab === "notifications" ? (
          <div className="space-y-3">
            {notifications.length === 0 ? (
              <div className="rounded-2xl border border-black/10 bg-white p-5 text-sm text-black/60 shadow-sm dark:border-white/10 dark:bg-zinc-900 dark:text-white/60">
                Aucune notification pour le moment.
              </div>
            ) : notifications.map((notification) => (
              <article key={notification.id} className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">{notification.title}</p>
                  <div className="flex items-center gap-2">
                    {!notification.isRead ? <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-semibold text-white">Nouveau</span> : null}
                    <span className="rounded-full border border-black/15 px-2 py-0.5 text-[10px] font-semibold dark:border-white/20">{notification.type}</span>
                  </div>
                </div>
                <p className="mt-2 text-sm text-black/70 dark:text-white/70">{notification.message}</p>
                {renderNotificationActions(notification)}
                <p className="mt-2 text-[11px] text-black/50 dark:text-white/50">{formatWhen(notification.createdAt)}</p>
              </article>
            ))}
          </div>
        ) : null}

        {activeTab === "validate" ? (
          <div className="space-y-5">
            <section className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-base font-semibold">OP à valider par affectation</h3>
                <Link href="/payments" className="text-xs font-semibold text-black/60 dark:text-white/60">Ouvrir Paiements</Link>
              </div>
              {Object.keys(paymentApprovalGroups).length === 0 ? (
                <p className="text-sm text-black/60 dark:text-white/60">Aucun OP en attente de validation.</p>
              ) : (
                <div className="space-y-4">
                  {Object.entries(paymentApprovalGroups).map(([label, items]) => (
                    <div key={label} className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">{label}</p>
                      <div className="grid gap-3 lg:grid-cols-2">{items.map((item) => renderPaymentCard(item, "validate"))}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-base font-semibold">EDB à valider</h3>
                <Link href="/approvisionnement" className="text-xs font-semibold text-black/60 dark:text-white/60">Ouvrir Approvisionnement</Link>
              </div>
              {Object.keys(needApprovalGroups).length === 0 ? (
                <p className="text-sm text-black/60 dark:text-white/60">Aucun EDB en attente de validation.</p>
              ) : (
                <div className="space-y-4">
                  {Object.entries(needApprovalGroups).map(([label, items]) => (
                    <div key={label} className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">{label}</p>
                      <div className="grid gap-3 lg:grid-cols-2">{items.map((item) => renderNeedCard(item, "validate"))}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        ) : null}

        {activeTab === "execute" ? (
          <div className="space-y-5">
            <section className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-base font-semibold">OP à exécuter par affectation</h3>
                <Link href="/payments" className="text-xs font-semibold text-black/60 dark:text-white/60">Ouvrir Paiements</Link>
              </div>
              {Object.keys(paymentExecutionGroups).length === 0 ? (
                <p className="text-sm text-black/60 dark:text-white/60">Aucun OP en attente d'exécution.</p>
              ) : (
                <div className="space-y-4">
                  {Object.entries(paymentExecutionGroups).map(([label, items]) => (
                    <div key={label} className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">{label}</p>
                      <div className="grid gap-3 lg:grid-cols-2">{items.map((item) => renderPaymentCard(item, "execute"))}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-base font-semibold">EDB à exécuter</h3>
                <Link href="/approvisionnement" className="text-xs font-semibold text-black/60 dark:text-white/60">Ouvrir Approvisionnement</Link>
              </div>
              {Object.keys(needExecutionGroups).length === 0 ? (
                <p className="text-sm text-black/60 dark:text-white/60">Aucun EDB en attente d'exécution.</p>
              ) : (
                <div className="space-y-4">
                  {Object.entries(needExecutionGroups).map(([label, items]) => (
                    <div key={label} className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">{label}</p>
                      <div className="grid gap-3 lg:grid-cols-2">{items.map((item) => renderNeedCard(item, "execute"))}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        ) : null}

        {activeTab === "history" ? (
          <div className="space-y-5">
            <section className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-base font-semibold">OP validés / exécutés</h3>
                <Link href="/dg/ordres-paiement" className="text-xs font-semibold text-black/60 dark:text-white/60">Ouvrir espace DG</Link>
              </div>
              {completedOrders.length === 0 ? (
                <p className="text-sm text-black/60 dark:text-white/60">Aucun OP dans l'historique.</p>
              ) : (
                <div className="grid gap-3 lg:grid-cols-2">{completedOrders.map((item) => renderPaymentCard(item, "history"))}</div>
              )}
            </section>

            <section className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-base font-semibold">EDB validés / exécutés</h3>
                <Link href="/approvisionnement" className="text-xs font-semibold text-black/60 dark:text-white/60">Ouvrir Approvisionnement</Link>
              </div>
              {completedNeeds.length === 0 ? (
                <p className="text-sm text-black/60 dark:text-white/60">Aucun EDB dans l'historique.</p>
              ) : (
                <div className="grid gap-3 lg:grid-cols-2">{completedNeeds.map((item) => renderNeedCard(item, "history"))}</div>
              )}
            </section>
          </div>
        ) : null}
      </section>

      {modal ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4" onClick={() => setModal(null)}>
          <div
            className="w-full max-w-2xl rounded-2xl border border-black/10 bg-white p-4 shadow-2xl dark:border-white/10 dark:bg-zinc-950"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">Action sur le dossier</h3>
                <p className="text-sm text-black/60 dark:text-white/60">{modal.title}</p>
              </div>
              <button
                type="button"
                onClick={() => setModal(null)}
                className="rounded-md border border-black/15 px-3 py-1 text-xs font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
              >
                Fermer
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href={modal.pdfUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-black/20 px-3 py-1.5 text-xs font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
              >
                Lire le PDF
              </a>
            </div>

            <div className="mt-4 rounded-xl border border-black/10 p-3 dark:border-white/10">
              {modal.kind === "payment-approve" ? <PaymentOrderAdminActions paymentOrderId={modal.id} /> : null}
              {modal.kind === "payment-execute" ? <PaymentOrderCashExecutionActions paymentOrderId={modal.id} /> : null}
              {modal.kind === "need-approve" ? <ProcurementInboxActions needRequestId={modal.id} /> : null}
              {modal.kind === "need-execute" ? <ProcurementCashExecutionActions needRequestId={modal.id} /> : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
