import { PaymentStatus, ReportPeriod, ReportStatus } from "@prisma/client";
import { z } from "zod";

export const reportSchema = z.object({
  title: z.string().min(3),
  content: z.string().min(10),
  period: z.nativeEnum(ReportPeriod),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  status: z.nativeEnum(ReportStatus).optional(),
  authorId: z.string().min(1),
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

export const ticketSchema = z.object({
  ticketNumber: z.string().min(3),
  customerName: z.string().min(2),
  route: z.string().min(3),
  travelDate: z.coerce.date(),
  amount: z.number().positive(),
  currency: z.string().min(3).max(3),
  airlineId: z.string().min(1),
  sellerId: z.string().min(1),
  paymentStatus: z.nativeEnum(PaymentStatus),
  commissionRateUsed: z.number().min(0).max(100),
  notes: z.string().max(500).optional(),
});

export const approvalSchema = z.object({
  reportId: z.string().min(1),
  reviewerId: z.string().min(1),
  reviewerComment: z.string().max(500).optional(),
  status: z.enum(["APPROVED", "REJECTED"]),
});
