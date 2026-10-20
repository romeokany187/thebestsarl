import { NextResponse } from "next/server";
import { authenticateIntegrationRequest } from "@/lib/integration-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await authenticateIntegrationRequest(request);
  if (access.error || !access.client) return access.error;

  return NextResponse.json({
    service: "thebestsarl",
    version: "v1",
    client: {
      id: access.client.id,
      name: access.client.name,
    },
    scopes: access.scopes,
    resources: [],
    endpoints: {
      discovery: "GET /api/integration/v1",
      events: "POST /api/integration/v1/events",
      eventsList: "GET /api/integration/v1/events",
      webhooks: "POST /api/integration/v1/webhooks",
      webhooksList: "GET /api/integration/v1/webhooks",
    },
    note: "Aucune donnée métier n'est ouverte. Les échanges passent par une enveloppe d'événement jusqu'à ce que les ressources soient choisies.",
  });
}
