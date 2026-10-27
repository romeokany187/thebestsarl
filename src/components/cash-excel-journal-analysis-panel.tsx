import type { ExcelJournalBilletageAnalysis } from "@/lib/cash-excel-journal-analysis";
import { EXCEL_CAISSE_FIRST_MONTH } from "@/lib/cash-excel-journal-analysis";

function fmt(amount: number, currency: "USD" | "CDF") {
  return `${amount.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export function CashExcelJournalAnalysisPanel({ analysis }: { analysis: ExcelJournalBilletageAnalysis }) {
  const beforeExcelEra = analysis.reportMonth < EXCEL_CAISSE_FIRST_MONTH;
  const hasPhysical =
    analysis.physicalUsd != null &&
    analysis.physicalCdf != null &&
    (analysis.billetageUsd != null || analysis.virtualUsd != null || analysis.billetageCdf != null || analysis.virtualCdf != null);

  return (
    <section className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold">Analyse journal Excel vs billetage</h2>
      <p className="mt-1 text-xs text-black/60 dark:text-white/60">
        Compare le solde de fin de journal (Excel importé) à l&apos;argent concret en caisse : billetage + comptes virtuels
        (feuilles Excel). Continuité à partir de {EXCEL_CAISSE_FIRST_MONTH.replace("-", "/")}.
      </p>

      {beforeExcelEra ? (
        <p className="mt-3 rounded-lg border border-amber-300/40 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-100">
          Mois antérieur à avril 2026 : importez le fichier Excel correspondant ou choisissez un mois à partir d&apos;avril
          2026.
        </p>
      ) : null}

      {!analysis.hasExcelJournal ? (
        <p className="mt-3 rounded-lg border border-black/10 bg-black/[0.03] px-3 py-2 text-sm dark:border-white/10 dark:bg-white/[0.04]">
          Aucune ligne journal importée pour ce mois. Utilisez <strong>Import Excel caisse</strong> pour charger le fichier
          du mois.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {analysis.importFileName ? (
            <p className="text-xs text-black/55 dark:text-white/55">
              Dernier import : <span className="font-medium">{analysis.importFileName}</span>
              {analysis.referenceDate ? ` · analyse au ${analysis.referenceDate}` : null}
              {analysis.closingDate && analysis.closingDate !== analysis.referenceDate
                ? ` · billetage/virtuel au ${analysis.closingDate}`
                : null}
            </p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3 dark:border-white/10 dark:bg-white/[0.03]">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-black/55 dark:text-white/55">
                Solde fin de journal (Excel)
              </p>
              <p className="mt-1 text-lg font-bold tabular-nums">{fmt(analysis.journalClosingUsd, "USD")}</p>
              <p className="text-lg font-bold tabular-nums">{fmt(analysis.journalClosingCdf, "CDF")}</p>
            </div>

            <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3 dark:border-white/10 dark:bg-white/[0.03]">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-black/55 dark:text-white/55">
                Billetage (Excel)
              </p>
              {analysis.billetageUsd != null && analysis.billetageCdf != null ? (
                <>
                  <p className="mt-1 text-lg font-bold tabular-nums">{fmt(analysis.billetageUsd, "USD")}</p>
                  <p className="text-lg font-bold tabular-nums">{fmt(analysis.billetageCdf, "CDF")}</p>
                </>
              ) : (
                <p className="mt-2 text-sm text-black/55 dark:text-white/55">Billetage non importé pour cette date.</p>
              )}
            </div>

            <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3 dark:border-white/10 dark:bg-white/[0.03]">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-black/55 dark:text-white/55">
                Virtuels (Excel)
              </p>
              {analysis.virtualUsd != null && analysis.virtualCdf != null ? (
                <>
                  <p className="mt-1 text-lg font-bold tabular-nums">{fmt(analysis.virtualUsd, "USD")}</p>
                  <p className="mt-1 text-lg font-bold tabular-nums">{fmt(analysis.virtualCdf, "CDF")}</p>
                </>
              ) : (
                <p className="mt-2 text-sm text-black/55 dark:text-white/55">Feuille VIRTUEL non importée pour cette date.</p>
              )}
            </div>

            <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3 dark:border-white/10 dark:bg-white/[0.03]">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-black/55 dark:text-white/55">
                Concret (billetage + virtuels)
              </p>
              {hasPhysical ? (
                <>
                  <p className="mt-1 text-lg font-bold tabular-nums">{fmt(analysis.physicalUsd!, "USD")}</p>
                  <p className="text-lg font-bold tabular-nums">{fmt(analysis.physicalCdf!, "CDF")}</p>
                </>
              ) : (
                <p className="mt-2 text-sm text-black/55 dark:text-white/55">—</p>
              )}
            </div>
          </div>

          <div
            className={`rounded-xl border p-3 ${analysis.isAligned ? "border-emerald-400/40 bg-emerald-50 dark:bg-emerald-950/25" : "border-amber-400/40 bg-amber-50 dark:bg-amber-950/25"}`}
          >
            <p className="text-[10px] font-semibold uppercase tracking-wider text-black/55 dark:text-white/55">
              Constat (journal − concret)
            </p>
            {analysis.deltaUsd != null && analysis.deltaCdf != null ? (
              <>
                <p className="mt-1 text-lg font-bold tabular-nums">
                  {analysis.deltaUsd >= 0 ? "+" : ""}
                  {fmt(analysis.deltaUsd, "USD")}
                </p>
                <p className="text-lg font-bold tabular-nums">
                  {analysis.deltaCdf >= 0 ? "+" : ""}
                  {fmt(analysis.deltaCdf, "CDF")}
                </p>
                <p className="mt-2 text-xs text-black/65 dark:text-white/65">
                  {analysis.isAligned
                    ? "Conforme : le solde journal correspond au billetage + virtuels importés."
                    : "Écart à vérifier : différence entre le rapport journal et l’argent compté (billetage + virtuels)."}
                </p>
              </>
            ) : (
              <p className="mt-2 text-sm">Importez billetage et feuille VIRTUEL (réimport Excel du jour) pour calculer le constat.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
