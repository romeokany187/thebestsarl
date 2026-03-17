import { CommissionCalculationStatus, CommissionMode, JobTitle, PaymentStatus, PrismaClient, Role, SaleNature, TravelClass } from "@prisma/client";
import { hashSync } from "bcryptjs";
import * as XLSX from "xlsx";

const prisma = new PrismaClient();

type SheetRow = Record<string, unknown>;

type GapRow = {
  sheet: string;
  line: number;
  sourcePnr: string;
  ticketNumber: string;
};

function normalizeHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function asString(value: unknown) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function asNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const normalized = String(value)
    .trim()
    .replace(/\s/g, "")
    .replace(/,/g, ".")
    .replace(/[^0-9.-]/g, "");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function pickValue(row: SheetRow, headers: string[]) {
  const normalized = new Map<string, unknown>();
  Object.entries(row).forEach(([key, value]) => {
    normalized.set(normalizeHeader(key), value);
  });

  for (const header of headers) {
    const found = normalized.get(normalizeHeader(header));
    if (found !== undefined && found !== null && String(found).trim() !== "") {
      return found;
    }
  }

  return null;
}

function parseSheetDateFromName(sheetName: string, year: number) {
  const clean = sheetName.trim();
  const dotted = clean.match(/^(\d{1,2})\.(\d{1,2})$/);
  if (dotted) {
    const day = Number.parseInt(dotted[1], 10);
    const month = Number.parseInt(dotted[2], 10);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
    }
  }
  return null;
}

function toRowsFromMatrix(sheet: XLSX.WorkSheet) {
  const matrix = XLSX.utils.sheet_to_json<Array<unknown>>(sheet, { header: 1, raw: true, defval: null });
  if (!matrix.length) return [] as SheetRow[];

  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(matrix.length, 8); i += 1) {
    const row = matrix[i] ?? [];
    const normalized = row.map((cell) => normalizeHeader(String(cell ?? "")));
    if (normalized.includes("pnr") && normalized.includes("emeteur") && normalized.includes("montant")) {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex === -1) {
    return XLSX.utils.sheet_to_json<SheetRow>(sheet, { defval: null, raw: true });
  }

  const headerRow = matrix[headerRowIndex] ?? [];
  const headers = headerRow.map((cell, index) => asString(cell) ?? `col_${index}`);

  const out: SheetRow[] = [];
  for (let i = headerRowIndex + 1; i < matrix.length; i += 1) {
    const row = matrix[i] ?? [];
    const obj: SheetRow = {};
    let hasAny = false;

    headers.forEach((header, index) => {
      const value = row[index] ?? null;
      obj[header] = value;
      if (!hasAny && asString(value)) hasAny = true;
    });

    if (hasAny) out.push(obj);
  }

  return out;
}

function parseSaleNature(value: unknown): SaleNature {
  const text = (asString(value) ?? "CASH").toUpperCase();
  return text.includes("CREDIT") ? SaleNature.CREDIT : SaleNature.CASH;
}

function parsePaymentStatus(value: unknown): PaymentStatus {
  const num = asNumber(value);
  if (num === 1) return PaymentStatus.PAID;
  if (num === 0) return PaymentStatus.UNPAID;

  const text = (asString(value) ?? "UNPAID")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (["PAID", "PAYE", "PAYER", "PAIE"].includes(text)) return PaymentStatus.PAID;
  if (["PARTIAL", "PARTIEL", "PARTIELLEMENT PAYE", "PARTIALLY PAID"].includes(text)) return PaymentStatus.PARTIAL;
  return PaymentStatus.UNPAID;
}

function mapPayerToAgency(value: string | null) {
  const text = (value ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (text.includes("mbujimayi") || text.includes("mbujimai") || text.includes("mbuji mayi") || text.includes("mbuji-mayi")) {
    return "Agence MBUJIMAYI";
  }
  if (text.includes("lubumbashi")) {
    return "Agence LUBUMBASHI";
  }
  return "Agence de Kinshasa (Direction générale)";
}

function slugifyName(value: string) {
  const clean = value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 32);
  return clean || "emetteur";
}

function normalizePersonKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function makeAirlineCode(name: string, usedCodes: Set<string>) {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z]/g, "")
    .toUpperCase()
    .slice(0, 3) || "AIR";

  let code = base;
  let i = 1;
  while (usedCodes.has(code)) {
    code = `${base.slice(0, 2)}${i}`.slice(0, 3);
    i += 1;
  }
  usedCodes.add(code);
  return code;
}

function isCaaLike(airline: { code: string; name: string }) {
  const code = airline.code.trim().toUpperCase();
  const name = normalizeHeader(airline.name);
  return code === "ACG" || code === "CAA" || name.includes("aircongo") || name.includes("caa");
}

function isAirFastLike(airline: { code: string; name: string }) {
  const code = airline.code.trim().toUpperCase();
  const name = normalizeHeader(airline.name);
  return code === "FST" || name.includes("airfast") || name.includes("airfastcongo");
}

async function main() {
  const workbookPath = process.argv[2] ?? "/Users/elkanamalik/Downloads/RAPPORT VENTE MARS  13  26.xlsx";
  const gapCsvPath = process.argv[3] ?? "imports/audit-gap-2026-01.csv";
  const year = Number.parseInt(process.argv[4] ?? "2026", 10);

  const workbook = XLSX.readFile(workbookPath, { cellDates: true });
  const gapBook = XLSX.readFile(gapCsvPath, { raw: true });
  const gapSheet = gapBook.Sheets[gapBook.SheetNames[0]];
  const gapRowsRaw = XLSX.utils.sheet_to_json<Record<string, unknown>>(gapSheet, { defval: null, raw: true });

  const gapRows: GapRow[] = gapRowsRaw.map((row) => ({
    sheet: String(row.sheet ?? "").trim(),
    line: Number.parseInt(String(row.line ?? "0"), 10),
    sourcePnr: String(row.sourcePnr ?? "").trim(),
    ticketNumber: String(row.ticketNumber ?? "").trim(),
  })).filter((row) => row.sheet && row.line > 0 && row.ticketNumber);

  const [users, airlines, grouped] = await Promise.all([
    prisma.user.findMany({ select: { id: true, name: true, email: true } }),
    prisma.airline.findMany({ select: { id: true, code: true, name: true } }),
    prisma.ticketSale.groupBy({ by: ["airlineId"], _count: { _all: true } }),
  ]);

  const userByEmail = new Map(users.map((user) => [user.email.trim().toLowerCase(), user]));
  const userByName = new Map(users.map((user) => [normalizePersonKey(user.name), user]));
  const usedEmails = new Set(users.map((user) => user.email.trim().toLowerCase()));

  const airlineByCode = new Map(airlines.map((airline) => [airline.code.trim().toUpperCase(), airline]));
  const airlineByName = new Map(airlines.map((airline) => [airline.name.trim().toLowerCase(), airline]));
  const usedAirlineCodes = new Set(airlines.map((airline) => airline.code.trim().toUpperCase()));
  const ticketCountByAirlineId = new Map(grouped.map((entry) => [entry.airlineId, entry._count._all]));

  async function resolveSeller(sellerNameRaw: string | null) {
    const sellerName = sellerNameRaw?.trim() ?? "";
    const key = normalizePersonKey(sellerName);
    const existing = userByName.get(key);
    if (existing) return existing;

    const slugBase = slugifyName(sellerName || "emetteur");
    let email = `import.${slugBase}@thebest.local`;
    let suffix = 1;
    while (usedEmails.has(email)) {
      email = `import.${slugBase}.${suffix}@thebest.local`;
      suffix += 1;
    }

    const created = await prisma.user.create({
      data: {
        name: sellerName || "Émetteur import",
        email,
        passwordHash: hashSync("ImportTemp#2026", 10),
        role: Role.EMPLOYEE,
        jobTitle: JobTitle.COMMERCIAL,
      },
      select: { id: true, name: true, email: true },
    });

    userByEmail.set(created.email.toLowerCase(), created);
    userByName.set(normalizePersonKey(created.name), created);
    usedEmails.add(created.email.toLowerCase());
    return created;
  }

  let created = 0;
  let skipped = 0;
  const failed: string[] = [];

  for (const gap of gapRows) {
    try {
      const existing = await prisma.ticketSale.findUnique({ where: { ticketNumber: gap.ticketNumber }, select: { id: true } });
      if (existing) {
        skipped += 1;
        continue;
      }

      const sheet = workbook.Sheets[gap.sheet];
      if (!sheet) {
        failed.push(`${gap.sheet}/${gap.ticketNumber}: feuille absente`);
        continue;
      }

      const rows = toRowsFromMatrix(sheet);
      let row = rows[gap.line - 2] as SheetRow | undefined;
      if (!row) {
        row = rows.find((entry) => String(pickValue(entry, ["pnr", "ticketNumber"]) ?? "").trim() === gap.sourcePnr);
      }

      if (!row) {
        failed.push(`${gap.sheet}/${gap.ticketNumber}: ligne introuvable`);
        continue;
      }

      const soldAt = parseSheetDateFromName(gap.sheet, year) ?? new Date();
      const amount = asNumber(pickValue(row, ["montant", "amount", "prix"]));
      const route = asString(pickValue(row, ["itineraire", "route", "trajet"])) ?? "ROUTE-NR";
      const customerName = asString(pickValue(row, ["beneficiare", "beneficiaire", "customerName", "client"])) ?? "Client non renseigné";
      const sellerName = asString(pickValue(row, ["emeteur", "emetteur", "sellerName", "commercial"])) ?? "Émetteur import";
      const payant = asString(pickValue(row, ["payant", "payerName"])) ?? "";
      const commissionFromFile = asNumber(pickValue(row, ["commission", "commissionAmount"])) ?? 0;
      const airlineName = asString(pickValue(row, ["compagnie", "airlineName", "airline"])) ?? "Compagnie inconnue";
      const airlineCodeRaw = asString(pickValue(row, ["airlineCode", "code compagnie", "code"]));

      if (!amount || amount <= 0) {
        failed.push(`${gap.sheet}/${gap.ticketNumber}: montant invalide`);
        continue;
      }

      let airline = airlineCodeRaw ? airlineByCode.get(airlineCodeRaw.toUpperCase()) : null;
      if (!airline) {
        airline = airlineByName.get(airlineName.toLowerCase()) ?? null;
      }
      if (!airline) {
        const code = airlineCodeRaw?.toUpperCase() ?? makeAirlineCode(airlineName, usedAirlineCodes);
        airline = await prisma.airline.upsert({
          where: { code },
          update: { name: airlineName },
          create: { code, name: airlineName },
          select: { id: true, code: true, name: true },
        });
        airlineByCode.set(airline.code.toUpperCase(), airline);
        airlineByName.set(airline.name.toLowerCase(), airline);
      }

      let commissionAmount = commissionFromFile;
      let commissionRateUsed = amount > 0 ? (commissionAmount / amount) * 100 : 0;

      if (isCaaLike(airline)) {
        commissionAmount = amount * 0.05;
        commissionRateUsed = 5;
      } else if (isAirFastLike(airline)) {
        const nextAirfast = (ticketCountByAirlineId.get(airline.id) ?? 0) + 1;
        ticketCountByAirlineId.set(airline.id, nextAirfast);
        commissionAmount = nextAirfast % 13 === 0 ? amount : 0;
        commissionRateUsed = nextAirfast % 13 === 0 ? 100 : 0;
      }

      const seller = await resolveSeller(sellerName);

      await prisma.ticketSale.create({
        data: {
          ticketNumber: gap.ticketNumber,
          customerName,
          route,
          travelClass: TravelClass.ECONOMY,
          travelDate: soldAt,
          soldAt,
          amount,
          baseFareAmount: amount,
          currency: "USD",
          airlineId: airline.id,
          sellerId: seller.id,
          saleNature: parseSaleNature(pickValue(row, ["nature de vente", "saleNature", "nature"])),
          paymentStatus: parsePaymentStatus(pickValue(row, ["statut", "paymentStatus"])),
          payerName: mapPayerToAgency(payant),
          agencyMarkupPercent: 0,
          agencyMarkupAmount: 0,
          commissionBaseAmount: amount,
          commissionCalculationStatus: CommissionCalculationStatus.FINAL,
          commissionRateUsed,
          commissionAmount,
          commissionModeApplied: CommissionMode.IMMEDIATE,
          notes: `Gap fix import (${gap.sheet} ligne ${gap.line})`,
        },
      });

      created += 1;
    } catch (error) {
      failed.push(`${gap.sheet}/${gap.ticketNumber}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(JSON.stringify({
    expectedGapRows: gapRows.length,
    created,
    skipped,
    failed: failed.length,
    failedSamples: failed.slice(0, 20),
  }, null, 2));

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
