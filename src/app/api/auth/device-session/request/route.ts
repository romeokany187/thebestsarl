import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isMailConfigured } from "@/lib/mail";
import { requestDeviceSignInChallenge } from "@/lib/auth-device-session";

const requestSchema = z.object({
  email: z.string().trim().email("Adresse email invalide."),
  password: z.string().min(1, "Mot de passe requis."),
  deviceToken: z.string().trim().min(16, "Appareil invalide."),
});

export async function POST(request: NextRequest) {
  if (!isMailConfigured()) {
    return NextResponse.json({ error: "SMTP non configuré. Impossible d'envoyer le code OTP." }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  let result;
  try {
    result = await requestDeviceSignInChallenge(parsed.data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erreur lors de l'envoi du code OTP." },
      { status: 500 },
    );
  }

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  if (!result.otpRequired) {
    return NextResponse.json({ ok: true, otpRequired: false });
  }

  return NextResponse.json({
    ok: true,
    otpRequired: true,
    challengeId: result.challengeId,
    message: result.message,
    expiresAt: result.expiresAt,
  });
}