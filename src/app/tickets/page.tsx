import { AppShell } from "@/components/app-shell";
import { KpiCard } from "@/components/kpi-card";
import { requirePageModuleAccess } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { ensureAirlineCatalog } from "@/lib/airline-catalog";
import { computeCaaCommissionMap } from "@/lib/caa-commission";

export const dynamic = "force-dynamic";

type ReportMode = "date" | "month" | "year" | "semester";

type SearchParams = {
  startDate?: string;
  endDate?: string;
  mode?: string;
  date?: string;
  month?: string;
  year?: string;
  semester?: string;
  semesterYear?: string;
};

function parseYear(value?: string) {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 2000 || parsed > 2100) return null;
  return parsed;
}

function dateRangeFromParams(params: SearchParams) {
  const now = new Date();
  const defaultStartOfYear = `${now.getUTCFullYear()}-01-01`;

  if (params.startDate || params.endDate) {
    const startRaw = params.startDate ?? defaultStartOfYear;
    const endRaw = params.endDate ?? startRaw;
    const start = new Date(`${startRaw}T00:00:00.000Z`);
    const end = new Date(`${endRaw}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);

    return {
      mode: "date" as ReportMode,
      start,
      end,
      label: `Rapport du ${startRaw} au ${endRaw}`,
    };
  }

  const mode = (["date", "month", "year", "semester"].includes(params.mode ?? "")
    ? params.mode
    : "date") as ReportMode;

  if (mode === "date") {
    if (!params.date && !params.startDate && !params.endDate) {
      const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));
      return {
        mode,
        start,
        end,
        label: `Rapport du ${start.toISOString().slice(0, 10)} au ${new Date(end.getTime() - 1).toISOString().slice(0, 10)}`,
      };
    }

    const rawDate = params.date;
    const date = rawDate ? new Date(`${rawDate}T00:00:00.000Z`) : now;
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    const day = date.getUTCDate();
    const start = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year, month, day + 1, 0, 0, 0, 0));
    return {
      mode,
      start,
      end,
      label: `Rapport du ${start.toISOString().slice(0, 10)}`,
    };
  }

  if (mode === "year") {
    const year = parseYear(params.year) ?? now.getUTCFullYear();
    const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0, 0));
    return {
      mode,
      start,
      end,
      label: `Rapport annuel ${year}`,
    };
  }

  if (mode === "semester") {
    const semester = params.semester === "2" ? 2 : 1;
    const year = parseYear(params.semesterYear) ?? now.getUTCFullYear();
    const startMonth = semester === 1 ? 0 : 6;
    const endMonth = semester === 1 ? 6 : 12;
    const start = new Date(Date.UTC(year, startMonth, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year, endMonth, 1, 0, 0, 0, 0));
    return {
      mode,
      start,
      end,
      label: `Rapport S${semester} ${year}`,
    };
  }

  const rawMonth = params.month;
  const monthMatch = rawMonth?.match(/^(\d{4})-(\d{2})$/);
  const year = monthMatch ? Number.parseInt(monthMatch[1], 10) : now.getUTCFullYear();
  const month = monthMatch ? Number.parseInt(monthMatch[2], 10) - 1 : now.getUTCMonth();
  const safeMonth = Math.min(11, Math.max(0, month));
  const start = new Date(Date.UTC(year, safeMonth, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, safeMonth + 1, 1, 0, 0, 0, 0));

  return {
    mode,
    start,
    end,
    label: `Rapport mensuel ${start.toISOString().slice(0, 7)}`,
  };
}

function formatCurrency(value: number) {
  return `${value.toFixed(2)} USD`;
}

function compactDate(value: string) {
  return value ? value.slice(5) : "--";
}

function formatMonthLabel(value: Date) {
  return new Intl.DateTimeFormat("fr-FR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);
}

function calculateGrowthPercent(current: number, reference: number) {
  if (reference > 0) {
    return ((current - reference) / reference) * 100;
  }

  return current > 0 ? 100 : 0;
}

function previousMonthRange(currentRange: { start: Date }) {
  const start = new Date(Date.UTC(
    currentRange.start.getUTCFullYear(),
    currentRange.start.getUTCMonth() - 1,
    1,
    0,
    0,
    0,
    0,
  ));
  const end = new Date(Date.UTC(
    currentRange.start.getUTCFullYear(),
    currentRange.start.getUTCMonth(),
    1,
    0,
    0,
    0,
    0,
  ));

  return { start, end };
}

function buildDailyTimeline(start: Date, endExclusive: Date) {
  const days: string[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), 0, 0, 0, 0));
  const end = new Date(Date.UTC(
    endExclusive.getUTCFullYear(),
    endExclusive.getUTCMonth(),
    endExclusive.getUTCDate(),
    0,
    0,
    0,
    0,
  ));

  while (cursor < end) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return days;
}

function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 0, 0, 0, 0));
}

function sparklinePath(values: number[], width: number, height: number) {
  if (values.length === 0) return "";
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 1);

  return values
    .map((value, index) => {
      const x = values.length === 1 ? 0 : (index / (values.length - 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function detectAgencyFromPayer(payerName: string | null | undefined) {
  const raw = (payerName ?? "").trim();
  if (!raw) return "Autres";

  const normalized = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const compact = normalized.replace(/[^a-z0-9]/g, "");

  if (compact.includes("mbujimayi") || compact.includes("mbujimai")) return "Mbujimayi";
  if (compact.includes("lubumbashi")) return "Lubumbashi";
  if (compact.includes("kinshasa")) return "Kinshasa";
  if (compact.includes("hkservice")) return "HKSERVICE";

  return raw;
}

export default async function TicketsPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const range = dateRangeFromParams(resolvedSearchParams);
  const now = new Date();
  const currentDate = now.toISOString().slice(0, 10);
  const currentMonth = now.toISOString().slice(0, 7);
  const currentStartDate = resolvedSearchParams.startDate ?? `${now.getUTCFullYear()}-01-01`;
  const currentEndDate = resolvedSearchParams.endDate ?? currentDate;
  const selectedMonth = resolvedSearchParams.month ?? currentMonth;
  const monthComparisonRange = range.mode === "month" ? previousMonthRange(range) : null;
  const isMonthComparison = monthComparisonRange !== null;
  const { session, role } = await requirePageModuleAccess("tickets", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  const roleTicketFilter = role === "EMPLOYEE" ? { sellerId: session.user.id } : {};

  await ensureAirlineCatalog(prisma);

  const whereClause = {
    ...roleTicketFilter,
    soldAt: {
      gte: range.start,
      lt: range.end,
    },
  };

  const [ticketsForMetrics, comparisonTickets, airlineTracking, caaConsumedAggregate] = await Promise.all([
    prisma.ticketSale.findMany({
      where: whereClause,
      include: {
        airline: true,
        seller: { select: { name: true } },
      },
      orderBy: { soldAt: "desc" },
    }),
    monthComparisonRange
      ? prisma.ticketSale.findMany({
        where: {
          ...roleTicketFilter,
          soldAt: {
            gte: monthComparisonRange.start,
            lt: monthComparisonRange.end,
          },
        },
        include: {
          airline: true,
          seller: { select: { name: true } },
        },
        orderBy: { soldAt: "desc" },
      })
      : Promise.resolve([]),
    prisma.airline.findMany({
      where: { code: { in: ["CAA", "FST"] } },
      include: { commissionRules: { where: { isActive: true } } },
    }),
    prisma.ticketSale.aggregate({
      where: {
        ...roleTicketFilter,
        airline: { code: "CAA" },
      },
      _sum: { amount: true },
    }),
  ]);

  const caaAirline = airlineTracking.find((airline) => airline.code === "CAA");
  const caaRule = caaAirline?.commissionRules
    .filter((rule) => rule.isActive && rule.commissionMode === "AFTER_DEPOSIT")
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())[0];
  const caaTargetAmount = caaRule?.depositStockTargetAmount ?? 0;
  const caaBatchCommission = caaRule?.batchCommissionAmount ?? 0;
  const caaConsumed = caaConsumedAggregate._sum.amount ?? 0;
  const caaLotsReached = caaTargetAmount > 0 ? Math.floor(caaConsumed / caaTargetAmount) : 0;
  const caaCommissionEarned = caaLotsReached * caaBatchCommission;
  const caaRemainder = caaTargetAmount > 0 ? caaConsumed % caaTargetAmount : 0;
  const caaRemainingToNextLot = caaTargetAmount > 0
    ? caaConsumed === 0
      ? caaTargetAmount
      : caaRemainder === 0
        ? 0
        : Math.max(0, caaTargetAmount - caaRemainder)
    : 0;

  const [orderedCurrentCaaTickets, orderedComparisonCaaTickets] = caaAirline
    ? await Promise.all([
      prisma.ticketSale.findMany({
        where: {
          ...roleTicketFilter,
          airlineId: caaAirline.id,
          soldAt: { lt: range.end },
        },
        select: { id: true, soldAt: true, amount: true },
        orderBy: [{ soldAt: "asc" }, { id: "asc" }],
      }),
      monthComparisonRange
        ? prisma.ticketSale.findMany({
          where: {
            ...roleTicketFilter,
            airlineId: caaAirline.id,
            soldAt: { lt: monthComparisonRange.end },
          },
          select: { id: true, soldAt: true, amount: true },
          orderBy: [{ soldAt: "asc" }, { id: "asc" }],
        })
        : Promise.resolve([]),
    ])
    : [[], []];

  const periodCaaCommissionMap = caaAirline
    ? computeCaaCommissionMap({
      periodTicketIds: ticketsForMetrics
        .filter((ticket) => ticket.airlineId === caaAirline.id)
        .map((ticket) => ticket.id),
      orderedCaaTicketsUntilPeriodEnd: orderedCurrentCaaTickets,
      targetAmount: caaTargetAmount,
      batchCommissionAmount: caaBatchCommission,
    })
    : new Map<string, number>();

  const comparisonCaaCommissionMap = caaAirline && monthComparisonRange
    ? computeCaaCommissionMap({
      periodTicketIds: comparisonTickets
        .filter((ticket) => ticket.airlineId === caaAirline.id)
        .map((ticket) => ticket.id),
      orderedCaaTicketsUntilPeriodEnd: orderedComparisonCaaTickets,
      targetAmount: caaTargetAmount,
      batchCommissionAmount: caaBatchCommission,
    })
    : new Map<string, number>();

  const metricCommissionOf = (ticket: { id: string; airline: { code: string }; amount: number; commissionAmount: number | null; commissionRateUsed: number }) => {
    if (ticket.airline.code === "CAA" && periodCaaCommissionMap.has(ticket.id)) {
      return periodCaaCommissionMap.get(ticket.id) ?? 0;
    }
    return ticket.commissionAmount ?? ticket.amount * (ticket.commissionRateUsed / 100);
  };

  const comparisonCommissionOf = (ticket: { id: string; airline: { code: string }; amount: number; commissionAmount: number | null; commissionRateUsed: number }) => {
    if (ticket.airline.code === "CAA" && comparisonCaaCommissionMap.has(ticket.id)) {
      return comparisonCaaCommissionMap.get(ticket.id) ?? 0;
    }
    return ticket.commissionAmount ?? ticket.amount * (ticket.commissionRateUsed / 100);
  };

  const totalSales = ticketsForMetrics.reduce((sum, ticket) => sum + ticket.amount, 0);
  const totalCommissions = ticketsForMetrics.reduce((sum, ticket) => sum + metricCommissionOf(ticket), 0);
  const totalTickets = ticketsForMetrics.length;
  const comparisonTotalSales = comparisonTickets.reduce((sum, ticket) => sum + ticket.amount, 0);
  const comparisonTotalCommissions = comparisonTickets.reduce((sum, ticket) => sum + comparisonCommissionOf(ticket), 0);
  const comparisonTotalTickets = comparisonTickets.length;

  const salesByAirline = Array.from(
    ticketsForMetrics.reduce((map, ticket) => {
      const key = ticket.airline.code;
      const commission = metricCommissionOf(ticket);
      const existing = map.get(key) ?? {
        code: ticket.airline.code,
        name: ticket.airline.name,
        tickets: 0,
        sales: 0,
        commissions: 0,
      };
      existing.tickets += 1;
      existing.sales += ticket.amount;
      existing.commissions += commission;
      map.set(key, existing);
      return map;
    }, new Map<string, { code: string; name: string; tickets: number; sales: number; commissions: number }>()),
  ).sort((a, b) => b[1].sales - a[1].sales).map((item) => item[1]);

  const dailyPerformanceMap = ticketsForMetrics.reduce((map, ticket) => {
    const key = new Date(ticket.soldAt).toISOString().slice(0, 10);
    const commission = metricCommissionOf(ticket);
    const existing = map.get(key) ?? {
      day: key,
      sales: 0,
      commissions: 0,
      tickets: 0,
    };
    existing.sales += ticket.amount;
    existing.commissions += commission;
    existing.tickets += 1;
    map.set(key, existing);
    return map;
  }, new Map<string, { day: string; sales: number; commissions: number; tickets: number }>());

  const comparisonDailyPerformanceMap = comparisonTickets.reduce((map, ticket) => {
    const key = new Date(ticket.soldAt).toISOString().slice(0, 10);
    const commission = comparisonCommissionOf(ticket);
    const existing = map.get(key) ?? {
      day: key,
      sales: 0,
      commissions: 0,
      tickets: 0,
    };
    existing.sales += ticket.amount;
    existing.commissions += commission;
    existing.tickets += 1;
    map.set(key, existing);
    return map;
  }, new Map<string, { day: string; sales: number; commissions: number; tickets: number }>());

  const dailyPerformance = buildDailyTimeline(startOfUtcDay(range.start), startOfUtcDay(range.end)).map((day) => {
    const existing = dailyPerformanceMap.get(day);
    if (existing) return existing;
    return {
      day,
      sales: 0,
      commissions: 0,
      tickets: 0,
    };
  });

  const comparisonDailyPerformance = monthComparisonRange
    ? buildDailyTimeline(startOfUtcDay(monthComparisonRange.start), startOfUtcDay(monthComparisonRange.end)).map((day) => {
      const existing = comparisonDailyPerformanceMap.get(day);
      if (existing) return existing;
      return {
        day,
        sales: 0,
        commissions: 0,
        tickets: 0,
      };
    })
    : [];

  const cumulativeDailyPerformance = dailyPerformance.reduce((state, point) => {
    const sales = state.runningSales + point.sales;
    const commissions = state.runningCommissions + point.commissions;
    const tickets = state.runningTickets + point.tickets;

    return {
      runningSales: sales,
      runningCommissions: commissions,
      runningTickets: tickets,
      points: [
        ...state.points,
        {
          day: point.day,
          sales,
          commissions,
          tickets,
        },
      ],
    };
  }, {
    runningSales: 0,
    runningCommissions: 0,
    runningTickets: 0,
    points: [] as Array<{ day: string; sales: number; commissions: number; tickets: number }>,
  }).points;

  const comparisonCumulativeDailyPerformance = comparisonDailyPerformance.reduce((state, point) => {
    const sales = state.runningSales + point.sales;
    const commissions = state.runningCommissions + point.commissions;
    const tickets = state.runningTickets + point.tickets;

    return {
      runningSales: sales,
      runningCommissions: commissions,
      runningTickets: tickets,
      points: [
        ...state.points,
        {
          day: point.day,
          sales,
          commissions,
          tickets,
        },
      ],
    };
  }, {
    runningSales: 0,
    runningCommissions: 0,
    runningTickets: 0,
    points: [] as Array<{ day: string; sales: number; commissions: number; tickets: number }>,
  }).points;

  const salesCurvePath = sparklinePath(cumulativeDailyPerformance.map((point) => point.sales), 280, 80);
  const commissionCurvePath = sparklinePath(cumulativeDailyPerformance.map((point) => point.commissions), 280, 80);
  const comparisonSalesCurvePath = sparklinePath(comparisonCumulativeDailyPerformance.map((point) => point.sales), 280, 80);
  const comparisonCommissionCurvePath = sparklinePath(comparisonCumulativeDailyPerformance.map((point) => point.commissions), 280, 80);
  const firstPointWithSales = cumulativeDailyPerformance.find((point) => point.sales > 0);
  const firstPointWithCommissions = cumulativeDailyPerformance.find((point) => point.commissions > 0);
  const salesStart = firstPointWithSales?.sales ?? cumulativeDailyPerformance[0]?.sales ?? 0;
  const salesEnd = cumulativeDailyPerformance[cumulativeDailyPerformance.length - 1]?.sales ?? 0;
  const salesTrendPercent = isMonthComparison ? calculateGrowthPercent(totalSales, comparisonTotalSales) : calculateGrowthPercent(salesEnd, salesStart);
  const commissionStart = firstPointWithCommissions?.commissions ?? cumulativeDailyPerformance[0]?.commissions ?? 0;
  const commissionEnd = cumulativeDailyPerformance[cumulativeDailyPerformance.length - 1]?.commissions ?? 0;
  const commissionTrendPercent = isMonthComparison
    ? calculateGrowthPercent(totalCommissions, comparisonTotalCommissions)
    : calculateGrowthPercent(commissionEnd, commissionStart);

  const topAirline = salesByAirline[0] ?? null;
  const topAirlineShare = totalTickets > 0 && topAirline ? (topAirline.tickets / totalTickets) * 100 : 0;
  const topAirlineBars = salesByAirline.slice(0, 4);

  const agencySales = Array.from(
    ticketsForMetrics.reduce((map, ticket) => {
      const key = detectAgencyFromPayer(ticket.payerName);
      const existing = map.get(key) ?? { agency: key, tickets: 0, sales: 0, commissions: 0 };
      const commission = metricCommissionOf(ticket);
      existing.tickets += 1;
      existing.sales += ticket.amount;
      existing.commissions += commission;
      map.set(key, existing);
      return map;
    }, new Map<string, { agency: string; tickets: number; sales: number; commissions: number }>()),
  ).map((entry) => entry[1]).sort((a, b) => b.sales - a.sales);

  const topAgency = agencySales[0] ?? null;
  const topAgencyBars = agencySales.slice(0, 4);
  const maxTopAirlineSales = topAirlineBars.reduce((max, item) => Math.max(max, item.sales), 0);
  const maxTopAgencySales = topAgencyBars.reduce((max, item) => Math.max(max, item.sales), 0);

  const comparisonSalesByAirline = Array.from(
    comparisonTickets.reduce((map, ticket) => {
      const key = ticket.airline.code;
      const commission = comparisonCommissionOf(ticket);
      const existing = map.get(key) ?? {
        code: ticket.airline.code,
        name: ticket.airline.name,
        tickets: 0,
        sales: 0,
        commissions: 0,
      };
      existing.tickets += 1;
      existing.sales += ticket.amount;
      existing.commissions += commission;
      map.set(key, existing);
      return map;
    }, new Map<string, { code: string; name: string; tickets: number; sales: number; commissions: number }>()),
  ).sort((a, b) => b[1].sales - a[1].sales).map((item) => item[1]);

  const comparisonAgencySales = Array.from(
    comparisonTickets.reduce((map, ticket) => {
      const key = detectAgencyFromPayer(ticket.payerName);
      const existing = map.get(key) ?? { agency: key, tickets: 0, sales: 0, commissions: 0 };
      const commission = comparisonCommissionOf(ticket);
      existing.tickets += 1;
      existing.sales += ticket.amount;
      existing.commissions += commission;
      map.set(key, existing);
      return map;
    }, new Map<string, { agency: string; tickets: number; sales: number; commissions: number }>()),
  ).map((entry) => entry[1]).sort((a, b) => b.sales - a.sales);

  const comparisonTopAirline = comparisonSalesByAirline[0] ?? null;
  const comparisonTopAgency = comparisonAgencySales[0] ?? null;

  const periodProgressPercent = isMonthComparison
    ? calculateGrowthPercent(totalSales, comparisonTotalSales)
    : calculateGrowthPercent(salesEnd, salesStart);
  const periodProgressLabel = `${periodProgressPercent >= 0 ? "+" : ""}${periodProgressPercent.toFixed(1)}%`;
  const ticketsGrowthPercent = calculateGrowthPercent(totalTickets, comparisonTotalTickets);
  const selectedMonthLabel = isMonthComparison ? formatMonthLabel(range.start) : null;
  const previousMonthLabel = monthComparisonRange ? formatMonthLabel(monthComparisonRange.start) : null;

  const airFastAirline = airlineTracking.find((airline) => airline.code === "FST");
  const airFastTicketCount = airFastAirline
    ? await prisma.ticketSale.count({
      where: {
        airlineId: airFastAirline.id,
        ...roleTicketFilter,
      },
    })
    : 0;
  const airFastNextBonusIn = airFastAirline ? 13 - (airFastTicketCount % 13 || 13) : 0;
  const airFastBonusReached = airFastAirline ? Math.floor(airFastTicketCount / 13) : 0;

  const accessNote =
    role === "EMPLOYEE"
      ? "Accès personnel: visualisation de vos billets vendus."
      : "Accès opérationnel: visualisation complète des billets de l'agence.";

  return (
    <AppShell role={role} accessNote={accessNote}>
      <section className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Billets</h1>
        <p className="text-sm text-black/60 dark:text-white/60">Suivi détaillé des ventes et des statuts d&apos;encaissement.</p>
      </section>

      <section className="mb-6 rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
        <form method="GET" className="grid gap-3 lg:grid-cols-5 lg:items-end">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Du</label>
            <input
              type="date"
              name="startDate"
              defaultValue={currentStartDate}
              className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Au</label>
            <input
              type="date"
              name="endDate"
              defaultValue={currentEndDate}
              className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Mois à comparer</label>
            <input
              type="month"
              name="month"
              defaultValue={selectedMonth}
              className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            />
          </div>

          <div className="flex flex-wrap gap-2 lg:col-span-2">
            <button
              type="submit"
              name="mode"
              value="date"
              className="rounded-md bg-black px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black"
            >
              Afficher période
            </button>
            <button
              type="submit"
              name="mode"
              value="month"
              className="rounded-md border border-black/15 bg-white px-4 py-2 text-sm font-semibold dark:border-white/15 dark:bg-zinc-900"
            >
              Comparer mois
            </button>
            <button
              type="submit"
              formAction="/api/tickets/report"
              formTarget="_blank"
              name="mode"
              value="date"
              className="rounded-md border border-black/15 bg-white px-4 py-2 text-sm font-semibold dark:border-white/15 dark:bg-zinc-900"
            >
              PDF période
            </button>
            <button
              type="submit"
              formAction="/api/tickets/report"
              formTarget="_blank"
              name="mode"
              value="month"
              className="rounded-md border border-black/15 bg-white px-4 py-2 text-sm font-semibold dark:border-white/15 dark:bg-zinc-900"
            >
              PDF mois
            </button>
          </div>
        </form>

        <p className="mt-3 text-xs text-black/60 dark:text-white/60">
          {range.label} • Période du {range.start.toISOString().slice(0, 10)} au {new Date(range.end.getTime() - 1).toISOString().slice(0, 10)}
        </p>
      </section>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Billets vendus"
          value={String(totalTickets)}
          hint={isMonthComparison ? `${previousMonthLabel}: ${comparisonTotalTickets} • Δ ${ticketsGrowthPercent >= 0 ? "+" : ""}${ticketsGrowthPercent.toFixed(1)}%` : undefined}
        />
        <KpiCard
          label="Ventes totales"
          value={`${totalSales.toFixed(2)} USD`}
          hint={isMonthComparison ? `${previousMonthLabel}: ${comparisonTotalSales.toFixed(2)} USD` : undefined}
        />
        <KpiCard
          label="Commissions"
          value={`${totalCommissions.toFixed(2)} USD`}
          hint={isMonthComparison ? `${previousMonthLabel}: ${comparisonTotalCommissions.toFixed(2)} USD` : undefined}
        />
        <KpiCard
          label="Marge de progression"
          value={periodProgressLabel}
          hint={isMonthComparison
            ? `${selectedMonthLabel}: ${totalSales.toFixed(2)} USD • ${previousMonthLabel}: ${comparisonTotalSales.toFixed(2)} USD`
            : `Début: ${salesStart.toFixed(2)} USD • Fin: ${salesEnd.toFixed(2)} USD`}
        />
      </div>

      <section className="mb-6 rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
        <h2 className="mb-3 text-sm font-semibold">Moniteur de performance</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-black/10 p-3 dark:border-white/10">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Progression ventes cumulées</p>
              <p className={`text-xs font-semibold ${salesTrendPercent >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                {salesTrendPercent >= 0 ? "+" : ""}{salesTrendPercent.toFixed(1)}%
              </p>
            </div>
            <p className="text-sm font-semibold">{formatCurrency(salesEnd)}</p>
            <p className="mb-2 text-[11px] text-black/60 dark:text-white/60">
              {isMonthComparison
                ? `${selectedMonthLabel} • M-1 ${previousMonthLabel}: ${formatCurrency(comparisonTotalSales)}`
                : `Cumul période • Début ${formatCurrency(salesStart)}`}
            </p>
            <svg viewBox="0 0 280 80" className="h-20 w-full">
              {isMonthComparison && comparisonSalesCurvePath ? (
                <path d={comparisonSalesCurvePath} fill="none" stroke="currentColor" strokeWidth="1.6" className="text-black/25 dark:text-white/25" />
              ) : null}
              <path d={salesCurvePath} fill="none" stroke="currentColor" strokeWidth="2.2" className="text-black dark:text-white" />
            </svg>
            <div className="mt-1 flex justify-between text-[10px] text-black/45 dark:text-white/45">
              <span>{compactDate(cumulativeDailyPerformance[0]?.day ?? "")}</span>
              <span>{compactDate(cumulativeDailyPerformance[cumulativeDailyPerformance.length - 1]?.day ?? "")}</span>
            </div>
            {isMonthComparison ? <p className="mt-1 text-[10px] text-black/45 dark:text-white/45">Ligne claire: {previousMonthLabel}</p> : null}
          </div>

          <div className="rounded-xl border border-black/10 p-3 dark:border-white/10">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Progression commissions cumulées</p>
              <p className={`text-xs font-semibold ${commissionTrendPercent >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                {commissionTrendPercent >= 0 ? "+" : ""}{commissionTrendPercent.toFixed(1)}%
              </p>
            </div>
            <p className="text-sm font-semibold">{formatCurrency(commissionEnd)}</p>
            <p className="mb-2 text-[11px] text-black/60 dark:text-white/60">
              {isMonthComparison
                ? `${selectedMonthLabel} • M-1 ${previousMonthLabel}: ${formatCurrency(comparisonTotalCommissions)}`
                : `Cumul période • Début ${formatCurrency(commissionStart)}`}
            </p>
            <svg viewBox="0 0 280 80" className="h-20 w-full">
              {isMonthComparison && comparisonCommissionCurvePath ? (
                <path d={comparisonCommissionCurvePath} fill="none" stroke="currentColor" strokeWidth="1.6" className="text-black/20 dark:text-white/20" />
              ) : null}
              <path d={commissionCurvePath} fill="none" stroke="currentColor" strokeWidth="2.2" className="text-black/70 dark:text-white/70" />
            </svg>
            <div className="mt-1 flex justify-between text-[10px] text-black/45 dark:text-white/45">
              <span>{compactDate(cumulativeDailyPerformance[0]?.day ?? "")}</span>
              <span>{compactDate(cumulativeDailyPerformance[cumulativeDailyPerformance.length - 1]?.day ?? "")}</span>
            </div>
            {isMonthComparison ? <p className="mt-1 text-[10px] text-black/45 dark:text-white/45">Ligne claire: {previousMonthLabel}</p> : null}
          </div>

          <div className="rounded-xl border border-black/10 p-3 dark:border-white/10">
            <p className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Compagnie la plus vendue</p>
            <p className="mt-1 text-sm font-semibold">{topAirline ? `${topAirline.code} • ${topAirline.tickets} billets` : "Aucune donnée"}</p>
            <p className="mb-2 text-[11px] text-black/60 dark:text-white/60">
              Part de volume: {topAirlineShare.toFixed(1)}%
              {isMonthComparison && comparisonTopAirline ? ` • M-1: ${comparisonTopAirline.code} • ${comparisonTopAirline.tickets} billets` : ""}
            </p>
            <div className="space-y-1.5">
              {topAirlineBars.map((item) => {
                const widthPercent = maxTopAirlineSales > 0 ? (item.sales / maxTopAirlineSales) * 100 : 0;
                return (
                  <div key={item.code}>
                    <div className="mb-0.5 flex items-center justify-between text-[11px]">
                      <span>{item.code}</span>
                      <span>{formatCurrency(item.sales)}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-black/10 dark:bg-white/10">
                      <div className="h-1.5 rounded-full bg-black dark:bg-white" style={{ width: `${widthPercent}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-black/10 p-3 dark:border-white/10">
            <p className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Agence la plus performante</p>
            <p className="mt-1 text-sm font-semibold">{topAgency ? `${topAgency.agency} • ${topAgency.tickets} billets` : "Aucune donnée"}</p>
            <p className="mb-2 text-[11px] text-black/60 dark:text-white/60">
              Calcul basé sur le payant (équipe/agence/partenaire)
              {isMonthComparison && comparisonTopAgency ? ` • M-1: ${comparisonTopAgency.agency} • ${comparisonTopAgency.tickets} billets` : ""}
            </p>
            <div className="space-y-1.5">
              {topAgencyBars.map((item) => {
                const widthPercent = maxTopAgencySales > 0 ? (item.sales / maxTopAgencySales) * 100 : 0;
                return (
                  <div key={item.agency}>
                    <div className="mb-0.5 flex items-center justify-between text-[11px]">
                      <span>{item.agency}</span>
                      <span>{formatCurrency(item.sales)}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-black/10 dark:bg-white/10">
                      <div className="h-1.5 rounded-full bg-black/70 dark:bg-white/70" style={{ width: `${widthPercent}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        {cumulativeDailyPerformance.length === 0 ? (
          <p className="mt-3 text-xs text-black/55 dark:text-white/55">Aucune performance à afficher pour cette période.</p>
        ) : null}
      </section>

      {(caaRule || airFastAirline) ? (
        <section className="mb-6 rounded-2xl border border-black/10 bg-white p-3 text-xs dark:border-white/10 dark:bg-zinc-900">
          <div className="grid gap-2 sm:grid-cols-2">
            {caaRule ? (
              <div className="rounded-md border border-black/10 px-3 py-2 dark:border-white/10">
                <p className="font-semibold">Suivi CAA</p>
                <p className="text-black/60 dark:text-white/60">
                  Cumul: {caaConsumed.toFixed(2)} USD • Lots: {caaLotsReached} • Commission: {caaCommissionEarned.toFixed(2)} USD • Reste: {caaRemainingToNextLot.toFixed(2)} USD
                </p>
              </div>
            ) : null}
            {airFastAirline ? (
              <div className="rounded-md border border-black/10 px-3 py-2 dark:border-white/10">
                <p className="font-semibold">Suivi Air Fast</p>
                <p className="text-black/60 dark:text-white/60">
                  Billets vendus: {airFastTicketCount} • Bonus gagnés: {airFastBonusReached} • Prochain bonus dans: {airFastNextBonusIn} billet(s)
                </p>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-black/10 bg-white p-4 text-sm text-black/70 dark:border-white/10 dark:bg-zinc-900 dark:text-white/70">
        Le tableau détaillé des billets est disponible dans la page ventes. Cette page présente uniquement la vue synthétique et l&apos;export PDF.
      </section>
    </AppShell>
  );
}
