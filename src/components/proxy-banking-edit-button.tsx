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
    try {
      const newAmountRaw = window.prompt("Montant:", amount?.toString() ?? "");
      if (newAmountRaw === null) return; // cancel
      const newAmount = Number(newAmountRaw.trim());
      if (!Number.isFinite(newAmount) || newAmount <= 0) {
        alert("Montant invalide.");
        return;
      }

      const newCurrency = window.prompt("Devise (USD/CDF):", (currency ?? "USD") as string)?.trim().toUpperCase();
      if (!newCurrency || (newCurrency !== "USD" && newCurrency !== "CDF")) {
        alert("Devise invalide. Utilisez USD ou CDF.");
        return;
      }

      const newReference = window.prompt("Référence:", reference ?? "") ?? "";
      const newDescription = window.prompt("Libellé:", description ?? "") ?? "";
      const defaultOccurredAt = occurredAt ? (occurredAt instanceof Date ? occurredAt.toISOString() : String(occurredAt)) : new Date().toISOString();
      const newOccurredAtRaw = window.prompt("Date ISO (laisser vide pour conserver):", defaultOccurredAt);
      const newOccurredAt = newOccurredAtRaw ? newOccurredAtRaw.trim() : undefined;

      const payload: any = { cashOperationId: id };
      payload.amount = newAmount;
      payload.currency = newCurrency;
      payload.reference = newReference.trim();
      payload.description = newDescription.trim();
      if (newOccurredAt) payload.occurredAt = newOccurredAt;
      if (method) payload.method = method;

      const resp = await fetch("/api/payments/proxy-banking", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await resp.json().catch(() => null);
      if (!resp.ok) {
        alert(json?.error ?? "Échec de la modification.");
        return;
      }

      window.location.reload();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      alert("Erreur lors de la modification.");
    }
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
