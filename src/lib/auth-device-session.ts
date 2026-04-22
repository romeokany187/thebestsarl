import { createHash, randomInt, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { sendMailBatch } from "@/lib/mail";
import { normalizeAuthEmail, verifyUserPassword } from "@/lib/password-setup";

const DEVICE_CHALLENGE_TTL_MINUTES = 10;
const DEVICE_CHALLENGE_REQUEST_COOLDOWN_SECONDS = 60;
const DEVICE_CHALLENGE_MAX_REQUESTS_PER_WINDOW = 3;
const DEVICE_CHALLENGE_REQUEST_WINDOW_MINUTES = 15;

type AuthSessionCredentialUser = {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: string;
  jobTitle: string;
  canImportTicketWorkbook: boolean;
  team: { name: string } | null;
};

function authSessionSecret() {
  return process.env.AUTH_SESSION_SECRET?.trim()
    || process.env.NEXTAUTH_SECRET?.trim()
    || process.env.AUTH_SECRET?.trim()
    || "thebest-auth-session";
}

export function normalizeDeviceToken(value?: string | null) {
  return value?.trim() ?? "";
}

export function hashDeviceToken(deviceToken: string) {
  return createHash("sha256")
    .update(`${authSessionSecret()}:device:${deviceToken}`)
    .digest("hex");
}

function hashDeviceChallengeCode(email: string, challengeId: string, code: string) {
  return createHash("sha256")
    .update(`${authSessionSecret()}:challenge:${normalizeAuthEmail(email)}:${challengeId}:${code}`)
    .digest("hex");
}

function generateDeviceChallengeCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function deviceChallengeExpiryDate() {
  return new Date(Date.now() + DEVICE_CHALLENGE_TTL_MINUTES * 60 * 1000);
}

function deviceChallengeWindowStart() {
  return new Date(Date.now() - DEVICE_CHALLENGE_REQUEST_WINDOW_MINUTES * 60 * 1000);
}

export async function ensureAuthSessionSecurityStorage() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \`AuthSessionState\` (
      \`userId\` VARCHAR(191) NOT NULL,
      \`activeSessionKey\` VARCHAR(191) NOT NULL,
      \`activeDeviceTokenHash\` VARCHAR(191) NOT NULL,
      \`lastAuthenticatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`userId\`),
      CONSTRAINT \`AuthSessionState_userId_fkey\`
        FOREIGN KEY (\`userId\`) REFERENCES \`User\`(\`id\`)
        ON DELETE CASCADE
        ON UPDATE CASCADE
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \`AuthDeviceChallenge\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`userId\` VARCHAR(191) NOT NULL,
      \`email\` VARCHAR(191) NOT NULL,
      \`deviceTokenHash\` VARCHAR(191) NOT NULL,
      \`codeHash\` VARCHAR(191) NOT NULL,
      \`expiresAt\` DATETIME(3) NOT NULL,
      \`approvedAt\` DATETIME(3) NULL,
      \`consumedAt\` DATETIME(3) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`AuthDeviceChallenge_userId_createdAt_idx\` (\`userId\`, \`createdAt\`),
      INDEX \`AuthDeviceChallenge_email_createdAt_idx\` (\`email\`, \`createdAt\`),
      INDEX \`AuthDeviceChallenge_expiresAt_idx\` (\`expiresAt\`),
      CONSTRAINT \`AuthDeviceChallenge_userId_fkey\`
        FOREIGN KEY (\`userId\`) REFERENCES \`User\`(\`id\`)
        ON DELETE CASCADE
        ON UPDATE CASCADE
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
}

export async function findCredentialsUser(email: string, password: string) {
  const normalizedEmail = normalizeAuthEmail(email);
  if (!normalizedEmail || !password.trim()) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: {
      id: true,
      name: true,
      email: true,
      passwordHash: true,
      role: true,
      jobTitle: true,
      canImportTicketWorkbook: true,
      team: { select: { name: true } },
    },
  });

  if (!user) {
    return null;
  }

  const isValid = await verifyUserPassword(password, user.passwordHash);
  if (!isValid) {
    return null;
  }

  return user satisfies AuthSessionCredentialUser;
}

export async function requestDeviceSignInChallenge(params: {
  email: string;
  password: string;
  deviceToken: string;
}) {
  await ensureAuthSessionSecurityStorage();

  const user = await findCredentialsUser(params.email, params.password);
  if (!user) {
    return { ok: false as const, status: 401, error: "Connexion refusée. Vérifie ton email et ton mot de passe." };
  }

  const normalizedDeviceToken = normalizeDeviceToken(params.deviceToken);
  if (normalizedDeviceToken.length < 16) {
    return { ok: false as const, status: 400, error: "Appareil non reconnu. Rechargez la page puis recommencez." };
  }

  const deviceTokenHash = hashDeviceToken(normalizedDeviceToken);
  const sessionState = await prisma.authSessionState.findUnique({ where: { userId: user.id } });

  if (!sessionState?.activeSessionKey || sessionState.activeDeviceTokenHash === deviceTokenHash) {
    return { ok: true as const, otpRequired: false as const, user };
  }

  const recentChallenges = await prisma.authDeviceChallenge.findMany({
    where: {
      userId: user.id,
      createdAt: { gte: deviceChallengeWindowStart() },
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
    take: DEVICE_CHALLENGE_MAX_REQUESTS_PER_WINDOW,
  });

  if (recentChallenges.length >= DEVICE_CHALLENGE_MAX_REQUESTS_PER_WINDOW) {
    return { ok: false as const, status: 429, error: "Trop de demandes OTP ont été effectuées. Réessayez plus tard." };
  }

  const latestChallenge = recentChallenges[0] ?? null;
  if (latestChallenge) {
    const nextAllowedAt = latestChallenge.createdAt.getTime() + (DEVICE_CHALLENGE_REQUEST_COOLDOWN_SECONDS * 1000);
    if (Date.now() < nextAllowedAt) {
      const remainingSeconds = Math.max(1, Math.ceil((nextAllowedAt - Date.now()) / 1000));
      return {
        ok: false as const,
        status: 429,
        error: `Veuillez attendre encore ${remainingSeconds} seconde(s) avant de demander un nouveau code.`,
      };
    }
  }

  const challengeId = randomUUID();
  const code = generateDeviceChallengeCode();
  const codeHash = hashDeviceChallengeCode(user.email, challengeId, code);
  const expiresAt = deviceChallengeExpiryDate();

  await prisma.$transaction([
    prisma.authDeviceChallenge.updateMany({
      where: {
        userId: user.id,
        consumedAt: null,
      },
      data: { consumedAt: new Date() },
    }),
    prisma.authDeviceChallenge.create({
      data: {
        id: challengeId,
        userId: user.id,
        email: user.email,
        deviceTokenHash,
        codeHash,
        expiresAt,
      },
    }),
  ]);

  await sendMailBatch({
    recipients: [{ email: user.email, name: user.name }],
    subject: "Code OTP - connexion sur un nouvel appareil",
    text: [
      `Bonjour ${user.name},`,
      "",
      `Un nouvel appareil tente de se connecter a votre espace THEBEST SARL.`,
      `Code OTP: ${code}`,
      "",
      `Ce code expire dans ${DEVICE_CHALLENGE_TTL_MINUTES} minutes.`,
      "Si ce n'est pas vous, ignorez cet email. La nouvelle connexion ne sera pas validee.",
    ].join("\n"),
    html: `
      <p>Bonjour ${user.name},</p>
      <p>Un nouvel appareil tente de se connecter a votre espace THEBEST SARL.</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:0.28em;margin:16px 0;">${code}</p>
      <p>Ce code expire dans <strong>${DEVICE_CHALLENGE_TTL_MINUTES} minutes</strong>.</p>
      <p>Si ce n'est pas vous, ignorez cet email. La nouvelle connexion ne sera pas validee.</p>
    `,
  });

  return {
    ok: true as const,
    otpRequired: true as const,
    challengeId,
    message: "Un code OTP a ete envoye par email pour autoriser ce nouvel appareil.",
    expiresAt: expiresAt.toISOString(),
  };
}

export async function confirmDeviceSignInChallenge(params: {
  challengeId: string;
  code: string;
  deviceToken: string;
}) {
  await ensureAuthSessionSecurityStorage();

  const challengeId = params.challengeId.trim();
  const code = params.code.trim();
  const deviceToken = normalizeDeviceToken(params.deviceToken);
  if (!challengeId || !/^\d{6}$/.test(code) || deviceToken.length < 16) {
    return { ok: false as const, status: 400, error: "Code OTP ou appareil invalide." };
  }

  const challenge = await prisma.authDeviceChallenge.findUnique({
    where: { id: challengeId },
    include: {
      user: {
        select: {
          id: true,
          email: true,
        },
      },
    },
  });

  if (!challenge || challenge.consumedAt || challenge.expiresAt <= new Date()) {
    return { ok: false as const, status: 400, error: "Code OTP invalide ou expire." };
  }

  if (challenge.deviceTokenHash !== hashDeviceToken(deviceToken)) {
    return { ok: false as const, status: 400, error: "Ce code OTP ne correspond pas a cet appareil." };
  }

  const expectedCodeHash = hashDeviceChallengeCode(challenge.user.email, challenge.id, code);
  if (challenge.codeHash !== expectedCodeHash) {
    return { ok: false as const, status: 400, error: "Code OTP invalide ou expire." };
  }

  await prisma.authDeviceChallenge.update({
    where: { id: challenge.id },
    data: { approvedAt: new Date() },
  });

  return { ok: true as const };
}

export async function validateApprovedDeviceChallenge(params: {
  userId: string;
  challengeId?: string | null;
  deviceToken: string;
}) {
  const challengeId = params.challengeId?.trim();
  if (!challengeId) {
    return false;
  }

  const normalizedDeviceToken = normalizeDeviceToken(params.deviceToken);
  if (normalizedDeviceToken.length < 16) {
    return false;
  }

  const challenge = await prisma.authDeviceChallenge.findFirst({
    where: {
      id: challengeId,
      userId: params.userId,
      deviceTokenHash: hashDeviceToken(normalizedDeviceToken),
      approvedAt: { not: null },
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });

  return Boolean(challenge);
}

export async function activateSingleUserSession(params: {
  userId: string;
  deviceToken: string;
  challengeId?: string | null;
}) {
  await ensureAuthSessionSecurityStorage();

  const deviceTokenHash = hashDeviceToken(normalizeDeviceToken(params.deviceToken));
  const sessionKey = randomUUID();

  await prisma.$transaction(async (tx) => {
    await tx.authSessionState.upsert({
      where: { userId: params.userId },
      create: {
        userId: params.userId,
        activeSessionKey: sessionKey,
        activeDeviceTokenHash: deviceTokenHash,
        lastAuthenticatedAt: new Date(),
      },
      update: {
        activeSessionKey: sessionKey,
        activeDeviceTokenHash: deviceTokenHash,
        lastAuthenticatedAt: new Date(),
      },
    });

    if (params.challengeId?.trim()) {
      await tx.authDeviceChallenge.updateMany({
        where: {
          id: params.challengeId.trim(),
          userId: params.userId,
          consumedAt: null,
        },
        data: { consumedAt: new Date() },
      });
    }
  });

  return sessionKey;
}