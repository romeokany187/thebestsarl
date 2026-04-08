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
  ticketSale?: { id: string; ticketNumber: string; soldAt?: Date | null } | null;
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

function isAutomaticTicketDepositMovement(input: {
  ticketSale?: { id?: string | null } | null;
  ticketSaleId?: string | null;
  reference?: string | null;
  description?: string | null;
}) {
  if (input.ticketSaleId || input.ticketSale?.id) {
    return true;
  }

  const normalizedReference = (input.reference ?? "").trim().toUpperCase();
  const normalizedDescription = (input.description ?? "").trim().toUpperCase();

  return normalizedReference.startsWith("PNR ")
    || normalizedReference.startsWith("AJUST ")
    || normalizedReference.startsWith("ANNUL ")
    || normalizedReference.startsWith("TRANSFERT ")
    || normalizedDescription.includes("BILLET");
}

function shouldIgnoreHistoricalTicketDepositMovement(
  movement: {
    createdAt: Date;
    reference?: string | null;
    description?: string | null;
    ticketSale?: { id?: string | null; soldAt?: Date | null } | null;
    ticketSaleId?: string | null;
  },
  firstCreditAt: Date | null,
) {
  if (!isAutomaticTicketDepositMovement(movement)) {
    return false;
  }

  const businessDate = movement.ticketSale?.soldAt ?? movement.createdAt;
  if (!firstCreditAt) {
    return true;
  }

  return startOfUtcDay(businessDate).getTime() < startOfUtcDay(firstCreditAt).getTime();
}

export async function getAirlineDepositBalance(
  client: Prisma.TransactionClient,
  accountKey: string,
  options?: { upTo?: Date },
) {
  const movementClient = (client as unknown as { airlineDepositMovement: { findMany: (args?: any) => Promise<Array<AirlineDepositMovementRecord>> } }).airlineDepositMovement;
  const [movements, firstCreditAt] = await Promise.all([
    movementClient.findMany({
      where: {
        accountKey: { in: accountKeysForLookup(accountKey) },
        ...(options?.upTo ? { createdAt: { lte: options.upTo } } : {}),
      },
      select: {
        id: true,
        accountKey: true,
        movementType: true,
        amount: true,
        balanceAfter: true,
        reference: true,
        description: true,
        createdAt: true,
        ticketSale: { select: { id: true, ticketNumber: true, soldAt: true } },
      },
    }),
    getFirstAirlineDepositCreditDate(client, accountKey),
  ]);

  return movements.reduce((sum: number, movement) => {
    if (shouldIgnoreHistoricalTicketDepositMovement(movement, firstCreditAt)) {
      return sum;
    }
    return sum + movementSignedAmount(movement.movementType, movement.amount);
  }, 0);
}

async function getFirstAirlineDepositCreditDate(client: Prisma.TransactionClient, accountKey: string) {
  const movementClient = (client as unknown as { airlineDepositMovement: { findMany: (args?: any) => Promise<Array<{ createdAt: Date; reference?: string | null; description?: string | null; ticketSale?: { id?: string | null } | null }>> } }).airlineDepositMovement;
  const creditMovements = await movementClient.findMany({
    where: {
      accountKey: { in: accountKeysForLookup(accountKey) },
      movementType: "CREDIT",
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      createdAt: true,
      reference: true,
      description: true,
      ticketSale: { select: { id: true } },
    },
  });

  const firstManualCredit = creditMovements.find((movement) => !isAutomaticTicketDepositMovement(movement));
  return firstManualCredit?.createdAt ?? null;
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

  const ticketSaleClient = (client as unknown as { ticketSale?: { findUnique: (args?: any) => Promise<{ soldAt: Date } | null> } }).ticketSale;
  const linkedTicket = input.ticketSaleId && ticketSaleClient
    ? await ticketSaleClient.findUnique({ where: { id: input.ticketSaleId }, select: { soldAt: true } })
    : null;

  const effectiveCreatedAt = input.createdAt ?? linkedTicket?.soldAt ?? new Date();
  const [balanceBefore, firstCreditAt] = await Promise.all([
    getAirlineDepositBalance(client, account.key, { upTo: effectiveCreatedAt }),
    getFirstAirlineDepositCreditDate(client, account.key),
  ]);

  if (
    shouldIgnoreHistoricalTicketDepositMovement(
      {
        createdAt: effectiveCreatedAt,
        reference: input.reference,
        description: input.description,
        ticketSaleId: input.ticketSaleId ?? null,
        ticketSale: linkedTicket ? { id: input.ticketSaleId ?? null, soldAt: linkedTicket.soldAt } : null,
      },
      firstCreditAt,
    )
  ) {
    return null;
  }

  if (input.movementType === "DEBIT" && amount > balanceBefore + 0.0001) {
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
): Promise<AirlineDepositAccountSummary[]> {
  const movements = await client.airlineDepositMovement.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: {
      airline: { select: { id: true, code: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      ticketSale: { select: { id: true, ticketNumber: true, soldAt: true } },
    },
  });

  const totals = new Map(
    AIRLINE_DEPOSIT_ACCOUNT_CONFIGS.map((config) => [
      config.key,
      { balance: 0, totalCredits: 0, totalDebits: 0 },
    ]),
  );
  const recomputedBalanceAfter = new Map<string, number>();
  const firstCreditByAccount = new Map(
    AIRLINE_DEPOSIT_ACCOUNT_CONFIGS.map((config) => {
      const firstCredit = (movements as AirlineDepositMovementRecord[])
        .filter((movement) => normalizeAccountKey(movement.accountKey) === config.key)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
        .find((movement) => movement.movementType === "CREDIT" && !isAutomaticTicketDepositMovement(movement));
      return [config.key, firstCredit?.createdAt ?? null] as const;
    }),
  );

  [...(movements as AirlineDepositMovementRecord[])]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
    .forEach((movement) => {
      const normalizedAccountKey = normalizeAccountKey(movement.accountKey);
      const firstCreditAt = firstCreditByAccount.get(normalizedAccountKey) ?? null;
      if (shouldIgnoreHistoricalTicketDepositMovement(movement, firstCreditAt)) {
        return;
      }

      const bucket = totals.get(normalizedAccountKey) ?? { balance: 0, totalCredits: 0, totalDebits: 0 };
      bucket.balance += movementSignedAmount(movement.movementType, movement.amount);
      recomputedBalanceAfter.set(movement.id, bucket.balance);
      if (movement.movementType === "CREDIT") {
        bucket.totalCredits += movement.amount;
      } else {
        bucket.totalDebits += movement.amount;
      }
      totals.set(normalizedAccountKey, bucket);
    });

  return AIRLINE_DEPOSIT_ACCOUNT_CONFIGS.map((config) => {
    const bucket = totals.get(config.key) ?? { balance: 0, totalCredits: 0, totalDebits: 0 };
    const firstCreditAt = firstCreditByAccount.get(config.key) ?? null;
    const recentMovements = (movements as AirlineDepositMovementRecord[])
      .filter((movement) => normalizeAccountKey(movement.accountKey) === config.key)
      .filter((movement) => !shouldIgnoreHistoricalTicketDepositMovement(movement, firstCreditAt))
      .slice(0, recentLimit)
      .map((movement) => ({
        id: movement.id,
        movementType: movement.movementType,
        amount: movement.amount,
        balanceAfter: recomputedBalanceAfter.get(movement.id) ?? movement.balanceAfter,
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
