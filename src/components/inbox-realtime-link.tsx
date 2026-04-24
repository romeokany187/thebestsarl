"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type RealtimePayload = {
  unreadCount: number;
  latest: {
    id: string;
    title: string;
    message: string;
    createdAt: string;
  } | null;
};

async function playNotificationTone(enabled: boolean) {
  if (!enabled || typeof window === "undefined") return;

  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;

  const context = new AudioContextClass();
  if (context.state === "suspended") {
    try {
      await context.resume();
    } catch {
      return;
    }
  }

  const oscillator = context.createOscillator();
  const gainNode = context.createGain();

  oscillator.type = "square";
  oscillator.frequency.value = 1046;
  gainNode.gain.value = 0.0001;

  oscillator.connect(gainNode);
  gainNode.connect(context.destination);

  const now = context.currentTime;
  gainNode.gain.setValueAtTime(0.0001, now);
  gainNode.gain.exponentialRampToValueAtTime(0.16, now + 0.02);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);

  oscillator.start(now);
  oscillator.stop(now + 0.4);

  window.setTimeout(() => {
    void context.close();
  }, 900);
}

export function InboxRealtimeLink({
  initialUnreadCount,
  initialLatestNotificationId,
}: {
  initialUnreadCount: number;
  initialLatestNotificationId: string | null;
}) {
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [latestId, setLatestId] = useState<string | null>(initialLatestNotificationId);
  const [toast, setToast] = useState<{ title: string; message: string } | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const pollingRef = useRef<number | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const latestIdRef = useRef<string | null>(initialLatestNotificationId);
  const unreadCountRef = useRef(initialUnreadCount);
  const soundEnabledRef = useRef(false);

  useEffect(() => {
    const unlock = () => setSoundEnabled(true);
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("touchstart", unlock, { once: true });
    window.addEventListener("click", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });

    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("touchstart", unlock);
      window.removeEventListener("click", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    latestIdRef.current = latestId;
  }, [latestId]);

  useEffect(() => {
    unreadCountRef.current = unreadCount;
  }, [unreadCount]);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  useEffect(() => {
    function applyPayload(payload: RealtimePayload) {
      const hasNewNotification = payload.latest?.id && payload.latest.id !== latestIdRef.current;
      const countIncreased = payload.unreadCount > unreadCountRef.current;

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
        }
        void playNotificationTone(soundEnabledRef.current);
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
