import { PaymentStatus, ReportStatus } from "@prisma/client";
import { AppShell } from "@/components/app-shell";
import { AuditWorkspace } from "@/components/audit-workspace";
import { prisma } from "@/lib/prisma";
import { requirePageModuleAccess } from "@/lib/rbac";

export const dynamic = "force-dynamic";

type SearchParams = {
  startDate?: string;
  endDate?: string;
};

type AuditDecision = "PENDING" | "VALIDATED" | "REJECTED";

function computeDecisionFromActions(actions: string[]): AuditDecision {
  let decision: AuditDecision = "PENDING";
  for (const action of actions) {
    if (action === "AUDIT_VALIDATE") decision = "VALIDATED";
    if (action === "AUDIT_REJECT") decision = "REJECTED";
  }
  return decision;
}

function dateRangeFromParams(params: SearchParams) {
  const now = new Date();
  const defaultDay = now.toISOString().slice(0, 10);
  const startRaw = params.startDate ?? defaultDay;
  const endRaw = params.endDate ?? startRaw;
  const start = new Date(`${startRaw}T00:00:00.000Z`);
  const end = new Date(`${endRaw}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end, startRaw, endRaw };
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const { role } = await requirePageModuleAccess("audit", ["ADMIN", "MANAGER", "ACCOUNTANT"]);
  const resolvedSearchParams = (await searchParams) ?? {};
  const range = dateRangeFromParams(resolvedSearchParams);

  const [tickets, reports, needs, attendances, stocks, notifications] = await Promise.all([
    prisma.ticketSale.findMany({
      where: { soldAt: { gte: range.start, lt: range.end } },
      include: {
        payments: { select: { amount: true } },
        seller: { select: { name: true } },
      },
      orderBy: { soldAt: "desc" },
      take: 400,
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
      take: 300,
    }),
    prisma.attendance.findMany({
      where: { date: { gte: range.start, lt: range.end } },
      include: { user: { select: { name: true } } },
      orderBy: { date: "desc" },
      take: 300,
    }),
    prisma.stockItem.findMany({
      where: { reorderLevel: { not: null } },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
    prisma.userNotification.findMany({
      where: { isRead: false },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  const [ticketDecisionLogs, reportDecisionLogs, needDecisionLogs, attendanceDecisionLogs] = await Promise.all([
    prisma.auditLog.findMany({
      where: {
        entityType: "AUDIT_TICKET_SALE",
        entityId: { in: tickets.map((item) => item.id) },
        action: { in: ["AUDIT_VALIDATE", "AUDIT_REJECT"] },
      },
      select: { entityId: true, action: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.auditLog.findMany({
      where: {
        entityType: "AUDIT_WORKER_REPORT",
        entityId: { in: reports.map((item) => item.id) },
        action: { in: ["AUDIT_VALIDATE", "AUDIT_REJECT"] },
      },
      select: { entityId: true, action: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.auditLog.findMany({
      where: {
        entityType: "AUDIT_NEED_REQUEST",
        entityId: { in: needs.map((item) => item.id) },
        action: { in: ["AUDIT_VALIDATE", "AUDIT_REJECT"] },
      },
      select: { entityId: true, action: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.auditLog.findMany({
      where: {
        entityType: "AUDIT_ATTENDANCE",
        entityId: { in: attendances.map((item) => item.id) },
        action: { in: ["AUDIT_VALIDATE", "AUDIT_REJECT"] },
      },
      select: { entityId: true, action: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const decisionMap = new Map<string, AuditDecision>();
  const allDecisionLogs = [
    ...ticketDecisionLogs,
    ...reportDecisionLogs,
    ...needDecisionLogs,
    ...attendanceDecisionLogs,
  ];

  const groupedActions = new Map<string, string[]>();
  for (const log of allDecisionLogs) {
    const actions = groupedActions.get(log.entityId) ?? [];
    actions.push(log.action);
    groupedActions.set(log.entityId, actions);
  }

  groupedActions.forEach((actions, entityId) => {
    decisionMap.set(entityId, computeDecisionFromActions(actions));
  });

  const ticketDossiers = tickets.map((ticket) => {
    const paidAmount = ticket.payments.reduce((sum, payment) => sum + payment.amount, 0);
    const status = paidAmount <= 0
      ? PaymentStatus.UNPAID
      : paidAmount + 0.0001 >= ticket.amount
        ? PaymentStatus.PAID
        : PaymentStatus.PARTIAL;

    return {
      entityType: "TICKET_SALE" as const,
      entityId: ticket.id,
      reference: ticket.ticketNumber,
      client: ticket.customerName,
      amount: ticket.amount,
      margin: ticket.commissionAmount + ticket.agencyMarkupAmount,
      service: "BILLETS",
      status,
      auditDecision: decisionMap.get(ticket.id) ?? "PENDING",
      ownerName: ticket.seller.name,
      createdAt: ticket.soldAt.toISOString(),
    };
  });

  const reportDossiers = reports.map((report) => ({
    entityType: "WORKER_REPORT" as const,
    entityId: report.id,
    reference: report.title,
    client: report.author.name,
    amount: 0,
    margin: null,
    service: "RAPPORTS",
    status: report.status,
    auditDecision: decisionMap.get(report.id) ?? "PENDING",
    ownerName: report.author.name,
    createdAt: report.createdAt.toISOString(),
  }));

  const needDossiers = needs.map((need) => ({
    entityType: "NEED_REQUEST" as const,
    entityId: need.id,
    reference: need.title,
    client: need.requester.name,
    amount: need.estimatedAmount ?? 0,
    margin: null,
    service: "APPROVISIONNEMENT",
    status: need.status,
    auditDecision: decisionMap.get(need.id) ?? "PENDING",
    ownerName: need.requester.name,
    createdAt: need.createdAt.toISOString(),
  }));

  const attendanceDossiers = attendances.map((row) => ({
    entityType: "ATTENDANCE" as const,
    entityId: row.id,
    reference: `Presence ${new Date(row.date).toISOString().slice(0, 10)}`,
    client: row.user.name,
    amount: 0,
    margin: null,
    service: "PRESENCES",
    status: row.status,
    auditDecision: decisionMap.get(row.id) ?? "PENDING",
    ownerName: row.user.name,
    createdAt: row.date.toISOString(),
  }));

  const dossiers = [...ticketDossiers, ...reportDossiers, ...needDossiers, ...attendanceDossiers]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const alerts = {
    anomalies: [
      {
        label: "Billets partiellement payés",
        detail: `${ticketDossiers.filter((item) => item.status === PaymentStatus.PARTIAL).length} dossier(s) à vérifier.`,
        severity: "high" as const,
      },
      {
        label: "Rapports soumis non approuvés",
        detail: `${reportDossiers.filter((item) => item.status === ReportStatus.SUBMITTED).length} rapport(s) en attente.`,
        severity: "medium" as const,
      },
    ],
    stocks: stocks
      .filter((item) => item.reorderLevel != null && item.currentQuantity <= item.reorderLevel)
      .slice(0, 8)
      .map((item) => ({
        label: item.name,
        detail: `${item.currentQuantity} ${item.unit} (seuil ${item.reorderLevel})`,
        severity: "high" as const,
      })),
    signalements: notifications.slice(0, 8).map((item) => ({
      label: item.title,
      detail: item.message,
      severity: "low" as const,
    })),
  };

  const employees = Array.from(new Set(dossiers.map((item) => item.ownerName))).sort((a, b) => a.localeCompare(b, "fr"));

  return (
    <AppShell role={role} accessNote="Espace auditeur: contrôle transverse, traçabilité et validation multi-services.">
      <section className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Espace Auditeur</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Ouvrir un dossier, vérifier les chiffres, cocher la conformité, tracer et valider/rejeter.
        </p>
      </section>

      <AuditWorkspace
        dossiers={dossiers}
        alerts={alerts}
        employees={employees}
        defaultStartDate={range.startRaw}
        defaultEndDate={range.endRaw}
      />
    </AppShell>
  );
}
