"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PaymentOrderForm() {
  const router = useRouter();
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("XAF");
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submitOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedAmount = Number(amount);
    if (!description.trim() || !Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      setState("error");
      setMessage("Renseignez une description et un montant valide.");
      return;
    }

    setState("loading");
    setMessage("");

    try {
      const response = await fetch("/api/payment-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: description.trim(),
          amount: normalizedAmount,
          currency: currency.trim().toUpperCase(),
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setState("error");
        setMessage(payload?.error ?? "Impossible de créer l'ordre de paiement.");
        return;
      }

      setState("success");
      setMessage("Ordre de paiement envoyé à l'Admin pour validation.");
      setDescription("");
      setAmount("");
      setCurrency("XAF");
      router.refresh();
    } catch {
      setState("error");
      setMessage("Erreur réseau pendant la création de l'ordre de paiement.");
    }
  }

  return (
    <form onSubmit={(event) => void submitOrder(event)} className="mb-6 rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold">Nouvel ordre de paiement (DG)</h2>
      <p className="mt-1 text-xs text-black/60 dark:text-white/60">Après soumission, l'Admin reçoit une notification pour validation.</p>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Description de l'ordre"
          maxLength={500}
          className="rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
          disabled={state === "loading"}
        />
        <input
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="Montant"
          inputMode="decimal"
          className="rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
          disabled={state === "loading"}
        />
        <input
          value={currency}
          onChange={(event) => setCurrency(event.target.value)}
          placeholder="Devise"
          maxLength={3}
          className="rounded-md border border-black/15 bg-white px-3 py-2 text-sm uppercase dark:border-white/15 dark:bg-zinc-900"
          disabled={state === "loading"}
        />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="submit"
          disabled={state === "loading"}
          className="rounded-md border border-black/20 px-3 py-1.5 text-xs font-semibold hover:bg-black/5 disabled:opacity-60 dark:border-white/20 dark:hover:bg-white/10"
        >
          Envoyer OP
        </button>
        {message ? <span className="text-xs text-black/65 dark:text-white/65">{message}</span> : null}
      </div>
    </form>
  );
}
