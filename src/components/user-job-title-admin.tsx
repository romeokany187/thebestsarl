"use client";

import { useMemo, useState } from "react";

type JobTitle =
  | "COMMERCIAL"
  | "COMPTABLE"
  | "CAISSIERE"
  | "RELATION_PUBLIQUE"
  | "APPROVISIONNEMENT_MARKETING"
  | "AGENT_TERRAIN"
  | "DIRECTION_GENERALE";

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  jobTitle: JobTitle;
  teamName: string;
};

const jobOptions: Array<{ value: JobTitle; label: string }> = [
  { value: "COMMERCIAL", label: "Commercial" },
  { value: "COMPTABLE", label: "Comptable" },
  { value: "CAISSIERE", label: "Caissière" },
  { value: "RELATION_PUBLIQUE", label: "Relation publique" },
  { value: "APPROVISIONNEMENT_MARKETING", label: "Chargé approvisionnements marketing" },
  { value: "AGENT_TERRAIN", label: "Agent de terrain" },
  { value: "DIRECTION_GENERALE", label: "Direction générale" },
];

export function UserJobTitleAdmin({ users }: { users: UserRow[] }) {
  const [rows, setRows] = useState(users);
  const [status, setStatus] = useState<string>("");
  const [savingId, setSavingId] = useState<string>("");

  const hasChanges = useMemo(
    () => rows.some((row, index) => row.jobTitle !== users[index]?.jobTitle),
    [rows, users],
  );

  function updateJobTitle(userId: string, jobTitle: JobTitle) {
    setRows((prev) => prev.map((row) => (row.id === userId ? { ...row, jobTitle } : row)));
  }

  async function saveOne(userId: string) {
    const row = rows.find((item) => item.id === userId);
    if (!row) {
      return;
    }

    setSavingId(userId);
    setStatus("Mise à jour du poste...");

    const response = await fetch(`/api/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobTitle: row.jobTitle }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setStatus(payload?.error ?? "Échec de mise à jour.");
      setSavingId("");
      return;
    }

    setStatus(`Poste mis à jour pour ${row.name}.`);
    setSavingId("");
  }

  return (
    <section className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
      <div className="mb-3">
        <h2 className="text-lg font-semibold">Attribution des postes (admin uniquement)</h2>
        <p className="text-xs text-black/60 dark:text-white/60">
          Les employés ne peuvent pas modifier leur poste. Seul l&apos;admin peut nommer ou changer la fonction.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-black/10 dark:border-white/10">
        <table className="min-w-full text-sm">
          <thead className="bg-black/5 dark:bg-white/10">
            <tr>
              <th className="px-3 py-2 text-left">Employé</th>
              <th className="px-3 py-2 text-left">Email</th>
              <th className="px-3 py-2 text-left">Accès</th>
              <th className="px-3 py-2 text-left">Service</th>
              <th className="px-3 py-2 text-left">Poste</th>
              <th className="px-3 py-2 text-left">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((user) => (
              <tr key={user.id} className="border-t border-black/5 dark:border-white/10">
                <td className="px-3 py-2">{user.name}</td>
                <td className="px-3 py-2">{user.email}</td>
                <td className="px-3 py-2">{user.role}</td>
                <td className="px-3 py-2">{user.teamName}</td>
                <td className="px-3 py-2">
                  <select
                    className="w-full rounded-md border px-2 py-1.5"
                    value={user.jobTitle}
                    onChange={(event) => updateJobTitle(user.id, event.target.value as JobTitle)}
                  >
                    {jobOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => saveOne(user.id)}
                    disabled={savingId === user.id}
                    className="rounded-md border border-black/15 px-3 py-1.5 text-xs font-semibold hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/20 dark:hover:bg-white/10"
                  >
                    {savingId === user.id ? "Sauvegarde..." : "Enregistrer"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-xs text-black/60 dark:text-white/60">{hasChanges ? "Des changements sont en attente de sauvegarde." : status}</p>
      {hasChanges ? <p className="text-xs text-black/60 dark:text-white/60">Clique sur &quot;Enregistrer&quot; pour chaque ligne modifiée.</p> : null}
    </section>
  );
}
