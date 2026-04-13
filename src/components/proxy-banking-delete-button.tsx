"use client";

import React from "react";

export function ProxyBankingDeleteButton({ id }: { id: string }) {
  return (
    <button
      className="rounded bg-red-600 text-white px-2 py-1 text-xs hover:bg-red-700"
      title="Supprimer cette opération"
      onClick={async (e) => {
        e.preventDefault();
        if (!window.confirm("Confirmer la suppression de cette opération proxy banking ?")) return;
        await fetch(`/api/payments/proxy-banking?id=${id}`, { method: "DELETE" });
        window.location.reload();
      }}
    >
      Supprimer
    </button>
  );
}
