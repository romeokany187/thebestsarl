"use client";

import { useEffect, useMemo, useState } from "react";

type AccountOption = {
  code: string;
  label: string;
  normalBalance?: string | null;
};

type TicketInvoiceOption = {
  id: string;
  ticketNumber: string;
  customerName: string;
  soldAt: string;
  invoiceNumber: string;
};
type DeletedEntry = {
  id: string;
  deletedAt: string;
  deletedBy?: { name?: string | null } | null;
  summary?: string | null;
  sequence?: number | null;
  entryDate?: string | null;
  pole?: string | null;
  libelle?: string | null;
  pieceJustificative?: string | null;
  exchangeRate?: number | null;
  lines: Array<{
    side: "DEBIT" | "CREDIT";
    orderIndex: number;
    accountCode: string;
    accountLabel: string;
    amountUsd?: number | null;
    amountCdf?: number | null;
  }>;
};

const POLE_OPTIONS = ["THE BEST", "SAFETY", "TSL", "VISAS"] as const;
const POLE_SEPARATOR = " | ";

type DailyRate = {
  id: string;
  rateDate: string;
  exchangeRate: number;
  createdBy?: { name?: string | null } | null;
};

type RecentEntry = {
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
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return toLocalDateTimeValue(new Date());
  }
  return toLocalDateTimeValue(date);
}

function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

function toLocalDateValue(date: Date) {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

function toLocalDateTimeValue(date: Date) {
  return `${toLocalDateValue(date)}T${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`;
}

function parsePoleSelection(value?: string | null) {
  if (!value?.trim()) return [] as string[];

  const parts = value
    .split(/\s*\|\s*|\s*,\s*|\s*;\s*/)
    .map((part) => part.trim())
    .filter(Boolean);

  return Array.from(new Set(parts)).filter((part): part is typeof POLE_OPTIONS[number] =>
    POLE_OPTIONS.includes(part as typeof POLE_OPTIONS[number]),
  );
}

function serializePoleSelection(values: string[]) {
  return values.join(POLE_SEPARATOR);
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

export function AccountingJournalWorkspace({
  showComposer = true,
  showHistory = true,
}: {
  showComposer?: boolean;
  showHistory?: boolean;
}) {
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [recentEntries, setRecentEntries] = useState<RecentEntry[]>([]);
  const [deletedEntries, setDeletedEntries] = useState<DeletedEntry[]>([]);
  const [ticketInvoiceOptions, setTicketInvoiceOptions] = useState<TicketInvoiceOption[]>([]);
  const [dailyRates, setDailyRates] = useState<DailyRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rateSaving, setRateSaving] = useState(false);
  const [deletingEntryId, setDeletingEntryId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editingEntryId, setEditingEntryId] = useState("");
  const [entryDate, setEntryDate] = useState(toInputDateTime());
  const [selectedPoles, setSelectedPoles] = useState<string[]>([]);
  const [libelle, setLibelle] = useState("");
  const [pieceJustificative, setPieceJustificative] = useState("");
  const [ticketInvoiceSelection, setTicketInvoiceSelection] = useState("");
  const [rateDate, setRateDate] = useState(toLocalDateValue(new Date()));
  const [dailyRateValue, setDailyRateValue] = useState("");
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
      setRecentEntries(payload.recentEntries ?? []);
      setDeletedEntries(payload.deletedEntries ?? []);
      setTicketInvoiceOptions(payload.ticketInvoiceOptions ?? []);
      setDailyRates(payload.dailyRates ?? []);
    } catch {
      setError("Erreur réseau lors du chargement du journal comptable.");
    }

    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  const accountMap = useMemo(
    () => new Map(accounts.map((account) => [account.code, account])),
    [accounts],
  );
  const ticketInvoiceMap = useMemo(
    () => new Map(ticketInvoiceOptions.map((ticket) => [ticket.invoiceNumber, ticket])),
    [ticketInvoiceOptions],
  );
  const dailyRateMap = useMemo(
    () => new Map(dailyRates.map((rate) => [rate.rateDate.slice(0, 10), rate])),
    [dailyRates],
  );
  const selectedEntryRate = dailyRateMap.get(entryDate.slice(0, 10)) ?? null;
  const selectedManagedRate = dailyRateMap.get(rateDate) ?? null;

  useEffect(() => {
    const matchingRate = dailyRateMap.get(rateDate);
    if (matchingRate) {
      setDailyRateValue(String(matchingRate.exchangeRate));
    }
  }, [dailyRateMap, rateDate]);

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

  function resetForm(options?: { preserveEntryDate?: boolean }) {
    if (!options?.preserveEntryDate) {
      setEntryDate(toInputDateTime());
    }
    setSelectedPoles([]);
    setLibelle("");
    setPieceJustificative("");
    setTicketInvoiceSelection("");
    setEditingEntryId("");
    setLines([lineFactory("DEBIT"), lineFactory("CREDIT")]);
  }

  function buildTicketSaleLabel(ticket: TicketInvoiceOption) {
    return `Vente billet ${ticket.customerName}`;
  }

  function applyTicketInvoiceSuggestion(invoiceNumber: string) {
    const ticket = ticketInvoiceMap.get(invoiceNumber);
    if (!ticket) {
      return;
    }

    setTicketInvoiceSelection(ticket.id);
    setPieceJustificative(ticket.invoiceNumber);
    setLibelle(buildTicketSaleLabel(ticket));
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

  function togglePole(option: string) {
    setSelectedPoles((current) => (
      current.includes(option)
        ? current.filter((value) => value !== option)
        : [...current, option]
    ));
  }

  function startEditEntry(entry: RecentEntry) {
    setEditingEntryId(entry.id);
    setEntryDate(toInputDateTime(entry.entryDate));
    setSelectedPoles(parsePoleSelection(entry.pole));
    setLibelle(entry.libelle ?? "");
    setPieceJustificative(entry.pieceJustificative ?? "");
    const matchedTicket = entry.pieceJustificative ? ticketInvoiceMap.get(entry.pieceJustificative) : null;
    setTicketInvoiceSelection(matchedTicket?.id ?? "");
    setLines(entry.lines.map((line) => ({
      id: line.id,
      side: line.side,
      accountCode: line.accountCode,
      amountUsd: line.amountUsd != null && line.amountUsd !== 0 ? String(line.amountUsd) : "",
      amountCdf: line.amountCdf != null && line.amountCdf !== 0 ? String(line.amountCdf) : "",
    })));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveDailyRate() {
    setRateSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/comptabilite/journal/daily-rate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rateDate,
          exchangeRate: Number.parseFloat(dailyRateValue),
        }),
      });
      const result = await response.json().catch(() => null);

      if (!response.ok) {
        setError(formatError(result?.error ?? "Impossible d'enregistrer le taux du jour."));
        setRateSaving(false);
        return;
      }

      setMessage(`Taux du ${new Date(`${rateDate}T00:00:00.000Z`).toLocaleDateString("fr-FR")} enregistré.`);
      await loadData();
    } catch {
      setError("Erreur réseau lors de l'enregistrement du taux du jour.");
    }

    setRateSaving(false);
  }

  async function submitEntry() {
    if (!selectedEntryRate) {
      setError("Aucun taux du jour n'est enregistré pour la date choisie. Enregistre d'abord le taux dans le bloc ci-dessus, puis repasse l'écriture.");
      setMessage("");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    const payload = {
      ...(editingEntryId ? { id: editingEntryId } : {}),
      entryDate: new Date(entryDate).toISOString(),
      pole: serializePoleSelection(selectedPoles) || undefined,
      libelle: libelle.trim(),
      pieceJustificative: pieceJustificative.trim() || undefined,
      lines: lines.map((line) => ({
        side: line.side,
        accountCode: line.accountCode.trim(),
        amountUsd: line.amountUsd.trim() ? Number.parseFloat(line.amountUsd) : undefined,
        amountCdf: line.amountCdf.trim() ? Number.parseFloat(line.amountCdf) : undefined,
      })),
    };

    try {
      const response = await fetch("/api/comptabilite/journal", {
        method: editingEntryId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => null);

      if (!response.ok) {
        setError(formatError(result?.error ?? "Impossible d'enregistrer l'écriture comptable."));
        setSaving(false);
        return;
      }

      setMessage(editingEntryId
        ? `Écriture n° ${result?.data?.sequence ?? "?"} modifiée.`
        : `Écriture n° ${result?.data?.sequence ?? "?"} enregistrée.`);
      resetForm({ preserveEntryDate: true });
      await loadData();
    } catch {
      setError("Erreur réseau lors de l'enregistrement de l'écriture.");
    }

    setSaving(false);
  }

  async function deleteEntry(entryId: string) {
    setDeletingEntryId(entryId);
    setError("");
    setMessage("");

    try {
      const response = await fetch(`/api/comptabilite/journal?id=${entryId}`, {
        method: "DELETE",
      });
      const result = await response.json().catch(() => null);

      if (!response.ok) {
        setError(formatError(result?.error ?? "Impossible de supprimer l'écriture comptable."));
        setDeletingEntryId("");
        return;
      }

      if (editingEntryId === entryId) {
        resetForm();
      }
      setMessage("Écriture comptable supprimée.");
      await loadData();
    } catch {
      setError("Erreur réseau lors de la suppression de l'écriture.");
    }

    setDeletingEntryId("");
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

      <div className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-black/50 dark:text-white/50">Banque centrale</p>
            <h2 className="mt-1 text-sm font-semibold">Taux du jour comptable</h2>
            <p className="mt-2 text-sm text-black/60 dark:text-white/60">
              Le comptable enregistre ici le taux officiel du jour. Toutes les écritures passées à cette date récupèrent automatiquement ce taux.
            </p>
          </div>
          <div className="rounded-xl border border-black/10 px-3 py-2 text-xs dark:border-white/10">
            {selectedManagedRate
              ? `Taux enregistré: 1 USD = ${selectedManagedRate.exchangeRate.toFixed(2)} CDF`
              : "Aucun taux enregistré pour cette date"}
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-[220px_220px_auto] md:items-end">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Date du taux</label>
            <input
              type="date"
              value={rateDate}
              onChange={(event) => {
                const nextDate = event.target.value;
                setRateDate(nextDate);
                const matchingRate = dailyRateMap.get(nextDate);
                setDailyRateValue(matchingRate ? String(matchingRate.exchangeRate) : "");
              }}
              className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">1 USD = X CDF</label>
            <input
              value={dailyRateValue}
              onChange={(event) => setDailyRateValue(event.target.value)}
              placeholder="Ex: 2850"
              className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            />
          </div>
          <button
            type="button"
            onClick={saveDailyRate}
            disabled={rateSaving}
            className="rounded-md bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-black"
          >
            {rateSaving ? "Enregistrement…" : "Enregistrer le taux du jour"}
          </button>
        </div>
      </div>

      {showComposer ? (
      <div className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-black/50 dark:text-white/50">Passation</p>
            <h2 className="mt-1 text-sm font-semibold">{editingEntryId ? "Modifier une écriture de journal" : "Nouvelle écriture de journal"}</h2>
            <p className="mt-2 text-sm text-black/60 dark:text-white/60">
              Les opérations comptables restent saisies manuellement. Pour les billets vendus depuis le 1er avril, une aide rapide permet de choisir la facture et de proposer automatiquement la pièce justificative et le libellé, tout en laissant ces champs modifiables.
            </p>
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
            <p className="mt-1 text-[11px] text-black/50 dark:text-white/50">
              {selectedEntryRate
                ? `Taux appliqué pour cette date: 1 USD = ${selectedEntryRate.exchangeRate.toFixed(2)} CDF`
                : "Aucun taux du jour enregistré pour cette date. Enregistre-le dans le bloc ci-dessus avant de passer l'écriture."}
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Pôle(x)</label>
            <div className="grid gap-2 sm:grid-cols-2">
              {POLE_OPTIONS.map((option) => {
                const isSelected = selectedPoles.includes(option);
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => togglePole(option)}
                    aria-pressed={isSelected}
                    className={`rounded-md border px-3 py-2 text-sm font-semibold transition ${isSelected
                      ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                      : "border-black/15 bg-white text-black hover:bg-black/5 dark:border-white/15 dark:bg-zinc-900 dark:text-white dark:hover:bg-white/10"
                    }`}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[11px] text-black/50 dark:text-white/50">
              Tu peux sélectionner un ou plusieurs pôles pour la même écriture. Laisse vide si l'écriture est sans pôle.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Facture billet depuis le 1er avril</label>
            <select
              value={ticketInvoiceSelection}
              onChange={(event) => {
                const nextSelection = event.target.value;
                setTicketInvoiceSelection(nextSelection);
                const ticket = ticketInvoiceOptions.find((option) => option.id === nextSelection);
                if (!ticket) return;
                applyTicketInvoiceSuggestion(ticket.invoiceNumber);
              }}
              className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            >
              <option value="">Choisir une facture pour préremplir</option>
              {ticketInvoiceOptions.map((ticket) => (
                <option key={ticket.id} value={ticket.id}>
                  {ticket.invoiceNumber} • {ticket.customerName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Pièce justificative</label>
            <input
              list="accounting-ticket-invoices"
              value={pieceJustificative}
              onChange={(event) => {
                const nextValue = event.target.value;
                setPieceJustificative(nextValue);
                const matchedTicket = ticketInvoiceMap.get(nextValue);
                if (matchedTicket) {
                  setTicketInvoiceSelection(matchedTicket.id);
                  setLibelle(buildTicketSaleLabel(matchedTicket));
                } else {
                  setTicketInvoiceSelection("");
                }
              }}
              placeholder="BEC, OP, reçu ou facture billet..."
              className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            />
          </div>
        </div>

        <div className="mt-3">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Libellé</label>
          <input value={libelle} onChange={(event) => setLibelle(event.target.value)} placeholder="Libellé de l'écriture comptable" className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900" />
          <p className="mt-1 text-[11px] text-black/50 dark:text-white/50">
            Si tu choisis une facture billet, le libellé se propose automatiquement sous la forme vente billet + nom client, puis reste modifiable.
          </p>
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
        <datalist id="accounting-ticket-invoices">
          {ticketInvoiceOptions.map((ticket) => (
            <option key={ticket.id} value={ticket.invoiceNumber}>{ticket.customerName}</option>
          ))}
        </datalist>

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => resetForm()} className="rounded-md border border-black/15 px-4 py-2 text-sm font-semibold hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10">{editingEntryId ? "Annuler la modification" : "Réinitialiser"}</button>
          <button type="button" disabled={saving} onClick={submitEntry} className="rounded-md bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-black">{saving ? "Enregistrement…" : editingEntryId ? "Mettre à jour l'écriture" : "Passer l'écriture"}</button>
        </div>
      </div>
      ) : null}

      {showHistory ? (
      <section className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-black/50 dark:text-white/50">Historique</p>
            <h2 className="mt-1 text-sm font-semibold">Écritures récentes du livre journal</h2>
          </div>
        </div>

        {loading ? <p className="text-sm text-black/55 dark:text-white/55">Chargement…</p> : null}

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
                    <div className="mt-2 flex justify-end gap-2">
                      <button type="button" onClick={() => startEditEntry(entry)} className="rounded-md border border-black/15 px-2 py-1 text-[11px] font-semibold hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10">Modifier</button>
                      <button type="button" disabled={deletingEntryId === entry.id} onClick={() => deleteEntry(entry.id)} className="rounded-md border border-red-200 px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/30">{deletingEntryId === entry.id ? "Suppression…" : "Supprimer"}</button>
                    </div>
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
        <div className="mt-6 border-t border-black/10 pt-4 dark:border-white/10">
          <div className="mb-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-black/50 dark:text-white/50">Suppressions</p>
            <h3 className="mt-1 text-sm font-semibold">Journal des écritures supprimées</h3>
            <p className="mt-1 text-xs text-black/55 dark:text-white/55">
              La numérotation continue normalement. Les numéros supprimés restent tracés ici pour garder l'historique.
            </p>
          </div>

          <div className="space-y-3">
            {deletedEntries.length === 0 ? (
              <p className="text-sm text-black/55 dark:text-white/55">Aucune écriture supprimée journalisée pour le moment.</p>
            ) : (
              deletedEntries.map((entry) => (
                <article key={entry.id} className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-900/60 dark:bg-amber-950/20">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">Écriture supprimée n° {entry.sequence ?? "-"}</p>
                      <p className="text-xs text-black/55 dark:text-white/55">
                        Supprimée le {new Date(entry.deletedAt).toLocaleString("fr-FR")} par {entry.deletedBy?.name ?? "Utilisateur inconnu"}
                      </p>
                    </div>
                    <div className="text-right text-xs text-black/55 dark:text-white/55">
                      <p>Pièce: {entry.pieceJustificative || "-"}</p>
                      <p>Taux: {entry.exchangeRate ? `1 USD = ${entry.exchangeRate.toFixed(2)} CDF` : "-"}</p>
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-black/75 dark:text-white/75">{entry.libelle || entry.summary || "Suppression journalisée."}</p>
                  <p className="mt-1 text-xs text-black/55 dark:text-white/55">
                    Date d'écriture: {entry.entryDate ? new Date(entry.entryDate).toLocaleString("fr-FR") : "-"} • {entry.pole || "Sans pôle"}
                  </p>
                  {entry.lines.length > 0 ? (
                    <div className="mt-3 grid gap-3 xl:grid-cols-2">
                      {(["DEBIT", "CREDIT"] as const).map((side) => (
                        <div key={side} className="rounded-lg border border-black/10 p-2 dark:border-white/10">
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-black/55 dark:text-white/55">{side === "DEBIT" ? "Débit" : "Crédit"}</p>
                          <div className="space-y-1.5">
                            {entry.lines.filter((line) => line.side === side).map((line) => (
                              <div key={`${entry.id}-${side}-${line.orderIndex}-${line.accountCode}`} className="flex items-center justify-between gap-3 text-xs">
                                <span>{line.accountCode} • {line.accountLabel}</span>
                                <span className="text-right">USD {Number(line.amountUsd ?? 0).toFixed(2)} / CDF {Number(line.amountCdf ?? 0).toFixed(2)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))
            )}
          </div>
        </div>
      </section>
      ) : null}
    </section>
  );
}