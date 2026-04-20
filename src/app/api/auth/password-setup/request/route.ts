import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isPasswordAuthActive, passwordAuthLaunchAtIso } from "@/lib/auth-rollout";
import { prisma } from "@/lib/prisma";
import { isMailConfigured } from "@/lib/mail";
import {
  generatePasswordSetupCode,
  hashPasswordSetupCode,
  normalizeAuthEmail,
  passwordSetupExpiryDate,
  passwordSetupPurpose,
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
    select: { id: true, name: true, email: true },
  });

  if (!user) {
    return NextResponse.json({ ok: true, message: "Si ce compte existe, un code vient d'être envoyé." });
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