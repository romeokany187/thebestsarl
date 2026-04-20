import { createHash, randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { sendMailBatch } from "@/lib/mail";
import { prisma } from "@/lib/prisma";

const PASSWORD_SETUP_PURPOSE = "PASSWORD_SETUP";
const PASSWORD_SETUP_CODE_TTL_MINUTES = 15;
const PASSWORD_SETUP_REQUEST_COOLDOWN_SECONDS = 60;
const PASSWORD_SETUP_MAX_REQUESTS_PER_WINDOW = 3;
const PASSWORD_SETUP_REQUEST_WINDOW_MINUTES = 15;

export function normalizeAuthEmail(value?: string | null) {
  return value?.trim().toLowerCase() ?? "";
}

function otpSecret() {
  return process.env.PASSWORD_SETUP_SECRET?.trim()
    || process.env.NEXTAUTH_SECRET?.trim()
    || "thebest-password-setup";
}

export function hashPasswordSetupCode(email: string, code: string) {
  return createHash("sha256")
    .update(`${otpSecret()}:${normalizeAuthEmail(email)}:${code}`)
    .digest("hex");
}

export function generatePasswordSetupCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function passwordSetupExpiryDate() {
  return new Date(Date.now() + PASSWORD_SETUP_CODE_TTL_MINUTES * 60 * 1000);
}

export function passwordSetupPurpose() {
  return PASSWORD_SETUP_PURPOSE;
}

export function passwordSetupRequestCooldownSeconds() {
  return PASSWORD_SETUP_REQUEST_COOLDOWN_SECONDS;
}

export function passwordSetupMaxRequestsPerWindow() {
  return PASSWORD_SETUP_MAX_REQUESTS_PER_WINDOW;
}

export function passwordSetupRequestWindowStart() {
  return new Date(Date.now() - PASSWORD_SETUP_REQUEST_WINDOW_MINUTES * 60 * 1000);
}

export async function ensurePasswordSetupStorage() {
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

export async function hashUserPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyUserPassword(password: string, passwordHash: string | null | undefined) {
  if (!passwordHash?.trim()) return false;
  return bcrypt.compare(password, passwordHash);
}

export async function sendPasswordSetupCodeEmail(params: {
  email: string;
  name?: string | null;
  code: string;
}) {
  const recipientName = params.name?.trim() || "Utilisateur";
  const expiresIn = `${PASSWORD_SETUP_CODE_TTL_MINUTES} minutes`;

  return sendMailBatch({
    recipients: [{ email: params.email, name: recipientName }],
    subject: "Code de confirmation - création de mot de passe",
    text: [
      `Bonjour ${recipientName},`,
      "",
      `Votre code de confirmation THEBEST SARL est : ${params.code}`,
      "",
      `Ce code est à usage unique et expire dans ${expiresIn}.`,
      "Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email.",
    ].join("\n"),
    html: `
      <p>Bonjour ${recipientName},</p>
      <p>Votre code de confirmation THEBEST SARL est :</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:0.28em;margin:16px 0;">${params.code}</p>
      <p>Ce code est à usage unique et expire dans <strong>${expiresIn}</strong>.</p>
      <p>Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email.</p>
    `,
  });
}