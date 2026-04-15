import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { accountingEntryCreateSchema } from "@/lib/validators";

const cashOperationClient = (prisma as unknown as { cashOperation: any }).cashOperation;
const accountingEntryClient = (prisma as unknown as { accountingEntry: any }).accountingEntry;

function canManageAccounting(role: string, jobTitle: string | null | undefined) {
  return role === "ADMIN" || role === "ACCOUNTANT" || (jobTitle ?? "") === "COMPTABLE";
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
      \`sourceCashOperationId\` VARCHAR(191) NULL,
      \`createdById\` VARCHAR(191) NOT NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      UNIQUE INDEX \`AccountingEntry_sequence_key\` (\`sequence\`),
      UNIQUE INDEX \`AccountingEntry_sourceCashOperationId_key\` (\`sourceCashOperationId\`),
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
}

export async function GET() {
  const access = await requireApiModuleAccess("payments", ["ADMIN", "DIRECTEUR_GENERAL", "ACCOUNTANT", "EMPLOYEE"]);
  if (access.error) return access.error;

  if (!canManageAccounting(access.role, access.session.user.jobTitle)) {
    return NextResponse.json({ error: "Accès réservé au comptable et à l'administrateur." }, { status: 403 });
  }

  await ensureAccountingTables();

  const [accounts, cashOperations, linkedEntries, recentEntries] = await Promise.all([
    prisma.account.findMany({
      select: { code: true, label: true, normalBalance: true },
      orderBy: { code: "asc" },
    }),
    cashOperationClient.findMany({
      orderBy: { occurredAt: "desc" },
      take: 80,
      include: {
        createdBy: { select: { name: true } },
      },
    }),
    accountingEntryClient.findMany({
      where: { sourceCashOperationId: { not: null } },
      select: { sourceCashOperationId: true },
    }),
    accountingEntryClient.findMany({
      orderBy: [{ entryDate: "desc" }, { sequence: "desc" }],
      take: 40,
      include: {
        createdBy: { select: { name: true } },
        sourceCashOperation: {
          select: { id: true, reference: true, description: true },
        },
        lines: {
          orderBy: [{ side: "asc" }, { orderIndex: "asc" }],
        },
      },
    }),
  ]);

  const linkedCashOperationIds = new Set(
    linkedEntries
      .map((entry: { sourceCashOperationId?: string | null }) => entry.sourceCashOperationId)
      .filter((value: string | null | undefined): value is string => Boolean(value)),
  );

  const pendingCashOperations = cashOperations
    .filter((operation: { id: string }) => !linkedCashOperationIds.has(operation.id))
    .map((operation: any) => ({
      id: operation.id,
      occurredAt: operation.occurredAt,
      direction: operation.direction,
      category: operation.category,
      amount: operation.amount,
      currency: operation.currency,
      amountUsd: operation.amountUsd,
      amountCdf: operation.amountCdf,
      method: operation.method,
      reference: operation.reference,
      description: operation.description,
      cashDesk: operation.cashDesk,
      createdByName: operation.createdBy?.name ?? null,
    }));

  return NextResponse.json({
    accounts,
    pendingCashOperations,
    recentEntries,
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
  const parsed = accountingEntryCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  const uniqueAccountCodes = [...new Set(data.lines.map((line) => line.accountCode.trim()))];
  const accounts = await prisma.account.findMany({
    where: { code: { in: uniqueAccountCodes } },
    select: { code: true, label: true },
  });

  if (accounts.length !== uniqueAccountCodes.length) {
    const foundCodes = new Set(accounts.map((account) => account.code));
    const missingCodes = uniqueAccountCodes.filter((code) => !foundCodes.has(code));
    return NextResponse.json(
      { error: `Comptes introuvables dans le plan comptable: ${missingCodes.join(", ")}` },
      { status: 400 },
    );
  }

  if (data.sourceCashOperationId) {
    const sourceOperation = await cashOperationClient.findUnique({
      where: { id: data.sourceCashOperationId },
      select: { id: true },
    });

    if (!sourceOperation) {
      return NextResponse.json({ error: "L'opération de caisse source est introuvable." }, { status: 404 });
    }

    const existingEntry = await accountingEntryClient.findUnique({
      where: { sourceCashOperationId: data.sourceCashOperationId },
      select: { id: true, sequence: true },
    });

    if (existingEntry) {
      return NextResponse.json(
        { error: `Cette opération de caisse est déjà comptabilisée dans l'écriture n° ${existingEntry.sequence}.` },
        { status: 400 },
      );
    }
  }

  const accountByCode = new Map(accounts.map((account) => [account.code, account.label]));

  const createdEntry = await prisma.$transaction(async (tx) => {
    const entry = await (tx as unknown as { accountingEntry: any }).accountingEntry.create({
      data: {
        entryDate: data.entryDate,
        pole: data.pole?.trim() || null,
        libelle: data.libelle.trim(),
        pieceJustificative: data.pieceJustificative?.trim() || null,
        exchangeRate: data.exchangeRate ?? null,
        sourceCashOperationId: data.sourceCashOperationId?.trim() || null,
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
        sourceCashOperation: {
          select: { id: true, reference: true, description: true },
        },
      },
    });

    return entry;
  });

  return NextResponse.json({ data: createdEntry }, { status: 201 });
}