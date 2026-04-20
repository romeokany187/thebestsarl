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
  passwordSetupExpiryDate,
  passwordSetupMaxRequestsPerWindow,
  passwordSetupPurpose,
  passwordSetupRequestCooldownSeconds,
  passwordSetupRequestWindowStart,
  sendPasswordSetupCodeEmail,
} from "@/lib/password-setup";

const requestSchema = z.object({
  email: z.string().trim().email("Adresse email invalide."),
});

export async function POST(request: NextRequest) {
  if (!isPasswordAuthActive()) {
    return NextResponse.json(
      {
        error: "La création des mots de passe n'est pas encore ouverte.",
        launchAt: passwordAuthLaunchAtIso(),
      },
      { status: 403 },
    );
  }

  if (!isMailConfigured()) {
    return NextResponse.json(
      { error: "SMTP non configuré. Impossible d'envoyer le code de confirmation." },
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

  if (!user) {
    return NextResponse.json({ ok: true, message: "Si ce compte existe, un code vient d'être envoyé." });
  }

  if (user.passwordHash?.trim()) {
    return NextResponse.json(
      { error: "Le mot de passe est déjà configuré pour ce compte. Connectez-vous directement avec votre email et votre mot de passe." },
      { status: 409 },
    );
  }

  await ensurePasswordSetupStorage();

  const recentCodes = await prisma.passwordSetupCode.findMany({
    where: {
      userId: user.id,
      purpose: passwordSetupPurpose(),
      createdAt: { gte: passwordSetupRequestWindowStart() },
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
    take: passwordSetupMaxRequestsPerWindow(),
  });

  if (recentCodes.length >= passwordSetupMaxRequestsPerWindow()) {
    return NextResponse.json(
      {
        error: `Trop de demandes de code ont été effectuées. Réessayez plus tard.`,
      },
      { status: 429 },
    );
  }

  const latestCode = recentCodes[0] ?? null;
  if (latestCode) {
    const nextAllowedAt = latestCode.createdAt.getTime() + (passwordSetupRequestCooldownSeconds() * 1000);
    if (Date.now() < nextAllowedAt) {
      const remainingSeconds = Math.max(1, Math.ceil((nextAllowedAt - Date.now()) / 1000));
      return NextResponse.json(
        {
          error: `Veuillez attendre encore ${remainingSeconds} seconde(s) avant de demander un nouveau code.`,
        },
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
        purpose: passwordSetupPurpose(),
        consumedAt: null,
      },
      data: {
        consumedAt: new Date(),
      },
    }),
    prisma.passwordSetupCode.create({
      data: {
        userId: user.id,
        email: user.email,
        codeHash,
        purpose: passwordSetupPurpose(),
        expiresAt,
      },
    }),
  ]);

  try {
    await sendPasswordSetupCodeEmail({
      email: user.email,
      name: user.name,
      code,
    });
  } catch (error) {
    await prisma.passwordSetupCode.updateMany({
      where: {
        userId: user.id,
        purpose: passwordSetupPurpose(),
        consumedAt: null,
      },
      data: {
        consumedAt: new Date(),
      },
    });

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Erreur lors de l'envoi de l'email de confirmation.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    message: "Un code de confirmation a été envoyé par email.",
    expiresAt: expiresAt.toISOString(),
  });
}