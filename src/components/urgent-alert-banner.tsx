"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type RealtimePayload = {
  unreadCount: number;
  urgentAlertCount?: number;
  latestUrgent?: { id: string; title: string; message: string; createdAt: string } | null;
};

type UrgentAlertDetail = {
  id?: string;
  urgentAlertCount?: number;
};

export function UrgentAlertBanner({
  initialUrgentCount,
  initialLatestUrgentId = null,
}: {
  initialUrgentCount: number;
  initialLatestUrgentId?: string | null;
}) {
  const [urgentCount, setUrgentCount] = useState(initialUrgentCount);
  const [dismissed, setDismissed] = useState(false);
  const urgentCountRef = useRef(initialUrgentCount);
  const intervalRef = useRef<number | null>(null);
  const lastSeenUrgentIdRef = useRef<string | null>(initialLatestUrgentId);
  const dismissedRef = useRef(false);

  function showUrgent(count: number, id?: string | null) {
    urgentCountRef.current = count;
    setUrgentCount(count);
    if (id) lastSeenUrgentIdRef.current = id;
    dismissedRef.current = false;
    setDismissed(false);
  }

  useEffect(() => {
    function onAlert(event: Event) {
      const detail = (event as CustomEvent<UrgentAlertDetail>).detail;
      const count = typeof detail?.urgentAlertCount === "number"
        ? detail.urgentAlertCount
        : Math.max(urgentCountRef.current, 1);
      showUrgent(count, detail?.id ?? null);
    }

    window.addEventListener("urgent-alert:show", onAlert);
    return () => window.removeEventListener("urgent-alert:show", onAlert);
  }, []);

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

  if (urgentCount === 0 || dismissed) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-[200] flex flex-col gap-0 shadow-2xl"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-red-600 px-4 py-3 text-white">
        <div className="flex items-center gap-3">
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
            title="Masquer jusqu'à la prochaine alerte"
            className="rounded-lg border border-white/40 bg-white/10 px-3 py-1 text-xs font-semibold hover:bg-white/20 transition-colors"
          >
            ✕ Masquer
          </button>
        </div>
      </div>
      <div className="h-1 w-full overflow-hidden bg-red-800">
        <div className="h-1 animate-[stripe_1.5s_linear_infinite] bg-gradient-to-r from-transparent via-red-300 to-transparent" />
      </div>
    </div>
  );
}
