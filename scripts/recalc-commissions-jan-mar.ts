/**
 * Recalcul des commissions billets Janvier-Mars 2026
 * =====================================================
 * Règles appliquées :
 *  - Autres compagnies (hors CAA, hors Air Fast) :
 *      Lire la colonne "commission" du fichier Excel correspondant au mois,
 *      puis mettre à jour commissionAmount en base. Si aucun fichier Excel
 *      n'est fourni pour un mois donné, la valeur DB actuelle est conservée.
 *  - CAA (Air Congo, code ACG/CAA) :
 *      Politique AFTER_DEPOSIT — batch commission calculée sur le cumul
 *      historique de tous les billets CAA jusqu'à fin mars 2026.
 *  - Air Fast (FST) :
 *      1 billet gratuit offert tous les 13 billets (numéro séquentiel
 *      calculé sur l'historique complet Air Fast, tous temps confondus).
 *
 * Usage :
 *   npx ts-node scripts/recalc-commissions-jan-mar.ts \
 *     [--year 2026] \
 *     [--jan  fichier_janvier.xlsx] \
 *     [--feb  fichier_fevrier.xlsx] \
 *     [--mar  fichier_mars.xlsx]    \
 *     [--dry-run]
 *
 * Notes :
 *  - Sans --dry-run, les mises à jour sont appliquées en production.
 *  - Les fichiers Excel doivent avoir la même structure que ceux utilisés
 *    lors de l'import (colonne PNR + colonne commission).
 *  - Un rapport de différences est affiché avant toute écriture.
 */

import { CommissionCalculationStatus, CommissionMode, PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";

const prisma = new PrismaClient();

// ─── Types ──────────────────────────────────────────────────────────────────

type ParsedArgs = {
  year: number;
  dryRun: boolean;
  excelByMonth: Map<number, string>; // month (1=jan…12=dec) → fichier path
};

type TicketUpdate = {
  id: string;
  ticketNumber: string;
  airlineCode: string;
  soldAt: Date;
  amount: number;
  oldCommissionAmount: number;
  newCommissionAmount: number;
  oldMode: string;
  newMode: CommissionMode;
  oldStatus: string;
  newStatus: CommissionCalculationStatus;
  reason: string;
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function normalizeHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function asString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function asNumber(value: unknown): number | null {
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

function isLikelyDailySheet(name: string) {
  const clean = name.trim();
  return /^\d{1,2}[.,]\d{1,2}$/.test(clean) || /^\d{4}$/.test(clean);
}

function pickValue(row: Record<string, unknown>, headers: string[]) {
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

function toRowsFromMatrix(sheet: XLSX.WorkSheet): Record<string, unknown>[] {
  const matrix = XLSX.utils.sheet_to_json<Array<unknown>>(sheet, { header: 1, raw: true, defval: null });
  if (!matrix.length) return [];

  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(matrix.length, 8); i += 1) {
    const row = matrix[i] ?? [];
    const normalized = row.map((cell) => normalizeHeader(String(cell ?? "")));
    if (normalized.includes("pnr") && normalized.some((n) => n.startsWith("emeteur") || n.startsWith("emetteur")) && normalized.includes("montant")) {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex === -1) {
    return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: true });
  }

  const headerRow = matrix[headerRowIndex] ?? [];
  const headers = headerRow.map((cell, index) => {
    const txt = asString(cell);
    return txt ?? `col_${index}`;
  });

  const out: Record<string, unknown>[] = [];
  for (let i = headerRowIndex + 1; i < matrix.length; i += 1) {
    const row = matrix[i] ?? [];
    const obj: Record<string, unknown> = {};
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

// ─── Identification compagnies ───────────────────────────────────────────────

function isCaaCode(code: string) {
  const normalized = code.trim().toUpperCase();
  return normalized === "CAA" || normalized === "ACG";
}

function isAirFastCode(code: string) {
  const normalized = code.trim().toUpperCase();
  return normalized === "FST" || normalized === "AI1";
}

// ─── Lecture Excel → map PNR → commission ────────────────────────────────────

function buildExcelCommissionMap(filePath: string): Map<string, number> {
  const map = new Map<string, number>();

  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheetNames = workbook.SheetNames.filter((name) => isLikelyDailySheet(name));

  if (!sheetNames.length) {
    // Tenter toutes les feuilles si aucune feuille journalière détectée
    console.warn(`  [Excel] Aucune feuille journalière détectée dans ${filePath}, on lit toutes les feuilles.`);
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      processSheet(sheet, map);
    }
    return map;
  }

  for (const sheetName of sheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    processSheet(sheet, map);
  }

  return map;
}

function processSheet(sheet: XLSX.WorkSheet, map: Map<string, number>) {
  const rows = toRowsFromMatrix(sheet);
  for (const row of rows) {
    const pnr = asString(pickValue(row, [
      "ticketNumber", "ticket_number", "pnr", "code billet",
      "numero billet", "num billet", "PNR",
    ]));
    if (!pnr || pnr.toUpperCase() === "PNR") continue;

    const commission = asNumber(pickValue(row, [
      "commissionAmount", "commission", "commission brute", "com",
      "comission", "commission mensuelle", "commission hebdo",
    ]));

    if (commission !== null && commission >= 0) {
      // En cas de doublon PNR dans le fichier Excel, on prend la première valeur non-nulle
      if (!map.has(pnr) || (map.get(pnr) === 0 && commission > 0)) {
        map.set(pnr, round2(commission));
      }
    }
  }
}

// ─── CAA — politique AFTER_DEPOSIT ────────────────────────────────────────────

function computeCaaCommissionMap(params: {
  periodTicketIds: Set<string>;
  orderedCaaTicketsUntilPeriodEnd: Array<{ id: string; soldAt: Date; amount: number }>;
  targetAmount: number;
  batchCommissionAmount: number;
}) {
  const resultMap = new Map<string, number>();
  if (params.targetAmount <= 0 || params.batchCommissionAmount <= 0 || params.periodTicketIds.size === 0) {
    return resultMap;
  }

  const ordered = [...params.orderedCaaTicketsUntilPeriodEnd].sort((a, b) => {
    const diff = a.soldAt.getTime() - b.soldAt.getTime();
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });

  let consumed = 0;
  for (const ticket of ordered) {
    const before = consumed;
    consumed += ticket.amount;

    if (!params.periodTicketIds.has(ticket.id)) continue;

    const batchesBefore = Math.floor(before / params.targetAmount);
    const batchesAfter = Math.floor(consumed / params.targetAmount);
    const newBatches = Math.max(0, batchesAfter - batchesBefore);
    resultMap.set(ticket.id, round2(newBatches * params.batchCommissionAmount));
  }

  return resultMap;
}

// ─── Air Fast — politique 13ème billet ────────────────────────────────────────

function computeAirFastCommissionMap(
  allAirFastTickets: Array<{ id: string; soldAt: Date; amount: number }>,
  periodTicketIds: Set<string>,
): Map<string, number> {
  const map = new Map<string, number>();
  const ordered = [...allAirFastTickets].sort((a, b) => {
    const diff = a.soldAt.getTime() - b.soldAt.getTime();
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });

  for (let i = 0; i < ordered.length; i += 1) {
    const ticket = ordered[i];
    if (!periodTicketIds.has(ticket.id)) continue;

    const seqNumber = i + 1; // 1-based global position
    const commission = seqNumber % 13 === 0 ? ticket.amount : 0;
    map.set(ticket.id, round2(commission));
  }

  return map;
}

// ─── Parse args ──────────────────────────────────────────────────────────────

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);

  function readFlagValue(flag: string): string | undefined {
    const index = args.indexOf(flag);
    if (index === -1) return undefined;
    return args[index + 1];
  }

  const yearRaw = readFlagValue("--year");
  const year = yearRaw ? Number.parseInt(yearRaw, 10) : 2026;

  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    throw new Error("--year invalide.");
  }

  const dryRun = args.includes("--dry-run");

  const excelByMonth = new Map<number, string>();
  const janFile = readFlagValue("--jan");
  const febFile = readFlagValue("--feb");
  const marFile = readFlagValue("--mar");
  if (janFile) excelByMonth.set(1, janFile);
  if (febFile) excelByMonth.set(2, febFile);
  if (marFile) excelByMonth.set(3, marFile);

  return { year, dryRun, excelByMonth };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { year, dryRun, excelByMonth } = parseArgs();

  const periodStart = new Date(Date.UTC(year, 0, 1));           // 1er Janvier
  const periodEnd   = new Date(Date.UTC(year, 2, 31, 23, 59, 59, 999)); // 31 Mars fin de journée

  console.log(`\n═══════════════════════════════════════════════════════════`);
  console.log(`  Recalcul commissions billets ${year}: Jan → Mars`);
  console.log(`  Mode: ${dryRun ? "DRY-RUN (aucune écriture)" : "PRODUCTION"}`);
  console.log(`  Fichiers Excel fournis: ${excelByMonth.size > 0 ? [...excelByMonth.entries()].map(([m, f]) => `mois ${m}=${f}`).join(", ") : "aucun"}`);
  console.log(`═══════════════════════════════════════════════════════════\n`);

  // ── 1. Lire les fichiers Excel ───────────────────────────────────────────
  const excelCommissionByMonth = new Map<number, Map<string, number>>();
  for (const [month, filePath] of excelByMonth.entries()) {
    console.log(`[Excel] Lecture du fichier mois ${month}: ${filePath}`);
    const commissionMap = buildExcelCommissionMap(filePath);
    excelCommissionByMonth.set(month, commissionMap);
    console.log(`  → ${commissionMap.size} PNR trouvés avec commission dans ce fichier`);
  }

  // ── 2. Charger les billets Janv-Mars depuis la DB ───────────────────────
  const ticketsInPeriod = await prisma.ticketSale.findMany({
    where: {
      soldAt: { gte: periodStart, lte: periodEnd },
    },
    include: {
      airline: { select: { id: true, code: true, name: true } },
    },
    orderBy: [{ soldAt: "asc" }, { id: "asc" }],
  });

  console.log(`[DB] ${ticketsInPeriod.length} billet(s) trouvé(s) sur la période Jan-Mars ${year}`);

  // ── 3. Charger les règles de commission CAA ──────────────────────────────
  const caaAirline = await prisma.airline.findFirst({
    where: { code: { in: ["CAA", "ACG"] } },
    include: {
      commissionRules: {
        where: { isActive: true, commissionMode: "AFTER_DEPOSIT" },
        orderBy: { startsAt: "desc" },
      },
    },
  });

  const caaRule = caaAirline?.commissionRules[0] ?? null;
  const caaTargetAmount = caaRule?.depositStockTargetAmount ?? 0;
  const caaBatchCommission = caaRule?.batchCommissionAmount ?? 0;

  console.log(`[CAA] Règle active: cible=${caaTargetAmount} USD, commission par batch=${caaBatchCommission} USD`);
  if (!caaRule) {
    console.warn("  ⚠ Aucune règle AFTER_DEPOSIT active pour CAA — les billets CAA seront marqués AFTER_DEPOSIT avec commission 0.");
  }

  // ── 4. Historique ALL CAA tickets jusqu'à fin Mars ────────────────────────
  const allCaaTickets = caaAirline
    ? await prisma.ticketSale.findMany({
        where: {
          airlineId: caaAirline.id,
          soldAt: { lte: periodEnd },
        },
        select: { id: true, soldAt: true, amount: true },
        orderBy: [{ soldAt: "asc" }, { id: "asc" }],
      })
    : [];

  const caaTicketsInPeriod = ticketsInPeriod.filter((t) => isCaaCode(t.airline.code));
  const caaCommissionMap = computeCaaCommissionMap({
    periodTicketIds: new Set(caaTicketsInPeriod.map((t) => t.id)),
    orderedCaaTicketsUntilPeriodEnd: allCaaTickets,
    targetAmount: caaTargetAmount,
    batchCommissionAmount: caaBatchCommission,
  });

  // ── 5. Historique ALL Air Fast tickets ────────────────────────────────────
  const airFastAirline = await prisma.airline.findFirst({
    where: { code: { in: ["FST", "AI1"] } },
  });

  const allAirFastTickets = airFastAirline
    ? await prisma.ticketSale.findMany({
        where: { airlineId: airFastAirline.id },
        select: { id: true, soldAt: true, amount: true },
        orderBy: [{ soldAt: "asc" }, { id: "asc" }],
      })
    : [];

  const airFastTicketsInPeriod = ticketsInPeriod.filter((t) => isAirFastCode(t.airline.code));
  const airFastCommissionMap = computeAirFastCommissionMap(
    allAirFastTickets,
    new Set(airFastTicketsInPeriod.map((t) => t.id)),
  );

  console.log(`[CAA] ${caaTicketsInPeriod.length} billets CAA sur la période → ${caaCommissionMap.size} avec commission batch`);
  console.log(`[AIR FAST] ${airFastTicketsInPeriod.length} billets Air Fast sur la période → ${airFastCommissionMap.size} avec commission (13ème billet)`);

  // ── 6. Calculer les mises à jour ──────────────────────────────────────────
  const updates: TicketUpdate[] = [];
  let unchangedCount = 0;

  for (const ticket of ticketsInPeriod) {
    const month = ticket.soldAt.getUTCMonth() + 1;

    let newCommission: number;
    let newMode: CommissionMode;
    let reason: string;

    if (isCaaCode(ticket.airline.code)) {
      // CAA: politique AFTER_DEPOSIT
      newCommission = caaCommissionMap.get(ticket.id) ?? 0;
      newMode = CommissionMode.AFTER_DEPOSIT;
      reason = `CAA AFTER_DEPOSIT batch — cumul historique (cible=${caaTargetAmount} USD, batch=${caaBatchCommission} USD)`;
    } else if (isAirFastCode(ticket.airline.code)) {
      // Air Fast: 13ème billet = commission pleine
      newCommission = airFastCommissionMap.get(ticket.id) ?? 0;
      newMode = CommissionMode.IMMEDIATE;
      reason = newCommission > 0
        ? `Air Fast: 13ème billet (commission = ${newCommission.toFixed(2)} ${ticket.currency})`
        : "Air Fast: billet ordinaire (position non-multiple de 13)";
    } else {
      // Autres compagnies: lire depuis Excel du mois ou garder valeur DB
      const excelMap = excelCommissionByMonth.get(month);
      if (excelMap) {
        const excelCommission = excelMap.get(ticket.ticketNumber) ?? null;
        if (excelCommission !== null) {
          newCommission = excelCommission;
          reason = `Commission lue depuis Excel (mois ${month})`;
        } else {
          // PNR non trouvé dans l'Excel → garder valeur actuelle
          newCommission = ticket.commissionAmount;
          reason = `PNR non trouvé dans Excel mois ${month} — valeur DB conservée`;
        }
      } else {
        // Pas de fichier Excel fourni pour ce mois → garder valeur DB
        newCommission = ticket.commissionAmount;
        reason = `Pas de fichier Excel mois ${month} — valeur DB conservée`;
      }
      newMode = CommissionMode.IMMEDIATE;
    }

    const roundedNew = round2(newCommission);
    const hasChanged =
      Math.abs(ticket.commissionAmount - roundedNew) > 0.001
      || ticket.commissionModeApplied !== newMode
      || ticket.commissionCalculationStatus === "ESTIMATED";

    if (!hasChanged) {
      unchangedCount += 1;
      continue;
    }

    updates.push({
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      airlineCode: ticket.airline.code,
      soldAt: ticket.soldAt,
      amount: ticket.amount,
      oldCommissionAmount: ticket.commissionAmount,
      newCommissionAmount: roundedNew,
      oldMode: ticket.commissionModeApplied,
      newMode,
      oldStatus: ticket.commissionCalculationStatus,
      newStatus: CommissionCalculationStatus.FINAL,
      reason,
    });
  }

  // ── 7. Rapport ────────────────────────────────────────────────────────────
  console.log(`\n─── Rapport des changements ────────────────────────────────`);
  console.log(`  Billets analysés    : ${ticketsInPeriod.length}`);
  console.log(`  Sans changement     : ${unchangedCount}`);
  console.log(`  À mettre à jour     : ${updates.length}`);

  if (updates.length > 0) {
    // Grouper par compagnie pour le résumé
    const byAirline = new Map<string, { count: number; oldTotal: number; newTotal: number }>();
    for (const update of updates) {
      const current = byAirline.get(update.airlineCode) ?? { count: 0, oldTotal: 0, newTotal: 0 };
      current.count += 1;
      current.oldTotal += update.oldCommissionAmount;
      current.newTotal += update.newCommissionAmount;
      byAirline.set(update.airlineCode, current);
    }

    console.log(`\n  Résumé par compagnie:`);
    for (const [code, stats] of [...byAirline.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const diff = round2(stats.newTotal - stats.oldTotal);
      const sign = diff >= 0 ? "+" : "";
      console.log(`    ${code.padEnd(8)} ${stats.count} billets | ancienne commission totale: ${round2(stats.oldTotal).toFixed(2)} → nouvelle: ${round2(stats.newTotal).toFixed(2)} (${sign}${diff.toFixed(2)})`);
    }

    console.log(`\n  Détail des modifications (max 100 lignes):`);
    const sample = updates.slice(0, 100);
    for (const update of sample) {
      const dateStr = update.soldAt.toISOString().slice(0, 10);
      const modeChange = update.oldMode !== update.newMode ? ` | mode: ${update.oldMode}→${update.newMode}` : "";
      const statusChange = update.oldStatus !== update.newStatus ? ` | status: ${update.oldStatus}→${update.newStatus}` : "";
      console.log(
        `    [${dateStr}] ${update.ticketNumber.padEnd(14)} ${update.airlineCode.padEnd(6)}`
        + ` com: ${update.oldCommissionAmount.toFixed(2)}→${update.newCommissionAmount.toFixed(2)}`
        + modeChange + statusChange
        + ` | ${update.reason}`,
      );
    }
    if (updates.length > 100) {
      console.log(`    ... ${updates.length - 100} lignes supplémentaires omises du détail`);
    }
  }

  // ── 8. Appliquer les mises à jour ─────────────────────────────────────────
  if (dryRun) {
    console.log(`\n[DRY-RUN] Aucune modification appliquée.`);
    console.log(`Relancez sans --dry-run pour appliquer les ${updates.length} mise(s) à jour.\n`);
    return;
  }

  if (updates.length === 0) {
    console.log(`\nAucune mise à jour nécessaire.\n`);
    return;
  }

  console.log(`\n[DB] Application des ${updates.length} mise(s) à jour…`);
  let applied = 0;
  let failed = 0;

  // Traitement par batch de 50 pour ne pas surcharger la base
  const BATCH_SIZE = 50;
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map((update) =>
        prisma.ticketSale.update({
          where: { id: update.id },
          data: {
            commissionAmount: update.newCommissionAmount,
            commissionRateUsed:
              update.newCommissionAmount > 0 && update.amount > 0
                ? round2((update.newCommissionAmount / update.amount) * 100)
                : 0,
            commissionModeApplied: update.newMode,
            commissionCalculationStatus: update.newStatus,
          },
        }).then(() => { applied += 1; }).catch((err: unknown) => {
          failed += 1;
          console.error(`  ✗ Échec update ticket ${update.id} (${update.ticketNumber}): ${err}`);
        }),
      ),
    );
    process.stdout.write(`  ${applied}/${updates.length} traités...\r`);
  }

  console.log(`\n[DB] Terminé: ${applied} mis à jour, ${failed} échec(s).`);
  console.log(`     commissionCalculationStatus → FINAL pour tous les billets mis à jour.\n`);
}

main()
  .catch((error) => {
    console.error("Script échoué :", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
