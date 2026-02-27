"use client";

import { useState } from "react";

type Props = {
  ticket: {
    id: string;
    ticketNumber: string;
    airlineId: string;
    sellerId: string;
    customerName: string;
    route: string;
    travelClass: "ECONOMY" | "PREMIUM_ECONOMY" | "BUSINESS" | "FIRST";
    travelDate: string;
    amount: number;
    baseFareAmount: number | null;
    currency: string;
    saleNature: "CASH" | "CREDIT";
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

  function editTicket() {
    window.dispatchEvent(
      new CustomEvent("ticket:edit", {
        detail: ticket,
      }),
    );
    setStatus("Billet chargé dans le formulaire.");
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
