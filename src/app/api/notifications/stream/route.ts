import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { prisma } from "@/lib/prisma";

type StreamPayload = {
  unreadCount: number;
  latest: {
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

      const sendEvent = (payload: StreamPayload) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      const sendHeartbeat = () => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: heartbeat\ndata: ping\n\n`));
      };

      const queryPayload = async (): Promise<StreamPayload> => {
        const [unreadCount, latest] = await Promise.all([
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
              createdAt: true,
            },
            orderBy: { createdAt: "desc" },
          }),
        ]);

        return {
          unreadCount,
          latest: latest
            ? {
                id: latest.id,
                title: latest.title,
                message: latest.message,
                createdAt: latest.createdAt.toISOString(),
              }
            : null,
        };
      };

      const pushIfChanged = async () => {
        if (closed) return;

        try {
          const payload = await queryPayload();
          const latestId = payload.latest?.id ?? null;

          if (payload.unreadCount !== previousUnread || latestId !== previousLatestId) {
            previousUnread = payload.unreadCount;
            previousLatestId = latestId;
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
