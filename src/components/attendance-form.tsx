"use client";

import { useState } from "react";

type UserOption = { id: string; name: string };

export function AttendanceForm({ users }: { users: UserOption[] }) {
  const [status, setStatus] = useState<string>("");

  async function onSubmit(formData: FormData) {
    setStatus("Enregistrement...");
    const payload = {
      userId: formData.get("userId"),
      date: formData.get("date"),
      clockIn: formData.get("clockIn") ? `${formData.get("date")}T${formData.get("clockIn")}:00` : undefined,
      clockOut: formData.get("clockOut") ? `${formData.get("date")}T${formData.get("clockOut")}:00` : undefined,
      latenessMins: Number(formData.get("latenessMins") || 0),
      overtimeMins: Number(formData.get("overtimeMins") || 0),
      notes: formData.get("notes") || undefined,
    };

    const response = await fetch("/api/attendance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setStatus(response.ok ? "Présence enregistrée." : "Erreur de validation.");
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
      <h3 className="text-sm font-semibold">Saisie de présence</h3>
      <select name="userId" required className="rounded-md border px-3 py-2">
        <option value="">Employé</option>
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name}
          </option>
        ))}
      </select>
      <input name="date" type="date" required className="rounded-md border px-3 py-2" />
      <div className="grid gap-3 sm:grid-cols-2">
        <input name="clockIn" type="time" className="rounded-md border px-3 py-2" />
        <input name="clockOut" type="time" className="rounded-md border px-3 py-2" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <input name="latenessMins" type="number" min="0" placeholder="Retard (min)" className="rounded-md border px-3 py-2" />
        <input name="overtimeMins" type="number" min="0" placeholder="Heures supp. (min)" className="rounded-md border px-3 py-2" />
      </div>
      <textarea name="notes" placeholder="Notes" className="rounded-md border px-3 py-2" />
      <button className="rounded-md bg-black px-3 py-2 text-white dark:bg-white dark:text-black">Enregistrer</button>
      <p className="text-xs text-black/60 dark:text-white/60">{status}</p>
    </form>
  );
}
