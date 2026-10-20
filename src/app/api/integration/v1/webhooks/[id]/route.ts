import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateIntegrationRequest, requireIntegrationScope } from "@/lib/integration-api";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const access = await authenticateIntegrationRequest(request);
  if (access.error || !access.client) return access.error;
  const denied = requireIntegrationScope(access.scopes, "webhooks:write");
  if (denied) return denied;

  const { id } = await context.params;
  const webhook = await prisma.integrationWebhook.findFirst({
    where: { id, clientId: access.client.id },
    select: { id: true },
  });
  if (!webhook) {
    return NextResponse.json({ error: "Webhook introuvable." }, { status: 404 });
  }

  await prisma.integrationWebhook.delete({ where: { id: webhook.id } });
  return NextResponse.json({ ok: true });
}
