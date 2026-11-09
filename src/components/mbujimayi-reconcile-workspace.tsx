"use client";

import { useMemo, useState } from "react";

type PairStatus =
  | "matched"
  | "date_mismatch"
  | "price_mismatch"
  | "price_and_date_mismatch"
  | "missing_in_system"
  | "missing_in_report"
  | "ambiguous";

type ReconcilePair = {
  status: PairStatus;
  nameScore: number;
  notes: string[];
  report: {
    rowNumber: number;
    businessDate: string | null;
    clientName: string;
    amountUsd: number;
  } | null;
  ticket: {
    id: string;
    ticketNumber: string;
    customerName: string;
    amount: number;
    currency: string;
    soldAt: string;
    payerName: string | null;
  } | null;
};

type AnalyzeResponse = {
  ok?: boolean;
  error?: string;
  fileName?: string;
  month?: string;
  sheetName?: string;
  monthsDetected?: string[];
  summary?: {
    reportSalesCount: number;
    systemTicketsCount: number;
    matched: number;
    dateMismatch: number;
    priceMismatch: number;
    priceAndDateMismatch: number;
    missingInSystem: number;
    missingInReport: number;
    ambiguous: number;
    reportTotalUsd: number;
    systemTotalUsd: number;
  };
  pairs?: ReconcilePair[];
};

const STATUS_LABEL: Record<PairStatus, string> = {
  matched: "OK",
  date_mismatch: "Date différente",
  price_mismatch: "Prix différent",
  price_and_date_mismatch: "Prix + date",
  missing_in_system: "Manque dans le système",
  missing_in_report: "Manque dans le rapport",
  ambiguous: "Ambigu",
};

function money(value: number) {
  return value.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function statusClass(status: PairStatus) {
  if (status === "matched") return "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200";
  if (status === "missing_in_system" || status === "missing_in_report") {
    return "bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200";
  }
  if (status === "ambiguous") return "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100";
  return "bg-orange-50 text-orange-900 dark:bg-orange-950/40 dark:text-orange-100";
}

export function MbujimayiReconcileWorkspace() {
  const defaultMonth = useMemo(() => new Date().toISOString().slice(0, 7), []);
  const [month, setMonth] = useState(defaultMonth);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | PairStatus>("all");
  const [result, setResult] = useState<AnalyzeResponse | null>(null);

  async function runAnalyze() {
    setError("");
    setResult(null);

    if (!file) {
      setError("Choisissez le fichier Excel « RAPPORT GLOBAL DE MBUJIMAYI ».");
      return;
    }

    setLoading(true);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("month", month);
      const response = await fetch("/api/sales/mbujimayi-reconcile", {
        method: "POST",
        body,
      });
      const payload = (await response.json().catch(() => null)) as AnalyzeResponse | null;
      if (!response.ok || !payload) {
        setError(payload?.error ?? "Analyse impossible.");
        setLoading(false);
        return;
      }
      setResult(payload);
    } catch {
      setError("Erreur réseau pendant l'analyse.");
    }
    setLoading(false);
  }

  const pairs = (result?.pairs ?? []).filter((pair) => (filter === "all" ? true : pair.status === filter));

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold tracking-tight">Analyse rapport Mbujimayi</h2>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          Importez le rapport global de l’équipe, choisissez le mois : le système lit uniquement les lignes
          « Vente billet » (client + entrées USD) de ce mois, puis les compare aux billets système rattachés à
          Mbujimayi (payant / équipe). Les noms sont rapprochés sans tenir compte de l’ordre des parties.
        </p>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Mois à analyser</label>
            <input
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Fichier Excel</label>
            <input
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-black/5 file:px-3 file:py-1 dark:border-white/15 dark:bg-zinc-900"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={runAnalyze}
            disabled={loading}
            className="rounded-md bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-black"
          >
            {loading ? "Analyse…" : "Analyser le mois"}
          </button>
        </div>

        {error ? <p className="mt-3 text-sm text-rose-600 dark:text-rose-300">{error}</p> : null}
      </section>

      {result?.summary ? (
        <section className="space-y-4 rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold">
                Résultat · {result.month}
                {result.fileName ? ` · ${result.fileName}` : ""}
              </h3>
              <p className="text-xs text-black/55 dark:text-white/55">
                Feuille {result.sheetName}
                {result.monthsDetected?.length ? ` · mois détectés dans le fichier : ${result.monthsDetected.join(", ")}` : ""}
              </p>
            </div>
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value as typeof filter)}
              className="rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            >
              <option value="all">Tous les écarts / matches</option>
              <option value="missing_in_system">Manque dans le système</option>
              <option value="missing_in_report">Manque dans le rapport</option>
              <option value="price_mismatch">Prix différent</option>
              <option value="date_mismatch">Date différente</option>
              <option value="price_and_date_mismatch">Prix + date</option>
              <option value="ambiguous">Ambigu</option>
              <option value="matched">OK</option>
            </select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-black/10 px-3 py-3 text-sm dark:border-white/10">
              <p className="text-xs text-black/55 dark:text-white/55">Ventes rapport</p>
              <p className="mt-1 font-semibold">{result.summary.reportSalesCount} · {money(result.summary.reportTotalUsd)} USD</p>
            </div>
            <div className="rounded-xl border border-black/10 px-3 py-3 text-sm dark:border-white/10">
              <p className="text-xs text-black/55 dark:text-white/55">Billets système MJM</p>
              <p className="mt-1 font-semibold">{result.summary.systemTicketsCount} · {money(result.summary.systemTotalUsd)} USD</p>
            </div>
            <div className="rounded-xl border border-emerald-400/40 bg-emerald-50 px-3 py-3 text-sm dark:border-emerald-600/40 dark:bg-emerald-950/25">
              <p className="text-xs text-black/55 dark:text-white/55">OK</p>
              <p className="mt-1 font-semibold">{result.summary.matched}</p>
            </div>
            <div className="rounded-xl border border-rose-400/40 bg-rose-50 px-3 py-3 text-sm dark:border-rose-600/40 dark:bg-rose-950/25">
              <p className="text-xs text-black/55 dark:text-white/55">Manquants</p>
              <p className="mt-1 font-semibold">
                sys {result.summary.missingInSystem} · rapp {result.summary.missingInReport}
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 text-sm">
            <p>Prix ≠ : <strong>{result.summary.priceMismatch}</strong></p>
            <p>Date ≠ : <strong>{result.summary.dateMismatch}</strong></p>
            <p>Prix + date ≠ : <strong>{result.summary.priceAndDateMismatch}</strong></p>
            <p>Ambigus : <strong>{result.summary.ambiguous}</strong></p>
          </div>

          <div className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/10">
            <table className="min-w-full text-sm">
              <thead className="bg-black/5 dark:bg-white/10">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Statut</th>
                  <th className="px-3 py-2 text-left font-semibold">Rapport</th>
                  <th className="px-3 py-2 text-left font-semibold">Système</th>
                  <th className="px-3 py-2 text-left font-semibold">Notes</th>
                </tr>
              </thead>
              <tbody>
                {pairs.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-black/55 dark:text-white/55">
                      Aucune ligne pour ce filtre.
                    </td>
                  </tr>
                ) : (
                  pairs.map((pair, index) => (
                    <tr key={`${pair.status}-${pair.report?.rowNumber ?? "x"}-${pair.ticket?.id ?? index}`} className="border-t border-black/5 dark:border-white/10 align-top">
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ${statusClass(pair.status)}`}>
                          {STATUS_LABEL[pair.status]}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {pair.report ? (
                          <div className="space-y-0.5">
                            <p className="font-medium">{pair.report.clientName}</p>
                            <p className="text-xs text-black/55 dark:text-white/55">
                              L{pair.report.rowNumber} · {pair.report.businessDate ?? "sans date"} · {money(pair.report.amountUsd)} USD
                            </p>
                          </div>
                        ) : (
                          <span className="text-black/40 dark:text-white/40">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {pair.ticket ? (
                          <div className="space-y-0.5">
                            <p className="font-medium">{pair.ticket.customerName}</p>
                            <p className="text-xs text-black/55 dark:text-white/55">
                              {pair.ticket.ticketNumber} · {pair.ticket.soldAt} · {money(pair.ticket.amount)} {pair.ticket.currency}
                              {pair.ticket.payerName ? ` · ${pair.ticket.payerName}` : ""}
                            </p>
                          </div>
                        ) : (
                          <span className="text-black/40 dark:text-white/40">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-black/65 dark:text-white/65">
                        {pair.notes.length ? pair.notes.join(" · ") : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
