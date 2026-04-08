"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function PaymentOrderDeleteButton({
  paymentOrderId,
  status,
  compact = false,
}: {
  paymentOrderId: string;
  status?: string | null;
  compact?: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState("");

  const isExecuted = (status ?? "").trim().toUpperCase() === "EXECUTED";

  async function handleDelete() {
    if (isExecuted) {
      setMessage("Un OP déjà exécuté ne peut pas être supprimé ici.");
      return;
    }

    const confirmed = window.confirm("Supprimer définitivement cet ordre de paiement ?");
    if (!confirmed) {
      return;
    }

    setState("loading");
    setMessage("");

    try {
      const response = await fetch(`/api/payment-orders?paymentOrderId=${encodeURIComponent(paymentOrderId)}`, {
        method: "DELETE",
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setState("error");
        setMessage(payload?.error ?? "Impossible de supprimer cet ordre de paiement.");
        return;
      }

      router.refresh();
    } catch {
      setState("error");
      setMessage("Erreur réseau pendant la suppression.");
    } finally {
      setState("idle");
    }
  }

  return (
    <div className={compact ? "contents" : "space-y-1"}>
      <button
        type="button"
        onClick={() => void handleDelete()}
        disabled={state === "loading"}
        className="rounded-md border border-red-300 px-2.5 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-700/60 dark:text-red-300 dark:hover:bg-red-950/30"
      >
        {state === "loading" ? "Suppression..." : "Supprimer OP"}
      </button>
      {!compact && message ? <p className="text-[11px] text-red-600 dark:text-red-300">{message}</p> : null}
    </div>
  );
}
