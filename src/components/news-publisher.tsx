"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function NewsPublisher() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setStatus("Publication en cours...");

    const response = await fetch("/api/news", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, content }),
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      setStatus(payload?.error?.formErrors?.[0] ?? payload?.error ?? "Échec de publication.");
      setLoading(false);
      return;
    }

    setStatus("Nouvelle publiée.");
    setTitle("");
    setContent("");
    setLoading(false);
    router.refresh();
  }

  return (
    <section className="mb-6 rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
      <h2 className="text-base font-semibold">Publier une nouvelle</h2>
      <form onSubmit={onSubmit} className="mt-3 grid gap-3">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Titre"
          required
          className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20"
        />
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="Contenu de la nouvelle"
          required
          rows={5}
          className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20"
        />
        <button
          type="submit"
          disabled={loading}
          className="w-fit rounded-md bg-black px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {loading ? "Publication..." : "Publier"}
        </button>
      </form>
      {status ? <p className="mt-2 text-xs text-black/60 dark:text-white/60">{status}</p> : null}
    </section>
  );
}
