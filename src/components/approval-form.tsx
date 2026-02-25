"use client";

import { useState } from "react";

type UserOption = { id: string; name: string };

export function ApprovalForm({ reportId, managers }: { reportId: string; managers: UserOption[] }) {
  const [status, setStatus] = useState("");

  async function onSubmit(formData: FormData) {
    setStatus("Traitement...");

    const payload = {
      reportId,
      reviewerId: formData.get("reviewerId"),
      reviewerComment: formData.get("reviewerComment") || undefined,
      status: formData.get("status"),
    };

    const response = await fetch("/api/reports/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setStatus(response.ok ? "Décision enregistrée." : "Erreur.");
    if (response.ok) {
      window.location.reload();
    }
  }

  return (
    <form action={onSubmit} className="mt-3 grid gap-2 rounded-md border border-black/10 p-3 dark:border-white/10">
      <div className="grid gap-2 sm:grid-cols-2">
        <select name="reviewerId" required className="rounded-md border px-2 py-1 text-sm">
          <option value="">Manager</option>
          {managers.map((manager) => (
            <option key={manager.id} value={manager.id}>
              {manager.name}
            </option>
          ))}
        </select>
        <select name="status" defaultValue="APPROVED" className="rounded-md border px-2 py-1 text-sm">
          <option value="APPROVED">Approuver</option>
          <option value="REJECTED">Rejeter</option>
        </select>
      </div>
      <input name="reviewerComment" placeholder="Commentaire" className="rounded-md border px-2 py-1 text-sm" />
      <button className="rounded-md bg-black px-2 py-1 text-sm text-white dark:bg-white dark:text-black">Valider</button>
      <p className="text-xs text-black/60 dark:text-white/60">{status}</p>
    </form>
  );
}
