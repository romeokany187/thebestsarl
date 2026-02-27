"use client";

import { useEffect, useState } from "react";
import type { AppRole } from "@/lib/rbac";

export function AttendanceForm({ role }: { role: AppRole }) {
  const [status, setStatus] = useState<string>("");
  const [isSigning, setIsSigning] = useState(false);
  const [hasClockIn, setHasClockIn] = useState(false);
  const [hasClockOut, setHasClockOut] = useState(false);
  const [clockIn, setClockIn] = useState<string | null>(null);
  const [clockOut, setClockOut] = useState<string | null>(null);
  const [latenessMins, setLatenessMins] = useState<number>(0);
  const [overtimeMins, setOvertimeMins] = useState<number>(0);

  function applyTodayStatus(data?: {
    hasClockIn?: boolean;
    hasClockOut?: boolean;
    clockIn?: string | null;
    clockOut?: string | null;
    latenessMins?: number;
    overtimeMins?: number;
  }) {
    setHasClockIn(Boolean(data?.hasClockIn));
    setHasClockOut(Boolean(data?.hasClockOut));
    setClockIn(data?.clockIn ?? null);
    setClockOut(data?.clockOut ?? null);
    setLatenessMins(data?.latenessMins ?? 0);
    setOvertimeMins(data?.overtimeMins ?? 0);
  }

  useEffect(() => {
    let isMounted = true;

    async function loadTodayStatus() {
      const response = await fetch("/api/attendance/sign", { cache: "no-store" });
      if (!response.ok || !isMounted) {
        return;
      }

      const result = await response.json();
      if (!isMounted) {
        return;
      }

      applyTodayStatus(result?.data);
    }

    loadTodayStatus();

    return () => {
      isMounted = false;
    };
  }, []);

  async function sign(action: "CLOCK_IN" | "CLOCK_OUT") {
    if (!navigator.geolocation) {
      setStatus("Géolocalisation non supportée par votre navigateur.");
      return;
    }

    setIsSigning(true);
    setStatus(action === "CLOCK_IN" ? "Signature d'entrée en cours..." : "Signature de sortie en cours...");

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const payload = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyM: position.coords.accuracy,
          action,
        };

        const response = await fetch("/api/attendance/sign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorPayload = await response.json().catch(() => null);
          setStatus(errorPayload?.error ?? "Signature échouée. Vérifiez vos permissions.");
          setIsSigning(false);
          return;
        }

        const result = await response.json();
        const signedAt = new Date(result.metadata.signedAt).toLocaleString();
        const locationLabel = result.metadata.matchedSiteName
          ? `${result.metadata.locationStatus} - ${result.metadata.matchedSiteName}`
          : result.metadata.locationStatus;
        const officeText = result.metadata.isAtOffice ? "Au bureau" : "Hors bureau";
        const addressText = result.metadata.resolvedAddress ? ` • ${result.metadata.resolvedAddress}` : "";
        setStatus(
          `${action === "CLOCK_IN" ? "Entrée" : "Sortie"} signée à ${signedAt} (${officeText} • ${locationLabel}${addressText}).`,
        );
        const refreshResponse = await fetch("/api/attendance/sign", { cache: "no-store" });
        if (refreshResponse.ok) {
          const refreshPayload = await refreshResponse.json();
          applyTodayStatus(refreshPayload?.data);
        }
        setIsSigning(false);
      },
      () => {
        setStatus("Impossible de récupérer votre position.");
        setIsSigning(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  return (
    <section className="grid gap-3 rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
      <h3 className="text-sm font-semibold">Signature automatique du jour</h3>
      <button
        type="button"
        onClick={() => sign("CLOCK_IN")}
        disabled={isSigning}
        className="rounded-md border border-black/15 px-3 py-2 text-sm font-semibold hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/20 dark:hover:bg-white/10"
      >
        {isSigning ? "Traitement..." : "Signer la présence du jour"}
      </button>
      <button
        type="button"
        onClick={() => sign("CLOCK_OUT")}
        disabled={isSigning || !hasClockIn || hasClockOut}
        className="rounded-md bg-black px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-black"
      >
        {isSigning ? "Traitement..." : "Signer la sortie"}
      </button>
      {!hasClockIn ? (
        <p className="text-xs text-black/60 dark:text-white/60">
          Signe d&apos;abord l&apos;entrée du jour pour débloquer la sortie.
        </p>
      ) : null}
      {hasClockOut ? (
        <p className="text-xs text-black/60 dark:text-white/60">La sortie du jour est déjà signée.</p>
      ) : null}
      {role !== "EMPLOYEE" ? (
        <p className="text-xs text-black/60 dark:text-white/60">
          Signature sur votre propre session ({role}).
        </p>
      ) : null}
      <p className="text-xs text-black/60 dark:text-white/60">
        Toutes les données sont récupérées automatiquement: date, heure et localisation.
      </p>
      <div className="rounded-lg border border-black/10 bg-black/5 px-3 py-2 text-xs dark:border-white/10 dark:bg-white/5">
        <p>Entrée: {clockIn ? new Date(clockIn).toLocaleTimeString() : "Non signée"}</p>
        <p>Sortie: {clockOut ? new Date(clockOut).toLocaleTimeString() : "Non signée"}</p>
        <p>Retard: {latenessMins} min</p>
        <p>Heures supp: {overtimeMins} min</p>
      </div>
      <p className="text-xs text-black/60 dark:text-white/60">{status}</p>
    </section>
  );
}
