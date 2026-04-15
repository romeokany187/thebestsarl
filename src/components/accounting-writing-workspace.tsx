"use client";

import { useState } from "react";

type AccountingView = "overview" | "pilotage" | "journal" | "plan";

type AccountingViewItem = {
  key: AccountingView;
  label: string;
  tone: "emerald" | "amber" | "blue" | "violet";
};

const VIEW_ITEMS: AccountingViewItem[] = [
  { key: "overview", label: "Vue d'ensemble", tone: "emerald" },
  { key: "pilotage", label: "Pilotage", tone: "amber" },
  { key: "journal", label: "Livre journal", tone: "blue" },
  { key: "plan", label: "Plan comptable", tone: "violet" },
];

function toneClass(tone: AccountingViewItem["tone"], active: boolean) {
  if (!active) {
    return "border border-black/15 text-black/75 hover:bg-black/5 dark:border-white/15 dark:text-white/75 dark:hover:bg-white/10";
  }

  if (tone === "emerald") return "border border-emerald-500 bg-emerald-50 text-emerald-700 dark:border-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300";
  if (tone === "amber") return "border border-amber-500 bg-amber-50 text-amber-700 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-300";
  if (tone === "blue") return "border border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-600 dark:bg-blue-950/40 dark:text-blue-300";
  return "border border-violet-500 bg-violet-50 text-violet-700 dark:border-violet-600 dark:bg-violet-950/40 dark:text-violet-300";
}

export function AccountingWritingWorkspace({
  overviewWorkspace,
  pilotageWorkspace,
  journalWorkspace,
  planWorkspace,
}: {
  overviewWorkspace: React.ReactNode;
  pilotageWorkspace: React.ReactNode;
  journalWorkspace: React.ReactNode;
  planWorkspace: React.ReactNode;
}) {
  const [view, setView] = useState<AccountingView>("overview");
  const activeView = VIEW_ITEMS.find((item) => item.key === view) ?? VIEW_ITEMS[0];

  return (
    <section className="mb-6 grid items-start gap-4 xl:grid-cols-[300px_minmax(0,1fr)] 2xl:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm xl:sticky xl:top-24 xl:max-h-[calc(100vh-7rem)] xl:overflow-y-auto dark:border-white/10 dark:bg-zinc-900">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-black/50 dark:text-white/50">Comptabilite</p>
        <h2 className="mt-1 text-sm font-semibold">Sous-menu Comptabilite</h2>
        <p className="mt-3 text-xs text-black/60 dark:text-white/60">
          Choisis une zone de travail. L'espace principal n'affiche que le bloc comptable utile pour eviter l'effet de page trop chargee.
        </p>

        <div className="mt-4 space-y-2">
          {VIEW_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setView(item.key)}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-semibold transition ${toneClass(item.tone, view === item.key)}`}
            >
              <span>{item.label}</span>
              <span>›</span>
            </button>
          ))}
        </div>
      </aside>

      <div className="min-w-0">
        <section className="mb-4 rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-black/55 dark:text-white/55">Zone active</p>
              <h3 className="text-sm font-semibold">{activeView.label}</h3>
            </div>
            <span className="rounded-full border border-black/15 px-3 py-1 text-[11px] font-semibold dark:border-white/15">
              Module comptabilite
            </span>
          </div>
        </section>

        <div className="space-y-4">
          {view === "overview" ? overviewWorkspace : null}
          {view === "pilotage" ? pilotageWorkspace : null}
          {view === "journal" ? journalWorkspace : null}
          {view === "plan" ? planWorkspace : null}
        </div>
      </div>
    </section>
  );
}