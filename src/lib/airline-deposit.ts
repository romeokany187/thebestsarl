import { Prisma } from "@prisma/client";
import { getTicketDepositDebitAmount } from "@/lib/ticket-pricing";

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
  ticketSale?: { id: string; ticketNumber: string; soldAt: Date } | null;
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

export const AIRLINE_TICKET_DEPOSIT_START_ISO = "2026-04-01";
export const AIRLINE_TICKET_DEPOSIT_START_DATE = new Date(Date.UTC(2026, 3, 1, 0, 0, 0, 0));
export const AIRLINE_TICKET_DEPOSIT_START_LABEL = "01/04/2026";

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

function isTicketGeneratedDepositMovement(input: {
  reference?: string | null;
  description?: string | null;
  ticketSaleId?: string | null;
}) {
  const reference = (input.reference ?? "").trim().toUpperCase();
  const description = (input.description ?? "").trim().toLowerCase();

  return Boolean(input.ticketSaleId)
    || reference.startsWith("PNR ")
    || reference.startsWith("AJUST ")
    || reference.startsWith("TRANSFERT ")
    || reference.startsWith("ANNUL ")
    || reference.startsWith("REMIMPORT ")
    || description.startsWith("débit automatique billet")
    || description.startsWith("ajustement débit billet")
    || description.startsWith("ajustement crédit billet")
    || description.startsWith("restitution ancienne compagnie pour billet")
    || description.startsWith("restitution après suppression billet")
    || description.startsWith("restitution suite remplacement import");
}

function ticketGeneratedMovementWhere() {
  return {
    OR: [
      { ticketSaleId: { not: null } },
      { reference: { startsWith: "PNR " } },
      { reference: { startsWith: "AJUST " } },
      { reference: { startsWith: "TRANSFERT " } },
      { reference: { startsWith: "ANNUL " } },
      { reference: { startsWith: "REMIMPORT " } },
      { description: { startsWith: "Débit automatique billet" } },
      { description: { startsWith: "Ajustement débit billet" } },
      { description: { startsWith: "Ajustement crédit billet" } },
      { description: { startsWith: "Restitution ancienne compagnie pour billet" } },
      { description: { startsWith: "Restitution après suppression billet" } },
      { description: { startsWith: "Restitution suite remplacement import" } },
    ],
  };
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function resolveTicketMovementAnchorDate(input: {
  createdAt?: Date | null;
  ticketSoldAt?: Date | null;
  ticketSale?: { soldAt?: Date | null } | null;
}) {
  return input.ticketSoldAt ?? input.ticketSale?.soldAt ?? input.createdAt ?? null;
}

function isTrackedTicketDepositDate(date: Date | null | undefined) {
  return Boolean(date && startOfUtcDay(date).getTime() >= AIRLINE_TICKET_DEPOSIT_START_DATE.getTime());
}

function shouldIgnoreAirlineDepositMovement(input: {
  reference?: string | null;
  description?: string | null;
  ticketSaleId?: string | null;
  createdAt?: Date | null;
  ticketSoldAt?: Date | null;
  ticketSale?: { soldAt?: Date | null } | null;
}) {
  if (!isTicketGeneratedDepositMovement(input)) {
    return false;
  }

  return !isTrackedTicketDepositDate(resolveTicketMovementAnchorDate(input));
}

async function hasTrackedTicketMovement(
  client: {
    airlineDepositMovement: { findMany: (args?: any) => Promise<any[]> };
  },
  ticketSaleId: string,
) {
  const movements = await client.airlineDepositMovement.findMany({
    where: { ticketSaleId },
    select: {
      ticketSaleId: true,
      reference: true,
      description: true,
      createdAt: true,
      ticketSale: { select: { soldAt: true } },
    },
  });

  return movements.some((movement) => !shouldIgnoreAirlineDepositMovement(movement));
}

async function syncEligibleTicketDepositMovements(
  client: {
    airlineDepositMovement: { findMany: (args?: any) => Promise<any[]>; create?: (args: any) => Promise<unknown> };
    ticketSale?: { findMany: (args?: any) => Promise<any[]> };
  },
  options?: { excludeTicketSaleId?: string | null },
) {
  const ticketClient = client.ticketSale;
  const movementClient = client.airlineDepositMovement;

  if (typeof ticketClient?.findMany !== "function" || typeof movementClient.create !== "function") {
    return;
  }

  const trackedAirlineCodes = Array.from(accountByAirlineCode.keys());
  if (!trackedAirlineCodes.length) {
    return;
  }

  const tickets = await ticketClient.findMany({
    where: {
      soldAt: { gte: AIRLINE_TICKET_DEPOSIT_START_DATE },
      ...(options?.excludeTicketSaleId ? { id: { not: options.excludeTicketSaleId } } : {}),
      airline: { code: { in: trackedAirlineCodes } },
    },
    select: {
      id: true,
      ticketNumber: true,
      soldAt: true,
      amount: true,
      agencyMarkupAmount: true,
      commissionAmount: true,
      commissionModeApplied: true,
      commissionCalculationStatus: true,
      commissionBaseAmount: true,
      baseFareAmount: true,
      airlineId: true,
      airline: { select: { code: true, name: true } },
    },
  });

  if (!tickets.length) {
    return;
  }

  const existingMovements = await movementClient.findMany({
    where: { ticketSaleId: { in: tickets.map((ticket) => ticket.id) } },
    select: {
      ticketSaleId: true,
      reference: true,
      description: true,
      createdAt: true,
      ticketSale: { select: { soldAt: true } },
    },
  });

  const trackedTicketIds = new Set<string>();
  for (const movement of existingMovements) {
    if (movement.ticketSaleId && !shouldIgnoreAirlineDepositMovement(movement)) {
      trackedTicketIds.add(movement.ticketSaleId);
    }
  }

  for (const ticket of tickets) {
    if (trackedTicketIds.has(ticket.id)) {
      continue;
    }

    const depositAccount = getAirlineDepositAccountByAirlineCode(ticket.airline?.code ?? null);
    if (!depositAccount) {
      continue;
    }

    const amount = getTicketDepositDebitAmount({
      amount: ticket.amount,
      agencyMarkupAmount: ticket.agencyMarkupAmount,
      commissionAmount: ticket.commissionAmount,
      commissionModeApplied: ticket.commissionModeApplied,
      commissionCalculationStatus: ticket.commissionCalculationStatus,
      commissionBaseAmount: ticket.commissionBaseAmount,
      baseFareAmount: ticket.baseFareAmount,
      airline: { code: ticket.airline.code },
    });

    if (amount <= 0) {
      continue;
    }

    await movementClient.create({
      data: {
        accountKey: depositAccount.key,
        accountLabel: depositAccount.label,
        movementType: "DEBIT",
        amount,
        balanceAfter: null,
        reference: `PNR ${ticket.ticketNumber}`,
        description: `Débit automatique billet ${ticket.ticketNumber} - ${ticket.airline.name}`,
        airlineId: ticket.airlineId,
        ticketSaleId: ticket.id,
        createdAt: ticket.soldAt,
      },
    });

    trackedTicketIds.add(ticket.id);
  }
}

export async function getAirlineDepositBalance(
  client: Prisma.TransactionClient,
  accountKey: string,
  options?: { upTo?: Date },
) {
  const movementClient = (client as unknown as {
    airlineDepositMovement: {
      findMany: (args?: any) => Promise<Array<{
        amount: number;
        movementType: AirlineDepositMovementTypeValue;
        reference?: string | null;
        description?: string | null;
        ticketSaleId?: string | null;
        createdAt?: Date | null;
        ticketSale?: { soldAt?: Date | null } | null;
      }>>;
    };
  }).airlineDepositMovement;
  const movements = await movementClient.findMany({
    where: {
      accountKey: { in: accountKeysForLookup(accountKey) },
      ...(options?.upTo ? { createdAt: { lte: options.upTo } } : {}),
    },
    select: {
      amount: true,
      movementType: true,
      reference: true,
      description: true,
      ticketSaleId: true,
      createdAt: true,
      ticketSale: { select: { soldAt: true } },
    },
  });

  return movements
    .filter((movement) => !shouldIgnoreAirlineDepositMovement(movement))
    .reduce(
      (sum: number, movement: { amount: number; movementType: AirlineDepositMovementTypeValue }) => sum + movementSignedAmount(movement.movementType, movement.amount),
      0,
    );
}

async function getFirstAirlineDepositCreditDate(client: Prisma.TransactionClient, accountKey: string) {
  const movementClient = (client as unknown as { airlineDepositMovement: { findMany: (args?: any) => Promise<Array<{ createdAt: Date; reference?: string | null; description?: string | null; ticketSaleId?: string | null }>> } }).airlineDepositMovement;
  const credits = await movementClient.findMany({
    where: {
      accountKey: { in: accountKeysForLookup(accountKey) },
      movementType: "CREDIT",
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { createdAt: true, reference: true, description: true, ticketSaleId: true },
  });

  const firstCredit = credits.find((movement) => !isTicketGeneratedDepositMovement(movement));
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
    ticketSoldAt?: Date | null;
    createdById?: string | null;
    createdAt?: Date;
  },
) {
  const account = getAirlineDepositAccountByKey(input.accountKey);
  if (!account) {
    throw new Error(`INVALID_AIRLINE_DEPOSIT_ACCOUNT:${input.accountKey}`);
  }

  const ticketGeneratedMovement = isTicketGeneratedDepositMovement({
    reference: input.reference,
    description: input.description,
    ticketSaleId: input.ticketSaleId,
  });

  if (ticketGeneratedMovement && !isTrackedTicketDepositDate(input.ticketSoldAt ?? input.createdAt ?? null)) {
    return null;
  }

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("INVALID_AIRLINE_DEPOSIT_AMOUNT");
  }

  const movementSupportClient = client as unknown as {
    airlineDepositMovement: { findMany: (args?: any) => Promise<any[]>; create?: (args: any) => Promise<unknown> };
    ticketSale?: { findMany: (args?: any) => Promise<any[]> };
  };

  const isBaseTicketDebit = ticketGeneratedMovement
    && input.movementType === "DEBIT"
    && input.reference.trim().toUpperCase().startsWith("PNR ");

  if (ticketGeneratedMovement && input.ticketSaleId) {
    const ticketHasTrackedHistory = await hasTrackedTicketMovement(movementSupportClient, input.ticketSaleId);
    if (!ticketHasTrackedHistory && !isBaseTicketDebit) {
      return null;
    }
  }

  await syncEligibleTicketDepositMovements(movementSupportClient, {
    excludeTicketSaleId: isBaseTicketDebit ? input.ticketSaleId ?? null : null,
  });

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
  client: {
    airlineDepositMovement: { findMany: (args?: any) => Promise<any[]>; create?: (args?: any) => Promise<unknown>; deleteMany?: (args?: any) => Promise<unknown> };
    ticketSale?: { findMany: (args?: any) => Promise<any[]> };
  },
  recentLimit = 6,
  options?: { upTo?: Date },
): Promise<AirlineDepositAccountSummary[]> {
  await syncEligibleTicketDepositMovements(client);

  const movements = await client.airlineDepositMovement.findMany({
    where: {
      ...(options?.upTo ? { createdAt: { lte: options.upTo } } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: {
      airline: { select: { id: true, code: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      ticketSale: { select: { id: true, ticketNumber: true, soldAt: true } },
    },
  });

  const filteredMovements = (movements as AirlineDepositMovementRecord[]).filter(
    (movement) => !shouldIgnoreAirlineDepositMovement({
      reference: movement.reference,
      description: movement.description,
      ticketSaleId: movement.ticketSale?.id ?? null,
      createdAt: movement.createdAt,
      ticketSale: movement.ticketSale,
    }),
  );

  const totals = new Map(
    AIRLINE_DEPOSIT_ACCOUNT_CONFIGS.map((config) => [
      config.key,
      { balance: 0, totalCredits: 0, totalDebits: 0 },
    ]),
  );

  [...filteredMovements]
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
    const recentMovements = filteredMovements
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
