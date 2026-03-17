import { CommissionCalculationStatus, CommissionMode, PaymentStatus, PrismaClient, SaleNature, TravelClass, type Prisma } from "@prisma/client";
import * as XLSX from "xlsx";

const prisma = new PrismaClient();

type Row = Record<string, unknown>;

type ParsedArgs = {
  filePath: string;
  sheetName?: string;
  dryRun: boolean;
  defaultSellerEmail?: string;
  year: number;
};

type ImportSummary = {
  totalRows: number;
  skippedEmpty: number;
  skippedOutsideRange: number;
  created: number;
  updated: number;
  failed: number;
};

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  const fileArg = args.find((arg) => !arg.startsWith("--"));
  const sheetName = readFlagValue(args, "--sheet");
  const dryRun = args.includes("--dry-run");
  const defaultSellerEmail = readFlagValue(args, "--default-seller-email")?.trim().toLowerCase();
  const yearRaw = readFlagValue(args, "--year");
  const year = yearRaw ? Number.parseInt(yearRaw, 10) : new Date().getFullYear();

  if (!fileArg) {
    throw new Error("Usage: npm run db:import:tickets:excel -- <fichier.xlsx> [--sheet NomFeuille] [--year 2026] [--default-seller-email email@domaine.com] [--dry-run]");
  }

  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    throw new Error("Paramètre --year invalide.");
  }

  return {
    filePath: fileArg,
    sheetName,
    dryRun,
    defaultSellerEmail,
    year,
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
  if (["PAID", "PAYE", "PAYER", "PAYE(E)", "PAYE(E)"].includes(text)) return PaymentStatus.PAID;
  if (["PARTIAL", "PARTIEL", "PARTIELLEMENT PAYE", "PARTIALLY PAID"].includes(text)) return PaymentStatus.PARTIAL;
  return PaymentStatus.UNPAID;
}

function buildRange(year: number) {
  const now = new Date();
  const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
  const yesterday = new Date(now);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const end = new Date(Date.UTC(yesterday.getUTCFullYear(), yesterday.getUTCMonth(), yesterday.getUTCDate(), 23, 59, 59, 999));
  return { start, end };
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

async function main() {
  const args = parseArgs();
  const range = buildRange(args.year);

  const workbook = XLSX.readFile(args.filePath, { cellDates: true });
  const selectedSheet = args.sheetName ?? workbook.SheetNames[0];

  if (!selectedSheet) {
    throw new Error("Aucune feuille trouvée dans le fichier Excel.");
  }

  const sheet = workbook.Sheets[selectedSheet];
  if (!sheet) {
    throw new Error(`Feuille introuvable: ${selectedSheet}`);
  }

  const rows = XLSX.utils.sheet_to_json<Row>(sheet, { defval: null, raw: true });

  const [users, airlines] = await Promise.all([
    prisma.user.findMany({ select: { id: true, email: true, name: true } }),
    prisma.airline.findMany({ select: { id: true, code: true, name: true } }),
  ]);

  const userByEmail = new Map(users.map((user) => [user.email.trim().toLowerCase(), user]));
  const userByName = new Map(users.map((user) => [user.name.trim().toLowerCase(), user]));

  const airlineByCode = new Map(airlines.map((airline) => [airline.code.trim().toUpperCase(), airline]));
  const airlineByName = new Map(airlines.map((airline) => [airline.name.trim().toLowerCase(), airline]));
  const usedAirlineCodes = new Set(airlines.map((airline) => airline.code.trim().toUpperCase()));

  const summary: ImportSummary = {
    totalRows: rows.length,
    skippedEmpty: 0,
    skippedOutsideRange: 0,
    created: 0,
    updated: 0,
    failed: 0,
  };

  const errors: string[] = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const line = index + 2;

    const ticketNumber = asString(pickValue(row, ["ticketNumber", "ticket_number", "pnr", "code billet", "numero billet", "num billet"]));

    if (!ticketNumber) {
      summary.skippedEmpty += 1;
      continue;
    }

    try {
      const soldAtRaw = pickValue(row, ["soldAt", "date vente", "sale date", "date"]);
      const travelDateRaw = pickValue(row, ["travelDate", "date voyage", "departure date", "date depart"]);

      const soldAt = asDate(soldAtRaw) ?? asDate(travelDateRaw) ?? new Date();
      const travelDate = asDate(travelDateRaw) ?? soldAt;

      if (!soldAt || !travelDate) {
        throw new Error("Date de vente ou de voyage invalide.");
      }

      if (soldAt < range.start || soldAt > range.end) {
        summary.skippedOutsideRange += 1;
        continue;
      }

      const customerName = asString(pickValue(row, ["customerName", "customer", "passenger", "nom client", "client", "nom passager"])) ?? "Client non renseigné";
      const route = asString(pickValue(row, ["route", "itineraire", "trajet", "from-to"])) ?? "ROUTE-NR";
      const amount = asNumber(pickValue(row, ["amount", "prix", "montant", "ticket amount"]));
      if (!amount || amount <= 0) {
        throw new Error("Montant billet invalide.");
      }

      const currency = (asString(pickValue(row, ["currency", "devise"])) ?? "USD").toUpperCase();
      const baseFareAmount = asNumber(pickValue(row, ["baseFareAmount", "base fare", "basefare", "tarif de base"]));
      const agencyMarkupAmount = asNumber(pickValue(row, ["agencyMarkupAmount", "majoration", "markup", "majoration agence"])) ?? 0;

      const commissionAmount = asNumber(pickValue(row, ["commissionAmount", "commission", "commission brute"])) ?? 0;
      const commissionRateFromFile = asNumber(pickValue(row, ["commissionRateUsed", "commissionRate", "taux commission"])) ?? null;

      const commissionBaseAmount = baseFareAmount && baseFareAmount > 0 ? baseFareAmount : amount;
      const commissionRateUsed = commissionRateFromFile ?? (commissionBaseAmount > 0 ? (commissionAmount / commissionBaseAmount) * 100 : 0);

      const sellerEmail = asString(pickValue(row, ["sellerEmail", "commercialEmail", "agentEmail", "email vendeur", "email agent"]))?.toLowerCase();
      const sellerName = asString(pickValue(row, ["sellerName", "commercial", "vendeur", "agent", "emetteur"]))?.toLowerCase();
      const defaultSellerEmail = args.defaultSellerEmail?.toLowerCase();

      const seller = (
        (sellerEmail ? userByEmail.get(sellerEmail) : null)
        ?? (sellerName ? userByName.get(sellerName) : null)
        ?? (defaultSellerEmail ? userByEmail.get(defaultSellerEmail) : null)
      );

      if (!seller) {
        throw new Error("Vendeur introuvable. Fournir sellerEmail/sellerName ou --default-seller-email.");
      }

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

      const data: Prisma.TicketSaleUncheckedCreateInput = {
        ticketNumber,
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
        payerName: asString(pickValue(row, ["payerName", "payant", "nom payeur"])),
        agencyMarkupPercent: 0,
        agencyMarkupAmount,
        commissionBaseAmount,
        commissionCalculationStatus: CommissionCalculationStatus.FINAL,
        commissionRateUsed,
        commissionAmount,
        commissionModeApplied: CommissionMode.IMMEDIATE,
        notes: asString(pickValue(row, ["notes", "observation", "commentaire"])),
      };

      const existing = args.dryRun
        ? null
        : await prisma.ticketSale.findUnique({ where: { ticketNumber }, select: { id: true } });

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
      errors.push(`Ligne ${line} (${ticketNumber}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log("Import billets terminé.");
  console.log(`Période traitée: ${range.start.toISOString().slice(0, 10)} -> ${range.end.toISOString().slice(0, 10)}`);
  console.log(`Feuille: ${selectedSheet}`);
  console.log(`Total lignes: ${summary.totalRows}`);
  console.log(`Ignorées (ticket vide): ${summary.skippedEmpty}`);
  console.log(`Ignorées (hors période): ${summary.skippedOutsideRange}`);
  console.log(`Créées: ${summary.created}`);
  console.log(`Mises à jour: ${summary.updated}`);
  console.log(`Échecs: ${summary.failed}`);

  if (errors.length > 0) {
    console.log("--- Détail erreurs ---");
    errors.slice(0, 100).forEach((entry) => console.log(entry));
    if (errors.length > 100) {
      console.log(`... ${errors.length - 100} erreurs supplémentaires`);
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
