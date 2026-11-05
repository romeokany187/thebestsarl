import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { loadImportedJournalLinesForDateRange, type ImportedJournalLineRecord } from "@/lib/cash-journal-ledger";
import { sanitizeImportedJournalLinesForDisplay } from "@/lib/cash-journal-import-sanitize";
import { monthUtcRange } from "@/lib/cash-report-month-constat";

export type IncomeStatementMoney = { usd: number; cdf: number };

export type IncomeStatementLine = {
  label: string;
  usd: number;
  cdf: number;
  source: "cash-journal" | "ticket-sales";
  kind: "product" | "charge";
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
};

function normalizeMatchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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

function matchesAny(haystack: string, needles: string[]) {
  return needles.some((needle) => haystack.includes(needle));
}

function isConversionLine(line: ImportedJournalLineRecord) {
  return normalizeMatchText(`${line.typeOperation} ${line.libelle}`).includes("conversion");
}

function isPublicMarketInflow(line: ImportedJournalLineRecord) {
  const text = normalizeMatchText(`${line.typeOperation} ${line.libelle}`);
  return matchesAny(text, [
    "marche",
    "marche public",
    "marches publics",
    "adra",
    "gilet",
    "gilets",
    "etat de besoin",
    "edb",
  ]);
}

type ChargeBucket =
  | "dream"
  | "bank"
  | "transport"
  | "salary"
  | "internet"
  | "commission"
  | "other";

const CHARGE_BUCKET_META: Array<{ key: ChargeBucket; label: string; keywords: string[] }> = [
  {
    key: "dream",
    label: "Factures Dream",
    keywords: ["dream", "facture dream", "partenaire dream"],
  },
  {
    key: "bank",
    label: "Frais bancaires",
    keywords: [
      "frais bancaire",
      "frais banque",
      "commission retrait",
      "commission depot",
      "tenue de compte",
      "frais airtel",
      "frais orange",
      "frais mpesa",
      "frais m-pesa",
      "frais equity",
      "frais rawbank",
      "frais illico",
    ],
  },
  {
    key: "transport",
    label: "Mobilité et transport",
    keywords: ["mobilite", "transport", "deplacement", "mission", "taxi", "carburant", "essence"],
  },
  {
    key: "salary",
    label: "Charges du personnel",
    keywords: ["salaire", "salaires", "paie", "personnel", "remuneration", "prime"],
  },
  {
    key: "internet",
    label: "Internet",
    keywords: ["internet", "forfait internet", "fibre", "wifi", "credit telephone", "forfait"],
  },
  {
    key: "commission",
    label: "Commissions versées",
    keywords: ["commission versee", "commissions versees", "commission", "hk service", "hkservice", "honoraire"],
  },
];

function classifyOutflowBucket(line: ImportedJournalLineRecord): ChargeBucket {
  const text = normalizeMatchText(`${line.typeOperation} ${line.libelle}`);
  for (const bucket of CHARGE_BUCKET_META) {
    if (matchesAny(text, bucket.keywords)) return bucket.key;
  }
  return "other";
}

function titleFromLibelle(line: ImportedJournalLineRecord) {
  const raw = (line.libelle || line.typeOperation || "Marché public").trim();
  return raw.length > 80 ? `${raw.slice(0, 77)}…` : raw;
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

export async function buildCashIncomeStatement(reportMonth: string): Promise<CashIncomeStatement> {
  if (!/^\d{4}-\d{2}$/.test(reportMonth)) {
    throw new Error(`Mois invalide: ${reportMonth}`);
  }

  const { periodStart, periodEnd } = monthBounds(reportMonth);
  const rawLines = await loadImportedJournalLinesForDateRange(periodStart, periodEnd);
  const lines = sanitizeImportedJournalLinesForDisplay(rawLines).filter(
    (line) => line.lineCategory !== "OPENING" && line.lineCategory !== "SKIP",
  );

  const products: IncomeStatementLine[] = [];
  const ticketInflows = emptyMoney();
  const otherInflows = emptyMoney();
  const marketBuckets = new Map<string, IncomeStatementMoney>();

  for (const line of lines) {
    if (line.lineCategory !== "TICKET_INFLOW" && line.lineCategory !== "OTHER_INFLOW") continue;
    if (isConversionLine(line)) continue;

    if (line.lineCategory === "TICKET_INFLOW") {
      addMoney(ticketInflows, line.usdIn, line.cdfIn);
      continue;
    }

    if (isPublicMarketInflow(line)) {
      const label = titleFromLibelle(line);
      const bucket = marketBuckets.get(label) ?? emptyMoney();
      addMoney(bucket, line.usdIn, line.cdfIn);
      marketBuckets.set(label, bucket);
      continue;
    }

    addMoney(otherInflows, line.usdIn, line.cdfIn);
  }

  products.push({
    label: "Recettes billetteries",
    usd: ticketInflows.usd,
    cdf: ticketInflows.cdf,
    source: "cash-journal",
    kind: "product",
  });

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

  const chargeTotals: Record<ChargeBucket, IncomeStatementMoney> = {
    dream: emptyMoney(),
    bank: emptyMoney(),
    transport: emptyMoney(),
    salary: emptyMoney(),
    internet: emptyMoney(),
    commission: emptyMoney(),
    other: emptyMoney(),
  };

  for (const line of lines) {
    if (line.lineCategory !== "OUTFLOW") continue;
    if (isConversionLine(line)) continue;
    const bucket = classifyOutflowBucket(line);
    addMoney(chargeTotals[bucket], line.usdOut, line.cdfOut);
  }

  const consumedCredits = await loadTicketSalesConsumedCredits(reportMonth);
  const charges: IncomeStatementLine[] = [
    {
      label: "Crédits consommés",
      usd: consumedCredits.usd,
      cdf: consumedCredits.cdf,
      source: "ticket-sales",
      kind: "charge",
    },
  ];

  for (const meta of CHARGE_BUCKET_META) {
    charges.push({
      label: meta.label,
      usd: chargeTotals[meta.key].usd,
      cdf: chargeTotals[meta.key].cdf,
      source: "cash-journal",
      kind: "charge",
    });
  }

  charges.push({
    label: "Autres charges",
    usd: chargeTotals.other.usd,
    cdf: chargeTotals.other.cdf,
    source: "cash-journal",
    kind: "charge",
  });

  const totalProducts = products.reduce(
    (sum, line) => {
      addMoney(sum, line.usd, line.cdf);
      return sum;
    },
    emptyMoney(),
  );
  const totalCharges = charges.reduce(
    (sum, line) => {
      addMoney(sum, line.usd, line.cdf);
      return sum;
    },
    emptyMoney(),
  );

  const notes = [
    "Produits : journal de caisse importé Excel (entrées billetterie, marchés publics, autres recettes). Conversions exclues.",
    "Crédits consommés : somme des montants billets vendus (TicketSale.amount) sur le mois.",
    "Autres charges : sorties journal non classées Dream / frais bancaires / transport / personnel / internet / commissions.",
    "USD et CDF présentés séparément (pas de consolidation de change).",
  ];

  if (rawLines.length === 0) {
    notes.unshift("Aucune ligne journal Excel importée pour ce mois — produits/charges caisse à 0.");
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
  };
}

function monthLabelFr(reportMonth: string) {
  const [year, month] = reportMonth.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));
  const label = date.toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export async function buildCashIncomeStatementExcelBuffer(statement: CashIncomeStatement) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "THE BEST SARL";
  workbook.created = new Date();

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
  sheet.getColumn(8).width = 3;

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
  for (const col of ["A", "B", "C", "E", "F", "G"]) {
    sheet.getCell(`${col}4`).font = { bold: true };
  }

  sheet.getCell("A5").value = "Désignation";
  sheet.getCell("B5").value = "USD";
  sheet.getCell("C5").value = "CDF";
  sheet.getCell("E5").value = "Désignation";
  sheet.getCell("F5").value = "USD";
  sheet.getCell("G5").value = "CDF";
  for (const col of ["A", "B", "C", "E", "F", "G"]) {
    sheet.getCell(`${col}5`).font = { bold: true };
  }

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
  for (const col of ["A", "B", "C", "E", "F", "G"]) {
    sheet.getCell(`${col}${totalRow}`).font = { bold: true };
  }
  for (const col of ["B", "C", "F", "G"]) {
    sheet.getCell(`${col}${totalRow}`).numFmt = "#,##0.00";
  }

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
  sheet.getRow(noteRow).height = 48;

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
