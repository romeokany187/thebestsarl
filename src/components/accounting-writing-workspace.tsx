"use client";

import { useEffect, useState } from "react";

type AccountingView = "journal" | "reports" | "plan";

type AccountingViewItem = {
  key: AccountingView;
  label: string;
  tone: "blue" | "violet";
};

const VIEW_ITEMS: AccountingViewItem[] = [
  { key: "journal", label: "Livre journal", tone: "blue" },
  { key: "reports", label: "Rapports", tone: "blue" },
  { key: "plan", label: "Plan comptable", tone: "violet" },
];

function resolveAccountingView(value: string | null | undefined): AccountingView | null {
  if (!value) return null;
  const normalized = value.replace(/^#/, "").trim().toLowerCase();
  if (normalized === "journal" || normalized === "overview" || normalized === "pilotage") return "journal";
  if (normalized === "reports") return "reports";
  if (normalized === "plan") return "plan";
  return null;
}

function defaultAccountingView(): AccountingView {
  if (typeof window === "undefined") return "journal";
  const url = new URL(window.location.href);
  return resolveAccountingView(url.searchParams.get("view"))
    ?? resolveAccountingView(window.location.hash)
    ?? "journal";
}

function toneClass(tone: AccountingViewItem["tone"], active: boolean) {
  if (!active) {
    return "border border-black/15 text-black/75 hover:bg-black/5 dark:border-white/15 dark:text-white/75 dark:hover:bg-white/10";
  }

  if (tone === "blue") return "border border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-600 dark:bg-blue-950/40 dark:text-blue-300";
  return "border border-violet-500 bg-violet-50 text-violet-700 dark:border-violet-600 dark:bg-violet-950/40 dark:text-violet-300";
}

export function AccountingWritingWorkspace({
  journalWorkspace,
  reportsWorkspace,
  planWorkspace,
}: {
  journalWorkspace: React.ReactNode;
  reportsWorkspace: React.ReactNode;
  planWorkspace: React.ReactNode;
}) {
  const [view, setView] = useState<AccountingView>(defaultAccountingView);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const syncViewFromUrl = () => {
      setView(defaultAccountingView());
    };

    syncViewFromUrl();
    window.addEventListener("hashchange", syncViewFromUrl);
    window.addEventListener("popstate", syncViewFromUrl);
    return () => {
      window.removeEventListener("hashchange", syncViewFromUrl);
      window.removeEventListener("popstate", syncViewFromUrl);
    };
  }, []);

  function selectView(nextView: AccountingView) {
    setView(nextView);
    if (typeof window === "undefined") return;

    const url = new URL(window.location.href);
    url.searchParams.set("view", nextView);
    url.hash = nextView;
    window.history.replaceState(window.history.state, "", url.toString());
  }

  return (
    <section className="mb-6 grid items-start gap-4 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm lg:sticky lg:top-28 dark:border-white/10 dark:bg-zinc-900">
        <div className="space-y-2">
          {VIEW_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => selectView(item.key)}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-semibold transition ${toneClass(item.tone, view === item.key)}`}
            >
              <span>{item.label}</span>
              <span>›</span>
            </button>
          ))}
        </div>
      </aside>

      <div className="min-w-0 space-y-4">
        {view === "journal" ? journalWorkspace : null}
        {view === "reports" ? reportsWorkspace : null}
        {view === "plan" ? planWorkspace : null}
      </div>
    </section>
  );
}
