import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function isMySqlFamilyDatabase() {
  const databaseUrl = process.env.DATABASE_URL?.trim().toLowerCase() ?? "";
  return databaseUrl.startsWith("mysql://") || databaseUrl.startsWith("mariadb://");
}

async function main() {
  const useMySqlSyntax = isMySqlFamilyDatabase();

  const updatedCashier = await prisma.$executeRawUnsafe(
    useMySqlSyntax
      ? `
        UPDATE \`User\`
        SET \`jobTitle\` = 'CAISSIER'
        WHERE \`jobTitle\` = 'CAISSIERE';
      `
      : `
        UPDATE "User"
        SET "jobTitle" = 'CAISSIER'::"JobTitle"
        WHERE "jobTitle"::text = 'CAISSIERE';
      `,
  );

  const updatedProcurement = await prisma.$executeRawUnsafe(
    useMySqlSyntax
      ? `
        UPDATE \`User\`
        SET \`jobTitle\` = 'APPROVISIONNEMENT'
        WHERE \`jobTitle\` = 'APPROVISIONNEMENT_MARKETING';
      `
      : `
        UPDATE "User"
        SET "jobTitle" = 'APPROVISIONNEMENT'::"JobTitle"
        WHERE "jobTitle"::text = 'APPROVISIONNEMENT_MARKETING';
      `,
  );

  const rows = await prisma.$queryRawUnsafe<Array<{ jobTitle: string; count: number | bigint }>>(
    useMySqlSyntax
      ? `
        SELECT \`jobTitle\` AS jobTitle, COUNT(*) AS count
        FROM \`User\`
        GROUP BY \`jobTitle\`
        ORDER BY \`jobTitle\`;
      `
      : `
        SELECT "jobTitle"::text AS "jobTitle", COUNT(*)::int AS "count"
        FROM "User"
        GROUP BY 1
        ORDER BY 1;
      `,
  );

  console.log(`[jobtitles] Database dialect: ${useMySqlSyntax ? "mysql/mariadb" : "postgresql"}`);
  console.log(`[jobtitles] Updated CAISSIERE -> CAISSIER: ${updatedCashier}`);
  console.log(`[jobtitles] Updated APPROVISIONNEMENT_MARKETING -> APPROVISIONNEMENT: ${updatedProcurement}`);
  console.log("[jobtitles] Current distribution:");
  for (const row of rows) {
    console.log(`  - ${row.jobTitle}: ${Number(row.count)}`);
  }
}

main()
  .catch((error) => {
    console.error("[jobtitles] Migration failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
