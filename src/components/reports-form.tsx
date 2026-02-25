"use client";

import { useState } from "react";

type UserOption = { id: string; name: string };

export function ReportsForm({ users }: { users: UserOption[] }) {
  const [status, setStatus] = useState<string>("");

  async function onSubmit(formData: FormData) {
    setStatus("Enregistrement...");
    const payload = {
      title: formData.get("title"),
      content: formData.get("content"),
      period: formData.get("period"),
      periodStart: formData.get("periodStart"),
      periodEnd: formData.get("periodEnd"),
      status: formData.get("status"),
      authorId: formData.get("authorId"),
    };

    const response = await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setStatus(response.ok ? "Rapport enregistré." : "Erreur de validation.");
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
      <textarea
        name="content"
        required
        placeholder="Contenu détaillé"
        className="min-h-24 rounded-md border px-3 py-2"
      />
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
      <select name="authorId" required className="rounded-md border px-3 py-2">
        <option value="">Sélectionner un employé</option>
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name}
          </option>
        ))}
      </select>
      <button className="rounded-md bg-black px-3 py-2 text-white dark:bg-white dark:text-black">Enregistrer</button>
      <p className="text-xs text-black/60 dark:text-white/60">{status}</p>
    </form>
  );
}
