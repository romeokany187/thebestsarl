import { readFile } from "fs/promises";
import path from "path";
import ExcelJS from "exceljs";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
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
  const marketInflows = emptyMoney();
  const otherInflows = emptyMoney();
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
        addMoney(marketInflows, line.usdIn, line.cdfIn);
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
    {
      label: "Marchés publics",
      usd: marketInflows.usd,
      cdf: marketInflows.cdf,
      source: "cash-journal",
      kind: "product",
    },
    {
      label: "Autres recettes",
      usd: otherInflows.usd,
      cdf: otherInflows.cdf,
      source: "cash-journal",
      kind: "product",
    },
  ];

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
    "Produits : billetterie, marchés publics (ADRA/gilets/… agrégés), autres recettes. Report à nouveau et conversions exclus.",
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

const EXCEL_BRAND = "0017365D";
const EXCEL_SECTION = "00FFD966";
const EXCEL_TOTAL = "00FFF2CC";
const EXCEL_RESULT = "00D9EAD3";
const EXCEL_RESULT_TEXT = "00274E13";
const EXCEL_NOTE_TEXT = "00666666";
const EXCEL_MONEY_FMT = "#,##0.00;[Red](#,##0.00);-";
const EXCEL_TEMPLATE_NOTE =
  "Note : les montants en USD et en CDF sont présentés séparément. Pour obtenir un résultat global unique, convertir les opérations en monnaie de présentation selon les taux applicables.";

function solidFill(argb: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function thinBottomBorder(): Partial<ExcelJS.Borders> {
  return { bottom: { style: "thin", color: { argb: "00B7B7B7" } } };
}

function styleExcelRow(sheet: ExcelJS.Worksheet, rowNumber: number, cols: string[], options: {
  fill?: string;
  bold?: boolean;
  color?: string;
  size?: number;
  italic?: boolean;
  border?: boolean;
  numFmt?: boolean;
  align?: Partial<ExcelJS.Alignment>;
}) {
  for (const col of cols) {
    const cell = sheet.getCell(`${col}${rowNumber}`);
    if (options.fill) cell.fill = solidFill(options.fill);
    cell.font = {
      name: "Arial",
      bold: options.bold ?? false,
      italic: options.italic ?? false,
      size: options.size ?? 11,
      color: options.color ? { argb: options.color } : undefined,
    };
    if (options.border) cell.border = thinBottomBorder();
    if (options.numFmt && ["B", "C", "F", "G"].includes(col)) cell.numFmt = EXCEL_MONEY_FMT;
    if (options.align) cell.alignment = { vertical: "middle", ...options.align };
    else cell.alignment = { vertical: "middle" };
  }
  sheet.getRow(rowNumber).height = 23;
}

function addSummarySheet(workbook: ExcelJS.Workbook, statement: CashIncomeStatement) {
  const sheet = workbook.addWorksheet("Compte de résultat", {
    views: [{ showGridLines: false }],
  });

  sheet.getColumn(1).width = 30;
  sheet.getColumn(2).width = 16;
  sheet.getColumn(3).width = 18;
  sheet.getColumn(4).width = 3;
  sheet.getColumn(5).width = 30;
  sheet.getColumn(6).width = 16;
  sheet.getColumn(7).width = 18;

  sheet.mergeCells("A1:D1");
  sheet.mergeCells("A2:D2");
  sheet.getCell("A1").value = "THE BEST SARL";
  sheet.getCell("A2").value = `COMPTE DE RÉSULTAT – ${monthLabelFr(statement.reportMonth).toUpperCase()}`;
  styleExcelRow(sheet, 1, ["A", "B", "C", "D"], {
    fill: EXCEL_BRAND,
    bold: true,
    color: "00FFFFFF",
    size: 16,
    align: { horizontal: "center", vertical: "middle" },
  });
  styleExcelRow(sheet, 2, ["A", "B", "C", "D"], {
    fill: EXCEL_BRAND,
    bold: true,
    color: "00FFFFFF",
    size: 13,
    align: { horizontal: "center", vertical: "middle" },
  });

  styleExcelRow(sheet, 4, ["A", "B", "C", "E", "F", "G"], {
    fill: EXCEL_SECTION,
    bold: true,
    color: "00000000",
    border: true,
  });
  sheet.getCell("A4").value = "PRODUITS";
  sheet.getCell("B4").value = "USD";
  sheet.getCell("C4").value = "CDF";
  sheet.getCell("E4").value = "CHARGES";
  sheet.getCell("F4").value = "USD";
  sheet.getCell("G4").value = "CDF";

  styleExcelRow(sheet, 5, ["A", "B", "C", "E", "F", "G"], {
    bold: true,
    color: EXCEL_BRAND,
    border: true,
  });
  sheet.getCell("A5").value = "Désignation";
  sheet.getCell("B5").value = "USD";
  sheet.getCell("C5").value = "CDF";
  sheet.getCell("E5").value = "Désignation";
  sheet.getCell("F5").value = "USD";
  sheet.getCell("G5").value = "CDF";

  const rowCount = Math.max(statement.products.length, statement.charges.length, 1);
  const firstDataRow = 6;
  for (let index = 0; index < rowCount; index += 1) {
    const excelRow = firstDataRow + index;
    const product = statement.products[index];
    const charge = statement.charges[index];
    styleExcelRow(sheet, excelRow, ["A", "B", "C", "E", "F", "G"], { border: true, numFmt: true });
    if (product) {
      sheet.getCell(`A${excelRow}`).value = product.label;
      sheet.getCell(`B${excelRow}`).value = product.usd;
      sheet.getCell(`C${excelRow}`).value = product.cdf;
    }
    if (charge) {
      sheet.getCell(`E${excelRow}`).value = charge.label;
      sheet.getCell(`F${excelRow}`).value = charge.usd;
      sheet.getCell(`G${excelRow}`).value = charge.cdf;
    }
  }

  const lastDataRow = firstDataRow + rowCount - 1;
  const totalRow = lastDataRow + 1;
  styleExcelRow(sheet, totalRow, ["A", "B", "C", "D", "E", "F", "G"], {
    fill: EXCEL_TOTAL,
    bold: true,
    border: true,
    numFmt: true,
  });
  sheet.getCell(`A${totalRow}`).value = "TOTAL PRODUITS";
  sheet.getCell(`B${totalRow}`).value = { formula: `SUM(B${firstDataRow}:B${lastDataRow})`, result: statement.totalProducts.usd };
  sheet.getCell(`C${totalRow}`).value = { formula: `SUM(C${firstDataRow}:C${lastDataRow})`, result: statement.totalProducts.cdf };
  sheet.getCell(`E${totalRow}`).value = "TOTAL CHARGES";
  sheet.getCell(`F${totalRow}`).value = { formula: `SUM(F${firstDataRow}:F${lastDataRow})`, result: statement.totalCharges.usd };
  sheet.getCell(`G${totalRow}`).value = { formula: `SUM(G${firstDataRow}:G${lastDataRow})`, result: statement.totalCharges.cdf };

  const resultRow = totalRow + 2;
  styleExcelRow(sheet, resultRow, ["A", "B", "C", "D", "E", "F", "G"], {
    fill: EXCEL_RESULT,
    bold: true,
    color: EXCEL_RESULT_TEXT,
    border: true,
    numFmt: true,
  });
  sheet.getCell(`A${resultRow}`).value = "RÉSULTAT (USD)";
  sheet.getCell(`B${resultRow}`).value = { formula: `B${totalRow}-F${totalRow}`, result: statement.resultUsd };
  sheet.getCell(`E${resultRow}`).value = "ÉCART EN CDF (non consolidé)";
  sheet.getCell(`G${resultRow}`).value = { formula: `C${totalRow}-G${totalRow}`, result: statement.resultCdf };

  const noteRow = resultRow + 3;
  sheet.mergeCells(`A${noteRow}:G${noteRow}`);
  const extraNotes = statement.notes.filter((note) => !/USD et CDF/i.test(note));
  sheet.getCell(`A${noteRow}`).value = [EXCEL_TEMPLATE_NOTE, ...extraNotes].join(" ");
  sheet.getCell(`A${noteRow}`).font = { name: "Arial", italic: true, size: 9, color: { argb: EXCEL_NOTE_TEXT } };
  sheet.getCell(`A${noteRow}`).alignment = { wrapText: true, vertical: "top" };
  sheet.getRow(noteRow).height = 48;
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

function formatPdfMoney(value: number) {
  return value.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function wrapPdfText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const content = (text ?? "").trim();
  if (!content) return [""];

  const words = content.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      current = word;
      continue;
    }
    let chunk = "";
    for (const char of word) {
      const next = `${chunk}${char}`;
      if (chunk && font.widthOfTextAtSize(next, size) > maxWidth) {
        lines.push(chunk);
        chunk = char;
      } else {
        chunk = next;
      }
    }
    current = chunk;
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

async function loadIncomeStatementPdfFonts(pdf: PDFDocument) {
  pdf.registerFontkit(fontkit);
  const fontPath = path.join(process.cwd(), "public", "fonts", "MAIAN.TTF");
  try {
    const regularBytes = await readFile(fontPath);
    const maiandra = await pdf.embedFont(regularBytes);
    return { body: maiandra, bold: maiandra };
  } catch (error) {
    console.warn("Failed to load MAIAN.TTF for income-statement PDF, falling back to Helvetica.", error);
    return {
      body: await pdf.embedFont(StandardFonts.Helvetica),
      bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    };
  }
}

function drawRightAligned(page: PDFPage, text: string, xRight: number, y: number, size: number, font: PDFFont, color = rgb(0.14, 0.16, 0.2)) {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: xRight - width, y, size, font, color });
}

function drawFilledRow(
  page: PDFPage,
  x: number,
  yBottom: number,
  width: number,
  height: number,
  fill: ReturnType<typeof rgb>,
) {
  page.drawRectangle({
    x,
    y: yBottom,
    width,
    height,
    color: fill,
    borderWidth: 0.6,
    borderColor: rgb(0.85, 0.87, 0.91),
  });
}

export async function buildCashIncomeStatementPdfBuffer(statement: CashIncomeStatement) {
  const pdf = await PDFDocument.create();
  const { body: font, bold } = await loadIncomeStatementPdfFonts(pdf);
  // Landscape A4 — même gabarit que les rapports comptables (Maiandra + bandeau sombre).
  const pageWidth = 1191;
  const pageHeight = 842;
  const margin = 24;
  let page = pdf.addPage([pageWidth, pageHeight]);

  const leftBlockX = margin;
  const leftBlockW = 560;
  const rightBlockX = margin + 580;
  const rightBlockW = 560;
  const labelPad = 10;
  const usdColW = 110;
  const cdfColW = 120;
  const leftLabelW = leftBlockW - usdColW - cdfColW - labelPad * 2;
  const rightLabelW = rightBlockW - usdColW - cdfColW - labelPad * 2;
  const fontSize = 9.5;
  const rowH = 22;

  const brand = rgb(0.08, 0.1, 0.14);
  const sectionFill = rgb(1, 0.851, 0.4);
  const totalFill = rgb(1, 0.949, 0.8);
  const resultFill = rgb(0.851, 0.918, 0.827);
  const resultText = rgb(0.153, 0.306, 0.075);
  const ink = rgb(0.14, 0.16, 0.2);
  const muted = rgb(0.4, 0.45, 0.52);
  const altRow = rgb(0.985, 0.985, 0.985);
  const white = rgb(1, 1, 1);

  function drawHeader(subtitle: string) {
    page.drawRectangle({ x: 0, y: pageHeight - 92, width: pageWidth, height: 92, color: brand });
    page.drawText("THEBEST SARL", { x: margin, y: pageHeight - 30, size: 18, font: bold, color: white });
    page.drawText("Compte de resultat (caisse)", {
      x: margin,
      y: pageHeight - 52,
      size: 12.5,
      font: bold,
      color: rgb(0.92, 0.94, 0.99),
    });
    page.drawText(subtitle, { x: margin, y: pageHeight - 70, size: 8.5, font, color: rgb(0.75, 0.79, 0.86) });
  }

  function moneyX(blockX: number, blockW: number, which: "usd" | "cdf") {
    if (which === "usd") return blockX + blockW - cdfColW - usdColW + usdColW - labelPad;
    return blockX + blockW - labelPad;
  }

  function drawSectionHeader(yBottom: number) {
    drawFilledRow(page, leftBlockX, yBottom, leftBlockW, rowH, sectionFill);
    drawFilledRow(page, rightBlockX, yBottom, rightBlockW, rowH, sectionFill);
    const textY = yBottom + 7;
    page.drawText("PRODUITS", { x: leftBlockX + labelPad, y: textY, size: 10, font: bold, color: ink });
    drawRightAligned(page, "USD", moneyX(leftBlockX, leftBlockW, "usd"), textY, 9, bold, ink);
    drawRightAligned(page, "CDF", moneyX(leftBlockX, leftBlockW, "cdf"), textY, 9, bold, ink);
    page.drawText("CHARGES", { x: rightBlockX + labelPad, y: textY, size: 10, font: bold, color: ink });
    drawRightAligned(page, "USD", moneyX(rightBlockX, rightBlockW, "usd"), textY, 9, bold, ink);
    drawRightAligned(page, "CDF", moneyX(rightBlockX, rightBlockW, "cdf"), textY, 9, bold, ink);
  }

  function drawSubHeader(yBottom: number) {
    page.drawRectangle({
      x: leftBlockX,
      y: yBottom,
      width: leftBlockW,
      height: rowH,
      borderWidth: 0.6,
      borderColor: rgb(0.85, 0.87, 0.91),
      color: white,
    });
    page.drawRectangle({
      x: rightBlockX,
      y: yBottom,
      width: rightBlockW,
      height: rowH,
      borderWidth: 0.6,
      borderColor: rgb(0.85, 0.87, 0.91),
      color: white,
    });
    const textY = yBottom + 7;
    const brandBlue = rgb(0.09, 0.212, 0.365);
    page.drawText("Designation", { x: leftBlockX + labelPad, y: textY, size: 9, font: bold, color: brandBlue });
    drawRightAligned(page, "USD", moneyX(leftBlockX, leftBlockW, "usd"), textY, 9, bold, brandBlue);
    drawRightAligned(page, "CDF", moneyX(leftBlockX, leftBlockW, "cdf"), textY, 9, bold, brandBlue);
    page.drawText("Designation", { x: rightBlockX + labelPad, y: textY, size: 9, font: bold, color: brandBlue });
    drawRightAligned(page, "USD", moneyX(rightBlockX, rightBlockW, "usd"), textY, 9, bold, brandBlue);
    drawRightAligned(page, "CDF", moneyX(rightBlockX, rightBlockW, "cdf"), textY, 9, bold, brandBlue);
  }

  const periodLabel = `${monthLabelFr(statement.reportMonth)} | ${statement.periodStart} - ${statement.periodEnd}`;
  drawHeader(periodLabel);
  let y = pageHeight - 120;

  function ensureSpace(needed: number) {
    if (y - needed >= 48) return;
    page = pdf.addPage([pageWidth, pageHeight]);
    drawHeader(`${periodLabel} (suite)`);
    y = pageHeight - 120;
    drawSectionHeader(y - rowH);
    y -= rowH;
    drawSubHeader(y - rowH);
    y -= rowH;
  }

  drawSectionHeader(y - rowH);
  y -= rowH;
  drawSubHeader(y - rowH);
  y -= rowH;

  const rowCount = Math.max(statement.products.length, statement.charges.length, 1);
  for (let index = 0; index < rowCount; index += 1) {
    const product = statement.products[index];
    const charge = statement.charges[index];
    const productLines = product ? wrapPdfText(product.label, font, fontSize, leftLabelW) : [""];
    const chargeLines = charge ? wrapPdfText(charge.label, font, fontSize, rightLabelW) : [""];
    const lines = Math.max(productLines.length, chargeLines.length, 1);
    const blockH = Math.max(rowH, lines * 12 + 8);
    ensureSpace(blockH + 4);

    const fill = index % 2 === 0 ? white : altRow;
    drawFilledRow(page, leftBlockX, y - blockH, leftBlockW, blockH, fill);
    drawFilledRow(page, rightBlockX, y - blockH, rightBlockW, blockH, fill);

    let textY = y - 14;
    for (let lineIndex = 0; lineIndex < lines; lineIndex += 1) {
      if (productLines[lineIndex]) {
        page.drawText(productLines[lineIndex], { x: leftBlockX + labelPad, y: textY, size: fontSize, font, color: ink });
      }
      if (chargeLines[lineIndex]) {
        page.drawText(chargeLines[lineIndex], { x: rightBlockX + labelPad, y: textY, size: fontSize, font, color: ink });
      }
      if (lineIndex === 0) {
        if (product) {
          drawRightAligned(page, formatPdfMoney(product.usd), moneyX(leftBlockX, leftBlockW, "usd"), textY, fontSize, font, ink);
          drawRightAligned(page, formatPdfMoney(product.cdf), moneyX(leftBlockX, leftBlockW, "cdf"), textY, fontSize, font, ink);
        }
        if (charge) {
          drawRightAligned(page, formatPdfMoney(charge.usd), moneyX(rightBlockX, rightBlockW, "usd"), textY, fontSize, font, ink);
          drawRightAligned(page, formatPdfMoney(charge.cdf), moneyX(rightBlockX, rightBlockW, "cdf"), textY, fontSize, font, ink);
        }
      }
      textY -= 12;
    }
    y -= blockH;
  }

  ensureSpace(rowH * 3 + 40);
  y -= 6;
  drawFilledRow(page, leftBlockX, y - rowH, leftBlockW, rowH, totalFill);
  drawFilledRow(page, rightBlockX, y - rowH, rightBlockW, rowH, totalFill);
  {
    const textY = y - rowH + 7;
    page.drawText("TOTAL PRODUITS", { x: leftBlockX + labelPad, y: textY, size: 9.5, font: bold, color: ink });
    drawRightAligned(page, formatPdfMoney(statement.totalProducts.usd), moneyX(leftBlockX, leftBlockW, "usd"), textY, 9.5, bold, ink);
    drawRightAligned(page, formatPdfMoney(statement.totalProducts.cdf), moneyX(leftBlockX, leftBlockW, "cdf"), textY, 9.5, bold, ink);
    page.drawText("TOTAL CHARGES", { x: rightBlockX + labelPad, y: textY, size: 9.5, font: bold, color: ink });
    drawRightAligned(page, formatPdfMoney(statement.totalCharges.usd), moneyX(rightBlockX, rightBlockW, "usd"), textY, 9.5, bold, ink);
    drawRightAligned(page, formatPdfMoney(statement.totalCharges.cdf), moneyX(rightBlockX, rightBlockW, "cdf"), textY, 9.5, bold, ink);
  }
  y -= rowH + 10;

  drawFilledRow(page, leftBlockX, y - rowH, leftBlockW, rowH, resultFill);
  drawFilledRow(page, rightBlockX, y - rowH, rightBlockW, rowH, resultFill);
  {
    const textY = y - rowH + 7;
    page.drawText("RESULTAT (USD)", { x: leftBlockX + labelPad, y: textY, size: 10, font: bold, color: resultText });
    drawRightAligned(page, formatPdfMoney(statement.resultUsd), moneyX(leftBlockX, leftBlockW, "usd"), textY, 10, bold, resultText);
    page.drawText("ECART EN CDF (non consolide)", { x: rightBlockX + labelPad, y: textY, size: 9.5, font: bold, color: resultText });
    drawRightAligned(page, formatPdfMoney(statement.resultCdf), moneyX(rightBlockX, rightBlockW, "cdf"), textY, 10, bold, resultText);
  }
  y -= rowH + 18;

  const noteText = [EXCEL_TEMPLATE_NOTE, ...statement.notes.filter((note) => !/USD et CDF/i.test(note))].join(" ");
  const noteLines = wrapPdfText(noteText, font, 8, pageWidth - margin * 2);
  ensureSpace(noteLines.length * 11 + 8);
  for (const line of noteLines) {
    page.drawText(line, { x: margin, y, size: 8, font, color: muted });
    y -= 11;
  }

  return Buffer.from(await pdf.save());
}
