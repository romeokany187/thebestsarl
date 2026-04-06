"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  cashOperationId: string;
  amount: number;
  currency: string;
  method: string;
  reference: string | null;
  description: string;
  occurredAt: string;
};

export function CashOperationRowActions({
  cashOperationId,
  amount,
  currency,
  method,
  reference,
  description,
  occurredAt,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function editOperation() {
    const nextAmountRaw = window.prompt("Montant de l'opération", amount.toString());
    if (nextAmountRaw === null) return;

    const nextAmount = Number.parseFloat(nextAmountRaw);
    if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
      setMessage("Montant invalide.");
      return;
    }

    const nextCurrencyRaw = window.prompt("Devise (USD ou CDF)", currency.toUpperCase());
    if (nextCurrencyRaw === null) return;
    const nextCurrency = nextCurrencyRaw.trim().toUpperCase();
    if (nextCurrency !== "USD" && nextCurrency !== "CDF") {
      setMessage("Devise invalide.");
      return;
    }

    const nextMethod = window.prompt("Méthode", method)?.trim();
    if (!nextMethod) return;

    const nextReference = window.prompt("Référence", reference ?? "")?.trim();
    if (!nextReference) return;

    const nextDescription = window.prompt("Libellé", description)?.trim();
    if (!nextDescription) return;

    const currentOccurredAt = occurredAt.slice(0, 16);
    const nextOccurredAt = window.prompt("Date/heure (AAAA-MM-JJTHH:MM)", currentOccurredAt);
    if (!nextOccurredAt) return;

    setBusy(true);
    setMessage("");

    try {
      const response = await fetch("/api/payments/cash-operations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cashOperationId,
          amount: nextAmount,
          currency: nextCurrency,
          method: nextMethod,
          reference: nextReference,
          description: nextDescription,
          occurredAt: new Date(nextOccurredAt).toISOString(),
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(payload?.error ?? "Impossible de modifier cette écriture.");
        return;
      }

      setMessage("Écriture modifiée.");
      router.refresh();
    } catch {
      setMessage("Erreur réseau pendant la modification.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteOperation() {
    const confirmed = window.confirm("Supprimer définitivement cette écriture de caisse ?");
    if (!confirmed) return;

    setBusy(true);
    setMessage("");

    try {
      const response = await fetch(`/api/payments/cash-operations?cashOperationId=${encodeURIComponent(cashOperationId)}`, {
        method: "DELETE",
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(payload?.error ?? "Impossible de supprimer cette écriture.");
        return;
      }

      setMessage("Écriture supprimée.");
      router.refresh();
    } catch {
      setMessage("Erreur réseau pendant la suppression.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => void editOperation()}
          disabled={busy}
          className="rounded-md border border-black/20 px-2 py-1 text-[11px] font-semibold hover:bg-black/5 disabled:opacity-60 dark:border-white/20 dark:hover:bg-white/10"
        >
          Modifier
        </button>
        <button
          type="button"
          onClick={() => void deleteOperation()}
          disabled={busy}
          className="rounded-md border border-red-300 px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-700/60 dark:text-red-300 dark:hover:bg-red-950/30"
        >
          Supprimer
        </button>
      </div>
      {message ? <p className="text-[10px] text-black/60 dark:text-white/60">{message}</p> : null}
    </div>
  );
}
