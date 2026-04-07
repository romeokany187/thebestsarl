import { Prisma } from "@prisma/client";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";

type ActivityLogInput = {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  payload?: Prisma.InputJsonValue;
};

export async function writeActivityLog(input: ActivityLogInput) {
  if (!input.actorId) return;

  try {
    const requestHeaders = await headers();

    await prisma.auditLog.create({
      data: {
        actorId: input.actorId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId?.trim() || "GLOBAL",
        payload: {
          request: {
            referer: requestHeaders.get("referer"),
            pathHint: requestHeaders.get("next-url") ?? requestHeaders.get("x-matched-path") ?? requestHeaders.get("x-invoke-path"),
            host: requestHeaders.get("host"),
            userAgent: requestHeaders.get("user-agent"),
            forwardedFor: requestHeaders.get("x-forwarded-for"),
          },
          details: input.payload ?? null,
        } as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    console.error("[activity-log.write] unable to persist activity log", error);
  }
}
