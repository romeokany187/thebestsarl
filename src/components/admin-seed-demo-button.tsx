"use client";

import { useState } from "react";

export function AdminSeedDemoButton() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string>("");

  async function handleSeed() {
    setLoading(true);
    setMessage("Injection en cours...");

    try {
      const response = await fetch("/api/admin/seed-demo", { method: "POST" });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setMessage(payload?.error ?? "Échec de l'injection des données de test.");
        return;
      }

      setMessage(payload?.message ?? "Données de test injectées.");
    } catch {
      setMessage("Erreur réseau pendant l'injection.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
      <h2 className="text-base font-semibold">Données de test production</h2>
      <p className="mt-1 text-xs text-black/60 dark:text-white/60">
        Injecte instantanément les données de démonstration Approvisionnement dans la base active.
      </p>
      <button
        type="button"
        onClick={handleSeed}
        disabled={loading}
        className="mt-3 rounded-md bg-black px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70 dark:bg-white dark:text-black"
      >
        {loading ? "Injection..." : "Injecter données de test"}
      </button>
      {message ? <p className="mt-2 text-xs text-black/65 dark:text-white/65">{message}</p> : null}
    </div>
  );
}
