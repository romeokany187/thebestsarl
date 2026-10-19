import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [unreadCount, latest, urgentAlertCount, latestUrgent] = await Promise.all([
    prisma.userNotification.count({
      where: {
        userId: session.user.id,
        isRead: false,
      },
    }),
    prisma.userNotification.findFirst({
      where: {
        userId: session.user.id,
      },
      select: {
        id: true,
        title: true,
        message: true,
        type: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.userNotification.count({
      where: {
        userId: session.user.id,
        isRead: false,
        type: "UNPAID_TICKET_ALERT",
      },
    }),
    prisma.userNotification.findFirst({
      where: {
        userId: session.user.id,
        isRead: false,
        type: "UNPAID_TICKET_ALERT",
      },
      select: {
        id: true,
        title: true,
        message: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return NextResponse.json({
    unreadCount,
    urgentAlertCount,
    latest: latest
      ? {
          id: latest.id,
          title: latest.title,
          message: latest.message,
          type: latest.type,
          createdAt: latest.createdAt.toISOString(),
        }
      : null,
    latestUrgent: latestUrgent
      ? {
          id: latestUrgent.id,
          title: latestUrgent.title,
          message: latestUrgent.message,
          createdAt: latestUrgent.createdAt.toISOString(),
        }
      : null,
  });
}
