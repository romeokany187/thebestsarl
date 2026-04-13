"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  paymentId: string;
  amount: number;
  currency: string;
  method: string;
  reference: string | null;
  paidAt: string;
};

export function PaymentRowAdminActions({ paymentId, amount, currency, method, reference, paidAt }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function editPayment() {
    const payload = {
      paymentId,
      amount,
      currency,
      method,
      reference,
      paidAt,
    } as const;

    window.dispatchEvent(new CustomEvent("payment:edit", { detail: payload }));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deletePayment() {
    const confirmed = window.confirm("Supprimer définitivement ce paiement billet ?");
    if (!confirmed) return;

    setBusy(true);
    setMessage("");

    try {
      const response = await fetch(`/api/payments?paymentId=${encodeURIComponent(paymentId)}`, {
        method: "DELETE",
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(payload?.error ?? "Impossible de supprimer ce paiement.");
        return;
      }

      setMessage("Paiement supprimé.");
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
          onClick={() => void editPayment()}
          disabled={busy}
          className="rounded-md border border-black/20 px-2 py-1 text-[11px] font-semibold hover:bg-black/5 disabled:opacity-60 dark:border-white/20 dark:hover:bg-white/10"
        >
          Modifier
        </button>
        <button
          type="button"
          onClick={() => void deletePayment()}
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
