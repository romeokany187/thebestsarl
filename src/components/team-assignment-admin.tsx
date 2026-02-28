"use client";

import { useMemo, useState } from "react";

type TeamOption = {
  id: string;
  name: string;
  kind: "AGENCE" | "PARTENAIRE";
  createdAt: string;
};

type UserRole = "ADMIN" | "MANAGER" | "EMPLOYEE" | "ACCOUNTANT";

type JobTitle =
  | "COMMERCIAL"
  | "COMPTABLE"
  | "CAISSIERE"
  | "RELATION_PUBLIQUE"
  | "APPROVISIONNEMENT_MARKETING"
  | "AGENT_TERRAIN"
  | "DIRECTION_GENERALE";

const jobOptions: Array<{ value: JobTitle; label: string }> = [
  { value: "COMMERCIAL", label: "Commercial" },
  { value: "COMPTABLE", label: "Comptable" },
  { value: "CAISSIERE", label: "Caissière" },
  { value: "RELATION_PUBLIQUE", label: "Relation publique" },
  { value: "APPROVISIONNEMENT_MARKETING", label: "Approvisionnement marketing" },
  { value: "AGENT_TERRAIN", label: "Agent de terrain" },
  { value: "DIRECTION_GENERALE", label: "Direction générale" },
];

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  teamId: string | null;
  teamName: string;
  jobTitle: JobTitle;
};

function roleLabel(role: UserRole) {
  if (role === "ADMIN") return "Admin";
  if (role === "MANAGER") return "Chef";
  if (role === "ACCOUNTANT") return "Comptable";
  return "Collaborateur";
}

export function TeamAssignmentAdmin({
  users,
  teams,
  actorRole,
  actorTeamName,
}: {
  users: UserRow[];
  teams: TeamOption[];
  actorRole: UserRole;
  actorTeamName?: string | null;
}) {
  const [rows, setRows] = useState(users);
  const [status, setStatus] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState(teams[0]?.id ?? "");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedJobTitle, setSelectedJobTitle] = useState<JobTitle>("AGENT_TERRAIN");
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamKind, setNewTeamKind] = useState<"AGENCE" | "PARTENAIRE">("AGENCE");
  const [savingId, setSavingId] = useState("");
  const [creatingTeam, setCreatingTeam] = useState(false);

  const selectedTeam = teams.find((team) => team.id === selectedTeamId) ?? null;

  const teamMembers = useMemo(
    () => rows.filter((row) => row.teamId === selectedTeamId),
    [rows, selectedTeamId],
  );

  const assignableUsers = useMemo(
    () => rows.filter((row) => row.teamId !== selectedTeamId),
    [rows, selectedTeamId],
  );

  const isManagerOfSelectedTeam = actorRole === "MANAGER" && selectedTeam?.name === actorTeamName;
  const canManageSelectedTeam = actorRole === "ADMIN" || isManagerOfSelectedTeam;

  const currentLeader = useMemo(
    () => teamMembers.find((member) => member.role === "MANAGER") ?? null,
    [teamMembers],
  );

  function applyUpdatedUser(payloadUser: {
    id: string;
    role: UserRole;
    jobTitle: JobTitle;
    team: { id: string; name: string } | null;
  }) {
    setRows((prev) => prev.map((row) => (row.id === payloadUser.id
      ? {
        ...row,
        role: payloadUser.role,
        jobTitle: payloadUser.jobTitle,
        teamId: payloadUser.team?.id ?? null,
        teamName: payloadUser.team?.name ?? "Sans équipe",
      }
      : row)));
  }

  async function assignToSelectedTeam() {
    if (!selectedTeamId || !selectedUserId) {
      setStatus("Sélectionnez une équipe et un collaborateur.");
      return;
    }

    setSavingId(selectedUserId);
    setStatus("Affectation du collaborateur...");

    const response = await fetch(`/api/users/${selectedUserId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId: selectedTeamId, jobTitle: selectedJobTitle }),
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      setStatus(payload?.error ?? "Échec de l'affectation.");
      setSavingId("");
      return;
    }

    if (payload?.data) applyUpdatedUser(payload.data);

    setStatus("Collaborateur affecté avec succès.");
    setSelectedUserId("");
    setSavingId("");
  }

  async function unassignFromTeam(userId: string, currentJobTitle: JobTitle) {
    setSavingId(userId);
    setStatus("Désaffectation en cours...");

    const response = await fetch(`/api/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId: null, jobTitle: currentJobTitle }),
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      setStatus(payload?.error ?? "Échec de la désaffectation.");
      setSavingId("");
      return;
    }

    if (payload?.data) applyUpdatedUser(payload.data);

    setStatus("Collaborateur désaffecté.");
    setSavingId("");
  }

  async function switchLeaderRole(userId: string, makeLeader: boolean, currentJobTitle: JobTitle, currentTeamId: string | null) {
    if (actorRole !== "ADMIN") {
      setStatus("Seul un administrateur peut changer le chef d'équipe.");
      return;
    }

    setSavingId(userId);
    setStatus(makeLeader ? "Nomination du chef..." : "Retrait des privilèges chef...");

    const response = await fetch(`/api/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        teamId: currentTeamId,
        jobTitle: currentJobTitle,
        role: makeLeader ? "MANAGER" : "EMPLOYEE",
      }),
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      setStatus(payload?.error ?? "Échec de mise à jour du chef.");
      setSavingId("");
      return;
    }

    if (payload?.data) applyUpdatedUser(payload.data);

    setStatus(makeLeader ? "Chef d'équipe mis à jour." : "Chef d'équipe retiré.");
    setSavingId("");
  }

  async function createTeam() {
    if (!newTeamName.trim()) {
      setStatus("Donnez un nom à l'équipe.");
      return;
    }

    setCreatingTeam(true);
    setStatus("Création de l'équipe...");

    const response = await fetch("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newTeamName.trim(), kind: newTeamKind }),
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      setStatus(payload?.error ?? "Impossible de créer l'équipe.");
      setCreatingTeam(false);
      return;
    }

    setStatus("Équipe créée. Recharge la page pour la gérer.");
    setNewTeamName("");
    setCreatingTeam(false);
  }

  return (
    <section className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
      <h2 className="text-lg font-semibold">Gestion des groupes (agences & partenaires)</h2>
      <p className="text-xs text-black/60 dark:text-white/60">
        Cliquez sur une équipe pour afficher ses membres, puis affectez, désaffectez ou gérez le chef d'équipe.
      </p>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {teams.map((team) => (
          <button
            key={team.id}
            type="button"
            onClick={() => setSelectedTeamId(team.id)}
            className={`rounded-xl border px-3 py-2 text-left text-sm ${team.id === selectedTeamId
              ? "border-black bg-black/5 dark:border-white dark:bg-white/10"
              : "border-black/10 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
            }`}
          >
            <p className="font-semibold">{team.name}</p>
            <p className="text-[11px] text-black/60 dark:text-white/60">{team.kind}</p>
          </button>
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-black/10 p-3 dark:border-white/10">
        <h3 className="text-sm font-semibold">Créer une équipe</h3>
        <div className="mt-2 grid gap-2 md:grid-cols-4">
          <input
            value={newTeamName}
            onChange={(event) => setNewTeamName(event.target.value)}
            placeholder="Nom de l'agence/partenaire"
            className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20"
          />
          <select
            value={newTeamKind}
            onChange={(event) => setNewTeamKind(event.target.value as "AGENCE" | "PARTENAIRE")}
            className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20"
          >
            <option value="AGENCE">Agence</option>
            <option value="PARTENAIRE">Partenaire</option>
          </select>
          <button
            type="button"
            onClick={createTeam}
            disabled={creatingTeam || actorRole === "ACCOUNTANT"}
            className="rounded-md bg-black px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-black"
          >
            {creatingTeam ? "Création..." : "Créer équipe"}
          </button>
        </div>
      </div>

      {selectedTeam ? (
        <div className="mt-4 rounded-xl border border-black/10 p-4 dark:border-white/10">
          <div className="mb-4 rounded-lg border border-black/10 bg-black/5 p-3 text-xs dark:border-white/10 dark:bg-white/5">
            <p className="font-semibold">Infos du groupe</p>
            <p className="mt-1 text-black/70 dark:text-white/70">Type: {selectedTeam.kind === "PARTENAIRE" ? "Partenaire" : "Agence"}</p>
            <p className="text-black/70 dark:text-white/70">Créé le: {new Date(selectedTeam.createdAt).toLocaleDateString()}</p>
            <p className="text-black/70 dark:text-white/70">Chef actuel: {currentLeader ? `${currentLeader.name} (${currentLeader.email})` : "Aucun chef nommé"}</p>
            <p className="text-black/70 dark:text-white/70">Collaborateurs: {teamMembers.length}</p>
          </div>

          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">{selectedTeam.name} — Membres</h3>
            <span className="rounded-full border border-black/15 bg-black/5 px-2 py-0.5 text-[10px] font-semibold dark:border-white/20 dark:bg-white/10">
              {teamMembers.length} membre(s)
            </span>
          </div>

          <div className="mb-4 grid gap-2 lg:grid-cols-4">
            <select
              value={selectedUserId}
              onChange={(event) => setSelectedUserId(event.target.value)}
              className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20"
            >
              <option value="">Choisir un collaborateur</option>
              {assignableUsers.map((user) => (
                <option key={user.id} value={user.id}>{user.name} ({user.teamName})</option>
              ))}
            </select>

            <select
              value={selectedJobTitle}
              onChange={(event) => setSelectedJobTitle(event.target.value as JobTitle)}
              className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20"
            >
              {jobOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>

            <button
              type="button"
              onClick={assignToSelectedTeam}
              disabled={!canManageSelectedTeam || !selectedUserId || savingId === selectedUserId}
              className="rounded-md border border-black/15 px-3 py-2 text-xs font-semibold hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10"
            >
              Affecter à cette équipe
            </button>
          </div>

          {!canManageSelectedTeam ? (
            <p className="mb-3 text-xs text-amber-600">Vous ne pouvez gérer que votre propre équipe.</p>
          ) : null}

          <ul className="space-y-2">
            {teamMembers.length > 0 ? (
              teamMembers.map((user) => (
                <li key={user.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-black/10 px-3 py-2 text-sm dark:border-white/10">
                  <div>
                    <p className="font-semibold">{user.name}</p>
                    <p className="text-xs text-black/60 dark:text-white/60">{user.email}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-black/15 bg-black/5 px-2 py-0.5 text-[10px] font-semibold dark:border-white/20 dark:bg-white/10">
                      {roleLabel(user.role)}
                    </span>
                    <span className="rounded-full border border-black/15 bg-black/5 px-2 py-0.5 text-[10px] font-semibold dark:border-white/20 dark:bg-white/10">
                      {jobOptions.find((option) => option.value === user.jobTitle)?.label ?? user.jobTitle}
                    </span>
                    <button
                      type="button"
                      onClick={() => unassignFromTeam(user.id, user.jobTitle)}
                      disabled={!canManageSelectedTeam || savingId === user.id}
                      className="rounded-md border border-black/15 px-2.5 py-1 text-[11px] font-semibold hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10"
                    >
                      Désaffecter
                    </button>
                    <button
                      type="button"
                      onClick={() => switchLeaderRole(user.id, user.role !== "MANAGER", user.jobTitle, user.teamId)}
                      disabled={actorRole !== "ADMIN" || savingId === user.id}
                      className="rounded-md border border-black/15 px-2.5 py-1 text-[11px] font-semibold hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10"
                    >
                      {user.role === "MANAGER" ? "Retirer chef" : "Nommer chef"}
                    </button>
                  </div>
                </li>
              ))
            ) : (
              <li className="rounded-lg border border-dashed border-black/20 px-3 py-2 text-xs text-black/55 dark:border-white/20 dark:text-white/55">
                Aucun membre dans cette équipe.
              </li>
            )}
          </ul>
        </div>
      ) : null}

      <p className="mt-3 text-xs text-black/60 dark:text-white/60">{status}</p>
    </section>
  );
}
