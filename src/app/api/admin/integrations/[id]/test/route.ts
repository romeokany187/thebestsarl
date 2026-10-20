import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { emitIntegrationEvent } from "@/lib/integration-api";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const access = await requireApiModuleAccess("admin", ["ADMIN"]);
  if (access.error || !access.session) return access.error;

  const { id } = await context.params;
  const client = await prisma.integrationClient.findUnique({
    where: { id },
    select: { id: true, name: true, revokedAt: true },
  });
  if (!client || client.revokedAt) {
    return NextResponse.json({ error: "Application introuvable ou révoquée." }, { status: 404 });
  }

  const result = await emitIntegrationEvent("integration.ping", {
    clientId: client.id,
    clientName: client.name,
    sentAt: new Date().toISOString(),
  });

  return NextResponse.json({
    data: {
      eventId: result.event.id,
      deliveries: result.deliveries,
    },
  });
}
