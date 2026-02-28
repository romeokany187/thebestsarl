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

  const procurementOfficer = await prisma.user.upsert({
    where: { email: "appro@thebestsarl.com" },
    update: {
      jobTitle: JobTitle.APPROVISIONNEMENT_MARKETING,
      role: Role.EMPLOYEE,
      teamId: opsTeam.id,
    },
    create: {
      name: "Chargé Approvisionnement",
      email: "appro@thebestsarl.com",
      passwordHash,
      role: Role.EMPLOYEE,
      jobTitle: JobTitle.APPROVISIONNEMENT_MARKETING,
      teamId: opsTeam.id,
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
      defaultBaseFareRatio: 0.6,
      startsAt: new Date("2026-01-01"),
      isActive: true,
    },
  }).catch(() => undefined);

  await prisma.commissionRule.createMany({
    data: [
      {
        airlineId: airCongo.id,
        ratePercent: 5,
        routePattern: "BZV-*",
        travelClass: TravelClass.ECONOMY,
        commissionMode: CommissionMode.IMMEDIATE,
        systemRatePercent: 5,
        markupRatePercent: 0,
        defaultBaseFareRatio: 0.62,
        startsAt: new Date("2026-01-01"),
        isActive: true,
      },
      {
        airlineId: montGabon.id,
        ratePercent: 5,
        routePattern: "*",
        commissionMode: CommissionMode.IMMEDIATE,
        systemRatePercent: 5,
        defaultBaseFareRatio: 0.62,
        startsAt: new Date("2026-01-01"),
        isActive: true,
      },
      {
        airlineId: caa.id,
        ratePercent: 0,
        routePattern: "*",
        commissionMode: CommissionMode.AFTER_DEPOSIT,
        systemRatePercent: 0,
        defaultBaseFareRatio: 1,
        depositStockTargetAmount: 10000,
        depositStockConsumedAmount: 0,
        batchCommissionAmount: 650,
        startsAt: new Date("2026-01-01"),
        isActive: true,
      },
      {
        airlineId: ethiopian.id,
        ratePercent: 5,
        routePattern: "*",
        commissionMode: CommissionMode.SYSTEM_PLUS_MARKUP,
        systemRatePercent: 5,
        markupRatePercent: 0,
        defaultBaseFareRatio: 0.55,
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
        defaultBaseFareRatio: 0.55,
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
      currency: "USD",
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

  const approvedNeed = await prisma.needRequest.findFirst({
    where: {
      requesterId: procurementOfficer.id,
      title: "Achat consommables bureau T1",
    },
  });

  const approvedNeedRequest = approvedNeed
    ? await prisma.needRequest.update({
        where: { id: approvedNeed.id },
        data: {
          category: "Fournitures de bureau",
          details: "Ramettes A4, stylos, chemises cartonnées, classeurs.",
          quantity: 40,
          unit: "lot",
          status: "APPROVED",
          reviewedById: admin.id,
          reviewComment: "Besoin validé pour continuité des opérations.",
          submittedAt: approvedNeed.submittedAt ?? new Date(),
          reviewedAt: new Date(),
          approvedAt: new Date(),
          sealedAt: new Date(),
        },
      })
    : await prisma.needRequest.create({
        data: {
          title: "Achat consommables bureau T1",
          category: "Fournitures de bureau",
          details: "Ramettes A4, stylos, chemises cartonnées, classeurs.",
          quantity: 40,
          unit: "lot",
          status: "APPROVED",
          requesterId: procurementOfficer.id,
          reviewedById: admin.id,
          reviewComment: "Besoin validé pour continuité des opérations.",
          submittedAt: new Date(),
          reviewedAt: new Date(),
          approvedAt: new Date(),
          sealedAt: new Date(),
        },
      });

  const pendingNeed = await prisma.needRequest.findFirst({
    where: {
      requesterId: procurementOfficer.id,
      title: "Renouvellement kits imprimante",
    },
  });

  if (!pendingNeed) {
    await prisma.needRequest.create({
      data: {
        title: "Renouvellement kits imprimante",
        category: "Consommables IT",
        details: "Toners et tambours pour imprimantes administration et caisse.",
        quantity: 12,
        unit: "pièce",
        status: "SUBMITTED",
        requesterId: procurementOfficer.id,
        submittedAt: new Date(),
      },
    });
  }

  const paperStock = await prisma.stockItem.upsert({
    where: {
      name_category_unit: {
        name: "Ramette A4",
        category: "Fournitures de bureau",
        unit: "paquet",
      },
    },
    update: {},
    create: {
      name: "Ramette A4",
      category: "Fournitures de bureau",
      unit: "paquet",
      currentQuantity: 0,
    },
  });

  const markerStock = await prisma.stockItem.upsert({
    where: {
      name_category_unit: {
        name: "Marqueur tableau",
        category: "Fournitures de bureau",
        unit: "pièce",
      },
    },
    update: {},
    create: {
      name: "Marqueur tableau",
      category: "Fournitures de bureau",
      unit: "pièce",
      currentQuantity: 0,
    },
  });

  const initialPaperIn = await prisma.stockMovement.findFirst({
    where: {
      stockItemId: paperStock.id,
      movementType: "IN",
      referenceDoc: "BL-APPRO-001",
    },
  });

  if (!initialPaperIn) {
    await prisma.stockMovement.create({
      data: {
        stockItemId: paperStock.id,
        movementType: "IN",
        quantity: 80,
        justification: "Réception achat validé consommables bureau T1",
        referenceDoc: "BL-APPRO-001",
        performedById: procurementOfficer.id,
        needRequestId: approvedNeedRequest.id,
      },
    });
  }

  const paperOut = await prisma.stockMovement.findFirst({
    where: {
      stockItemId: paperStock.id,
      movementType: "OUT",
      referenceDoc: "BS-ADMIN-002",
    },
  });

  if (!paperOut) {
    await prisma.stockMovement.create({
      data: {
        stockItemId: paperStock.id,
        movementType: "OUT",
        quantity: 15,
        justification: "Sortie pour impression dossiers administratifs",
        referenceDoc: "BS-ADMIN-002",
        performedById: procurementOfficer.id,
      },
    });
  }

  const markerIn = await prisma.stockMovement.findFirst({
    where: {
      stockItemId: markerStock.id,
      movementType: "IN",
      referenceDoc: "BL-APPRO-003",
    },
  });

  if (!markerIn) {
    await prisma.stockMovement.create({
      data: {
        stockItemId: markerStock.id,
        movementType: "IN",
        quantity: 30,
        justification: "Entrée stock marqueurs pour salles de briefing",
        referenceDoc: "BL-APPRO-003",
        performedById: procurementOfficer.id,
        needRequestId: approvedNeedRequest.id,
      },
    });
  }

  const markerOut = await prisma.stockMovement.findFirst({
    where: {
      stockItemId: markerStock.id,
      movementType: "OUT",
      referenceDoc: "BS-FORM-001",
    },
  });

  if (!markerOut) {
    await prisma.stockMovement.create({
      data: {
        stockItemId: markerStock.id,
        movementType: "OUT",
        quantity: 6,
        justification: "Dotation kits formation commerciale",
        referenceDoc: "BS-FORM-001",
        performedById: procurementOfficer.id,
      },
    });
  }

  const groupedStock = await prisma.stockMovement.groupBy({
    by: ["stockItemId", "movementType"],
    _sum: { quantity: true },
  });

  const stockTotals = new Map<string, { inQty: number; outQty: number }>();
  groupedStock.forEach((row) => {
    const current = stockTotals.get(row.stockItemId) ?? { inQty: 0, outQty: 0 };
    if (row.movementType === "IN") {
      current.inQty = row._sum.quantity ?? 0;
    } else {
      current.outQty = row._sum.quantity ?? 0;
    }
    stockTotals.set(row.stockItemId, current);
  });

  for (const [stockItemId, values] of stockTotals.entries()) {
    await prisma.stockItem.update({
      where: { id: stockItemId },
      data: {
        currentQuantity: Math.max(values.inQty - values.outQty, 0),
      },
    });
  }

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
