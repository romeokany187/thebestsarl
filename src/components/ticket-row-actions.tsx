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
    const customerName = window.prompt("Client", ticket.customerName);
    if (customerName === null) return;

    const route = window.prompt("Itinéraire", ticket.route);
    if (route === null) return;

    const amountRaw = window.prompt("Montant billet", String(ticket.amount));
    if (amountRaw === null) return;

    const baseFareRaw = window.prompt("BaseFare (laisser vide si non modifié)", ticket.baseFareAmount ? String(ticket.baseFareAmount) : "");
    if (baseFareRaw === null) return;

    const markupRaw = window.prompt("Majoration agence (montant)", String(ticket.agencyMarkupAmount ?? 0));
    if (markupRaw === null) return;

    const paymentStatus = window.prompt("Statut paiement: PAID | UNPAID | PARTIAL", ticket.paymentStatus);
    if (paymentStatus === null) return;

    const payerName = window.prompt("Payant", ticket.payerName ?? "");
    if (payerName === null) return;

    const notes = window.prompt("Notes", ticket.notes ?? "");
    if (notes === null) return;

    const payload = {
      customerName,
      route,
      amount: Number(amountRaw),
      ...(baseFareRaw.trim() ? { baseFareAmount: Number(baseFareRaw) } : {}),
      agencyMarkupAmount: Number(markupRaw),
      paymentStatus,
      payerName,
      notes,
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
    window.location.reload();
  }

  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={editTicket}
          className="rounded-md border border-black/15 px-2 py-1 text-xs hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
        >
          Modifier
        </button>
        <button
          type="button"
          onClick={deleteTicket}
          className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 dark:border-red-700/60 dark:text-red-300 dark:hover:bg-red-950/40"
        >
          Supprimer
        </button>
      </div>
      {status ? <p className="text-[10px] text-black/55 dark:text-white/55">{status}</p> : null}
    </div>
  );
}
