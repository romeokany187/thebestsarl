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
  const fontsDir = path.join(process.cwd(), "public", "fonts");
  try {
    const [regularBytes, boldBytes] = await Promise.all([
      readFile(path.join(fontsDir, "Montserrat-Regular.ttf")),
      readFile(path.join(fontsDir, "Montserrat-Bold.ttf")),
    ]);
    return {
      body: await pdf.embedFont(regularBytes),
      bold: await pdf.embedFont(boldBytes),
    };
  } catch (error) {
    console.warn("Failed to load Montserrat for income-statement PDF, falling back to Helvetica.", error);
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

export async function buildCashIncomeStatementPdfBuffer(statement: CashIncomeStatement) {
  const pdf = await PDFDocument.create();
  const { body: font, bold } = await loadIncomeStatementPdfFonts(pdf);
  const pageWidth = 842;
  const pageHeight = 595;
  const margin = 28;
  let page = pdf.addPage([pageWidth, pageHeight]);

  const leftLabelX = margin;
  const leftUsdRight = margin + 250;
  const leftCdfRight = margin + 330;
  const rightLabelX = margin + 370;
  const rightUsdRight = pageWidth - margin - 90;
  const rightCdfRight = pageWidth - margin;
  const labelWidth = 170;
  const fontSize = 9;
  const lineHeight = 13;

  page.drawRectangle({ x: 0, y: pageHeight - 78, width: pageWidth, height: 78, color: rgb(0.08, 0.1, 0.14) });
  page.drawText("THE BEST SARL", { x: margin, y: pageHeight - 28, size: 16, font: bold, color: rgb(1, 1, 1) });
  page.drawText(`COMPTE DE RESULTAT - ${monthLabelFr(statement.reportMonth).toUpperCase()}`, {
    x: margin,
    y: pageHeight - 48,
    size: 11,
    font: bold,
    color: rgb(0.92, 0.94, 0.99),
  });
  page.drawText(`Periode ${statement.periodStart} -> ${statement.periodEnd} | Source journal caisse + ventes billets`, {
    x: margin,
    y: pageHeight - 64,
    size: 8,
    font,
    color: rgb(0.75, 0.79, 0.86),
  });

  let y = pageHeight - 104;

  page.drawText("PRODUITS", { x: leftLabelX, y, size: 10, font: bold, color: rgb(0.14, 0.16, 0.2) });
  drawRightAligned(page, "USD", leftUsdRight, y, 9, bold);
  drawRightAligned(page, "CDF", leftCdfRight, y, 9, bold);
  page.drawText("CHARGES", { x: rightLabelX, y, size: 10, font: bold, color: rgb(0.14, 0.16, 0.2) });
  drawRightAligned(page, "USD", rightUsdRight, y, 9, bold);
  drawRightAligned(page, "CDF", rightCdfRight, y, 9, bold);
  y -= 8;
  page.drawLine({
    start: { x: margin, y },
    end: { x: pageWidth - margin, y },
    thickness: 1,
    color: rgb(0.85, 0.87, 0.91),
  });
  y -= lineHeight;

  const rowCount = Math.max(statement.products.length, statement.charges.length, 1);

  function ensureSpace(needed: number) {
    if (y - needed >= 40) return;
    page = pdf.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin - 12;
    page.drawText("COMPTE DE RESULTAT (suite)", { x: margin, y, size: 10, font: bold, color: rgb(0.14, 0.16, 0.2) });
    y -= lineHeight + 4;
  }

  for (let index = 0; index < rowCount; index += 1) {
    const product = statement.products[index];
    const charge = statement.charges[index];
    const productLines = product ? wrapPdfText(product.label, font, fontSize, labelWidth) : [""];
    const chargeLines = charge ? wrapPdfText(charge.label, font, fontSize, labelWidth) : [""];
    const blockHeight = Math.max(productLines.length, chargeLines.length) * lineHeight;
    ensureSpace(blockHeight + 4);

    for (let lineIndex = 0; lineIndex < Math.max(productLines.length, chargeLines.length); lineIndex += 1) {
      if (productLines[lineIndex]) {
        page.drawText(productLines[lineIndex], { x: leftLabelX, y, size: fontSize, font, color: rgb(0.14, 0.16, 0.2) });
      }
      if (chargeLines[lineIndex]) {
        page.drawText(chargeLines[lineIndex], { x: rightLabelX, y, size: fontSize, font, color: rgb(0.14, 0.16, 0.2) });
      }
      if (lineIndex === 0) {
        if (product) {
          drawRightAligned(page, formatPdfMoney(product.usd), leftUsdRight, y, fontSize, font);
          drawRightAligned(page, formatPdfMoney(product.cdf), leftCdfRight, y, fontSize, font);
        }
        if (charge) {
          drawRightAligned(page, formatPdfMoney(charge.usd), rightUsdRight, y, fontSize, font);
          drawRightAligned(page, formatPdfMoney(charge.cdf), rightCdfRight, y, fontSize, font);
        }
      }
      y -= lineHeight;
    }
  }

  ensureSpace(lineHeight * 5);
  y -= 4;
  page.drawLine({
    start: { x: margin, y: y + 8 },
    end: { x: pageWidth - margin, y: y + 8 },
    thickness: 1,
    color: rgb(0.85, 0.87, 0.91),
  });

  page.drawText("TOTAL PRODUITS", { x: leftLabelX, y, size: 9, font: bold, color: rgb(0.14, 0.16, 0.2) });
  drawRightAligned(page, formatPdfMoney(statement.totalProducts.usd), leftUsdRight, y, 9, bold);
  drawRightAligned(page, formatPdfMoney(statement.totalProducts.cdf), leftCdfRight, y, 9, bold);
  page.drawText("TOTAL CHARGES", { x: rightLabelX, y, size: 9, font: bold, color: rgb(0.14, 0.16, 0.2) });
  drawRightAligned(page, formatPdfMoney(statement.totalCharges.usd), rightUsdRight, y, 9, bold);
  drawRightAligned(page, formatPdfMoney(statement.totalCharges.cdf), rightCdfRight, y, 9, bold);
  y -= lineHeight + 10;

  page.drawText("RESULTAT (USD)", { x: leftLabelX, y, size: 10, font: bold, color: rgb(0.05, 0.35, 0.2) });
  drawRightAligned(page, formatPdfMoney(statement.resultUsd), leftUsdRight, y, 10, bold, rgb(0.05, 0.35, 0.2));
  page.drawText("ECART EN CDF (non consolide)", { x: rightLabelX, y, size: 9, font: bold, color: rgb(0.14, 0.16, 0.2) });
  drawRightAligned(page, formatPdfMoney(statement.resultCdf), rightUsdRight, y, 9, bold);
  y -= lineHeight + 14;

  if (statement.notes.length > 0) {
    const noteLines = wrapPdfText(statement.notes.join(" "), font, 8, pageWidth - margin * 2);
    ensureSpace(noteLines.length * 11 + 8);
    for (const line of noteLines) {
      page.drawText(line, { x: margin, y, size: 8, font, color: rgb(0.4, 0.45, 0.52) });
      y -= 11;
    }
  }

  return Buffer.from(await pdf.save());
}
