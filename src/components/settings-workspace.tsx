"use client";

import { FormEvent, useEffect, useState } from "react";

type Props = {
  initialName: string;
  initialEmail: string;
};

type Density = "comfortable" | "compact";
type ExportFormat = "PDF" | "CSV" | "XLSX";

export function SettingsWorkspace({ initialName, initialEmail }: Props) {
  const [name, setName] = useState(initialName);
  const [profileStatus, setProfileStatus] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  const [density, setDensity] = useState<Density>("comfortable");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("PDF");
  const [prefsStatus, setPrefsStatus] = useState("");

  useEffect(() => {
    const savedDensity = localStorage.getItem("ui-density");
    const savedExport = localStorage.getItem("default-export-format");

    if (savedDensity === "comfortable" || savedDensity === "compact") {
      setDensity(savedDensity);
    }

    if (savedExport === "PDF" || savedExport === "CSV" || savedExport === "XLSX") {
      setExportFormat(savedExport);
    }
  }, []);

  function saveLocalPreferences(nextDensity: Density, nextExport: ExportFormat) {
    localStorage.setItem("ui-density", nextDensity);
    localStorage.setItem("default-export-format", nextExport);
    setPrefsStatus("Préférences enregistrées sur ce navigateur.");
  }

  async function onSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingProfile(true);
    setProfileStatus("Enregistrement...");

    const response = await fetch("/api/settings/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setProfileStatus(payload?.error?.formErrors?.[0] ?? payload?.error ?? "Mise à jour impossible.");
      setSavingProfile(false);
      return;
    }

    setProfileStatus("Profil mis à jour.");
    setSavingProfile(false);
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <h2 className="text-lg font-semibold">Profil utilisateur</h2>
        <p className="mt-2 text-sm text-black/65 dark:text-white/65">Mettre à jour votre nom d'affichage.</p>
        <form onSubmit={onSaveProfile} className="mt-4 grid gap-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Nom affiché</label>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            minLength={2}
            maxLength={80}
            required
            className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20"
          />
          <label className="mt-2 text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Email (lecture seule)</label>
          <input
            value={initialEmail}
            readOnly
            className="rounded-md border border-black/10 bg-black/5 px-3 py-2 text-sm text-black/60 dark:border-white/20 dark:bg-white/10 dark:text-white/60"
          />
          <button
            type="submit"
            disabled={savingProfile}
            className="mt-2 w-fit rounded-md bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-black"
          >
            {savingProfile ? "Enregistrement..." : "Enregistrer"}
          </button>
        </form>
        {profileStatus ? <p className="mt-2 text-xs text-black/60 dark:text-white/60">{profileStatus}</p> : null}
      </section>

      <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <h2 className="text-lg font-semibold">Sécurité</h2>
        <p className="mt-2 text-sm text-black/65 dark:text-white/65">Connexion Google active. La sécurité du compte se gère depuis Google.</p>
        <a
          href="https://myaccount.google.com/security"
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex rounded-md border border-black/15 px-3 py-2 text-xs font-semibold hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
        >
          Ouvrir la sécurité Google
        </a>
      </section>

      <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <h2 className="text-lg font-semibold">Affichage</h2>
        <p className="mt-2 text-sm text-black/65 dark:text-white/65">Choisir la densité de l'interface.</p>
        <div className="mt-4 grid gap-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Densité</label>
          <select
            value={density}
            onChange={(event) => setDensity(event.target.value as Density)}
            className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20"
          >
            <option value="comfortable">Confort</option>
            <option value="compact">Compact</option>
          </select>
        </div>
      </section>

      <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <h2 className="text-lg font-semibold">Exports</h2>
        <p className="mt-2 text-sm text-black/65 dark:text-white/65">Définir le format d'export par défaut.</p>
        <div className="mt-4 grid gap-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Format par défaut</label>
          <select
            value={exportFormat}
            onChange={(event) => setExportFormat(event.target.value as ExportFormat)}
            className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20"
          >
            <option value="PDF">PDF</option>
            <option value="CSV">CSV</option>
            <option value="XLSX">XLSX</option>
          </select>
          <button
            type="button"
            onClick={() => saveLocalPreferences(density, exportFormat)}
            className="mt-2 w-fit rounded-md border border-black/15 px-3 py-2 text-xs font-semibold hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
          >
            Enregistrer les préférences
          </button>
          {prefsStatus ? <p className="text-xs text-black/60 dark:text-white/60">{prefsStatus}</p> : null}
        </div>
      </section>
    </div>
  );
}
