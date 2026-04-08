import { Prisma } from "@prisma/client";

export type AirlineDepositMovementTypeValue = "CREDIT" | "DEBIT";

export type AirlineDepositAccountConfig = {
  key: string;
  label: string;
  airlineCodes: string[];
  airlineNames: string[];
};

export type AirlineDepositAccountSummary = AirlineDepositAccountConfig & {
  balance: number;
  totalCredits: number;
  totalDebits: number;
  recentMovements: Array<{
    id: string;
    movementType: AirlineDepositMovementTypeValue;
    amount: number;
    balanceAfter: number | null;
    reference: string;
    description: string;
    createdAt: string;
    airlineName: string | null;
    airlineCode: string | null;
    createdByName: string | null;
    ticketNumber: string | null;
  }>;
};

type AirlineDepositMovementRecord = {
  id: string;
  accountKey: string;
  movementType: AirlineDepositMovementTypeValue;
  amount: number;
  balanceAfter: number | null;
  reference: string;
  description: string;
  createdAt: Date;
  airline?: { id: string; code: string; name: string } | null;
  createdBy?: { id: string; name: string } | null;
  ticketSale?: { id: string; ticketNumber: string } | null;
};

export const AIRLINE_DEPOSIT_ACCOUNT_CONFIGS: AirlineDepositAccountConfig[] = [
  {
    key: "CAA_DEPOSIT",
    label: "Compte dépôt CAA",
    airlineCodes: ["CAA"],
    airlineNames: ["CAA"],
  },
  {
    key: "SHARED_ACG_ET",
    label: "Compte dépôt partagé Air Congo / Ethiopian",
    airlineCodes: ["ACG", "ET"],
    airlineNames: ["Air Congo", "Ethiopian Airlines"],
  },
  {
    key: "MONT_GABAON",
    label: "Compte dépôt Mont Gabaon",
    airlineCodes: ["MGB"],
    airlineNames: ["Mont Gabaon"],
  },
  {
    key: "KENYA_AIRWAYS",
    label: "Compte dépôt Kenya Airways",
    airlineCodes: ["KQ"],
    airlineNames: ["Kenya Airways"],
  },
  {
    key: "AIR_FAST",
    label: "Compte dépôt Air Fast",
    airlineCodes: ["FST"],
    airlineNames: ["Air Fast"],
  },
];

const LEGACY_ACCOUNT_KEY_ALIASES: Record<string, string> = {
  SHARED_CAA_ACG_ET: "SHARED_ACG_ET",
};

const accountByKey = new Map(AIRLINE_DEPOSIT_ACCOUNT_CONFIGS.map((config) => [config.key, config]));
const accountByAirlineCode = new Map(
  AIRLINE_DEPOSIT_ACCOUNT_CONFIGS.flatMap((config) => config.airlineCodes.map((code) => [code, config] as const)),
);

function normalizeAccountKey(value: string | null | undefined) {
  const normalized = (value ?? "").trim().toUpperCase();
  return LEGACY_ACCOUNT_KEY_ALIASES[normalized] ?? normalized;
}

function accountKeysForLookup(key: string | null | undefined) {
  const canonicalKey = normalizeAccountKey(key);
  return [
    canonicalKey,
    ...Object.entries(LEGACY_ACCOUNT_KEY_ALIASES)
      .filter(([, target]) => target === canonicalKey)
      .map(([legacyKey]) => legacyKey),
  ].filter(Boolean);
}

export function normalizeAirlineCode(value: string | null | undefined) {
  return (value ?? "").trim().toUpperCase();
}

export function getAirlineDepositAccountByKey(key: string | null | undefined) {
  if (!key) return null;
  return accountByKey.get(normalizeAccountKey(key)) ?? null;
}

export function getAirlineDepositAccountByAirlineCode(code: string | null | undefined) {
  const normalized = normalizeAirlineCode(code);
  if (!normalized) return null;
  return accountByAirlineCode.get(normalized) ?? null;
}

export function airlineUsesDepositAccount(code: string | null | undefined) {
  return Boolean(getAirlineDepositAccountByAirlineCode(code));
}

function movementSignedAmount(movementType: AirlineDepositMovementTypeValue, amount: number) {
  return movementType === "CREDIT" ? amount : -amount;
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

export async function getAirlineDepositBalance(
  client: Prisma.TransactionClient,
  accountKey: string,
  options?: { upTo?: Date },
) {
  const movementClient = (client as unknown as { airlineDepositMovement: { findMany: (args?: any) => Promise<Array<{ amount: number; movementType: AirlineDepositMovementTypeValue }>> } }).airlineDepositMovement;
  const movements = await movementClient.findMany({
    where: {
      accountKey: { in: accountKeysForLookup(accountKey) },
      ...(options?.upTo ? { createdAt: { lte: options.upTo } } : {}),
    },
    select: { amount: true, movementType: true },
  });

  return movements.reduce(
    (sum: number, movement: { amount: number; movementType: AirlineDepositMovementTypeValue }) => sum + movementSignedAmount(movement.movementType, movement.amount),
    0,
  );
}

async function getFirstAirlineDepositCreditDate(client: Prisma.TransactionClient, accountKey: string) {
  const movementClient = (client as unknown as { airlineDepositMovement: { findFirst: (args?: any) => Promise<{ createdAt: Date } | null> } }).airlineDepositMovement;
  const firstCredit = await movementClient.findFirst({
    where: {
      accountKey: { in: accountKeysForLookup(accountKey) },
      movementType: "CREDIT",
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { createdAt: true },
  });

  return firstCredit?.createdAt ?? null;
}

export async function recordAirlineDepositMovement(
  client: Prisma.TransactionClient,
  input: {
    accountKey: string;
    movementType: AirlineDepositMovementTypeValue;
    amount: number;
    reference: string;
    description: string;
    airlineId?: string | null;
    ticketSaleId?: string | null;
    createdById?: string | null;
    createdAt?: Date;
  },
) {
  const account = getAirlineDepositAccountByKey(input.accountKey);
  if (!account) {
    throw new Error(`INVALID_AIRLINE_DEPOSIT_ACCOUNT:${input.accountKey}`);
  }

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("INVALID_AIRLINE_DEPOSIT_AMOUNT");
  }

  const effectiveCreatedAt = input.createdAt ?? new Date();
  const [balanceBefore, firstCreditAt] = await Promise.all([
    getAirlineDepositBalance(client, account.key),
    getFirstAirlineDepositCreditDate(client, account.key),
  ]);

  const allowHistoricalPreDepositDebit = input.movementType === "DEBIT"
    && (
      !firstCreditAt
      || startOfUtcDay(effectiveCreatedAt).getTime() < startOfUtcDay(firstCreditAt).getTime()
    );

  if (!allowHistoricalPreDepositDebit && input.movementType === "DEBIT" && amount > balanceBefore + 0.0001) {
    throw new Error(`INSUFFICIENT_AIRLINE_DEPOSIT:${account.label}:${balanceBefore.toFixed(2)}:${amount.toFixed(2)}`);
  }

  const balanceAfter = balanceBefore + movementSignedAmount(input.movementType, amount);

  const movementClient = (client as unknown as { airlineDepositMovement: { create: (args: any) => Promise<unknown> } }).airlineDepositMovement;

  return movementClient.create({
    data: {
      accountKey: account.key,
      accountLabel: account.label,
      movementType: input.movementType,
      amount,
      balanceAfter,
      reference: input.reference.trim(),
      description: input.description.trim(),
      airlineId: input.airlineId ?? undefined,
      ticketSaleId: input.ticketSaleId ?? undefined,
      createdById: input.createdById ?? undefined,
      createdAt: effectiveCreatedAt,
    },
  });
}

export async function buildAirlineDepositAccountSummaries(
  client: { airlineDepositMovement: { findMany: (args?: any) => Promise<any[]> } },
  recentLimit = 6,
  options?: { upTo?: Date },
): Promise<AirlineDepositAccountSummary[]> {
  const movements = await client.airlineDepositMovement.findMany({
    where: {
      ...(options?.upTo ? { createdAt: { lte: options.upTo } } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: {
      airline: { select: { id: true, code: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      ticketSale: { select: { id: true, ticketNumber: true } },
    },
  });

  const totals = new Map(
    AIRLINE_DEPOSIT_ACCOUNT_CONFIGS.map((config) => [
      config.key,
      { balance: 0, totalCredits: 0, totalDebits: 0 },
    ]),
  );

  [...(movements as AirlineDepositMovementRecord[])]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
    .forEach((movement) => {
      const normalizedAccountKey = normalizeAccountKey(movement.accountKey);
      const bucket = totals.get(normalizedAccountKey) ?? { balance: 0, totalCredits: 0, totalDebits: 0 };
      bucket.balance += movementSignedAmount(movement.movementType, movement.amount);
      if (movement.movementType === "CREDIT") {
        bucket.totalCredits += movement.amount;
      } else {
        bucket.totalDebits += movement.amount;
      }
      totals.set(normalizedAccountKey, bucket);
    });

  return AIRLINE_DEPOSIT_ACCOUNT_CONFIGS.map((config) => {
    const bucket = totals.get(config.key) ?? { balance: 0, totalCredits: 0, totalDebits: 0 };
    const recentMovements = (movements as AirlineDepositMovementRecord[])
      .filter((movement) => normalizeAccountKey(movement.accountKey) === config.key)
      .slice(0, recentLimit)
      .map((movement) => ({
        id: movement.id,
        movementType: movement.movementType,
        amount: movement.amount,
        balanceAfter: movement.balanceAfter,
        reference: movement.reference,
        description: movement.description,
        createdAt: movement.createdAt.toISOString(),
        airlineName: movement.airline?.name ?? null,
        airlineCode: movement.airline?.code ?? null,
        createdByName: movement.createdBy?.name ?? null,
        ticketNumber: movement.ticketSale?.ticketNumber ?? null,
      }));

    return {
      ...config,
      balance: bucket.balance,
      totalCredits: bucket.totalCredits,
      totalDebits: bucket.totalDebits,
      recentMovements,
    };
  });
}
