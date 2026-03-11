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

type AuditRiskLevel = "LOW" | "MEDIUM" | "HIGH";

type EmployeeAuditMetric = {
  name: string;
  attendanceDays: number;
  attendanceRate: number;
  reportsSubmitted: number;
  reportsApproved: number;
  ticketsSold: number;
  ticketsAmount: number;
  score: number;
  level: "EXCELLENT" | "GOOD" | "WATCH" | "CRITICAL";
  recommendation: string;
};

function riskLevelFromScore(score: number): AuditRiskLevel {
  if (score >= 70) return "HIGH";
  if (score >= 40) return "MEDIUM";
  return "LOW";
}

function computeRiskForDossier(params: {
  service: string;
  status: string;
  auditDecision: AuditDecision;
  amount: number;
}) {
  let score = 0;
  const reasons: string[] = [];

  if (params.auditDecision === "PENDING") {
    score += 25;
    reasons.push("dossier non audité");
  }

  if (params.auditDecision === "REJECTED") {
    score += 35;
    reasons.push("rejet audit");
  }

  if (params.service === "BILLETS" && params.status === "PARTIAL") {
    score += 28;
    reasons.push("paiement partiel");
  }

  if (params.service === "RAPPORTS" && params.status === "SUBMITTED") {
    score += 20;
    reasons.push("rapport non approuvé");
  }

  if (params.service === "APPROVISIONNEMENT" && params.status === "SUBMITTED") {
    score += 22;
    reasons.push("EDB en attente");
  }

  if (params.amount >= 1500) {
    score += 12;
    reasons.push("montant sensible");
  }

  if (params.amount >= 4000) {
    score += 12;
    reasons.push("montant élevé");
  }

  const bounded = Math.min(100, score);
  return {
    riskScore: bounded,
    riskLevel: riskLevelFromScore(bounded),
    riskReason: reasons.length > 0 ? reasons.join(" • ") : "profil stable",
  };
}

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
  const { role, session } = await requirePageModuleAccess("audit", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  const canWriteAudit = (session.user.jobTitle ?? "").toUpperCase() === "AUDITEUR";
  const resolvedSearchParams = (await searchParams) ?? {};
  const range = dateRangeFromParams(resolvedSearchParams);

  const [tickets, payments, reports, needs, attendances, stocks, notifications] = await Promise.all([
    prisma.ticketSale.findMany({
      where: { soldAt: { gte: range.start, lt: range.end } },
      include: {
        payments: { select: { amount: true } },
        seller: { select: { name: true } },
      },
      orderBy: { soldAt: "desc" },
      take: 400,
    }),
    prisma.payment.findMany({
      where: { paidAt: { gte: range.start, lt: range.end } },
      include: {
        ticket: {
          select: {
            ticketNumber: true,
            customerName: true,
            amount: true,
            currency: true,
          },
        },
      },
      orderBy: { paidAt: "desc" },
      take: 500,
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

  const [ticketDecisionLogs, paymentDecisionLogs, reportDecisionLogs, needDecisionLogs, attendanceDecisionLogs] = await Promise.all([
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
        entityType: "AUDIT_PAYMENT",
        entityId: { in: payments.map((item) => item.id) },
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
    ...paymentDecisionLogs,
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

  const paymentDossiers = payments.map((payment) => ({
    entityType: "PAYMENT" as const,
    entityId: payment.id,
    reference: `Paiement ${payment.ticket.ticketNumber}`,
    client: payment.ticket.customerName,
    amount: payment.amount,
    margin: null,
    service: "CAISSE",
    status: payment.method,
    auditDecision: decisionMap.get(payment.id) ?? "PENDING",
    ownerName: payment.reference ?? "Caisse",
    createdAt: payment.paidAt.toISOString(),
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

  const dossiers = [...ticketDossiers, ...paymentDossiers, ...reportDossiers, ...needDossiers, ...attendanceDossiers]
    .map((item) => ({
      ...item,
      ...computeRiskForDossier({
        service: item.service,
        status: String(item.status),
        auditDecision: item.auditDecision,
        amount: item.amount,
      }),
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const alerts = {
    anomalies: [
      {
        label: "Billets partiellement payés",
        detail: `${ticketDossiers.filter((item) => item.status === PaymentStatus.PARTIAL).length} dossier(s) à vérifier.`,
        severity: "high" as const,
      },
      {
        label: "Paiements caisse à contrôler",
        detail: `${paymentDossiers.filter((item) => item.auditDecision === "PENDING").length} mouvement(s) en attente de vérification.`,
        severity: "medium" as const,
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

  const globalRiskIndex = dossiers.length > 0
    ? Math.round(dossiers.reduce((sum, item) => sum + item.riskScore, 0) / dossiers.length)
    : 0;

  const criticalPending = dossiers.filter((item) => item.auditDecision === "PENDING" && item.riskLevel === "HIGH");

  const serviceExposureMap = new Map<string, number>();
  for (const item of dossiers) {
    const current = serviceExposureMap.get(item.service) ?? 0;
    serviceExposureMap.set(item.service, current + item.riskScore);
  }
  const topServiceAtRisk = Array.from(serviceExposureMap.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "-";

  const recommendations: string[] = [];
  if (criticalPending.length > 0) {
    recommendations.push(`Traiter en priorité ${criticalPending.length} dossier(s) critique(s) en attente.`);
  }
  if (ticketDossiers.some((item) => item.status === PaymentStatus.PARTIAL)) {
    recommendations.push("Vérifier immédiatement les billets en paiement partiel et rapprocher les encaissements.");
  }
  if (reportDossiers.some((item) => item.status === ReportStatus.SUBMITTED)) {
    recommendations.push("Accélérer la boucle de validation des rapports soumis pour réduire le risque documentaire.");
  }
  if (recommendations.length === 0) {
    recommendations.push("Profil global stable: maintenir les contrôles périodiques et la traçabilité des validations.");
  }

  const agentNames = Array.from(new Set([
    ...tickets.map((item) => item.seller.name),
    ...reports.map((item) => item.author.name),
    ...attendances.map((item) => item.user.name),
  ])).sort((a, b) => a.localeCompare(b, "fr"));

  const employeeAudits: EmployeeAuditMetric[] = agentNames.map((name) => {
    const attendRows = attendances.filter((item) => item.user.name === name);
    const activePresence = attendRows.filter((item) => item.status !== "ABSENT");
    const attendanceDays = attendRows.length;
    const attendanceRate = attendanceDays > 0 ? Math.round((activePresence.length / attendanceDays) * 100) : 0;

    const reportRows = reports.filter((item) => item.author.name === name);
    const reportsSubmitted = reportRows.filter((item) => item.status === "SUBMITTED" || item.status === "APPROVED").length;
    const reportsApproved = reportRows.filter((item) => item.status === "APPROVED").length;

    const soldRows = tickets.filter((item) => item.seller.name === name);
    const ticketsSold = soldRows.length;
    const ticketsAmount = soldRows.reduce((sum, item) => sum + item.amount, 0);

    let score = 0;
    score += Math.min(35, attendanceRate * 0.35);
    score += Math.min(35, ticketsSold * 3.5);
    score += Math.min(30, reportsApproved * 6 + reportsSubmitted * 2);
    const rounded = Math.round(Math.min(100, score));

    const level = rounded >= 80
      ? "EXCELLENT"
      : rounded >= 60
        ? "GOOD"
        : rounded >= 40
          ? "WATCH"
          : "CRITICAL";

    const recommendation = level === "EXCELLENT"
      ? "Performance stable, maintenir la regularite et la qualite des preuves."
      : level === "GOOD"
        ? "Renforcer la cadence des rapports approuves pour gagner en fiabilite."
        : level === "WATCH"
          ? "Surveiller ce profil: aligner presence, ventes et reporting hebdomadaire."
          : "Risque eleve: plan d'accompagnement immediat et controle renforce.";

    return {
      name,
      attendanceDays,
      attendanceRate,
      reportsSubmitted,
      reportsApproved,
      ticketsSold,
      ticketsAmount,
      score: rounded,
      level,
      recommendation,
    };
  }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "fr"));

  return (
    <AppShell
      role={role}
      accessNote={canWriteAudit
        ? "Espace auditeur: contrôle transverse, traçabilité et validation multi-services."
        : "Mode lecture: consultation des rapports d'audit uniquement."}
    >
      <div className="flex h-[calc(100vh-130px)] min-h-0 flex-col overflow-hidden">
        <section className="mb-4 shrink-0">
          <h1 className="text-2xl font-semibold tracking-tight">Espace Auditeur</h1>
          <p className="text-sm text-black/60 dark:text-white/60">
            Ouvrir un dossier, vérifier les chiffres, cocher la conformité, tracer et valider/rejeter.
          </p>
        </section>

        <div className="min-h-0 flex-1 overflow-hidden">
          <AuditWorkspace
            dossiers={dossiers}
            alerts={alerts}
            employees={employees}
            defaultStartDate={range.startRaw}
            defaultEndDate={range.endRaw}
            canWrite={canWriteAudit}
            insights={{
              globalRiskIndex,
              criticalPendingCount: criticalPending.length,
              topServiceAtRisk,
              recommendations,
              prioritizedQueue: dossiers
                .slice()
                .sort((a, b) => b.riskScore - a.riskScore || b.createdAt.localeCompare(a.createdAt))
                .slice(0, 8),
            }}
            employeeAudits={employeeAudits}
          />
        </div>
      </div>
    </AppShell>
  );
}
