import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type Summary = Record<string, number>;

async function main() {
  const summary: Summary = {};

  summary.deletedStockMovements = (await prisma.stockMovement.deleteMany({})).count;
  summary.deletedPayments = (await prisma.payment.deleteMany({})).count;
  summary.deletedAttendances = (await prisma.attendance.deleteMany({})).count;
  summary.deletedWorkerReports = (await prisma.workerReport.deleteMany({})).count;
  summary.deletedNeedRequests = (await prisma.needRequest.deleteMany({})).count;
  summary.deletedTicketSales = (await prisma.ticketSale.deleteMany({})).count;
  summary.deletedCommissionRules = (await prisma.commissionRule.deleteMany({})).count;
  summary.deletedStockItems = (await prisma.stockItem.deleteMany({})).count;
  summary.deletedAuditLogs = (await prisma.auditLog.deleteMany({})).count;
  summary.deletedUserNotifications = (await prisma.userNotification.deleteMany({})).count;
  summary.deletedNewsPosts = (await prisma.newsPost.deleteMany({})).count;
  summary.deletedArchiveDocuments = (await prisma.archiveDocument.deleteMany({})).count;
  summary.deletedWorkSites = (await prisma.workSite.deleteMany({})).count;
  summary.deletedAirlines = (await prisma.airline.deleteMany({})).count;

  const usersCount = await prisma.user.count();
  const teamsCount = await prisma.team.count();

  console.log("Operational reset completed.");
  Object.entries(summary).forEach(([key, value]) => {
    console.log(`${key}: ${value}`);
  });
  console.log(`usersKept: ${usersCount}`);
  console.log(`teamsKept: ${teamsCount}`);
}

main()
  .catch((error) => {
    console.error("Operational reset failed", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
