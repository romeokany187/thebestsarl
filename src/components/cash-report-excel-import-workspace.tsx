"use client";

import { FormEvent, useMemo, useState } from "react";

type ImportPreview = {
  dryRun: boolean;
  importId?: string;
  reportMonth: string;
  closingDate: string;
  datesToImport: string[];
  skippedDates: string[];
  stats: {
    importLines: number;
    ticketLines: number;
    otherInflowLines: number;
    outflowLines: number;
    openingLines: number;
    unmatchedTicketLines: number;
  };
  billetages: Array<{ variant: string; totalUsd: number; totalCdf: number }>;
  virtualChannelCount: number;
  warnings: string[];
};

function todayKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function CashReportExcelImportWorkspace() {
  const [file, setFile] = useState<File | null>(null);
  const [closingDate, setClosingDate] = useState(todayKey());
  const [reconcileDates, setReconcileDates] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);

  const canCommit = useMemo(() => Boolean(file && preview?.dryRun), [file, preview]);

  async function submit(event: FormEvent, dryRun: boolean) {
    event.preventDefault();
    if (!file) {
      setMessage("Choisissez le rapport Excel de caisse.");
      return;
    }

    setLoading(true);
    setMessage("");

    const formData = new FormData();
    formData.set("file", file);
    formData.set("dryRun", dryRun ? "true" : "false");
    formData.set("closingDate", closingDate);
    if (reconcileDates.trim()) formData.set("reconcileDates", reconcileDates.trim());

    try {
      const response = await fetch("/api/payments/cash-report/import", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(payload?.error ?? "Analyse impossible.");
        return;
      }

      const data = payload?.data as ImportPreview;
      setPreview(data);
      setMessage(dryRun ? "Aperçu prêt." : "Import enregistré.");
      if (!dryRun) {
        window.location.reload();
      }
    } catch {
      setMessage("Erreur réseau.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
      <div>
        <h2 className="text-sm font-semibold">Import rapport Excel (Caisse 2 / THE BEST)</h2>
        <p className="mt-1 text-xs text-black/60 dark:text-white/60">
          Journal incrémental, billetage THE BEST et virtuel mis à jour à la date de clôture.
        </p>
      </div>

      <form className="grid gap-3" onSubmit={(event) => void submit(event, true)}>
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setPreview(null);
          }}
          className="text-sm"
        />
        <label className="grid gap-1 text-xs">
          <span className="font-semibold text-black/70 dark:text-white/70">Date de clôture (billetage / virtuel)</span>
          <input
            type="date"
            value={closingDate}
            onChange={(event) => setClosingDate(event.target.value)}
            className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
          />
        </label>
        <label className="grid gap-1 text-xs">
          <span className="font-semibold text-black/70 dark:text-white/70">Dates à réconcilier (optionnel, YYYY-MM-DD séparées par des virgules)</span>
          <input
            value={reconcileDates}
            onChange={(event) => setReconcileDates(event.target.value)}
            placeholder="2026-09-10,2026-09-11"
            className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
          />
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={loading || !file}
            className="rounded-md bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
          >
            {loading ? "Analyse…" : "Analyser"}
          </button>
          <button
            type="button"
            disabled={loading || !canCommit}
            onClick={(event) => void submit(event as unknown as FormEvent, false)}
            className="rounded-md border border-emerald-400 px-4 py-2 text-sm font-semibold text-emerald-800 disabled:opacity-50 dark:border-emerald-700 dark:text-emerald-300"
          >
            Confirmer l&apos;import
          </button>
        </div>
      </form>

      {message ? <p className="text-xs text-black/65 dark:text-white/65">{message}</p> : null}

      {preview ? (
        <div className="rounded-xl border border-black/10 p-3 text-xs dark:border-white/10">
          <p className="font-semibold">Mois {preview.reportMonth} · clôture {preview.closingDate}</p>
          <p className="mt-2">Jours à importer : {preview.datesToImport.length ? preview.datesToImport.join(", ") : "aucun (déjà à jour)"}</p>
          {preview.skippedDates.length > 0 ? (
            <p className="mt-1 text-black/60 dark:text-white/60">Jours ignorés : {preview.skippedDates.join(", ")}</p>
          ) : null}
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            <li>Lignes journal : {preview.stats.importLines}</li>
            <li>Entrées billets : {preview.stats.ticketLines}</li>
            <li>Autres entrées : {preview.stats.otherInflowLines}</li>
            <li>Sorties : {preview.stats.outflowLines}</li>
            <li>Ouvertures : {preview.stats.openingLines}</li>
            <li>Billets non rattachés : {preview.stats.unmatchedTicketLines}</li>
          </ul>
          {preview.billetages.length > 0 ? (
            <p className="mt-2">
              Billetages : {preview.billetages.map((item) => `${item.variant} (${item.totalUsd.toFixed(2)} USD / ${item.totalCdf.toFixed(2)} CDF)`).join(" · ")}
            </p>
          ) : null}
          <p className="mt-1">Canaux virtuel : {preview.virtualChannelCount}</p>
          {preview.warnings.length > 0 ? (
            <ul className="mt-2 list-disc pl-4 text-amber-800 dark:text-amber-300">
              {preview.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
