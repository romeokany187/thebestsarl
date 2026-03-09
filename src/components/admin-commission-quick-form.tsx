"use client";

import { useState } from "react";

type AirlineOption = {
  id: string;
  code: string;
  name: string;
};

export function AdminCommissionQuickForm({ airlines }: { airlines: AirlineOption[] }) {
  const [selectedAirlineId, setSelectedAirlineId] = useState(airlines[0]?.id ?? "");
  const [ratePercent, setRatePercent] = useState("0");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedAirlineId) {
      setStatus("Sélectionnez une compagnie.");
      return;
    }

    const rate = Number.parseFloat(ratePercent);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      setStatus("Le pourcentage doit être entre 0 et 100.");
      return;
    }

    setSaving(true);
    setStatus("Enregistrement de la règle...");

    const response = await fetch("/api/admin/commission", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ airlineId: selectedAirlineId, ratePercent: rate }),
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      setStatus(payload?.error ?? "Impossible d'enregistrer la règle.");
      setSaving(false);
      return;
    }

    const airlineLabel = payload?.data?.airlineCode
      ? `${payload.data.airlineCode} - ${payload.data.airlineName}`
      : "la compagnie sélectionnée";

    setStatus(`Règle enregistrée pour ${airlineLabel}: ${rate.toFixed(2)}%.`);
    setSaving(false);
  }

  return (
    <section className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
      <h2 className="text-lg font-semibold">Commission rapide</h2>
      <p className="mt-1 text-xs text-black/60 dark:text-white/60">
        Choisissez une compagnie, indiquez le pourcentage de commission, puis enregistrez.
      </p>

      <form className="mt-4 grid gap-3 sm:grid-cols-[1fr_180px_auto] sm:items-end" onSubmit={onSubmit}>
        <label className="text-xs font-semibold text-black/70 dark:text-white/70">
          Compagnie
          <select
            className="mt-1 w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/20 dark:bg-zinc-950"
            value={selectedAirlineId}
            onChange={(event) => setSelectedAirlineId(event.target.value)}
          >
            {airlines.map((airline) => (
              <option key={airline.id} value={airline.id}>
                {airline.code} - {airline.name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs font-semibold text-black/70 dark:text-white/70">
          Commission (%)
          <input
            type="number"
            min={0}
            max={100}
            step={0.01}
            className="mt-1 w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/20 dark:bg-zinc-950"
            value={ratePercent}
            onChange={(event) => setRatePercent(event.target.value)}
            placeholder="0"
            required
          />
        </label>

        <button
          type="submit"
          disabled={saving}
          className="rounded-lg border border-black/15 px-4 py-2 text-sm font-semibold hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/20 dark:hover:bg-white/10"
        >
          {saving ? "Enregistrement..." : "Enregistrer"}
        </button>
      </form>

      {status ? <p className="mt-3 text-xs text-black/65 dark:text-white/65">{status}</p> : null}
    </section>
  );
}
