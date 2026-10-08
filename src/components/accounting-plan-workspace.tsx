"use client";

import { useState } from "react";

type PlanView = "summary" | "detail";

export function AccountingPlanWorkspace({
  totalAccounts,
  activeClasses,
  rootAccounts,
  detailAccounts,
  densestClassLabel,
  topClasses,
  manager,
}: {
  totalAccounts: number;
  activeClasses: number;
  rootAccounts: number;
  detailAccounts: number;
  densestClassLabel: string;
  topClasses: Array<{ label: string; count: number }>;
  manager: React.ReactNode;
}) {
  const [view, setView] = useState<PlanView>("summary");

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-black/50 dark:text-white/50">Plan comptable</p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight">Organisation du referentiel</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setView("summary")}
              className={`rounded-md px-3 py-2 text-xs font-semibold transition ${view === "summary" ? "border border-emerald-500 bg-emerald-50 text-emerald-700 dark:border-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300" : "border border-black/15 hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"}`}
            >
              Vue synthese
            </button>
            <button
              type="button"
              onClick={() => setView("detail")}
              className={`rounded-md px-3 py-2 text-xs font-semibold transition ${view === "detail" ? "border border-violet-500 bg-violet-50 text-violet-700 dark:border-violet-600 dark:bg-violet-950/40 dark:text-violet-300" : "border border-black/15 hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"}`}
            >
              Arborescence et actions
            </button>
          </div>
        </div>
      </section>

      {view === "summary" ? (
        <div className="space-y-4">
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <article className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">Total comptes</p>
              <p className="mt-2 text-3xl font-semibold">{totalAccounts}</p>
            </article>
            <article className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">Classes actives</p>
              <p className="mt-2 text-3xl font-semibold">{activeClasses}</p>
            </article>
            <article className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">Comptes racines</p>
              <p className="mt-2 text-3xl font-semibold">{rootAccounts}</p>
            </article>
            <article className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">Comptes de detail</p>
              <p className="mt-2 text-3xl font-semibold">{detailAccounts}</p>
            </article>
          </section>

          <section className="grid gap-4 xl:grid-cols-[1fr]">
            <article className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
              <p className="text-sm font-semibold">Classe la plus dense</p>
              <p className="mt-1 text-base">{densestClassLabel}</p>
              <div className="mt-4 space-y-2">
                {topClasses.map((entry) => (
                  <div key={entry.label} className="flex items-center justify-between rounded-lg border border-black/10 px-3 py-2 text-sm dark:border-white/10">
                    <span>{entry.label}</span>
                    <span className="font-semibold">{entry.count} comptes</span>
                  </div>
                ))}
              </div>
            </article>
          </section>
        </div>
      ) : manager}
    </div>
  );
}