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
              <p className="mt-2 text-xs text-black/55 dark:text-white/55">Tous niveaux confondus.</p>
            </article>
            <article className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">Classes actives</p>
              <p className="mt-2 text-3xl font-semibold">{activeClasses}</p>
              <p className="mt-2 text-xs text-black/55 dark:text-white/55">Classes actuellement chargees dans le referentiel.</p>
            </article>
            <article className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">Comptes racines</p>
              <p className="mt-2 text-3xl font-semibold">{rootAccounts}</p>
              <p className="mt-2 text-xs text-black/55 dark:text-white/55">Niveau superieur de l'arborescence.</p>
            </article>
            <article className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">Comptes de detail</p>
              <p className="mt-2 text-3xl font-semibold">{detailAccounts}</p>
              <p className="mt-2 text-xs text-black/55 dark:text-white/55">Comptes sans sous-comptes enfants.</p>
            </article>
          </section>

          <section className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
            <article className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-black/50 dark:text-white/50">Lecture rapide</p>
              <h3 className="mt-1 text-base font-semibold">Comment utiliser cet espace</h3>
              <div className="mt-3 space-y-3 text-sm text-black/60 dark:text-white/60">
                <p>Utilise la vue synthese pour verifier la structure globale avant de modifier le plan.</p>
                <p>Passe ensuite sur l'arborescence pour importer, charger SYSCOHADA, ajouter ou corriger un compte precis.</p>
                <p>Le journal comptable reste separe afin de ne pas melanger la maintenance du referentiel avec la passation des ecritures.</p>
              </div>
            </article>

            <article className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-black/50 dark:text-white/50">Densite</p>
              <p className="mt-2 text-sm font-semibold">Classe la plus dense</p>
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