"use client";

import { useState } from "react";

type UserOption = { id: string; name: string };
type AirlineOption = { id: string; name: string; code: string };

export function TicketForm({
  users,
  airlines,
}: {
  users: UserOption[];
  airlines: AirlineOption[];
}) {
  const [status, setStatus] = useState<string>("");
  const [statusType, setStatusType] = useState<"idle" | "success" | "error" | "loading">("idle");
  const [selectedAirlineId, setSelectedAirlineId] = useState<string>("");

  const selectedAirline = airlines.find((airline) => airline.id === selectedAirlineId);
  const isAirCongo = selectedAirline?.code === "ACG";

  async function onSubmit(formData: FormData) {
    setStatusType("loading");
    setStatus("Enregistrement...");
    const payload = {
      ticketNumber: formData.get("ticketNumber"),
      customerName: formData.get("customerName"),
      route: formData.get("route"),
      travelClass: formData.get("travelClass"),
      travelDate: formData.get("travelDate"),
      amount: Number(formData.get("amount")),
      baseFareAmount: formData.get("baseFareAmount") ? Number(formData.get("baseFareAmount")) : undefined,
      currency: formData.get("currency"),
      airlineId: formData.get("airlineId"),
      sellerId: formData.get("sellerId"),
      saleNature: formData.get("saleNature"),
      paymentStatus: formData.get("paymentStatus"),
      payerName: (formData.get("payerName") || "") as string,
      agencyMarkupPercent: formData.get("agencyMarkupPercent") ? Number(formData.get("agencyMarkupPercent")) : undefined,
      notes: formData.get("notes") || undefined,
    };

    const response = await fetch("/api/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      setStatusType("success");
      setStatus("Vente enregistrée.");
    } else {
      const errorPayload = await response.json().catch(() => null);
      setStatusType("error");
      setStatus(errorPayload?.error ?? "Erreur de validation.");
    }
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
        <input name="ticketNumber" required placeholder="Code billet (PNR)" className="rounded-md border px-3 py-2" />
        <input name="customerName" required placeholder="Client" className="rounded-md border px-3 py-2" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <input name="route" required placeholder="Itinéraire (ex: BZV-LFW)" className="rounded-md border px-3 py-2" />
        <select name="travelClass" defaultValue="ECONOMY" className="rounded-md border px-3 py-2">
          <option value="ECONOMY">Economy</option>
          <option value="PREMIUM_ECONOMY">Premium Economy</option>
          <option value="BUSINESS">Business</option>
          <option value="FIRST">First</option>
        </select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <input name="travelDate" type="date" required className="rounded-md border px-3 py-2" />
        <select name="saleNature" defaultValue="CASH" className="rounded-md border px-3 py-2">
          <option value="CASH">Cash</option>
          <option value="CREDIT">Crédit</option>
        </select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <input name="amount" type="number" step="0.01" min="0" required placeholder="Montant" className="rounded-md border px-3 py-2" />
        <input
          name="baseFareAmount"
          type="number"
          step="0.01"
          min="0"
          required={isAirCongo}
          placeholder={isAirCongo ? "BaseFare (obligatoire Air Congo)" : "BaseFare (optionnel)"}
          className="rounded-md border px-3 py-2"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <input name="currency" defaultValue="USD" required className="rounded-md border px-3 py-2" />
        <input name="agencyMarkupPercent" type="number" step="0.01" min="0" max="100" defaultValue="0" placeholder="Majoration agence (%)" className="rounded-md border px-3 py-2" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <select
          name="airlineId"
          required
          value={selectedAirlineId}
          onChange={(event) => setSelectedAirlineId(event.target.value)}
          className="rounded-md border px-3 py-2"
        >
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
        <input name="payerName" placeholder="Payant (personne à recouvrer)" className="rounded-md border px-3 py-2" />
      </div>
      {isAirCongo ? (
        <p className="text-xs text-black/60 dark:text-white/60">
          Air Congo: commission fixe 5% sur le BaseFare saisi.
        </p>
      ) : null}
      <textarea name="notes" placeholder="Notes" className="rounded-md border px-3 py-2" />
      <button className="rounded-md bg-black px-3 py-2 text-white dark:bg-white dark:text-black">Enregistrer</button>
      {status ? (
        <p
          aria-live="polite"
          className={`rounded-md px-2 py-1 text-xs ${
            statusType === "error"
              ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
              : statusType === "success"
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                : "text-black/60 dark:text-white/60"
          }`}
        >
          {status}
        </p>
      ) : null}
    </form>
  );
}
