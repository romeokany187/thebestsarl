"use client";

import { useState } from "react";

type WritingMode = "none" | "tickets" | "cash";

export function PaymentsWritingWorkspace({
  canWrite,
  ticketPaymentForm,
  cashOperationForm,
}: {
  canWrite: boolean;
  ticketPaymentForm: React.ReactNode;
  cashOperationForm: React.ReactNode;
}) {
  const [mode, setMode] = useState<WritingMode>("none");

  if (!canWrite) {
    return null;
  }

  return (
    <section className="mb-6 rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Espace d'écriture caisse</h2>
          <p className="mt-1 text-xs text-black/60 dark:text-white/60">
            Choisissez une tâche, ouvrez l'espace de saisie, puis refermez pour revenir aux synthèses.
          </p>
        </div>
        {mode !== "none" ? (
          <button
            type="button"
            onClick={() => setMode("none")}
            className="rounded-md border border-black/20 px-3 py-1.5 text-xs font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Fermer l'espace
          </button>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setMode("tickets")}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
            mode === "tickets"
              ? "border border-emerald-500 bg-emerald-50 text-emerald-700 dark:border-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300"
              : "border border-black/20 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          }`}
        >
          Paiement des billets
        </button>
        <button
          type="button"
          onClick={() => setMode("cash")}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
            mode === "cash"
              ? "border border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-600 dark:bg-blue-950/40 dark:text-blue-300"
              : "border border-black/20 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          }`}
        >
          Autres écritures caisse
        </button>
      </div>

      <div className="mt-4">
        {mode === "tickets" ? ticketPaymentForm : null}
        {mode === "cash" ? cashOperationForm : null}
        {mode === "none" ? (
          <p className="rounded-xl border border-dashed border-black/20 px-4 py-5 text-xs text-black/60 dark:border-white/20 dark:text-white/60">
            Aucun espace ouvert. Cliquez sur une action pour commencer la saisie.
          </p>
        ) : null}
      </div>
    </section>
  );
}
