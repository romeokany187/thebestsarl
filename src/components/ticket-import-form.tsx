"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type HistoryEntry = {
  id: string;
  createdAt: string;
  actorName: string;
  actorEmail: string;
  fileName: string | null;
  mode: "PREVIEW" | "IMPORT";
  periodMode: "DAY" | "MONTH" | "YEAR" | "CUSTOM" | null;
  year: number | null;
  month: number | null;
  rangeStart: string | null;
  rangeEnd: string | null;
  sheetName: string | null;
  replaceExistingPeriod: boolean;
  dryRun: boolean;
  createdCount: number;
  failedCount: number;
  totalRows: number;
};

type ImportResult = {
  summary: {
    sheetsProcessed: number;
    totalRows: number;
    skippedEmpty: number;
    skippedOutsideRange: number;
    created: number;
    updated: number;
    failed: number;
  };
  errors: string[];
  range: { start: string; end: string };
  sheetNames: string[];
  dryRun: boolean;
  replaceExistingPeriod: boolean;
  previewRows: Array<{
    sheet: string;
    line: number;
    sourceTicketNumber: string | null;
    finalTicketNumber: string | null;
    customerName: string | null;
    sellerName: string | null;
    airlineName: string | null;
    route: string | null;
    amount: number | null;
    currency: string | null;
    soldAt: string | null;
    status: "READY" | "SKIPPED_EMPTY" | "SKIPPED_OUTSIDE_RANGE" | "ERROR";
    message: string | null;
  }>;
  previewTruncated: boolean;
  historyEntry?: HistoryEntry;
};

type FormState = {
  file: File | null;
  periodMode: "DAY" | "MONTH" | "YEAR" | "CUSTOM";
  year: string;
  month: string;
  date: string;
  startDate: string;
  endDate: string;
  sheetName: string;
  defaultSellerEmail: string;
  dryRun: boolean;
  replaceExistingPeriod: boolean;
};

function currentPeriodDefaults() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  return {
    year: String(now.getUTCFullYear()),
    month: String(now.getUTCMonth() + 1),
    date: today,
    startDate: today,
    endDate: today,
  };
}

function periodModeLabel(mode: HistoryEntry["periodMode"]) {
  if (mode === "DAY") return "Jour";
  if (mode === "YEAR") return "Année";
  if (mode === "CUSTOM") return "Plage";
  return "Mois";
}

function normalizeLooseText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function detectPeriodHintFromFileName(fileName: string): { month?: number; year?: number } | null {
  const normalized = normalizeLooseText(fileName);

  const monthByName: Array<[RegExp, number]> = [
    [/janv|janvier/, 1],
    [/fev|fevr|fevrier/, 2],
    [/mars/, 3],
    [/avr|avril/, 4],
    [/mai/, 5],
    [/juin/, 6],
    [/juil|juillet/, 7],
    [/aout|août/, 8],
    [/sept|septembre/, 9],
    [/oct|octobre/, 10],
    [/nov|novembre/, 11],
    [/dec|decembre/, 12],
  ];

  let month: number | undefined;
  for (const [pattern, value] of monthByName) {
    if (pattern.test(normalized)) {
      month = value;
      break;
    }
  }

  const yearMatch = normalized.match(/\b(20\d{2})\b/);
  const year = yearMatch ? Number.parseInt(yearMatch[1], 10) : undefined;

  if (!month) {
    const ymd = normalized.match(/\b(20\d{2})[-_\s.\/](\d{1,2})\b/);
    if (ymd) {
      const numericMonth = Number.parseInt(ymd[2], 10);
      if (numericMonth >= 1 && numericMonth <= 12) {
        month = numericMonth;
      }
    }
  }

  if (!month && !year) return null;
  return { month, year };
}

function selectedPeriodSummary(form: FormState) {
  if (form.periodMode === "MONTH") {
    const year = Number.parseInt(form.year, 10);
    const month = Number.parseInt(form.month, 10);
    if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
    return { start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)) };
  }

  if (form.periodMode === "YEAR") {
    const year = Number.parseInt(form.year, 10);
    if (!Number.isFinite(year)) return null;
    return { start: new Date(Date.UTC(year, 0, 1)), end: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)) };
  }

  if (form.periodMode === "DAY") {
    if (!form.date) return null;
    const date = new Date(`${form.date}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return null;
    return { start: date, end: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999)) };
  }

  if (form.periodMode === "CUSTOM") {
    if (!form.startDate || !form.endDate) return null;
    const start = new Date(`${form.startDate}T00:00:00.000Z`);
    const end = new Date(`${form.endDate}T23:59:59.999Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    return { start, end };
  }

  return null;
}

export function TicketImportForm({
  defaultSellerEmail,
  canReplacePeriod,
  initialHistory,
}: {
  defaultSellerEmail: string;
  canReplacePeriod: boolean;
  initialHistory: HistoryEntry[];
}) {
  const router = useRouter();
  const defaults = currentPeriodDefaults();
  const [form, setForm] = useState<FormState>({
    file: null,
    periodMode: "MONTH",
    year: defaults.year,
    month: defaults.month,
    date: defaults.date,
    startDate: defaults.startDate,
    endDate: defaults.endDate,
    sheetName: "",
    defaultSellerEmail,
    dryRun: true,
    replaceExistingPeriod: false,
  });
  const [status, setStatus] = useState<string>("Simulation recommandée avant import réel.");
  const [statusType, setStatusType] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>(initialHistory);
  const [previewSignature, setPreviewSignature] = useState<string>("");
  const [histFilter, setHistFilter] = useState({ year: "", month: "", email: "" });
  const [histLoading, setHistLoading] = useState(false);

  const currentSignature = useMemo(() => {
    const fileSignature = form.file
      ? `${form.file.name}:${form.file.size}:${form.file.lastModified}`
      : "no-file";
    return [
      fileSignature,
      form.periodMode,
      form.year.trim(),
      form.month.trim(),
      form.date.trim(),
      form.startDate.trim(),
      form.endDate.trim(),
      form.sheetName.trim(),
      form.defaultSellerEmail.trim().toLowerCase(),
    ].join("|");
  }, [form.date, form.defaultSellerEmail, form.endDate, form.file, form.month, form.periodMode, form.sheetName, form.startDate, form.year]);

  const previewValidated = previewSignature.length > 0 && previewSignature === currentSignature;

  const filePeriodWarning = useMemo(() => {
    if (!form.file) return null;

    const hint = detectPeriodHintFromFileName(form.file.name);
    const selected = selectedPeriodSummary(form);
    if (!hint || !selected) return null;

    if (hint.year !== undefined) {
      const yearInRange = hint.year >= selected.start.getUTCFullYear() && hint.year <= selected.end.getUTCFullYear();
      if (!yearInRange) {
        return `Le fichier semble pointer sur l'année ${hint.year}, mais la période sélectionnée est différente.`;
      }
    }

    if (hint.month !== undefined) {
      const startYm = selected.start.getUTCFullYear() * 12 + selected.start.getUTCMonth();
      const endYm = selected.end.getUTCFullYear() * 12 + selected.end.getUTCMonth();
      const referenceYear = hint.year ?? selected.start.getUTCFullYear();
      const hintYm = referenceYear * 12 + (hint.month - 1);
      if (hintYm < startYm || hintYm > endYm) {
        return `Le nom du fichier semble indiquer le mois ${String(hint.month).padStart(2, "0")}${hint.year ? `/${hint.year}` : ""}, mais il n'est pas inclus dans la période choisie.`;
      }
    }

    return null;
  }, [form]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!form.file) {
      setStatusType("error");
      setStatus("Choisissez un fichier Excel avant de lancer l'import.");
      return;
    }

    if (!form.dryRun && !previewValidated) {
      setStatusType("error");
      setStatus("Lancez d'abord une simulation avec ce même fichier et ces mêmes paramètres avant l'import final.");
      return;
    }

    setStatusType("loading");
    setStatus(form.dryRun ? "Simulation en cours..." : "Import en cours...");

    const payload = new FormData();
    payload.append("file", form.file);
    payload.append("periodMode", form.periodMode);
    if (form.year.trim()) {
      payload.append("year", form.year);
    }
    if (form.month.trim()) {
      payload.append("month", form.month);
    }
    if (form.date.trim()) {
      payload.append("date", form.date);
    }
    if (form.startDate.trim()) {
      payload.append("startDate", form.startDate);
    }
    if (form.endDate.trim()) {
      payload.append("endDate", form.endDate);
    }
    payload.append("dryRun", String(form.dryRun));
    if (form.sheetName.trim()) {
      payload.append("sheetName", form.sheetName.trim());
    }
    if (form.defaultSellerEmail.trim()) {
      payload.append("defaultSellerEmail", form.defaultSellerEmail.trim());
    }
    if (canReplacePeriod && form.replaceExistingPeriod) {
      payload.append("replaceExistingPeriod", "true");
    }

    const response = await fetch("/api/tickets/import", {
      method: "POST",
      body: payload,
    });

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setStatusType("error");
      setStatus(body?.error ?? "Import Excel échoué.");
      return;
    }

    const nextResult = body?.data as ImportResult;
    setResult(nextResult);
    setStatusType("success");
    setStatus(nextResult.dryRun ? "Simulation terminée. Vérifiez le résumé puis décochez pour importer réellement." : "Import terminé.");

    if (nextResult.dryRun) {
      setPreviewSignature(currentSignature);
    } else {
      setPreviewSignature("");
    }

    if (nextResult.historyEntry) {
      setHistory((current) => [nextResult.historyEntry!, ...current.filter((entry) => entry.id !== nextResult.historyEntry!.id)].slice(0, 12));
    }

    if (!nextResult.dryRun) {
      router.refresh();
    }
  }

  function exportPreviewCsv() {
    if (!result?.previewRows.length) return;
    const headers = ["Feuille", "Ligne", "PNR source", "PNR final", "Client", "Vendeur", "Compagnie", "Route", "Montant", "Devise", "Date vente", "Statut", "Détail"];
    const escape = (v: string | number | null | undefined) => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      headers.join(","),
      ...result.previewRows.map((r) =>
        [r.sheet, r.line, r.sourceTicketNumber, r.finalTicketNumber, r.customerName, r.sellerName, r.airlineName, r.route, r.amount, r.currency, r.soldAt, r.status, r.message]
          .map(escape)
          .join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `preview-billets-${result.range.start}-${result.range.end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function fetchHistoryFiltered() {
    setHistLoading(true);
    const params = new URLSearchParams();
    if (histFilter.year.trim()) params.set("year", histFilter.year.trim());
    if (histFilter.month.trim()) params.set("month", histFilter.month.trim());
    if (histFilter.email.trim()) params.set("email", histFilter.email.trim());
    const response = await fetch(`/api/tickets/import?${params.toString()}`);
    const body = await response.json().catch(() => null);
    if (response.ok && Array.isArray(body?.data)) {
      setHistory(body.data as HistoryEntry[]);
    }
    setHistLoading(false);
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid gap-3 rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900"
    >
      <div>
        <h3 className="text-sm font-semibold">Import Excel billets</h3>
        <p className="text-xs text-black/60 dark:text-white/60">
          L&apos;employé autorisé peut déposer un fichier Excel et lancer le traitement directement depuis l&apos;application.
        </p>
      </div>

      <input
        type="file"
        accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        onChange={(event) => update("file", event.target.files?.[0] ?? null)}
        className="w-full rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20"
      />

      <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">
        Type de période
        <select
          value={form.periodMode}
          onChange={(event) => update("periodMode", event.target.value as FormState["periodMode"])}
          className="rounded-md border border-black/15 px-3 py-2 text-sm font-normal text-black dark:border-white/20 dark:bg-zinc-900 dark:text-white"
        >
          <option value="DAY">Jour</option>
          <option value="MONTH">Mois</option>
          <option value="YEAR">Année</option>
          <option value="CUSTOM">Plage personnalisée</option>
        </select>
      </label>

      {form.periodMode === "MONTH" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">
            Année
            <input
              type="number"
              min="2000"
              max="2100"
              value={form.year}
              onChange={(event) => update("year", event.target.value)}
              className="rounded-md border border-black/15 px-3 py-2 text-sm font-normal text-black dark:border-white/20 dark:bg-zinc-900 dark:text-white"
            />
          </label>
          <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">
            Mois
            <input
              type="number"
              min="1"
              max="12"
              value={form.month}
              onChange={(event) => update("month", event.target.value)}
              className="rounded-md border border-black/15 px-3 py-2 text-sm font-normal text-black dark:border-white/20 dark:bg-zinc-900 dark:text-white"
            />
          </label>
        </div>
      ) : null}

      {form.periodMode === "YEAR" ? (
        <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">
          Année
          <input
            type="number"
            min="2000"
            max="2100"
            value={form.year}
            onChange={(event) => update("year", event.target.value)}
            className="rounded-md border border-black/15 px-3 py-2 text-sm font-normal text-black dark:border-white/20 dark:bg-zinc-900 dark:text-white"
          />
        </label>
      ) : null}

      {form.periodMode === "DAY" ? (
        <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">
          Jour ciblé
          <input
            type="date"
            value={form.date}
            onChange={(event) => update("date", event.target.value)}
            className="rounded-md border border-black/15 px-3 py-2 text-sm font-normal text-black dark:border-white/20 dark:bg-zinc-900 dark:text-white"
          />
        </label>
      ) : null}

      {form.periodMode === "CUSTOM" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">
            Début
            <input
              type="date"
              value={form.startDate}
              onChange={(event) => update("startDate", event.target.value)}
              className="rounded-md border border-black/15 px-3 py-2 text-sm font-normal text-black dark:border-white/20 dark:bg-zinc-900 dark:text-white"
            />
          </label>
          <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">
            Fin
            <input
              type="date"
              value={form.endDate}
              onChange={(event) => update("endDate", event.target.value)}
              className="rounded-md border border-black/15 px-3 py-2 text-sm font-normal text-black dark:border-white/20 dark:bg-zinc-900 dark:text-white"
            />
          </label>
        </div>
      ) : null}

      {filePeriodWarning ? (
        <div className="rounded-md bg-amber-100 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          {filePeriodWarning}
        </div>
      ) : null}

      <input
        type="text"
        value={form.sheetName}
        onChange={(event) => update("sheetName", event.target.value)}
        placeholder="Nom de feuille optionnel"
        className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20 dark:bg-zinc-900"
      />

      <input
        type="email"
        value={form.defaultSellerEmail}
        onChange={(event) => update("defaultSellerEmail", event.target.value)}
        placeholder="Email vendeur par défaut"
        className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20 dark:bg-zinc-900"
      />

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.dryRun}
          onChange={(event) => {
            update("dryRun", event.target.checked);
            if (event.target.checked) {
              setStatus("Simulation recommandée avant import réel.");
            }
          }}
          className="mt-0.5"
        />
        <span>Mode simulation: analyse le fichier et affiche le résultat sans écrire en base.</span>
      </label>

      {!form.dryRun ? (
        <div className={`rounded-md px-3 py-2 text-xs ${previewValidated ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200" : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200"}`}>
          {previewValidated
            ? "Prévisualisation validée pour ce fichier. Vous pouvez confirmer l'import final."
            : "Import final verrouillé tant qu'une simulation valide n'a pas été effectuée avec ce même fichier et ces mêmes paramètres."}
        </div>
      ) : null}

      {canReplacePeriod ? (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.replaceExistingPeriod}
            onChange={(event) => update("replaceExistingPeriod", event.target.checked)}
            className="mt-0.5"
            disabled={form.dryRun}
          />
          <span>Remplacer les ventes déjà enregistrées pour la période ciblée avant réimport.</span>
        </label>
      ) : null}

      <button
        type="submit"
        disabled={statusType === "loading" || !form.file || (!form.dryRun && !previewValidated)}
        className="rounded-md bg-black px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-black"
      >
        {statusType === "loading" ? "Traitement..." : form.dryRun ? "Lancer la simulation" : "Importer le fichier"}
      </button>

      <div className={`rounded-md px-3 py-2 text-sm ${statusType === "error" ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-200" : statusType === "success" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200" : "bg-black/5 text-black/70 dark:bg-white/10 dark:text-white/70"}`}>
        {status}
      </div>

      {result ? (
        <div className="grid gap-3 rounded-lg border border-black/10 p-3 text-sm dark:border-white/10">
          <p>
            Période traitée: {result.range.start} → {result.range.end}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <p>Feuilles traitées: {result.summary.sheetsProcessed}</p>
            <p>Lignes lues: {result.summary.totalRows}</p>
            <p>Créées: {result.summary.created}</p>
            <p>Échecs: {result.summary.failed}</p>
            <p>Ignorées vide: {result.summary.skippedEmpty}</p>
            <p>Ignorées hors période: {result.summary.skippedOutsideRange}</p>
          </div>
          {result.previewRows.length > 0 ? (
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold">Prévisualisation détaillée</p>
                <button
                  type="button"
                  onClick={exportPreviewCsv}
                  className="rounded-md border border-black/15 px-3 py-1 text-xs font-medium hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                >
                  Télécharger CSV
                </button>
              </div>
              <div className="max-h-80 overflow-auto rounded-md border border-black/10 dark:border-white/10">
                <table className="min-w-full text-xs">
                  <thead className="bg-black/5 dark:bg-white/10">
                    <tr>
                      <th className="px-2 py-2 text-left">Feuille</th>
                      <th className="px-2 py-2 text-left">Ligne</th>
                      <th className="px-2 py-2 text-left">PNR source</th>
                      <th className="px-2 py-2 text-left">PNR final</th>
                      <th className="px-2 py-2 text-left">Client</th>
                      <th className="px-2 py-2 text-left">Compagnie</th>
                      <th className="px-2 py-2 text-left">Montant</th>
                      <th className="px-2 py-2 text-left">Statut</th>
                      <th className="px-2 py-2 text-left">Détail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.previewRows.map((row) => (
                      <tr key={`${row.sheet}-${row.line}-${row.sourceTicketNumber ?? "vide"}`} className="border-t border-black/5 dark:border-white/10">
                        <td className="px-2 py-1.5">{row.sheet}</td>
                        <td className="px-2 py-1.5">{row.line}</td>
                        <td className="px-2 py-1.5">{row.sourceTicketNumber ?? "—"}</td>
                        <td className="px-2 py-1.5">{row.finalTicketNumber ?? "—"}</td>
                        <td className="px-2 py-1.5">{row.customerName ?? "—"}</td>
                        <td className="px-2 py-1.5">{row.airlineName ?? "—"}</td>
                        <td className="px-2 py-1.5">{row.amount !== null ? `${row.amount.toFixed(2)} ${row.currency ?? "USD"}` : "—"}</td>
                        <td className="px-2 py-1.5">{row.status}</td>
                        <td className="px-2 py-1.5">{row.message ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {result.previewTruncated ? <p className="text-xs text-black/60 dark:text-white/60">Prévisualisation tronquée aux premières lignes pour garder l&apos;interface lisible.</p> : null}
            </div>
          ) : null}
          {result.errors.length > 0 ? (
            <div className="grid gap-1 rounded-md bg-black/5 p-3 text-xs dark:bg-white/10">
              <p className="font-semibold">Premières erreurs</p>
              {result.errors.slice(0, 8).map((entry) => (
                <p key={entry}>{entry}</p>
              ))}
              {result.errors.length > 8 ? <p>... {result.errors.length - 8} erreurs supplémentaires</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-2 rounded-lg border border-black/10 p-3 text-sm dark:border-white/10">
        <div>
          <h4 className="font-semibold">Historique des imports</h4>
          <p className="text-xs text-black/60 dark:text-white/60">Qui a lancé quoi, quand, et avec quel résultat.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-4">
          <input
            type="number"
            min="2000"
            max="2100"
            value={histFilter.year}
            onChange={(e) => setHistFilter((f) => ({ ...f, year: e.target.value }))}
            placeholder="Année"
            className="rounded-md border border-black/15 px-2 py-1.5 text-xs dark:border-white/20 dark:bg-zinc-900"
          />
          <input
            type="number"
            min="1"
            max="12"
            value={histFilter.month}
            onChange={(e) => setHistFilter((f) => ({ ...f, month: e.target.value }))}
            placeholder="Mois"
            className="rounded-md border border-black/15 px-2 py-1.5 text-xs dark:border-white/20 dark:bg-zinc-900"
          />
          <input
            type="email"
            value={histFilter.email}
            onChange={(e) => setHistFilter((f) => ({ ...f, email: e.target.value }))}
            placeholder="Email auteur"
            className="rounded-md border border-black/15 px-2 py-1.5 text-xs dark:border-white/20 dark:bg-zinc-900"
          />
          <button
            type="button"
            onClick={fetchHistoryFiltered}
            disabled={histLoading}
            className="rounded-md bg-black/10 px-3 py-1.5 text-xs font-medium hover:bg-black/20 disabled:opacity-50 dark:bg-white/10 dark:hover:bg-white/20"
          >
            {histLoading ? "..." : "Filtrer"}
          </button>
        </div>
        {history.length === 0 ? (
          <p className="text-xs text-black/60 dark:text-white/60">Aucun import journalisé pour le moment.</p>
        ) : (
          <div className="max-h-64 overflow-auto rounded-md border border-black/10 dark:border-white/10">
            <table className="min-w-full text-xs">
              <thead className="bg-black/5 dark:bg-white/10">
                <tr>
                  <th className="px-2 py-2 text-left">Date</th>
                  <th className="px-2 py-2 text-left">Auteur</th>
                  <th className="px-2 py-2 text-left">Mode</th>
                  <th className="px-2 py-2 text-left">Fichier</th>
                  <th className="px-2 py-2 text-left">Période</th>
                  <th className="px-2 py-2 text-left">Créées</th>
                  <th className="px-2 py-2 text-left">Échecs</th>
                  <th className="px-2 py-2 text-left">Total</th>
                </tr>
              </thead>
              <tbody>
                {history.map((entry) => (
                  <tr key={entry.id} className="border-t border-black/5 dark:border-white/10">
                    <td className="px-2 py-1.5">{new Date(entry.createdAt).toLocaleString("fr-FR")}</td>
                    <td className="px-2 py-1.5">{entry.actorName}</td>
                    <td className="px-2 py-1.5">{entry.mode}</td>
                    <td className="px-2 py-1.5">{entry.fileName ?? "—"}</td>
                    <td className="px-2 py-1.5">{entry.rangeStart && entry.rangeEnd ? `${periodModeLabel(entry.periodMode)} • ${entry.rangeStart} → ${entry.rangeEnd}` : "—"}</td>
                    <td className="px-2 py-1.5">{entry.createdCount}</td>
                    <td className="px-2 py-1.5">{entry.failedCount}</td>
                    <td className="px-2 py-1.5">{entry.totalRows}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </form>
  );
}