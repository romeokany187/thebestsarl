"use client";

import { useState } from "react";

type WritingMode = "none" | "tickets" | "cash" | "needs" | "orders";

export function PaymentsWritingWorkspace({
  ticketWorkspace,
  cashWorkspace,
  needsPendingWorkspace,
  ordersPendingWorkspace,
}: {
  ticketWorkspace: React.ReactNode;
  cashWorkspace: React.ReactNode;
  needsPendingWorkspace: React.ReactNode;
  ordersPendingWorkspace: React.ReactNode;
}) {
  const [mode, setMode] = useState<WritingMode>("none");

  return (
    <section className="mb-6 rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Actions paiements et validations</h2>
          <p className="mt-1 text-xs text-black/60 dark:text-white/60">
            Choisissez une action pour ouvrir un espace ciblé, puis refermez pour revenir au menu.
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
        <button
          type="button"
          onClick={() => setMode("needs")}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
            mode === "needs"
              ? "border border-amber-500 bg-amber-50 text-amber-700 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-300"
              : "border border-black/20 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          }`}
        >
          Besoins en attente de validation
        </button>
        <button
          type="button"
          onClick={() => setMode("orders")}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
            mode === "orders"
              ? "border border-fuchsia-500 bg-fuchsia-50 text-fuchsia-700 dark:border-fuchsia-600 dark:bg-fuchsia-950/40 dark:text-fuchsia-300"
              : "border border-black/20 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          }`}
        >
          Ordres de paiement en attente
        </button>
      </div>

      <div className="mt-4">
        {mode === "tickets" ? ticketWorkspace : null}
        {mode === "cash" ? cashWorkspace : null}
        {mode === "needs" ? needsPendingWorkspace : null}
        {mode === "orders" ? ordersPendingWorkspace : null}
        {mode === "none" ? (
          <p className="rounded-xl border border-dashed border-black/20 px-4 py-5 text-xs text-black/60 dark:border-white/20 dark:text-white/60">
            Aucun espace ouvert. Cliquez sur une action pour commencer.
          </p>
        ) : null}
      </div>
    </section>
  );
}
