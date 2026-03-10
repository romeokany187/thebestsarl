"use client";

import { FormEvent, useEffect, useState } from "react";
import type { AppRole } from "@/lib/rbac";

type Props = {
  role: AppRole;
  initialName: string;
  initialEmail: string;
};

type ExportFormat = "PDF" | "CSV" | "XLSX";

export function SettingsWorkspace({ role, initialName, initialEmail }: Props) {
  const [name, setName] = useState(initialName);
  const [profileStatus, setProfileStatus] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  const [exportFormat, setExportFormat] = useState<ExportFormat>("PDF");
  const [prefsStatus, setPrefsStatus] = useState("");
  const [adminStatus, setAdminStatus] = useState("");
  const [adminDefaultPeriod, setAdminDefaultPeriod] = useState("month");
  const [adminStrictAudit, setAdminStrictAudit] = useState(true);
  const [adminCompactTables, setAdminCompactTables] = useState(false);

  useEffect(() => {
    const savedExport = localStorage.getItem("default-export-format");

    if (savedExport === "PDF" || savedExport === "CSV" || savedExport === "XLSX") {
      setExportFormat(savedExport);
    }

    const savedPeriod = localStorage.getItem("admin-default-period");
    const savedStrict = localStorage.getItem("admin-strict-audit");
    const savedCompact = localStorage.getItem("admin-compact-tables");

    if (savedPeriod === "date" || savedPeriod === "week" || savedPeriod === "month" || savedPeriod === "year") {
      setAdminDefaultPeriod(savedPeriod);
    }
    if (savedStrict === "true" || savedStrict === "false") {
      setAdminStrictAudit(savedStrict === "true");
    }
    if (savedCompact === "true" || savedCompact === "false") {
      setAdminCompactTables(savedCompact === "true");
    }
  }, []);

  function saveLocalPreferences(nextExport: ExportFormat) {
    localStorage.setItem("default-export-format", nextExport);
    setPrefsStatus("Préférences enregistrées sur ce navigateur.");
  }

  function saveAdminPreferences() {
    localStorage.setItem("admin-default-period", adminDefaultPeriod);
    localStorage.setItem("admin-strict-audit", String(adminStrictAudit));
    localStorage.setItem("admin-compact-tables", String(adminCompactTables));
    setAdminStatus("Réglages administrateur enregistrés.");
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
            onClick={() => saveLocalPreferences(exportFormat)}
            className="mt-2 w-fit rounded-md border border-black/15 px-3 py-2 text-xs font-semibold hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
          >
            Enregistrer les préférences
          </button>
          {prefsStatus ? <p className="text-xs text-black/60 dark:text-white/60">{prefsStatus}</p> : null}
        </div>
      </section>

      {role === "ADMIN" ? (
        <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900 md:col-span-2">
          <h2 className="text-lg font-semibold">Pilotage global application (Admin)</h2>
          <p className="mt-2 text-sm text-black/65 dark:text-white/65">
            Espace central pour gérer l&apos;application: administration, affectations, archives, rapports et paramètres opérationnels.
          </p>

          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <a href="/admin" className="rounded-md border border-black/15 px-3 py-2 text-xs font-semibold hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10">Utilisateurs & rôles</a>
            <a href="/teams" className="rounded-md border border-black/15 px-3 py-2 text-xs font-semibold hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10">Équipes & affectations</a>
            <a href="/reports" className="rounded-md border border-black/15 px-3 py-2 text-xs font-semibold hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10">Validation des rapports</a>
            <a href="/archives" className="rounded-md border border-black/15 px-3 py-2 text-xs font-semibold hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10">Politique archives</a>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Période par défaut (pilotage)</label>
              <select
                value={adminDefaultPeriod}
                onChange={(event) => setAdminDefaultPeriod(event.target.value)}
                className="w-full rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20"
              >
                <option value="date">Journalier</option>
                <option value="week">Hebdomadaire</option>
                <option value="month">Mensuel</option>
                <option value="year">Annuel</option>
              </select>
            </div>
            <label className="flex items-center gap-2 rounded-md border border-black/10 px-3 py-2 text-sm dark:border-white/20">
              <input type="checkbox" checked={adminStrictAudit} onChange={(event) => setAdminStrictAudit(event.target.checked)} />
              Audit strict activé
            </label>
            <label className="flex items-center gap-2 rounded-md border border-black/10 px-3 py-2 text-sm dark:border-white/20">
              <input type="checkbox" checked={adminCompactTables} onChange={(event) => setAdminCompactTables(event.target.checked)} />
              Tables compactes (admin)
            </label>
          </div>

          <button
            type="button"
            onClick={saveAdminPreferences}
            className="mt-3 rounded-md bg-black px-4 py-2 text-xs font-semibold text-white dark:bg-white dark:text-black"
          >
            Enregistrer les réglages admin
          </button>
          {adminStatus ? <p className="mt-2 text-xs text-black/60 dark:text-white/60">{adminStatus}</p> : null}
        </section>
      ) : null}
    </div>
  );
}
