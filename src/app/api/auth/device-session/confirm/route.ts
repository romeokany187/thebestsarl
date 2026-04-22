import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { confirmDeviceSignInChallenge } from "@/lib/auth-device-session";

const confirmSchema = z.object({
  challengeId: z.string().trim().min(1, "Challenge requis."),
  code: z.string().trim().length(6, "Le code doit contenir 6 chiffres.").regex(/^\d{6}$/, "Le code doit contenir 6 chiffres."),
  deviceToken: z.string().trim().min(16, "Appareil invalide."),
});

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = confirmSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await confirmDeviceSignInChallenge(parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, message: "Nouvel appareil confirmé. La connexion peut continuer." });
}