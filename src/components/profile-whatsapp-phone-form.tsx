"use client";

import { useState } from "react";
import { formatWhatsappPhoneHint } from "@/lib/user-whatsapp-phone";

export function ProfileWhatsappPhoneForm({ initialPhone }: { initialPhone: string | null }) {
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/settings/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ whatsappPhone: phone.trim() || null }),
      });
      const data = (await res.json()) as { error?: string; data?: { whatsappPhone?: string | null } };
      if (!res.ok) {
        setFeedback(data.error ?? "Enregistrement impossible.");
        return;
      }
      const saved = data.data?.whatsappPhone ?? null;
      setPhone(saved ?? "");
      setFeedback(saved ? `Numéro enregistré : ${formatWhatsappPhoneHint(saved) ?? saved}` : "Numéro WhatsApp retiré.");
    } catch {
      setFeedback("Erreur réseau.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 space-y-3">
      <label className="block text-sm">
        <span className="font-semibold">WhatsApp (recouvrement)</span>
        <input
          type="tel"
          name="whatsappPhone"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="+243 81 234 5678"
          className="mt-1 w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
        />
      </label>
      <p className="text-xs text-black/55 dark:text-white/55">
        Utilisé pour recevoir la liste texte des billets lors d&apos;un recouvrement (sans PDF sur WhatsApp).
      </p>
      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {busy ? "Enregistrement…" : "Enregistrer le numéro"}
      </button>
      {feedback ? <p className="text-sm">{feedback}</p> : null}
    </form>
  );
}
