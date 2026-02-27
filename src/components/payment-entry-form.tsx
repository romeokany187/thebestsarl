"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

type TicketOption = {
  id: string;
  ticketNumber: string;
  customerName: string;
  amount: number;
  paidAmount: number;
  paymentStatus: "PAID" | "PARTIAL" | "UNPAID";
};

export function PaymentEntryForm({ tickets }: { tickets: TicketOption[] }) {
  const router = useRouter();
  const [ticketId, setTicketId] = useState<string>(tickets[0]?.id ?? "");
  const [amount, setAmount] = useState<string>("");
  const [method, setMethod] = useState<string>("CASH");
  const [reference, setReference] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");

  const selected = useMemo(() => tickets.find((ticket) => ticket.id === ticketId) ?? null, [ticketId, tickets]);
  const remaining = selected ? Math.max(0, selected.amount - selected.paidAmount) : 0;

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

    const response = await fetch("/api/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticketId,
        amount: numericAmount,
        method,
        reference: reference || undefined,
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
    setReference("");
    setLoading(false);
    router.refresh();
  }

  return (
    <section className="mb-6 rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
      <h2 className="mb-3 text-sm font-semibold">Enregistrer un paiement (USD)</h2>
      <form onSubmit={onSubmit} className="grid gap-3 lg:grid-cols-5 lg:items-end">
        <div className="lg:col-span-2">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Billet</label>
          <select
            value={ticketId}
            onChange={(event) => setTicketId(event.target.value)}
            className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
          >
            {tickets.map((ticket) => (
              <option key={ticket.id} value={ticket.id}>
                {ticket.ticketNumber} • {ticket.customerName} • Reste {Math.max(0, ticket.amount - ticket.paidAmount).toFixed(2)} USD
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
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Méthode</label>
          <input
            value={method}
            onChange={(event) => setMethod(event.target.value)}
            className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            placeholder="CASH / VIREMENT / MOBILE"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Référence</label>
          <input
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            placeholder="Optionnel"
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
        <p className="mt-3 text-xs text-black/60 dark:text-white/60">
          Facturé: {selected.amount.toFixed(2)} USD • Déjà encaissé: {selected.paidAmount.toFixed(2)} USD • Reste: {remaining.toFixed(2)} USD • Statut: {selected.paymentStatus}
        </p>
      ) : null}
      {message ? <p className="mt-2 text-xs text-emerald-600">{message}</p> : null}
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
    </section>
  );
}
