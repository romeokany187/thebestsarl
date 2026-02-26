import bcrypt from "bcryptjs";
import { PrismaClient, ReportPeriod, ReportStatus, Role, AttendanceStatus, PaymentStatus, JobTitle, CommissionMode, TravelClass, SaleNature } from "@prisma/client";

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
      jobTitle: JobTitle.DIRECTION_GENERALE,
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
      jobTitle: JobTitle.RELATION_PUBLIQUE,
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
      jobTitle: JobTitle.COMMERCIAL,
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
      jobTitle: JobTitle.COMPTABLE,
      teamId: salesTeam.id,
    },
  });

  const airFrance = await prisma.airline.upsert({
    where: { code: "AF" },
    update: {},
    create: {
      code: "AF",
      name: "Air France",
    },
  });

  const airCongo = await prisma.airline.upsert({
    where: { code: "ACG" },
    update: {},
    create: {
      code: "ACG",
      name: "Air Congo",
    },
  });

  const montGabon = await prisma.airline.upsert({
    where: { code: "MGB" },
    update: {},
    create: {
      code: "MGB",
      name: "Mont Gabon",
    },
  });

  const caa = await prisma.airline.upsert({
    where: { code: "CAA" },
    update: {},
    create: {
      code: "CAA",
      name: "CAA",
    },
  });

  const ethiopian = await prisma.airline.upsert({
    where: { code: "ET" },
    update: {},
    create: {
      code: "ET",
      name: "Ethiopian Airlines",
    },
  });

  const kenya = await prisma.airline.upsert({
    where: { code: "KQ" },
    update: {},
    create: {
      code: "KQ",
      name: "Kenya Airways",
    },
  });

  await Promise.all([
    prisma.airline.upsert({
      where: { code: "FST" },
      update: {},
      create: { code: "FST", name: "Air Fast" },
    }),
    prisma.airline.upsert({
      where: { code: "UR" },
      update: {},
      create: { code: "UR", name: "Uganda Air" },
    }),
    prisma.airline.upsert({
      where: { code: "TC" },
      update: {},
      create: { code: "TC", name: "Air Tanzania" },
    }),
    prisma.airline.upsert({
      where: { code: "KP" },
      update: {},
      create: { code: "KP", name: "ASKY" },
    }),
    prisma.airline.upsert({
      where: { code: "WB" },
      update: {},
      create: { code: "WB", name: "Rwanda Air" },
    }),
    prisma.airline.upsert({
      where: { code: "DKT" },
      update: {},
      create: { code: "DKT", name: "Dakota" },
    }),
  ]);

  await prisma.airline.update({
    where: { id: montGabon.id },
    data: { name: "Mont Gabaon" },
  }).catch(() => undefined);

  await prisma.commissionRule.create({
    data: {
      airlineId: airFrance.id,
      ratePercent: 7.5,
      routePattern: "*",
      commissionMode: CommissionMode.IMMEDIATE,
      systemRatePercent: 7.5,
      startsAt: new Date("2026-01-01"),
      isActive: true,
    },
  }).catch(() => undefined);

  await prisma.commissionRule.createMany({
    data: [
      {
        airlineId: airCongo.id,
        ratePercent: 8,
        routePattern: "BZV-*",
        travelClass: TravelClass.ECONOMY,
        commissionMode: CommissionMode.IMMEDIATE,
        systemRatePercent: 8,
        markupRatePercent: 0,
        startsAt: new Date("2026-01-01"),
        isActive: true,
      },
      {
        airlineId: montGabon.id,
        ratePercent: 9,
        routePattern: "*",
        commissionMode: CommissionMode.IMMEDIATE,
        systemRatePercent: 9,
        startsAt: new Date("2026-01-01"),
        isActive: true,
      },
      {
        airlineId: caa.id,
        ratePercent: 0,
        routePattern: "*",
        commissionMode: CommissionMode.AFTER_DEPOSIT,
        systemRatePercent: 0,
        depositStockTargetAmount: 10000,
        depositStockConsumedAmount: 0,
        batchCommissionAmount: 650,
        startsAt: new Date("2026-01-01"),
        isActive: true,
      },
      {
        airlineId: ethiopian.id,
        ratePercent: 6,
        routePattern: "*",
        commissionMode: CommissionMode.SYSTEM_PLUS_MARKUP,
        systemRatePercent: 6,
        markupRatePercent: 3,
        startsAt: new Date("2026-01-01"),
        isActive: true,
      },
      {
        airlineId: kenya.id,
        ratePercent: 5,
        routePattern: "*",
        commissionMode: CommissionMode.SYSTEM_PLUS_MARKUP,
        systemRatePercent: 5,
        markupRatePercent: 2,
        startsAt: new Date("2026-01-01"),
        isActive: true,
      },
    ],
    skipDuplicates: true,
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

  await prisma.workSite.createMany({
    data: [
      {
        name: "Siège Principal",
        type: "OFFICE",
        latitude: 14.7167,
        longitude: -17.4677,
        radiusMeters: 250,
        isActive: true,
      },
      {
        name: "Antenne Aéroport",
        type: "ASSIGNMENT",
        latitude: 14.7397,
        longitude: -17.4902,
        radiusMeters: 300,
        isActive: true,
      },
    ],
    skipDuplicates: true,
  }).catch(() => undefined);

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
      airlineId: airFrance.id,
      sellerId: employee.id,
      travelClass: TravelClass.ECONOMY,
      saleNature: SaleNature.CREDIT,
      paymentStatus: PaymentStatus.PARTIAL,
      commissionRateUsed: 7.5,
      commissionAmount: 73.5,
      commissionModeApplied: CommissionMode.IMMEDIATE,
      payerName: "Client Démo",
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
