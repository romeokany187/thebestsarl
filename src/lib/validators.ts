import { PaymentStatus, ReportPeriod, ReportStatus, SaleNature, SiteType, TravelClass } from "@prisma/client";
import { z } from "zod";

const moneyCurrencySchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toUpperCase() : value),
  z.enum(["USD", "CDF", "XAF"]).transform((value) => (value === "XAF" ? "CDF" : value)),
);

export const reportSchema = z.object({
  title: z.string().min(3),
  content: z.string().min(10),
  period: z.nativeEnum(ReportPeriod),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  status: z.nativeEnum(ReportStatus).optional(),
  authorId: z.string().min(1),
}).superRefine((value, ctx) => {
  const start = new Date(value.periodStart);
  const end = new Date(value.periodEnd);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (end < start) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["periodEnd"],
      message: "La date de fin doit être après la date de début.",
    });
    return;
  }

  const days = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;

  if (end > today) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["periodEnd"],
      message: "La date de fin ne peut pas etre dans le futur.",
    });
  }

  if (value.period === "DAILY" && days !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["periodEnd"],
      message: "Un rapport journalier doit couvrir exactement 1 jour.",
    });
  }

  if (value.period === "DAILY") {
    const daysSinceStart = Math.floor((today.getTime() - start.getTime()) / 86400000);
    if (daysSinceStart > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["periodStart"],
        message: "Un rapport journalier doit etre saisi le jour meme ou au plus tard le lendemain.",
      });
    }
  }

  if (value.period === "WEEKLY") {
    if (days !== 7) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["periodEnd"],
        message: "Un rapport hebdomadaire doit couvrir exactement 7 jours.",
      });
    }

    if (start.getDay() !== 1 || end.getDay() !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["periodStart"],
        message: "Un rapport hebdomadaire doit aller du lundi au dimanche.",
      });
    }
  }

  if (value.period === "MONTHLY") {
    const sameMonth = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth();
    const lastDayOfMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();

    if (!sameMonth || start.getDate() !== 1 || end.getDate() !== lastDayOfMonth) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["periodStart"],
        message: "Un rapport mensuel doit aller du 1er jour jusqu'au dernier jour du mois.",
      });
    }
  }

  if (String(value.period) === "SEMESTER") {
    const sameYear = start.getFullYear() === end.getFullYear();
    const firstSemester = start.getMonth() === 0
      && start.getDate() === 1
      && end.getMonth() === 5
      && end.getDate() === 30;
    const secondSemester = start.getMonth() === 6
      && start.getDate() === 1
      && end.getMonth() === 11
      && end.getDate() === 31;

    if (!sameYear || (!firstSemester && !secondSemester)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["periodStart"],
        message: "Un rapport semestriel doit couvrir soit du 1er janvier au 30 juin, soit du 1er juillet au 31 decembre.",
      });
    }
  }

  if (value.period === "ANNUAL") {
    const sameYear = start.getFullYear() === end.getFullYear();
    const isYearWindow = start.getMonth() === 0
      && start.getDate() === 1
      && end.getMonth() === 11
      && end.getDate() === 31;

    if (!sameYear || !isYearWindow) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["periodStart"],
        message: "Un rapport annuel doit couvrir du 1er janvier au 31 decembre de la meme annee.",
      });
    }
  }
});

export const attendanceSchema = z.object({
  userId: z.string().min(1),
  date: z.coerce.date(),
  clockIn: z.coerce.date().optional(),
  clockOut: z.coerce.date().optional(),
  latenessMins: z.number().int().min(0).optional(),
  overtimeMins: z.number().int().min(0).optional(),
  notes: z.string().max(500).optional(),
});

export const attendanceSignSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyM: z.number().positive().max(5000).optional(),
  action: z.enum(["CLOCK_IN", "CLOCK_OUT"]).default("CLOCK_IN"),
});

export const workSiteCreateSchema = z.object({
  name: z.string().min(2).max(120),
  type: z.nativeEnum(SiteType),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMeters: z.number().int().min(20).max(5000),
  isActive: z.boolean().optional(),
});

export const workSiteUpdateSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  type: z.nativeEnum(SiteType).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  radiusMeters: z.number().int().min(20).max(5000).optional(),
  isActive: z.boolean().optional(),
});

export const ticketSchema = z.object({
  ticketNumber: z.string().min(3),
  customerName: z.string().min(2),
  route: z.string().min(3),
  travelClass: z.nativeEnum(TravelClass),
  travelDate: z.coerce.date(),
  amount: z.number().positive(),
  baseFareAmount: z.number().positive().optional(),
  currency: z.string().min(3).max(3),
  airlineId: z.string().min(1),
  sellerId: z.string().min(1),
  saleNature: z.nativeEnum(SaleNature),
  paymentStatus: z.nativeEnum(PaymentStatus),
  payerName: z.string().min(3).max(120),
  agencyMarkupPercent: z.number().min(0).max(100).optional(),
  agencyMarkupAmount: z.number().min(0).optional(),
  notes: z.string().max(500).optional(),
});

export const ticketUpdateSchema = z.object({
  ticketNumber: z.string().min(3).optional(),
  airlineId: z.string().min(1).optional(),
  sellerId: z.string().min(1).optional(),
  customerName: z.string().min(2).optional(),
  route: z.string().min(3).optional(),
  travelClass: z.nativeEnum(TravelClass).optional(),
  travelDate: z.coerce.date().optional(),
  amount: z.number().positive().optional(),
  baseFareAmount: z.number().positive().optional(),
  currency: z.string().min(3).max(3).optional(),
  saleNature: z.nativeEnum(SaleNature).optional(),
  paymentStatus: z.nativeEnum(PaymentStatus).optional(),
  payerName: z.string().max(120).optional(),
  agencyMarkupPercent: z.number().min(0).max(100).optional(),
  agencyMarkupAmount: z.number().min(0).optional(),
  notes: z.string().max(500).optional(),
});

export const paymentCreateSchema = z.object({
  ticketId: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().min(3).max(3).optional(),
  method: z.string().min(2).max(80),
  reference: z.string().trim().min(3).max(120),
  paidAt: z.coerce.date().optional(),
});

export const approvalSchema = z.object({
  reportId: z.string().min(1),
  reviewerId: z.string().min(1),
  reviewerComment: z.string().max(500).optional(),
  status: z.enum(["APPROVED", "REJECTED"]),
});

export const needRequestSchema = z.object({
  title: z.string().min(3).max(180),
  category: z.string().min(2).max(80).optional(),
  urgencyLevel: z.enum(["CRITIQUE", "ELEVEE", "NORMALE", "FAIBLE"]),
  beneficiaryTeam: z.enum(["KINSHASA", "LUBUMBASHI", "MBUJIMAYI"]),
  beneficiaryPersonId: z.string().optional(),
  beneficiaryPersonName: z.string().max(120).optional(),
  details: z.string().min(10).max(4000).optional(),
  quantity: z.number().positive().optional(),
  unit: z.string().min(1).max(20).optional(),
  estimatedAmount: z.number().nonnegative().optional(),
  currency: moneyCurrencySchema.optional(),
  items: z.array(
    z.object({
      designation: z.string().min(2).max(180),
      description: z.string().max(500).optional(),
      quantity: z.number().positive(),
      unitPrice: z.number().nonnegative(),
    }),
  ).min(1).optional(),
});

export const needRequestUpdateSchema = needRequestSchema.extend({
  needRequestId: z.string().min(1),
});

export const needApprovalSchema = z.object({
  needRequestId: z.string().min(1),
  status: z.enum(["APPROVED", "REJECTED"]),
  reviewComment: z.string().max(500).optional(),
});

export const needExecutionSchema = z.object({
  needRequestId: z.string().min(1),
  referenceDoc: z.string().min(2).max(180),
  executionComment: z.string().max(500).optional(),
});

export const stockMovementSchema = z.object({
  itemName: z.string().min(2).max(120),
  category: z.string().min(2).max(80),
  unit: z.string().min(1).max(20),
  movementType: z.enum(["IN", "OUT"]),
  quantity: z.number().positive(),
  justification: z.string().min(5).max(500),
  referenceDoc: z.string().min(2).max(180),
  needRequestId: z.string().optional(),
});

export const paymentOrderAssignmentSchema = z.enum(["A_MON_COMPTE", "VISAS", "SAFETY", "BILLETTERIE", "TSL"]);

export const paymentOrderCreationSchema = z.object({
  beneficiary: z.string().trim().min(2).max(180),
  purpose: z.string().trim().min(2).max(180),
  description: z.string().trim().min(5).max(1500),
  assignment: paymentOrderAssignmentSchema,
  amount: z.number().positive(),
  currency: moneyCurrencySchema.optional(),
});

export const paymentOrderApprovalSchema = z.object({
  paymentOrderId: z.string().min(1),
  status: z.enum(["APPROVED", "REJECTED"]),
  reviewComment: z.string().max(500).optional(),
});

export const paymentOrderExecutionSchema = z.object({
  paymentOrderId: z.string().min(1),
  referenceDoc: z.string().min(2).max(180),
  executionComment: z.string().max(500).optional(),
});

export const airlineDepositTopUpSchema = z.object({
  accountKey: z.string().trim().min(2).max(80),
  amount: z.number().positive(),
  reference: z.string().trim().min(2).max(180),
  description: z.string().trim().min(3).max(300),
});

export const cashOperationCreateSchema = z.object({
  occurredAt: z.coerce.date().optional(),
  direction: z.enum(["INFLOW", "OUTFLOW"]),
  category: z.enum([
    "OPENING_BALANCE",
    "OTHER_SALE",
    "COMMISSION_INCOME",
    "SERVICE_INCOME",
    "LOAN_INFLOW",
    "ADVANCE_RECOVERY",
    "SUPPLIER_PAYMENT",
    "SALARY_PAYMENT",
    "RENT_PAYMENT",
    "TAX_PAYMENT",
    "UTILITY_PAYMENT",
    "TRANSPORT_PAYMENT",
    "OTHER_EXPENSE",
    "FX_CONVERSION",
  ]),
  amount: z.number().positive(),
  currency: z.string().trim().length(3).optional(),
  fxRateToUsd: z.number().positive().optional(),
  fxRateUsdToCdf: z.number().positive().optional(),
  method: z.string().trim().min(2).max(60),
  reference: z.string().trim().min(2, "La référence de la pièce justificative est obligatoire.").max(180),
  description: z.string().trim().min(5).max(500),
});

export const cashConversionSchema = z.object({
  occurredAt: z.coerce.date().optional(),
  sourceCurrency: z.enum(["USD", "CDF"]),
  sourceAmount: z.number().positive(),
  fxRateUsdToCdf: z.number().positive(),
  reference: z.string().trim().min(2, "La référence de conversion est obligatoire.").max(180),
  description: z.string().trim().min(5).max(500).optional(),
});
