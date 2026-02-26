import { NextRequest, NextResponse } from "next/server";
import { AttendanceStatus, PaymentStatus, ReportStatus, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { calculateTicketMetrics } from "@/lib/kpi";
import { requireApiRoles } from "@/lib/rbac";

type PeriodFilter = "DAILY" | "WEEKLY" | "MONTHLY" | "ANNUAL";

function getPeriodStart(period: PeriodFilter) {
  const now = new Date();
  const start = new Date(now);

  if (period === "DAILY") {
    start.setHours(0, 0, 0, 0);
    return start;
  }

  if (period === "WEEKLY") {
    const day = start.getDay();
    const diff = day === 0 ? 6 : day - 1;
    start.setDate(start.getDate() - diff);
    start.setHours(0, 0, 0, 0);
    return start;
  }

  if (period === "MONTHLY") {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    return start;
  }

  start.setMonth(0, 1);
  start.setHours(0, 0, 0, 0);
  return start;
}

function parsePeriod(value: string | null): PeriodFilter {
  if (value === "DAILY" || value === "WEEKLY" || value === "MONTHLY" || value === "ANNUAL") {
    return value;
  }
  return "MONTHLY";
}

function parseRole(value: string | null): Role | null {
  if (value === "ADMIN" || value === "MANAGER" || value === "EMPLOYEE" || value === "ACCOUNTANT") {
    return value;
  }
  return null;
}

export async function GET(request: NextRequest) {
  const access = await requireApiRoles(["ADMIN", "MANAGER", "ACCOUNTANT"]);
  if (access.error) {
    return access.error;
  }

  const { searchParams } = new URL(request.url);
  const period = parsePeriod(searchParams.get("period"));
  const roleFilter = parseRole(searchParams.get("role"));
  const userId = searchParams.get("userId");
  const since = getPeriodStart(period);

  const usersWhere = {
    ...(roleFilter ? { role: roleFilter } : {}),
    ...(userId ? { id: userId } : {}),
  };

  const users = await prisma.user.findMany({
    where: usersWhere,
    select: { id: true, name: true, role: true, email: true },
    orderBy: { name: "asc" },
  });

  const filteredUserIds = users.map((user) => user.id);
  const shouldScopeToSelectedUsers = Boolean(roleFilter || userId);
  const selectedUsersFilter = { in: filteredUserIds };

  const [reports, attendance, tickets] = await Promise.all([
    prisma.workerReport.findMany({
      where: {
        createdAt: { gte: since },
        ...(shouldScopeToSelectedUsers ? { authorId: selectedUsersFilter } : {}),
      },
      include: {
        author: {
          select: { id: true, name: true, role: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
    prisma.attendance.findMany({
      where: {
        date: { gte: since },
        ...(shouldScopeToSelectedUsers ? { userId: selectedUsersFilter } : {}),
      },
      include: {
        user: {
          select: { id: true, name: true, role: true },
        },
      },
      orderBy: { date: "desc" },
      take: 1000,
    }),
    prisma.ticketSale.findMany({
      where: {
        soldAt: { gte: since },
        ...(shouldScopeToSelectedUsers ? { sellerId: selectedUsersFilter } : {}),
      },
      include: {
        seller: {
          select: { id: true, name: true, role: true },
        },
        airline: {
          select: { code: true, name: true },
        },
      },
      orderBy: { soldAt: "desc" },
      take: 1000,
    }),
  ]);

  const reportTotals = {
    total: reports.length,
    draft: reports.filter((report) => report.status === ReportStatus.DRAFT).length,
    submitted: reports.filter((report) => report.status === ReportStatus.SUBMITTED).length,
    approved: reports.filter((report) => report.status === ReportStatus.APPROVED).length,
    rejected: reports.filter((report) => report.status === ReportStatus.REJECTED).length,
  };

  const attendanceTotals = {
    totalRecords: attendance.length,
    present: attendance.filter((row) => row.status === AttendanceStatus.PRESENT).length,
    absent: attendance.filter((row) => row.status === AttendanceStatus.ABSENT).length,
    off: attendance.filter((row) => row.status === AttendanceStatus.OFF).length,
    lateCount: attendance.filter((row) => row.latenessMins > 0).length,
    overtimeMins: attendance.reduce((acc, row) => acc + row.overtimeMins, 0),
  };

  const paymentTotals = {
    paid: tickets.filter((ticket) => ticket.paymentStatus === PaymentStatus.PAID).length,
    unpaid: tickets.filter((ticket) => ticket.paymentStatus === PaymentStatus.UNPAID).length,
    partial: tickets.filter((ticket) => ticket.paymentStatus === PaymentStatus.PARTIAL).length,
  };

  const salesMetrics = calculateTicketMetrics(tickets);

  const userBreakdown = {
    total: users.length,
    admin: users.filter((user) => user.role === Role.ADMIN).length,
    manager: users.filter((user) => user.role === Role.MANAGER).length,
    employee: users.filter((user) => user.role === Role.EMPLOYEE).length,
    accountant: users.filter((user) => user.role === Role.ACCOUNTANT).length,
  };

  const reportsByRole = [Role.ADMIN, Role.MANAGER, Role.EMPLOYEE, Role.ACCOUNTANT].map((role) => ({
    role,
    count: reports.filter((report) => report.author.role === role).length,
  }));

  const perEmployee = users.map((user) => {
    const userReports = reports.filter((report) => report.authorId === user.id);
    const userAttendance = attendance.filter((row) => row.userId === user.id);
    const userTickets = tickets.filter((ticket) => ticket.sellerId === user.id);
    const userSalesAmount = userTickets.reduce((acc, ticket) => acc + ticket.amount, 0);

    return {
      userId: user.id,
      name: user.name,
      role: user.role,
      reports: userReports.length,
      approvedReports: userReports.filter((report) => report.status === ReportStatus.APPROVED).length,
      attendance: userAttendance.length,
      absences: userAttendance.filter((row) => row.status === AttendanceStatus.ABSENT).length,
      late: userAttendance.filter((row) => row.latenessMins > 0).length,
      overtimeMins: userAttendance.reduce((acc, row) => acc + row.overtimeMins, 0),
      tickets: userTickets.length,
      salesAmount: userSalesAmount,
    };
  });

  const frequencyPeriods: PeriodFilter[] = ["DAILY", "WEEKLY", "MONTHLY", "ANNUAL"];

  const [frequencyReports, frequencyTickets] = await Promise.all([
    prisma.workerReport.findMany({
      where: {
        ...(shouldScopeToSelectedUsers ? { authorId: selectedUsersFilter } : {}),
      },
      select: { createdAt: true },
      take: 5000,
      orderBy: { createdAt: "desc" },
    }),
    prisma.ticketSale.findMany({
      where: {
        ...(shouldScopeToSelectedUsers ? { sellerId: selectedUsersFilter } : {}),
      },
      select: { soldAt: true, amount: true },
      take: 5000,
      orderBy: { soldAt: "desc" },
    }),
  ]);

  const byFrequency = frequencyPeriods.map((freq) => {
    const start = getPeriodStart(freq);
    const reportCount = frequencyReports.filter((report) => report.createdAt >= start).length;
    const sales = frequencyTickets
      .filter((ticket) => ticket.soldAt >= start)
      .reduce((acc, ticket) => acc + ticket.amount, 0);

    return {
      period: freq,
      reports: reportCount,
      sales,
    };
  });

  return NextResponse.json({
    filters: {
      period,
      role: roleFilter,
      userId: userId ?? null,
      since,
    },
    users,
    usersSummary: userBreakdown,
    reports: reportTotals,
    reportsByRole,
    attendance: attendanceTotals,
    payments: paymentTotals,
    sales: salesMetrics,
    perEmployee,
    byFrequency,
  });
}
