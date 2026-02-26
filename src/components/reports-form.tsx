"use client";

import { useState } from "react";

type UserOption = { id: string; name: string; role: string; service: string };

export function ReportsForm({ users }: { users: UserOption[] }) {
  const [status, setStatus] = useState<string>("");
  const [selectedAuthorId, setSelectedAuthorId] = useState<string>(users[0]?.id ?? "");

  const selectedAuthor = users.find((user) => user.id === selectedAuthorId) ?? null;

  async function onSubmit(formData: FormData) {
    setStatus("Enregistrement...");
    const rubricSummary = String(formData.get("rubricSummary") ?? "").trim();
    const rubricTasks = String(formData.get("rubricTasks") ?? "").trim();
    const rubricIssues = String(formData.get("rubricIssues") ?? "").trim();
    const rubricPlan = String(formData.get("rubricPlan") ?? "").trim();

    const content = [
      "Rubrique 1 - Résumé des activités",
      rubricSummary,
      "",
      "Rubrique 2 - Tâches réalisées",
      rubricTasks,
      "",
      "Rubrique 3 - Difficultés rencontrées",
      rubricIssues,
      "",
      "Rubrique 4 - Plan d'action suivant",
      rubricPlan,
    ].join("\n");

    const statusValue = String(formData.get("status") ?? "SUBMITTED");

    const payload = {
      title: formData.get("title"),
      content,
      period: formData.get("period"),
      periodStart: formData.get("periodStart"),
      periodEnd: formData.get("periodEnd"),
      status: statusValue,
      authorId: formData.get("authorId"),
    };

    const response = await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const payloadError = await response.json().catch(() => null);
      const periodEndErrors = payloadError?.error?.fieldErrors?.periodEnd;
      setStatus(
        periodEndErrors?.[0] ?? payloadError?.error ?? "Erreur de validation.",
      );
      return;
    }

    const result = await response.json();
    setStatus("Rapport enregistré.");

    if (statusValue === "SUBMITTED" && result?.data?.id) {
      window.open(`/reports/${result.data.id}/print`, "_blank", "noopener,noreferrer");
    }

    if (response.ok) {
      window.location.reload();
    }
  }

  return (
    <form
      action={async (formData) => {
        await onSubmit(formData);
      }}
      className="grid gap-3 rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900"
    >
      <h3 className="text-sm font-semibold">Nouveau rapport</h3>
      <input name="title" required placeholder="Titre" className="rounded-md border px-3 py-2" />
      <div className="grid gap-3 sm:grid-cols-2">
        <select name="period" className="rounded-md border px-3 py-2" defaultValue="DAILY">
          <option value="DAILY">Journalier</option>
          <option value="WEEKLY">Hebdomadaire</option>
          <option value="MONTHLY">Mensuel</option>
          <option value="ANNUAL">Annuel</option>
        </select>
        <select name="status" className="rounded-md border px-3 py-2" defaultValue="SUBMITTED">
          <option value="DRAFT">Brouillon</option>
          <option value="SUBMITTED">Soumis</option>
        </select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <input name="periodStart" type="date" required className="rounded-md border px-3 py-2" />
        <input name="periodEnd" type="date" required className="rounded-md border px-3 py-2" />
      </div>
      <select
        name="authorId"
        required
        className="rounded-md border px-3 py-2"
        value={selectedAuthorId}
        onChange={(event) => setSelectedAuthorId(event.target.value)}
      >
        <option value="">Sélectionner un employé</option>
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name}
          </option>
        ))}
      </select>
      <div className="rounded-lg border border-black/10 bg-black/5 px-3 py-2 text-xs dark:border-white/10 dark:bg-white/5">
        <p>Fonction: {selectedAuthor?.role ?? "-"}</p>
        <p>Service: {selectedAuthor?.service ?? "-"}</p>
      </div>

      <textarea
        name="rubricSummary"
        required
        placeholder="Rubrique 1: Résumé des activités"
        className="min-h-20 rounded-md border px-3 py-2"
      />
      <textarea
        name="rubricTasks"
        required
        placeholder="Rubrique 2: Tâches réalisées"
        className="min-h-20 rounded-md border px-3 py-2"
      />
      <textarea
        name="rubricIssues"
        required
        placeholder="Rubrique 3: Difficultés rencontrées"
        className="min-h-20 rounded-md border px-3 py-2"
      />
      <textarea
        name="rubricPlan"
        required
        placeholder="Rubrique 4: Plan d'action suivant"
        className="min-h-20 rounded-md border px-3 py-2"
      />
      <button className="rounded-md bg-black px-3 py-2 text-white dark:bg-white dark:text-black">Enregistrer</button>
      <p className="text-xs text-black/60 dark:text-white/60">{status}</p>
    </form>
  );
}
