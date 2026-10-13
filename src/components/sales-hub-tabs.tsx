"use client";

import Link from "next/link";
import { useMemo } from "react";

export type SalesHubView = "sell" | "list" | "stats";

function buildHref(view: SalesHubView, params: URLSearchParams) {
  const next = new URLSearchParams(params);
  next.set("view", view);
  const query = next.toString();
  return query ? `/sales?${query}` : `/sales?view=${view}`;
}

export function SalesHubTabs({
  active,
  searchParams,
  showSellTab,
}: {
  active: SalesHubView;
  searchParams: Record<string, string | undefined>;
  showSellTab: boolean;
}) {
  const paramString = useMemo(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (key === "view" || !value) continue;
      params.set(key, value);
    }
    return params;
  }, [searchParams]);

  const tabs: Array<{ view: SalesHubView; label: string }> = [
    ...(showSellTab ? [{ view: "sell" as const, label: "Vendre" }] : []),
    { view: "list", label: "Liste" },
    { view: "stats", label: "Statistiques" },
  ];

  return (
    <nav className="mb-6 flex flex-wrap gap-2 rounded-xl border border-black/10 bg-white p-2 dark:border-white/10 dark:bg-zinc-900">
      {tabs.map((tab) => {
        const isActive = tab.view === active;
        return (
          <Link
            key={tab.view}
            href={buildHref(tab.view, paramString)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
              isActive
                ? "bg-black text-white dark:bg-white dark:text-black"
                : "text-black/70 hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/10"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
