import { AppShell } from "@/components/app-shell";
import { KpiCard } from "@/components/kpi-card";
import { requirePageRoles } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { ensureAirlineCatalog } from "@/lib/airline-catalog";

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
  const defaultDay = now.toISOString().slice(0, 10);

  if (params.startDate || params.endDate) {
    const startRaw = params.startDate ?? defaultDay;
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
  return value.slice(5);
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

function detectAgencyFromRoute(route: string) {
  const normalized = route.toUpperCase();
  if (normalized.includes("LUBUMBASHI") || normalized.includes("FBM") || normalized.includes("L'SHI")) return "Lubumbashi";
  if (normalized.includes("KINSHASA") || normalized.includes("FIH") || normalized.includes("N'DJILI")) return "Kinshasa";
  if (normalized.includes("MBUJIMAYI") || normalized.includes("MJM")) return "Mbujimayi";
  if (normalized.includes("LUSAKA") || normalized.includes("LUN") || normalized.includes("LUSI")) return "Lusaka/Lusi";
  return "Autres";
}

export default async function TicketsPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const range = dateRangeFromParams(resolvedSearchParams);
  const now = new Date();
  const currentMonth = now.toISOString().slice(0, 7);
  const currentDate = now.toISOString().slice(0, 10);
  const currentYear = String(now.getUTCFullYear());
  const currentStartDate = resolvedSearchParams.startDate ?? currentDate;
  const currentEndDate = resolvedSearchParams.endDate ?? currentStartDate;
  const { session, role } = await requirePageRoles(["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  const roleTicketFilter = role === "EMPLOYEE" ? { sellerId: session.user.id } : {};

  await ensureAirlineCatalog(prisma);

  const whereClause = {
    ...roleTicketFilter,
    soldAt: {
      gte: range.start,
      lt: range.end,
    },
  };

  const selectedDay = new Date(range.end.getTime() - 1);
  const selectedDayStart = new Date(Date.UTC(
    selectedDay.getUTCFullYear(),
    selectedDay.getUTCMonth(),
    selectedDay.getUTCDate(),
    0,
    0,
    0,
    0,
  ));
  const selectedDayEnd = new Date(Date.UTC(
    selectedDay.getUTCFullYear(),
    selectedDay.getUTCMonth(),
    selectedDay.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  ));
  const previousDayStart = new Date(Date.UTC(
    selectedDay.getUTCFullYear(),
    selectedDay.getUTCMonth(),
    selectedDay.getUTCDate() - 1,
    0,
    0,
    0,
    0,
  ));

  const [ticketsForMetrics, airlineTracking, selectedDaySales, previousDaySales] = await Promise.all([
    prisma.ticketSale.findMany({
      where: whereClause,
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
        soldAt: {
          gte: selectedDayStart,
          lt: selectedDayEnd,
        },
      },
      _sum: { amount: true },
    }),
    prisma.ticketSale.aggregate({
      where: {
        ...roleTicketFilter,
        soldAt: {
          gte: previousDayStart,
          lt: selectedDayStart,
        },
      },
      _sum: { amount: true },
    }),
  ]);

  const totalSales = ticketsForMetrics.reduce((sum, ticket) => sum + ticket.amount, 0);
  const totalCommissions = ticketsForMetrics.reduce(
    (sum, ticket) => sum + (ticket.commissionAmount ?? ticket.amount * (ticket.commissionRateUsed / 100)),
    0,
  );
  const totalTickets = ticketsForMetrics.length;

  const salesByAirline = Array.from(
    ticketsForMetrics.reduce((map, ticket) => {
      const key = ticket.airline.code;
      const commission = ticket.commissionAmount ?? ticket.amount * (ticket.commissionRateUsed / 100);
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

  const dailyPerformance = Array.from(
    ticketsForMetrics.reduce((map, ticket) => {
      const key = new Date(ticket.soldAt).toISOString().slice(0, 10);
      const commission = ticket.commissionAmount ?? ticket.amount * (ticket.commissionRateUsed / 100);
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
    }, new Map<string, { day: string; sales: number; commissions: number; tickets: number }>()),
  ).sort((a, b) => a[0].localeCompare(b[0])).map((item) => item[1]);

  const maxDailySales = dailyPerformance.reduce((max, point) => Math.max(max, point.sales), 0);
  const maxDailyCommissions = dailyPerformance.reduce((max, point) => Math.max(max, point.commissions), 0);

  const salesCurvePath = sparklinePath(dailyPerformance.map((point) => point.sales), 280, 80);
  const commissionCurvePath = sparklinePath(dailyPerformance.map((point) => point.commissions), 280, 80);
  const salesStart = dailyPerformance[0]?.sales ?? 0;
  const salesEnd = dailyPerformance[dailyPerformance.length - 1]?.sales ?? 0;
  const salesTrendPercent = salesStart > 0 ? ((salesEnd - salesStart) / salesStart) * 100 : salesEnd > 0 ? 100 : 0;
  const commissionStart = dailyPerformance[0]?.commissions ?? 0;
  const commissionEnd = dailyPerformance[dailyPerformance.length - 1]?.commissions ?? 0;
  const commissionTrendPercent = commissionStart > 0
    ? ((commissionEnd - commissionStart) / commissionStart) * 100
    : commissionEnd > 0
      ? 100
      : 0;

  const topAirline = salesByAirline[0] ?? null;
  const topAirlineShare = totalTickets > 0 && topAirline ? (topAirline.tickets / totalTickets) * 100 : 0;
  const topAirlineBars = salesByAirline.slice(0, 4);

  const agencySales = Array.from(
    ticketsForMetrics.reduce((map, ticket) => {
      const key = detectAgencyFromRoute(ticket.route);
      const existing = map.get(key) ?? { agency: key, tickets: 0, sales: 0, commissions: 0 };
      const commission = ticket.commissionAmount ?? ticket.amount * (ticket.commissionRateUsed / 100);
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

  const selectedDayTotal = selectedDaySales._sum.amount ?? 0;
  const previousDayTotal = previousDaySales._sum.amount ?? 0;
  const dayProgressPercent = previousDayTotal > 0
    ? ((selectedDayTotal - previousDayTotal) / previousDayTotal) * 100
    : selectedDayTotal > 0
      ? 100
      : 0;
  const dayProgressLabel = `${dayProgressPercent >= 0 ? "+" : ""}${dayProgressPercent.toFixed(1)}%`;

  const caaAirline = airlineTracking.find((airline) => airline.code === "CAA");
  const caaRule = caaAirline?.commissionRules.find((rule) => rule.commissionMode === "AFTER_DEPOSIT");
  const caaTargetAmount = caaRule?.depositStockTargetAmount ?? 0;
  const caaBatchCommission = caaRule?.batchCommissionAmount ?? 0;
  const caaConsumed = caaRule?.depositStockConsumedAmount ?? 0;
  const caaLotsReached = caaTargetAmount > 0 ? Math.floor(caaConsumed / caaTargetAmount) : 0;
  const caaCommissionEarned = caaLotsReached * caaBatchCommission;
  const caaRemainder = caaTargetAmount > 0 ? caaConsumed % caaTargetAmount : 0;
  const caaRemainingToNextLot = caaTargetAmount > 0 ? Math.max(0, caaTargetAmount - caaRemainder) : 0;

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
          <input type="hidden" name="mode" value="date" />
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
              formAction="/api/tickets/report"
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
        <KpiCard label="Billets vendus" value={String(totalTickets)} />
        <KpiCard label="Ventes totales" value={`${totalSales.toFixed(2)} USD`} />
        <KpiCard label="Commissions" value={`${totalCommissions.toFixed(2)} USD`} />
        <KpiCard
          label="Marge de progression"
          value={dayProgressLabel}
          hint={`J: ${selectedDayTotal.toFixed(2)} USD • J-1: ${previousDayTotal.toFixed(2)} USD`}
        />
      </div>

      <section className="mb-6 rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
        <h2 className="mb-3 text-sm font-semibold">Moniteur de performance</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-black/10 p-3 dark:border-white/10">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Progression ventes</p>
              <p className={`text-xs font-semibold ${salesTrendPercent >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                {salesTrendPercent >= 0 ? "+" : ""}{salesTrendPercent.toFixed(1)}%
              </p>
            </div>
            <p className="text-sm font-semibold">{formatCurrency(salesEnd)}</p>
            <p className="mb-2 text-[11px] text-black/60 dark:text-white/60">Dernier point • Début {formatCurrency(salesStart)}</p>
            <svg viewBox="0 0 280 80" className="h-20 w-full">
              <path d={salesCurvePath} fill="none" stroke="currentColor" strokeWidth="2.2" className="text-black dark:text-white" />
            </svg>
            <div className="mt-1 flex justify-between text-[10px] text-black/45 dark:text-white/45">
              <span>{compactDate(dailyPerformance[0]?.day ?? "")}</span>
              <span>{compactDate(dailyPerformance[dailyPerformance.length - 1]?.day ?? "")}</span>
            </div>
          </div>

          <div className="rounded-xl border border-black/10 p-3 dark:border-white/10">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Progression commissions</p>
              <p className={`text-xs font-semibold ${commissionTrendPercent >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                {commissionTrendPercent >= 0 ? "+" : ""}{commissionTrendPercent.toFixed(1)}%
              </p>
            </div>
            <p className="text-sm font-semibold">{formatCurrency(commissionEnd)}</p>
            <p className="mb-2 text-[11px] text-black/60 dark:text-white/60">Dernier point • Début {formatCurrency(commissionStart)}</p>
            <svg viewBox="0 0 280 80" className="h-20 w-full">
              <path d={commissionCurvePath} fill="none" stroke="currentColor" strokeWidth="2.2" className="text-black/70 dark:text-white/70" />
            </svg>
            <div className="mt-1 flex justify-between text-[10px] text-black/45 dark:text-white/45">
              <span>{compactDate(dailyPerformance[0]?.day ?? "")}</span>
              <span>{compactDate(dailyPerformance[dailyPerformance.length - 1]?.day ?? "")}</span>
            </div>
          </div>

          <div className="rounded-xl border border-black/10 p-3 dark:border-white/10">
            <p className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Compagnie la plus vendue</p>
            <p className="mt-1 text-sm font-semibold">{topAirline ? `${topAirline.code} • ${topAirline.tickets} billets` : "Aucune donnée"}</p>
            <p className="mb-2 text-[11px] text-black/60 dark:text-white/60">Part de volume: {topAirlineShare.toFixed(1)}%</p>
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
            <p className="mb-2 text-[11px] text-black/60 dark:text-white/60">Calcul basé sur la route du billet</p>
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
        {dailyPerformance.length === 0 ? (
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
