"use client";

import React from "react";

export function ProxyBankingEditButton({
  id,
  amount,
  currency,
  reference,
  description,
  occurredAt,
  method,
}: {
  id: string;
  amount?: number | null;
  currency?: string | null;
  reference?: string | null;
  description?: string | null;
  occurredAt?: string | Date | null;
  method?: string | null;
}) {
  async function handleEdit(e: React.MouseEvent) {
    e.preventDefault();
    // Dispatch an edit event to prefill the central cash operation form.
    const payload = {
      id,
      amount: amount ?? 0,
      currency: currency ?? "USD",
      method: method ?? "CASH",
      reference: reference ?? "",
      description: description ?? "",
      occurredAt: occurredAt ? (occurredAt instanceof Date ? occurredAt.toISOString() : String(occurredAt)) : new Date().toISOString(),
    } as const;

    window.dispatchEvent(new CustomEvent("cashOperation:edit", { detail: payload }));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <button
      className="mr-2 rounded bg-amber-500 text-white px-2 py-1 text-xs hover:bg-amber-600"
      title="Modifier cette opération"
      onClick={handleEdit}
    >
      Modifier
    </button>
  );
}
