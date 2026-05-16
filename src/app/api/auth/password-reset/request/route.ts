import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isPasswordAuthActive, passwordAuthLaunchAtIso } from "@/lib/auth-rollout";
import { prisma } from "@/lib/prisma";
import { isMailConfigured } from "@/lib/mail";
import {
  ensurePasswordSetupStorage,
  generatePasswordSetupCode,
  hashPasswordSetupCode,
  normalizeAuthEmail,
  passwordResetPurpose,
  passwordSetupExpiryDate,
  passwordSetupMaxRequestsPerWindow,
  passwordSetupRequestCooldownSeconds,
  passwordSetupRequestWindowStart,
  sendPasswordResetCodeEmail,
} from "@/lib/password-setup";

const requestSchema = z.object({
  email: z.string().trim().email("Adresse email invalide."),
});

const genericSuccess = {
  ok: true,
  message: "Si ce compte existe, un code de reinitialisation vient d'etre envoye.",
};

export async function POST(request: NextRequest) {
  if (!isPasswordAuthActive()) {
    return NextResponse.json(
      {
        error: "La reinitialisation de mot de passe n'est pas encore ouverte.",
        launchAt: passwordAuthLaunchAtIso(),
      },
      { status: 403 },
    );
  }

  if (!isMailConfigured()) {
    return NextResponse.json(
      { error: "SMTP non configure. Impossible d'envoyer le code de reinitialisation." },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const email = normalizeAuthEmail(parsed.data.email);
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, passwordHash: true },
  });

  if (!user || !user.passwordHash?.trim()) {
    return NextResponse.json(genericSuccess);
  }

  await ensurePasswordSetupStorage();

  const recentCodes = await prisma.passwordSetupCode.findMany({
    where: {
      userId: user.id,
      purpose: passwordResetPurpose(),
      createdAt: { gte: passwordSetupRequestWindowStart() },
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
    take: passwordSetupMaxRequestsPerWindow(),
  });

  if (recentCodes.length >= passwordSetupMaxRequestsPerWindow()) {
    return NextResponse.json(
      { error: "Trop de demandes de code ont ete effectuees. Reessayez plus tard." },
      { status: 429 },
    );
  }

  const latestCode = recentCodes[0] ?? null;
  if (latestCode) {
    const nextAllowedAt = latestCode.createdAt.getTime() + (passwordSetupRequestCooldownSeconds() * 1000);
    if (Date.now() < nextAllowedAt) {
      const remainingSeconds = Math.max(1, Math.ceil((nextAllowedAt - Date.now()) / 1000));
      return NextResponse.json(
        { error: `Veuillez attendre encore ${remainingSeconds} seconde(s) avant de demander un nouveau code.` },
        { status: 429 },
      );
    }
  }

  const code = generatePasswordSetupCode();
  const codeHash = hashPasswordSetupCode(user.email, code);
  const expiresAt = passwordSetupExpiryDate();

  await prisma.$transaction([
    prisma.passwordSetupCode.updateMany({
      where: {
        userId: user.id,
        purpose: passwordResetPurpose(),
        consumedAt: null,
      },
      data: { consumedAt: new Date() },
    }),
    prisma.passwordSetupCode.create({
      data: {
        userId: user.id,
        email: user.email,
        codeHash,
        purpose: passwordResetPurpose(),
        expiresAt,
      },
    }),
  ]);

  try {
    await sendPasswordResetCodeEmail({
      email: user.email,
      name: user.name,
      code,
    });
  } catch (error) {
    await prisma.passwordSetupCode.updateMany({
      where: {
        userId: user.id,
        purpose: passwordResetPurpose(),
        consumedAt: null,
      },
      data: { consumedAt: new Date() },
    });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erreur lors de l'envoi de l'email de reinitialisation." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ...genericSuccess,
    expiresAt: expiresAt.toISOString(),
  });
}
