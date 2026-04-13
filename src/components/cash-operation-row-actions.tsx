"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  cashOperationId: string;
  amount: number;
  currency: string;
  method: string;
  reference: string | null;
  description: string;
  occurredAt: string;
};

export function CashOperationRowActions({
  cashOperationId,
  amount,
  currency,
  method,
  reference,
  description,
  occurredAt,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [editAmount, setEditAmount] = useState<string>(String(amount));
  const [editCurrency, setEditCurrency] = useState<string>(currency ?? "USD");
  const [editMethod, setEditMethod] = useState<string>(method ?? "CASH");
  const [editReference, setEditReference] = useState<string>(reference ?? "");
  const [editDescription, setEditDescription] = useState<string>(description ?? "");
  const [editOccurredAt, setEditOccurredAt] = useState<string>(occurredAt.slice(0, 16));

  async function editOperation() {
    // Open edit modal
    setIsEditing(true);
  }

  async function submitEdit() {
    const nextAmount = Number.parseFloat(editAmount);
    if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
      setMessage("Montant invalide.");
      return;
    }
    const nextCurrency = (editCurrency ?? "USD").trim().toUpperCase();
    if (nextCurrency !== "USD" && nextCurrency !== "CDF") {
      setMessage("Devise invalide.");
      return;
    }
    if (!editMethod?.trim()) {
      setMessage("Méthode invalide.");
      return;
    }
    if (!editReference?.trim()) {
      setMessage("Référence obligatoire.");
      return;
    }
    if (!editDescription?.trim()) {
      setMessage("Libellé obligatoire.");
      return;
    }
    if (!editOccurredAt) {
      setMessage("Date/heure invalide.");
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      const response = await fetch("/api/payments/cash-operations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cashOperationId,
          amount: nextAmount,
          currency: nextCurrency,
          method: editMethod.trim(),
          reference: editReference.trim(),
          description: editDescription.trim(),
          occurredAt: new Date(editOccurredAt).toISOString(),
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(payload?.error ?? "Impossible de modifier cette écriture.");
        return;
      }

      setMessage("Écriture modifiée.");
      setIsEditing(false);
      router.refresh();
    } catch {
      setMessage("Erreur réseau pendant la modification.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteOperation() {
    const confirmed = window.confirm("Supprimer définitivement cette écriture de caisse ?");
    if (!confirmed) return;

    setBusy(true);
    setMessage("");

    try {
      const response = await fetch(`/api/payments/cash-operations?cashOperationId=${encodeURIComponent(cashOperationId)}`, {
        method: "DELETE",
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(payload?.error ?? "Impossible de supprimer cette écriture.");
        return;
      }

      setMessage("Écriture supprimée.");
      router.refresh();
    } catch {
      setMessage("Erreur réseau pendant la suppression.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => void editOperation()}
          disabled={busy}
          className="rounded-md border border-black/20 px-2 py-1 text-[11px] font-semibold hover:bg-black/5 disabled:opacity-60 dark:border-white/20 dark:hover:bg-white/10"
        >
          Modifier
        </button>
        <button
          type="button"
          onClick={() => void deleteOperation()}
          disabled={busy}
          className="rounded-md border border-red-300 px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-700/60 dark:text-red-300 dark:hover:bg-red-950/30"
        >
          Supprimer
        </button>
      </div>
      {message ? <p className="text-[10px] text-black/60 dark:text-white/60">{message}</p> : null}

      {isEditing ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setIsEditing(false)} />
          <form
            onSubmit={(e) => { e.preventDefault(); void submitEdit(); }}
            className="relative z-10 w-full max-w-xl rounded-lg bg-white p-4 shadow-lg dark:bg-zinc-900"
          >
            <h3 className="mb-3 text-sm font-semibold">Modifier l'opération</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs">Montant
                <input className="w-full rounded-md border px-2 py-1" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} />
              </label>
              <label className="text-xs">Devise
                <select className="w-full rounded-md border px-2 py-1" value={editCurrency} onChange={(e) => setEditCurrency(e.target.value)}>
                  <option value="USD">USD</option>
                  <option value="CDF">CDF</option>
                </select>
              </label>
              <label className="text-xs">Méthode
                <input className="w-full rounded-md border px-2 py-1" value={editMethod} onChange={(e) => setEditMethod(e.target.value)} />
              </label>
              <label className="text-xs">Référence
                <input className="w-full rounded-md border px-2 py-1" value={editReference} onChange={(e) => setEditReference(e.target.value)} />
              </label>
              <label className="text-xs sm:col-span-2">Libellé
                <input className="w-full rounded-md border px-2 py-1" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
              </label>
              <label className="text-xs sm:col-span-2">Date/heure
                <input type="datetime-local" className="w-full rounded-md border px-2 py-1" value={editOccurredAt} onChange={(e) => setEditOccurredAt(e.target.value)} />
              </label>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setIsEditing(false)} className="rounded-md border px-3 py-1">Annuler</button>
              <button type="submit" disabled={busy} className="rounded-md bg-black px-3 py-1 text-white">{busy ? "Enregistrement..." : "Enregistrer"}</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
