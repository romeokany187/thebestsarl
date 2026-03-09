import { ReportStatus } from "@prisma/client";
import { AppShell } from "@/components/app-shell";
import { KpiCard } from "@/components/kpi-card";
import { prisma } from "@/lib/prisma";
import { requirePageRoles } from "@/lib/rbac";

export const dynamic = "force-dynamic";

type SearchParams = {
  startDate?: string;
  endDate?: string;
};

function dateRangeFromParams(params: SearchParams) {
  const now = new Date();
  const defaultDay = now.toISOString().slice(0, 10);
  const startRaw = params.startDate ?? defaultDay;
  const endRaw = params.endDate ?? startRaw;
  const start = new Date(`${startRaw}T00:00:00.000Z`);
  const end = new Date(`${endRaw}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);

  return {
    start,
    end,
    startRaw,
    endRaw,
  };
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const { role } = await requirePageRoles(["ADMIN", "MANAGER", "ACCOUNTANT"]);
  const resolvedSearchParams = (await searchParams) ?? {};
  const range = dateRangeFromParams(resolvedSearchParams);

  const [
    teamsCount,
    usersCount,
    tickets,
    paymentAgg,
    attendance,
    reports,
    needRequests,
    stockAlerts,
    archivesCount,
    unreadNotifications,
  ] = await Promise.all([
    prisma.team.count(),
    prisma.user.count(),
    prisma.ticketSale.findMany({
      where: { soldAt: { gte: range.start, lt: range.end } },
      include: {
        payments: { select: { amount: true } },
        seller: { select: { name: true } },
      },
      orderBy: { soldAt: "desc" },
      take: 300,
    }),
    prisma.payment.aggregate({
      where: { paidAt: { gte: range.start, lt: range.end } },
      _sum: { amount: true },
      _count: { id: true },
    }),
    prisma.attendance.findMany({
      where: { date: { gte: range.start, lt: range.end } },
      include: { user: { select: { name: true } } },
      orderBy: { date: "desc" },
      take: 300,
    }),
    prisma.workerReport.findMany({
      where: { createdAt: { gte: range.start, lt: range.end } },
      include: { author: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
    prisma.needRequest.findMany({
      where: { createdAt: { gte: range.start, lt: range.end } },
      include: { requester: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.stockItem.findMany({
      where: {
        reorderLevel: { not: null },
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
    prisma.archiveDocument.count({ where: { createdAt: { gte: range.start, lt: range.end } } }),
    prisma.userNotification.count({ where: { isRead: false } }),
  ]);

  const ticketsWithStatus = tickets.map((ticket) => {
    const paidAmount = ticket.payments.reduce((sum, payment) => sum + payment.amount, 0);
    const status = paidAmount <= 0
      ? "UNPAID"
      : paidAmount + 0.0001 >= ticket.amount
        ? "PAID"
        : "PARTIAL";

    return {
      ...ticket,
      paidAmount,
      status,
      remaining: Math.max(0, ticket.amount - paidAmount),
    };
  });

  const totalBilled = ticketsWithStatus.reduce((sum, ticket) => sum + ticket.amount, 0);
  const totalPaidOnTickets = ticketsWithStatus.reduce((sum, ticket) => sum + ticket.paidAmount, 0);
  const totalReceivable = Math.max(0, totalBilled - totalPaidOnTickets);

  const unpaidTickets = ticketsWithStatus.filter((ticket) => ticket.status === "UNPAID");
  const partialTickets = ticketsWithStatus.filter((ticket) => ticket.status === "PARTIAL");
  const pendingCollection = [...unpaidTickets, ...partialTickets]
    .sort((a, b) => b.remaining - a.remaining)
    .slice(0, 15);

  const lateAttendance = attendance
    .filter((row) => row.latenessMins > 0)
    .sort((a, b) => b.latenessMins - a.latenessMins)
    .slice(0, 12);

  const pendingReports = reports
    .filter((report) => report.status === ReportStatus.SUBMITTED)
    .slice(0, 12);

  const submittedNeeds = needRequests.filter((item) => item.status === "SUBMITTED").slice(0, 12);

  const stockRisks = stockAlerts
    .filter((item) => item.reorderLevel != null && item.currentQuantity <= item.reorderLevel)
    .slice(0, 12);

  const totalPaymentsReceived = paymentAgg._sum.amount ?? 0;

  const paymentReportQuery = new URLSearchParams({
    startDate: range.startRaw,
    endDate: range.endRaw,
  }).toString();

  return (
    <AppShell
      role={role}
      accessNote="Espace auditeur: contrôle transversal de tous les services avec alertes et indicateurs consolidés."
    >
      <section className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Espace Auditeur</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Audit opérationnel global: ventes, paiements, présences, rapports, besoins, stocks et archives.
        </p>
      </section>

      <section className="mb-6 rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
        <form method="GET" className="grid gap-3 lg:grid-cols-3 lg:items-end">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Du</label>
            <input
              type="date"
              name="startDate"
              defaultValue={range.startRaw}
              className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Au</label>
            <input
              type="date"
              name="endDate"
              defaultValue={range.endRaw}
              className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            />
          </div>
          <button type="submit" className="rounded-md bg-black px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black">
            Auditer la période
          </button>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <a
            href={`/api/payments/report?${paymentReportQuery}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex rounded-md border border-black/20 px-2.5 py-1 font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Lire PDF paiements
          </a>
          <a
            href={`/api/payments/report?${paymentReportQuery}&download=1`}
            className="inline-flex rounded-md border border-black/20 px-2.5 py-1 font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Télécharger PDF paiements
          </a>
        </div>
      </section>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total facturé" value={`${totalBilled.toFixed(2)} USD`} />
        <KpiCard label="Paiements reçus" value={`${totalPaymentsReceived.toFixed(2)} USD`} />
        <KpiCard label="Créances ouvertes" value={`${totalReceivable.toFixed(2)} USD`} hint={`${unpaidTickets.length} impayés • ${partialTickets.length} partiels`} />
        <KpiCard label="Présences en retard" value={`${lateAttendance.length}`} hint={`Sur ${attendance.length} entrées présence`} />
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Rapports soumis" value={`${pendingReports.length}`} hint={`Total période: ${reports.length}`} />
        <KpiCard label="Demandes à traiter" value={`${submittedNeeds.length}`} hint={`Total période: ${needRequests.length}`} />
        <KpiCard label="Alertes stock" value={`${stockRisks.length}`} hint="Seuil de réappro atteint" />
        <KpiCard label="Signalements divers" value={`${unreadNotifications}`} hint={`${archivesCount} archives ajoutées`} />
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Équipes" value={`${teamsCount}`} />
        <KpiCard label="Utilisateurs" value={`${usersCount}`} />
        <KpiCard label="Billets audités" value={`${ticketsWithStatus.length}`} />
        <KpiCard label="Paiements saisis" value={`${paymentAgg._count.id}`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <h2 className="mb-3 text-base font-semibold">Top créances à recouvrer</h2>
          <ul className="space-y-2 text-sm">
            {pendingCollection.length > 0 ? pendingCollection.map((ticket) => (
              <li key={ticket.id} className="rounded-lg border border-black/10 px-3 py-2 dark:border-white/10">
                <p className="font-semibold">{ticket.ticketNumber} • {ticket.customerName}</p>
                <p className="text-xs text-black/60 dark:text-white/60">
                  Facturé {ticket.amount.toFixed(2)} USD • Encaissé {ticket.paidAmount.toFixed(2)} USD • Reste {ticket.remaining.toFixed(2)} USD • {ticket.status}
                </p>
              </li>
            )) : (
              <li className="rounded-lg border border-dashed border-black/20 px-3 py-2 text-xs text-black/55 dark:border-white/20 dark:text-white/55">
                Aucune créance prioritaire sur cette période.
              </li>
            )}
          </ul>
        </section>

        <section className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <h2 className="mb-3 text-base font-semibold">Retards de présence à contrôler</h2>
          <ul className="space-y-2 text-sm">
            {lateAttendance.length > 0 ? lateAttendance.map((row) => (
              <li key={row.id} className="rounded-lg border border-black/10 px-3 py-2 dark:border-white/10">
                <p className="font-semibold">{row.user.name}</p>
                <p className="text-xs text-black/60 dark:text-white/60">
                  {new Date(row.date).toLocaleDateString()} • Retard: {row.latenessMins} min • Entrée: {row.clockIn ? new Date(row.clockIn).toLocaleTimeString() : "-"}
                </p>
              </li>
            )) : (
              <li className="rounded-lg border border-dashed border-black/20 px-3 py-2 text-xs text-black/55 dark:border-white/20 dark:text-white/55">
                Aucun retard détecté.
              </li>
            )}
          </ul>
        </section>

        <section className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <h2 className="mb-3 text-base font-semibold">Rapports en attente de validation</h2>
          <ul className="space-y-2 text-sm">
            {pendingReports.length > 0 ? pendingReports.map((report) => (
              <li key={report.id} className="rounded-lg border border-black/10 px-3 py-2 dark:border-white/10">
                <p className="font-semibold">{report.title}</p>
                <p className="text-xs text-black/60 dark:text-white/60">
                  Auteur: {report.author.name} • Période: {report.period} • Statut: {report.status}
                </p>
              </li>
            )) : (
              <li className="rounded-lg border border-dashed border-black/20 px-3 py-2 text-xs text-black/55 dark:border-white/20 dark:text-white/55">
                Aucun rapport soumis en attente.
              </li>
            )}
          </ul>
        </section>

        <section className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <h2 className="mb-3 text-base font-semibold">Stocks critiques et besoins soumis</h2>
          <ul className="space-y-2 text-sm">
            {stockRisks.map((item) => (
              <li key={item.id} className="rounded-lg border border-black/10 px-3 py-2 dark:border-white/10">
                <p className="font-semibold">{item.name}</p>
                <p className="text-xs text-black/60 dark:text-white/60">
                  Quantité: {item.currentQuantity} {item.unit} • Seuil: {item.reorderLevel}
                </p>
              </li>
            ))}
            {submittedNeeds.map((item) => (
              <li key={item.id} className="rounded-lg border border-black/10 px-3 py-2 dark:border-white/10">
                <p className="font-semibold">{item.title}</p>
                <p className="text-xs text-black/60 dark:text-white/60">
                  Demandeur: {item.requester.name} • Quantité: {item.quantity} {item.unit} • Statut: {item.status}
                </p>
              </li>
            ))}
            {stockRisks.length === 0 && submittedNeeds.length === 0 ? (
              <li className="rounded-lg border border-dashed border-black/20 px-3 py-2 text-xs text-black/55 dark:border-white/20 dark:text-white/55">
                Aucun point de risque stock/besoin détecté.
              </li>
            ) : null}
          </ul>
        </section>
      </div>
    </AppShell>
  );
}
