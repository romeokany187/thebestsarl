"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ProcurementInboxActions({ needRequestId }: { needRequestId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

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
      router.refresh();
    } catch {
      setState("error");
      setMessage("Erreur réseau pendant la validation.");
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
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
      {message ? (
        <span className="text-[11px] text-black/60 dark:text-white/60">{message}</span>
      ) : null}
    </div>
  );
}
