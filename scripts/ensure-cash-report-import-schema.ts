import { prisma } from "../src/lib/prisma";

async function columnExists(table: string, column: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`
    SELECT COUNT(*) AS count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = '${table}'
      AND COLUMN_NAME = '${column}'
  `);
  return Number(rows[0]?.count ?? 0) > 0;
}

async function indexExists(table: string, indexName: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`
    SELECT COUNT(*) AS count
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = '${table}'
      AND INDEX_NAME = '${indexName}'
  `);
  return Number(rows[0]?.count ?? 0) > 0;
}

async function tableExists(table: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`
    SELECT COUNT(*) AS count
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = '${table}'
  `);
  return Number(rows[0]?.count ?? 0) > 0;
}

async function addColumnIfMissing(table: string, column: string, definition: string) {
  if (await columnExists(table, column)) {
    console.log(`[db] ${table}.${column} already exists`);
    return;
  }
  await prisma.$executeRawUnsafe(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  console.log(`[db] Added ${table}.${column}`);
}

async function addIndexIfMissing(table: string, indexName: string, ddl: string) {
  if (await indexExists(table, indexName)) {
    console.log(`[db] Index ${table}.${indexName} already exists`);
    return;
  }
  await prisma.$executeRawUnsafe(`ALTER TABLE \`${table}\` ADD ${ddl}`);
  console.log(`[db] Added index ${table}.${indexName}`);
}

async function ensureCashReportImportSchema() {
  await addColumnIfMissing("Payment", "importSource", "VARCHAR(191) NULL");
  await addColumnIfMissing("Payment", "importExternalKey", "VARCHAR(191) NULL");
  await addColumnIfMissing("Payment", "excelLibelle", "TEXT NULL");
  await addIndexIfMissing("Payment", "Payment_importSource_idx", "INDEX `Payment_importSource_idx` (`importSource`)");
  await addIndexIfMissing("Payment", "Payment_importExternalKey_key", "UNIQUE INDEX `Payment_importExternalKey_key` (`importExternalKey`)");

  await addColumnIfMissing("CashOperation", "importSource", "VARCHAR(191) NULL");
  await addColumnIfMissing("CashOperation", "importExternalKey", "VARCHAR(191) NULL");
  await addIndexIfMissing("CashOperation", "CashOperation_importSource_idx", "INDEX `CashOperation_importSource_idx` (`importSource`)");
  await addIndexIfMissing("CashOperation", "CashOperation_importExternalKey_key", "UNIQUE INDEX `CashOperation_importExternalKey_key` (`importExternalKey`)");

  if (!(await tableExists("CashReportImport"))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE \`CashReportImport\` (
        \`id\` VARCHAR(191) NOT NULL,
        \`reportMonth\` VARCHAR(191) NOT NULL,
        \`fileName\` VARCHAR(191) NOT NULL,
        \`fileHash\` VARCHAR(191) NOT NULL,
        \`closingDate\` VARCHAR(191) NOT NULL,
        \`status\` VARCHAR(191) NOT NULL DEFAULT 'COMPLETED',
        \`journalNewCount\` INT NOT NULL DEFAULT 0,
        \`journalSkipCount\` INT NOT NULL DEFAULT 0,
        \`ticketSyncCount\` INT NOT NULL DEFAULT 0,
        \`cashOpSyncCount\` INT NOT NULL DEFAULT 0,
        \`importedById\` VARCHAR(191) NOT NULL,
        \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        INDEX \`CashReportImport_reportMonth_createdAt_idx\` (\`reportMonth\`, \`createdAt\`),
        INDEX \`CashReportImport_fileHash_idx\` (\`fileHash\`),
        CONSTRAINT \`CashReportImport_importedById_fkey\`
          FOREIGN KEY (\`importedById\`) REFERENCES \`User\`(\`id\`)
          ON DELETE RESTRICT ON UPDATE CASCADE
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
    console.log("[db] Created CashReportImport");
  }

  if (!(await tableExists("CashReportJournalLine"))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE \`CashReportJournalLine\` (
        \`id\` VARCHAR(191) NOT NULL,
        \`importId\` VARCHAR(191) NOT NULL,
        \`reportMonth\` VARCHAR(191) NOT NULL,
        \`businessDate\` VARCHAR(191) NOT NULL,
        \`lineCategory\` VARCHAR(191) NOT NULL,
        \`typeOperation\` VARCHAR(191) NOT NULL,
        \`libelle\` TEXT NOT NULL,
        \`referenceDoc\` VARCHAR(191) NULL,
        \`usdIn\` DOUBLE NOT NULL DEFAULT 0,
        \`usdOut\` DOUBLE NOT NULL DEFAULT 0,
        \`cdfIn\` DOUBLE NOT NULL DEFAULT 0,
        \`cdfOut\` DOUBLE NOT NULL DEFAULT 0,
        \`usdBalance\` DOUBLE NULL,
        \`cdfBalance\` DOUBLE NULL,
        \`externalKey\` VARCHAR(191) NOT NULL,
        \`ticketMatchStatus\` VARCHAR(191) NULL,
        \`paymentId\` VARCHAR(191) NULL,
        \`cashOperationId\` VARCHAR(191) NULL,
        \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`CashReportJournalLine_externalKey_key\` (\`externalKey\`),
        UNIQUE INDEX \`CashReportJournalLine_paymentId_key\` (\`paymentId\`),
        UNIQUE INDEX \`CashReportJournalLine_cashOperationId_key\` (\`cashOperationId\`),
        INDEX \`CashReportJournalLine_reportMonth_businessDate_idx\` (\`reportMonth\`, \`businessDate\`),
        INDEX \`CashReportJournalLine_lineCategory_idx\` (\`lineCategory\`),
        CONSTRAINT \`CashReportJournalLine_importId_fkey\`
          FOREIGN KEY (\`importId\`) REFERENCES \`CashReportImport\`(\`id\`)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT \`CashReportJournalLine_paymentId_fkey\`
          FOREIGN KEY (\`paymentId\`) REFERENCES \`Payment\`(\`id\`)
          ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT \`CashReportJournalLine_cashOperationId_fkey\`
          FOREIGN KEY (\`cashOperationId\`) REFERENCES \`CashOperation\`(\`id\`)
          ON DELETE SET NULL ON UPDATE CASCADE
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
    console.log("[db] Created CashReportJournalLine");
  }

  if (!(await tableExists("CashReportVirtualSnapshot"))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE \`CashReportVirtualSnapshot\` (
        \`id\` VARCHAR(191) NOT NULL,
        \`closingDate\` VARCHAR(191) NOT NULL,
        \`cashDesk\` VARCHAR(191) NOT NULL DEFAULT 'THE_BEST',
        \`channels\` JSON NOT NULL,
        \`totalUsd\` DOUBLE NOT NULL DEFAULT 0,
        \`totalCdf\` DOUBLE NOT NULL DEFAULT 0,
        \`importId\` VARCHAR(191) NULL,
        \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`CashReportVirtualSnapshot_closingDate_cashDesk_key\` (\`closingDate\`, \`cashDesk\`),
        INDEX \`CashReportVirtualSnapshot_cashDesk_closingDate_idx\` (\`cashDesk\`, \`closingDate\`)
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
    console.log("[db] Created CashReportVirtualSnapshot");
  }
}

ensureCashReportImportSchema()
  .then(() => {
    console.log("[db] Cash report import schema ensured");
  })
  .catch((error) => {
    console.error("[db] Failed to ensure cash report import schema", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
