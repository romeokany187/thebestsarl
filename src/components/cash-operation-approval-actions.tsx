"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function CashOperationApprovalActions({
  approvalRequestId,
}: {
  approvalRequestId: string;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  async function handleAction(action: "APPROVE" | "REJECT") {
    const reason = action === "REJECT"
      ? window.prompt("Motif du rejet", "Décaissement refusé par la comptabilité")?.trim() ?? ""
      : "";

    if (action === "REJECT" && !reason) {
      return;
    }

    setError("");
    const response = await fetch(`/api/payments/cash-operation-approvals/${approvalRequestId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, reason }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setError(payload?.error ?? "Impossible de traiter la demande.");
      return;
    }

    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void handleAction("APPROVE")}
          disabled={isPending}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          Approuver
        </button>
        <button
          type="button"
          onClick={() => void handleAction("REJECT")}
          disabled={isPending}
          className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-800 dark:text-red-300"
        >
          Rejeter
        </button>
      </div>
      {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  );
}