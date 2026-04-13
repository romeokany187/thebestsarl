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
  direction?: string | null;
  category?: string | null;
};

export function CashOperationRowActions({
  cashOperationId,
  amount,
  currency,
  method,
  reference,
  description,
  occurredAt,
  direction,
  category,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  function editOperation() {
    const payload = {
      id: cashOperationId,
      direction: direction ?? null,
      category: category ?? null,
      amount,
      currency,
      method,
      reference,
      description,
      occurredAt,
    } as const;

    window.dispatchEvent(new CustomEvent("cashOperation:edit", { detail: payload }));
    setMessage("Les champs d'encodage ont été pré-remplis pour édition.");
    // smooth scroll to top where the form usually is
    window.scrollTo({ top: 0, behavior: "smooth" });
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

      {/* editing is done in the main CashOperationForm via dispatching an event */}
    </div>
  );
}
