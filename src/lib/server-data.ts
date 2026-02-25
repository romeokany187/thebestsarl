import { PaymentStatus, ReportStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { calculateTicketMetrics } from "@/lib/kpi";

export async function getDashboardData() {
  const [reports, attendance, tickets] = await Promise.all([
    prisma.workerReport.findMany({
      include: {
        author: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    prisma.attendance.findMany({
      include: {
        user: { select: { name: true } },
      },
      orderBy: { date: "desc" },
      take: 8,
    }),
    prisma.ticketSale.findMany({
      include: {
        airline: true,
        seller: { select: { name: true } },
      },
      orderBy: { soldAt: "desc" },
      take: 12,
    }),
  ]);

  const sales = calculateTicketMetrics(tickets);

  return {
    reports,
    attendance,
    tickets,
    totals: {
      reports: {
        total: reports.length,
        submitted: reports.filter((report) => report.status === ReportStatus.SUBMITTED).length,
        approved: reports.filter((report) => report.status === ReportStatus.APPROVED).length,
      },
      attendance: {
        late: attendance.filter((row) => row.latenessMins > 0).length,
        overtime: attendance.reduce((acc, row) => acc + row.overtimeMins, 0),
      },
      payments: {
        paid: tickets.filter((ticket) => ticket.paymentStatus === PaymentStatus.PAID).length,
        unpaid: tickets.filter((ticket) => ticket.paymentStatus === PaymentStatus.UNPAID).length,
        partial: tickets.filter((ticket) => ticket.paymentStatus === PaymentStatus.PARTIAL).length,
      },
      sales,
    },
  };
}

export async function getReferenceData() {
  const [users, airlines] = await Promise.all([
    prisma.user.findMany({
      select: { id: true, name: true, role: true, email: true },
      orderBy: { name: "asc" },
    }),
    prisma.airline.findMany({
      include: { commissionRules: { where: { isActive: true } } },
      orderBy: { name: "asc" },
    }),
  ]);

  return { users, airlines };
}
