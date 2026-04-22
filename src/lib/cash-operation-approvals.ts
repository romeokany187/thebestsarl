import { isMailConfigured, sendMailBatch } from "@/lib/mail";
import { prisma } from "@/lib/prisma";

export const cashOperationApprovalRequestClient = (prisma as unknown as {
  cashOperationApprovalRequest: any;
}).cashOperationApprovalRequest;

export function canReviewCashOperationApprovals(role: string, jobTitle: string | null | undefined) {
  return role === "ADMIN" || role === "ACCOUNTANT" || jobTitle === "COMPTABLE";
}

export async function ensureCashOperationApprovalRequestTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \`CashOperationApprovalRequest\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`status\` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
      \`requestedById\` VARCHAR(191) NOT NULL,
      \`reviewedById\` VARCHAR(191) NULL,
      \`occurredAt\` DATETIME(3) NOT NULL,
      \`direction\` VARCHAR(191) NOT NULL,
      \`category\` VARCHAR(191) NOT NULL,
      \`amount\` DOUBLE NOT NULL,
      \`currency\` VARCHAR(191) NOT NULL DEFAULT 'USD',
      \`fxRateUsdToCdf\` DOUBLE NOT NULL,
      \`amountUsd\` DOUBLE NOT NULL,
      \`amountCdf\` DOUBLE NOT NULL,
      \`method\` VARCHAR(191) NOT NULL,
      \`reference\` VARCHAR(191) NULL,
      \`description\` TEXT NOT NULL,
      \`cashDesk\` VARCHAR(191) NOT NULL,
      \`projectedDailyOutflowUsd\` DOUBLE NOT NULL,
      \`dailyOutflowCapUsd\` DOUBLE NOT NULL,
      \`reason\` TEXT NULL,
      \`approvedAt\` DATETIME(3) NULL,
      \`rejectedAt\` DATETIME(3) NULL,
      \`executedAt\` DATETIME(3) NULL,
      \`executedCashOperationId\` VARCHAR(191) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`CashOperationApprovalRequest_executedCashOperationId_key\` (\`executedCashOperationId\`),
      KEY \`CashOperationApprovalRequest_status_createdAt_idx\` (\`status\`, \`createdAt\`),
      KEY \`CashOperationApprovalRequest_requestedById_idx\` (\`requestedById\`),
      KEY \`CashOperationApprovalRequest_reviewedById_idx\` (\`reviewedById\`),
      KEY \`CashOperationApprovalRequest_cashDesk_createdAt_idx\` (\`cashDesk\`, \`createdAt\`)
    ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
}

function buildBlockedCashOutflowAlertMessage(params: {
  cashDesk: string;
  amount: number;
  currency: string;
  amountUsd: number;
  occurredAt: Date;
  projectedDailyOutflowUsd: number;
  dailyOutflowCap: number;
  actorName: string;
  approvalRequestId: string;
}) {
  return `Décaissement bloqué sur ${params.cashDesk}: tentative de ${params.amount.toFixed(2)} ${params.currency} (${params.amountUsd.toFixed(2)} USD) le ${params.occurredAt.toLocaleString("fr-FR")}. Cumul journalier projeté ${params.projectedDailyOutflowUsd.toFixed(2)} USD pour un plafond de ${params.dailyOutflowCap.toFixed(2)} USD. Demande ${params.approvalRequestId} en attente de décision comptable. Saisi par ${params.actorName}.`;
}

export async function createBlockedCashOutflowApprovalRequest(params: {
  actorId: string;
  actorName: string;
  actorEmail?: string | null;
  occurredAt: Date;
  direction: "OUTFLOW";
  category: string;
  amount: number;
  currency: string;
  fxRateUsdToCdf: number;
  amountUsd: number;
  amountCdf: number;
  method: string;
  reference: string;
  description?: string | null;
  projectedDailyOutflowUsd: number;
  dailyOutflowCap: number;
  cashDesk: string;
}) {
  await ensureCashOperationApprovalRequestTable();

  const approvalRequest = await cashOperationApprovalRequestClient.create({
    data: {
      requestedById: params.actorId,
      occurredAt: params.occurredAt,
      direction: params.direction,
      category: params.category,
      amount: params.amount,
      currency: params.currency,
      fxRateUsdToCdf: params.fxRateUsdToCdf,
      amountUsd: params.amountUsd,
      amountCdf: params.amountCdf,
      method: params.method,
      reference: params.reference,
      description: params.description ?? "",
      cashDesk: params.cashDesk,
      projectedDailyOutflowUsd: params.projectedDailyOutflowUsd,
      dailyOutflowCapUsd: params.dailyOutflowCap,
    },
    select: {
      id: true,
      createdAt: true,
    },
  });

  const reviewers = await prisma.user.findMany({
    where: {
      id: { not: params.actorId },
      OR: [{ role: "ACCOUNTANT" }, { jobTitle: "COMPTABLE" }, { role: "ADMIN" }],
    },
    select: { id: true, name: true, email: true },
    take: 200,
  });

  if (reviewers.length === 0) {
    return approvalRequest;
  }

  const alertMessage = buildBlockedCashOutflowAlertMessage({
    cashDesk: params.cashDesk,
    amount: params.amount,
    currency: params.currency,
    amountUsd: params.amountUsd,
    occurredAt: params.occurredAt,
    projectedDailyOutflowUsd: params.projectedDailyOutflowUsd,
    dailyOutflowCap: params.dailyOutflowCap,
    actorName: params.actorName,
    approvalRequestId: approvalRequest.id,
  });

  await prisma.userNotification.createMany({
    data: reviewers.map((user) => ({
      userId: user.id,
      title: "Approbation requise pour décaissement bloqué",
      message: alertMessage,
      type: "CASH_OPERATION_APPROVAL_REQUIRED",
      metadata: {
        approvalRequestId: approvalRequest.id,
        blocked: true,
        amount: params.amount,
        currency: params.currency,
        amountUsd: params.amountUsd,
        fxRateUsdToCdf: params.fxRateUsdToCdf,
        category: params.category,
        method: params.method,
        reference: params.reference,
        description: params.description,
        occurredAt: params.occurredAt,
        projectedDailyOutflowUsd: params.projectedDailyOutflowUsd,
        dailyCap: params.dailyOutflowCap,
        actorId: params.actorId,
        actorName: params.actorName,
        cashDesk: params.cashDesk,
        source: "CASH_LEDGER_POLICY",
      },
    })),
  });

  if (isMailConfigured()) {
    try {
      const appUrl = process.env.NEXTAUTH_URL?.trim() || "";
      const paymentsUrl = appUrl ? `${appUrl}/payments?desk=${encodeURIComponent(params.cashDesk)}&mode=cash` : "/payments";

      await sendMailBatch({
        recipients: reviewers.map((user) => ({ email: user.email, name: user.name })),
        subject: `Approbation requise - Décaissement bloqué ${params.cashDesk}`,
        text: [
          "THEBEST SARL - Décaissement bloqué en attente d'approbation",
          "",
          `Demande: ${approvalRequest.id}`,
          `Caisse: ${params.cashDesk}`,
          `Date opération: ${params.occurredAt.toLocaleString("fr-FR")}`,
          `Montant demandé: ${params.amount.toFixed(2)} ${params.currency}`,
          `Équivalent USD: ${params.amountUsd.toFixed(2)} USD`,
          `Taux du jour: 1 USD = ${params.fxRateUsdToCdf.toFixed(2)} CDF`,
          `Catégorie: ${params.category}`,
          `Méthode: ${params.method}`,
          `Référence: ${params.reference}`,
          `Libellé: ${params.description ?? "-"}`,
          `Cumul journalier projeté: ${params.projectedDailyOutflowUsd.toFixed(2)} USD`,
          `Plafond autorisé: ${params.dailyOutflowCap.toFixed(2)} USD`,
          `Saisi par: ${params.actorName}`,
          "",
          `Décider dans le module paiements: ${paymentsUrl}`,
        ].join("\n"),
        html: `
          <p><strong>THEBEST SARL - Décaissement bloqué en attente d'approbation</strong></p>
          <p><strong>Demande:</strong> ${approvalRequest.id}<br/>
          <strong>Caisse:</strong> ${params.cashDesk}<br/>
          <strong>Date opération:</strong> ${params.occurredAt.toLocaleString("fr-FR")}<br/>
          <strong>Montant demandé:</strong> ${params.amount.toFixed(2)} ${params.currency}<br/>
          <strong>Équivalent USD:</strong> ${params.amountUsd.toFixed(2)} USD<br/>
          <strong>Taux du jour:</strong> 1 USD = ${params.fxRateUsdToCdf.toFixed(2)} CDF<br/>
          <strong>Catégorie:</strong> ${params.category}<br/>
          <strong>Méthode:</strong> ${params.method}<br/>
          <strong>Référence:</strong> ${params.reference}<br/>
          <strong>Libellé:</strong> ${params.description ?? "-"}<br/>
          <strong>Cumul journalier projeté:</strong> ${params.projectedDailyOutflowUsd.toFixed(2)} USD<br/>
          <strong>Plafond autorisé:</strong> ${params.dailyOutflowCap.toFixed(2)} USD<br/>
          <strong>Saisi par:</strong> ${params.actorName}</p>
          <p><a href="${paymentsUrl}">Ouvrir la file d'approbation</a></p>
        `,
        replyTo: params.actorEmail ?? undefined,
      });
    } catch (mailError) {
      console.error("[cash-approvals.create] Echec envoi email comptable", {
        approvalRequestId: approvalRequest.id,
        error: mailError instanceof Error ? mailError.message : "Erreur inconnue",
      });
    }
  }

  return approvalRequest;
}