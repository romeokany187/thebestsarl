"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PaymentOrderCashExecutionActions({ paymentOrderId }: { paymentOrderId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [referenceDoc, setReferenceDoc] = useState("");
  const [executionComment, setExecutionComment] = useState("");

  async function executeOrder() {
    if (referenceDoc.trim().length < 2) {
      setState("error");
      setMessage("Saisissez une référence caisse (au moins 2 caractères) avant d'exécuter.");
      return;
    }

    setState("loading");
    setMessage("");

    try {
      const response = await fetch("/api/payment-orders/execute", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentOrderId,
          referenceDoc: referenceDoc.trim(),
          executionComment: executionComment.trim() || undefined,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setState("error");
        setMessage(payload?.error ?? "Impossible d'exécuter cet ordre de paiement.");
        return;
      }

      setState("success");
      setMessage("Ordre de paiement exécuté. Le comptable a été notifié.");
      setReferenceDoc("");
      setExecutionComment("");
      router.refresh();
    } catch {
      setState("error");
      setMessage("Erreur réseau pendant l'exécution.");
    }
  }

  return (
    <div className="mt-2 space-y-2">
      <input
        value={referenceDoc}
        onChange={(event) => setReferenceDoc(event.target.value)}
        maxLength={180}
        placeholder="Référence caisse / OP"
        disabled={state === "loading"}
        className="w-full rounded-md border border-black/15 px-2.5 py-2 text-[11px] text-black dark:border-white/15 dark:bg-zinc-900 dark:text-white"
      />
      <textarea
        value={executionComment}
        onChange={(event) => setExecutionComment(event.target.value)}
        rows={2}
        maxLength={500}
        placeholder="Commentaire d'exécution (optionnel)"
        disabled={state === "loading"}
        className="w-full rounded-md border border-black/15 px-2.5 py-2 text-[11px] text-black dark:border-white/15 dark:bg-zinc-900 dark:text-white"
      />
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={`/api/payment-orders/${paymentOrderId}/pdf`}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-black/20 px-2.5 py-1 text-[11px] font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
        >
          Lire PDF OP
        </a>
        <button
          type="button"
          onClick={() => void executeOrder()}
          disabled={state === "loading"}
          className="rounded-md border border-blue-300 px-2.5 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-60 dark:border-blue-700/60 dark:text-blue-300 dark:hover:bg-blue-950/30"
        >
          Exécuter OP (Caisse)
        </button>
      </div>
      {message ? <span className="text-[11px] text-black/60 dark:text-white/60">{message}</span> : null}
    </div>
  );
}
