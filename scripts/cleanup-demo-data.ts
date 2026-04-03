import { PrismaClient, JobTitle } from "@prisma/client";

const prisma = new PrismaClient();

const demoEmails = [
  "admin@thebestsarl.com",
  "manager@thebestsarl.com",
  "employee@thebestsarl.com",
  "accountant@thebestsarl.com",
  "appro@thebestsarl.com",
];

async function main() {
  const summary: Record<string, number> = {};

  const deletedDemoMovements = await prisma.stockMovement.deleteMany({
    where: { id: { in: ["demo-mov-in-paper", "demo-mov-out-paper", "demo-mov-in-marker", "demo-mov-out-marker"] } },
  });
  summary.deletedDemoMovementsById = deletedDemoMovements.count;

  const deletedDemoNeeds = await prisma.needRequest.deleteMany({
    where: { id: { in: ["demo-need-approved", "demo-need-submitted"] } },
  });
  summary.deletedDemoNeedsById = deletedDemoNeeds.count;

  const seedTicket = await prisma.ticketSale.findUnique({
    where: { ticketNumber: "TBS-2026-0001" },
    select: { id: true },
  });

  if (seedTicket) {
    const deletedTicketPayments = await prisma.payment.deleteMany({ where: { ticketId: seedTicket.id } });
    summary.deletedTicketPayments = deletedTicketPayments.count;
    const deletedTicket = await prisma.ticketSale.deleteMany({ where: { id: seedTicket.id } });
    summary.deletedSeedTicket = deletedTicket.count;
  } else {
    summary.deletedTicketPayments = 0;
    summary.deletedSeedTicket = 0;
  }

  const deletedSeedReport = await prisma.workerReport.deleteMany({
    where: { title: "Rapport journalier ventes" },
  });
  summary.deletedSeedReports = deletedSeedReport.count;

  const deletedSeedAudit = await prisma.auditLog.deleteMany({
    where: { action: "SEED_INITIALIZED" },
  });
  summary.deletedSeedAuditLogs = deletedSeedAudit.count;

  const demoItems = await prisma.stockItem.findMany({
    where: {
      OR: [
        { name: "Ramette A4", category: "Fournitures de bureau", unit: "paquet" },
        { name: "Marqueur tableau", category: "Fournitures de bureau", unit: "pièce" },
      ],
    },
    select: { id: true },
  });
  const demoItemIds = demoItems.map((item) => item.id);

  if (demoItemIds.length > 0) {
    const deletedItemMovements = await prisma.stockMovement.deleteMany({
      where: { stockItemId: { in: demoItemIds } },
    });
    summary.deletedDemoItemMovements = deletedItemMovements.count;

    const deletedItems = await prisma.stockItem.deleteMany({
      where: { id: { in: demoItemIds } },
    });
    summary.deletedDemoStockItems = deletedItems.count;
  } else {
    summary.deletedDemoItemMovements = 0;
    summary.deletedDemoStockItems = 0;
  }

  const usersToDelete = await prisma.user.findMany({
    where: { email: { in: demoEmails } },
    select: { id: true },
  });
  const demoUserIds = usersToDelete.map((u) => u.id);

  if (demoUserIds.length > 0) {
    await prisma.userNotification.deleteMany({ where: { userId: { in: demoUserIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: demoUserIds } } });
    await prisma.payment.deleteMany({ where: { ticket: { sellerId: { in: demoUserIds } } } });
    await prisma.ticketSale.deleteMany({ where: { sellerId: { in: demoUserIds } } });
    await prisma.attendance.deleteMany({ where: { userId: { in: demoUserIds } } });
    await prisma.workerReport.deleteMany({
      where: {
        OR: [
          { authorId: { in: demoUserIds } },
          { reviewerId: { in: demoUserIds } },
        ],
      },
    });
    await prisma.needRequest.deleteMany({
      where: {
        OR: [
          { requesterId: { in: demoUserIds } },
          { reviewedById: { in: demoUserIds } },
        ],
      },
    });
    await prisma.stockMovement.deleteMany({ where: { performedById: { in: demoUserIds } } });

    const deletedDemoUsers = await prisma.user.deleteMany({ where: { id: { in: demoUserIds } } });
    summary.deletedDemoUsers = deletedDemoUsers.count;
  } else {
    summary.deletedDemoUsers = 0;
  }

  const resetRomeoo = await prisma.user.updateMany({
    where: {
      email: "romeoo.thebest@gmail.com",
      jobTitle: JobTitle.APPROVISIONNEMENT,
    },
    data: {
      jobTitle: JobTitle.AGENT_TERRAIN,
      teamId: null,
    },
  });
  summary.resetRomeooAssignment = resetRomeoo.count;

  const kinshasaTeam = await prisma.team.upsert({
    where: { name: "Agence de Kinshasa (Direction générale)" },
    update: { kind: "AGENCE" },
    create: { name: "Agence de Kinshasa (Direction générale)", kind: "AGENCE" },
  });

  const legacyTeams = await prisma.team.findMany({
    where: {
      name: { in: ["Operations", "Operation", "Sales"] },
    },
    select: { id: true },
  });
  const legacyTeamIds = legacyTeams.map((team) => team.id);

  if (legacyTeamIds.length > 0) {
    const reassignedLegacyTeamUsers = await prisma.user.updateMany({
      where: { teamId: { in: legacyTeamIds } },
      data: { teamId: kinshasaTeam.id },
    });
    summary.reassignedLegacyTeamUsers = reassignedLegacyTeamUsers.count;

    const deletedLegacyTeams = await prisma.team.deleteMany({
      where: { id: { in: legacyTeamIds } },
    });
    summary.deletedLegacyTeams = deletedLegacyTeams.count;
  } else {
    summary.reassignedLegacyTeamUsers = 0;
    summary.deletedLegacyTeams = 0;
  }

  const deletedSites = await prisma.workSite.deleteMany({
    where: {
      name: { in: ["Siège Principal", "Antenne Aéroport"] },
    },
  });
  summary.deletedDemoWorkSites = deletedSites.count;

  console.log("Demo cleanup summary:");
  Object.entries(summary).forEach(([key, value]) => {
    console.log(`${key}: ${value}`);
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
