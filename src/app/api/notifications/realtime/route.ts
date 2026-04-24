import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [unreadCount, latest, urgentAlertCount] = await Promise.all([
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
  ]);

  return NextResponse.json({
    unreadCount,
    urgentAlertCount,
    latest: latest
      ? {
          id: latest.id,
          title: latest.title,
          message: latest.message,
          createdAt: latest.createdAt.toISOString(),
        }
      : null,
  });
}
