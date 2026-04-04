"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ProcurementInboxActions({ needRequestId }: { needRequestId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [reviewComment, setReviewComment] = useState("");

  async function decide(status: "APPROVED" | "REJECTED") {
    setState("loading");
    setMessage("");

    try {
      const response = await fetch("/api/procurement/needs/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          needRequestId,
          status,
          reviewComment: reviewComment.trim() || undefined,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setState("error");
        setMessage(payload?.error ?? "Impossible d'enregistrer la décision.");
        return;
      }

      setState("success");
      setMessage(status === "APPROVED" ? "État de besoin approuvé." : "État de besoin rejeté.");
      setReviewComment("");
      router.refresh();
    } catch {
      setState("error");
      setMessage("Erreur réseau pendant la validation.");
    }
  }

  return (
    <div className="mt-2 space-y-2">
      <textarea
        value={reviewComment}
        onChange={(event) => setReviewComment(event.target.value)}
        rows={3}
        maxLength={500}
        placeholder="Commentaire de décision"
        disabled={state === "loading"}
        className="w-full rounded-md border border-black/15 px-2.5 py-2 text-[11px] text-black dark:border-white/15 dark:bg-zinc-900 dark:text-white"
      />
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={`/api/procurement/needs/${needRequestId}/pdf`}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-black/20 px-2.5 py-1 text-[11px] font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
        >
          Lire PDF EDB
        </a>
        <button
          type="button"
          onClick={() => void decide("APPROVED")}
          disabled={state === "loading"}
          className="rounded-md border border-emerald-300 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-60 dark:border-emerald-700/60 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
        >
          Approuver
        </button>
        <button
          type="button"
          onClick={() => void decide("REJECTED")}
          disabled={state === "loading"}
          className="rounded-md border border-red-300 px-2.5 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-700/60 dark:text-red-300 dark:hover:bg-red-950/30"
        >
          Rejeter
        </button>
      </div>
      {message ? (
        <span className="text-[11px] text-black/60 dark:text-white/60">{message}</span>
      ) : null}
    </div>
  );
}
