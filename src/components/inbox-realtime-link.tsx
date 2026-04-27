"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type MutableRefObject } from "react";

type RealtimePayload = {
  unreadCount: number;
  latest: {
    id: string;
    title: string;
    message: string;
    createdAt: string;
  } | null;
};

async function playNotificationTone(enabled: boolean, contextRef: MutableRefObject<AudioContext | null>) {
  if (!enabled || typeof window === "undefined") return;

  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;

  if (!contextRef.current) {
    contextRef.current = new AudioContextClass();
  }
  const context = contextRef.current;

  if (context.state === "suspended") {
    try {
      await context.resume();
    } catch {
      return;
    }
  }

  const masterGain = context.createGain();
  masterGain.gain.value = 0.13;
  masterGain.connect(context.destination);

  const now = context.currentTime;
  const notes = [880, 1174, 1567];
  notes.forEach((frequency, index) => {
    const start = now + (index * 0.09);
    const end = start + 0.12;
    const osc = context.createOscillator();
    const env = context.createGain();

    osc.type = "sine";
    osc.frequency.value = frequency;

    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(0.35, start + 0.02);
    env.gain.exponentialRampToValueAtTime(0.0001, end);

    osc.connect(env);
    env.connect(masterGain);
    osc.start(start);
    osc.stop(end);
  });

  window.setTimeout(() => {
    masterGain.disconnect();
  }, 600);
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
  const audioContextRef = useRef<AudioContext | null>(null);

  async function unlockSoundAndSystemNotifications() {
    setSoundEnabled(true);
    soundEnabledRef.current = true;

    if (typeof window !== "undefined") {
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioContextClass && !audioContextRef.current) {
        audioContextRef.current = new AudioContextClass();
      }

      if (audioContextRef.current?.state === "suspended") {
        try {
          await audioContextRef.current.resume();
        } catch {
          // Ignore; next user interaction will try again.
        }
      }

      if ("Notification" in window && Notification.permission === "default") {
        void Notification.requestPermission();
      }
    }
  }

  useEffect(() => {
    const unlock = () => {
      void unlockSoundAndSystemNotifications();
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("touchstart", unlock, { once: true });
    window.addEventListener("click", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });

    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("touchstart", unlock);
      window.removeEventListener("click", unlock);
      window.removeEventListener("keydown", unlock);
      if (audioContextRef.current) {
        void audioContextRef.current.close();
        audioContextRef.current = null;
      }
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
              });
            } catch {
              // Ignore notification API failures.
            }
          }
        }
        void playNotificationTone(soundEnabledRef.current, audioContextRef);
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
