"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { kinshasaDateKey } from "@/lib/kinshasa-time";

type ImportPreview = {
  dryRun: boolean;
  importId?: string;
  fileName: string;
  reportMonth: string;
  importMode?: "HISTORICAL_FULL_MONTH" | "CURRENT_MONTH_DAILY";
  importModeLabel?: string;
  deskSnapshotDate?: string | null;
  closingDate: string;
  suggestedClosingDate: string;
  closingDateAdjusted: boolean;
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
  analysis: {
    status: "NEW_DAYS" | "UP_TO_DATE" | "RECONCILE_ONLY" | "NO_JOURNAL";
    statusLabel: string;
    readyToCommit: boolean;
    duplicateFile: boolean;
    lastImportedDate: string | null;
    journalRange: { from: string | null; to: string | null };
    totals: {
      ticketInUsd: number;
      ticketInCdf: number;
      otherInUsd: number;
      otherInCdf: number;
      outUsd: number;
      outCdf: number;
    };
    samples: {
      tickets: Array<{ date: string; libelle: string; amount: number; currency: string; amountSummary?: string; ticketMatched: boolean }>;
      movements: Array<{ date: string; libelle: string; amount: number; currency: string; amountSummary?: string }>;
    };
    virtual: {
      totalUsd: number;
      totalCdf: number;
      channels: Array<{ label: string; usd: number; cdf: number }>;
    };
  };
  monthlyConstat: {
    reportMonth: string;
    closedMonth: boolean;
    excelSideLabel: string;
    systemSourceLabel: string;
    excelJournalMeta: {
      linesInMonth: number;
      linesOutsideMonth: number;
      daysInMonth: number;
      dateFrom: string | null;
      dateTo: string | null;
    };
    verdict: string;
    aligned: boolean;
    summary: {
      excelDays: number;
      systemDays: number;
      alignedDays: number;
      missingInSystemDays: number;
      missingInFileDays: number;
      mismatchDays: number;
    };
    monthTotals: {
      excel: { ticketInUsd: number; ticketInCdf: number; otherInUsd: number; outUsd: number; outCdf: number };
      system: { ticketInUsd: number; ticketInCdf: number; otherInUsd: number; outUsd: number; outCdf: number };
      delta: { ticketInUsd: number; ticketInCdf: number; otherInUsd: number; outUsd: number; outCdf: number };
    };
    monthGross: {
      excel: { inUsd: number; inCdf: number; outUsd: number; outCdf: number };
      system: { inUsd: number; inCdf: number; outUsd: number; outCdf: number };
      delta: { inUsd: number; inCdf: number; outUsd: number; outCdf: number };
    };
    days: Array<{
      date: string;
      status: "ALIGNED" | "MISSING_IN_SYSTEM" | "MISSING_IN_FILE" | "MISMATCH";
      excel: { lineCount: number; ticketInUsd: number; ticketInCdf: number };
      system: { lineCount: number; ticketInUsd: number; ticketInCdf: number };
    }>;
    datesToSync: string[];
  } | null;
};

function formatAmount(value: number, currency: string) {
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(value)} ${currency}`;
}

/** Évite les 403 WAF Hostinger sur les noms avec apostrophe (ex. « D'OCTOBRE »). */
function sanitizeCashReportUploadFile(file: File): File {
  const safeName = file.name
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[''`’]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const finalName =
    safeName.length > 0 && /\.xlsx?$/i.test(safeName) ? safeName : `${safeName || "journal-caisse"}.xlsx`;
  if (finalName === file.name) return file;
  return new File([file], finalName, {
    type: file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function dayStatusLabel(status: NonNullable<ImportPreview["monthlyConstat"]>["days"][number]["status"]) {
  if (status === "ALIGNED") return "Aligné";
  if (status === "MISSING_IN_SYSTEM") return "Absent du système";
  if (status === "MISSING_IN_FILE") return "Absent du fichier";
  return "Écart de totaux";
}

function MonthlyConstatPanel({ constat }: { constat: NonNullable<ImportPreview["monthlyConstat"]> }) {
  const issueDays = constat.days.filter((day) => day.status !== "ALIGNED");

  return (
    <div className="space-y-3 rounded-xl border border-violet-300/80 bg-violet-50/80 p-4 dark:border-violet-800 dark:bg-violet-950/25">
      <div>
        <p className="text-sm font-semibold text-violet-950 dark:text-violet-100">
          Constat mensuel {constat.reportMonth}
          {constat.closedMonth ? " (mois clôturé)" : " (mois en cours)"}
        </p>
        <p className="mt-1 text-xs text-violet-900/90 dark:text-violet-200/90">{constat.verdict}</p>
        <p className="mt-1 text-[11px] text-violet-800/80 dark:text-violet-200/75">{constat.excelSideLabel}</p>
        <p className="text-[11px] text-violet-800/80 dark:text-violet-200/75">{constat.systemSourceLabel}</p>
      </div>

      <p className="text-xs text-violet-900/85 dark:text-violet-200/85">
        Période couverte dans le fichier ({constat.reportMonth}) :{" "}
        {constat.excelJournalMeta.dateFrom && constat.excelJournalMeta.dateTo
          ? `${constat.excelJournalMeta.dateFrom} → ${constat.excelJournalMeta.dateTo}`
          : "—"}
        {" · "}
        {constat.excelJournalMeta.linesInMonth} lignes · {constat.excelJournalMeta.daysInMonth} jours
      </p>

      <ul className="grid gap-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
        <li>Jours dans le fichier : {constat.summary.excelDays}</li>
        <li>Jours avec écritures (journal app) : {constat.summary.systemDays}</li>
        <li>Jours alignés : {constat.summary.alignedDays}</li>
        <li>Absents du système : {constat.summary.missingInSystemDays}</li>
        <li>Écarts de totaux : {constat.summary.mismatchDays}</li>
        <li>Absents du fichier : {constat.summary.missingInFileDays}</li>
      </ul>

      <div>
        <p className="mb-1 text-xs font-semibold">Comparaison mensuelle — entrées / sorties (même logique que deux journaux)</p>
        <div className="overflow-x-auto rounded-md border border-violet-200/80 text-[11px] dark:border-violet-800">
          <table className="min-w-full text-left">
            <thead className="bg-violet-100/80 dark:bg-violet-900/40">
              <tr>
                <th className="px-2 py-1 font-semibold">Flux</th>
                <th className="px-2 py-1 font-semibold">Excel caissière</th>
                <th className="px-2 py-1 font-semibold">Journal application</th>
                <th className="px-2 py-1 font-semibold">Écart (Excel − app)</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-violet-200/60 dark:border-violet-800">
                <td className="px-2 py-1">Entrées USD</td>
                <td className="px-2 py-1">{formatAmount(constat.monthGross.excel.inUsd, "USD")}</td>
                <td className="px-2 py-1">{formatAmount(constat.monthGross.system.inUsd, "USD")}</td>
                <td className="px-2 py-1">{formatAmount(constat.monthGross.delta.inUsd, "USD")}</td>
              </tr>
              <tr className="border-t border-violet-200/60 dark:border-violet-800">
                <td className="px-2 py-1">Entrées CDF</td>
                <td className="px-2 py-1">{formatAmount(constat.monthGross.excel.inCdf, "CDF")}</td>
                <td className="px-2 py-1">{formatAmount(constat.monthGross.system.inCdf, "CDF")}</td>
                <td className="px-2 py-1">{formatAmount(constat.monthGross.delta.inCdf, "CDF")}</td>
              </tr>
              <tr className="border-t border-violet-200/60 dark:border-violet-800">
                <td className="px-2 py-1">Sorties USD</td>
                <td className="px-2 py-1">{formatAmount(constat.monthGross.excel.outUsd, "USD")}</td>
                <td className="px-2 py-1">{formatAmount(constat.monthGross.system.outUsd, "USD")}</td>
                <td className="px-2 py-1">{formatAmount(constat.monthGross.delta.outUsd, "USD")}</td>
              </tr>
              <tr className="border-t border-violet-200/60 dark:border-violet-800">
                <td className="px-2 py-1">Sorties CDF</td>
                <td className="px-2 py-1">{formatAmount(constat.monthGross.excel.outCdf, "CDF")}</td>
                <td className="px-2 py-1">{formatAmount(constat.monthGross.system.outCdf, "CDF")}</td>
                <td className="px-2 py-1">{formatAmount(constat.monthGross.delta.outCdf, "CDF")}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-violet-900/75 dark:text-violet-200/75">
          Détail billets vs autres entrées : billets USD Δ {formatAmount(constat.monthTotals.delta.ticketInUsd, "USD")} ·
          autres entrées USD Δ {formatAmount(constat.monthTotals.delta.otherInUsd, "USD")}
        </p>
      </div>

      {constat.datesToSync.length > 0 ? (
        <p className="text-xs font-semibold text-emerald-900 dark:text-emerald-200">
          Jours proposés à l&apos;import : {constat.datesToSync.join(", ")}
        </p>
      ) : null}

      {issueDays.length > 0 ? (
        <div>
          <p className="mb-1 text-xs font-semibold">Détail des écarts ({issueDays.length} jour(s))</p>
          <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
            {issueDays.map((day) => (
              <li key={day.date} className="rounded-md border border-violet-200/80 px-2 py-1 dark:border-violet-800">
                <span className="font-mono">{day.date}</span> · {dayStatusLabel(day.status)} · fichier {day.excel.lineCount}{" "}
                lignes / système {day.system.lineCount} lignes
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-violet-900/80 dark:text-violet-200/80">Aucun écart jour par jour.</p>
      )}
    </div>
  );
}

function statusTone(status: ImportPreview["analysis"]["status"]) {
  if (status === "NEW_DAYS" || status === "RECONCILE_ONLY") {
    return "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200";
  }
  if (status === "UP_TO_DATE") {
    return "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-200";
  }
  return "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200";
}

type ImportHistoryRow = {
  id: string;
  reportMonth: string;
  fileName: string;
  closingDate: string;
  status: string;
  createdAt: string;
  restoredAt: string | null;
  journalLineCount: number;
  cashOpSyncCount: number;
  importedByLabel: string;
  canRestore: boolean;
};

function ImportRestoreHistoryPanel({ reportMonth }: { reportMonth?: string }) {
  const [rows, setRows] = useState<ImportHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const query = reportMonth ? `?reportMonth=${encodeURIComponent(reportMonth)}` : "";
      const response = await fetch(`/api/payments/cash-report/import/history${query}`, { credentials: "include" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setFeedback(payload?.error ?? "Impossible de charger l'historique.");
        setRows([]);
        return;
      }
      setRows((payload?.data as ImportHistoryRow[]) ?? []);
      setFeedback("");
    } catch {
      setFeedback("Erreur réseau lors du chargement de l'historique.");
    } finally {
      setLoading(false);
    }
  }, [reportMonth]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  async function restoreImport(importId: string, fileName: string) {
    const confirmed = window.confirm(
      `Restaurer l'état d'avant l'import « ${fileName} » ?\n\nLes écritures créées par cet import seront supprimées et les opérations caisse sauvegardées avant l'import seront rétablies sur les jours concernés.`,
    );
    if (!confirmed) return;

    setRestoringId(importId);
    setFeedback("");
    try {
      const response = await fetch(`/api/payments/cash-report/import/${importId}/restore`, {
        method: "POST",
        credentials: "include",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setFeedback(payload?.error ?? "Restauration impossible.");
        return;
      }
      setFeedback("Restauration terminée. Le journal caisse a été remis comme avant cet import.");
      await loadHistory();
    } catch {
      setFeedback("Erreur réseau lors de la restauration.");
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-amber-300/70 bg-amber-50/60 p-4 dark:border-amber-800 dark:bg-amber-950/20">
      <div>
        <p className="text-sm font-semibold text-amber-950 dark:text-amber-100">Restaurer après import Excel</p>
        <p className="mt-1 text-xs text-amber-900/85 dark:text-amber-200/85">
          Chaque import confirmé enregistre une sauvegarde des opérations caisse THE BEST sur les jours remplacés. Utilisez
          « Restaurer » pour annuler un import et revenir à l&apos;état précédent (paiements billets non concernés).
        </p>
      </div>

      {loading ? <p className="text-xs text-amber-900/70 dark:text-amber-200/70">Chargement…</p> : null}
      {feedback ? <p className="text-xs font-medium text-amber-950 dark:text-amber-100">{feedback}</p> : null}

      {!loading && rows.length === 0 ? (
        <p className="text-xs text-amber-900/70 dark:text-amber-200/70">Aucun import enregistré pour le moment.</p>
      ) : null}

      {rows.length > 0 ? (
        <ul className="divide-y divide-amber-200/80 rounded-lg border border-amber-200/80 dark:divide-amber-900 dark:border-amber-900">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
              <div>
                <p className="font-semibold text-amber-950 dark:text-amber-100">
                  {row.reportMonth} · {row.fileName}
                </p>
                <p className="text-amber-900/80 dark:text-amber-200/80">
                  {new Date(row.createdAt).toLocaleString("fr-FR")} · {row.journalLineCount} lignes · {row.importedByLabel}
                  {row.restoredAt ? ` · restauré le ${new Date(row.restoredAt).toLocaleString("fr-FR")}` : ""}
                </p>
              </div>
              {row.canRestore ? (
                <button
                  type="button"
                  disabled={restoringId === row.id}
                  onClick={() => void restoreImport(row.id, row.fileName)}
                  className="rounded-md border border-amber-700/40 bg-white px-3 py-1.5 font-semibold text-amber-950 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-900/50"
                >
                  {restoringId === row.id ? "Restauration…" : "Restaurer"}
                </button>
              ) : (
                <span className="text-[11px] text-amber-900/65 dark:text-amber-200/65">
                  {row.status === "RESTORED" || row.restoredAt ? "Déjà restauré" : "Sans sauvegarde"}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function CashReportImportAnalysisPanel({ preview }: { preview: ImportPreview }) {
  const { analysis } = preview;

  return (
    <div className="space-y-3 rounded-xl border border-black/10 bg-black/[0.02] p-4 text-xs dark:border-white/10 dark:bg-white/[0.03]">
      {preview.monthlyConstat ? <MonthlyConstatPanel constat={preview.monthlyConstat} /> : null}

      <div className={`rounded-lg border px-3 py-2 font-semibold ${statusTone(analysis.status)}`}>
        {analysis.statusLabel}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <p><span className="text-black/55 dark:text-white/55">Fichier</span><br />{preview.fileName}</p>
        <p>
          <span className="text-black/55 dark:text-white/55">Mois détecté (fichier)</span><br />
          <span className="font-semibold">{preview.reportMonth}</span>
        </p>
        <p className="sm:col-span-2">
          <span className="text-black/55 dark:text-white/55">Mode d&apos;import</span><br />
          {preview.importModeLabel ?? preview.analysis.statusLabel}
        </p>
        <p>
          <span className="text-black/55 dark:text-white/55">Billetage / virtuel (fichier)</span><br />
          {preview.deskSnapshotDate ? (
            <>Enregistrés pour le {preview.deskSnapshotDate}</>
          ) : (
            <span className="text-black/55 dark:text-white/55">Non appliqués (mois passé ou hors mois courant)</span>
          )}
        </p>
        <p>
          <span className="text-black/55 dark:text-white/55">Date de clôture (réf.)</span><br />
          {preview.closingDate}
          {preview.closingDateAdjusted ? (
            <span className="text-amber-700 dark:text-amber-300"> · ajustée au journal</span>
          ) : null}
        </p>
        <p>
          <span className="text-black/55 dark:text-white/55">Période journal (fichier)</span><br />
          {analysis.journalRange.from && analysis.journalRange.to
            ? `${analysis.journalRange.from} → ${analysis.journalRange.to}`
            : "—"}
        </p>
        <p>
          <span className="text-black/55 dark:text-white/55">Dernier jour importé</span><br />
          {analysis.lastImportedDate ?? "Aucun (premier import)"}
        </p>
        <p>
          <span className="text-black/55 dark:text-white/55">Jours à traiter</span><br />
          {preview.datesToImport.length ? preview.datesToImport.join(", ") : "Aucun"}
        </p>
      </div>

      <div>
        <p className="mb-1 font-semibold">Totaux des jours à importer</p>
        <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
          <li>Billets USD : {formatAmount(analysis.totals.ticketInUsd, "USD")}</li>
          <li>Billets CDF : {formatAmount(analysis.totals.ticketInCdf, "CDF")}</li>
          <li>Autres entrées USD : {formatAmount(analysis.totals.otherInUsd, "USD")}</li>
          <li>Autres entrées CDF : {formatAmount(analysis.totals.otherInCdf, "CDF")}</li>
          <li>Sorties USD : {formatAmount(analysis.totals.outUsd, "USD")}</li>
          <li>Sorties CDF : {formatAmount(analysis.totals.outCdf, "CDF")}</li>
        </ul>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div>
          <p className="mb-1 font-semibold">Aperçu billets ({preview.stats.ticketLines})</p>
          {analysis.samples.tickets.length === 0 ? (
            <p className="text-black/55 dark:text-white/55">Aucune entrée billet sur les jours sélectionnés.</p>
          ) : (
            <ul className="space-y-1">
              {analysis.samples.tickets.map((line) => (
                <li key={`${line.date}-${line.libelle}`} className="rounded-md border border-black/10 px-2 py-1 dark:border-white/10">
                  <span className="font-mono text-[10px]">{line.date}</span> ·{" "}
                  {line.amountSummary && line.amountSummary !== "—" ? line.amountSummary : formatAmount(line.amount, line.currency)}
                  <span className={line.ticketMatched ? " text-emerald-700 dark:text-emerald-300" : " text-amber-700 dark:text-amber-300"}>
                    {line.ticketMatched ? " · ticket trouvé" : " · à rattacher"}
                  </span>
                  <p className="text-black/70 dark:text-white/70">{line.libelle}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="mb-1 font-semibold">Aperçu autres mouvements</p>
          {analysis.samples.movements.length === 0 ? (
            <p className="text-black/55 dark:text-white/55">Aucun autre mouvement sur les jours sélectionnés.</p>
          ) : (
            <ul className="space-y-1">
              {analysis.samples.movements.map((line) => (
                <li key={`${line.date}-${line.libelle}`} className="rounded-md border border-black/10 px-2 py-1 dark:border-white/10">
                  <span className="font-mono text-[10px]">{line.date}</span> ·{" "}
                  {line.amountSummary && line.amountSummary !== "—" ? line.amountSummary : formatAmount(line.amount, line.currency)}
                  <p className="text-black/70 dark:text-white/70">{line.libelle}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {preview.billetages.length > 0 ? (
        <div>
          <p className="mb-1 font-semibold">Billetage (feuilles détectées)</p>
          <ul className="flex flex-wrap gap-2">
            {preview.billetages.map((item) => (
              <li key={item.variant} className="rounded-md border border-black/15 px-2 py-1 dark:border-white/15">
                {item.variant} · {formatAmount(item.totalUsd, "USD")} / {formatAmount(item.totalCdf, "CDF")}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {analysis.virtual.channels.length > 0 ? (
        <div>
          <p className="mb-1 font-semibold">
            Virtuel · {formatAmount(analysis.virtual.totalUsd, "USD")} / {formatAmount(analysis.virtual.totalCdf, "CDF")}
          </p>
          <ul className="grid gap-1 sm:grid-cols-2">
            {analysis.virtual.channels.slice(0, 6).map((channel) => (
              <li key={channel.label} className="text-black/75 dark:text-white/75">
                {channel.label} : {formatAmount(channel.usd, "USD")} · {formatAmount(channel.cdf, "CDF")}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {preview.warnings.length > 0 ? (
        <ul className="list-disc pl-4 text-amber-800 dark:text-amber-300">
          {preview.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function CashReportExcelImportWorkspace() {
  const [file, setFile] = useState<File | null>(null);
  const [closingDate, setClosingDate] = useState(() => kinshasaDateKey());
  const [reconcileDates, setReconcileDates] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const analyzeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const analyzeAbortRef = useRef<AbortController | null>(null);
  const analyzeSeqRef = useRef(0);
  const closingDateManualRef = useRef(false);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

  const canCommit = useMemo(
    () => Boolean(file && preview?.dryRun && preview.analysis.readyToCommit),
    [file, preview],
  );

  const runAnalysis = useCallback(async (targetFile: File, dryRun: boolean) => {
    analyzeAbortRef.current?.abort();
    const abortController = new AbortController();
    analyzeAbortRef.current = abortController;
    const requestSeq = analyzeSeqRef.current + 1;
    analyzeSeqRef.current = requestSeq;

    setLoading(true);
    setMessage(dryRun ? "Analyse du fichier…" : "");

    const formData = new FormData();
    formData.set("file", sanitizeCashReportUploadFile(targetFile));
    formData.set("dryRun", dryRun ? "true" : "false");
    formData.set("closingDate", closingDate);
    if (reconcileDates.trim()) formData.set("reconcileDates", reconcileDates.trim());

    try {
      const response = await fetch("/api/payments/cash-report/import", {
        method: "POST",
        body: formData,
        credentials: "include",
        signal: abortController.signal,
      });
      const contentType = response.headers.get("content-type") ?? "";
      const payload = contentType.includes("application/json") ? await response.json().catch(() => null) : null;
      if (requestSeq !== analyzeSeqRef.current) return false;
      if (!response.ok) {
        const fallback =
          response.status === 401
            ? "Session expirée — reconnectez-vous."
            : response.status === 403
              ? payload
                ? "Accès refusé (403) : droits insuffisants pour l’import Excel caisse."
                : "Accès refusé (403) sans message serveur — souvent le pare-feu Hostinger (nom de fichier avec apostrophe, etc.). Renommez le fichier (ex. Journal-OCTOBRE-2026.xlsx) et réessayez."
              : payload
                ? "Analyse impossible."
                : `Analyse impossible (HTTP ${response.status}). Réponse non JSON — vérifiez les logs serveur ou renommez le fichier Excel.`;
        setMessage(typeof payload?.error === "string" && payload.error.trim() ? payload.error : fallback);
        if (dryRun) setPreview(null);
        return false;
      }

      const data = payload?.data as ImportPreview;
      setPreview(data);
      if (!closingDateManualRef.current && data.suggestedClosingDate) {
        setClosingDate(data.suggestedClosingDate);
      }
      setMessage(
        dryRun
          ? data.monthlyConstat?.closedMonth
            ? "Constat mensuel prêt. Vérifiez les écarts avant de confirmer l'import."
            : "Analyse terminée. Vérifiez le résumé avant de confirmer."
          : "Import enregistré.",
      );
      if (!dryRun) {
        setHistoryRefreshKey((value) => value + 1);
        setMessage("Import enregistré. Un point de restauration a été créé — voir la section « Restaurer » ci-dessous.");
      }
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return false;
      setMessage("Erreur réseau.");
      return false;
    } finally {
      if (requestSeq === analyzeSeqRef.current) {
        setLoading(false);
      }
    }
  }, [closingDate, reconcileDates]);

  useEffect(() => {
    if (!file) return undefined;

    if (analyzeTimerRef.current) clearTimeout(analyzeTimerRef.current);
    analyzeTimerRef.current = setTimeout(() => {
      void runAnalysis(file, true).catch(() => {
        /* évite unhandledrejection si la requête est interrompue */
      });
    }, 900);

    return () => {
      if (analyzeTimerRef.current) clearTimeout(analyzeTimerRef.current);
      analyzeAbortRef.current?.abort();
    };
  }, [file, closingDate, reconcileDates, runAnalysis]);

  async function submit(event: FormEvent, dryRun: boolean) {
    event.preventDefault();
    if (!file) {
      setMessage("Choisissez le rapport Excel de caisse.");
      return;
    }
    await runAnalysis(file, dryRun);
  }

  return (
    <section className="space-y-4 rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
      <div>
        <h2 className="text-sm font-semibold">Import rapport Excel (Caisse 2 / THE BEST)</h2>
        <p className="mt-1 text-xs text-black/60 dark:text-white/60">
          Le mois est lu dans le fichier Excel (journal de caisse), pas la date du jour. Le constat compare ce mois-là au
          système. La date de clôture sert au billetage / virtuel et est proposée automatiquement (dernier jour du journal).
        </p>
      </div>

      <form className="grid gap-3" onSubmit={(event) => void submit(event, true)}>
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setPreview(null);
            setMessage("");
            closingDateManualRef.current = false;
          }}
          className="text-sm"
        />
        <label className="grid gap-1 text-xs">
          <span className="font-semibold text-black/70 dark:text-white/70">Date de clôture (billetage / virtuel)</span>
          <input
            type="date"
            value={closingDate}
            onChange={(event) => {
              closingDateManualRef.current = true;
              setClosingDate(event.target.value);
            }}
            className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
          />
        </label>
        <label className="grid gap-1 text-xs">
          <span className="font-semibold text-black/70 dark:text-white/70">Dates à réconcilier (optionnel)</span>
          <input
            value={reconcileDates}
            onChange={(event) => setReconcileDates(event.target.value)}
            placeholder="2026-09-10, 2026-09-11"
            className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
          />
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={loading || !file}
            className="rounded-md border border-black/20 px-4 py-2 text-sm font-semibold hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10"
          >
            {loading ? "Analyse…" : "Relancer l'analyse"}
          </button>
          <button
            type="button"
            disabled={loading || !canCommit}
            onClick={(event) => void submit(event as unknown as FormEvent, false)}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-emerald-700"
          >
            Confirmer l&apos;import
          </button>
        </div>
      </form>

      {message ? <p className="text-xs text-black/65 dark:text-white/65">{message}</p> : null}

      {loading && !preview ? (
        <p className="text-xs text-black/55 dark:text-white/55">Lecture des feuilles journal, billetage et virtuel…</p>
      ) : null}

      {preview ? <CashReportImportAnalysisPanel preview={preview} /> : null}

      <ImportRestoreHistoryPanel key={historyRefreshKey} reportMonth={preview?.reportMonth} />
    </section>
  );
}
