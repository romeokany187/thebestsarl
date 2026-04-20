import { prisma } from "../src/lib/prisma";

async function ensurePasswordSetupTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \`PasswordSetupCode\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`userId\` VARCHAR(191) NOT NULL,
      \`email\` VARCHAR(191) NOT NULL,
      \`codeHash\` VARCHAR(191) NOT NULL,
      \`purpose\` VARCHAR(191) NOT NULL DEFAULT 'PASSWORD_SETUP',
      \`expiresAt\` DATETIME(3) NOT NULL,
      \`consumedAt\` DATETIME(3) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`PasswordSetupCode_userId_expiresAt_idx\` (\`userId\`, \`expiresAt\`),
      INDEX \`PasswordSetupCode_email_expiresAt_idx\` (\`email\`, \`expiresAt\`),
      CONSTRAINT \`PasswordSetupCode_userId_fkey\`
        FOREIGN KEY (\`userId\`) REFERENCES \`User\`(\`id\`)
        ON DELETE CASCADE
        ON UPDATE CASCADE
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
}

ensurePasswordSetupTable()
  .then(() => {
    console.log("[db] PasswordSetupCode ensured");
  })
  .catch((error) => {
    console.error("[db] Failed to ensure PasswordSetupCode", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });