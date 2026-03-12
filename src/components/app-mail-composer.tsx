"use client";

import { FormEvent, useMemo, useState } from "react";

type Recipient = {
  id: string;
  name: string;
  email: string;
  role: string;
  jobTitle: string;
  teamName?: string | null;
};

type Props = {
  recipients: Recipient[];
  currentUserId: string;
  canBroadcast: boolean;
};

export function AppMailComposer({ recipients, currentUserId, canBroadcast }: Props) {
  const availableRecipients = useMemo(
    () => recipients.filter((recipient) => recipient.id !== currentUserId),
    [recipients, currentUserId],
  );

  const [mode, setMode] = useState<"single" | "broadcast">("single");
  const [recipientUserId, setRecipientUserId] = useState(availableRecipients[0]?.id ?? "");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("");
  const [isSending, setIsSending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (mode === "single" && !recipientUserId) {
      setStatus("Sélectionnez un destinataire.");
      return;
    }

    setIsSending(true);
    setStatus("Envoi en cours...");

    const response = await fetch("/api/mail/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode,
        recipientUserId: mode === "single" ? recipientUserId : undefined,
        subject,
        message,
      }),
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      setIsSending(false);
      setStatus(payload?.error?.formErrors?.[0] ?? payload?.error ?? "Erreur lors de l'envoi du mail.");
      return;
    }

    setIsSending(false);
    setSubject("");
    setMessage("");
    setStatus(`Mail envoyé: ${payload?.data?.delivered ?? 0} livré(s), ${payload?.data?.failed ?? 0} échec(s).`);
  }

  return (
    <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
      <h2 className="text-lg font-semibold">Messagerie email interne</h2>
      <p className="mt-1 text-xs text-black/65 dark:text-white/65">
        Envoyez un email depuis l&apos;application. Les destinataires reçoivent aussi une notification interne.
      </p>

      <form className="mt-4 grid gap-3" onSubmit={onSubmit}>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">
            Mode d&apos;envoi
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value === "broadcast" ? "broadcast" : "single")}
              className="rounded-md border px-3 py-2 text-sm font-normal"
            >
              <option value="single">Destinataire unique</option>
              {canBroadcast ? <option value="broadcast">Diffusion globale</option> : null}
            </select>
          </label>

          {mode === "single" ? (
            <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">
              Destinataire
              <select
                value={recipientUserId}
                onChange={(event) => setRecipientUserId(event.target.value)}
                className="rounded-md border px-3 py-2 text-sm font-normal"
              >
                {availableRecipients.map((recipient) => (
                  <option key={recipient.id} value={recipient.id}>
                    {recipient.name} • {recipient.email}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200">
              Ce message sera envoyé à tous les utilisateurs actifs (sauf vous).
            </p>
          )}
        </div>

        <input
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          placeholder="Objet du mail"
          minLength={3}
          maxLength={180}
          required
          className="rounded-md border px-3 py-2 text-sm"
        />

        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Message à envoyer..."
          minLength={5}
          maxLength={6000}
          required
          rows={6}
          className="rounded-md border px-3 py-2 text-sm"
        />

        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-black/60 dark:text-white/60">{message.length}/6000 caractères</p>
          <button
            type="submit"
            disabled={isSending}
            className="rounded-md bg-black px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-black"
          >
            {isSending ? "Envoi..." : "Envoyer le mail"}
          </button>
        </div>
      </form>

      {status ? <p className="mt-3 text-xs text-black/70 dark:text-white/70">{status}</p> : null}
    </section>
  );
}
