"use client";

import { useEffect, useMemo, useState } from "react";

type AccountOption = {
  code: string;
  label: string;
  normalBalance?: string | null;
};

type PendingCashOperation = {
  id: string;
  occurredAt: string;
  direction: string;
  category: string;
  amount: number;
  currency: string;
  amountUsd?: number | null;
  amountCdf?: number | null;
  method: string;
  reference?: string | null;
  description: string;
  cashDesk: string;
  createdByName?: string | null;
};

type RecentEntry = {
  id: string;
  sequence: number;
  entryDate: string;
  pole?: string | null;
  libelle: string;
  pieceJustificative?: string | null;
  exchangeRate?: number | null;
  sourceCashOperationId?: string | null;
  createdBy?: { name?: string | null } | null;
  lines: Array<{
    id: string;
    side: "DEBIT" | "CREDIT";
    orderIndex: number;
    accountCode: string;
    accountLabel: string;
    amountUsd?: number | null;
    amountCdf?: number | null;
  }>;
};

type EntryLineForm = {
  id: string;
  side: "DEBIT" | "CREDIT";
  accountCode: string;
  amountUsd: string;
  amountCdf: string;
};

function toInputDateTime(value?: string | null) {
  if (!value) return new Date().toISOString().slice(0, 16);
  return new Date(value).toISOString().slice(0, 16);
}

function lineFactory(side: "DEBIT" | "CREDIT", amountUsd = "", amountCdf = ""): EntryLineForm {
  return {
    id: `${side}-${Math.random().toString(36).slice(2, 10)}`,
    side,
    accountCode: "",
    amountUsd,
    amountCdf,
  };
}

function formatError(error: unknown) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    try {
      return JSON.stringify(error);
    } catch {}
  }
  return "Erreur inconnue.";
}

export function AccountingJournalWorkspace() {
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [pendingCashOperations, setPendingCashOperations] = useState<PendingCashOperation[]>([]);
  const [recentEntries, setRecentEntries] = useState<RecentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [entryDate, setEntryDate] = useState(toInputDateTime(new Date().toISOString()));
  const [pole, setPole] = useState("");
  const [libelle, setLibelle] = useState("");
  const [pieceJustificative, setPieceJustificative] = useState("");
  const [exchangeRate, setExchangeRate] = useState("");
  const [lines, setLines] = useState<EntryLineForm[]>([lineFactory("DEBIT"), lineFactory("CREDIT")]);

  async function loadData() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/comptabilite/journal", { cache: "no-store" });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(formatError(payload?.error ?? "Impossible de charger le journal comptable."));
        setLoading(false);
        return;
      }

      setAccounts(payload.accounts ?? []);
      setPendingCashOperations(payload.pendingCashOperations ?? []);
      setRecentEntries(payload.recentEntries ?? []);
    } catch {
      setError("Erreur réseau lors du chargement du journal comptable.");
    }

    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  const selectedSource = useMemo(
    () => pendingCashOperations.find((operation) => operation.id === selectedSourceId) ?? null,
    [pendingCashOperations, selectedSourceId],
  );

  const accountMap = useMemo(
    () => new Map(accounts.map((account) => [account.code, account])),
    [accounts],
  );

  const totalDebitUsd = useMemo(
    () => lines.filter((line) => line.side === "DEBIT").reduce((sum, line) => sum + (Number.parseFloat(line.amountUsd) || 0), 0),
    [lines],
  );
  const totalCreditUsd = useMemo(
    () => lines.filter((line) => line.side === "CREDIT").reduce((sum, line) => sum + (Number.parseFloat(line.amountUsd) || 0), 0),
    [lines],
  );
  const totalDebitCdf = useMemo(
    () => lines.filter((line) => line.side === "DEBIT").reduce((sum, line) => sum + (Number.parseFloat(line.amountCdf) || 0), 0),
    [lines],
  );
  const totalCreditCdf = useMemo(
    () => lines.filter((line) => line.side === "CREDIT").reduce((sum, line) => sum + (Number.parseFloat(line.amountCdf) || 0), 0),
    [lines],
  );

  function prefillFromSource(operation: PendingCashOperation | null) {
    if (!operation) {
      setSelectedSourceId("");
      setEntryDate(toInputDateTime(new Date().toISOString()));
      setPole("");
      setLibelle("");
      setPieceJustificative("");
      setExchangeRate("");
      setLines([lineFactory("DEBIT"), lineFactory("CREDIT")]);
      return;
    }

    setSelectedSourceId(operation.id);
    setEntryDate(toInputDateTime(operation.occurredAt));
    setPole(operation.cashDesk);
    setLibelle(operation.description);
    setPieceJustificative(operation.reference ?? "");
    setExchangeRate(operation.currency === "CDF" ? "" : "");
    setLines([
      lineFactory("DEBIT", operation.amountUsd ? String(operation.amountUsd) : "", operation.amountCdf ? String(operation.amountCdf) : ""),
      lineFactory("CREDIT", operation.amountUsd ? String(operation.amountUsd) : "", operation.amountCdf ? String(operation.amountCdf) : ""),
    ]);
  }

  function updateLine(id: string, patch: Partial<EntryLineForm>) {
    setLines((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  }

  function addLine(side: "DEBIT" | "CREDIT") {
    setLines((current) => [...current, lineFactory(side)]);
  }

  function removeLine(id: string) {
    setLines((current) => {
      const target = current.find((line) => line.id === id);
      if (!target) return current;
      const sameSideCount = current.filter((line) => line.side === target.side).length;
      if (sameSideCount <= 1) return current;
      return current.filter((line) => line.id !== id);
    });
  }

  async function submitEntry() {
    setSaving(true);
    setError("");
    setMessage("");

    const payload = {
      entryDate: new Date(entryDate).toISOString(),
      pole: pole.trim() || undefined,
      libelle: libelle.trim(),
      pieceJustificative: pieceJustificative.trim() || undefined,
      exchangeRate: exchangeRate.trim() ? Number.parseFloat(exchangeRate) : undefined,
      sourceCashOperationId: selectedSourceId || undefined,
      lines: lines.map((line) => ({
        side: line.side,
        accountCode: line.accountCode.trim(),
        amountUsd: line.amountUsd.trim() ? Number.parseFloat(line.amountUsd) : undefined,
        amountCdf: line.amountCdf.trim() ? Number.parseFloat(line.amountCdf) : undefined,
      })),
    };

    try {
      const response = await fetch("/api/comptabilite/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => null);

      if (!response.ok) {
        setError(formatError(result?.error ?? "Impossible d'enregistrer l'écriture comptable."));
        setSaving(false);
        return;
      }

      setMessage(`Écriture n° ${result?.data?.sequence ?? "?"} enregistrée.`);
      prefillFromSource(null);
      await loadData();
    } catch {
      setError("Erreur réseau lors de l'enregistrement de l'écriture.");
    }

    setSaving(false);
  }

  return (
    <section className="space-y-4">
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
          {message}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-black/50 dark:text-white/50">Source</p>
              <h2 className="mt-1 text-sm font-semibold">Opérations à comptabiliser</h2>
            </div>
            <button
              type="button"
              onClick={() => prefillFromSource(null)}
              className="rounded-md border border-black/15 px-2 py-1 text-xs font-semibold hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
            >
              Écriture libre
            </button>
          </div>

          <div className="mt-4 space-y-2">
            {loading ? (
              <p className="text-sm text-black/55 dark:text-white/55">Chargement…</p>
            ) : pendingCashOperations.length === 0 ? (
              <p className="rounded-xl border border-dashed border-black/15 px-3 py-4 text-sm text-black/55 dark:border-white/15 dark:text-white/55">
                Aucune opération de caisse en attente de passation comptable.
              </p>
            ) : (
              pendingCashOperations.map((operation) => (
                <button
                  key={operation.id}
                  type="button"
                  onClick={() => prefillFromSource(operation)}
                  className={`block w-full rounded-xl border px-3 py-3 text-left transition ${selectedSourceId === operation.id ? "border-blue-400 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/30" : "border-black/10 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-black/55 dark:text-white/55">{operation.cashDesk}</span>
                    <span className="text-xs text-black/45 dark:text-white/45">{new Date(operation.occurredAt).toLocaleString("fr-FR")}</span>
                  </div>
                  <p className="mt-1 text-sm font-semibold">{operation.amount.toFixed(2)} {operation.currency}</p>
                  <p className="mt-1 text-xs text-black/60 dark:text-white/60">{operation.description}</p>
                  <p className="mt-1 text-[11px] text-black/50 dark:text-white/50">Réf. {operation.reference ?? "-"} • {operation.method} • saisi par {operation.createdByName ?? "-"}</p>
                </button>
              ))
            )}
          </div>
        </aside>

        <div className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-black/50 dark:text-white/50">Passation</p>
              <h2 className="mt-1 text-sm font-semibold">Nouvelle écriture de journal</h2>
            </div>
            <div className="rounded-xl border border-black/10 px-3 py-2 text-xs dark:border-white/10">
              USD: débit {totalDebitUsd.toFixed(2)} / crédit {totalCreditUsd.toFixed(2)}<br />
              CDF: débit {totalDebitCdf.toFixed(2)} / crédit {totalCreditCdf.toFixed(2)}
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Date</label>
              <input type="datetime-local" value={entryDate} onChange={(event) => setEntryDate(event.target.value)} className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Pôle</label>
              <input value={pole} onChange={(event) => setPole(event.target.value)} placeholder="Ex: THE_BEST, BILLETTERIE" className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Pièce justificative</label>
              <input value={pieceJustificative} onChange={(event) => setPieceJustificative(event.target.value)} placeholder="BEC, OP, reçu..." className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Taux du jour</label>
              <input value={exchangeRate} onChange={(event) => setExchangeRate(event.target.value)} placeholder="1 USD = X CDF" className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900" />
            </div>
          </div>

          <div className="mt-3">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Libellé</label>
            <input value={libelle} onChange={(event) => setLibelle(event.target.value)} placeholder="Libellé de l'écriture comptable" className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900" />
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            {(["DEBIT", "CREDIT"] as const).map((side) => (
              <div key={side} className="rounded-2xl border border-black/10 p-3 dark:border-white/10">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">{side === "DEBIT" ? "Comptes débités" : "Comptes crédités"}</h3>
                  <button type="button" onClick={() => addLine(side)} className="rounded-md border border-black/15 px-2 py-1 text-xs font-semibold hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10">Ajouter</button>
                </div>

                <div className="space-y-3">
                  {lines.filter((line) => line.side === side).map((line) => {
                    const account = accountMap.get(line.accountCode.trim()) ?? null;
                    return (
                      <div key={line.id} className="rounded-xl border border-black/10 p-3 dark:border-white/10">
                        <div className="grid gap-3 md:grid-cols-[1.2fr_0.8fr_0.8fr_auto]">
                          <div>
                            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-black/55 dark:text-white/55">Compte</label>
                            <input
                              list="accounting-account-codes"
                              value={line.accountCode}
                              onChange={(event) => updateLine(line.id, { accountCode: event.target.value })}
                              placeholder="Ex: 5711"
                              className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm font-mono dark:border-white/15 dark:bg-zinc-900"
                            />
                            <p className="mt-1 text-[11px] text-black/50 dark:text-white/50">{account ? account.label : "Code du plan comptable"}</p>
                          </div>
                          <div>
                            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-black/55 dark:text-white/55">USD</label>
                            <input value={line.amountUsd} onChange={(event) => updateLine(line.id, { amountUsd: event.target.value })} placeholder="0.00" className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900" />
                          </div>
                          <div>
                            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-black/55 dark:text-white/55">CDF</label>
                            <input value={line.amountCdf} onChange={(event) => updateLine(line.id, { amountCdf: event.target.value })} placeholder="0.00" className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900" />
                          </div>
                          <div className="flex items-end">
                            <button type="button" onClick={() => removeLine(line.id)} className="rounded-md border border-red-200 px-2 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/30">Suppr.</button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <datalist id="accounting-account-codes">
            {accounts.map((account) => (
              <option key={account.code} value={account.code}>{account.label}</option>
            ))}
          </datalist>

          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => prefillFromSource(null)} className="rounded-md border border-black/15 px-4 py-2 text-sm font-semibold hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10">Réinitialiser</button>
            <button type="button" disabled={saving} onClick={submitEntry} className="rounded-md bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-black">{saving ? "Enregistrement…" : "Passer l'écriture"}</button>
          </div>
        </div>
      </div>

      <section className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-black/50 dark:text-white/50">Historique</p>
            <h2 className="mt-1 text-sm font-semibold">Écritures récentes du livre journal</h2>
          </div>
        </div>

        <div className="space-y-3">
          {recentEntries.length === 0 ? (
            <p className="text-sm text-black/55 dark:text-white/55">Aucune écriture comptable enregistrée pour le moment.</p>
          ) : (
            recentEntries.map((entry) => (
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
                            <span className="text-right">USD {Number(line.amountUsd ?? 0).toFixed(2)} / CDF {Number(line.amountCdf ?? 0).toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    </section>
  );
}