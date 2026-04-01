"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

function toLocalDateTimeInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

const categories: Array<{ value: string; label: string }> = [
  { value: "OTHER_SALE", label: "Autres ventes" },
  { value: "COMMISSION_INCOME", label: "Commissions" },
  { value: "SERVICE_INCOME", label: "Prestations de service" },
  { value: "LOAN_INFLOW", label: "Emprunt reçu" },
  { value: "ADVANCE_RECOVERY", label: "Récupération d'avance" },
  { value: "SUPPLIER_PAYMENT", label: "Paiement fournisseur" },
  { value: "SALARY_PAYMENT", label: "Paiement salaires" },
  { value: "RENT_PAYMENT", label: "Paiement loyer" },
  { value: "TAX_PAYMENT", label: "Paiement taxes" },
  { value: "UTILITY_PAYMENT", label: "Charges (eau/élec/net)" },
  { value: "TRANSPORT_PAYMENT", label: "Transport" },
  { value: "OTHER_EXPENSE", label: "Autres dépenses" },
];

export function CashOperationForm() {
  const router = useRouter();
  const [direction, setDirection] = useState<"INFLOW" | "OUTFLOW">("INFLOW");
  const [category, setCategory] = useState<string>("OTHER_SALE");
  const [amount, setAmount] = useState<string>("");
  const [currency, setCurrency] = useState<string>("USD");
  const [method, setMethod] = useState<string>("CASH");
  const [reference, setReference] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [occurredAt, setOccurredAt] = useState<string>(toLocalDateTimeInputValue(new Date()));
  const [loading, setLoading] = useState<boolean>(false);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    setError("");

    const numericAmount = Number.parseFloat(amount);

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError("Saisissez un montant valide.");
      setLoading(false);
      return;
    }

    if (!description.trim()) {
      setError("Ajoutez un libellé comptable.");
      setLoading(false);
      return;
    }

    if (!occurredAt) {
      setError("Sélectionnez la date et l'heure de l'opération.");
      setLoading(false);
      return;
    }

    const response = await fetch("/api/payments/cash-operations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        direction,
        category,
        amount: numericAmount,
        currency: currency.trim().toUpperCase(),
        method: method.trim(),
        reference: reference.trim() || undefined,
        description: description.trim(),
        occurredAt: new Date(occurredAt).toISOString(),
      }),
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      setError(payload?.error ?? "Impossible d'enregistrer l'opération de caisse.");
      setLoading(false);
      return;
    }

    const thresholdAlert = typeof payload?.thresholdAlert === "string" ? payload.thresholdAlert : null;
    setMessage(
      thresholdAlert
        ? `Opération enregistrée. ${thresholdAlert}`
        : "Opération de caisse enregistrée et notifiée à la comptabilité.",
    );
    setAmount("");
    setReference("");
    setDescription("");
    setLoading(false);
    router.refresh();
  }

  return (
    <section className="mb-6 rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
      <h2 className="mb-3 text-sm font-semibold">Journal de caisse - Nouvelle opération</h2>
      <form onSubmit={onSubmit} className="grid gap-3 lg:grid-cols-4 lg:items-end">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Type</label>
          <select
            value={direction}
            onChange={(event) => setDirection(event.target.value as "INFLOW" | "OUTFLOW")}
            className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
          >
            <option value="INFLOW">Entrée de fonds</option>
            <option value="OUTFLOW">Sortie de fonds</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Catégorie</label>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
          >
            {categories.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
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
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Devise</label>
          <input
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
            maxLength={3}
            className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm uppercase dark:border-white/15 dark:bg-zinc-900"
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

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Date opération</label>
          <input
            type="datetime-local"
            value={occurredAt}
            onChange={(event) => setOccurredAt(event.target.value)}
            className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Libellé</label>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            placeholder="Motif comptable"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-black px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {loading ? "Enregistrement..." : "Enregistrer l'opération"}
        </button>
      </form>

      {message ? <p className="mt-2 text-xs text-emerald-600">{message}</p> : null}
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
    </section>
  );
}
