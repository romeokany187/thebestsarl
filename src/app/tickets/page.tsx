import { AppShell } from "@/components/app-shell";
import { KpiCard } from "@/components/kpi-card";
import { requirePageRoles } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { ensureAirlineCatalog } from "@/lib/airline-catalog";

export const dynamic = "force-dynamic";

type ReportMode = "date" | "month" | "year" | "semester";

type SearchParams = {
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
  const mode = (["date", "month", "year", "semester"].includes(params.mode ?? "")
    ? params.mode
    : "month") as ReportMode;

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
        <form method="GET" className="grid gap-3 lg:grid-cols-6 lg:items-end">
          <div className="lg:col-span-2">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Type de rapport</label>
            <select
              name="mode"
              defaultValue={range.mode}
              className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            >
              <option value="date">Date donnée</option>
              <option value="month">Mois donné</option>
              <option value="year">Année donnée</option>
              <option value="semester">Semestre donné</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Date</label>
            <input
              type="date"
              name="date"
              defaultValue={resolvedSearchParams.date ?? currentDate}
              className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Mois</label>
            <input
              type="month"
              name="month"
              defaultValue={resolvedSearchParams.month ?? currentMonth}
              className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Année</label>
            <input
              type="number"
              min={2000}
              max={2100}
              name="year"
              defaultValue={resolvedSearchParams.year ?? currentYear}
              className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Semestre</label>
              <select
                name="semester"
                defaultValue={resolvedSearchParams.semester === "2" ? "2" : "1"}
                className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
              >
                <option value="1">S1</option>
                <option value="2">S2</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Année S</label>
              <input
                type="number"
                min={2000}
                max={2100}
                name="semesterYear"
                defaultValue={resolvedSearchParams.semesterYear ?? currentYear}
                className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
              />
            </div>
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
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Résumé des ventes par compagnie</h2>
          <p className="text-xs text-black/60 dark:text-white/60">Top compagnies sur la période</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {salesByAirline.slice(0, 8).map((airline) => (
            <div key={airline.code} className="rounded-xl border border-black/10 p-3 dark:border-white/10">
              <p className="text-sm font-semibold">{airline.code}</p>
              <p className="text-xs text-black/60 dark:text-white/60">{airline.name}</p>
              <p className="mt-2 text-xs">Billets: <span className="font-semibold">{airline.tickets}</span></p>
              <p className="text-xs">Ventes: <span className="font-semibold">{formatCurrency(airline.sales)}</span></p>
              <p className="text-xs">Commission: <span className="font-semibold">{formatCurrency(airline.commissions)}</span></p>
            </div>
          ))}
          {salesByAirline.length === 0 ? (
            <div className="rounded-xl border border-black/10 p-3 text-xs text-black/55 dark:border-white/10 dark:text-white/55">
              Aucune donnée compagnie pour cette période.
            </div>
          ) : null}
        </div>
      </section>

      <section className="mb-6 rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
        <h2 className="mb-3 text-sm font-semibold">Moniteur de performance</h2>
        <div className="space-y-3">
          {dailyPerformance.map((point) => {
            const salesWidth = maxDailySales > 0 ? (point.sales / maxDailySales) * 100 : 0;
            const commissionWidth = maxDailyCommissions > 0 ? (point.commissions / maxDailyCommissions) * 100 : 0;
            return (
              <div key={point.day} className="rounded-md border border-black/10 p-3 dark:border-white/10">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="font-semibold">{point.day}</span>
                  <span className="text-black/60 dark:text-white/60">{point.tickets} billet(s)</span>
                </div>
                <div className="mb-1">
                  <div className="mb-1 flex items-center justify-between text-[11px]">
                    <span>Ventes</span>
                    <span>{formatCurrency(point.sales)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-black/10 dark:bg-white/10">
                    <div className="h-2 rounded-full bg-black dark:bg-white" style={{ width: `${salesWidth}%` }} />
                  </div>
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between text-[11px]">
                    <span>Commissions</span>
                    <span>{formatCurrency(point.commissions)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-black/10 dark:bg-white/10">
                    <div className="h-2 rounded-full bg-black/40 dark:bg-white/50" style={{ width: `${commissionWidth}%` }} />
                  </div>
                </div>
              </div>
            );
          })}
          {dailyPerformance.length === 0 ? (
            <p className="text-xs text-black/55 dark:text-white/55">Aucune performance à afficher pour cette période.</p>
          ) : null}
        </div>
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
