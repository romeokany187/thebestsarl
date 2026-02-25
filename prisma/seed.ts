import bcrypt from "bcryptjs";
import { PrismaClient, ReportPeriod, ReportStatus, Role, AttendanceStatus, PaymentStatus } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("password123", 10);

  const [opsTeam, salesTeam] = await Promise.all([
    prisma.team.upsert({
      where: { name: "Operations" },
      update: {},
      create: { name: "Operations" },
    }),
    prisma.team.upsert({
      where: { name: "Sales" },
      update: {},
      create: { name: "Sales" },
    }),
  ]);

  const admin = await prisma.user.upsert({
    where: { email: "admin@thebestsarl.com" },
    update: {},
    create: {
      name: "Admin Direction",
      email: "admin@thebestsarl.com",
      passwordHash,
      role: Role.ADMIN,
      teamId: opsTeam.id,
    },
  });

  const manager = await prisma.user.upsert({
    where: { email: "manager@thebestsarl.com" },
    update: {},
    create: {
      name: "Manager Equipe",
      email: "manager@thebestsarl.com",
      passwordHash,
      role: Role.MANAGER,
      teamId: opsTeam.id,
    },
  });

  const employee = await prisma.user.upsert({
    where: { email: "employee@thebestsarl.com" },
    update: {},
    create: {
      name: "Agent Voyage",
      email: "employee@thebestsarl.com",
      passwordHash,
      role: Role.EMPLOYEE,
      teamId: salesTeam.id,
    },
  });

  const accountant = await prisma.user.upsert({
    where: { email: "accountant@thebestsarl.com" },
    update: {},
    create: {
      name: "Comptable",
      email: "accountant@thebestsarl.com",
      passwordHash,
      role: Role.ACCOUNTANT,
      teamId: salesTeam.id,
    },
  });

  const airline = await prisma.airline.upsert({
    where: { code: "AF" },
    update: {},
    create: {
      code: "AF",
      name: "Air France",
    },
  });

  await prisma.commissionRule.create({
    data: {
      airlineId: airline.id,
      ratePercent: 7.5,
      startsAt: new Date("2026-01-01"),
      isActive: true,
    },
  }).catch(() => undefined);

  const report = await prisma.workerReport.create({
    data: {
      title: "Rapport journalier ventes",
      content: "3 billets vendus, 2 paiements reçus.",
      period: ReportPeriod.DAILY,
      periodStart: new Date(),
      periodEnd: new Date(),
      status: ReportStatus.SUBMITTED,
      authorId: employee.id,
      reviewerId: manager.id,
      submittedAt: new Date(),
    },
  }).catch(async () => {
    return prisma.workerReport.findFirstOrThrow({ where: { title: "Rapport journalier ventes" } });
  });

  await prisma.attendance.upsert({
    where: {
      userId_date: {
        userId: employee.id,
        date: new Date(new Date().toDateString()),
      },
    },
    update: {},
    create: {
      userId: employee.id,
      date: new Date(new Date().toDateString()),
      clockIn: new Date(),
      status: AttendanceStatus.PRESENT,
      latenessMins: 5,
    },
  });

  const ticket = await prisma.ticketSale.upsert({
    where: { ticketNumber: "TBS-2026-0001" },
    update: {},
    create: {
      ticketNumber: "TBS-2026-0001",
      customerName: "Client Démo",
      route: "CDG-DKR",
      travelDate: new Date("2026-03-15"),
      amount: 980,
      currency: "EUR",
      airlineId: airline.id,
      sellerId: employee.id,
      paymentStatus: PaymentStatus.PARTIAL,
      commissionRateUsed: 7.5,
      notes: "Paiement en deux tranches",
    },
  });

  await prisma.payment.create({
    data: {
      ticketId: ticket.id,
      amount: 500,
      method: "Bank Transfer",
      reference: "TRX-DEMO-001",
    },
  }).catch(() => undefined);

  await prisma.auditLog.create({
    data: {
      actorId: admin.id,
      action: "SEED_INITIALIZED",
      entityType: "System",
      entityId: report.id,
      payload: { users: [admin.email, manager.email, employee.email, accountant.email] },
    },
  });

  console.log("Seed completed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
