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

  const [tickets, airlineTracking, selectedDaySales, previousDaySales] = await Promise.all([
    prisma.ticketSale.findMany({
      where: whereClause,
      include: {
        airline: true,
        seller: { select: { name: true } },
        payments: true,
      },
      orderBy: { soldAt: "desc" },
      take: 250,
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

  const totalSales = tickets.reduce((sum, ticket) => sum + ticket.amount, 0);
  const totalCommissions = tickets.reduce(
    (sum, ticket) => sum + (ticket.commissionAmount ?? ticket.amount * (ticket.commissionRateUsed / 100)),
    0,
  );
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

          <button
            type="submit"
            className="rounded-md bg-black px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black"
          >
            Tirer le rapport
          </button>
        </form>

        <p className="mt-3 text-xs text-black/60 dark:text-white/60">
          {range.label} • Période du {range.start.toISOString().slice(0, 10)} au {new Date(range.end.getTime() - 1).toISOString().slice(0, 10)}
        </p>
      </section>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total ventes" value={`${totalSales.toFixed(2)} USD`} />
        <KpiCard label="Commissions totales" value={`${totalCommissions.toFixed(2)} USD`} />
        <KpiCard
          label="Progression vs jour précédent"
          value={dayProgressLabel}
          hint={`J: ${selectedDayTotal.toFixed(2)} USD • J-1: ${previousDayTotal.toFixed(2)} USD`}
        />
      </div>

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

      <div className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-black/5 dark:bg-white/10">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Date vente</th>
                <th className="px-4 py-3 text-left font-semibold">Billet</th>
                <th className="px-4 py-3 text-left font-semibold">Client</th>
                <th className="px-4 py-3 text-left font-semibold">Vendeur</th>
                <th className="px-4 py-3 text-left font-semibold">Compagnie</th>
                <th className="px-4 py-3 text-left font-semibold">Montant</th>
                <th className="px-4 py-3 text-left font-semibold">Commission</th>
                <th className="px-4 py-3 text-left font-semibold">Reçu</th>
                <th className="px-4 py-3 text-left font-semibold">Statut</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((ticket) => {
                const paidAmount = ticket.payments.reduce((sum, item) => sum + item.amount, 0);
                const commissionAmount = ticket.commissionAmount ?? ticket.amount * (ticket.commissionRateUsed / 100);

                return (
                  <tr key={ticket.id} className="border-t border-black/5 dark:border-white/10">
                    <td className="px-4 py-3">{new Date(ticket.soldAt).toISOString().slice(0, 10)}</td>
                    <td className="px-4 py-3 font-medium">{ticket.ticketNumber}</td>
                    <td className="px-4 py-3">{ticket.customerName}</td>
                    <td className="px-4 py-3">{ticket.seller.name}</td>
                    <td className="px-4 py-3">{ticket.airline.code}</td>
                    <td className="px-4 py-3">{ticket.amount.toFixed(2)} {ticket.currency}</td>
                    <td className="px-4 py-3">{commissionAmount.toFixed(2)} {ticket.currency}</td>
                    <td className="px-4 py-3">{paidAmount.toFixed(2)} {ticket.currency}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-black/5 px-2.5 py-1 text-xs font-semibold dark:bg-white/10">
                        {ticket.paymentStatus}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {tickets.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-sm text-black/55 dark:text-white/55">
                    Aucun billet trouvé pour cette période.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
