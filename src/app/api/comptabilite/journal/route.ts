import { NextRequest, NextResponse } from "next/server";
import { invoiceNumberFromChronology } from "@/lib/invoice";
import { applyAccountingChronologySequence, buildAccountingChronologySequenceMap } from "@/lib/accounting-chronology";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { writeActivityLog } from "@/lib/activity-log";
import { accountingEntryCreateSchema } from "@/lib/validators";

const accountingEntryClient = (prisma as unknown as { accountingEntry: any }).accountingEntry;

type AccountingTxClient = PrismaLikeTransactionClient & {
  accountingEntry: any;
};

type PrismaLikeTransactionClient = {
  account: typeof prisma.account;
  $executeRawUnsafe?: typeof prisma.$executeRawUnsafe;
  $queryRawUnsafe?: <T = unknown>(query: string) => Promise<T>;
};

type DailyRateRow = {
  id: string;
  rateDate: Date | string;
  exchangeRate: number;
  createdByName?: string | null;
};

type DeletedEntryLog = {
  id: string;
  createdAt: Date;
  actor?: { name?: string | null } | null;
  payload?: unknown;
};

type AccountingChronologyRow = {
  id: string;
  entryDate: Date;
  createdAt: Date;
  sequence: number;
};

function canManageAccounting(role: string, jobTitle: string | null | undefined) {
  return role === "ADMIN" || role === "ACCOUNTANT" || (jobTitle ?? "") === "COMPTABLE";
}

function toUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function toSqlDateTime(date: Date) {
  return date.toISOString().slice(0, 23).replace("T", " ");
}

function normalizeDailyRateRow(row: DailyRateRow) {
  return {
    id: row.id,
    rateDate: new Date(row.rateDate).toISOString(),
    exchangeRate: Number(row.exchangeRate),
    createdBy: row.createdByName ? { name: row.createdByName } : null,
  };
}

function normalizeDeletedEntryLog(log: DeletedEntryLog) {
  const payload = log.payload && typeof log.payload === "object" ? log.payload as {
    summary?: string | null;
    details?: {
      sequence?: number;
      entryDate?: string;
      pole?: string | null;
      libelle?: string;
      pieceJustificative?: string | null;
      exchangeRate?: number | null;
      lines?: Array<{
        side: "DEBIT" | "CREDIT";
        orderIndex: number;
        accountCode: string;
        accountLabel: string;
        amountUsd?: number | null;
        amountCdf?: number | null;
      }>;
    } | null;
  } : null;
  const details = payload?.details ?? null;

  return {
    id: log.id,
    deletedAt: log.createdAt.toISOString(),
    deletedBy: log.actor?.name ? { name: log.actor.name } : null,
    summary: payload?.summary ?? null,
    sequence: typeof details?.sequence === "number" ? details.sequence : null,
    entryDate: details?.entryDate ?? null,
    pole: details?.pole ?? null,
    libelle: details?.libelle ?? null,
    pieceJustificative: details?.pieceJustificative ?? null,
    exchangeRate: typeof details?.exchangeRate === "number" ? details.exchangeRate : null,
    lines: Array.isArray(details?.lines) ? details.lines : [],
  };
}

function validateEntryCurrencyEquivalence(
  lines: Array<{ side: "DEBIT" | "CREDIT"; amountUsd?: number | null; amountCdf?: number | null }>,
  exchangeRate: number,
) {
  const totals = lines.reduce(
    (sum, line) => {
      const usd = Number(line.amountUsd ?? 0);
      const cdf = Number(line.amountCdf ?? 0);
      if (line.side === "DEBIT") {
        sum.debitUsd += usd;
        sum.debitCdf += cdf;
      } else {
        sum.creditUsd += usd;
        sum.creditCdf += cdf;
      }
      return sum;
    },
    { debitUsd: 0, creditUsd: 0, debitCdf: 0, creditCdf: 0 },
  );

  const debitUsdEquivalent = totals.debitUsd + (totals.debitCdf / exchangeRate);
  const creditUsdEquivalent = totals.creditUsd + (totals.creditCdf / exchangeRate);

  if (Math.abs(debitUsdEquivalent - creditUsdEquivalent) <= 0.01) {
    return null;
  }

  return `Écriture déséquilibrée selon le taux du jour (${exchangeRate.toFixed(2)}). Débit équiv. USD ${debitUsdEquivalent.toFixed(2)} vs Crédit équiv. USD ${creditUsdEquivalent.toFixed(2)}.`;
}

async function resolveDailyRate(client: { $queryRawUnsafe?: <T = unknown>(query: string) => Promise<T> }, entryDate: Date) {
  if (typeof client.$queryRawUnsafe !== "function") {
    throw new Error("ACCOUNTING_DAILY_RATE_QUERY_UNAVAILABLE");
  }

  const rateDate = toUtcDay(entryDate);
  const rows = await client.$queryRawUnsafe<DailyRateRow[]>(`
    SELECT id, rateDate, exchangeRate
    FROM \`AccountingDailyRate\`
    WHERE rateDate = '${toSqlDateTime(rateDate)}'
    LIMIT 1
  `);
  const dailyRate = rows[0] ?? null;

  if (!dailyRate) {
    throw new Error(`MISSING_ACCOUNTING_DAILY_RATE:${rateDate.toISOString()}`);
  }

  return {
    id: dailyRate.id,
    rateDate,
    exchangeRate: Number(dailyRate.exchangeRate),
  };
}

async function listDailyRates(client: { $queryRawUnsafe?: <T = unknown>(query: string) => Promise<T> }, limit = 60) {
  if (typeof client.$queryRawUnsafe !== "function") {
    return [];
  }

  const rows = await client.$queryRawUnsafe<DailyRateRow[]>(`
    SELECT r.id, r.rateDate, r.exchangeRate, u.name AS createdByName
    FROM \`AccountingDailyRate\` r
    LEFT JOIN \`User\` u ON u.id = r.createdById
    ORDER BY r.rateDate DESC
    LIMIT ${Math.max(1, Math.min(limit, 365))}
  `);

  return rows.map(normalizeDailyRateRow);
}

async function listAccountingChronologyRows(client: { accountingEntry: any }) {
  return client.accountingEntry.findMany({
    select: {
      id: true,
      entryDate: true,
      createdAt: true,
      sequence: true,
    },
  }) as Promise<AccountingChronologyRow[]>;
}

async function resolveAccountingChronologySequence(client: { accountingEntry: any }, entryId: string) {
  const rows = await listAccountingChronologyRows(client);
  return buildAccountingChronologySequenceMap(rows).get(entryId) ?? null;
}

async function buildEntryPayload(client: PrismaLikeTransactionClient, body: unknown) {
  const parsed = accountingEntryCreateSchema.safeParse(body);
  if (!parsed.success) {
    return { error: NextResponse.json({ error: parsed.error.flatten() }, { status: 400 }) };
  }

  const data = parsed.data;
  const uniqueAccountCodes = [...new Set(data.lines.map((line) => line.accountCode.trim()))];
  const accounts = await client.account.findMany({
    where: { code: { in: uniqueAccountCodes } },
    select: { code: true, label: true },
  });

  if (accounts.length !== uniqueAccountCodes.length) {
    const foundCodes = new Set(accounts.map((account) => account.code));
    const missingCodes = uniqueAccountCodes.filter((code) => !foundCodes.has(code));
    return {
      error: NextResponse.json(
        { error: `Comptes introuvables dans le plan comptable: ${missingCodes.join(", ")}` },
        { status: 400 },
      ),
    };
  }

  const accountByCode = new Map(accounts.map((account) => [account.code, account.label]));
  return { data, accountByCode };
}

async function ensureAccountingTables() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \
    \`AccountingEntry\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`sequence\` INT NOT NULL AUTO_INCREMENT,
      \`entryDate\` DATETIME(3) NOT NULL,
      \`pole\` VARCHAR(191) NULL,
      \`libelle\` VARCHAR(500) NOT NULL,
      \`pieceJustificative\` VARCHAR(191) NULL,
      \`exchangeRate\` DOUBLE NULL,
      \`createdById\` VARCHAR(191) NOT NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      UNIQUE INDEX \`AccountingEntry_sequence_key\` (\`sequence\`),
      INDEX \`AccountingEntry_entryDate_idx\` (\`entryDate\`),
      INDEX \`AccountingEntry_createdById_idx\` (\`createdById\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \
    \`AccountingEntryLine\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`entryId\` VARCHAR(191) NOT NULL,
      \`side\` ENUM('DEBIT','CREDIT') NOT NULL,
      \`orderIndex\` INT NOT NULL DEFAULT 0,
      \`accountCode\` VARCHAR(191) NOT NULL,
      \`accountLabel\` VARCHAR(191) NOT NULL,
      \`amountUsd\` DOUBLE NULL,
      \`amountCdf\` DOUBLE NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`AccountingEntryLine_entryId_side_idx\` (\`entryId\`, \`side\`),
      INDEX \`AccountingEntryLine_accountCode_idx\` (\`accountCode\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \
    \`AccountingDailyRate\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`rateDate\` DATETIME(3) NOT NULL,
      \`exchangeRate\` DOUBLE NOT NULL,
      \`createdById\` VARCHAR(191) NOT NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      UNIQUE INDEX \`AccountingDailyRate_rateDate_key\` (\`rateDate\`),
      INDEX \`AccountingDailyRate_createdById_idx\` (\`createdById\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);
}

function ticketSupportRangeStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), 3, 1, 0, 0, 0, 0));
}

export async function GET(request: NextRequest) {
  const access = await requireApiModuleAccess("payments", ["ADMIN", "DIRECTEUR_GENERAL", "ACCOUNTANT", "EMPLOYEE"]);
  if (access.error) return access.error;

  if (!canManageAccounting(access.role, access.session.user.jobTitle)) {
    return NextResponse.json({ error: "Accès réservé au comptable et à l'administrateur." }, { status: 403 });
  }

  await ensureAccountingTables();

  const searchQuery = new URL(request.url).searchParams.get("q")?.trim() ?? "";

  const supportStart = ticketSupportRangeStart();
  const yearStart = new Date(Date.UTC(supportStart.getUTCFullYear(), 0, 1, 0, 0, 0, 0));

  const entryWhere = searchQuery
    ? {
        OR: [
          { libelle: { contains: searchQuery } },
          { pieceJustificative: { contains: searchQuery } },
          { pole: { contains: searchQuery } },
          { createdBy: { name: { contains: searchQuery } } },
          { lines: { some: { accountCode: { contains: searchQuery } } } },
          { lines: { some: { accountLabel: { contains: searchQuery } } } },
        ],
      }
    : {};

  const [accounts, chronologyRows, recentEntriesRaw, yearlyTickets, dailyRates, deletedEntries] = await Promise.all([
    prisma.account.findMany({
      select: { code: true, label: true, normalBalance: true },
      orderBy: { code: "asc" },
    }),
    listAccountingChronologyRows({ accountingEntry: accountingEntryClient }),
    accountingEntryClient.findMany({
      where: entryWhere,
      orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      ...(searchQuery ? {} : { take: 500 }),
      include: {
        createdBy: { select: { name: true } },
        lines: {
          orderBy: [{ side: "asc" }, { orderIndex: "asc" }],
        },
      },
    }),
    prisma.ticketSale.findMany({
      where: {
        soldAt: { gte: yearStart },
      },
      select: {
        id: true,
        ticketNumber: true,
        customerName: true,
        soldAt: true,
        seller: {
          select: {
            team: {
              select: { name: true },
            },
          },
        },
      },
      orderBy: [{ soldAt: "asc" }, { id: "asc" }],
    }),
    listDailyRates(prisma, 60),
    prisma.auditLog.findMany({
      where: {
        action: "ACCOUNTING_ENTRY_DELETED",
        entityType: "ACCOUNTING_ENTRY",
      },
      include: {
        actor: {
          select: { name: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
  ]);

  const recentEntries = applyAccountingChronologySequence(
    recentEntriesRaw,
    buildAccountingChronologySequenceMap(chronologyRows),
  );

  const ticketInvoiceOptions = yearlyTickets
    .map((ticket, index) => ({
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      customerName: ticket.customerName,
      soldAt: ticket.soldAt,
      invoiceNumber: invoiceNumberFromChronology({
        soldAt: ticket.soldAt,
        sellerTeamName: ticket.seller?.team?.name ?? null,
        sequence: index + 1,
      }),
    }))
    .filter((ticket) => ticket.soldAt >= supportStart)
    .sort((left, right) => right.soldAt.getTime() - left.soldAt.getTime());

  return NextResponse.json({
    accounts,
    recentEntries,
    ticketInvoiceOptions,
    dailyRates,
    deletedEntries: deletedEntries.map(normalizeDeletedEntryLog),
  });
}

export async function POST(request: NextRequest) {
  const access = await requireApiModuleAccess("payments", ["ADMIN", "DIRECTEUR_GENERAL", "ACCOUNTANT", "EMPLOYEE"]);
  if (access.error) return access.error;

  if (!canManageAccounting(access.role, access.session.user.jobTitle)) {
    return NextResponse.json({ error: "Accès réservé au comptable et à l'administrateur." }, { status: 403 });
  }

  await ensureAccountingTables();

  const body = await request.json();
  const builtPayload = await buildEntryPayload(prisma, body);
  if ("error" in builtPayload) return builtPayload.error;

  const { data, accountByCode } = builtPayload;

  try {
    const dailyRate = await resolveDailyRate(prisma as unknown as AccountingTxClient, data.entryDate);
    const balanceError = validateEntryCurrencyEquivalence(data.lines, dailyRate.exchangeRate);
    if (balanceError) {
      return NextResponse.json({ error: balanceError }, { status: 400 });
    }

    const createdEntry = await prisma.$transaction(async (tx) => {
      const entry = await (tx as unknown as AccountingTxClient).accountingEntry.create({
        data: {
          entryDate: data.entryDate,
          pole: data.pole?.trim() || null,
          libelle: data.libelle.trim(),
          pieceJustificative: data.pieceJustificative?.trim() || null,
          exchangeRate: dailyRate.exchangeRate,
          createdById: access.session.user.id,
          lines: {
            create: data.lines.map((line, index) => ({
              side: line.side,
              orderIndex: index,
              accountCode: line.accountCode.trim(),
              accountLabel: accountByCode.get(line.accountCode.trim()) ?? line.accountCode.trim(),
              amountUsd: line.amountUsd ?? null,
              amountCdf: line.amountCdf ?? null,
            })),
          },
        },
        include: {
          createdBy: { select: { name: true } },
          lines: { orderBy: [{ side: "asc" }, { orderIndex: "asc" }] },
        },
      });

      const sequence = await resolveAccountingChronologySequence(tx as unknown as AccountingTxClient, entry.id);
      return {
        ...entry,
        sequence: sequence ?? entry.sequence,
      };
    });

    return NextResponse.json({ data: createdEntry }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("MISSING_ACCOUNTING_DAILY_RATE:")) {
      const [, isoDate] = error.message.split(":");
      return NextResponse.json(
        { error: `Aucun taux du jour n'est enregistré pour le ${new Date(isoDate).toLocaleDateString("fr-FR")}.` },
        { status: 400 },
      );
    }

    throw error;
  }
}

export async function PUT(request: NextRequest) {
  const access = await requireApiModuleAccess("payments", ["ADMIN", "DIRECTEUR_GENERAL", "ACCOUNTANT", "EMPLOYEE"]);
  if (access.error) return access.error;

  if (!canManageAccounting(access.role, access.session.user.jobTitle)) {
    return NextResponse.json({ error: "Accès réservé au comptable et à l'administrateur." }, { status: 403 });
  }

  await ensureAccountingTables();

  const body = await request.json();
  const entryId = typeof body?.id === "string" ? body.id.trim() : "";
  if (!entryId) {
    return NextResponse.json({ error: "Identifiant d'écriture manquant." }, { status: 400 });
  }

  const builtPayload = await buildEntryPayload(prisma, body);
  if ("error" in builtPayload) return builtPayload.error;

  const { data, accountByCode } = builtPayload;

  try {
    const dailyRate = await resolveDailyRate(prisma as unknown as AccountingTxClient, data.entryDate);
    const balanceError = validateEntryCurrencyEquivalence(data.lines, dailyRate.exchangeRate);
    if (balanceError) {
      return NextResponse.json({ error: balanceError }, { status: 400 });
    }

    const updatedEntry = await prisma.$transaction(async (tx) => {
      await (tx as unknown as { accountingEntryLine: any }).accountingEntryLine.deleteMany({
        where: { entryId },
      });

      const entry = await (tx as unknown as AccountingTxClient).accountingEntry.update({
        where: { id: entryId },
        data: {
          entryDate: data.entryDate,
          pole: data.pole?.trim() || null,
          libelle: data.libelle.trim(),
          pieceJustificative: data.pieceJustificative?.trim() || null,
          exchangeRate: dailyRate.exchangeRate,
          lines: {
            create: data.lines.map((line, index) => ({
              side: line.side,
              orderIndex: index,
              accountCode: line.accountCode.trim(),
              accountLabel: accountByCode.get(line.accountCode.trim()) ?? line.accountCode.trim(),
              amountUsd: line.amountUsd ?? null,
              amountCdf: line.amountCdf ?? null,
            })),
          },
        },
        include: {
          createdBy: { select: { name: true } },
          lines: { orderBy: [{ side: "asc" }, { orderIndex: "asc" }] },
        },
      });

      const sequence = await resolveAccountingChronologySequence(tx as unknown as AccountingTxClient, entry.id);
      return {
        ...entry,
        sequence: sequence ?? entry.sequence,
      };
    });

    return NextResponse.json({ data: updatedEntry });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("MISSING_ACCOUNTING_DAILY_RATE:")) {
      const [, isoDate] = error.message.split(":");
      return NextResponse.json(
        { error: `Aucun taux du jour n'est enregistré pour le ${new Date(isoDate).toLocaleDateString("fr-FR")}.` },
        { status: 400 },
      );
    }

    throw error;
  }
}

export async function DELETE(request: NextRequest) {
  const access = await requireApiModuleAccess("payments", ["ADMIN", "DIRECTEUR_GENERAL", "ACCOUNTANT", "EMPLOYEE"]);
  if (access.error) return access.error;

  if (!canManageAccounting(access.role, access.session.user.jobTitle)) {
    return NextResponse.json({ error: "Accès réservé au comptable et à l'administrateur." }, { status: 403 });
  }

  await ensureAccountingTables();

  const { searchParams } = new URL(request.url);
  const entryId = searchParams.get("id")?.trim() ?? "";
  if (!entryId) {
    return NextResponse.json({ error: "Identifiant d'écriture manquant." }, { status: 400 });
  }

  const existing = await accountingEntryClient.findUnique({
    where: { id: entryId },
    include: {
      lines: {
        orderBy: [{ side: "asc" }, { orderIndex: "asc" }],
      },
      createdBy: {
        select: { name: true },
      },
    },
  });

  if (!existing) {
    return NextResponse.json({ error: "Écriture comptable introuvable." }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    await (tx as unknown as { accountingEntryLine: any }).accountingEntryLine.deleteMany({
      where: { entryId },
    });
    await (tx as unknown as AccountingTxClient).accountingEntry.delete({
      where: { id: entryId },
    });
  });

  await writeActivityLog({
    actorId: access.session.user.id,
    action: "ACCOUNTING_ENTRY_DELETED",
    entityType: "ACCOUNTING_ENTRY",
    entityId: existing.id,
    summary: `Écriture comptable n° ${existing.sequence} supprimée.`,
    payload: {
      sequence: existing.sequence,
      entryDate: existing.entryDate.toISOString(),
      pole: existing.pole,
      libelle: existing.libelle,
      pieceJustificative: existing.pieceJustificative,
      exchangeRate: existing.exchangeRate,
      createdBy: existing.createdBy?.name ?? null,
      lines: existing.lines.map((line: {
        side: "DEBIT" | "CREDIT";
        orderIndex: number;
        accountCode: string;
        accountLabel: string;
        amountUsd?: number | null;
        amountCdf?: number | null;
      }) => ({
        side: line.side,
        orderIndex: line.orderIndex,
        accountCode: line.accountCode,
        accountLabel: line.accountLabel,
        amountUsd: line.amountUsd,
        amountCdf: line.amountCdf,
      })),
    },
  });

  return NextResponse.json({ ok: true });
}