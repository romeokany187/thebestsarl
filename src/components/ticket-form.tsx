"use client";

import { useState } from "react";

type UserOption = { id: string; name: string };
type AirlineOption = { id: string; name: string; code: string; defaultRate: number };

export function TicketForm({
  users,
  airlines,
}: {
  users: UserOption[];
  airlines: AirlineOption[];
}) {
  const [status, setStatus] = useState<string>("");

  async function onSubmit(formData: FormData) {
    setStatus("Enregistrement...");
    const payload = {
      ticketNumber: formData.get("ticketNumber"),
      customerName: formData.get("customerName"),
      route: formData.get("route"),
      travelDate: formData.get("travelDate"),
      amount: Number(formData.get("amount")),
      currency: formData.get("currency"),
      airlineId: formData.get("airlineId"),
      sellerId: formData.get("sellerId"),
      paymentStatus: formData.get("paymentStatus"),
      commissionRateUsed: Number(formData.get("commissionRateUsed")),
      notes: formData.get("notes") || undefined,
    };

    const response = await fetch("/api/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setStatus(response.ok ? "Vente enregistrée." : "Erreur de validation.");
    if (response.ok) {
      window.location.reload();
    }
  }

  return (
    <form
      action={async (formData) => {
        await onSubmit(formData);
      }}
      className="grid gap-3 rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900"
    >
      <h3 className="text-sm font-semibold">Nouvelle vente billet</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <input name="ticketNumber" required placeholder="Numéro billet" className="rounded-md border px-3 py-2" />
        <input name="customerName" required placeholder="Client" className="rounded-md border px-3 py-2" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <input name="route" required placeholder="Trajet (ex: CDG-DKR)" className="rounded-md border px-3 py-2" />
        <input name="travelDate" type="date" required className="rounded-md border px-3 py-2" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <input name="amount" type="number" step="0.01" min="0" required placeholder="Montant" className="rounded-md border px-3 py-2" />
        <input name="currency" defaultValue="EUR" required className="rounded-md border px-3 py-2" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <select name="airlineId" required className="rounded-md border px-3 py-2">
          <option value="">Compagnie</option>
          {airlines.map((airline) => (
            <option key={airline.id} value={airline.id}>
              {airline.code} - {airline.name}
            </option>
          ))}
        </select>
        <select name="sellerId" required className="rounded-md border px-3 py-2">
          <option value="">Vendeur</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <select name="paymentStatus" defaultValue="UNPAID" className="rounded-md border px-3 py-2">
          <option value="PAID">Payé</option>
          <option value="PARTIAL">Partiel</option>
          <option value="UNPAID">Non payé</option>
        </select>
        <input name="commissionRateUsed" type="number" step="0.01" min="0" max="100" defaultValue={airlines[0]?.defaultRate ?? 5} className="rounded-md border px-3 py-2" />
      </div>
      <textarea name="notes" placeholder="Notes" className="rounded-md border px-3 py-2" />
      <button className="rounded-md bg-black px-3 py-2 text-white dark:bg-white dark:text-black">Enregistrer</button>
      <p className="text-xs text-black/60 dark:text-white/60">{status}</p>
    </form>
  );
}
