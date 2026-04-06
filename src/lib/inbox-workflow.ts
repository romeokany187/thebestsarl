import { prisma } from "@/lib/prisma";

export type WorkflowPaymentOrder = {
  id: string;
  code?: string | null;
  beneficiary: string;
  purpose: string;
  assignment: string;
  description: string;
  amount: number;
  currency?: string | null;
  status: string;
  createdAt: string;
  submittedAt?: string | null;
  approvedAt?: string | null;
  executedAt?: string | null;
  reviewComment?: string | null;
  issuedBy?: { name?: string | null; jobTitle?: string | null } | null;
  approvedBy?: { name?: string | null; jobTitle?: string | null } | null;
  executedBy?: { name?: string | null; jobTitle?: string | null } | null;
};

export type WorkflowNeed = {
  id: string;
  code?: string | null;
  title: string;
  category: string;
  estimatedAmount?: number | null;
  currency?: string | null;
  status: string;
  createdAt: string;
  submittedAt?: string | null;
  approvedAt?: string | null;
  sealedAt?: string | null;
  reviewComment?: string | null;
  requester?: { name?: string | null; jobTitle?: string | null } | null;
  reviewedBy?: { name?: string | null; jobTitle?: string | null } | null;
};

export function hasNeedExecutionMarker(value?: string | null) {
  return (value ?? "").includes("EXECUTION_CAISSE:");
}

type WorkflowActor = { name?: string | null; jobTitle?: string | null } | null;

type PaymentOrderRecord = {
  id: string;
  code?: string | null;
  beneficiary: string;
  purpose: string;
  assignment: string;
  description: string;
  amount: number;
  currency?: string | null;
  status: string;
  createdAt: Date;
  submittedAt?: Date | null;
  approvedAt?: Date | null;
  executedAt?: Date | null;
  reviewComment?: string | null;
  issuedBy?: WorkflowActor;
  approvedBy?: WorkflowActor;
  executedBy?: WorkflowActor;
};

type NeedRecord = {
  id: string;
  code?: string | null;
  title: string;
  category: string;
  estimatedAmount?: number | null;
  currency?: string | null;
  status: string;
  createdAt: Date;
  submittedAt?: Date | null;
  approvedAt?: Date | null;
  sealedAt?: Date | null;
  reviewComment?: string | null;
  requester?: WorkflowActor;
  reviewedBy?: WorkflowActor;
};

type PaymentOrderClient = {
  findMany(args: unknown): Promise<PaymentOrderRecord[]>;
};

function getPaymentOrderClient() {
  return (prisma as unknown as { paymentOrder: PaymentOrderClient }).paymentOrder;
}

function serializePaymentOrder(order: PaymentOrderRecord): WorkflowPaymentOrder {
  return {
    ...order,
    createdAt: order.createdAt.toISOString(),
    submittedAt: order.submittedAt?.toISOString() ?? null,
    approvedAt: order.approvedAt?.toISOString() ?? null,
    executedAt: order.executedAt?.toISOString() ?? null,
  };
}

function serializeNeed(need: NeedRecord): WorkflowNeed {
  return {
    ...need,
    createdAt: need.createdAt.toISOString(),
    submittedAt: need.submittedAt?.toISOString() ?? null,
    approvedAt: need.approvedAt?.toISOString() ?? null,
    sealedAt: need.sealedAt?.toISOString() ?? null,
  };
}

export function canAccessApprovalPage(role: string) {
  return role === "ADMIN" || role === "DIRECTEUR_GENERAL";
}

export function canAccessExecutionPage(jobTitle: string, role?: string) {
  return jobTitle === "CAISSIER" || jobTitle === "COMPTABLE" || role === "ADMIN" || role === "ACCOUNTANT";
}

export function canAccessHistoryPage(role: string, jobTitle: string) {
  return role === "ACCOUNTANT" || jobTitle === "COMPTABLE";
}

export async function getApprovalWorkflowData(role: string) {
  const canValidatePaymentOrders = role === "ADMIN";
  const canValidateNeeds = canAccessApprovalPage(role);
  const paymentOrderClient = getPaymentOrderClient();

  const [paymentOrders, needs] = await Promise.all([
    canValidatePaymentOrders
      ? paymentOrderClient.findMany({
          where: { status: "SUBMITTED" },
          include: {
            issuedBy: { select: { name: true, jobTitle: true } },
            approvedBy: { select: { name: true, jobTitle: true } },
            executedBy: { select: { name: true, jobTitle: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 120,
        })
      : Promise.resolve([]),
    canValidateNeeds
      ? prisma.needRequest.findMany({
          where: { status: "SUBMITTED" },
          include: {
            requester: { select: { name: true, jobTitle: true } },
            reviewedBy: { select: { name: true, jobTitle: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 120,
        })
      : Promise.resolve([]),
  ]);

  return {
    paymentOrders: paymentOrders.map((order) => serializePaymentOrder(order)),
    needs: needs.map((need) => serializeNeed(need)),
    canAccess: canValidatePaymentOrders || canValidateNeeds,
  };
}

export async function getExecutionWorkflowData(jobTitle: string, role?: string) {
  const canExecuteFromCash = canAccessExecutionPage(jobTitle, role);
  const paymentOrderClient = getPaymentOrderClient();

  const [paymentOrders, needs] = await Promise.all([
    canExecuteFromCash
      ? paymentOrderClient.findMany({
          where: { status: "APPROVED" },
          include: {
            issuedBy: { select: { name: true, jobTitle: true } },
            approvedBy: { select: { name: true, jobTitle: true } },
            executedBy: { select: { name: true, jobTitle: true } },
          },
          orderBy: { approvedAt: "desc" },
          take: 120,
        })
      : Promise.resolve([]),
    canExecuteFromCash
      ? prisma.needRequest.findMany({
          where: { status: "APPROVED" },
          include: {
            requester: { select: { name: true, jobTitle: true } },
            reviewedBy: { select: { name: true, jobTitle: true } },
          },
          orderBy: { approvedAt: "desc" },
          take: 120,
        })
      : Promise.resolve([]),
  ]);

  return {
    paymentOrders: paymentOrders.map((order) => serializePaymentOrder(order)),
    needs: needs.filter((need) => !hasNeedExecutionMarker(need.reviewComment)).map((need) => serializeNeed(need)),
    canAccess: canExecuteFromCash,
  };
}

export async function getHistoryWorkflowData(role: string, jobTitle: string) {
  const canViewHistory = canAccessHistoryPage(role, jobTitle);
  const paymentOrderClient = getPaymentOrderClient();

  const [paymentOrders, needs] = await Promise.all([
    canViewHistory
      ? paymentOrderClient.findMany({
          where: { status: { in: ["APPROVED", "EXECUTED", "REJECTED"] } },
          include: {
            issuedBy: { select: { name: true, jobTitle: true } },
            approvedBy: { select: { name: true, jobTitle: true } },
            executedBy: { select: { name: true, jobTitle: true } },
          },
          orderBy: [{ executedAt: "desc" }, { approvedAt: "desc" }, { createdAt: "desc" }],
          take: 120,
        })
      : Promise.resolve([]),
    canViewHistory
      ? prisma.needRequest.findMany({
          where: { status: { in: ["APPROVED", "REJECTED"] } },
          include: {
            requester: { select: { name: true, jobTitle: true } },
            reviewedBy: { select: { name: true, jobTitle: true } },
          },
          orderBy: [{ sealedAt: "desc" }, { approvedAt: "desc" }, { createdAt: "desc" }],
          take: 120,
        })
      : Promise.resolve([]),
  ]);

  return {
    paymentOrders: paymentOrders.map((order) => serializePaymentOrder(order)),
    needs: needs
      .filter((need) => need.status === "REJECTED" || need.approvedAt || hasNeedExecutionMarker(need.reviewComment))
      .map((need) => serializeNeed(need)),
    canAccess: canViewHistory,
  };
}