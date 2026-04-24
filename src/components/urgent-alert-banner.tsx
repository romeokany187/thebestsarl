"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useCallback } from "react";

type RealtimePayload = {
  unreadCount: number;
  urgentAlertCount?: number;
  latest: { id: string; title: string; message: string; createdAt: string } | null;
};

/** Play a loud repeating alarm: 3 short beeps at 700 Hz, then silence, then repeat once */
function playUrgentAlarm() {
  if (typeof window === "undefined") return;
  const AudioContextClass =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;

  const ctx = new AudioContextClass();
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
  window.setTimeout(() => void ctx.close(), totalDuration * 1000 + 500);
}

export function UrgentAlertBanner({
  initialUrgentCount,
}: {
  initialUrgentCount: number;
}) {
  const [urgentCount, setUrgentCount] = useState(initialUrgentCount);
  const [dismissed, setDismissed] = useState(false);
  const [soundUnlocked, setSoundUnlocked] = useState(false);
  const soundUnlockedRef = useRef(false);
  const urgentCountRef = useRef(initialUrgentCount);
  const intervalRef = useRef<number | null>(null);
  const alarmIntervalRef = useRef<number | null>(null);

  // Unlock sound context on first user interaction
  useEffect(() => {
    const unlock = () => {
      setSoundUnlocked(true);
      soundUnlockedRef.current = true;
    };
    window.addEventListener("click", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("click", unlock);
      window.removeEventListener("keydown", unlock);
    };
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
      urgentCountRef.current = count;
      setUrgentCount(count);
      setDismissed(false); // re-show banner if new alerts arrived
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
      if (urgentCountRef.current > 0 && soundUnlockedRef.current && !dismissed) {
        playUrgentAlarm();
      }
    }, 30_000);
    return () => {
      if (alarmIntervalRef.current) window.clearInterval(alarmIntervalRef.current);
    };
  }, [dismissed]);

  // Play immediately when urgent count goes from 0 to >0 and sound is unlocked
  useEffect(() => {
    if (urgentCount > 0 && soundUnlocked) {
      playUrgentAlarm();
    }
  }, [urgentCount, soundUnlocked]);

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
              if (soundUnlocked) playUrgentAlarm();
              else setSoundUnlocked(true);
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
            onClick={() => setDismissed(true)}
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
