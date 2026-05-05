"use client";

import { useMemo, useState } from "react";

type AccessLevel = "READ" | "WRITE" | "FULL";
type ModuleOption = { value: string; label: string };

type Assignment = {
  id: string;
  userId: string;
  module: string;
  accessLevel: AccessLevel;
  updatedAt: string;
};

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  jobTitle: string;
  teamName: string;
};

function accessLevelLabel(level: AccessLevel) {
  if (level === "READ") return "Lecture seulement";
  if (level === "WRITE") return "Ecriture & lecture";
  return "Acces complet";
}

export function UserAuthorizationsAdmin({
  users,
  modules,
  assignments,
}: {
  users: UserRow[];
  modules: ModuleOption[];
  assignments: Assignment[];
}) {
  const [rows, setRows] = useState(assignments);
  const [status, setStatus] = useState("");
  const [savingKey, setSavingKey] = useState("");
  const [selectedModuleByUser, setSelectedModuleByUser] = useState<Record<string, string>>({});
  const [selectedLevelByUser, setSelectedLevelByUser] = useState<Record<string, AccessLevel>>({});

  const assignmentsByUser = useMemo(() => {
    const map = new Map<string, Assignment[]>();
    for (const assignment of rows) {
      const list = map.get(assignment.userId) ?? [];
      list.push(assignment);
      map.set(assignment.userId, list);
    }
    return map;
  }, [rows]);

  async function saveAccess(userId: string) {
    const module = selectedModuleByUser[userId] ?? modules[0]?.value;
    const accessLevel = selectedLevelByUser[userId] ?? "READ";

    if (!module) {
      setStatus("Aucun module disponible.");
      return;
    }

    const key = `${userId}:${module}`;
    setSavingKey(key);
    setStatus("Mise a jour des autorisations...");

    const response = await fetch("/api/admin/authorizations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, module, accessLevel }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setStatus(payload?.error ?? "Echec de la mise a jour.");
      setSavingKey("");
      return;
    }

    const saved = payload?.data as Assignment;
    setRows((prev) => {
      const next = prev.filter((item) => !(item.userId === saved.userId && item.module === saved.module));
      next.push(saved);
      return next;
    });

    setStatus("Autorisation enregistree.");
    setSavingKey("");
  }

  async function removeAccess(userId: string, module: string) {
    const key = `${userId}:${module}`;
    setSavingKey(key);
    setStatus("Suppression de l'autorisation...");

    const response = await fetch("/api/admin/authorizations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, module, accessLevel: null }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setStatus(payload?.error ?? "Echec de suppression.");
      setSavingKey("");
      return;
    }

    setRows((prev) => prev.filter((item) => !(item.userId === userId && item.module === module)));
    setStatus("Autorisation retiree.");
    setSavingKey("");
  }

  return (
    <section className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">Autorisations par employe</h2>
        <p className="text-xs text-black/60 dark:text-white/60">
          Action 1: choisir le service (module). Action 2: choisir le niveau d&apos;acces.
          <strong> Acces complet</strong> donne les memes possibilites qu&apos;un admin sur le module choisi.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-black/10 dark:border-white/10">
        <div className="tickets-scroll overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-black/5 dark:bg-white/10">
              <tr>
                <th className="px-3 py-2 text-left">Employe</th>
                <th className="px-3 py-2 text-left">Equipe</th>
                <th className="px-3 py-2 text-left">Service a autoriser</th>
                <th className="px-3 py-2 text-left">Niveau d&apos;acces</th>
                <th className="px-3 py-2 text-left">Actions</th>
                <th className="px-3 py-2 text-left">Autorisations actives</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const selectedModule = selectedModuleByUser[user.id] ?? modules[0]?.value ?? "";
                const selectedLevel = selectedLevelByUser[user.id] ?? "READ";
                const userAssignments = assignmentsByUser.get(user.id) ?? [];

                return (
                  <tr key={user.id} className="border-t border-black/5 align-top dark:border-white/10">
                    <td className="px-3 py-2">
                      <p className="font-medium">{user.name}</p>
                      <p className="text-[11px] text-black/60 dark:text-white/60">{user.email}</p>
                      <p className="text-[11px] text-black/55 dark:text-white/55">{user.jobTitle} - {user.role}</p>
                    </td>
                    <td className="px-3 py-2">{user.teamName}</td>
                    <td className="px-3 py-2">
                      <select
                        className="w-full rounded-md border px-2 py-1.5"
                        value={selectedModule}
                        onChange={(event) => {
                          const value = event.target.value;
                          setSelectedModuleByUser((prev) => ({ ...prev, [user.id]: value }));
                        }}
                      >
                        {modules.map((moduleOption) => (
                          <option key={moduleOption.value} value={moduleOption.value}>
                            {moduleOption.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        className="w-full rounded-md border px-2 py-1.5"
                        value={selectedLevel}
                        onChange={(event) => {
                          const value = event.target.value as AccessLevel;
                          setSelectedLevelByUser((prev) => ({ ...prev, [user.id]: value }));
                        }}
                      >
                        <option value="READ">Lecture seulement</option>
                        <option value="WRITE">Ecriture & lecture</option>
                        <option value="FULL">Acces complet</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => void saveAccess(user.id)}
                        disabled={savingKey === `${user.id}:${selectedModule}`}
                        className="rounded-md border border-black/15 px-3 py-1.5 text-xs font-semibold hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/20 dark:hover:bg-white/10"
                      >
                        {savingKey === `${user.id}:${selectedModule}` ? "Enregistrement..." : "Donner / Modifier"}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      {userAssignments.length === 0 ? (
                        <span className="text-[11px] text-black/55 dark:text-white/55">Aucune autorisation specifique</span>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {userAssignments.map((assignment) => {
                            const moduleLabel = modules.find((item) => item.value === assignment.module)?.label ?? assignment.module;
                            return (
                              <span
                                key={assignment.id}
                                className="inline-flex items-center gap-2 rounded-full border border-black/15 px-2 py-1 text-[11px] dark:border-white/20"
                              >
                                <span>{moduleLabel} - {accessLevelLabel(assignment.accessLevel)}</span>
                                <button
                                  type="button"
                                  onClick={() => void removeAccess(user.id, assignment.module)}
                                  disabled={savingKey === `${user.id}:${assignment.module}`}
                                  className="rounded-full border border-red-300 px-1.5 text-[10px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-700/60 dark:text-red-300 dark:hover:bg-red-950/30"
                                >
                                  Retirer
                                </button>
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-3 text-xs text-black/60 dark:text-white/60">{status}</p>
    </section>
  );
}
