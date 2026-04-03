import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // 1) Ensure new enum values exist before remapping rows.
  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'JobTitle') THEN
        ALTER TYPE "JobTitle" ADD VALUE IF NOT EXISTS 'CAISSIER';
        ALTER TYPE "JobTitle" ADD VALUE IF NOT EXISTS 'APPROVISIONNEMENT';
        ALTER TYPE "JobTitle" ADD VALUE IF NOT EXISTS 'CHEF_AGENCE';
      END IF;
    END
    $$;
  `);

  // 2) Rewrite legacy values to normalized values.
  const updatedCashier = await prisma.$executeRawUnsafe(`
    UPDATE "User"
    SET "jobTitle" = 'CAISSIER'::"JobTitle"
    WHERE "jobTitle"::text = 'CAISSIERE';
  `);

  const updatedProcurement = await prisma.$executeRawUnsafe(`
    UPDATE "User"
    SET "jobTitle" = 'APPROVISIONNEMENT'::"JobTitle"
    WHERE "jobTitle"::text = 'APPROVISIONNEMENT_MARKETING';
  `);

  // 3) Normalize default to a stable value (prevents enum-drop migration failures).
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "User"
    ALTER COLUMN "jobTitle"
    SET DEFAULT 'AGENT_TERRAIN'::"JobTitle";
  `);

  const rows = await prisma.$queryRawUnsafe<Array<{ jobTitle: string; count: number }>>(`
    SELECT "jobTitle"::text AS "jobTitle", COUNT(*)::int AS "count"
    FROM "User"
    GROUP BY 1
    ORDER BY 1;
  `);

  console.log(`[jobtitles] Updated CAISSIERE -> CAISSIER: ${updatedCashier}`);
  console.log(`[jobtitles] Updated APPROVISIONNEMENT_MARKETING -> APPROVISIONNEMENT: ${updatedProcurement}`);
  console.log("[jobtitles] Current distribution:");
  for (const row of rows) {
    console.log(`  - ${row.jobTitle}: ${row.count}`);
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
