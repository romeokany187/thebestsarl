import {
  CashDirection,
  CashOperationCategory,
  type Prisma,
} from "@prisma/client";
import { kinshasaDateKey } from "@/lib/kinshasa-time";
import { prisma } from "@/lib/prisma";
import { buildDeskScopedCashOperationWhere } from "@/lib/payments-desk";
import { monthUtcRange } from "@/lib/cash-report-month-constat";

export const RESTORE_SNAPSHOT_VERSION = 1 as const;

export type SnapshottedCashOperation = {
  occurredAt: string;
  direction: CashDirection;
  category: CashOperationCategory;
  amount: number;
  currency: string;
  fxRateToUsd: number | null;
  fxRateUsdToCdf: number | null;
  amountUsd: number | null;
  amountCdf: number | null;
  method: string;
  reference: string | null;
  description: string;
  cashDesk: string;
  importSource: string | null;
  importExternalKey: string | null;
  createdById: string;
};

export type SnapshottedPayment = {
  ticketId: string;
  amount: number;
  currency: string;
  fxRateUsdToCdf: number | null;
  amountUsd: number | null;
  amountCdf: number | null;
  paidAt: string;
  method: string;
  reference: string | null;
  importSource: string | null;
  importExternalKey: string | null;
  excelLibelle: string | null;
};

export type SnapshottedBilletage = {
  date: string;
  cashDesk: string;
  usdCounts: Prisma.JsonValue;
  cdfCounts: Prisma.JsonValue;
  expectedUsd: number;
  expectedCdf: number;
  savedById: string;
};

export type SnapshottedVirtual = {
  closingDate: string;
  cashDesk: string;
  channels: Prisma.JsonValue;
  totalUsd: number;
  totalCdf: number;
  importId: string | null;
};

export type CashReportImportRestoreSnapshot = {
  version: typeof RESTORE_SNAPSHOT_VERSION;
  reportMonth: string;
  businessDates: string[];
  capturedAt: string;
  cashOperations: SnapshottedCashOperation[];
  payments: SnapshottedPayment[];
  billetageTheBest: SnapshottedBilletage | null;
  virtualTheBest: SnapshottedVirtual | null;
};

function deskScope() {
  return buildDeskScopedCashOperationWhere("THE_BEST", { strict: true });
}

function dbClient(tx?: Prisma.TransactionClient) {
  return tx ?? prisma;
}

async function loadCashOperationsForBusinessDates(
  reportMonth: string,
  businessDates: string[],
  tx?: Prisma.TransactionClient,
) {
  if (businessDates.length === 0) return [];
  const { start, end } = monthUtcRange(reportMonth);
  const dateSet = new Set(businessDates);
  const rows = await dbClient(tx).cashOperation.findMany({
    where: {
      occurredAt: { gte: start, lt: end },
      category: { not: "OPENING_BALANCE" },
      ...deskScope(),
    },
  });
  return rows.filter((row) => dateSet.has(kinshasaDateKey(row.occurredAt)));
}

async function loadExcelPaymentsForBusinessDates(
  reportMonth: string,
  businessDates: string[],
  tx?: Prisma.TransactionClient,
) {
  if (businessDates.length === 0) return [];
  const { start, end } = monthUtcRange(reportMonth);
  const dateSet = new Set(businessDates);
  const rows = await dbClient(tx).payment.findMany({
    where: {
      paidAt: { gte: start, lt: end },
      importSource: { not: null },
    },
  });
  return rows.filter((row) => dateSet.has(kinshasaDateKey(row.paidAt)));
}

export async function capturePreImportSnapshot(options: {
  reportMonth: string;
  businessDates: string[];
  closingDate: string;
  includeDeskClosingSnapshots?: boolean;
}): Promise<CashReportImportRestoreSnapshot> {
  const uniqueDates = [...new Set(options.businessDates)].sort();
  const [cashOperations, payments] = await Promise.all([
    loadCashOperationsForBusinessDates(options.reportMonth, uniqueDates),
    loadExcelPaymentsForBusinessDates(options.reportMonth, uniqueDates),
  ]);

  const captureDesk = options.includeDeskClosingSnapshots === true;
  const billetageTheBest = captureDesk
    ? await prisma.cashBilletageSnapshot.findUnique({
        where: { date_cashDesk: { date: options.closingDate, cashDesk: "THE_BEST" } },
      })
    : null;

  const virtualTheBest = captureDesk
    ? await prisma.cashReportVirtualSnapshot.findUnique({
        where: { closingDate_cashDesk: { closingDate: options.closingDate, cashDesk: "THE_BEST" } },
      })
    : null;

  return {
    version: RESTORE_SNAPSHOT_VERSION,
    reportMonth: options.reportMonth,
    businessDates: uniqueDates,
    capturedAt: new Date().toISOString(),
    cashOperations: cashOperations.map((row) => ({
      occurredAt: row.occurredAt.toISOString(),
      direction: row.direction,
      category: row.category,
      amount: row.amount,
      currency: row.currency,
      fxRateToUsd: row.fxRateToUsd,
      fxRateUsdToCdf: row.fxRateUsdToCdf,
      amountUsd: row.amountUsd,
      amountCdf: row.amountCdf,
      method: row.method,
      reference: row.reference,
      description: row.description,
      cashDesk: row.cashDesk,
      importSource: row.importSource,
      importExternalKey: row.importExternalKey,
      createdById: row.createdById,
    })),
    payments: payments.map((row) => ({
      ticketId: row.ticketId,
      amount: row.amount,
      currency: row.currency,
      fxRateUsdToCdf: row.fxRateUsdToCdf,
      amountUsd: row.amountUsd,
      amountCdf: row.amountCdf,
      paidAt: row.paidAt.toISOString(),
      method: row.method,
      reference: row.reference,
      importSource: row.importSource,
      importExternalKey: row.importExternalKey,
      excelLibelle: row.excelLibelle,
    })),
    billetageTheBest: billetageTheBest
      ? {
          date: billetageTheBest.date,
          cashDesk: billetageTheBest.cashDesk,
          usdCounts: billetageTheBest.usdCounts,
          cdfCounts: billetageTheBest.cdfCounts,
          expectedUsd: billetageTheBest.expectedUsd,
          expectedCdf: billetageTheBest.expectedCdf,
          savedById: billetageTheBest.savedById,
        }
      : null,
    virtualTheBest: virtualTheBest
      ? {
          closingDate: virtualTheBest.closingDate,
          cashDesk: virtualTheBest.cashDesk,
          channels: virtualTheBest.channels,
          totalUsd: virtualTheBest.totalUsd,
          totalCdf: virtualTheBest.totalCdf,
          importId: virtualTheBest.importId,
        }
      : null,
  };
}

/** Supprime journal + opérations caisse THE BEST sur les jours remplacés par l’import Excel. */
export async function purgeBusinessDatesForExcelImport(
  tx: Prisma.TransactionClient,
  reportMonth: string,
  businessDates: string[],
) {
  const uniqueDates = [...new Set(businessDates)];
  if (uniqueDates.length === 0) return;

  const opsToRemove = await loadCashOperationsForBusinessDates(reportMonth, uniqueDates, tx);
  const opIds = opsToRemove.map((row) => row.id);

  if (opIds.length > 0) {
    await tx.cashReportJournalLine.deleteMany({
      where: { OR: [{ cashOperationId: { in: opIds } }, { reportMonth, businessDate: { in: uniqueDates } }] },
    });
    await tx.cashOperation.deleteMany({ where: { id: { in: opIds } } });
  } else {
    await tx.cashReportJournalLine.deleteMany({
      where: { reportMonth, businessDate: { in: uniqueDates } },
    });
  }

  const payments = await loadExcelPaymentsForBusinessDates(reportMonth, uniqueDates, tx);
  const paymentIds = payments.map((row) => row.id);
  if (paymentIds.length > 0) {
    await tx.cashReportJournalLine.deleteMany({ where: { paymentId: { in: paymentIds } } });
    await tx.payment.deleteMany({ where: { id: { in: paymentIds } } });
  }
}

function parseSnapshot(raw: unknown): CashReportImportRestoreSnapshot {
  if (!raw || typeof raw !== "object") {
    throw new Error("Point de restauration invalide ou absent.");
  }
  const snapshot = raw as CashReportImportRestoreSnapshot;
  if (snapshot.version !== RESTORE_SNAPSHOT_VERSION || !Array.isArray(snapshot.businessDates)) {
    throw new Error("Format de sauvegarde non supporté.");
  }
  return snapshot;
}

export async function listCashReportImportsForRestore(options?: { reportMonth?: string; limit?: number }) {
  const limit = Math.min(50, Math.max(1, options?.limit ?? 15));
  return prisma.cashReportImport.findMany({
    where: options?.reportMonth ? { reportMonth: options.reportMonth } : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      reportMonth: true,
      fileName: true,
      closingDate: true,
      status: true,
      createdAt: true,
      restoredAt: true,
      journalNewCount: true,
      cashOpSyncCount: true,
      preImportSnapshot: true,
      importedBy: { select: { name: true, email: true } },
      _count: { select: { journalLines: true } },
    },
  });
}

export async function restoreCashReportImport(importId: string, restoredById: string) {
  const importRow = await prisma.cashReportImport.findUnique({
    where: { id: importId },
    include: {
      journalLines: { select: { id: true, cashOperationId: true, paymentId: true, businessDate: true } },
    },
  });

  if (!importRow) {
    throw new Error("Import introuvable.");
  }
  if (importRow.status === "RESTORED" || importRow.restoredAt) {
    throw new Error("Cet import a déjà été restauré.");
  }
  if (!importRow.preImportSnapshot) {
    throw new Error("Aucune sauvegarde d’avant import — restauration impossible pour cet enregistrement.");
  }

  const snapshot = parseSnapshot(importRow.preImportSnapshot);
  const dates = snapshot.businessDates;

  await prisma.$transaction(async (tx) => {
    const importOpIds = importRow.journalLines.map((line) => line.cashOperationId).filter(Boolean) as string[];
    const importPaymentIds = importRow.journalLines.map((line) => line.paymentId).filter(Boolean) as string[];

    await tx.cashReportJournalLine.deleteMany({ where: { importId: importRow.id } });

    if (importOpIds.length > 0) {
      await tx.cashOperation.deleteMany({ where: { id: { in: importOpIds } } });
    }
    if (importPaymentIds.length > 0) {
      await tx.payment.deleteMany({ where: { id: { in: importPaymentIds } } });
    }

    await purgeBusinessDatesForExcelImport(tx, snapshot.reportMonth, dates);

    for (const row of snapshot.cashOperations) {
      await tx.cashOperation.create({
        data: {
          occurredAt: new Date(row.occurredAt),
          direction: row.direction,
          category: row.category,
          amount: row.amount,
          currency: row.currency,
          fxRateToUsd: row.fxRateToUsd,
          fxRateUsdToCdf: row.fxRateUsdToCdf,
          amountUsd: row.amountUsd,
          amountCdf: row.amountCdf,
          method: row.method,
          reference: row.reference,
          description: row.description,
          cashDesk: row.cashDesk,
          importSource: row.importSource,
          importExternalKey: row.importExternalKey,
          createdById: row.createdById,
        },
      });
    }

    for (const row of snapshot.payments) {
      if (!row.importExternalKey) continue;
      await tx.payment.upsert({
        where: { importExternalKey: row.importExternalKey },
        create: {
          ticketId: row.ticketId,
          amount: row.amount,
          currency: row.currency,
          fxRateUsdToCdf: row.fxRateUsdToCdf,
          amountUsd: row.amountUsd,
          amountCdf: row.amountCdf,
          paidAt: new Date(row.paidAt),
          method: row.method,
          reference: row.reference,
          importSource: row.importSource,
          importExternalKey: row.importExternalKey,
          excelLibelle: row.excelLibelle,
        },
        update: {
          ticketId: row.ticketId,
          amount: row.amount,
          currency: row.currency,
          fxRateUsdToCdf: row.fxRateUsdToCdf,
          amountUsd: row.amountUsd,
          amountCdf: row.amountCdf,
          paidAt: new Date(row.paidAt),
          method: row.method,
          reference: row.reference,
          excelLibelle: row.excelLibelle,
        },
      });
    }

    if (snapshot.billetageTheBest) {
      const b = snapshot.billetageTheBest;
      await tx.cashBilletageSnapshot.upsert({
        where: { date_cashDesk: { date: b.date, cashDesk: b.cashDesk } },
        create: {
          date: b.date,
          cashDesk: b.cashDesk,
          usdCounts: b.usdCounts as Prisma.InputJsonValue,
          cdfCounts: b.cdfCounts as Prisma.InputJsonValue,
          expectedUsd: b.expectedUsd,
          expectedCdf: b.expectedCdf,
          savedById: b.savedById,
        },
        update: {
          usdCounts: b.usdCounts as Prisma.InputJsonValue,
          cdfCounts: b.cdfCounts as Prisma.InputJsonValue,
          expectedUsd: b.expectedUsd,
          expectedCdf: b.expectedCdf,
          savedById: restoredById,
          savedAt: new Date(),
        },
      });
    }

    if (snapshot.virtualTheBest) {
      const v = snapshot.virtualTheBest;
      await tx.cashReportVirtualSnapshot.upsert({
        where: { closingDate_cashDesk: { closingDate: v.closingDate, cashDesk: v.cashDesk } },
        create: {
          closingDate: v.closingDate,
          cashDesk: v.cashDesk,
          channels: v.channels as Prisma.InputJsonValue,
          totalUsd: v.totalUsd,
          totalCdf: v.totalCdf,
          importId: null,
        },
        update: {
          channels: v.channels as Prisma.InputJsonValue,
          totalUsd: v.totalUsd,
          totalCdf: v.totalCdf,
          importId: v.importId,
        },
      });
    }

    await tx.cashReportImport.update({
      where: { id: importRow.id },
      data: { status: "RESTORED", restoredAt: new Date() },
    });
  });

  return {
    importId: importRow.id,
    reportMonth: snapshot.reportMonth,
    restoredDates: dates,
    cashOperationsRestored: snapshot.cashOperations.length,
    paymentsRestored: snapshot.payments.length,
  };
}
