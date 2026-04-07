import Link from "next/link";
import { PaymentOrderAdminActions } from "@/components/payment-order-admin-actions";
import { PaymentOrderCashExecutionActions } from "@/components/payment-order-cash-execution-actions";
import { ProcurementInboxActions } from "@/components/procurement-inbox-actions";
import { ProcurementCashExecutionActions } from "@/components/procurement-cash-execution-actions";
import type { WorkflowNeed, WorkflowPaymentOrder } from "@/lib/inbox-workflow";

type WorkflowMode = "validate" | "execute" | "history";

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

function paymentTitle(mode: WorkflowMode) {
  if (mode === "validate") return "OP à approuver par affectation";
  if (mode === "execute") return "OP à exécuter par affectation";
  return "OP validés / exécutés";
}

function needTitle(mode: WorkflowMode) {
  if (mode === "validate") return "EDB à approuver";
  if (mode === "execute") return "EDB à exécuter";
  return "EDB validés / exécutés";
}

function paymentEmptyText(mode: WorkflowMode) {
  if (mode === "validate") return "Aucun OP en attente d'approbation.";
  if (mode === "execute") return "Aucun OP en attente d'exécution.";
  return "Aucun OP dans l'historique.";
}

function needEmptyText(mode: WorkflowMode) {
  if (mode === "validate") return "Aucun EDB en attente d'approbation.";
  if (mode === "execute") return "Aucun EDB en attente d'exécution.";
  return "Aucun EDB dans l'historique.";
}

function renderPaymentCard(order: WorkflowPaymentOrder, mode: WorkflowMode) {
  return (
    <article
      id={`payment-${order.id}`}
      key={order.id}
      className="scroll-mt-24 rounded-xl border border-black/10 bg-white p-3 shadow-sm transition target:border-sky-500 target:ring-2 target:ring-sky-200 dark:border-white/10 dark:bg-zinc-900 dark:target:border-sky-400 dark:target:ring-sky-950"
    >
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

      {mode === "validate" ? <PaymentOrderAdminActions paymentOrderId={order.id} /> : null}
      {mode === "execute" ? <PaymentOrderCashExecutionActions paymentOrderId={order.id} /> : null}
      {mode === "history" ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <a
            href={`/api/payment-orders/${order.id}/pdf`}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-black/20 px-2.5 py-1 text-[11px] font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Lire PDF OP
          </a>
        </div>
      ) : null}
    </article>
  );
}

function renderNeedCard(need: WorkflowNeed, mode: WorkflowMode) {
  const labelStatus = needStatusLabel(need.status, need.reviewComment);
  const badgeStatus = labelStatus === "Exécuté" ? "EXECUTED" : need.status;

  return (
    <article
      id={`need-${need.id}`}
      key={need.id}
      className="scroll-mt-24 rounded-xl border border-black/10 bg-white p-3 shadow-sm transition target:border-sky-500 target:ring-2 target:ring-sky-200 dark:border-white/10 dark:bg-zinc-900 dark:target:border-sky-400 dark:target:ring-sky-950"
    >
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

      {mode === "validate" ? <ProcurementInboxActions needRequestId={need.id} /> : null}
      {mode === "execute" ? <ProcurementCashExecutionActions needRequestId={need.id} /> : null}
      {mode === "history" ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <a
            href={`/api/procurement/needs/${need.id}/pdf`}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-black/20 px-2.5 py-1 text-[11px] font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Lire PDF EDB
          </a>
        </div>
      ) : null}
    </article>
  );
}

export function WorkflowStatusBoard({
  mode,
  paymentOrders,
  needs,
  restrictedMessage,
}: {
  mode: WorkflowMode;
  paymentOrders: WorkflowPaymentOrder[];
  needs: WorkflowNeed[];
  restrictedMessage?: string;
}) {
  const groupedPayments = mode === "history"
    ? null
    : groupByLabel(paymentOrders, (order) => paymentOrderAssignmentLabel(order.assignment));
  const groupedNeeds = mode === "history"
    ? null
    : groupByLabel(needs, (need) => need.category || "GENERAL");

  return (
    <div className="space-y-5">
      {restrictedMessage ? (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-200">
          {restrictedMessage}
        </div>
      ) : null}

      <section id="payment-orders" className="scroll-mt-24 rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-base font-semibold">{paymentTitle(mode)}</h3>
          <Link href="/payments" className="text-xs font-semibold text-black/60 dark:text-white/60">Ouvrir Paiements</Link>
        </div>

        {mode === "history" ? (
          paymentOrders.length === 0 ? (
            <p className="text-sm text-black/60 dark:text-white/60">{paymentEmptyText(mode)}</p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">{paymentOrders.map((item) => renderPaymentCard(item, mode))}</div>
          )
        ) : !groupedPayments || Object.keys(groupedPayments).length === 0 ? (
          <p className="text-sm text-black/60 dark:text-white/60">{paymentEmptyText(mode)}</p>
        ) : (
          <div className="space-y-4">
            {Object.entries(groupedPayments).map(([label, items]) => (
              <div key={label} className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">{label}</p>
                <div className="grid gap-3 lg:grid-cols-2">{items.map((item) => renderPaymentCard(item, mode))}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section id="needs" className="scroll-mt-24 rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-base font-semibold">{needTitle(mode)}</h3>
          <Link href="/approvisionnement" className="text-xs font-semibold text-black/60 dark:text-white/60">Ouvrir Approvisionnement</Link>
        </div>

        {mode === "history" ? (
          needs.length === 0 ? (
            <p className="text-sm text-black/60 dark:text-white/60">{needEmptyText(mode)}</p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">{needs.map((item) => renderNeedCard(item, mode))}</div>
          )
        ) : !groupedNeeds || Object.keys(groupedNeeds).length === 0 ? (
          <p className="text-sm text-black/60 dark:text-white/60">{needEmptyText(mode)}</p>
        ) : (
          <div className="space-y-4">
            {Object.entries(groupedNeeds).map(([label, items]) => (
              <div key={label} className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">{label}</p>
                <div className="grid gap-3 lg:grid-cols-2">{items.map((item) => renderNeedCard(item, mode))}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}