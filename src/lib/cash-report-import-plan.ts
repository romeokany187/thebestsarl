import { kinshasaDateKey } from "@/lib/kinshasa-time";
import { isReportMonthClosed } from "@/lib/cash-report-month-constat";

export type CashReportImportMode = "HISTORICAL_FULL_MONTH" | "CURRENT_MONTH_DAILY";

export type CashReportImportPlan = {
  mode: CashReportImportMode;
  modeLabel: string;
  reportMonth: string;
  todayKey: string;
  closedMonth: boolean;
  datesToImport: string[];
  skippedDates: string[];
  /** Date d’archivage billetage / virtuel (jour courant uniquement, mois en cours). */
  deskSnapshotDate: string | null;
  applyDeskSnapshots: boolean;
};

function datesInReportMonth(journalDates: string[], reportMonth: string) {
  const prefix = `${reportMonth}-`;
  return journalDates.filter((date) => date.startsWith(prefix)).sort();
}

export function resolveCashReportImportPlan(options: {
  reportMonth: string;
  journalDates: string[];
  reconcileDates?: string[];
}): CashReportImportPlan {
  const todayKey = kinshasaDateKey();
  const closedMonth = isReportMonthClosed(options.reportMonth, todayKey);
  const inMonth = datesInReportMonth(options.journalDates, options.reportMonth);
  const reconcileSet = new Set((options.reconcileDates ?? []).map((d) => d.trim()).filter(Boolean));

  let mode: CashReportImportMode;
  let datesToImport: string[];
  let modeLabel: string;

  if (reconcileSet.size > 0) {
    mode = closedMonth ? "HISTORICAL_FULL_MONTH" : "CURRENT_MONTH_DAILY";
    datesToImport = [...reconcileSet].filter((date) => inMonth.includes(date)).sort();
    modeLabel = "Réconciliation manuelle des dates sélectionnées.";
  } else if (closedMonth) {
    mode = "HISTORICAL_FULL_MONTH";
    datesToImport = inMonth;
    modeLabel =
      "Mois clôturé : remplacement du journal sur tous les jours présents dans le fichier Excel (billetage / virtuel du fichier ignorés).";
  } else {
    mode = "CURRENT_MONTH_DAILY";
    datesToImport = inMonth.filter((date) => date <= todayKey);
    modeLabel =
      "Mois en cours : mise à jour du journal pour le jour actuel et les jours déjà écoulés du mois (import quotidien).";
  }

  const skippedDates = inMonth.filter((date) => !datesToImport.includes(date));
  const applyDeskSnapshots = mode === "CURRENT_MONTH_DAILY" && options.reportMonth === todayKey.slice(0, 7);
  const deskSnapshotDate = applyDeskSnapshots ? todayKey : null;

  return {
    mode,
    modeLabel,
    reportMonth: options.reportMonth,
    todayKey,
    closedMonth,
    datesToImport,
    skippedDates,
    deskSnapshotDate,
    applyDeskSnapshots,
  };
}
