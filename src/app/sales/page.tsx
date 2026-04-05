import { AppShell } from "@/components/app-shell";
import { TicketForm } from "@/components/ticket-form";
import { TicketImportForm } from "@/components/ticket-import-form";
import { TicketRowActions } from "@/components/ticket-row-actions";
import { prisma } from "@/lib/prisma";
import { requirePageModuleAccess } from "@/lib/rbac";
import { ensureAirlineCatalog } from "@/lib/airline-catalog";
import { buildAirlineDepositAccountSummaries } from "@/lib/airline-deposit";
import { computeCaaCommissionMap } from "@/lib/caa-commission";
import { canImportTicketWorkbook, canManageTicketRecord, canSellTickets } from "@/lib/assignment";
import { listTicketWorkbookImportHistory } from "@/lib/ticket-excel-import";

export const dynamic = "force-dynamic";

type SearchParams = {
  startDate?: string;
  endDate?: string;
};

function rangeFromSearch(params: SearchParams) {
  const now = new Date();
  const defaultDay = now.toISOString().slice(0, 10);
  const startRaw = params.startDate ?? defaultDay;
  const endRaw = params.endDate ?? startRaw;

  const start = new Date(`${startRaw}T00:00:00.000Z`);
  const endInclusive = new Date(`${endRaw}T00:00:00.000Z`);
  const endExclusive = new Date(endInclusive);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);

  return {
    start,
    endExclusive,
    startRaw,
    endRaw,
  };
}

function paymentLabel(status: string) {
  if (status === "PAID") return "Payé";
  if (status === "UNPAID") return "Non payé";
  return "Partiel";
}

function saleNatureLabel(value: string) {
  return value === "CREDIT" ? "Crédit" : "Cash";
}

function normalizeAirlineSelectionLabel(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function canonicalAirlineSelectionKey(airline: { code: string; name: string }) {
  const code = airline.code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const baseCode = code.replace(/\d+$/g, "");
  const name = normalizeAirlineSelectionLabel(airline.name);

  if (name.includes("airfast") || code === "AI1" || baseCode === "FST") return "FST";
  if (name.includes("aircong") || name.includes("aircingo") || baseCode === "AIR" || (baseCode === "AI" && !name.includes("airfast"))) return "ACG";
  if (name.includes("ethi") || ["ET", "ETH", "ETI"].includes(baseCode)) return "ET";
  if (name.includes("kenya") || ["KQ", "KE", "KEN"].includes(baseCode)) return "KQ";
  if (name === "caa" || ["CAA", "CA"].includes(baseCode)) return "CAA";
  if (name.includes("montgabaon") || name.includes("montgabon") || ["MGB", "MG"].includes(baseCode)) return "MGB";
  if (name.includes("dakota") || ["DKT", "DAK", "DK"].includes(baseCode)) return "DKT";
  if (name.includes("asky") || baseCode === "KP") return "KP";
  if (name.includes("airfrance") || baseCode === "AF") return "AF";
  if (name.includes("brussels") || baseCode === "SN") return "SN";
  if (name.includes("rwand")) return "WB";
  if (name.includes("uganda")) return "UR";
  if (name.includes("tanzania")) return "TC";

  return `${baseCode || code}:${name}`;
}

function airlineSelectionScore(airline: { code: string; name: string; commissionRules: Array<unknown> }) {
  const code = airline.code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  let score = 0;
  if (/^[A-Z]{2,3}$/.test(code)) score += 100;
  if (airline.commissionRules.length > 0) score += 20;
  score -= airline.name.length / 1000;
  return score;
}

export default async function SalesPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const dateRange = rangeFromSearch(resolvedSearchParams);
  const { session, role } = await requirePageModuleAccess("sales", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  const currentJobTitle = session.user.jobTitle ?? "AGENT_TERRAIN";
  const roleTicketFilter = {};
  const canCreateTicket = canSellTickets(currentJobTitle);
  const canManageTickets = canManageTicketRecord(role);
  const canImportTickets = canImportTicketWorkbook(role, session.user.canImportTicketWorkbook, currentJobTitle);
  const canReplaceImportedPeriod = role === "ADMIN";
  const accessNote = canManageTickets
    ? "Vente: tous les profils autorisés peuvent encoder les billets; l'admin peut en plus importer Excel, modifier et supprimer les billets déjà enregistrés."
    : "Vente: vous pouvez encoder les billets normalement. L'import Excel, la modification et la suppression restent réservés à l'administrateur.";

  await ensureAirlineCatalog(prisma);

  const [users, airlines, teams, tickets, importHistory, depositAccounts] = await Promise.all([
    prisma.user.findMany({
      where: { role: { in: ["EMPLOYEE", "MANAGER", "ADMIN", "ACCOUNTANT"] } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.airline.findMany({
      include: { commissionRules: { where: { isActive: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.team.findMany({
      select: { id: true, name: true, kind: true },
      orderBy: { name: "asc" },
    }),
    prisma.ticketSale.findMany({
      where: {
        soldAt: {
          gte: dateRange.start,
          lt: dateRange.endExclusive,
        },
      },
      include: { airline: true, seller: { select: { name: true } }, payments: true, },

      orderBy: { soldAt: "desc" },
      take: 200,
    }),
    canImportTickets ? listTicketWorkbookImportHistory() : Promise.resolve([]),
    buildAirlineDepositAccountSummaries(
      prisma as unknown as { airlineDepositMovement: { findMany: (args: unknown) => Promise<unknown[]> } },
    ),
  ]);

  const caaAirline = airlines.find((airline) => airline.code === "CAA");
  const caaRule = caaAirline?.commissionRules
    .filter((rule) => rule.isActive && rule.commissionMode === "AFTER_DEPOSIT")
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())[0];
  const caaTargetAmount = caaRule?.depositStockTargetAmount ?? 0;
  const caaBatchCommission = caaRule?.batchCommissionAmount ?? 0;
  const orderedCaaTicketsUntilPeriodEnd = caaAirline
    ? await prisma.ticketSale.findMany({
      where: {
        ...roleTicketFilter,
        airlineId: caaAirline.id,
        soldAt: { lt: dateRange.endExclusive },
      },
      select: { id: true, soldAt: true, amount: true },
      orderBy: [{ soldAt: "asc" }, { id: "asc" }],
    })
    : [];

  const caaTicketsInPeriod = caaAirline
    ? tickets.filter((ticket) => ticket.airlineId === caaAirline.id)
    : [];

  const caaCommissionMap = caaAirline
    ? computeCaaCommissionMap({
      periodTicketIds: caaTicketsInPeriod.map((ticket) => ticket.id),
      orderedCaaTicketsUntilPeriodEnd,
      targetAmount: caaTargetAmount,
      batchCommissionAmount: caaBatchCommission,
    })
    : new Map<string, number>();

  const commissionOf = (ticket: { id: string; airline: { code: string }; amount: number; commissionAmount: number | null; commissionRateUsed: number }) => {
    if (ticket.airline.code === "CAA" && caaCommissionMap.has(ticket.id)) {
      return caaCommissionMap.get(ticket.id) ?? 0;
    }
    return ticket.commissionAmount ?? ticket.amount * (ticket.commissionRateUsed / 100);
  };

  const selectableAirlines = Array.from(
    airlines.reduce((map, airline) => {
      const key = canonicalAirlineSelectionKey(airline);
      const current = map.get(key);
      if (!current || airlineSelectionScore(airline) > airlineSelectionScore(current)) {
        map.set(key, airline);
      }
      return map;
    }, new Map<string, (typeof airlines)[number]>()),
  )
    .map(([, airline]) => airline)
    .sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }));

  return (
    <AppShell role={role} accessNote={accessNote}>
      <section className="mb-6">
        <h1 className="text-2xl font-semibold">Gestion des billets</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Tout profil vente habilité peut encoder un billet. Seul l&apos;administrateur peut importer un fichier Excel, modifier un billet déjà enregistré ou le supprimer.
        </p>
      </section>

      <section className="mb-6 rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
        <form method="GET" className="grid gap-3 sm:grid-cols-3 sm:items-end">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Du</label>
            <input
              type="date"
              name="startDate"
              defaultValue={dateRange.startRaw}
              className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Au</label>
            <input
              type="date"
              name="endDate"
              defaultValue={dateRange.endRaw}
              className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            />
          </div>
          <button type="submit" className="rounded-md bg-black px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black">Rechercher</button>
        </form>
      </section>

      <div className="grid gap-6 lg:grid-cols-[400px,1fr]">
        {canCreateTicket ? (
          <div className="grid gap-6">
            <TicketForm
              users={users}
              airlines={selectableAirlines.map((airline) => ({
                id: airline.id,
                name: airline.name,
                code: airline.code,
              }))}
              teams={teams.map((team) => ({
                id: team.id,
                name: team.name,
                kind: team.kind,
              }))}
              depositAccounts={depositAccounts.map((account) => ({
                key: account.key,
                label: account.label,
                airlineCodes: account.airlineCodes,
                balance: account.balance,
              }))}
            />
            {canImportTickets ? (
              <TicketImportForm
                defaultSellerEmail={session.user.email ?? ""}
                canReplacePeriod={canReplaceImportedPeriod}
                initialHistory={importHistory}
              />
            ) : null}
          </div>
        ) : (
          <section className="rounded-xl border border-black/10 bg-white p-4 text-sm text-black/70 dark:border-white/10 dark:bg-zinc-900 dark:text-white/70">
            Encodage des billets autorisé sur ce profil. Seul l&apos;import Excel est limité à l&apos;administrateur.
          </section>
        )}

        <div className="overflow-hidden rounded-xl border border-black/10 bg-white dark:border-white/10 dark:bg-zinc-900">
          <div className="tickets-scroll h-[70vh] w-full overflow-scroll overscroll-contain">
          <table className="min-w-300 text-sm">
            <thead className="bg-black/5 dark:bg-white/10">
              <tr>
                <th className="px-3 py-2 text-left">Émetteur</th>
                <th className="px-3 py-2 text-left">Compagnie</th>
                <th className="px-3 py-2 text-left">Code billet (PNR)</th>
                <th className="px-3 py-2 text-left">Itinéraire</th>
                <th className="px-3 py-2 text-left">Prix</th>
                <th className="px-3 py-2 text-left">BaseFare</th>
                <th className="px-3 py-2 text-left">Commission</th>
                <th className="px-3 py-2 text-left">Net après déduction</th>
                <th className="px-3 py-2 text-left">Nature vente</th>
                <th className="px-3 py-2 text-left">Statut</th>
                <th className="px-3 py-2 text-left">Payant</th>
                {canManageTickets ? <th className="px-3 py-2 text-left">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {tickets.map((ticket) => {
                const commissionAmount = commissionOf(ticket);
                const agencyMarkupAmount = ticket.agencyMarkupAmount ?? 0;
                const companyCommissionAmount = Math.max(0, commissionAmount - agencyMarkupAmount);
                const netAfterCommission = ticket.amount + agencyMarkupAmount;

                return (
                  <tr key={ticket.id} className="border-t border-black/5 dark:border-white/10">
                    <td className="px-3 py-2">{ticket.sellerName ?? ticket.seller?.name ?? "—"}</td>
                    <td className="px-3 py-2">{ticket.airline.code}</td>
                    <td className="px-3 py-2">{ticket.ticketNumber}</td>
                    <td className="px-3 py-2">{ticket.route}</td>
                    <td className="px-3 py-2">{ticket.amount.toFixed(2)} {ticket.currency}</td>
                    <td className="px-3 py-2">{(ticket.baseFareAmount ?? ticket.commissionBaseAmount).toFixed(2)} {ticket.currency}</td>
                    <td className="px-3 py-2">
                      <span className="font-medium">Total: {commissionAmount.toFixed(2)} {ticket.currency}</span>
                      <span className="ml-1 text-xs text-black/60 dark:text-white/60">
                        (Compagnie: {companyCommissionAmount.toFixed(2)} • Majoration: {agencyMarkupAmount.toFixed(2)})
                      </span>
                      <span className="ml-1 text-xs text-black/60 dark:text-white/60">
                        {ticket.commissionCalculationStatus === "ESTIMATED" ? "(estimée)" : "(définitive)"}
                      </span>
                    </td>
                    <td className="px-3 py-2">{netAfterCommission.toFixed(2)} {ticket.currency}</td>
                    <td className="px-3 py-2">{saleNatureLabel(ticket.saleNature)}</td>
                    <td className="px-3 py-2">{paymentLabel(ticket.paymentStatus)}</td>
                    <td className="px-3 py-2">{ticket.payerName ?? "-"}</td>
                    {canManageTickets ? (
                      <td className="px-3 py-2">
                        <TicketRowActions
                          ticket={{
                            id: ticket.id,
                            ticketNumber: ticket.ticketNumber,
                            airlineId: ticket.airlineId,
                            sellerId: ticket.sellerId,
                            customerName: ticket.customerName,
                            route: ticket.route,
                            travelClass: ticket.travelClass,
                            travelDate: new Date(ticket.travelDate).toISOString().slice(0, 10),
                            amount: ticket.amount,
                            baseFareAmount: ticket.baseFareAmount,
                            currency: ticket.currency,
                            saleNature: ticket.saleNature,
                            agencyMarkupPercent: ticket.agencyMarkupPercent,
                            agencyMarkupAmount: ticket.agencyMarkupAmount,
                            paymentStatus: ticket.paymentStatus,
                            payerName: ticket.payerName,
                            notes: ticket.notes,
                          }}
                        />
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
