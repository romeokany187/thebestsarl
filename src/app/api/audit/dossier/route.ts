import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";

const actionSchema = z.object({
  entityType: z.enum(["TICKET_SALE", "PAYMENT", "WORKER_REPORT", "NEED_REQUEST", "ATTENDANCE"]).optional(),
  entityId: z.string().min(1).optional(),
  action: z.enum([
    "AUDIT_IMPORT",
    "AUDIT_AUTO_CONTROL",
    "AUDIT_EXPORT",
    "AUDIT_SIGNAL",
    "AUDIT_COMMENT",
    "AUDIT_CONFORMITY_SAVE",
    "AUDIT_VALIDATE",
    "AUDIT_REJECT",
  ]),
  payload: z.record(z.string(), z.unknown()).optional(),
});

function toAuditEntityType(entityType: string) {
  return `AUDIT_${entityType}`;
}

function extractStateFromTrail(
  trail: Array<{ action: string; createdAt: Date; actor: { name: string }; payload: unknown }>,
) {
  let compliance = {
    documentsOk: false,
    amountsOk: false,
    processOk: false,
    riskChecked: false,
  };
  let decision: "PENDING" | "VALIDATED" | "REJECTED" = "PENDING";
  const comments: Array<{ text: string; createdAt: string; author: string }> = [];

  for (const item of trail) {
    if (item.action === "AUDIT_CONFORMITY_SAVE" && typeof item.payload === "object" && item.payload) {
      const maybeCompliance = (item.payload as { compliance?: typeof compliance }).compliance;
      if (maybeCompliance) {
        compliance = {
          documentsOk: Boolean(maybeCompliance.documentsOk),
          amountsOk: Boolean(maybeCompliance.amountsOk),
          processOk: Boolean(maybeCompliance.processOk),
          riskChecked: Boolean(maybeCompliance.riskChecked),
        };
      }
    }

    if (item.action === "AUDIT_VALIDATE") {
      decision = "VALIDATED";
    }

    if (item.action === "AUDIT_REJECT") {
      decision = "REJECTED";
    }

    if (item.action === "AUDIT_COMMENT" && typeof item.payload === "object" && item.payload) {
      const text = (item.payload as { text?: string }).text;
      if (text && text.trim()) {
        comments.push({
          text,
          createdAt: item.createdAt.toISOString(),
          author: item.actor.name,
        });
      }
    }
  }

  return {
    compliance,
    decision,
    comments,
  };
}

async function buildDossierDetail(entityType: string, entityId: string) {
  if (entityType === "PAYMENT") {
    const payment = await prisma.payment.findUnique({
      where: { id: entityId },
      include: {
        ticket: {
          select: {
            ticketNumber: true,
            customerName: true,
            amount: true,
            currency: true,
            payments: { select: { amount: true } },
          },
        },
      },
    });

    if (!payment) return null;

    const totalPaid = payment.ticket.payments.reduce((sum, row) => sum + row.amount, 0);
    const remaining = Math.max(0, payment.ticket.amount - totalPaid);

    return {
      header: {
        title: `Caisse • ${payment.ticket.ticketNumber}`,
        subtitle: `${payment.ticket.customerName} • Méthode: ${payment.method}`,
        status: payment.reference ?? "Réf non renseignée",
      },
      financial: [
        { label: "Mouvement encaissé", value: `${payment.amount.toFixed(2)} ${payment.ticket.currency}` },
        { label: "Billet facturé", value: `${payment.ticket.amount.toFixed(2)} ${payment.ticket.currency}` },
        { label: "Total encaissé billet", value: `${totalPaid.toFixed(2)} ${payment.ticket.currency}` },
        { label: "Reste billet", value: `${remaining.toFixed(2)} ${payment.ticket.currency}` },
      ],
      conformity: [
        { label: "Référence paiement", value: payment.reference ?? "-" },
        { label: "Date paiement", value: new Date(payment.paidAt).toLocaleString() },
        { label: "Traçabilité", value: payment.reference ? "Référence fournie" : "Référence manquante" },
      ],
    };
  }

  if (entityType === "TICKET_SALE") {
    const ticket = await prisma.ticketSale.findUnique({
      where: { id: entityId },
      include: {
        airline: { select: { name: true, code: true } },
        seller: { select: { name: true } },
        payments: { select: { amount: true, method: true, paidAt: true } },
      },
    });

    if (!ticket) return null;

    const paidAmount = ticket.payments.reduce((sum, payment) => sum + payment.amount, 0);
    const remaining = Math.max(0, ticket.amount - paidAmount);

    return {
      header: {
        title: `${ticket.ticketNumber} • ${ticket.customerName}`,
        subtitle: `${ticket.airline.code} - ${ticket.airline.name} • Agent: ${ticket.seller.name}`,
        status: ticket.paymentStatus,
      },
      financial: [
        { label: "Facturé", value: `${ticket.amount.toFixed(2)} ${ticket.currency}` },
        { label: "Encaissé", value: `${paidAmount.toFixed(2)} ${ticket.currency}` },
        { label: "Reste", value: `${remaining.toFixed(2)} ${ticket.currency}` },
        { label: "Marge agence", value: `${ticket.agencyMarkupAmount.toFixed(2)} ${ticket.currency}` },
        { label: "Commission", value: `${ticket.commissionAmount.toFixed(2)} ${ticket.currency}` },
      ],
      conformity: [
        { label: "Nature vente", value: ticket.saleNature },
        { label: "Statut paiement", value: ticket.paymentStatus },
        { label: "Voyage", value: new Date(ticket.travelDate).toLocaleDateString() },
      ],
    };
  }

  if (entityType === "WORKER_REPORT") {
    const report = await prisma.workerReport.findUnique({
      where: { id: entityId },
      include: {
        author: { select: { name: true } },
      },
    });

    if (!report) return null;

    return {
      header: {
        title: report.title,
        subtitle: `Auteur: ${report.author.name}`,
        status: report.status,
      },
      financial: [
        { label: "Période", value: `${new Date(report.periodStart).toLocaleDateString()} -> ${new Date(report.periodEnd).toLocaleDateString()}` },
        { label: "Type", value: report.period },
        { label: "Montant", value: "N/A" },
      ],
      conformity: [
        { label: "Statut", value: report.status },
        { label: "Soumis", value: report.submittedAt ? new Date(report.submittedAt).toLocaleString() : "Non" },
        { label: "Validé", value: report.approvedAt ? new Date(report.approvedAt).toLocaleString() : "Non" },
      ],
    };
  }

  if (entityType === "NEED_REQUEST") {
    const need = await prisma.needRequest.findUnique({
      where: { id: entityId },
      include: {
        requester: { select: { name: true } },
      },
    });

    if (!need) return null;

    return {
      header: {
        title: need.title,
        subtitle: `Demandeur: ${need.requester.name}`,
        status: need.status,
      },
      financial: [
        { label: "Montant estimé", value: `${(need.estimatedAmount ?? 0).toFixed(2)} ${need.currency ?? "XAF"}` },
        { label: "Quantité", value: `${need.quantity} ${need.unit}` },
      ],
      conformity: [
        { label: "Catégorie", value: need.category },
        { label: "Statut", value: need.status },
        { label: "Soumis le", value: need.submittedAt ? new Date(need.submittedAt).toLocaleString() : "N/A" },
      ],
    };
  }

  const attendance = await prisma.attendance.findUnique({
    where: { id: entityId },
    include: {
      user: { select: { name: true } },
    },
  });

  if (!attendance) return null;

  return {
    header: {
      title: `Présence • ${attendance.user.name}`,
      subtitle: `${new Date(attendance.date).toLocaleDateString()}`,
      status: attendance.status,
    },
    financial: [
      { label: "Retard", value: `${attendance.latenessMins} min` },
      { label: "Heures supp.", value: `${attendance.overtimeMins} min` },
      { label: "Montant", value: "N/A" },
    ],
    conformity: [
      { label: "Entrée", value: attendance.clockIn ? new Date(attendance.clockIn).toLocaleTimeString() : "Non signée" },
      { label: "Sortie", value: attendance.clockOut ? new Date(attendance.clockOut).toLocaleTimeString() : "Non signée" },
      { label: "Localisation", value: attendance.locationStatus },
    ],
  };
}

export async function GET(request: NextRequest) {
  const access = await requireApiModuleAccess("audit", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) {
    return access.error;
  }

  const entityType = request.nextUrl.searchParams.get("entityType");
  const entityId = request.nextUrl.searchParams.get("entityId");

  if (!entityType || !entityId) {
    return NextResponse.json({ error: "entityType et entityId sont requis." }, { status: 400 });
  }

  if (!["TICKET_SALE", "PAYMENT", "WORKER_REPORT", "NEED_REQUEST", "ATTENDANCE"].includes(entityType)) {
    return NextResponse.json({ error: "Type de dossier invalide." }, { status: 400 });
  }

  const [detail, trail] = await Promise.all([
    buildDossierDetail(entityType, entityId),
    prisma.auditLog.findMany({
      where: {
        entityType: toAuditEntityType(entityType),
        entityId,
      },
      include: {
        actor: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
      take: 300,
    }),
  ]);

  if (!detail) {
    return NextResponse.json({ error: "Dossier introuvable." }, { status: 404 });
  }

  const state = extractStateFromTrail(trail);

  return NextResponse.json({
    data: {
      detail,
      trail,
      state,
    },
  });
}

export async function POST(request: NextRequest) {
  const access = await requireApiModuleAccess("audit", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) {
    return access.error;
  }

  if ((access.session.user.jobTitle ?? "").toUpperCase() !== "AUDITEUR") {
    return NextResponse.json({ error: "Mode lecture: écriture réservée à l'auditeur." }, { status: 403 });
  }

  const body = await request.json();
  const parsed = actionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const requiresDossier = [
    "AUDIT_COMMENT",
    "AUDIT_CONFORMITY_SAVE",
    "AUDIT_VALIDATE",
    "AUDIT_REJECT",
  ].includes(parsed.data.action);

  if (requiresDossier && (!parsed.data.entityType || !parsed.data.entityId)) {
    return NextResponse.json({ error: "Ce type d'action nécessite un dossier sélectionné." }, { status: 400 });
  }

  const auditEntityType = parsed.data.entityType ? toAuditEntityType(parsed.data.entityType) : "AUDIT_WORKSPACE";
  const auditEntityId = parsed.data.entityId ?? "GLOBAL";
  const safePayload = (parsed.data.payload ?? {}) as Prisma.InputJsonValue;

  const created = await prisma.auditLog.create({
    data: {
      actorId: access.session.user.id,
      action: parsed.data.action,
      entityType: auditEntityType,
      entityId: auditEntityId,
      payload: safePayload,
    },
  });

  if (parsed.data.action === "AUDIT_SIGNAL") {
    const recipients = await prisma.user.findMany({
      where: { role: { in: ["ADMIN", "MANAGER", "ACCOUNTANT"] } },
      select: { id: true },
      take: 120,
    });

    if (recipients.length > 0) {
      await prisma.userNotification.createMany({
        data: recipients.map((user) => ({
          userId: user.id,
          title: "Signalement audit",
          message: parsed.data.entityType && parsed.data.entityId
            ? `Signalement sur ${parsed.data.entityType} (${parsed.data.entityId}).`
            : "Signalement audit global généré depuis l'espace auditeur.",
          type: "AUDIT",
          metadata: {
            entityType: parsed.data.entityType ?? "WORKSPACE",
            entityId: parsed.data.entityId ?? "GLOBAL",
            payload: JSON.stringify(parsed.data.payload ?? {}),
          } as Prisma.InputJsonValue,
        })),
      });
    }
  }

  return NextResponse.json({ data: created }, { status: 201 });
}
