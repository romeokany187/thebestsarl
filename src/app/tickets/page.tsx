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

function sparklineGeometry(values: number[], width: number, height: number) {
  if (values.length === 0) {
    return {
      linePath: "",
      areaPath: "",
      lastPoint: null as { x: number; y: number } | null,
    };
  }

  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 1);

  const points = values.map((value, index) => {
    const x = values.length === 1 ? 0 : (index / (values.length - 1)) * width;
    const y = height - ((value - min) / range) * height;
    return { x, y };
  });

  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");

  const first = points[0];
  const last = points[points.length - 1];
  const areaPath = `${linePath} L${last.x.toFixed(2)} ${height.toFixed(2)} L${first.x.toFixed(2)} ${height.toFixed(2)} Z`;

  return {
    linePath,
    areaPath,
    lastPoint: last,
  };
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
  const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  const previousMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 0, 0, 0, 0));
  const monthComparisonRange = { start: previousMonthStart, end: currentMonthStart };
  const selectedMonthLabel = formatMonthLabel(currentMonthStart);
  const previousMonthLabel = formatMonthLabel(previousMonthStart);
  const currentDate = now.toISOString().slice(0, 10);
  const currentStartDate = resolvedSearchParams.startDate ?? `${now.getUTCFullYear()}-01-01`;
  const currentEndDate = resolvedSearchParams.endDate ?? currentDate;
  const { session, role } = await requirePageModuleAccess("tickets", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  const roleTicketFilter = role === "EMPLOYEE" ? { sellerId: session.user.id } : {};

  await ensureAirlineCatalog(prisma);

  const [monitorCurrentTickets, comparisonTickets, airlineTracking, caaConsumedAggregate] = await Promise.all([
    prisma.ticketSale.findMany({
      where: {
        ...roleTicketFilter,
        soldAt: {
          gte: currentMonthStart,
          lt: nextMonthStart,
        },
      },
      include: {
        airline: true,
        seller: { select: { name: true } },
      },
      orderBy: { soldAt: "desc" },
    }),
    prisma.ticketSale.findMany({
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
    }),
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

  const [orderedMonitorCurrentCaaTickets, orderedComparisonCaaTickets] = caaAirline
    ? await Promise.all([
      prisma.ticketSale.findMany({
        where: {
          ...roleTicketFilter,
          airlineId: caaAirline.id,
          soldAt: { lt: nextMonthStart },
        },
        select: { id: true, soldAt: true, amount: true },
        orderBy: [{ soldAt: "asc" }, { id: "asc" }],
      }),
      prisma.ticketSale.findMany({
        where: {
          ...roleTicketFilter,
          airlineId: caaAirline.id,
          soldAt: { lt: monthComparisonRange.end },
        },
        select: { id: true, soldAt: true, amount: true },
        orderBy: [{ soldAt: "asc" }, { id: "asc" }],
      }),
    ])
    : [[], []];

  const monitorCurrentCaaCommissionMap = caaAirline
    ? computeCaaCommissionMap({
      periodTicketIds: monitorCurrentTickets
        .filter((ticket) => ticket.airlineId === caaAirline.id)
        .map((ticket) => ticket.id),
      orderedCaaTicketsUntilPeriodEnd: orderedMonitorCurrentCaaTickets,
      targetAmount: caaTargetAmount,
      batchCommissionAmount: caaBatchCommission,
    })
    : new Map<string, number>();

  const comparisonCaaCommissionMap = caaAirline
    ? computeCaaCommissionMap({
      periodTicketIds: comparisonTickets
        .filter((ticket) => ticket.airlineId === caaAirline.id)
        .map((ticket) => ticket.id),
      orderedCaaTicketsUntilPeriodEnd: orderedComparisonCaaTickets,
      targetAmount: caaTargetAmount,
      batchCommissionAmount: caaBatchCommission,
    })
    : new Map<string, number>();

  const monitorCurrentCommissionOf = (ticket: { id: string; airline: { code: string }; amount: number; commissionAmount: number | null; commissionRateUsed: number }) => {
    if (ticket.airline.code === "CAA" && monitorCurrentCaaCommissionMap.has(ticket.id)) {
      return monitorCurrentCaaCommissionMap.get(ticket.id) ?? 0;
    }
    return ticket.commissionAmount ?? ticket.amount * (ticket.commissionRateUsed / 100);
  };

  const comparisonCommissionOf = (ticket: { id: string; airline: { code: string }; amount: number; commissionAmount: number | null; commissionRateUsed: number }) => {
    if (ticket.airline.code === "CAA" && comparisonCaaCommissionMap.has(ticket.id)) {
      return comparisonCaaCommissionMap.get(ticket.id) ?? 0;
    }
    return ticket.commissionAmount ?? ticket.amount * (ticket.commissionRateUsed / 100);
  };

  const monitorCurrentTotalSales = monitorCurrentTickets.reduce((sum, ticket) => sum + ticket.amount, 0);
  const monitorCurrentTotalCommissions = monitorCurrentTickets.reduce((sum, ticket) => sum + monitorCurrentCommissionOf(ticket), 0);
  const monitorCurrentTotalTickets = monitorCurrentTickets.length;
  const comparisonTotalSales = comparisonTickets.reduce((sum, ticket) => sum + ticket.amount, 0);
  const comparisonTotalCommissions = comparisonTickets.reduce((sum, ticket) => sum + comparisonCommissionOf(ticket), 0);
  const comparisonTotalTickets = comparisonTickets.length;

  const salesByAirline = Array.from(
    monitorCurrentTickets.reduce((map, ticket) => {
      const key = ticket.airline.code;
      const commission = monitorCurrentCommissionOf(ticket);
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

  const dailyPerformanceMap = monitorCurrentTickets.reduce((map, ticket) => {
    const key = new Date(ticket.soldAt).toISOString().slice(0, 10);
    const commission = monitorCurrentCommissionOf(ticket);
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

  const dailyPerformance = buildDailyTimeline(startOfUtcDay(currentMonthStart), startOfUtcDay(nextMonthStart)).map((day) => {
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

  const salesGraph = sparklineGeometry(cumulativeDailyPerformance.map((point) => point.sales), 280, 80);
  const comparisonSalesGraph = sparklineGeometry(comparisonCumulativeDailyPerformance.map((point) => point.sales), 280, 80);
  const commissionGraph = sparklineGeometry(cumulativeDailyPerformance.map((point) => point.commissions), 280, 80);
  const comparisonCommissionGraph = sparklineGeometry(comparisonCumulativeDailyPerformance.map((point) => point.commissions), 280, 80);
  const salesEnd = cumulativeDailyPerformance[cumulativeDailyPerformance.length - 1]?.sales ?? 0;
  const salesTrendPercent = calculateGrowthPercent(monitorCurrentTotalSales, comparisonTotalSales);
  const commissionEnd = cumulativeDailyPerformance[cumulativeDailyPerformance.length - 1]?.commissions ?? 0;
  const commissionTrendPercent = calculateGrowthPercent(monitorCurrentTotalCommissions, comparisonTotalCommissions);

  const topAirline = salesByAirline[0] ?? null;
  const topAirlineShare = monitorCurrentTotalTickets > 0 && topAirline ? (topAirline.tickets / monitorCurrentTotalTickets) * 100 : 0;
  const topAirlineBars = salesByAirline.slice(0, 4);

  const agencySales = Array.from(
    monitorCurrentTickets.reduce((map, ticket) => {
      const key = detectAgencyFromPayer(ticket.payerName);
      const existing = map.get(key) ?? { agency: key, tickets: 0, sales: 0, commissions: 0 };
      const commission = monitorCurrentCommissionOf(ticket);
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

  const periodProgressPercent = calculateGrowthPercent(monitorCurrentTotalSales, comparisonTotalSales);
  const periodProgressLabel = `${periodProgressPercent >= 0 ? "+" : ""}${periodProgressPercent.toFixed(1)}%`;
  const ticketsGrowthPercent = calculateGrowthPercent(monitorCurrentTotalTickets, comparisonTotalTickets);

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
        <form method="GET" className="grid gap-3 lg:grid-cols-4 lg:items-end">
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

          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded-md bg-black px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black"
            >
              Afficher
            </button>
            <button
              type="submit"
              formAction="/api/sales/report/pdf"
              formTarget="_blank"
              className="rounded-md border border-black/15 bg-white px-4 py-2 text-sm font-semibold dark:border-white/15 dark:bg-zinc-900"
            >
              Tirer PDF
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
          value={String(monitorCurrentTotalTickets)}
          hint={`${previousMonthLabel}: ${comparisonTotalTickets} • Δ ${ticketsGrowthPercent >= 0 ? "+" : ""}${ticketsGrowthPercent.toFixed(1)}%`}
        />
        <KpiCard
          label="Ventes totales"
          value={`${monitorCurrentTotalSales.toFixed(2)} USD`}
          hint={`${previousMonthLabel}: ${comparisonTotalSales.toFixed(2)} USD`}
        />
        <KpiCard
          label="Commissions"
          value={`${monitorCurrentTotalCommissions.toFixed(2)} USD`}
          hint={`${previousMonthLabel}: ${comparisonTotalCommissions.toFixed(2)} USD`}
        />
        <KpiCard
          label="Marge de progression"
          value={periodProgressLabel}
          hint={`${selectedMonthLabel}: ${monitorCurrentTotalSales.toFixed(2)} USD • ${previousMonthLabel}: ${comparisonTotalSales.toFixed(2)} USD`}
        />
      </div>

      <section className="mb-6 rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
        <h2 className="mb-3 text-sm font-semibold">Moniteur de performance</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-black/10 bg-white p-3 text-black dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-zinc-400">Progression ventes cumulées</p>
              <p className={`text-xs font-semibold ${salesTrendPercent >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                {salesTrendPercent >= 0 ? "+" : ""}{salesTrendPercent.toFixed(1)}%
              </p>
            </div>
            <p className="text-sm font-semibold text-black dark:text-zinc-100">{formatCurrency(salesEnd)}</p>
            <p className="mb-2 text-[11px] text-black/60 dark:text-zinc-400">
              {selectedMonthLabel} • M-1 {previousMonthLabel}: {formatCurrency(comparisonTotalSales)}
            </p>
            <svg viewBox="0 0 280 80" className="h-20 w-full">
              <defs>
                <linearGradient id="salesAreaGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#fb7185" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#fb7185" stopOpacity="0.02" />
                </linearGradient>
              </defs>
              <line x1="0" y1="10" x2="280" y2="10" className="text-black/15 dark:text-white/16" stroke="currentColor" strokeWidth="1" />
              <line x1="0" y1="40" x2="280" y2="40" className="text-black/12 dark:text-white/12" stroke="currentColor" strokeWidth="1" />
              <line x1="0" y1="70" x2="280" y2="70" className="text-black/10 dark:text-white/10" stroke="currentColor" strokeWidth="1" />
              {comparisonSalesGraph.linePath ? (
                <path d={comparisonSalesGraph.linePath} fill="none" stroke="#fda4af" strokeOpacity="0.38" strokeWidth="1.4" />
              ) : null}
              {salesGraph.areaPath ? <path d={salesGraph.areaPath} fill="url(#salesAreaGradient)" /> : null}
              {salesGraph.linePath ? <path d={salesGraph.linePath} fill="none" stroke="#fb7185" strokeWidth="2.2" /> : null}
              {salesGraph.lastPoint ? (
                <circle cx={salesGraph.lastPoint.x} cy={salesGraph.lastPoint.y} r="3.4" fill="#fb7185" stroke="#fecdd3" strokeWidth="1" />
              ) : null}
            </svg>
            <div className="mt-1 flex justify-between text-[10px] text-black/45 dark:text-zinc-500">
              <span>{compactDate(cumulativeDailyPerformance[0]?.day ?? "")}</span>
              <span>{compactDate(cumulativeDailyPerformance[cumulativeDailyPerformance.length - 1]?.day ?? "")}</span>
            </div>
            <p className="mt-1 text-[10px] text-black/45 dark:text-zinc-500">Ligne claire: {previousMonthLabel}</p>
          </div>

          <div className="rounded-xl border border-black/10 bg-white p-3 text-black dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-zinc-400">Progression commissions cumulées</p>
              <p className={`text-xs font-semibold ${commissionTrendPercent >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                {commissionTrendPercent >= 0 ? "+" : ""}{commissionTrendPercent.toFixed(1)}%
              </p>
            </div>
            <p className="text-sm font-semibold text-black dark:text-zinc-100">{formatCurrency(commissionEnd)}</p>
            <p className="mb-2 text-[11px] text-black/60 dark:text-zinc-400">
              {selectedMonthLabel} • M-1 {previousMonthLabel}: {formatCurrency(comparisonTotalCommissions)}
            </p>
            <svg viewBox="0 0 280 80" className="h-20 w-full">
              <defs>
                <linearGradient id="commissionAreaGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f97316" stopOpacity="0.32" />
                  <stop offset="100%" stopColor="#f97316" stopOpacity="0.02" />
                </linearGradient>
              </defs>
              <line x1="0" y1="10" x2="280" y2="10" className="text-black/15 dark:text-white/16" stroke="currentColor" strokeWidth="1" />
              <line x1="0" y1="40" x2="280" y2="40" className="text-black/12 dark:text-white/12" stroke="currentColor" strokeWidth="1" />
              <line x1="0" y1="70" x2="280" y2="70" className="text-black/10 dark:text-white/10" stroke="currentColor" strokeWidth="1" />
              {comparisonCommissionGraph.linePath ? (
                <path d={comparisonCommissionGraph.linePath} fill="none" stroke="#fdba74" strokeOpacity="0.38" strokeWidth="1.4" />
              ) : null}
              {commissionGraph.areaPath ? <path d={commissionGraph.areaPath} fill="url(#commissionAreaGradient)" /> : null}
              {commissionGraph.linePath ? <path d={commissionGraph.linePath} fill="none" stroke="#f97316" strokeWidth="2.2" /> : null}
              {commissionGraph.lastPoint ? (
                <circle cx={commissionGraph.lastPoint.x} cy={commissionGraph.lastPoint.y} r="3.4" fill="#f97316" stroke="#fdba74" strokeWidth="1" />
              ) : null}
            </svg>
            <div className="mt-1 flex justify-between text-[10px] text-black/45 dark:text-zinc-500">
              <span>{compactDate(cumulativeDailyPerformance[0]?.day ?? "")}</span>
              <span>{compactDate(cumulativeDailyPerformance[cumulativeDailyPerformance.length - 1]?.day ?? "")}</span>
            </div>
            <p className="mt-1 text-[10px] text-black/45 dark:text-zinc-500">Ligne claire: {previousMonthLabel}</p>
          </div>

          <div className="rounded-xl border border-black/10 p-3 dark:border-white/10">
            <p className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Compagnie la plus vendue</p>
            <p className="mt-1 text-sm font-semibold">{topAirline ? `${topAirline.code} • ${topAirline.tickets} billets` : "Aucune donnée"}</p>
            <p className="mb-2 text-[11px] text-black/60 dark:text-white/60">
              Part de volume: {topAirlineShare.toFixed(1)}%
              {comparisonTopAirline ? ` • M-1: ${comparisonTopAirline.code} • ${comparisonTopAirline.tickets} billets` : ""}
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
              {comparisonTopAgency ? ` • M-1: ${comparisonTopAgency.agency} • ${comparisonTopAgency.tickets} billets` : ""}
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
