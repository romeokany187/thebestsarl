import { CommissionMode, PrismaClient, TravelClass } from "@prisma/client";

type CatalogRule = {
  ratePercent: number;
  routePattern: string;
  travelClass?: TravelClass;
  commissionMode: CommissionMode;
  systemRatePercent: number;
  markupRatePercent: number;
  depositStockTargetAmount?: number;
  batchCommissionAmount?: number;
};

type CatalogAirline = {
  code: string;
  name: string;
  rules: CatalogRule[];
};

const STARTS_AT = new Date("2026-01-01");

const IMMEDIATE_DEFAULT: CatalogRule = {
  ratePercent: 7,
  routePattern: "*",
  commissionMode: CommissionMode.IMMEDIATE,
  systemRatePercent: 7,
  markupRatePercent: 0,
};

export const AIRLINE_CATALOG: CatalogAirline[] = [
  {
    code: "CAA",
    name: "CAA",
    rules: [
      {
        ratePercent: 0,
        routePattern: "*",
        commissionMode: CommissionMode.AFTER_DEPOSIT,
        systemRatePercent: 0,
        markupRatePercent: 0,
        depositStockTargetAmount: 10000,
        batchCommissionAmount: 650,
      },
    ],
  },
  {
    code: "ACG",
    name: "Air Congo",
    rules: [
      {
        ratePercent: 8,
        routePattern: "BZV-*",
        travelClass: TravelClass.ECONOMY,
        commissionMode: CommissionMode.IMMEDIATE,
        systemRatePercent: 8,
        markupRatePercent: 0,
      },
    ],
  },
  {
    code: "MGB",
    name: "Mont Gabaon",
    rules: [
      {
        ratePercent: 9,
        routePattern: "*",
        commissionMode: CommissionMode.IMMEDIATE,
        systemRatePercent: 9,
        markupRatePercent: 0,
      },
    ],
  },
  {
    code: "FST",
    name: "Air Fast",
    rules: [
      {
        ratePercent: 0,
        routePattern: "*",
        commissionMode: CommissionMode.MARKUP_ONLY,
        systemRatePercent: 0,
        markupRatePercent: 6,
      },
    ],
  },
  {
    code: "ET",
    name: "Ethiopian Airlines",
    rules: [
      {
        ratePercent: 6,
        routePattern: "*",
        commissionMode: CommissionMode.SYSTEM_PLUS_MARKUP,
        systemRatePercent: 6,
        markupRatePercent: 3,
      },
    ],
  },
  {
    code: "KQ",
    name: "Kenya Airways",
    rules: [
      {
        ratePercent: 5,
        routePattern: "*",
        commissionMode: CommissionMode.SYSTEM_PLUS_MARKUP,
        systemRatePercent: 5,
        markupRatePercent: 2,
      },
    ],
  },
  {
    code: "UR",
    name: "Uganda Air",
    rules: [
      {
        ratePercent: 0,
        routePattern: "*",
        commissionMode: CommissionMode.MARKUP_ONLY,
        systemRatePercent: 0,
        markupRatePercent: 5,
      },
    ],
  },
  {
    code: "TC",
    name: "Air Tanzania",
    rules: [
      {
        ratePercent: 0,
        routePattern: "*",
        commissionMode: CommissionMode.MARKUP_ONLY,
        systemRatePercent: 0,
        markupRatePercent: 5,
      },
    ],
  },
  {
    code: "AF",
    name: "Air France",
    rules: [
      {
        ratePercent: 7.5,
        routePattern: "*",
        commissionMode: CommissionMode.IMMEDIATE,
        systemRatePercent: 7.5,
        markupRatePercent: 0,
      },
    ],
  },
  {
    code: "KP",
    name: "ASKY",
    rules: [
      {
        ratePercent: 0,
        routePattern: "*",
        commissionMode: CommissionMode.MARKUP_ONLY,
        systemRatePercent: 0,
        markupRatePercent: 5,
      },
    ],
  },
  {
    code: "WB",
    name: "Rwanda Air",
    rules: [
      {
        ratePercent: 0,
        routePattern: "*",
        commissionMode: CommissionMode.MARKUP_ONLY,
        systemRatePercent: 0,
        markupRatePercent: 5,
      },
    ],
  },
  {
    code: "DKT",
    name: "Dakota",
    rules: [
      {
        ratePercent: 0,
        routePattern: "*",
        commissionMode: CommissionMode.MARKUP_ONLY,
        systemRatePercent: 0,
        markupRatePercent: 5,
      },
    ],
  },
  {
    code: "SN",
    name: "Brussels Airlines",
    rules: [IMMEDIATE_DEFAULT],
  },
  {
    code: "TK",
    name: "Turkish Airlines",
    rules: [IMMEDIATE_DEFAULT],
  },
  {
    code: "QR",
    name: "Qatar Airways",
    rules: [IMMEDIATE_DEFAULT],
  },
];

function isSameRule(
  existing: {
    routePattern: string;
    travelClass: TravelClass | null;
    commissionMode: CommissionMode;
    systemRatePercent: number;
    markupRatePercent: number;
    depositStockTargetAmount: number | null;
    batchCommissionAmount: number | null;
  },
  rule: CatalogRule,
) {
  return (
    existing.routePattern === rule.routePattern
    && existing.travelClass === (rule.travelClass ?? null)
    && existing.commissionMode === rule.commissionMode
    && existing.systemRatePercent === rule.systemRatePercent
    && existing.markupRatePercent === rule.markupRatePercent
    && existing.depositStockTargetAmount === (rule.depositStockTargetAmount ?? null)
    && existing.batchCommissionAmount === (rule.batchCommissionAmount ?? null)
  );
}

export async function ensureAirlineCatalog(prisma: PrismaClient) {
  for (const catalogAirline of AIRLINE_CATALOG) {
    const airline = await prisma.airline.upsert({
      where: { code: catalogAirline.code },
      update: { name: catalogAirline.name },
      create: {
        code: catalogAirline.code,
        name: catalogAirline.name,
      },
    });

    const existingRules = await prisma.commissionRule.findMany({
      where: {
        airlineId: airline.id,
        isActive: true,
      },
      select: {
        routePattern: true,
        travelClass: true,
        commissionMode: true,
        systemRatePercent: true,
        markupRatePercent: true,
        depositStockTargetAmount: true,
        batchCommissionAmount: true,
      },
    });

    for (const rule of catalogAirline.rules) {
      const found = existingRules.some((existing) => isSameRule(existing, rule));
      if (found) {
        continue;
      }

      await prisma.commissionRule.create({
        data: {
          airlineId: airline.id,
          ratePercent: rule.ratePercent,
          routePattern: rule.routePattern,
          travelClass: rule.travelClass,
          commissionMode: rule.commissionMode,
          systemRatePercent: rule.systemRatePercent,
          markupRatePercent: rule.markupRatePercent,
          depositStockTargetAmount: rule.depositStockTargetAmount,
          batchCommissionAmount: rule.batchCommissionAmount,
          startsAt: STARTS_AT,
          isActive: true,
        },
      });
    }
  }
}