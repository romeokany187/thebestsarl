import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const INTEGRATION_SCOPES = ["events:read", "events:write", "webhooks:read", "webhooks:write"] as const;
export const INTEGRATION_EVENT_TYPE = /^[a-z][a-z0-9._-]{0,79}$/;
const MAX_PAYLOAD_CHARS = 32_768;

export function hashIntegrationSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function generateIntegrationKey() {
  const token = `tb_live_${randomBytes(32).toString("base64url")}`;
  return {
    token,
    keyPrefix: token.slice(0, 20),
    keyHash: hashIntegrationSecret(token),
  };
}

export function generateWebhookSecret() {
  return `tb_whsec_${randomBytes(24).toString("base64url")}`;
}

export function parseScopes(value: string) {
  return value.split(",").map((scope) => scope.trim()).filter(Boolean);
}

function secretsMatch(storedHash: string, token: string) {
  const left = Buffer.from(storedHash);
  const right = Buffer.from(hashIntegrationSecret(token));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function authenticateIntegrationRequest(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const apiKeyHeader = request.headers.get("x-api-key") ?? "";
  const token = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : apiKeyHeader.trim();

  if (!token.startsWith("tb_live_") || token.length < 24) {
    return {
      error: NextResponse.json({ error: "Clé API manquante ou invalide." }, { status: 401 }),
      client: null,
      scopes: [] as string[],
    };
  }

  const client = await prisma.integrationClient.findUnique({
    where: { keyPrefix: token.slice(0, 20) },
  });

  if (!client || !client.enabled || client.revokedAt || !secretsMatch(client.keyHash, token)) {
    return {
      error: NextResponse.json({ error: "Clé API refusée." }, { status: 401 }),
      client: null,
      scopes: [] as string[],
    };
  }

  void prisma.integrationClient.update({
    where: { id: client.id },
    data: { lastUsedAt: new Date() },
  }).catch(() => undefined);

  return {
    error: null,
    client,
    scopes: parseScopes(client.scopes),
  };
}

export function requireIntegrationScope(scopes: string[], scope: string) {
  if (scopes.includes(scope)) return null;
  return NextResponse.json({ error: `Droit manquant : ${scope}.` }, { status: 403 });
}

export function assertIntegrationEventType(value: string) {
  const type = value.trim();
  if (!INTEGRATION_EVENT_TYPE.test(type)) {
    throw new Error("Le type d'événement doit commencer par une lettre et ne contenir que a-z, 0-9, point, tiret ou underscore.");
  }
  return type;
}

export function assertIntegrationPayload(payload: unknown) {
  const body = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  const serialized = JSON.stringify(body);
  if (serialized.length > MAX_PAYLOAD_CHARS) {
    throw new Error("Le contenu dépasse la taille autorisée.");
  }
  return body as Prisma.InputJsonValue;
}

export function assertPublicHttpsUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("URL invalide.");
  }

  if (url.protocol !== "https:") {
    throw new Error("L'URL du webhook doit commencer par https://.");
  }
  if (url.username || url.password) {
    throw new Error("L'URL du webhook ne doit pas contenir d'identifiants.");
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const privateHost = host === "localhost"
    || host.endsWith(".local")
    || host === "0.0.0.0"
    || host === "::1"
    || host === "169.254.169.254"
    || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|169\.254\.)/.test(host);

  if (privateHost) {
    throw new Error("Cette adresse n'est pas autorisée pour un webhook.");
  }

  return url.toString();
}

export function formatEventTypes(types: string[]) {
  return types.map((type) => assertIntegrationEventType(type)).join(",");
}

function webhookAccepts(eventTypes: string, eventType: string) {
  const allowed = eventTypes.split(",").map((type) => type.trim()).filter(Boolean);
  return allowed.length === 0 || allowed.includes(eventType);
}

export function signIntegrationBody(secret: string, body: string) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/** Envoie un événement vers les applications connectées. Le contenu reste libre tant que les données métier ne sont pas ouvertes. */
export async function emitIntegrationEvent(eventType: string, payload: unknown = {}) {
  const type = assertIntegrationEventType(eventType);
  const body = assertIntegrationPayload(payload);
  const event = await prisma.integrationOutboundEvent.create({
    data: {
      eventType: type,
      payload: body,
    },
  });

  const deliveries = await deliverOutboundEvent(event.id);
  return { event, deliveries };
}

export async function deliverOutboundEvent(outboundEventId: string) {
  const event = await prisma.integrationOutboundEvent.findUnique({
    where: { id: outboundEventId },
  });
  if (!event) return [];

  const webhooks = await prisma.integrationWebhook.findMany({
    where: {
      enabled: true,
      client: { enabled: true, revokedAt: null },
    },
  });

  const envelope = {
    id: event.id,
    type: event.eventType,
    createdAt: event.createdAt.toISOString(),
    payload: event.payload,
  };
  const rawBody = JSON.stringify(envelope);
  const results: Array<{ webhookId: string; status: string; responseStatus: number | null; errorMessage: string | null }> = [];

  for (const webhook of webhooks) {
    if (!webhookAccepts(webhook.eventTypes, event.eventType)) continue;

    let status = "FAILED";
    let responseStatus: number | null = null;
    let errorMessage: string | null = null;

    try {
      const response = await fetch(webhook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Thebest-Event": event.eventType,
          "X-Thebest-Delivery": event.id,
          "X-Thebest-Signature": signIntegrationBody(webhook.signingSecret, rawBody),
        },
        body: rawBody,
        redirect: "error",
        signal: AbortSignal.timeout(8_000),
      });
      responseStatus = response.status;
      status = response.ok ? "DELIVERED" : "FAILED";
      if (!response.ok) {
        errorMessage = `HTTP ${response.status}`;
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message.slice(0, 500) : "Echec d'envoi.";
    }

    await prisma.integrationWebhookDelivery.create({
      data: {
        outboundEventId: event.id,
        webhookId: webhook.id,
        status,
        responseStatus,
        errorMessage,
      },
    });
    results.push({ webhookId: webhook.id, status, responseStatus, errorMessage });
  }

  return results;
}
