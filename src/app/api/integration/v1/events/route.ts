import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  assertIntegrationEventType,
  assertIntegrationPayload,
  authenticateIntegrationRequest,
  requireIntegrationScope,
} from "@/lib/integration-api";

export const dynamic = "force-dynamic";

const inboundEventSchema = z.object({
  type: z.string().min(1).max(80),
  externalId: z.string().trim().min(1).max(120).optional(),
  payload: z.unknown().optional(),
});

export async function GET(request: Request) {
  const access = await authenticateIntegrationRequest(request);
  if (access.error || !access.client) return access.error;
  const denied = requireIntegrationScope(access.scopes, "events:read");
  if (denied) return denied;

  const events = await prisma.integrationInboundEvent.findMany({
    where: { clientId: access.client.id },
    orderBy: { receivedAt: "desc" },
    take: 50,
    select: {
      id: true,
      eventType: true,
      externalId: true,
      status: true,
      receivedAt: true,
      payload: true,
    },
  });

  return NextResponse.json({
    data: events.map((event) => ({
      ...event,
      receivedAt: event.receivedAt.toISOString(),
    })),
  });
}

export async function POST(request: Request) {
  const access = await authenticateIntegrationRequest(request);
  if (access.error || !access.client) return access.error;
  const denied = requireIntegrationScope(access.scopes, "events:write");
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = inboundEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enveloppe invalide. Attendu : type, externalId optionnel, payload objet." }, { status: 400 });
  }

  let eventType = "";
  let payload: ReturnType<typeof assertIntegrationPayload>;
  try {
    eventType = assertIntegrationEventType(parsed.data.type);
    payload = assertIntegrationPayload(parsed.data.payload ?? {});
  } catch (error) {
    const message = error instanceof Error ? error.message : "Enveloppe invalide.";
    const status = message.includes("taille") ? 413 : 400;
    return NextResponse.json({ error: message }, { status });
  }

  if (parsed.data.externalId) {
    const existing = await prisma.integrationInboundEvent.findUnique({
      where: {
        clientId_externalId: {
          clientId: access.client.id,
          externalId: parsed.data.externalId,
        },
      },
      select: { id: true, eventType: true, status: true, receivedAt: true },
    });
    if (existing) {
      return NextResponse.json({
        duplicate: true,
        data: { ...existing, receivedAt: existing.receivedAt.toISOString() },
      });
    }
  }

  const created = await prisma.integrationInboundEvent.create({
    data: {
      clientId: access.client.id,
      eventType,
      externalId: parsed.data.externalId,
      payload,
    },
    select: { id: true, eventType: true, externalId: true, status: true, receivedAt: true },
  });

  return NextResponse.json({
    data: { ...created, receivedAt: created.receivedAt.toISOString() },
  }, { status: 201 });
}
