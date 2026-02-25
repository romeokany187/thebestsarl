"use client";

import { useState } from "react";

type Site = {
  id: string;
  name: string;
  type: "OFFICE" | "ASSIGNMENT";
  latitude: number;
  longitude: number;
  radiusMeters: number;
  isActive: boolean;
};

export function WorkSiteAdmin({ sites }: { sites: Site[] }) {
  const [status, setStatus] = useState("");

  async function createSite(formData: FormData) {
    setStatus("Création du lieu...");

    const payload = {
      name: formData.get("name"),
      type: formData.get("type"),
      latitude: Number(formData.get("latitude")),
      longitude: Number(formData.get("longitude")),
      radiusMeters: Number(formData.get("radiusMeters")),
      isActive: true,
    };

    const response = await fetch("/api/sites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      setStatus("Échec création lieu.");
      return;
    }

    setStatus("Lieu créé.");
    window.location.reload();
  }

  async function updateSite(siteId: string, payload: Partial<Site>) {
    setStatus("Mise à jour...");

    const response = await fetch(`/api/sites/${siteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      setStatus("Échec mise à jour.");
      return;
    }

    setStatus("Lieu mis à jour.");
    window.location.reload();
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
        <h2 className="text-lg font-semibold">Ajouter un lieu d&apos;affectation</h2>
        <form action={createSite} className="mt-3 grid gap-3 md:grid-cols-2">
          <input name="name" required placeholder="Nom du lieu" className="rounded-md border px-3 py-2" />
          <select name="type" defaultValue="OFFICE" className="rounded-md border px-3 py-2">
            <option value="OFFICE">Bureau</option>
            <option value="ASSIGNMENT">Lieu d&apos;affectation</option>
          </select>
          <input name="latitude" type="number" step="0.000001" required placeholder="Latitude" className="rounded-md border px-3 py-2" />
          <input name="longitude" type="number" step="0.000001" required placeholder="Longitude" className="rounded-md border px-3 py-2" />
          <input name="radiusMeters" type="number" min="20" max="5000" defaultValue="250" required placeholder="Rayon (m)" className="rounded-md border px-3 py-2" />
          <button className="rounded-md bg-black px-3 py-2 text-white dark:bg-white dark:text-black">Créer</button>
        </form>
      </section>

      <section className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
        <h2 className="text-lg font-semibold">Lieux configurés</h2>
        <div className="mt-3 space-y-3">
          {sites.map((site) => (
            <div key={site.id} className="rounded-md border border-black/10 p-3 dark:border-white/10">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{site.name}</p>
                <span className="text-xs text-black/60 dark:text-white/60">{site.type}</span>
              </div>
              <p className="mt-1 text-xs text-black/60 dark:text-white/60">
                {site.latitude.toFixed(6)}, {site.longitude.toFixed(6)} • Rayon {site.radiusMeters}m
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => updateSite(site.id, { isActive: !site.isActive })}
                  className="rounded-md border border-black/15 px-3 py-1.5 text-xs font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                >
                  {site.isActive ? "Désactiver" : "Activer"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const value = window.prompt("Nouveau rayon (m)", String(site.radiusMeters));
                    if (!value) return;
                    const radiusMeters = Number(value);
                    if (Number.isNaN(radiusMeters)) return;
                    void updateSite(site.id, { radiusMeters });
                  }}
                  className="rounded-md border border-black/15 px-3 py-1.5 text-xs font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                >
                  Modifier rayon
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <p className="text-xs text-black/60 dark:text-white/60">{status}</p>
    </div>
  );
}
