import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { loadImportedJournalLinesForDateRange, type ImportedJournalLineRecord } from "@/lib/cash-journal-ledger";
import { sanitizeImportedJournalLinesForDisplay } from "@/lib/cash-journal-import-sanitize";
import { monthUtcRange } from "@/lib/cash-report-month-constat";
import {
  chargeBucketLabel,
  classifyIncomeStatementLine,
  type ChargeBucket,
  type ProductBucket,
} from "@/lib/cash-income-statement-classify";

export type IncomeStatementMoney = { usd: number; cdf: number };

export type IncomeStatementLine = {
  label: string;
  usd: number;
  cdf: number;
  source: "cash-journal" | "ticket-sales";
  kind: "product" | "charge";
};

export type IncomeStatementAuditRow = {
  businessDate: string;
  typeOperation: string;
  libelle: string;
  lineCategory: string;
  usdIn: number;
  usdOut: number;
  cdfIn: number;
  cdfOut: number;
  side: "product" | "charge" | "excluded";
  bucket: string;
  assignedLabel: string;
  reason: string;
};

export type CashIncomeStatement = {
  reportMonth: string;
  periodStart: string;
  periodEnd: string;
  products: IncomeStatementLine[];
  charges: IncomeStatementLine[];
  totalProducts: IncomeStatementMoney;
  totalCharges: IncomeStatementMoney;
  resultUsd: number;
  resultCdf: number;
  notes: string[];
  auditRows: IncomeStatementAuditRow[];
  journalCoveredUsd: IncomeStatementMoney;
  journalExcludedUsd: IncomeStatementMoney;
};

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function emptyMoney(): IncomeStatementMoney {
  return { usd: 0, cdf: 0 };
}

function addMoney(target: IncomeStatementMoney, usd: number, cdf: number) {
  target.usd = round2(target.usd + usd);
  target.cdf = round2(target.cdf + cdf);
}

function monthBounds(reportMonth: string) {
  const { start, end } = monthUtcRange(reportMonth);
  const periodStart = start.toISOString().slice(0, 10);
  const periodEnd = new Date(end.getTime() - 1).toISOString().slice(0, 10);
  return { start, end, periodStart, periodEnd };
}

async function loadTicketSalesConsumedCredits(reportMonth: string): Promise<IncomeStatementMoney> {
  const { start, end } = monthBounds(reportMonth);
  const tickets = await prisma.ticketSale.findMany({
    where: { soldAt: { gte: start, lt: end } },
    select: { amount: true, currency: true },
  });

  const totals = emptyMoney();
  for (const ticket of tickets) {
    const currency = (ticket.currency ?? "USD").trim().toUpperCase();
    if (currency === "CDF" || currency === "XAF" || currency === "FC") {
      totals.cdf = round2(totals.cdf + ticket.amount);
    } else {
      totals.usd = round2(totals.usd + ticket.amount);
    }
  }
  return totals;
}

function toAuditRow(line: ImportedJournalLineRecord, disposition: ReturnType<typeof classifyIncomeStatementLine>): IncomeStatementAuditRow {
  return {
    businessDate: line.businessDate,
    typeOperation: line.typeOperation,
    libelle: line.libelle,
    lineCategory: line.lineCategory,
    usdIn: line.usdIn,
    usdOut: line.usdOut,
    cdfIn: line.cdfIn,
    cdfOut: line.cdfOut,
    side: disposition.side,
    bucket: disposition.side === "excluded" ? "EXCLUDED" : disposition.bucket,
    assignedLabel: disposition.side === "excluded" ? "—" : disposition.label,
    reason: disposition.reason,
  };
}

export async function buildCashIncomeStatement(reportMonth: string): Promise<CashIncomeStatement> {
  if (!/^\d{4}-\d{2}$/.test(reportMonth)) {
    throw new Error(`Mois invalide: ${reportMonth}`);
  }

  const { periodStart, periodEnd } = monthBounds(reportMonth);
  const rawLines = await loadImportedJournalLinesForDateRange(periodStart, periodEnd);
  const lines = sanitizeImportedJournalLinesForDisplay(rawLines);

  const ticketInflows = emptyMoney();
  const otherInflows = emptyMoney();
  const marketBuckets = new Map<string, IncomeStatementMoney>();
  const chargeTotals: Record<ChargeBucket, IncomeStatementMoney> = {
    dream: emptyMoney(),
    bank: emptyMoney(),
    transport: emptyMoney(),
    salary: emptyMoney(),
    internet: emptyMoney(),
    commission: emptyMoney(),
    other_charge: emptyMoney(),
  };

  const auditRows: IncomeStatementAuditRow[] = [];
  const journalCovered = emptyMoney();
  const journalExcluded = emptyMoney();
  let unclassifiedOtherCharges = 0;

  for (const line of lines) {
    const disposition = classifyIncomeStatementLine(line);
    auditRows.push(toAuditRow(line, disposition));

    if (disposition.side === "excluded") {
      addMoney(journalExcluded, line.usdIn + line.usdOut, line.cdfIn + line.cdfOut);
      continue;
    }

    if (disposition.side === "product") {
      const bucket = disposition.bucket as ProductBucket;
      if (bucket === "ticket") {
        addMoney(ticketInflows, line.usdIn, line.cdfIn);
        addMoney(journalCovered, line.usdIn, line.cdfIn);
      } else if (bucket === "market") {
        const money = marketBuckets.get(disposition.label) ?? emptyMoney();
        addMoney(money, line.usdIn, line.cdfIn);
        marketBuckets.set(disposition.label, money);
        addMoney(journalCovered, line.usdIn, line.cdfIn);
      } else {
        addMoney(otherInflows, line.usdIn, line.cdfIn);
        addMoney(journalCovered, line.usdIn, line.cdfIn);
      }
      continue;
    }

    const chargeBucket = disposition.bucket as ChargeBucket;
    addMoney(chargeTotals[chargeBucket], line.usdOut, line.cdfOut);
    addMoney(journalCovered, line.usdOut, line.cdfOut);
    if (chargeBucket === "other_charge") unclassifiedOtherCharges += 1;
  }

  const products: IncomeStatementLine[] = [
    {
      label: "Recettes billetteries",
      usd: ticketInflows.usd,
      cdf: ticketInflows.cdf,
      source: "cash-journal",
      kind: "product",
    },
  ];

  for (const [label, money] of [...marketBuckets.entries()].sort((a, b) => a[0].localeCompare(b[0], "fr"))) {
    products.push({
      label,
      usd: money.usd,
      cdf: money.cdf,
      source: "cash-journal",
      kind: "product",
    });
  }

  products.push({
    label: "Autres recettes",
    usd: otherInflows.usd,
    cdf: otherInflows.cdf,
    source: "cash-journal",
    kind: "product",
  });

  const consumedCredits = await loadTicketSalesConsumedCredits(reportMonth);
  const chargeOrder: ChargeBucket[] = ["dream", "bank", "transport", "salary", "internet", "commission", "other_charge"];
  const charges: IncomeStatementLine[] = [
    {
      label: "Crédits consommés",
      usd: consumedCredits.usd,
      cdf: consumedCredits.cdf,
      source: "ticket-sales",
      kind: "charge",
    },
    ...chargeOrder.map((bucket) => ({
      label: chargeBucketLabel(bucket),
      usd: chargeTotals[bucket].usd,
      cdf: chargeTotals[bucket].cdf,
      source: "cash-journal" as const,
      kind: "charge" as const,
    })),
  ];

  const totalProducts = products.reduce((sum, line) => {
    addMoney(sum, line.usd, line.cdf);
    return sum;
  }, emptyMoney());
  const totalCharges = charges.reduce((sum, line) => {
    addMoney(sum, line.usd, line.cdf);
    return sum;
  }, emptyMoney());

  const notes = [
    "Chaque ligne du journal est reclassée via le libellé (feuille « Détail classement ») — pas seulement la catégorie d’import.",
    "Produits : billetterie, marchés publics (1 ligne par libellé), autres recettes. Conversions / report à nouveau exclus.",
    "Crédits consommés : somme TicketSale.amount du mois (ventes), hors journal.",
    "USD et CDF présentés séparément.",
  ];

  if (rawLines.length === 0) {
    notes.unshift("Aucune ligne journal Excel importée pour ce mois — produits/charges caisse à 0.");
  }
  if (unclassifiedOtherCharges > 0) {
    notes.unshift(
      `${unclassifiedOtherCharges} sortie(s) classée(s) en « Autres charges » : vérifier l’onglet Détail classement pour affiner les libellés.`,
    );
  }

  return {
    reportMonth,
    periodStart,
    periodEnd,
    products,
    charges,
    totalProducts,
    totalCharges,
    resultUsd: round2(totalProducts.usd - totalCharges.usd),
    resultCdf: round2(totalProducts.cdf - totalCharges.cdf),
    notes,
    auditRows,
    journalCoveredUsd: journalCovered,
    journalExcludedUsd: journalExcluded,
  };
}

function monthLabelFr(reportMonth: string) {
  const [year, month] = reportMonth.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));
  const label = date.toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function addSummarySheet(workbook: ExcelJS.Workbook, statement: CashIncomeStatement) {
  const sheet = workbook.addWorksheet("Compte de résultat", {
    views: [{ showGridLines: false }],
  });

  sheet.getColumn(1).width = 34;
  sheet.getColumn(2).width = 14;
  sheet.getColumn(3).width = 14;
  sheet.getColumn(4).width = 3;
  sheet.getColumn(5).width = 34;
  sheet.getColumn(6).width = 14;
  sheet.getColumn(7).width = 14;

  sheet.getCell("A1").value = "THE BEST SARL";
  sheet.getCell("A1").font = { bold: true, size: 14 };
  sheet.getCell("A2").value = `COMPTE DE RÉSULTAT – ${monthLabelFr(statement.reportMonth).toUpperCase()}`;
  sheet.getCell("A2").font = { bold: true, size: 12 };

  sheet.getCell("A4").value = "PRODUITS";
  sheet.getCell("B4").value = "USD";
  sheet.getCell("C4").value = "CDF";
  sheet.getCell("E4").value = "CHARGES";
  sheet.getCell("F4").value = "USD";
  sheet.getCell("G4").value = "CDF";
  for (const col of ["A", "B", "C", "E", "F", "G"]) sheet.getCell(`${col}4`).font = { bold: true };

  sheet.getCell("A5").value = "Désignation";
  sheet.getCell("B5").value = "USD";
  sheet.getCell("C5").value = "CDF";
  sheet.getCell("E5").value = "Désignation";
  sheet.getCell("F5").value = "USD";
  sheet.getCell("G5").value = "CDF";
  for (const col of ["A", "B", "C", "E", "F", "G"]) sheet.getCell(`${col}5`).font = { bold: true };

  const rowCount = Math.max(statement.products.length, statement.charges.length);
  for (let index = 0; index < rowCount; index += 1) {
    const excelRow = 6 + index;
    const product = statement.products[index];
    const charge = statement.charges[index];
    if (product) {
      sheet.getCell(`A${excelRow}`).value = product.label;
      sheet.getCell(`B${excelRow}`).value = product.usd;
      sheet.getCell(`C${excelRow}`).value = product.cdf;
      sheet.getCell(`B${excelRow}`).numFmt = "#,##0.00";
      sheet.getCell(`C${excelRow}`).numFmt = "#,##0.00";
    }
    if (charge) {
      sheet.getCell(`E${excelRow}`).value = charge.label;
      sheet.getCell(`F${excelRow}`).value = charge.usd;
      sheet.getCell(`G${excelRow}`).value = charge.cdf;
      sheet.getCell(`F${excelRow}`).numFmt = "#,##0.00";
      sheet.getCell(`G${excelRow}`).numFmt = "#,##0.00";
    }
  }

  const totalRow = 6 + rowCount;
  sheet.getCell(`A${totalRow}`).value = "TOTAL PRODUITS";
  sheet.getCell(`B${totalRow}`).value = statement.totalProducts.usd;
  sheet.getCell(`C${totalRow}`).value = statement.totalProducts.cdf;
  sheet.getCell(`E${totalRow}`).value = "TOTAL CHARGES";
  sheet.getCell(`F${totalRow}`).value = statement.totalCharges.usd;
  sheet.getCell(`G${totalRow}`).value = statement.totalCharges.cdf;
  for (const col of ["A", "B", "C", "E", "F", "G"]) sheet.getCell(`${col}${totalRow}`).font = { bold: true };
  for (const col of ["B", "C", "F", "G"]) sheet.getCell(`${col}${totalRow}`).numFmt = "#,##0.00";

  const resultRow = totalRow + 2;
  sheet.getCell(`A${resultRow}`).value = "RÉSULTAT (USD)";
  sheet.getCell(`B${resultRow}`).value = statement.resultUsd;
  sheet.getCell(`B${resultRow}`).numFmt = "#,##0.00";
  sheet.getCell(`E${resultRow}`).value = "ÉCART EN CDF (non consolidé)";
  sheet.getCell(`F${resultRow}`).value = statement.resultCdf;
  sheet.getCell(`F${resultRow}`).numFmt = "#,##0.00";
  sheet.getCell(`A${resultRow}`).font = { bold: true };
  sheet.getCell(`E${resultRow}`).font = { bold: true };

  const noteRow = resultRow + 3;
  sheet.mergeCells(`A${noteRow}:G${noteRow}`);
  sheet.getCell(`A${noteRow}`).value = statement.notes.join(" ");
  sheet.getCell(`A${noteRow}`).alignment = { wrapText: true };
  sheet.getRow(noteRow).height = 60;
}

function addAuditSheet(workbook: ExcelJS.Workbook, statement: CashIncomeStatement) {
  const sheet = workbook.addWorksheet("Détail classement");
  const headers = [
    "Date",
    "Type opération",
    "Libellé",
    "Catégorie import",
    "USD in",
    "USD out",
    "CDF in",
    "CDF out",
    "Côté P&L",
    "Rubrique",
    "Libellé affecté",
    "Motif classement",
  ];
  sheet.addRow(headers);
  sheet.getRow(1).font = { bold: true };

  for (const row of statement.auditRows) {
    const excelRow = sheet.addRow([
      row.businessDate,
      row.typeOperation,
      row.libelle,
      row.lineCategory,
      row.usdIn,
      row.usdOut,
      row.cdfIn,
      row.cdfOut,
      row.side,
      row.bucket,
      row.assignedLabel,
      row.reason,
    ]);
    if (row.side === "excluded") {
      excelRow.font = { color: { argb: "FF6B7280" } };
    } else if (row.bucket === "other_charge" || row.bucket === "other_product") {
      excelRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFFF7ED" },
      };
    }
  }

  sheet.columns.forEach((column, index) => {
    column.width = [12, 22, 42, 16, 12, 12, 12, 12, 12, 16, 28, 36][index] ?? 14;
  });
  for (const col of [5, 6, 7, 8]) {
    sheet.getColumn(col).numFmt = "#,##0.00";
  }
}

export async function buildCashIncomeStatementExcelBuffer(statement: CashIncomeStatement) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "THE BEST SARL";
  workbook.created = new Date();
  addSummarySheet(workbook, statement);
  addAuditSheet(workbook, statement);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
