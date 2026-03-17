import { CommissionCalculationStatus, CommissionMode, JobTitle, PaymentStatus, PrismaClient, Role, SaleNature, TravelClass, type Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import { hashSync } from "bcryptjs";

const prisma = new PrismaClient();

type Row = Record<string, unknown>;

type ParsedArgs = {
  filePath: string;
  sheetName?: string;
  dryRun: boolean;
  defaultSellerEmail?: string;
  year: number;
  month: number;
  replaceMonth: boolean;
};

type ImportSummary = {
  sheetsProcessed: number;
  totalRows: number;
  skippedEmpty: number;
  skippedOutsideRange: number;
  created: number;
  updated: number;
  failed: number;
};

type Totals = {
  tickets: number;
  amount: number;
  commission: number;
};

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  const fileArg = args.find((arg) => !arg.startsWith("--"));
  const sheetName = readFlagValue(args, "--sheet");
  const dryRun = args.includes("--dry-run");
  const defaultSellerEmail = readFlagValue(args, "--default-seller-email")?.trim().toLowerCase();
  const yearRaw = readFlagValue(args, "--year");
  const monthRaw = readFlagValue(args, "--month");
  const replaceMonth = args.includes("--replace-month");
  const year = yearRaw ? Number.parseInt(yearRaw, 10) : new Date().getFullYear();
  const month = monthRaw ? Number.parseInt(monthRaw, 10) : 1;

  if (!fileArg) {
    throw new Error("Usage: npm run db:import:tickets:excel -- <fichier.xlsx> [--sheet NomFeuille] [--year 2026] [--month 1] [--default-seller-email email@domaine.com] [--replace-month] [--dry-run]");
  }

  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    throw new Error("Paramètre --year invalide.");
  }

  if (!Number.isFinite(month) || month < 1 || month > 12) {
    throw new Error("Paramètre --month invalide (1..12).");
  }

  return {
    filePath: fileArg,
    sheetName,
    dryRun,
    defaultSellerEmail,
    year,
    month,
    replaceMonth,
  };
}

function readFlagValue(args: string[], flag: string) {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function normalizeHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function isLikelyDailySheet(name: string) {
  const clean = name.trim();
  return /^\d{1,2}\.\d{1,2}$/.test(clean) || /^\d{4}$/.test(clean);
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

  const compact = clean.match(/^(\d{2})(\d{2})$/);
  if (compact) {
    const day = Number.parseInt(compact[1], 10);
    const month = Number.parseInt(compact[2], 10);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
    }
  }

  return null;
}

function pickValue(row: Row, headers: string[]) {
  const normalizedKeys = new Map<string, unknown>();
  Object.entries(row).forEach(([key, value]) => {
    normalizedKeys.set(normalizeHeader(key), value);
  });

  for (const header of headers) {
    const found = normalizedKeys.get(normalizeHeader(header));
    if (found !== undefined && found !== null && String(found).trim() !== "") {
      return found;
    }
  }

  return null;
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
  const num = Number.parseFloat(normalized);
  return Number.isFinite(num) ? num : null;
}

function excelSerialToDate(serial: number) {
  const parsed = XLSX.SSF.parse_date_code(serial);
  if (!parsed) return null;
  return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, parsed.S));
}

function asDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number") {
    return excelSerialToDate(value);
  }

  const text = String(value).trim();
  if (!text) return null;

  const direct = new Date(text);
  if (!Number.isNaN(direct.getTime())) return direct;

  const slash = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (slash) {
    const d = Number.parseInt(slash[1], 10);
    const m = Number.parseInt(slash[2], 10);
    const yRaw = Number.parseInt(slash[3], 10);
    const y = yRaw < 100 ? 2000 + yRaw : yRaw;
    return new Date(Date.UTC(y, m - 1, d));
  }

  return null;
}

function parseTravelClass(value: unknown): TravelClass {
  const text = (asString(value) ?? "ECONOMY").toUpperCase();
  if (["ECONOMY", "ECO", "Y"].includes(text)) return TravelClass.ECONOMY;
  if (["PREMIUM_ECONOMY", "PREMIUM", "PREMIUMECONOMY"].includes(text)) return TravelClass.PREMIUM_ECONOMY;
  if (["BUSINESS", "C", "J"].includes(text)) return TravelClass.BUSINESS;
  if (["FIRST", "F"].includes(text)) return TravelClass.FIRST;
  return TravelClass.ECONOMY;
}

function parseSaleNature(value: unknown): SaleNature {
  const text = (asString(value) ?? "CASH")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (["CREDIT", "A CREDIT", "CREDI", "CRED"].includes(text)) return SaleNature.CREDIT;
  return SaleNature.CASH;
}

function parsePaymentStatus(value: unknown): PaymentStatus {
  const text = (asString(value) ?? "UNPAID")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (["PAID", "PAYE", "PAYER", "PAYE(E)", "PAIE"].includes(text)) return PaymentStatus.PAID;
  if (["PARTIAL", "PARTIEL", "PARTIELLEMENT PAYE", "PARTIALLY PAID"].includes(text)) return PaymentStatus.PARTIAL;
  if (["0", "NON PAYE", "IMPAYE", "UNPAID"].includes(text)) return PaymentStatus.UNPAID;
  return PaymentStatus.UNPAID;
}

function buildRange(year: number, month: number) {
  const now = new Date();
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const endOfMonth = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

  const yesterday = new Date(now);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayEnd = new Date(Date.UTC(yesterday.getUTCFullYear(), yesterday.getUTCMonth(), yesterday.getUTCDate(), 23, 59, 59, 999));
  const end = endOfMonth < yesterdayEnd ? endOfMonth : yesterdayEnd;

  return { start, end };
}

function normalizePersonKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
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

function mapPayerToAgency(value: string | null) {
  const text = (value ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (text.includes("mbujimayi") || text.includes("mbuji mayi") || text.includes("mbuji-mayi")) {
    return "Agence MBUJIMAYI";
  }
  if (text.includes("lubumbashi")) {
    return "Agence LUBUMBASHI";
  }
  return "Agence de Kinshasa (Direction générale)";
}

function readSheetRows(sheet: XLSX.WorkSheet) {
  return XLSX.utils.sheet_to_json<Array<unknown>>(sheet, { header: 1, raw: true, defval: null });
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function extractTotalsFromSummarySheet(sheet: XLSX.WorkSheet): Totals | null {
  const rows = readSheetRows(sheet);
  if (!rows.length) return null;

  let headerIndex = -1;
  for (let i = 0; i < Math.min(rows.length, 12); i += 1) {
    const row = rows[i] ?? [];
    const normalized = row.map((cell) => normalizeHeader(String(cell ?? "")));
    const hasTickets = normalized.some((value) => value === "billets" || value.includes("billets"));
    const hasAmount = normalized.some((value) => value === "montants" || value === "totaux" || value.includes("montant"));
    const hasCommission = normalized.some((value) => value.includes("commission"));
    if (hasTickets && hasAmount && hasCommission) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) return null;

  const header = rows[headerIndex] ?? [];
  const normalizedHeader = header.map((cell) => normalizeHeader(String(cell ?? "")));

  const ticketsCol = normalizedHeader.findIndex((value) => value === "billets" || value.includes("billets"));
  const amountCol = normalizedHeader.findIndex((value) => value === "montants" || value === "totaux" || value.includes("montant"));
  const commissionCol = normalizedHeader.findIndex((value) => value.includes("commission"));

  if (ticketsCol < 0 || amountCol < 0 || commissionCol < 0) return null;

  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const row = rows[i] ?? [];
    const firstText = String(row[0] ?? row[1] ?? "").toUpperCase();
    if (!firstText.includes("TOTAL")) continue;

    const tickets = asNumber(row[ticketsCol]) ?? 0;
    const amount = asNumber(row[amountCol]) ?? 0;
    const commission = asNumber(row[commissionCol]) ?? 0;
    return {
      tickets,
      amount: round2(amount),
      commission: round2(commission),
    };
  }

  return null;
}

function toRowsFromMatrix(sheet: XLSX.WorkSheet): Row[] {
  const matrix = XLSX.utils.sheet_to_json<Array<unknown>>(sheet, { header: 1, raw: true, defval: null });
  if (!matrix.length) return [];

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
    return XLSX.utils.sheet_to_json<Row>(sheet, { defval: null, raw: true });
  }

  const headerRow = matrix[headerRowIndex] ?? [];
  const headers = headerRow.map((cell, index) => {
    const txt = asString(cell);
    return txt ?? `col_${index}`;
  });

  const out: Row[] = [];
  for (let i = headerRowIndex + 1; i < matrix.length; i += 1) {
    const row = matrix[i] ?? [];
    const obj: Row = {};
    let hasAny = false;

    headers.forEach((header, index) => {
      const value = row[index] ?? null;
      obj[header] = value;
      if (!hasAny && asString(value)) {
        hasAny = true;
      }
    });

    if (hasAny) {
      out.push(obj);
    }
  }

  return out;
}

async function main() {
  const args = parseArgs();
  const range = buildRange(args.year, args.month);

  const workbook = XLSX.readFile(args.filePath, { cellDates: true });
  const sheetNames = args.sheetName
    ? [args.sheetName]
    : workbook.SheetNames.filter((name) => isLikelyDailySheet(name));

  if (!sheetNames.length) {
    throw new Error("Aucune feuille journalière détectée. Utilisez --sheet si nécessaire.");
  }

  const [users, airlines, ticketCounts] = await Promise.all([
    prisma.user.findMany({ select: { id: true, email: true, name: true } }),
    prisma.airline.findMany({ select: { id: true, code: true, name: true } }),
    prisma.ticketSale.groupBy({ by: ["airlineId"], _count: { _all: true } }),
  ]);

  const userByEmail = new Map(users.map((user) => [user.email.trim().toLowerCase(), user]));
  const userByName = new Map(users.map((user) => [normalizePersonKey(user.name), user]));
  const usedEmails = new Set(users.map((user) => user.email.trim().toLowerCase()));

  const airlineByCode = new Map(airlines.map((airline) => [airline.code.trim().toUpperCase(), airline]));
  const airlineByName = new Map(airlines.map((airline) => [airline.name.trim().toLowerCase(), airline]));
  const usedAirlineCodes = new Set(airlines.map((airline) => airline.code.trim().toUpperCase()));
  const ticketCountByAirlineId = new Map(ticketCounts.map((entry) => [entry.airlineId, entry._count._all]));

  const summary: ImportSummary = {
    sheetsProcessed: 0,
    totalRows: 0,
    skippedEmpty: 0,
    skippedOutsideRange: 0,
    created: 0,
    updated: 0,
    failed: 0,
  };

  const errors: string[] = [];
  const januaryDailyTotals: Totals = { tickets: 0, amount: 0, commission: 0 };
  const pnrSequence = new Map<string, number>();

  if (args.replaceMonth && !args.dryRun) {
    const existingMonthTickets = await prisma.ticketSale.findMany({
      where: { soldAt: { gte: range.start, lte: range.end } },
      select: { id: true },
    });
    const ticketIds = existingMonthTickets.map((ticket) => ticket.id);

    if (ticketIds.length > 0) {
      await prisma.payment.deleteMany({ where: { ticketId: { in: ticketIds } } });
      await prisma.ticketSale.deleteMany({ where: { id: { in: ticketIds } } });
    }
  }

  async function resolveSeller(input: { sellerEmail: string | null; sellerName: string | null }) {
    const sellerEmail = input.sellerEmail?.trim().toLowerCase() ?? null;
    const sellerName = input.sellerName?.trim() ?? null;

    if (sellerEmail && userByEmail.has(sellerEmail)) {
      return userByEmail.get(sellerEmail)!;
    }

    if (sellerName) {
      const key = normalizePersonKey(sellerName);
      if (userByName.has(key)) {
        return userByName.get(key)!;
      }
    }

    const fallbackEmail = args.defaultSellerEmail?.toLowerCase();
    if (fallbackEmail && userByEmail.has(fallbackEmail)) {
      return userByEmail.get(fallbackEmail)!;
    }

    if (!sellerName) {
      throw new Error("Émetteur/vendeur absent.");
    }

    const sellerKey = normalizePersonKey(sellerName);
    const slugBase = slugifyName(sellerName);
    let email = `import.${slugBase}@thebest.local`;
    let suffix = 1;
    while (usedEmails.has(email)) {
      email = `import.${slugBase}.${suffix}@thebest.local`;
      suffix += 1;
    }

    if (args.dryRun) {
      const drySeller = {
        id: `dry-seller-${slugBase}`,
        email,
        name: sellerName,
      };
      userByEmail.set(email, drySeller);
      userByName.set(sellerKey, drySeller);
      usedEmails.add(email);
      return drySeller;
    }

    const created = await prisma.user.create({
      data: {
        name: sellerName,
        email,
        passwordHash: hashSync("ImportTemp#2026", 10),
        role: Role.EMPLOYEE,
        jobTitle: JobTitle.COMMERCIAL,
      },
      select: { id: true, email: true, name: true },
    });

    userByEmail.set(created.email.toLowerCase(), created);
    userByName.set(sellerKey, created);
    usedEmails.add(created.email.toLowerCase());
    return created;
  }

  for (const sheetName of sheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const rows = toRowsFromMatrix(sheet);
    const sheetDate = parseSheetDateFromName(sheetName, args.year);
    summary.sheetsProcessed += 1;

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      summary.totalRows += 1;
      const line = index + 2;

      const ticketNumber = asString(pickValue(row, ["ticketNumber", "ticket_number", "pnr", "code billet", "numero billet", "num billet", "PNR"]));

      if (!ticketNumber || ticketNumber.toUpperCase() === "PNR") {
        summary.skippedEmpty += 1;
        continue;
      }

      try {
        const soldAtRaw = pickValue(row, ["soldAt", "date vente", "sale date", "date"]);
        const travelDateRaw = pickValue(row, ["travelDate", "date voyage", "departure date", "date depart"]);

        const soldAt = sheetDate ?? asDate(soldAtRaw) ?? asDate(travelDateRaw) ?? new Date();
        const travelDate = asDate(travelDateRaw) ?? soldAt;

        if (!soldAt || !travelDate) {
          throw new Error("Date de vente ou de voyage invalide.");
        }

        if (soldAt < range.start || soldAt > range.end) {
          summary.skippedOutsideRange += 1;
          continue;
        }

        const customerName = asString(pickValue(row, ["customerName", "customer", "passenger", "nom client", "client", "nom passager", "beneficiare", "beneficiaire"])) ?? "Client non renseigné";
        const route = asString(pickValue(row, ["route", "itineraire", "trajet", "from-to", "itineriaire", "itinerare"])) ?? "ROUTE-NR";
        const amount = asNumber(pickValue(row, ["amount", "prix", "montant", "ticket amount"]));
        if (!amount || amount <= 0) {
          throw new Error("Montant billet invalide.");
        }

        const currency = (asString(pickValue(row, ["currency", "devise"])) ?? "USD").toUpperCase();
        const baseFareAmount = asNumber(pickValue(row, ["baseFareAmount", "base fare", "basefare", "tarif de base"]));
        const agencyMarkupAmount = asNumber(pickValue(row, ["agencyMarkupAmount", "majoration", "markup", "majoration agence"])) ?? 0;

        const commissionAmountFromFile = asNumber(pickValue(row, ["commissionAmount", "commission", "commission brute", "com", "comission", "commission mensuelle", "commission hebdo"])) ?? 0;
        const commissionRateFromFile = asNumber(pickValue(row, ["commissionRateUsed", "commissionRate", "taux commission"])) ?? null;

        const commissionBaseAmount = baseFareAmount && baseFareAmount > 0 ? baseFareAmount : amount;

        const sellerEmail = asString(pickValue(row, ["sellerEmail", "commercialEmail", "agentEmail", "email vendeur", "email agent"]));
        const sellerName = asString(pickValue(row, ["sellerName", "commercial", "vendeur", "agent", "emeteur", "emetteur", "emetteur/emitteur", "emitteur"]));
        const seller = await resolveSeller({ sellerEmail, sellerName });

        const airlineCodeRaw = asString(pickValue(row, ["airlineCode", "compagnieCode", "code compagnie", "code"]));
        const airlineNameRaw = asString(pickValue(row, ["airlineName", "compagnie", "airline"])) ?? "Compagnie inconnue";
        const airlineCode = airlineCodeRaw?.toUpperCase() ?? null;

        let airline = airlineCode ? airlineByCode.get(airlineCode) : null;
        if (!airline && airlineNameRaw) {
          airline = airlineByName.get(airlineNameRaw.toLowerCase()) ?? null;
        }

        if (!airline) {
          const code = airlineCode ?? makeAirlineCode(airlineNameRaw, usedAirlineCodes);
          const createdAirline = args.dryRun
            ? { id: `dry-${code}`, code, name: airlineNameRaw }
            : await prisma.airline.upsert({
              where: { code },
              update: { name: airlineNameRaw },
              create: { code, name: airlineNameRaw },
              select: { id: true, code: true, name: true },
            });

          airline = createdAirline;
          airlineByCode.set(createdAirline.code.toUpperCase(), createdAirline);
          airlineByName.set(createdAirline.name.toLowerCase(), createdAirline);
        }

        let commissionAmount = commissionAmountFromFile;
        let commissionRateUsed = commissionRateFromFile ?? (commissionBaseAmount > 0 ? (commissionAmount / commissionBaseAmount) * 100 : 0);

        if (isCaaLike(airline)) {
          commissionAmount = commissionBaseAmount * 0.05;
          commissionRateUsed = 5;
        } else if (isAirFastLike(airline)) {
          const nextAirfastTicketNumber = (ticketCountByAirlineId.get(airline.id) ?? 0) + 1;
          ticketCountByAirlineId.set(airline.id, nextAirfastTicketNumber);
          commissionAmount = nextAirfastTicketNumber % 13 === 0 ? amount : 0;
          commissionRateUsed = nextAirfastTicketNumber % 13 === 0 ? 100 : 0;
        }

        const seen = (pnrSequence.get(ticketNumber) ?? 0) + 1;
        pnrSequence.set(ticketNumber, seen);
        const normalizedTicketNumber = seen === 1 ? ticketNumber : `${ticketNumber}-R${seen}`;

        const data: Prisma.TicketSaleUncheckedCreateInput = {
          ticketNumber: normalizedTicketNumber,
          customerName,
          route,
          travelClass: parseTravelClass(pickValue(row, ["travelClass", "classe", "class"])),
          travelDate,
          soldAt,
          amount,
          baseFareAmount,
          currency,
          airlineId: airline.id,
          sellerId: seller.id,
          saleNature: parseSaleNature(pickValue(row, ["saleNature", "nature vente", "nature"])),
          paymentStatus: parsePaymentStatus(pickValue(row, ["paymentStatus", "statut paiement", "statut", "etat paiement"])),
          payerName: mapPayerToAgency(asString(pickValue(row, ["payerName", "payant", "nom payeur"]))),
          agencyMarkupPercent: 0,
          agencyMarkupAmount,
          commissionBaseAmount,
          commissionCalculationStatus: CommissionCalculationStatus.FINAL,
          commissionRateUsed,
          commissionAmount,
          commissionModeApplied: CommissionMode.IMMEDIATE,
          notes: [
            asString(pickValue(row, ["notes", "observation", "commentaire"])),
            seen > 1 ? `PNR source: ${ticketNumber}` : null,
          ].filter(Boolean).join(" | ") || null,
        };

        const existing = args.dryRun
          ? null
          : await prisma.ticketSale.findUnique({ where: { ticketNumber: normalizedTicketNumber }, select: { id: true } });

        januaryDailyTotals.tickets += 1;
        januaryDailyTotals.amount = round2(januaryDailyTotals.amount + amount);
        januaryDailyTotals.commission = round2(januaryDailyTotals.commission + commissionAmount);

        if (args.dryRun) {
          summary.created += 1;
        } else {
          await prisma.ticketSale.upsert({
            where: { ticketNumber },
            update: data,
            create: data,
          });
          if (existing) {
            summary.updated += 1;
          } else {
            summary.created += 1;
          }
        }
      } catch (error) {
        summary.failed += 1;
        errors.push(`[${sheetName}] Ligne ${line} (${ticketNumber}): ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  console.log("Import billets terminé.");
  console.log(`Période traitée: ${range.start.toISOString().slice(0, 10)} -> ${range.end.toISOString().slice(0, 10)}`);
  console.log(`Feuilles traitées: ${summary.sheetsProcessed}`);
  console.log(`Total lignes: ${summary.totalRows}`);
  console.log(`Ignorées (ticket vide): ${summary.skippedEmpty}`);
  console.log(`Ignorées (hors période): ${summary.skippedOutsideRange}`);
  console.log(`Créées: ${summary.created}`);
  console.log(`Mises à jour: ${summary.updated}`);
  console.log(`Échecs: ${summary.failed}`);

  const weeklySheets = workbook.SheetNames.filter((name) => /semaine/i.test(name) && /jan/i.test(name));
  const weeklyTotals = weeklySheets
    .map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) return null;
      const totals = extractTotalsFromSummarySheet(sheet);
      if (!totals) return null;
      return { sheetName, totals };
    })
    .filter((entry): entry is { sheetName: string; totals: Totals } => Boolean(entry));

  const weeklyAggregate: Totals = weeklyTotals.reduce(
    (acc, entry) => ({
      tickets: acc.tickets + entry.totals.tickets,
      amount: round2(acc.amount + entry.totals.amount),
      commission: round2(acc.commission + entry.totals.commission),
    }),
    { tickets: 0, amount: 0, commission: 0 },
  );

  const monthlySheetName = workbook.SheetNames.find((name) => normalizeHeader(name).includes("rapportjanvier"));
  const monthlyTotals = monthlySheetName
    ? extractTotalsFromSummarySheet(workbook.Sheets[monthlySheetName])
    : null;

  const weeklyVsDailyOk =
    weeklyAggregate.tickets === januaryDailyTotals.tickets
    && round2(weeklyAggregate.amount) === round2(januaryDailyTotals.amount)
    && round2(weeklyAggregate.commission) === round2(januaryDailyTotals.commission);

  const monthlyVsDailyOk = monthlyTotals
    ? (
      monthlyTotals.tickets === januaryDailyTotals.tickets
      && round2(monthlyTotals.amount) === round2(januaryDailyTotals.amount)
      && round2(monthlyTotals.commission) === round2(januaryDailyTotals.commission)
    )
    : false;

  console.log("--- Contrôle de concordance Janvier ---");
  console.log(`Cumul journalier importé: billets=${januaryDailyTotals.tickets}, montant=${januaryDailyTotals.amount}, commission=${januaryDailyTotals.commission}`);
  console.log(`Cumul feuilles hebdo: billets=${weeklyAggregate.tickets}, montant=${weeklyAggregate.amount}, commission=${weeklyAggregate.commission}`);
  if (monthlyTotals) {
    console.log(`Total feuille mensuelle (${monthlySheetName}): billets=${monthlyTotals.tickets}, montant=${monthlyTotals.amount}, commission=${monthlyTotals.commission}`);
  } else {
    console.log("Total feuille mensuelle: introuvable");
  }
  console.log(`Hebdo vs journalier: ${weeklyVsDailyOk ? "OK" : "ECART"}`);
  console.log(`Mensuel vs journalier: ${monthlyVsDailyOk ? "OK" : "ECART"}`);

  if (errors.length > 0) {
    console.log("--- Détail erreurs ---");
    errors.slice(0, 150).forEach((entry) => console.log(entry));
    if (errors.length > 150) {
      console.log(`... ${errors.length - 150} erreurs supplémentaires`);
    }
  }

  if (args.dryRun) {
    console.log("Mode dry-run: aucune donnée écrite en base.");
  }
}

main()
  .catch((error) => {
    console.error("Import billets échoué", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
