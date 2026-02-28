import { PaymentStatus } from "@prisma/client";
import { AppShell } from "@/components/app-shell";
import { KpiCard } from "@/components/kpi-card";
import { PaymentEntryForm } from "@/components/payment-entry-form";
import { canProcessPayments } from "@/lib/assignment";
import { requirePageRoles } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";

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
  airlineId?: string;
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

export const dynamic = "force-dynamic";

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const { role, session } = await requirePageRoles(["ADMIN", "MANAGER", "ACCOUNTANT", "EMPLOYEE"]);
  if (
    role === "EMPLOYEE"
    && !canProcessPayments(session.user.jobTitle ?? "")
  ) {
    redirect("/");
  }
  const resolvedSearchParams = (await searchParams) ?? {};
  const range = dateRangeFromParams(resolvedSearchParams);

  const now = new Date();
  const currentDate = now.toISOString().slice(0, 10);
  const currentStartDate = resolvedSearchParams.startDate ?? currentDate;
  const currentEndDate = resolvedSearchParams.endDate ?? currentStartDate;
  const selectedAirlineId = resolvedSearchParams.airlineId && resolvedSearchParams.airlineId !== "ALL"
    ? resolvedSearchParams.airlineId
    : undefined;

  const [airlines, tickets, payments] = await Promise.all([
    prisma.airline.findMany({
      select: { id: true, code: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.ticketSale.findMany({
      where: {
        soldAt: { gte: range.start, lt: range.end },
        ...(selectedAirlineId ? { airlineId: selectedAirlineId } : {}),
      },
      include: { airline: true, payments: true },
      orderBy: { soldAt: "desc" },
      take: 800,
    }),
    prisma.payment.findMany({
      where: {
        ticket: {
          soldAt: { gte: range.start, lt: range.end },
          ...(selectedAirlineId ? { airlineId: selectedAirlineId } : {}),
        },
      },
      include: {
        ticket: {
          select: {
            ticketNumber: true,
            customerName: true,
            amount: true,
            paymentStatus: true,
            currency: true,
          },
        },
      },
      orderBy: { paidAt: "desc" },
      take: 250,
    }),
  ]);

  const ticketsWithComputedStatus = tickets.map((ticket) => {
    const paidAmount = ticket.payments.reduce((sum, payment) => sum + payment.amount, 0);
    const computedStatus = paidAmount <= 0
      ? PaymentStatus.UNPAID
      : paidAmount + 0.0001 >= ticket.amount
        ? PaymentStatus.PAID
        : PaymentStatus.PARTIAL;

    return {
      ...ticket,
      paidAmount,
      computedStatus,
    };
  });

  const totalTicketAmount = ticketsWithComputedStatus.reduce((sum, ticket) => sum + ticket.amount, 0);
  const totalPaid = ticketsWithComputedStatus.reduce((sum, ticket) => sum + ticket.paidAmount, 0);
  const receivables = Math.max(0, totalTicketAmount - totalPaid);
  const collectedTotal = ticketsWithComputedStatus
    .filter((ticket) => ticket.computedStatus === PaymentStatus.PAID)
    .reduce((sum, ticket) => sum + ticket.amount, 0);

  const paymentTickets = ticketsWithComputedStatus
    .filter((ticket) => ticket.computedStatus !== PaymentStatus.PAID)
    .map((ticket) => ({
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      customerName: ticket.customerName,
      amount: ticket.amount,
      paidAmount: ticket.paidAmount,
      paymentStatus: ticket.computedStatus,
    }));

  return (
    <AppShell
      role={role}
      accessNote="Vue financière: suivi des encaissements, des soldes clients et des créances à recouvrer."
    >
      <section className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Paiements</h1>
        <p className="text-sm text-black/60 dark:text-white/60">Pilotage financier des billets vendus et des paiements reçus (USD).</p>
      </section>

      <section className="mb-6 rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
        <form method="GET" className="grid gap-3 lg:grid-cols-4 lg:items-end">
          <input type="hidden" name="mode" value="date" />

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Du</label>
            <input type="date" name="startDate" defaultValue={currentStartDate} className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900" />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Au</label>
            <input type="date" name="endDate" defaultValue={currentEndDate} className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900" />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Compagnie</label>
            <select name="airlineId" defaultValue={resolvedSearchParams.airlineId ?? "ALL"} className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900">
              <option value="ALL">Toutes compagnies</option>
              {airlines.map((airline) => (
                <option key={airline.id} value={airline.id}>{airline.code} - {airline.name}</option>
              ))}
            </select>
          </div>

          <button type="submit" className="rounded-md bg-black px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black">Filtrer</button>
        </form>
        <p className="mt-3 text-xs text-black/60 dark:text-white/60">
          {range.label} • Période du {range.start.toISOString().slice(0, 10)} au {new Date(range.end.getTime() - 1).toISOString().slice(0, 10)}
        </p>
      </section>

      <PaymentEntryForm tickets={paymentTickets} />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total facturé" value={`${totalTicketAmount.toFixed(2)} USD`} />
        <KpiCard label="Total encaissé" value={`${totalPaid.toFixed(2)} USD`} />
        <KpiCard label="Total créance" value={`${receivables.toFixed(2)} USD`} />
        <KpiCard label="Totaux collectés" value={`${collectedTotal.toFixed(2)} USD`} />
      </div>

      <div className="mb-6 overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-black/5 dark:bg-white/10">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Billet</th>
                <th className="px-4 py-3 text-left font-semibold">Client</th>
                <th className="px-4 py-3 text-left font-semibold">Facturé</th>
                <th className="px-4 py-3 text-left font-semibold">Encaissé</th>
                <th className="px-4 py-3 text-left font-semibold">Reste</th>
                <th className="px-4 py-3 text-left font-semibold">Statut</th>
              </tr>
            </thead>
            <tbody>
              {ticketsWithComputedStatus.slice(0, 140).map((ticket) => (
                <tr key={ticket.id} className="border-t border-black/5 dark:border-white/10">
                  <td className="px-4 py-3 font-medium">{ticket.ticketNumber}</td>
                  <td className="px-4 py-3">{ticket.customerName}</td>
                  <td className="px-4 py-3">{ticket.amount.toFixed(2)} USD</td>
                  <td className="px-4 py-3">{ticket.paidAmount.toFixed(2)} USD</td>
                  <td className="px-4 py-3">{Math.max(0, ticket.amount - ticket.paidAmount).toFixed(2)} USD</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-black/5 px-2.5 py-1 text-xs font-semibold dark:bg-white/10">
                      {ticket.computedStatus}
                    </span>
                  </td>
                </tr>
              ))}
              {ticketsWithComputedStatus.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-black/55 dark:text-white/55">
                    Aucun billet trouvé pour ce filtre.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-black/5 dark:bg-white/10">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Date</th>
                <th className="px-4 py-3 text-left font-semibold">Billet</th>
                <th className="px-4 py-3 text-left font-semibold">Client</th>
                <th className="px-4 py-3 text-left font-semibold">Montant</th>
                <th className="px-4 py-3 text-left font-semibold">Méthode</th>
                <th className="px-4 py-3 text-left font-semibold">Référence</th>
                <th className="px-4 py-3 text-left font-semibold">Statut billet</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id} className="border-t border-black/5 dark:border-white/10">
                  <td className="px-4 py-3">{new Date(payment.paidAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3 font-medium">{payment.ticket.ticketNumber}</td>
                  <td className="px-4 py-3">{payment.ticket.customerName}</td>
                  <td className="px-4 py-3">{payment.amount.toFixed(2)} USD</td>
                  <td className="px-4 py-3">{payment.method}</td>
                  <td className="px-4 py-3">{payment.reference ?? "-"}</td>
                  <td className="px-4 py-3">{payment.ticket.paymentStatus}</td>
                </tr>
              ))}
              {payments.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-black/55 dark:text-white/55">
                    Aucun paiement trouvé pour ce filtre.
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
