"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type RealtimePayload = {
  unreadCount: number;
  urgentAlertCount?: number;
  latest: {
    id: string;
    title: string;
    message: string;
    type?: string;
    createdAt: string;
  } | null;
  latestUrgent?: {
    id: string;
    title: string;
    message: string;
    createdAt: string;
  } | null;
};

function showUrgentAlert(id: string, urgentAlertCount: number) {
  window.dispatchEvent(new CustomEvent("urgent-alert:show", {
    detail: { id, urgentAlertCount },
  }));
}

export function InboxRealtimeLink({
  initialUnreadCount,
  initialLatestNotificationId,
  initialLatestUrgentId = null,
}: {
  initialUnreadCount: number;
  initialLatestNotificationId: string | null;
  initialLatestUrgentId?: string | null;
}) {
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [latestId, setLatestId] = useState<string | null>(initialLatestNotificationId);
  const [toast, setToast] = useState<{ title: string; message: string } | null>(null);
  const pollingRef = useRef<number | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const latestIdRef = useRef<string | null>(initialLatestNotificationId);
  const latestUrgentIdRef = useRef<string | null>(initialLatestUrgentId);
  const unreadCountRef = useRef(initialUnreadCount);

  useEffect(() => {
    const askNotificationPermission = () => {
      if ("Notification" in window && Notification.permission === "default") {
        void Notification.requestPermission();
      }
    };
    window.addEventListener("pointerdown", askNotificationPermission, { once: true });
    window.addEventListener("touchstart", askNotificationPermission, { once: true });
    window.addEventListener("click", askNotificationPermission, { once: true });
    window.addEventListener("keydown", askNotificationPermission, { once: true });

    return () => {
      window.removeEventListener("pointerdown", askNotificationPermission);
      window.removeEventListener("touchstart", askNotificationPermission);
      window.removeEventListener("click", askNotificationPermission);
      window.removeEventListener("keydown", askNotificationPermission);
    };
  }, []);

  useEffect(() => {
    latestIdRef.current = latestId;
  }, [latestId]);

  useEffect(() => {
    unreadCountRef.current = unreadCount;
  }, [unreadCount]);

  useEffect(() => {
    function applyPayload(payload: RealtimePayload) {
      const hasNewNotification = payload.latest?.id && payload.latest.id !== latestIdRef.current;
      const countIncreased = payload.unreadCount > unreadCountRef.current;
      const urgentId = payload.latestUrgent?.id ?? null;
      const hasNewUrgent = Boolean(urgentId && urgentId !== latestUrgentIdRef.current);
      if (urgentId) latestUrgentIdRef.current = urgentId;

      setUnreadCount(payload.unreadCount);

      if (payload.latest?.id) {
        setLatestId(payload.latest.id);
      }

      if (hasNewNotification || countIncreased) {
        if (payload.latest) {
          setToast({
            title: payload.latest.title,
            message: payload.latest.message,
          });
          window.setTimeout(() => setToast(null), 5000);

          // If the tab is not active, also trigger system notification (OS-level popup).
          if (
            document.hidden
            && typeof window !== "undefined"
            && "Notification" in window
            && Notification.permission === "granted"
          ) {
            try {
              new Notification(payload.latest.title, {
                body: payload.latest.message,
                tag: `notif-${payload.latest.id}`,
                silent: true,
              });
            } catch {
              // Ignore notification API failures.
            }
          }
        }
        if (payload.latest?.type === "UNPAID_TICKET_ALERT" || hasNewUrgent) {
          showUrgentAlert(urgentId ?? payload.latest?.id ?? "", payload.urgentAlertCount ?? 1);
        }
      } else if (hasNewUrgent && urgentId) {
        showUrgentAlert(urgentId, payload.urgentAlertCount ?? 1);
      }
    }

    async function poll() {
      try {
        const response = await fetch("/api/notifications/realtime", {
          method: "GET",
          cache: "no-store",
          headers: { "Cache-Control": "no-cache" },
        });

        if (!response.ok) return;

        const payload = (await response.json()) as RealtimePayload;
        applyPayload(payload);
      } catch {
        // Keep silent on polling failures; next cycle will retry.
      }
    }

    function startPollingFallback() {
      if (pollingRef.current) return;
      void poll();
      pollingRef.current = window.setInterval(() => {
        void poll();
      }, 8000);
    }

    if (typeof window !== "undefined" && "EventSource" in window) {
      const source = new EventSource("/api/notifications/stream");
      eventSourceRef.current = source;

      source.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as RealtimePayload;
          applyPayload(payload);
        } catch {
          // Ignore malformed SSE payload.
        }
      };

      source.onerror = () => {
        source.close();
        eventSourceRef.current = null;
        startPollingFallback();
      };
    } else {
      startPollingFallback();
    }

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (pollingRef.current) {
        window.clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, []);

  return (
    <>
      <Link
        href="/inbox"
        className="inline-flex items-center gap-2 rounded-full border border-black/15 px-3 py-1 text-xs font-semibold dark:border-white/20"
      >
        <span>Notifications</span>
        {unreadCount > 0 ? (
          <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </Link>

      {toast ? (
        <div className="fixed bottom-4 right-4 z-120 w-[min(360px,calc(100vw-2rem))] rounded-xl border border-black/15 bg-white/95 p-3 shadow-xl backdrop-blur dark:border-white/20 dark:bg-zinc-900/95">
          <p className="text-xs font-semibold text-black dark:text-white">{toast.title}</p>
          <p className="mt-1 line-clamp-3 text-[11px] text-black/70 dark:text-white/70">{toast.message}</p>
        </div>
      ) : null}
    </>
  );
}
