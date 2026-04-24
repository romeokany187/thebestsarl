"use client";

import { useState } from "react";

export function UnpaidAlertsButton() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ message: string; ok: boolean } | null>(null);

  async function handleSendAlerts() {
    if (!confirm("Envoyer des alertes urgentes pour les billets non payés à tous les comptables et caissiers ?")) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/payments/unpaid-alerts", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setResult({ message: data.message ?? `Alertes envoyées.`, ok: true });
      } else {
        setResult({ message: data.error ?? "Erreur lors de l'envoi.", ok: false });
      }
    } catch {
      setResult({ message: "Erreur réseau.", ok: false });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={handleSendAlerts}
        disabled={loading}
        className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-red-700 disabled:opacity-60 transition-colors"
      >
        <span>{loading ? "Envoi…" : "🚨 Alerter comptables & caissiers"}</span>
      </button>
      {result && (
        <p className={`text-xs px-1 ${result.ok ? "text-green-700" : "text-red-600"}`}>
          {result.message}
        </p>
      )}
    </div>
  );
}
