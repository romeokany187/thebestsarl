import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { writeActivityLog } from "@/lib/activity-log";

export const dynamic = "force-dynamic";

export async function DELETE(
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
  if (!client) {
    return NextResponse.json({ error: "Application introuvable." }, { status: 404 });
  }
  if (client.revokedAt) {
    return NextResponse.json({ ok: true });
  }

  await prisma.integrationClient.update({
    where: { id: client.id },
    data: { enabled: false, revokedAt: new Date() },
  });

  await writeActivityLog({
    actorId: access.session.user.id,
    action: "INTEGRATION_CLIENT_REVOKED",
    entityType: "IntegrationClient",
    entityId: client.id,
    summary: `Clé révoquée : ${client.name}`,
  });

  return NextResponse.json({ ok: true });
}
