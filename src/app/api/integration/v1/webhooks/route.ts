import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  assertPublicHttpsUrl,
  authenticateIntegrationRequest,
  formatEventTypes,
  generateWebhookSecret,
  requireIntegrationScope,
} from "@/lib/integration-api";

export const dynamic = "force-dynamic";

const webhookSchema = z.object({
  url: z.string().min(1).max(500),
  eventTypes: z.array(z.string().min(1).max(80)).max(20).optional(),
});

export async function GET(request: Request) {
  const access = await authenticateIntegrationRequest(request);
  if (access.error || !access.client) return access.error;
  const denied = requireIntegrationScope(access.scopes, "webhooks:read");
  if (denied) return denied;

  const webhooks = await prisma.integrationWebhook.findMany({
    where: { clientId: access.client.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, url: true, eventTypes: true, enabled: true, createdAt: true },
  });

  return NextResponse.json({
    data: webhooks.map((webhook) => ({
      ...webhook,
      eventTypes: webhook.eventTypes ? webhook.eventTypes.split(",") : [],
      createdAt: webhook.createdAt.toISOString(),
    })),
  });
}

export async function POST(request: Request) {
  const access = await authenticateIntegrationRequest(request);
  if (access.error || !access.client) return access.error;
  const denied = requireIntegrationScope(access.scopes, "webhooks:write");
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = webhookSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Webhook invalide. Attendu : url https, eventTypes optionnel." }, { status: 400 });
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
    data: {
      clientId: access.client.id,
      url,
      signingSecret,
      eventTypes,
    },
    select: { id: true, url: true, eventTypes: true, enabled: true, createdAt: true },
  });

  return NextResponse.json({
    data: {
      ...webhook,
      eventTypes: webhook.eventTypes ? webhook.eventTypes.split(",") : [],
      createdAt: webhook.createdAt.toISOString(),
      signingSecret,
    },
  }, { status: 201 });
}
