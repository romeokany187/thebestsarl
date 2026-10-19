import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { prisma } from "@/lib/prisma";

type StreamPayload = {
  unreadCount: number;
  urgentAlertCount: number;
  latest: {
    id: string;
    title: string;
    message: string;
    type: string;
    createdAt: string;
  } | null;
  latestUrgent: {
    id: string;
    title: string;
    message: string;
    createdAt: string;
  } | null;
};

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userId = session.user.id;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let previousUnread = -1;
      let previousLatestId: string | null = null;
      let previousUrgentId: string | null = null;

      const sendEvent = (payload: StreamPayload) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      const sendHeartbeat = () => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: heartbeat\ndata: ping\n\n`));
      };

      const queryPayload = async (): Promise<StreamPayload> => {
        const [unreadCount, latest, urgentAlertCount, latestUrgent] = await Promise.all([
          prisma.userNotification.count({
            where: {
              userId,
              isRead: false,
            },
          }),
          prisma.userNotification.findFirst({
            where: { userId },
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
              userId,
              isRead: false,
              type: "UNPAID_TICKET_ALERT",
            },
          }),
          prisma.userNotification.findFirst({
            where: {
              userId,
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

        return {
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
        };
      };

      const pushIfChanged = async () => {
        if (closed) return;

        try {
          const payload = await queryPayload();
          const latestId = payload.latest?.id ?? null;
          const urgentId = payload.latestUrgent?.id ?? null;

          if (payload.unreadCount !== previousUnread || latestId !== previousLatestId || urgentId !== previousUrgentId) {
            previousUnread = payload.unreadCount;
            previousLatestId = latestId;
            previousUrgentId = urgentId;
            sendEvent(payload);
          } else {
            sendHeartbeat();
          }
        } catch {
          sendHeartbeat();
        }
      };

      await pushIfChanged();

      const interval = setInterval(() => {
        void pushIfChanged();
      }, 3000);

      const closeStream = () => {
        if (closed) return;
        closed = true;
        clearInterval(interval);
        try {
          controller.close();
        } catch {
          // Controller may already be closed.
        }
      };

      request.signal.addEventListener("abort", closeStream);
    },
    cancel() {
      // Connection closed by client.
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
