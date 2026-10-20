import { prisma } from "../src/lib/prisma";

async function tableExists(table: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`
    SELECT COUNT(*) AS count
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = '${table}'
  `);
  return Number(rows[0]?.count ?? 0) > 0;
}

async function ensureTable(table: string, ddl: string) {
  if (await tableExists(table)) {
    console.log(`[db] ${table} already exists`);
    return;
  }
  await prisma.$executeRawUnsafe(ddl);
  console.log(`[db] Created ${table}`);
}

async function ensureIntegrationSchema() {
  await ensureTable("IntegrationClient", `
    CREATE TABLE \`IntegrationClient\` (
      \`id\` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
      \`name\` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
      \`keyPrefix\` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
      \`keyHash\` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
      \`scopes\` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'events:read,events:write,webhooks:read,webhooks:write',
      \`enabled\` tinyint(1) NOT NULL DEFAULT '1',
      \`createdById\` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
      \`lastUsedAt\` datetime(3) DEFAULT NULL,
      \`revokedAt\` datetime(3) DEFAULT NULL,
      \`createdAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` datetime(3) NOT NULL,
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`IntegrationClient_keyPrefix_key\` (\`keyPrefix\`),
      UNIQUE KEY \`IntegrationClient_keyHash_key\` (\`keyHash\`),
      KEY \`IntegrationClient_createdById_idx\` (\`createdById\`),
      KEY \`IntegrationClient_enabled_idx\` (\`enabled\`),
      CONSTRAINT \`IntegrationClient_createdById_fkey\` FOREIGN KEY (\`createdById\`) REFERENCES \`User\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await ensureTable("IntegrationInboundEvent", `
    CREATE TABLE \`IntegrationInboundEvent\` (
      \`id\` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
      \`clientId\` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
      \`eventType\` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
      \`externalId\` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
      \`payload\` json NOT NULL,
      \`status\` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'RECEIVED',
      \`receivedAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`IntegrationInboundEvent_clientId_externalId_key\` (\`clientId\`,\`externalId\`),
      KEY \`IntegrationInboundEvent_clientId_receivedAt_idx\` (\`clientId\`,\`receivedAt\`),
      KEY \`IntegrationInboundEvent_eventType_idx\` (\`eventType\`),
      CONSTRAINT \`IntegrationInboundEvent_clientId_fkey\` FOREIGN KEY (\`clientId\`) REFERENCES \`IntegrationClient\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await ensureTable("IntegrationWebhook", `
    CREATE TABLE \`IntegrationWebhook\` (
      \`id\` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
      \`clientId\` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
      \`url\` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
      \`signingSecret\` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
      \`eventTypes\` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
      \`enabled\` tinyint(1) NOT NULL DEFAULT '1',
      \`createdAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      KEY \`IntegrationWebhook_clientId_idx\` (\`clientId\`),
      CONSTRAINT \`IntegrationWebhook_clientId_fkey\` FOREIGN KEY (\`clientId\`) REFERENCES \`IntegrationClient\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await ensureTable("IntegrationOutboundEvent", `
    CREATE TABLE \`IntegrationOutboundEvent\` (
      \`id\` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
      \`eventType\` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
      \`payload\` json NOT NULL,
      \`createdAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      KEY \`IntegrationOutboundEvent_createdAt_idx\` (\`createdAt\`),
      KEY \`IntegrationOutboundEvent_eventType_idx\` (\`eventType\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await ensureTable("IntegrationWebhookDelivery", `
    CREATE TABLE \`IntegrationWebhookDelivery\` (
      \`id\` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
      \`outboundEventId\` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
      \`webhookId\` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
      \`status\` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDING',
      \`responseStatus\` int DEFAULT NULL,
      \`errorMessage\` text COLLATE utf8mb4_unicode_ci,
      \`attemptedAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      KEY \`IntegrationWebhookDelivery_outboundEventId_idx\` (\`outboundEventId\`),
      KEY \`IntegrationWebhookDelivery_webhookId_idx\` (\`webhookId\`),
      CONSTRAINT \`IntegrationWebhookDelivery_outboundEventId_fkey\` FOREIGN KEY (\`outboundEventId\`) REFERENCES \`IntegrationOutboundEvent\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT \`IntegrationWebhookDelivery_webhookId_fkey\` FOREIGN KEY (\`webhookId\`) REFERENCES \`IntegrationWebhook\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

ensureIntegrationSchema()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
