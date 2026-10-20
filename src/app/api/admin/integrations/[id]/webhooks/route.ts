import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { assertPublicHttpsUrl, formatEventTypes, generateWebhookSecret } from "@/lib/integration-api";

export const dynamic = "force-dynamic";

const webhookSchema = z.object({
  url: z.string().min(1).max(500),
  eventTypes: z.array(z.string().min(1).max(80)).max(20).optional(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const access = await requireApiModuleAccess("admin", ["ADMIN"]);
  if (access.error || !access.session) return access.error;

  const { id } = await context.params;
  const client = await prisma.integrationClient.findUnique({
    where: { id },
    select: { id: true, revokedAt: true },
  });
  if (!client || client.revokedAt) {
    return NextResponse.json({ error: "Application introuvable ou révoquée." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = webhookSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Webhook invalide." }, { status: 400 });
  }

  let url = "";
  let eventTypes = "";
  try {
    url = assertPublicHttpsUrl(parsed.data.url);
    eventTypes = formatEventTypes(parsed.data.eventTypes ?? []);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Webhook invalide." }, { status: 400 });
  }

  const signingSecret = generateWebhookSecret();
  const webhook = await prisma.integrationWebhook.create({
    data: { clientId: client.id, url, signingSecret, eventTypes },
    select: { id: true, url: true, eventTypes: true },
  });

  return NextResponse.json({
    data: {
      ...webhook,
      eventTypes: webhook.eventTypes ? webhook.eventTypes.split(",") : [],
      signingSecret,
    },
  }, { status: 201 });
}
