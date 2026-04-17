"use client";

import React from "react";

export function ProxyBankingEditButton({
  eventName,
  payload,
}: {
  eventName: "proxyBanking:edit" | "cashOperation:edit";
  payload: Record<string, unknown>;
}) {
  async function handleEdit(e: React.MouseEvent) {
    e.preventDefault();
    window.dispatchEvent(new CustomEvent(eventName, { detail: payload }));
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
