"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";

// Listen for external payment edit requests

function toLocalDateTimeInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function normalizeCurrency(value: string | null | undefined): "USD" | "CDF" {
  const normalized = (value ?? "USD").trim().toUpperCase();
  return normalized === "CDF" || normalized === "XAF" || normalized === "FC" ? "CDF" : "USD";
}

type TicketOption = {
  id: string;
  ticketNumber: string;
  customerName: string;
  amount: number;
  paidAmount: number;
  paymentStatus: "PAID" | "PARTIAL" | "UNPAID";
  currency: string;
  invoiceNumber: string;
};

export function PaymentEntryForm({ tickets }: { tickets: TicketOption[] }) {
  const router = useRouter();
  const [ticketId, setTicketId] = useState<string>(tickets[0]?.id ?? "");
  const [amount, setAmount] = useState<string>("");
  const [currency, setCurrency] = useState<string>(normalizeCurrency(tickets[0]?.currency));
  const [method, setMethod] = useState<string>("CASH");
  const [supportingReference, setSupportingReference] = useState<string>("");
  const [paidAt, setPaidAt] = useState<string>(toLocalDateTimeInputValue(new Date()));
  const [loading, setLoading] = useState<boolean>(false);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    function handlePaymentEdit(ev: Event) {
      const e = ev as CustomEvent<any>;
      const payload = e.detail;
      if (!payload) return;

      const ticketMatch = tickets.find((t) => t.id === payload.ticketId);
      if (ticketMatch) {
        setTicketId(ticketMatch.id);
      }

      if (payload.amount !== undefined) setAmount(String(payload.amount));
      if (payload.currency) setCurrency(normalizeCurrency(payload.currency));
      if (payload.method) setMethod(payload.method);
      if (payload.reference) setSupportingReference(payload.reference);
      if (payload.paidAt) setPaidAt(payload.paidAt.slice(0, 16));

      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    window.addEventListener("payment:edit", handlePaymentEdit as EventListener);
    return () => window.removeEventListener("payment:edit", handlePaymentEdit as EventListener);
  }, [tickets]);

  const selected = useMemo(() => tickets.find((ticket) => ticket.id === ticketId) ?? null, [ticketId, tickets]);
  const selectedInvoiceNumber = (selected?.invoiceNumber ?? "").trim();
  const remaining = selected ? Math.max(0, selected.amount - selected.paidAmount) : 0;
  const ticketCurrency = normalizeCurrency(selected?.currency);
  const paymentCurrency = normalizeCurrency(currency);

  useEffect(() => {
    if (selected) {
      setCurrency(normalizeCurrency(selected.currency));
    }
  }, [selected?.id, selected?.currency]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    const numericAmount = Number.parseFloat(amount);

    if (!ticketId || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError("Saisissez un billet et un montant valide.");
      setLoading(false);
      return;
    }

    if (!supportingReference.trim()) {
      setError("Le numéro du bon d'entrée en caisse ou du reçu est obligatoire.");
      setLoading(false);
      return;
    }

    const response = await fetch("/api/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticketId,
        amount: numericAmount,
        currency: paymentCurrency,
        method,
        reference: supportingReference.trim(),
        paidAt: paidAt ? new Date(paidAt).toISOString() : undefined,
      }),
    });

    const payload = await response.json();

    if (!response.ok) {
      setError(payload?.error ?? "Impossible d'enregistrer le paiement.");
      setLoading(false);
      return;
    }

    setMessage("Paiement enregistré et statut billet mis à jour.");
    setAmount("");
    setSupportingReference("");
    setLoading(false);
    router.refresh();
  }

  return (
    <section className="mb-6 rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
      <h2 className="mb-3 text-sm font-semibold">Enregistrer un paiement billet (USD / CDF)</h2>
      <form onSubmit={onSubmit} className="grid gap-3 lg:grid-cols-6 lg:items-end">
        <div className="lg:col-span-2">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Billet</label>
          <select
            value={ticketId}
            onChange={(event) => setTicketId(event.target.value)}
            className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
          >
            {tickets.map((ticket) => (
              <option key={ticket.id} value={ticket.id}>
                {ticket.ticketNumber} • {ticket.customerName} • Reste {Math.max(0, ticket.amount - ticket.paidAmount).toFixed(2)} {normalizeCurrency(ticket.currency)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Montant</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            placeholder="0.00"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Devise paiement</label>
          <select
            value={paymentCurrency}
            onChange={(event) => setCurrency(event.target.value)}
            className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
          >
            <option value="USD">USD</option>
            <option value="CDF">CDF</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Méthode</label>
          <select
            value={method}
            onChange={(event) => setMethod(event.target.value)}
            className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
          >
            <option value="CASH">Cash</option>
            <option value="BILLET">Billets</option>
            <option value="AIRTEL_MONEY">Airtel Money</option>
            <option value="ORANGE_MONEY">Orange Money</option>
            <option value="MPESA">M-Pesa</option>
            <option value="EQUITY">Equity</option>
            <option value="TMB">TMB</option>
            <option value="RAWBANK_ILLICOCASH">Rawbank & Illicocash</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">N° facture</label>
          <input
            value={selectedInvoiceNumber}
            title={selectedInvoiceNumber}
            readOnly
            className="w-full rounded-md border border-black/15 bg-black/5 px-3 py-2 text-xs font-medium dark:border-white/15 dark:bg-white/10"
            placeholder="Numéro de facture"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Pièce justificative (BEC / reçu)</label>
          <input
            value={supportingReference}
            onChange={(event) => setSupportingReference(event.target.value)}
            required
            className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            placeholder="Ex: BEC-2026-001 ou REC-145"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Date opération</label>
          <input
            type="datetime-local"
            value={paidAt}
            onChange={(event) => setPaidAt(event.target.value)}
            className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
          />
        </div>

        <button
          type="submit"
          disabled={loading || tickets.length === 0}
          className="rounded-md bg-black px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {loading ? "Enregistrement..." : "Enregistrer"}
        </button>
      </form>

      {selected ? (
        <>
          <p className="mt-3 text-xs text-black/60 dark:text-white/60">
            Facturé: {selected.amount.toFixed(2)} {ticketCurrency} • Déjà encaissé: {selected.paidAmount.toFixed(2)} {ticketCurrency} • Reste: {remaining.toFixed(2)} {ticketCurrency} • Statut: {selected.paymentStatus}
          </p>
          <p className="mt-2 text-xs text-black/60 dark:text-white/60">
            La facture du billet est affichée automatiquement. Saisissez ensuite la pièce justificative d'encaissement (n° BEC ou reçu). {paymentCurrency !== ticketCurrency ? `La conversion vers ${ticketCurrency} se fait automatiquement au taux du jour.` : `Le billet est actuellement libellé en ${ticketCurrency}.`}
          </p>
        </>
      ) : null}
      {message ? <p className="mt-2 text-xs text-emerald-600">{message}</p> : null}
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
    </section>
  );
}
