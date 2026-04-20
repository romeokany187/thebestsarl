import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isPasswordAuthActive, passwordAuthLaunchAtIso } from "@/lib/auth-rollout";
import { prisma } from "@/lib/prisma";
import {
  hashPasswordSetupCode,
  hashUserPassword,
  normalizeAuthEmail,
  passwordSetupPurpose,
} from "@/lib/password-setup";

const confirmSchema = z.object({
  email: z.string().trim().email("Adresse email invalide."),
  code: z.string().trim().length(6, "Le code doit contenir 6 chiffres.").regex(/^\d{6}$/, "Le code doit contenir 6 chiffres."),
  password: z.string().min(8, "Le mot de passe doit contenir au moins 8 caractères.").max(100)
    .regex(/[A-Za-z]/, "Le mot de passe doit contenir au moins une lettre.")
    .regex(/\d/, "Le mot de passe doit contenir au moins un chiffre."),
  passwordConfirmation: z.string().min(8).max(100),
}).superRefine((value, ctx) => {
  if (value.password !== value.passwordConfirmation) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "La confirmation du mot de passe ne correspond pas.",
      path: ["passwordConfirmation"],
    });
  }
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

  const body = await request.json().catch(() => null);
  const parsed = confirmSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const email = normalizeAuthEmail(parsed.data.email);
  const codeHash = hashPasswordSetupCode(email, parsed.data.code);

  const setupCode = await prisma.passwordSetupCode.findFirst({
    where: {
      email,
      codeHash,
      purpose: passwordSetupPurpose(),
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          passwordHash: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!setupCode) {
    return NextResponse.json({ error: "Code invalide ou expiré." }, { status: 400 });
  }

  if (setupCode.user.passwordHash?.trim()) {
    await prisma.passwordSetupCode.update({
      where: { id: setupCode.id },
      data: { consumedAt: new Date() },
    });

    return NextResponse.json(
      { error: "Le mot de passe de ce compte est déjà configuré. Connectez-vous avec votre email et votre mot de passe." },
      { status: 409 },
    );
  }

  const passwordHash = await hashUserPassword(parsed.data.password);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: setupCode.userId },
      data: { passwordHash },
    }),
    prisma.passwordSetupCode.update({
      where: { id: setupCode.id },
      data: { consumedAt: new Date() },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    message: "Mot de passe créé avec succès.",
    email: setupCode.user.email,
  });
}