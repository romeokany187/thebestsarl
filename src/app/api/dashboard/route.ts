import { NextResponse } from "next/server";
import { PaymentStatus, ReportStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { calculateTicketMetrics } from "@/lib/kpi";
import { requireApiRoles } from "@/lib/rbac";

export async function GET() {
  const access = await requireApiRoles(["ADMIN", "MANAGER", "ACCOUNTANT"]);
  if (access.error) {
    return access.error;
  }

  const [reports, attendance, tickets] = await Promise.all([
    prisma.workerReport.findMany(),
    prisma.attendance.findMany(),
    prisma.ticketSale.findMany(),
  ]);

  const reportTotals = {
    total: reports.length,
    submitted: reports.filter((report) => report.status === ReportStatus.SUBMITTED).length,
    approved: reports.filter((report) => report.status === ReportStatus.APPROVED).length,
    rejected: reports.filter((report) => report.status === ReportStatus.REJECTED).length,
  };

  const attendanceTotals = {
    totalRecords: attendance.length,
    lateCount: attendance.filter((row) => row.latenessMins > 0).length,
    overtimeMins: attendance.reduce((acc, row) => acc + row.overtimeMins, 0),
  };

  const paymentTotals = {
    paid: tickets.filter((ticket) => ticket.paymentStatus === PaymentStatus.PAID).length,
    unpaid: tickets.filter((ticket) => ticket.paymentStatus === PaymentStatus.UNPAID).length,
    partial: tickets.filter((ticket) => ticket.paymentStatus === PaymentStatus.PARTIAL).length,
  };

  const salesMetrics = calculateTicketMetrics(tickets);

  return NextResponse.json({
    reports: reportTotals,
    attendance: attendanceTotals,
    payments: paymentTotals,
    sales: salesMetrics,
  });
}
