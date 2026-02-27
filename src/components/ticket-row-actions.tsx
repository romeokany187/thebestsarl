"use client";

import { useState } from "react";

type Props = {
  ticket: {
    id: string;
    customerName: string;
    route: string;
    amount: number;
    baseFareAmount: number | null;
    agencyMarkupAmount: number;
    paymentStatus: "PAID" | "UNPAID" | "PARTIAL";
    payerName: string | null;
    notes: string | null;
  };
};

export function TicketRowActions({ ticket }: Props) {
  const [status, setStatus] = useState<string>("");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    customerName: ticket.customerName,
    route: ticket.route,
    amount: String(ticket.amount),
    baseFareAmount: ticket.baseFareAmount ? String(ticket.baseFareAmount) : "",
    agencyMarkupAmount: String(ticket.agencyMarkupAmount ?? 0),
    paymentStatus: ticket.paymentStatus,
    payerName: ticket.payerName ?? "",
    notes: ticket.notes ?? "",
  });

  function updateField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function deleteTicket() {
    const ok = window.confirm("Supprimer ce billet ?");
    if (!ok) {
      return;
    }

    setStatus("Suppression...");
    const response = await fetch(`/api/tickets/${ticket.id}`, { method: "DELETE" });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setStatus(payload?.error ?? "Erreur de suppression.");
      return;
    }

    setStatus("Billet supprimé.");
    window.location.reload();
  }

  async function editTicket() {
    const amount = Number(form.amount);
    const markup = Number(form.agencyMarkupAmount);
    const baseFare = form.baseFareAmount.trim() ? Number(form.baseFareAmount) : undefined;

    if (!Number.isFinite(amount) || amount <= 0) {
      setStatus("Montant billet invalide.");
      return;
    }

    if (!Number.isFinite(markup) || markup < 0) {
      setStatus("Majoration invalide.");
      return;
    }

    if (baseFare !== undefined && (!Number.isFinite(baseFare) || baseFare <= 0)) {
      setStatus("BaseFare invalide.");
      return;
    }

    const payload = {
      customerName: form.customerName,
      route: form.route,
      amount,
      ...(baseFare !== undefined ? { baseFareAmount: baseFare } : {}),
      agencyMarkupAmount: markup,
      paymentStatus: form.paymentStatus,
      payerName: form.payerName,
      notes: form.notes,
    };

    setStatus("Mise à jour...");
    const response = await fetch(`/api/tickets/${ticket.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const result = await response.json().catch(() => null);
      setStatus(result?.error ?? "Erreur de mise à jour.");
      return;
    }

    setStatus("Billet modifié.");
    setEditing(false);
    window.location.reload();
  }

  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setEditing((value) => !value)}
          className="rounded-md border border-black/15 px-2 py-1 text-xs hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
        >
          {editing ? "Fermer" : "Modifier"}
        </button>
        <button
          type="button"
          onClick={deleteTicket}
          className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 dark:border-red-700/60 dark:text-red-300 dark:hover:bg-red-950/40"
        >
          Supprimer
        </button>
      </div>
      {editing ? (
        <div className="grid gap-2 rounded-md border border-black/10 p-2 text-xs dark:border-white/10">
          <input
            value={form.customerName}
            onChange={(event) => updateField("customerName", event.target.value)}
            placeholder="Client"
            className="rounded-md border px-2 py-1"
          />
          <input
            value={form.route}
            onChange={(event) => updateField("route", event.target.value)}
            placeholder="Itinéraire"
            className="rounded-md border px-2 py-1"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              value={form.amount}
              onChange={(event) => updateField("amount", event.target.value)}
              type="number"
              step="0.01"
              min="0"
              placeholder="Montant"
              className="rounded-md border px-2 py-1"
            />
            <input
              value={form.baseFareAmount}
              onChange={(event) => updateField("baseFareAmount", event.target.value)}
              type="number"
              step="0.01"
              min="0"
              placeholder="BaseFare"
              className="rounded-md border px-2 py-1"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              value={form.agencyMarkupAmount}
              onChange={(event) => updateField("agencyMarkupAmount", event.target.value)}
              type="number"
              step="0.01"
              min="0"
              placeholder="Majoration"
              className="rounded-md border px-2 py-1"
            />
            <select
              value={form.paymentStatus}
              onChange={(event) => updateField("paymentStatus", event.target.value as Props["ticket"]["paymentStatus"])}
              className="rounded-md border px-2 py-1"
            >
              <option value="PAID">PAID</option>
              <option value="PARTIAL">PARTIAL</option>
              <option value="UNPAID">UNPAID</option>
            </select>
          </div>
          <input
            value={form.payerName}
            onChange={(event) => updateField("payerName", event.target.value)}
            placeholder="Payant"
            className="rounded-md border px-2 py-1"
          />
          <textarea
            value={form.notes}
            onChange={(event) => updateField("notes", event.target.value)}
            placeholder="Notes"
            className="rounded-md border px-2 py-1"
          />
          <button
            type="button"
            onClick={editTicket}
            className="rounded-md bg-black px-2 py-1 text-xs font-semibold text-white dark:bg-white dark:text-black"
          >
            Enregistrer la modification
          </button>
        </div>
      ) : null}
      {status ? <p className="text-[10px] text-black/55 dark:text-white/55">{status}</p> : null}
    </div>
  );
}
