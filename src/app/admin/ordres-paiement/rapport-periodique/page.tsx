"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { workflowAssignmentLabel } from "@/lib/workflow-assignment";
import { parseNeedQuote } from "@/lib/need-lines";
import { needStatusLabel, needBadgeClass } from "@/lib/need-filters";
import { opStatusLabel, opBadgeClass } from "@/lib/op-filters";

type Role = "ADMIN" | "DIRECTEUR_GENERAL" | "MANAGER" | "EMPLOYEE" | "ACCOUNTANT";

type PaymentOrder = {
  id: string;
  code: string | null;
  beneficiary: string;
  purpose: string | null;
  description: string;
  assignment: string;
  amount: number;
  currency: string;
  status: string;
  createdAt: string;
  issuedBy: { name: string } | null;
  approvedBy: { name: string } | null;
  executedBy: { name: string } | null;
};

type NeedRequest = {
  id: string;
  code: string | null;
  title: string;
  details: string | null;
  estimatedAmount: number | null;
  currency: string | null;
  status: string;
  reviewComment: string | null;
  createdAt: string;
  requester: { name: string };
  reviewedBy: { name: string } | null;
};

type ReportData = {
  paymentOrders: PaymentOrder[];
  needRequests: NeedRequest[];
  totalOpCount: number;
  totalEdbCount: number;
  totalOpAmount: number;
  totalEdbAmount: number;
  range: { start: string; end: string };
};

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const d = new Date(value);
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }) +
    " " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

export default function RapportPeriodiquePage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const today = new Date().toISOString().slice(0, 10);
  const initialStart = searchParams.get("start") || "";
  const initialEnd = searchParams.get("end") || "";

  const [startDate, setStartDate] = useState(initialStart);
  const [endDate, setEndDate] = useState(initialEnd);
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchReport = useCallback(async (start: string, end: string) => {
    if (!start || !end) {
      setError("Sélectionnez une date de début et une date de fin.");
      return;
    }
    if (end < start) {
      setError("La date de fin doit être après la date de début.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({ start, end });
      const response = await fetch(`/api/admin/ordres-paiement/rapport-periodique?${params}`);
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Erreur lors du chargement du rapport.");
      }
      const result: ReportData = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue.");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSubmit = useCallback((event: React.FormEvent) => {
    event.preventDefault();
    const params = new URLSearchParams();
    if (startDate) params.set("start", startDate);
    if (endDate) params.set("end", endDate);
    router.replace(`/admin/ordres-paiement/rapport-periodique?${params.toString()}`, { scroll: false });
    fetchReport(startDate, endDate);
  }, [startDate, endDate, router, fetchReport]);

  // Auto-fetch if URL has params on mount
  useMemo(() => {
    if (initialStart && initialEnd && !data && !loading) {
      fetchReport(initialStart, initialEnd);
    }
  }, [initialStart, initialEnd]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AppShell
      role={"ADMIN" as Role}
      accessNote="Rapport périodique: tous les OP et EDB émis dans une plage de dates, tous statuts confondus."
    >
      <section className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Rapport périodique — OP & EDB</h1>
            <p className="text-sm text-black/60 dark:text-white/60">
              Visualisez tous les ordres de paiement et états de besoin émis pendant une période.
            </p>
          </div>
          <a
            href="/admin/ordres-paiement"
            className="rounded-md border border-black/20 px-3 py-2 text-sm font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            ← Tableau de bord
          </a>
        </div>
      </section>

      {/* Date filter form */}
      <form onSubmit={handleSubmit} className="mb-6 rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold mb-3">Filtrer par période</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="start-date" className="block text-xs font-medium text-black/60 dark:text-white/60 mb-1">
              Date début
            </label>
            <input
              id="start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              max={today}
              className="rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            />
          </div>
          <div>
            <label htmlFor="end-date" className="block text-xs font-medium text-black/60 dark:text-white/60 mb-1">
              Date fin
            </label>
            <input
              id="end-date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              max={today}
              className="rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="rounded-md border border-black/20 px-4 py-2 text-sm font-semibold hover:bg-black/5 disabled:opacity-60 dark:border-white/20 dark:hover:bg-white/10"
          >
            {loading ? "Chargement..." : "Afficher"}
          </button>
          {error ? <span className="text-xs text-red-600">{error}</span> : null}
        </div>
      </form>

      {data ? (
        <>
          {/* Summary cards */}
          <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-black/10 bg-white p-3 dark:border-white/10 dark:bg-zinc-900">
              <p className="text-[11px] uppercase tracking-wide text-black/60 dark:text-white/60">Total OP</p>
              <p className="mt-1 text-2xl font-semibold">{data.totalOpCount}</p>
            </div>
            <div className="rounded-lg border border-black/10 bg-white p-3 dark:border-white/10 dark:bg-zinc-900">
              <p className="text-[11px] uppercase tracking-wide text-black/60 dark:text-white/60">Total EDB</p>
              <p className="mt-1 text-2xl font-semibold">{data.totalEdbCount}</p>
            </div>
            <div className="rounded-lg border border-black/10 bg-white p-3 dark:border-white/10 dark:bg-zinc-900">
              <p className="text-[11px] uppercase tracking-wide text-black/60 dark:text-white/60">Montant total OP</p>
              <p className="mt-1 text-2xl font-semibold">{data.totalOpAmount.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} USD</p>
            </div>
            <div className="rounded-lg border border-black/10 bg-white p-3 dark:border-white/10 dark:bg-zinc-900">
              <p className="text-[11px] uppercase tracking-wide text-black/60 dark:text-white/60">Montant total EDB</p>
              <p className="mt-1 text-2xl font-semibold">{data.totalEdbAmount.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} USD</p>
            </div>
          </div>

          {/* Payment Orders */}
          <section className="mb-8 rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900">
            <div className="border-b border-black/10 px-4 py-3 dark:border-white/10">
              <h2 className="text-base font-semibold">Ordres de paiement — {data.paymentOrders.length} résultat{data.paymentOrders.length > 1 ? "s" : ""}</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-black/5 dark:bg-white/10">
                  <tr>
                    <th className="px-3 py-2 text-left">Date</th>
                    <th className="px-3 py-2 text-left">Code</th>
                    <th className="px-3 py-2 text-left">Bénéficiaire</th>
                    <th className="px-3 py-2 text-left">Motif</th>
                    <th className="px-3 py-2 text-left">Affectation</th>
                    <th className="px-3 py-2 text-left">Montant</th>
                    <th className="px-3 py-2 text-left">Statut</th>
                    <th className="px-3 py-2 text-left">Émetteur</th>
                  </tr>
                </thead>
                <tbody>
                  {data.paymentOrders.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-sm text-black/55 dark:text-white/55">
                        Aucun OP émis sur cette période.
                      </td>
                    </tr>
                  ) : data.paymentOrders.map((order) => (
                    <tr key={order.id} className="border-t border-black/5 dark:border-white/10 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-black/65 dark:text-white/65">
                        {formatDateTime(order.createdAt)}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs font-semibold text-blue-700 dark:text-blue-400">
                        {order.code ?? "-"}
                      </td>
                      <td className="px-3 py-2">{order.beneficiary}</td>
                      <td className="px-3 py-2 max-w-[200px] truncate">{order.purpose ?? "-"}</td>
                      <td className="px-3 py-2 text-xs">{workflowAssignmentLabel(order.assignment)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {order.amount.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} {order.currency}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${opBadgeClass(order.status)}`}>
                          {opStatusLabel(order.status)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs">{order.issuedBy?.name ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Need Requests */}
          <section className="rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900">
            <div className="border-b border-black/10 px-4 py-3 dark:border-white/10">
              <h2 className="text-base font-semibold">États de besoin — {data.needRequests.length} résultat{data.needRequests.length > 1 ? "s" : ""}</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-black/5 dark:bg-white/10">
                  <tr>
                    <th className="px-3 py-2 text-left">Date</th>
                    <th className="px-3 py-2 text-left">Code</th>
                    <th className="px-3 py-2 text-left">Objet</th>
                    <th className="px-3 py-2 text-left">Demandeur</th>
                    <th className="px-3 py-2 text-left">Affectation</th>
                    <th className="px-3 py-2 text-left">Montant</th>
                    <th className="px-3 py-2 text-left">Statut</th>
                    <th className="px-3 py-2 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.needRequests.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-sm text-black/55 dark:text-white/55">
                        Aucun EDB émis sur cette période.
                      </td>
                    </tr>
                  ) : data.needRequests.map((need) => {
                    const quote = parseNeedQuote(need.details);
                    const statusLabel = needStatusLabel(need.status, need.reviewComment);
                    return (
                      <tr key={need.id} className="border-t border-black/5 dark:border-white/10 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                        <td className="px-3 py-2 whitespace-nowrap text-xs text-black/65 dark:text-white/65">
                          {formatDateTime(need.createdAt)}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs font-semibold text-blue-700 dark:text-blue-400">
                          {need.code ?? need.id.slice(0, 8).toUpperCase()}
                        </td>
                        <td className="px-3 py-2 max-w-[250px] truncate font-medium">{need.title}</td>
                        <td className="px-3 py-2 text-xs">{need.requester.name}</td>
                        <td className="px-3 py-2 text-xs">{workflowAssignmentLabel(quote?.assignment)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {typeof need.estimatedAmount === "number"
                            ? `${need.estimatedAmount.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} ${need.currency ?? "USD"}`
                            : "-"}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${needBadgeClass(statusLabel)}`}>
                            {statusLabel}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-2">
                            <a
                              href={`/approvisionnement/${need.id}`}
                              className="inline-flex rounded-md border border-black/20 px-2.5 py-1 text-[11px] font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                            >
                              Ouvrir
                            </a>
                            <a
                              href={`/api/procurement/needs/${need.id}/pdf`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex rounded-md border border-black/20 px-2.5 py-1 text-[11px] font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                            >
                              PDF
                            </a>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : !loading ? (
        <div className="rounded-2xl border border-dashed border-black/20 p-12 text-center dark:border-white/20">
          <p className="text-sm text-black/55 dark:text-white/55">
            Sélectionnez une période et cliquez sur "Afficher" pour voir les OP et EDB.
          </p>
        </div>
      ) : null}
    </AppShell>
  );
}
