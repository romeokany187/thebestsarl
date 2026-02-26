"use client";

import { useEffect, useState } from "react";
import type { AppRole } from "@/lib/rbac";

type UserOption = { id: string; name: string };

export function AttendanceForm({ users, role }: { users: UserOption[]; role: AppRole }) {
  const [status, setStatus] = useState<string>("");
  const [isSigning, setIsSigning] = useState(false);
  const [hasClockIn, setHasClockIn] = useState(false);
  const [hasClockOut, setHasClockOut] = useState(false);

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

      setHasClockIn(Boolean(result?.data?.hasClockIn));
      setHasClockOut(Boolean(result?.data?.hasClockOut));
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
        setStatus(
          `${action === "CLOCK_IN" ? "Entrée" : "Sortie"} signée à ${signedAt} (${locationLabel}).`,
        );
        if (action === "CLOCK_IN") {
          setHasClockIn(true);
        }
        if (action === "CLOCK_OUT") {
          setHasClockOut(true);
        }
        setIsSigning(false);
        window.location.reload();
      },
      () => {
        setStatus("Impossible de récupérer votre position.");
        setIsSigning(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  const isEmployee = role === "EMPLOYEE";

  if (isEmployee) {
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
        <p className="text-xs text-black/60 dark:text-white/60">
          Toutes les données sont récupérées automatiquement: date, heure et localisation.
        </p>
        <p className="text-xs text-black/60 dark:text-white/60">{status}</p>
      </section>
    );
  }

  async function onSubmit(formData: FormData) {
    setStatus("Enregistrement...");
    const payload = {
      userId: formData.get("userId"),
      date: formData.get("date"),
      clockIn: formData.get("clockIn") ? `${formData.get("date")}T${formData.get("clockIn")}:00` : undefined,
      clockOut: formData.get("clockOut") ? `${formData.get("date")}T${formData.get("clockOut")}:00` : undefined,
      latenessMins: Number(formData.get("latenessMins") || 0),
      overtimeMins: Number(formData.get("overtimeMins") || 0),
      notes: formData.get("notes") || undefined,
    };

    const response = await fetch("/api/attendance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setStatus(response.ok ? "Présence enregistrée." : "Erreur de validation.");
    if (response.ok) {
      window.location.reload();
    }
  }

  return (
    <form
      action={async (formData) => {
        await onSubmit(formData);
      }}
      className="grid gap-3 rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900"
    >
      <h3 className="text-sm font-semibold">Saisie de présence</h3>
      <button
        type="button"
        onClick={() => sign("CLOCK_IN")}
        disabled={isSigning}
        className="rounded-md border border-black/15 px-3 py-2 text-sm font-semibold hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/20 dark:hover:bg-white/10"
      >
        {isSigning ? "Signature en cours..." : "Signer ma présence maintenant"}
      </button>
      <select name="userId" required className="rounded-md border px-3 py-2">
        <option value="">Employé</option>
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name}
          </option>
        ))}
      </select>
      <input name="date" type="date" required className="rounded-md border px-3 py-2" />
      <div className="grid gap-3 sm:grid-cols-2">
        <input name="clockIn" type="time" className="rounded-md border px-3 py-2" />
        <input name="clockOut" type="time" className="rounded-md border px-3 py-2" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <input name="latenessMins" type="number" min="0" placeholder="Retard (min)" className="rounded-md border px-3 py-2" />
        <input name="overtimeMins" type="number" min="0" placeholder="Heures supp. (min)" className="rounded-md border px-3 py-2" />
      </div>
      <textarea name="notes" placeholder="Notes" className="rounded-md border px-3 py-2" />
      <button className="rounded-md bg-black px-3 py-2 text-white dark:bg-white dark:text-black">Enregistrer</button>
      <p className="text-xs text-black/60 dark:text-white/60">{status}</p>
    </form>
  );
}
