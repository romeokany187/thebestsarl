import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";

function canManageAccounting(role: string, jobTitle: string | null | undefined) {
  return role === "ADMIN" || role === "ACCOUNTANT" || (jobTitle ?? "") === "COMPTABLE";
}

function toUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

async function ensureAccountingDailyRateTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \
    \`AccountingDailyRate\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`rateDate\` DATETIME(3) NOT NULL,
      \`exchangeRate\` DOUBLE NOT NULL,
      \`createdById\` VARCHAR(191) NOT NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      UNIQUE INDEX \`AccountingDailyRate_rateDate_key\` (\`rateDate\`),
      INDEX \`AccountingDailyRate_createdById_idx\` (\`createdById\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);
}

export async function POST(request: NextRequest) {
  const access = await requireApiModuleAccess("payments", ["ADMIN", "DIRECTEUR_GENERAL", "ACCOUNTANT", "EMPLOYEE"]);
  if (access.error) return access.error;

  if (!canManageAccounting(access.role, access.session.user.jobTitle)) {
    return NextResponse.json({ error: "Accès réservé au comptable et à l'administrateur." }, { status: 403 });
  }

  await ensureAccountingDailyRateTable();

  const body = await request.json();
  const rateDateRaw = typeof body?.rateDate === "string" ? body.rateDate.trim() : "";
  const exchangeRate = Number(body?.exchangeRate);

  if (!rateDateRaw) {
    return NextResponse.json({ error: "La date du taux est obligatoire." }, { status: 400 });
  }

  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
    return NextResponse.json({ error: "Le taux du jour doit être un nombre positif." }, { status: 400 });
  }

  const rateDate = toUtcDay(new Date(`${rateDateRaw}T00:00:00.000Z`));
  if (Number.isNaN(rateDate.getTime())) {
    return NextResponse.json({ error: "Date de taux invalide." }, { status: 400 });
  }

  const dailyRate = await (prisma as unknown as { accountingDailyRate: any }).accountingDailyRate.upsert({
    where: { rateDate },
    update: {
      exchangeRate,
      createdById: access.session.user.id,
    },
    create: {
      rateDate,
      exchangeRate,
      createdById: access.session.user.id,
    },
    include: {
      createdBy: { select: { name: true } },
    },
  });

  return NextResponse.json({ data: dailyRate });
}