"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { presentationForPerformance, type AgentMonthlyPerformance } from "@/lib/agent-performance-splash-shared";

const SPLASH_DURATION_MS = 12_000;
const FADE_OUT_MS = 700;

function ticketWord(count: number) {
  return count <= 1 ? "billet" : "billets";
}

export function AgentPerformanceSplash({
  stats,
  redirectPath,
  userName,
}: {
  stats: AgentMonthlyPerformance;
  redirectPath: string;
  userName: string;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<"visible" | "leaving" | "done">("visible");
  const [progress, setProgress] = useState(100);

  const presentation = useMemo(() => presentationForPerformance(stats.tier, stats), [stats]);

  useEffect(() => {
    const startedAt = Date.now();
    const tick = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, SPLASH_DURATION_MS - elapsed);
      setProgress((remaining / SPLASH_DURATION_MS) * 100);
      if (remaining <= 0) {
        window.clearInterval(tick);
        setPhase("leaving");
      }
    }, 50);

    return () => window.clearInterval(tick);
  }, [redirectPath, router]);

  useEffect(() => {
    if (phase !== "leaving") return;
    const timer = window.setTimeout(() => {
      setPhase("done");
      router.replace(redirectPath);
    }, FADE_OUT_MS);
    return () => window.clearTimeout(timer);
  }, [phase, redirectPath, router]);

  if (phase === "done") {
    return null;
  }

  const leaving = phase === "leaving";
  const alert = presentation.alert;

  return (
    <div
      className={`agent-splash-root fixed inset-0 z-[100] overflow-hidden bg-zinc-950 text-white ${leaving ? "agent-splash-leave" : "agent-splash-enter"} ${alert ? "agent-splash-alert-bg" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="Bilan mensuel billets"
    >
      <div className={`absolute inset-0 bg-gradient-to-br ${presentation.accentClass} opacity-90`} />
      {alert ? <div className="agent-splash-alert-stripes absolute inset-0 opacity-30" aria-hidden /> : null}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.14),transparent_45%),radial-gradient(circle_at_80%_80%,rgba(0,0,0,0.4),transparent_50%)]" />
      <div className="agent-splash-grain absolute inset-0 opacity-[0.08]" />

      <div className="relative flex h-full flex-col items-center justify-center px-4 py-8 sm:px-6 sm:py-10">
        <div
          className={`w-full max-w-4xl rounded-3xl border p-6 backdrop-blur-md md:p-10 ${presentation.glowClass} agent-splash-card ${alert ? "border-red-300/50 bg-black/40 agent-splash-alert-pulse" : "border-white/20 bg-black/25"}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="rounded-full border border-white/30 bg-white/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.2em]">
              THEBEST SARL
            </span>
            <span
              className={`rounded-full px-4 py-1 text-xs font-bold uppercase tracking-wide ${alert ? "bg-red-600 text-white agent-splash-badge-pulse" : "bg-white/15 font-semibold"}`}
            >
              {presentation.badgeLabel}
            </span>
          </div>

          <p className="mt-5 text-center text-xs font-medium uppercase tracking-[0.25em] text-white/70 sm:text-sm">
            {stats.monthLabel} · {userName}
          </p>

          {alert ? (
            <div className="mt-6 flex items-center justify-center gap-3 text-red-100">
              <span className="agent-splash-alert-icon flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-red-200/80 bg-red-600/40">
                <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
                  <path d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <p className="text-sm font-bold uppercase tracking-wider sm:text-base">Attention — résultat faible ce mois-ci</p>
            </div>
          ) : null}

          <div className="mt-8 text-center">
            <p className="text-xl font-semibold leading-snug text-white/95 sm:text-2xl md:text-3xl">
              Vous avez vendu ce mois-ci&nbsp;:
            </p>
            <p className="agent-splash-hero-count mt-3 text-[5.5rem] font-black leading-none tabular-nums tracking-tight sm:text-[7rem] md:text-[8.5rem]">
              {stats.totalTickets}
            </p>
            <p className="mt-2 text-2xl font-bold uppercase tracking-wide text-white/90 sm:text-3xl">
              {ticketWord(stats.totalTickets)}
            </p>
            <p className="mt-3 text-xs text-white/60 sm:text-sm">Comptabilisés sur votre nom payant</p>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-2 sm:gap-4">
            <div className="rounded-2xl border border-emerald-300/35 bg-emerald-500/15 px-4 py-3 text-center sm:py-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-100/85 sm:text-xs">Payés (caisse)</p>
              <p className="mt-1 text-3xl font-black tabular-nums text-emerald-50 sm:text-4xl">{stats.paidCount}</p>
            </div>
            <div className="rounded-2xl border border-amber-200/35 bg-amber-500/15 px-4 py-3 text-center sm:py-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-100/85 sm:text-xs">Impayés / partiels</p>
              <p className="mt-1 text-3xl font-black tabular-nums text-amber-50 sm:text-4xl">{stats.openCount}</p>
              {stats.partialCount > 0 ? (
                <p className="mt-0.5 text-[10px] text-amber-100/80 sm:text-xs">dont {stats.partialCount} partiel(s)</p>
              ) : null}
            </div>
          </div>

          <div
            className={`mt-8 rounded-2xl px-4 py-4 text-center sm:px-6 sm:py-5 ${alert ? "border border-red-400/40 bg-red-950/50" : "border border-white/15 bg-white/5"}`}
          >
            <p className={`text-base leading-relaxed sm:text-lg ${alert ? "font-semibold text-red-50" : "text-white/92"}`}>
              {presentation.message}
            </p>
          </div>

          <div className="mt-8">
            <div className="mb-2 flex justify-between text-xs text-white/70">
              <span>Redirection vers votre espace</span>
              <span>{Math.ceil((progress / 100) * (SPLASH_DURATION_MS / 1000))} s</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/20">
              <div
                className={`h-full rounded-full transition-[width] duration-100 ease-linear ${alert ? "bg-red-300" : "bg-white"}`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
