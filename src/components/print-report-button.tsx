"use client";

export function PrintReportButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print rounded-md border border-zinc-300 px-3 py-2 text-xs font-semibold transition hover:bg-zinc-50"
    >
      Imprimer / PDF
    </button>
  );
}
