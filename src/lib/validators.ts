import { PaymentStatus, ReportPeriod, ReportStatus, SaleNature, SiteType, TravelClass } from "@prisma/client";
import { z } from "zod";

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

  if (end < start) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["periodEnd"],
      message: "La date de fin doit être après la date de début.",
    });
    return;
  }

  const days = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;

  if (value.period === "DAILY" && days !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["periodEnd"],
      message: "Un rapport journalier doit couvrir exactement 1 jour.",
    });
  }

  if (value.period === "WEEKLY" && (days < 5 || days > 7)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["periodEnd"],
      message: "Un rapport hebdomadaire doit couvrir entre 5 et 7 jours.",
    });
  }

  if (value.period === "MONTHLY" && (days < 28 || days > 31)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["periodEnd"],
      message: "Un rapport mensuel doit couvrir entre 28 et 31 jours.",
    });
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
  payerName: z.string().max(120).optional(),
  agencyMarkupAmount: z.number().min(0).optional(),
  notes: z.string().max(500).optional(),
});

export const ticketUpdateSchema = z.object({
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
  agencyMarkupAmount: z.number().min(0).optional(),
  notes: z.string().max(500).optional(),
});

export const approvalSchema = z.object({
  reportId: z.string().min(1),
  reviewerId: z.string().min(1),
  reviewerComment: z.string().max(500).optional(),
  status: z.enum(["APPROVED", "REJECTED"]),
});
