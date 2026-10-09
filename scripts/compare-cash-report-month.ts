/**
 * Compare un fichier Excel caissière au journal application (THE BEST) pour un mois.
 * Usage: PRISMA_SCHEMA_FILE=prisma/schema.mysql.prisma npx tsx scripts/compare-cash-report-month.ts <fichier.xlsx> [YYYY-MM]
 */
import { readFileSync } from "node:fs";
import { parseCashReportWorkbook } from "@/lib/cash-report-excel-parse";
import { buildMonthlyConstat, loadLiveCashJournalByDay } from "@/lib/cash-report-month-constat";

async function main() {
  const filePath = process.argv[2];
  const reportMonthArg = process.argv[3];
  if (!filePath) {
    console.error("Usage: tsx scripts/compare-cash-report-month.ts <fichier.xlsx> [YYYY-MM]");
    process.exit(1);
  }

  const buffer = readFileSync(filePath);
  const parsed = parseCashReportWorkbook(buffer, { fallbackYear: 2026 });
  const reportMonth = reportMonthArg ?? parsed.reportMonth;
  const systemByDay = await loadLiveCashJournalByDay(reportMonth);
  const constat = buildMonthlyConstat({
    reportMonth,
    excelLines: parsed.journalLines,
    systemByDay,
  });

  console.log(JSON.stringify(constat, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
