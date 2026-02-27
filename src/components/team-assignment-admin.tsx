"use client";

import { FormEvent, useMemo, useState } from "react";

type TeamOption = {
  id: string;
  name: string;
};

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  teamId: string | null;
  teamName: string;
};

export function TeamAssignmentAdmin({ users, teams }: { users: UserRow[]; teams: TeamOption[] }) {
  const [rows, setRows] = useState(users);
  const [newTeamName, setNewTeamName] = useState("");
  const [status, setStatus] = useState("");
  const [savingId, setSavingId] = useState("");
  const [creating, setCreating] = useState(false);

  const hasChanges = useMemo(
    () => rows.some((row, index) => row.teamId !== users[index]?.teamId),
    [rows, users],
  );

  function updateTeam(userId: string, nextTeamId: string) {
    setRows((prev) => prev.map((row) => (row.id === userId
      ? {
        ...row,
        teamId: nextTeamId === "NONE" ? null : nextTeamId,
        teamName: nextTeamId === "NONE" ? "Sans équipe" : (teams.find((team) => team.id === nextTeamId)?.name ?? row.teamName),
      }
      : row)));
  }

  async function saveOne(userId: string) {
    const row = rows.find((item) => item.id === userId);
    if (!row) return;

    setSavingId(userId);
    setStatus("Mise à jour de l'affectation...");

    const response = await fetch(`/api/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId: row.teamId }),
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      setStatus(payload?.error ?? "Échec de l'affectation.");
      setSavingId("");
      return;
    }

    setStatus(`Affectation mise à jour pour ${row.name}.`);
    setSavingId("");
  }

  async function createTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newTeamName.trim()) {
      setStatus("Saisissez un nom d'équipe.");
      return;
    }

    setCreating(true);
    setStatus("Création de l'équipe...");

    const response = await fetch("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newTeamName.trim() }),
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      setStatus(payload?.error ?? "Impossible de créer l'équipe.");
      setCreating(false);
      return;
    }

    setStatus("Équipe créée. Recharge la page pour l'utiliser dans les affectations.");
    setNewTeamName("");
    setCreating(false);
  }

  return (
    <section className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
      <h2 className="text-lg font-semibold">Affectation des agents aux équipes</h2>
      <p className="text-xs text-black/60 dark:text-white/60">
        Assignez ou désaffectez un agent d'une équipe opérationnelle.
      </p>

      <form onSubmit={createTeam} className="mt-3 flex flex-wrap gap-2">
        <input
          value={newTeamName}
          onChange={(event) => setNewTeamName(event.target.value)}
          placeholder="Nouvelle équipe"
          className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20"
        />
        <button
          type="submit"
          disabled={creating}
          className="rounded-md bg-black px-3 py-2 text-xs font-semibold text-white dark:bg-white dark:text-black"
        >
          {creating ? "Création..." : "Créer équipe"}
        </button>
      </form>

      <div className="mt-4 overflow-hidden rounded-lg border border-black/10 dark:border-white/10">
        <table className="min-w-full text-sm">
          <thead className="bg-black/5 dark:bg-white/10">
            <tr>
              <th className="px-3 py-2 text-left">Agent</th>
              <th className="px-3 py-2 text-left">Email</th>
              <th className="px-3 py-2 text-left">Rôle</th>
              <th className="px-3 py-2 text-left">Équipe</th>
              <th className="px-3 py-2 text-left">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((user) => (
              <tr key={user.id} className="border-t border-black/5 dark:border-white/10">
                <td className="px-3 py-2">{user.name}</td>
                <td className="px-3 py-2">{user.email}</td>
                <td className="px-3 py-2">{user.role}</td>
                <td className="px-3 py-2">
                  <select
                    className="w-full rounded-md border px-2 py-1.5"
                    value={user.teamId ?? "NONE"}
                    onChange={(event) => updateTeam(user.id, event.target.value)}
                  >
                    <option value="NONE">Sans équipe</option>
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>{team.name}</option>
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
                    {savingId === user.id ? "Sauvegarde..." : "Affecter"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-xs text-black/60 dark:text-white/60">{hasChanges ? "Des changements sont en attente." : status}</p>
    </section>
  );
}
