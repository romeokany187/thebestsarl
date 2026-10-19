"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useCallback } from "react";

type RealtimePayload = {
  unreadCount: number;
  urgentAlertCount?: number;
  latestUrgent?: { id: string; title: string; message: string; createdAt: string } | null;
};

type UrgentRingDetail = {
  id?: string;
  urgentAlertCount?: number;
};

/** Play a loud alarm on an AudioContext already unlocked by a user gesture. */
function playUrgentAlarm(ctx: AudioContext) {
  if (ctx.state === "closed") return;

  const masterGain = ctx.createGain();
  masterGain.gain.value = 0.45;
  masterGain.connect(ctx.destination);

  // Play a sequence of 4 beeps: [beep, gap, beep, gap, beep, gap, beep]
  const beepDuration = 0.18;
  const gapDuration = 0.1;
  const freqs = [880, 660, 880, 660];

  freqs.forEach((freq, i) => {
    const startTime = ctx.currentTime + i * (beepDuration + gapDuration);

    const osc = ctx.createOscillator();
    const envGain = ctx.createGain();

    osc.type = "square";
    osc.frequency.value = freq;
    envGain.gain.setValueAtTime(0, startTime);
    envGain.gain.linearRampToValueAtTime(1, startTime + 0.01);
    envGain.gain.linearRampToValueAtTime(1, startTime + beepDuration - 0.02);
    envGain.gain.linearRampToValueAtTime(0, startTime + beepDuration);

    osc.connect(envGain);
    envGain.connect(masterGain);
    osc.start(startTime);
    osc.stop(startTime + beepDuration);
  });

  const totalDuration = freqs.length * (beepDuration + gapDuration) + 0.1;
  window.setTimeout(() => {
    masterGain.disconnect();
  }, totalDuration * 1000 + 200);
}

export function UrgentAlertBanner({
  initialUrgentCount,
  initialLatestUrgentId = null,
}: {
  initialUrgentCount: number;
  initialLatestUrgentId?: string | null;
}) {
  const [urgentCount, setUrgentCount] = useState(initialUrgentCount);
  const [dismissed, setDismissed] = useState(false);
  const soundUnlockedRef = useRef(false);
  const urgentCountRef = useRef(initialUrgentCount);
  const intervalRef = useRef<number | null>(null);
  const alarmIntervalRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const lastRungIdRef = useRef<string | null>(null);
  const lastSeenUrgentIdRef = useRef<string | null>(initialLatestUrgentId);
  const lastPlayAtRef = useRef(0);
  const dismissedRef = useRef(false);

  function ensureAudioContext() {
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      return audioContextRef.current;
    }
    const AudioContextClass =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return null;
    audioContextRef.current = new AudioContextClass();
    return audioContextRef.current;
  }

  async function ring() {
    const now = Date.now();
    if (now - lastPlayAtRef.current < 800) return;
    lastPlayAtRef.current = now;
    const ctx = ensureAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        return;
      }
    }
    if (ctx.state !== "running") return;
    playUrgentAlarm(ctx);
  }

  function ringIfNew(id: string | null | undefined) {
    if (!id || id === lastRungIdRef.current) return;
    lastRungIdRef.current = id;
    if (soundUnlockedRef.current) {
      void ring();
    }
  }

  // Unlock sound context on first user interaction, then ring if a recouvrement alert is already waiting.
  useEffect(() => {
    const unlock = () => {
      const ctx = ensureAudioContext();
      if (ctx?.state === "suspended") {
        void ctx.resume();
      }
      const wasUnlocked = soundUnlockedRef.current;
      soundUnlockedRef.current = true;
      if (!wasUnlocked && urgentCountRef.current > 0) {
        void ring();
      }
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("click", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("click", unlock);
      window.removeEventListener("keydown", unlock);
      if (audioContextRef.current) {
        void audioContextRef.current.close();
        audioContextRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    function onRing(event: Event) {
      const detail = (event as CustomEvent<UrgentRingDetail>).detail;
      const count = detail?.urgentAlertCount;
      if (typeof count === "number") {
        urgentCountRef.current = count;
        setUrgentCount(count);
      } else if (urgentCountRef.current === 0) {
        urgentCountRef.current = 1;
        setUrgentCount(1);
      }
      dismissedRef.current = false;
      setDismissed(false);
      if (detail?.id) lastSeenUrgentIdRef.current = detail.id;
      ringIfNew(detail?.id ?? null);
    }

    window.addEventListener("urgent-alert:ring", onRing);
    return () => window.removeEventListener("urgent-alert:ring", onRing);
  }, []);

  // Poll for urgent alerts every 15 seconds
  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications/realtime", {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });
      if (!res.ok) return;
      const data = (await res.json()) as RealtimePayload;
      const count = data.urgentAlertCount ?? 0;
      const urgentId = data.latestUrgent?.id ?? null;
      const isNewUrgent = Boolean(urgentId && urgentId !== lastSeenUrgentIdRef.current);
      urgentCountRef.current = count;
      setUrgentCount(count);
      if (urgentId) lastSeenUrgentIdRef.current = urgentId;
      if (isNewUrgent) {
        dismissedRef.current = false;
        setDismissed(false);
        ringIfNew(urgentId);
      }
    } catch {
      // Silent fail
    }
  }, []);

  useEffect(() => {
    intervalRef.current = window.setInterval(() => void poll(), 15_000);
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
  }, [poll]);

  // Play alarm every 30 seconds when urgent alerts exist
  useEffect(() => {
    alarmIntervalRef.current = window.setInterval(() => {
      if (urgentCountRef.current > 0 && soundUnlockedRef.current && !dismissedRef.current) {
        void ring();
      }
    }, 30_000);
    return () => {
      if (alarmIntervalRef.current) window.clearInterval(alarmIntervalRef.current);
    };
  }, []);

  if (urgentCount === 0 || dismissed) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed inset-x-0 top-0 z-[200] flex flex-col gap-0 shadow-2xl"
    >
      {/* Main banner */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-red-600 px-4 py-3 text-white">
        <div className="flex items-center gap-3">
          {/* Pulsing dot */}
          <span className="relative flex h-4 w-4 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
            <span className="relative inline-flex h-4 w-4 rounded-full bg-white" />
          </span>
          <div>
            <p className="text-sm font-bold leading-tight">
              🚨 URGENT — {urgentCount} alerte{urgentCount > 1 ? "s" : ""} billet{urgentCount > 1 ? "s" : ""} non payé{urgentCount > 1 ? "s" : ""}
            </p>
            <p className="text-xs text-red-100">
              Des billets non encaissés nécessitent une action immédiate.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => {
              soundUnlockedRef.current = true;
              void ring();
            }}
            title="Rejouer le son"
            className="rounded-lg border border-white/40 bg-white/10 px-3 py-1 text-xs font-semibold hover:bg-white/20 transition-colors"
          >
            🔔 Son
          </button>
          <Link
            href="/inbox"
            className="rounded-lg bg-white px-3 py-1 text-xs font-bold text-red-700 hover:bg-red-50 transition-colors"
          >
            Voir les alertes →
          </Link>
          <button
            onClick={() => {
              dismissedRef.current = true;
              setDismissed(true);
            }}
            title="Masquer jusqu'au prochain rafraîchissement"
            className="rounded-lg border border-white/40 bg-white/10 px-3 py-1 text-xs font-semibold hover:bg-white/20 transition-colors"
          >
            ✕ Masquer
          </button>
        </div>
      </div>
      {/* Animated red stripe */}
      <div className="h-1 w-full overflow-hidden bg-red-800">
        <div className="h-1 animate-[stripe_1.5s_linear_infinite] bg-gradient-to-r from-transparent via-red-300 to-transparent" />
      </div>
    </div>
  );
}
