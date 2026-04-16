import { NextResponse } from "next/server";
import { flattenStructuredPlan } from "@/lib/plan-comptable-sync";
import { prisma } from "@/lib/prisma";
import { requireApiRoles } from "@/lib/rbac";

export async function POST() {
  const access = await requireApiRoles(["ADMIN"]);
  if (access.error) return access.error;

  // Ensure Account table exists (MySQL — migration may not have been applied on Hostinger)
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS \`Account\` (
        \`id\`            VARCHAR(191) NOT NULL,
        \`code\`          VARCHAR(191) NOT NULL,
        \`label\`         VARCHAR(191) NOT NULL,
        \`parentCode\`    VARCHAR(191) NULL,
        \`level\`         INT NULL,
        \`normalBalance\` ENUM('DEBIT','CREDIT') NOT NULL DEFAULT 'DEBIT',
        \`createdAt\`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\`     DATETIME(3) NOT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`Account_code_key\` (\`code\`),
        INDEX \`Account_code_idx\` (\`code\`)
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    `);
  } catch (e: any) {
    return NextResponse.json({ success: false, error: `Impossible de créer la table: ${e.message}` }, { status: 500 });
  }

  const accounts = flattenStructuredPlan();
  let count = 0;
  const errors: string[] = [];

  for (const a of accounts) {
    try {
      await prisma.account.upsert({
        where: { code: a.code },
        update: { label: a.label, parentCode: a.parentCode, level: a.level },
        create: { code: a.code, label: a.label, parentCode: a.parentCode, level: a.level },
      });
      count++;
    } catch (e: any) {
      errors.push(`${a.code}: ${e.message}`);
      // Stop on first DB-level error (table missing, connection issue, etc.)
      if (errors.length >= 3) break;
    }
  }

  if (errors.length > 0 && count === 0) {
    return NextResponse.json(
      { success: false, count: 0, error: `Erreur DB : ${errors[0]}`, errors },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, count, errors: errors.slice(0, 20) });
}
