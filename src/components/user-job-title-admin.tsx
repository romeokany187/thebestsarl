"use client";

import { useMemo, useState } from "react";

type JobTitle =
  | "COMMERCIAL"
  | "COMPTABLE"
  | "AUDITEUR"
  | "CAISSIER"
  | "CAISSE_2_SIEGE"
  | "CAISSE_AGENCE"
  | "RELATION_PUBLIQUE"
  | "APPROVISIONNEMENT"
  | "AGENT_TERRAIN"
  | "DIRECTION_GENERALE"
  | "CHEF_AGENCE";

type UserRole = "ADMIN" | "DIRECTEUR_GENERAL" | "MANAGER" | "EMPLOYEE" | "ACCOUNTANT";

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  jobTitle: JobTitle;
  teamName: string;
};

const roleOptions: Array<{ value: UserRole; label: string }> = [
  { value: "ADMIN", label: "Admin" },
  { value: "DIRECTEUR_GENERAL", label: "Directeur Général" },
  { value: "MANAGER", label: "Chef d'agence" },
  { value: "ACCOUNTANT", label: "Comptable" },
  { value: "EMPLOYEE", label: "Employé" },
];

const jobOptions: Array<{ value: JobTitle; label: string }> = [
  { value: "COMMERCIAL", label: "Commercial" },
  { value: "COMPTABLE", label: "Comptable" },
  { value: "AUDITEUR", label: "Auditeur" },
  { value: "CAISSIER", label: "Caisse 1 Siège" },
  { value: "CAISSE_2_SIEGE", label: "Caisse 2 Siège" },
  { value: "CAISSE_AGENCE", label: "Caisse agence" },
  { value: "RELATION_PUBLIQUE", label: "Relation publique" },
  { value: "APPROVISIONNEMENT", label: "Chargé des approvisionnements" },
  { value: "AGENT_TERRAIN", label: "Non affecté" },
  { value: "DIRECTION_GENERALE", label: "Directeur Général" },
  { value: "CHEF_AGENCE", label: "Chef d'agence" },
];

function roleLabel(role: UserRole) {
  if (role === "ADMIN") return "Admin";
  if (role === "DIRECTEUR_GENERAL") return "Directeur Général";
  if (role === "MANAGER") return "Chef d'agence";
  if (role === "ACCOUNTANT") return "Comptable";
  return "Employé";
}

export function UserJobTitleAdmin({ users }: { users: UserRow[] }) {
  const [rows, setRows] = useState(users);
  const [status, setStatus] = useState<string>("");
  const [savingId, setSavingId] = useState<string>("");

  const hasChanges = useMemo(
    () => rows.some((row, index) => row.jobTitle !== users[index]?.jobTitle || row.role !== users[index]?.role),
    [rows, users],
  );

  function updateJobTitle(userId: string, jobTitle: JobTitle) {
    setRows((prev) => prev.map((row) => (row.id === userId ? { ...row, jobTitle } : row)));
  }

  function updateRole(userId: string, role: UserRole) {
    setRows((prev) => prev.map((row) => (row.id === userId ? { ...row, role } : row)));
  }

  async function saveOne(userId: string) {
    const row = rows.find((item) => item.id === userId);
    if (!row) {
      return;
    }

    setSavingId(userId);
    setStatus("Mise à jour du rôle et de la fonction...");

    const response = await fetch(`/api/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobTitle: row.jobTitle, role: row.role }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setStatus(payload?.error ?? "Échec de mise à jour.");
      setSavingId("");
      return;
    }

    setStatus(`Rôle et/ou fonction mis à jour pour ${row.name}.`);
    setSavingId("");
  }

  async function deleteOne(userId: string) {
    const row = rows.find((item) => item.id === userId);
    if (!row) return;

    const ok = window.confirm(`Supprimer l'utilisateur ${row.name} ? Cette action est irréversible.`);
    if (!ok) return;

    setSavingId(userId);
    setStatus("Suppression de l'utilisateur...");

    const response = await fetch(`/api/users/${userId}`, {
      method: "DELETE",
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      setStatus(payload?.error ?? "Échec de suppression.");
      setSavingId("");
      return;
    }

    setRows((prev) => prev.filter((item) => item.id !== userId));
    setStatus(`Utilisateur supprimé: ${row.name}.`);
    setSavingId("");
  }

  return (
    <section className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
      <div className="mb-3">
        <h2 className="text-lg font-semibold">Attribution des rôles et des fonctions</h2>
        <p className="text-xs text-black/60 dark:text-white/60">
          Le <strong>rôle système</strong> et la <strong>fonction métier</strong> sont désormais indépendants : changer l&apos;un ne modifie plus automatiquement l&apos;autre.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-black/10 dark:border-white/10">
        <table className="min-w-full text-sm">
          <thead className="bg-black/5 dark:bg-white/10">
            <tr>
              <th className="px-3 py-2 text-left">Employé</th>
              <th className="px-3 py-2 text-left">Email</th>
              <th className="px-3 py-2 text-left">Rôle système</th>
              <th className="px-3 py-2 text-left">Service</th>
              <th className="px-3 py-2 text-left">Fonction métier</th>
              <th className="px-3 py-2 text-left">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((user) => (
              <tr key={user.id} className="border-t border-black/5 dark:border-white/10">
                <td className="px-3 py-2">{user.name}</td>
                <td className="px-3 py-2">{user.email}</td>
                <td className="px-3 py-2">
                  <select
                    className="w-full rounded-md border px-2 py-1.5"
                    value={user.role}
                    onChange={(event) => updateRole(user.id, event.target.value as UserRole)}
                  >
                    {roleOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[10px] text-black/55 dark:text-white/55">Actuel: {roleLabel(user.role)}</p>
                </td>
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
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => saveOne(user.id)}
                      disabled={savingId === user.id}
                      className="rounded-md border border-black/15 px-3 py-1.5 text-xs font-semibold hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/20 dark:hover:bg-white/10"
                    >
                      {savingId === user.id ? "Sauvegarde..." : "Enregistrer"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteOne(user.id)}
                      disabled={savingId === user.id}
                      className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-700/60 dark:text-red-300 dark:hover:bg-red-950/30"
                    >
                      Supprimer
                    </button>
                  </div>
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
