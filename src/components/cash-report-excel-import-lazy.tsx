"use client";

import dynamic from "next/dynamic";

export const CashReportExcelImportWorkspace = dynamic(
  () => import("@/components/cash-report-excel-import-workspace").then((module) => module.CashReportExcelImportWorkspace),
  {
    ssr: false,
    loading: () => (
      <section className="rounded-2xl border border-black/10 bg-white p-4 text-xs text-black/60 dark:border-white/10 dark:bg-zinc-900 dark:text-white/60">
        Chargement de l&apos;import Excel…
      </section>
    ),
  },
);
