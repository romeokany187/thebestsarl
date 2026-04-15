"use client";

import { useMemo, useState } from "react";

type AccountOption = {
  code: string;
  label: string;
};

type JournalPreview = {
  reportType: "journal";
  periodLabel: string;
  entryCount: number;
  totals: {
    debitUsd: number;
    creditUsd: number;
    debitCdf: number;
    creditCdf: number;
  };
  entries: Array<{
    id: string;
    sequence: number;
    entryDate: string;
    pole?: string | null;
    libelle: string;
    pieceJustificative?: string | null;
    exchangeRate?: number | null;
    createdBy?: { name?: string | null } | null;
    lines: Array<{
      id: string;
      side: "DEBIT" | "CREDIT";
      accountCode: string;
      accountLabel: string;
      amountUsd?: number | null;
      amountCdf?: number | null;
    }>;
  }>;
};

type LedgerPreview = {
  reportType: "ledger";
  periodLabel: string;
  accountCode?: string | null;
  includeSubaccounts: boolean;
  groupCount: number;
  totals: {
    debitUsd: number;
    creditUsd: number;
    debitCdf: number;
    creditCdf: number;
  };
  groups: Array<{
    accountCode: string;
    accountLabel: string;
    totals: {
      debitUsd: number;
      creditUsd: number;
      debitCdf: number;
      creditCdf: number;
    };
    rows: Array<{
      entryId: string;
      sequence: number;
      entryDate: string;
      libelle: string;
      pieceJustificative?: string | null;
      pole?: string | null;
      side: "DEBIT" | "CREDIT";
      debitUsd: number;
      creditUsd: number;
      debitCdf: number;
      creditCdf: number;
      counterparts: string;
    }>;
  }>;
};

type PreviewPayload = JournalPreview | LedgerPreview;

function money(value: number) {
  return value.toFixed(2);
}

export function AccountingReportsWorkspace({ accounts }: { accounts: AccountOption[] }) {
  const currentMonth = useMemo(() => new Date().toISOString().slice(0, 7), []);
  const [reportType, setReportType] = useState<"journal" | "ledger">("journal");
  const [month, setMonth] = useState(currentMonth);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [accountCode, setAccountCode] = useState("");
  const [includeSubaccounts, setIncludeSubaccounts] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<PreviewPayload | null>(null);

  function buildParams(extra?: Record<string, string>) {
    const params = new URLSearchParams();
    params.set("reportType", reportType);
    if (startDate || endDate) {
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
    } else {
      params.set("month", month);
    }
    if (reportType === "ledger" && accountCode.trim()) {
      params.set("accountCode", accountCode.trim());
      if (includeSubaccounts) params.set("includeSubaccounts", "1");
    }
    if (extra) {
      for (const [key, value] of Object.entries(extra)) {
        params.set(key, value);
      }
    }
    return params.toString();
  }

  async function loadPreview() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/comptabilite/reports?${buildParams()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error ?? "Impossible de charger le rapport comptable.");
        setLoading(false);
        return;
      }
      setPreview(payload);
    } catch {
      setError("Erreur réseau lors du chargement du rapport.");
    }
    setLoading(false);
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-black/50 dark:text-white/50">Rapports comptables</p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight">Livre journal et grands livres</h2>
            <p className="mt-2 max-w-3xl text-sm text-black/60 dark:text-white/60">
              Les rapports sont calcules a partir du livre journal deja saisi. Tu peux les afficher a l'ecran, puis les tirer en PDF sur la periode choisie. La numerotation du journal suit la sequence logique des ecritures deja enregistrees.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={loadPreview} disabled={loading} className="rounded-md bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-black">
              {loading ? "Chargement…" : "Afficher"}
            </button>
            <a href={`/api/comptabilite/reports?${buildParams({ format: "pdf" })}`} target="_blank" rel="noreferrer" className="rounded-md border border-black/15 px-4 py-2 text-sm font-semibold hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10">
              Ouvrir PDF
            </a>
            <a href={`/api/comptabilite/reports?${buildParams({ format: "pdf", download: "1" })}`} className="rounded-md border border-black/15 px-4 py-2 text-sm font-semibold hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10">
              Télécharger PDF
            </a>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Type de rapport</label>
            <select value={reportType} onChange={(event) => setReportType(event.target.value as "journal" | "ledger")} className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900">
              <option value="journal">Livre journal</option>
              <option value="ledger">Grand livre</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Mois</label>
            <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Début personnalisé</label>
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Fin personnalisée</label>
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Compte pour grand livre</label>
            <input list="accounting-report-accounts" value={accountCode} onChange={(event) => setAccountCode(event.target.value)} placeholder="Tous les comptes mouvementés" className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm font-mono dark:border-white/15 dark:bg-zinc-900" />
          </div>
        </div>

        {reportType === "ledger" ? (
          <label className="mt-3 flex items-center gap-2 text-sm text-black/65 dark:text-white/65">
            <input type="checkbox" checked={includeSubaccounts} onChange={(event) => setIncludeSubaccounts(event.target.checked)} />
            Inclure les sous-comptes du compte sélectionné
          </label>
        ) : null}

        <datalist id="accounting-report-accounts">
          {accounts.map((account) => (
            <option key={account.code} value={account.code}>{account.label}</option>
          ))}
        </datalist>
      </section>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      ) : null}

      {preview ? (
        <section className="space-y-4 rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-black/50 dark:text-white/50">Aperçu écran</p>
            <h3 className="mt-1 text-base font-semibold">{preview.reportType === "journal" ? "Livre journal" : "Grand livre"}</h3>
            <p className="mt-1 text-sm text-black/60 dark:text-white/60">{preview.periodLabel}</p>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-black/10 px-3 py-3 text-sm dark:border-white/10">
              <p className="text-xs text-black/55 dark:text-white/55">USD débit</p>
              <p className="mt-1 font-semibold">{money(preview.totals.debitUsd)}</p>
            </div>
            <div className="rounded-xl border border-black/10 px-3 py-3 text-sm dark:border-white/10">
              <p className="text-xs text-black/55 dark:text-white/55">USD crédit</p>
              <p className="mt-1 font-semibold">{money(preview.totals.creditUsd)}</p>
            </div>
            <div className="rounded-xl border border-black/10 px-3 py-3 text-sm dark:border-white/10">
              <p className="text-xs text-black/55 dark:text-white/55">CDF débit</p>
              <p className="mt-1 font-semibold">{money(preview.totals.debitCdf)}</p>
            </div>
            <div className="rounded-xl border border-black/10 px-3 py-3 text-sm dark:border-white/10">
              <p className="text-xs text-black/55 dark:text-white/55">CDF crédit</p>
              <p className="mt-1 font-semibold">{money(preview.totals.creditCdf)}</p>
            </div>
          </div>

          {preview.reportType === "journal" ? (
            <div className="space-y-3">
              {preview.entries.length === 0 ? (
                <p className="rounded-xl border border-dashed border-black/15 px-4 py-6 text-sm text-black/55 dark:border-white/15 dark:text-white/55">
                  Aucune écriture trouvée sur cette période.
                </p>
              ) : preview.entries.map((entry) => (
                <article key={entry.id} className="rounded-xl border border-black/10 p-3 dark:border-white/10">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">Écriture n° {entry.sequence}</p>
                      <p className="text-xs text-black/55 dark:text-white/55">{new Date(entry.entryDate).toLocaleString("fr-FR")} • {entry.pole || "Sans pôle"} • {entry.createdBy?.name ?? "-"}</p>
                    </div>
                    <div className="text-right text-xs text-black/55 dark:text-white/55">
                      <p>Pièce: {entry.pieceJustificative || "-"}</p>
                      <p>Taux: {entry.exchangeRate ? `1 USD = ${entry.exchangeRate.toFixed(2)} CDF` : "-"}</p>
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-black/75 dark:text-white/75">{entry.libelle}</p>
                  <div className="mt-3 grid gap-3 xl:grid-cols-2">
                    {(["DEBIT", "CREDIT"] as const).map((side) => (
                      <div key={side} className="rounded-lg border border-black/10 p-2 dark:border-white/10">
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-black/55 dark:text-white/55">{side === "DEBIT" ? "Débit" : "Crédit"}</p>
                        <div className="space-y-1.5">
                          {entry.lines.filter((line) => line.side === side).map((line) => (
                            <div key={line.id} className="flex items-center justify-between gap-3 text-xs">
                              <span>{line.accountCode} • {line.accountLabel}</span>
                              <span className="text-right">USD {money(Number(line.amountUsd ?? 0))} / CDF {money(Number(line.amountCdf ?? 0))}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {preview.groups.length === 0 ? (
                <p className="rounded-xl border border-dashed border-black/15 px-4 py-6 text-sm text-black/55 dark:border-white/15 dark:text-white/55">
                  Aucun mouvement trouvé pour ce grand livre sur cette période.
                </p>
              ) : preview.groups.map((group) => (
                <article key={group.accountCode} className="rounded-xl border border-black/10 p-3 dark:border-white/10">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">{group.accountCode} • {group.accountLabel}</p>
                      <p className="text-xs text-black/55 dark:text-white/55">{group.rows.length} lignes mouvementées</p>
                    </div>
                    <div className="text-right text-xs text-black/55 dark:text-white/55">
                      <p>USD débit {money(group.totals.debitUsd)} / crédit {money(group.totals.creditUsd)}</p>
                      <p>CDF débit {money(group.totals.debitCdf)} / crédit {money(group.totals.creditCdf)}</p>
                    </div>
                  </div>
                  <div className="mt-3 space-y-2">
                    {group.rows.map((row) => (
                      <div key={`${row.entryId}-${row.sequence}-${row.side}-${row.counterparts}`} className="rounded-lg border border-black/10 px-3 py-2 text-xs dark:border-white/10">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold">#{row.sequence} • {new Date(row.entryDate).toLocaleDateString("fr-FR")} • {row.side}</span>
                          <span>USD {money(row.debitUsd || row.creditUsd)} / CDF {money(row.debitCdf || row.creditCdf)}</span>
                        </div>
                        <p className="mt-1 text-black/70 dark:text-white/70">{row.libelle}</p>
                        <p className="mt-1 text-black/55 dark:text-white/55">Contreparties: {row.counterparts || "-"}</p>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}