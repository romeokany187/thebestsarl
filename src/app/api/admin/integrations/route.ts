import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { generateIntegrationKey, INTEGRATION_SCOPES } from "@/lib/integration-api";
import { writeActivityLog } from "@/lib/activity-log";

export const dynamic = "force-dynamic";

const createClientSchema = z.object({
  name: z.string().trim().min(2).max(80),
});

export async function GET() {
  const access = await requireApiModuleAccess("admin", ["ADMIN"]);
  if (access.error || !access.session) return access.error;

  const [clients, events] = await Promise.all([
    prisma.integrationClient.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        webhooks: {
          select: { id: true, url: true, enabled: true, eventTypes: true, createdAt: true },
          orderBy: { createdAt: "desc" },
        },
        _count: { select: { inboundEvents: true } },
      },
    }),
    prisma.integrationInboundEvent.findMany({
      orderBy: { receivedAt: "desc" },
      take: 20,
      select: {
        id: true,
        eventType: true,
        externalId: true,
        status: true,
        receivedAt: true,
        client: { select: { name: true } },
      },
    }),
  ]);

  return NextResponse.json({
    data: {
      clients: clients.map((client) => ({
        id: client.id,
        name: client.name,
        keyPrefix: client.keyPrefix,
        enabled: client.enabled,
        revokedAt: client.revokedAt?.toISOString() ?? null,
        lastUsedAt: client.lastUsedAt?.toISOString() ?? null,
        createdAt: client.createdAt.toISOString(),
        scopes: client.scopes.split(",").filter(Boolean),
        inboundCount: client._count.inboundEvents,
        webhooks: client.webhooks.map((webhook) => ({
          id: webhook.id,
          url: webhook.url,
          enabled: webhook.enabled,
          eventTypes: webhook.eventTypes ? webhook.eventTypes.split(",") : [],
          createdAt: webhook.createdAt.toISOString(),
        })),
      })),
      events: events.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        externalId: event.externalId,
        status: event.status,
        receivedAt: event.receivedAt.toISOString(),
        clientName: event.client.name,
      })),
    },
  });
}

export async function POST(request: NextRequest) {
  const access = await requireApiModuleAccess("admin", ["ADMIN"]);
  if (access.error || !access.session) return access.error;

  const body = await request.json().catch(() => null);
  const parsed = createClientSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Indiquez un nom d'application (2 à 80 caractères)." }, { status: 400 });
  }

  const key = generateIntegrationKey();
  const client = await prisma.integrationClient.create({
    data: {
      name: parsed.data.name,
      keyPrefix: key.keyPrefix,
      keyHash: key.keyHash,
      scopes: INTEGRATION_SCOPES.join(","),
      createdById: access.session.user.id,
    },
    select: { id: true, name: true, keyPrefix: true },
  });

  await writeActivityLog({
    actorId: access.session.user.id,
    action: "INTEGRATION_CLIENT_CREATED",
    entityType: "IntegrationClient",
    entityId: client.id,
    summary: `Application connectée : ${client.name}`,
  });

  return NextResponse.json({
    data: {
      ...client,
      apiKey: key.token,
    },
  }, { status: 201 });
}
