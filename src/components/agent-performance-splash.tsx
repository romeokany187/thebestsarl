"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  PERFORMANCE_SPLASH_PENDING_KEY,
  presentationForPerformance,
  type AgentMonthlyPerformance,
} from "@/lib/agent-performance-splash-shared";

const SPLASH_DURATION_MS = 12_000;
const FADE_OUT_MS = 700;

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
  const [phase, setPhase] = useState<"checking" | "visible" | "leaving" | "done">("checking");
  const [progress, setProgress] = useState(100);

  const presentation = useMemo(() => presentationForPerformance(stats.tier, stats), [stats]);

  useEffect(() => {
    const pending = window.localStorage.getItem(PERFORMANCE_SPLASH_PENDING_KEY) === "1";

    if (!pending) {
      router.replace(redirectPath);
      return;
    }

    window.localStorage.removeItem(PERFORMANCE_SPLASH_PENDING_KEY);
    setPhase("visible");

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

  if (phase === "checking" || phase === "done") {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950 text-white">
        <p className="text-sm text-white/70">Chargement de votre espace…</p>
      </div>
    );
  }

  const leaving = phase === "leaving";

  return (
    <div
      className={`agent-splash-root fixed inset-0 z-[100] overflow-hidden bg-zinc-950 text-white ${leaving ? "agent-splash-leave" : "agent-splash-enter"}`}
      role="dialog"
      aria-modal="true"
      aria-label="Bilan mensuel billets"
    >
      <div className={`absolute inset-0 bg-gradient-to-br ${presentation.accentClass} opacity-90`} />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.18),transparent_45%),radial-gradient(circle_at_80%_80%,rgba(0,0,0,0.35),transparent_50%)]" />
      <div className="agent-splash-grain absolute inset-0 opacity-[0.08]" />

      <div className="relative flex h-full flex-col items-center justify-center px-6 py-10">
        <div className={`w-full max-w-3xl rounded-3xl border border-white/20 bg-black/25 p-8 backdrop-blur-md md:p-12 ${presentation.glowClass} agent-splash-card`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="rounded-full border border-white/30 bg-white/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.2em]">
              THEBEST SARL
            </span>
            <span className="rounded-full bg-white/15 px-4 py-1 text-xs font-semibold">{presentation.badgeLabel}</span>
          </div>

          <p className="mt-6 text-sm font-medium uppercase tracking-widest text-white/75">{stats.monthLabel}</p>
          <h1 className="mt-2 text-3xl font-bold leading-tight md:text-5xl">{presentation.title}</h1>
          <p className="mt-2 text-base text-white/85 md:text-lg">{presentation.subtitle}</p>
          <p className="mt-1 text-sm text-white/70">Bonjour {userName} — billet(s) où vous êtes payant</p>

          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/20 bg-white/10 p-5 text-center">
              <p className="text-xs uppercase tracking-wider text-white/70">Billets vendus</p>
              <p className="agent-splash-stat mt-2 text-5xl font-black tabular-nums md:text-6xl">{stats.totalTickets}</p>
            </div>
            <div className="rounded-2xl border border-emerald-300/30 bg-emerald-500/15 p-5 text-center">
              <p className="text-xs uppercase tracking-wider text-emerald-100/90">Payés (caisse)</p>
              <p className="agent-splash-stat mt-2 text-5xl font-black tabular-nums text-emerald-100 md:text-6xl">{stats.paidCount}</p>
            </div>
            <div className="rounded-2xl border border-amber-200/30 bg-amber-500/15 p-5 text-center">
              <p className="text-xs uppercase tracking-wider text-amber-100/90">Impayés / partiels</p>
              <p className="agent-splash-stat mt-2 text-5xl font-black tabular-nums text-amber-50 md:text-6xl">{stats.openCount}</p>
              {stats.partialCount > 0 ? (
                <p className="mt-1 text-xs text-amber-100/80">dont {stats.partialCount} partiel(s)</p>
              ) : null}
            </div>
          </div>

          <p className="mt-8 text-sm leading-relaxed text-white/90 md:text-base">{presentation.message}</p>
          <p className="mt-3 text-xs text-white/60">
            Statuts calculés depuis les encaissements saisis en caisse (rapport paiements billets).
          </p>

          <div className="mt-8">
            <div className="mb-2 flex justify-between text-xs text-white/70">
              <span>Redirection vers votre espace</span>
              <span>{Math.ceil((progress / 100) * (SPLASH_DURATION_MS / 1000))} s</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/20">
              <div
                className="h-full rounded-full bg-white transition-[width] duration-100 ease-linear"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
