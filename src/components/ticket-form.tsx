"use client";

import { useEffect, useMemo, useState } from "react";

type UserOption = { id: string; name: string };
type AirlineOption = { id: string; name: string; code: string };

type EditableTicket = {
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

type FormState = {
  ticketNumber: string;
  customerName: string;
  route: string;
  travelClass: "ECONOMY" | "PREMIUM_ECONOMY" | "BUSINESS" | "FIRST";
  travelDate: string;
  amount: string;
  baseFareAmount: string;
  currency: string;
  airlineId: string;
  sellerId: string;
  saleNature: "CASH" | "CREDIT";
  paymentStatus: "PAID" | "UNPAID" | "PARTIAL";
  payerName: string;
  agencyMarkupAmount: string;
  notes: string;
};

const EMPTY_FORM: FormState = {
  ticketNumber: "",
  customerName: "",
  route: "",
  travelClass: "ECONOMY" as const,
  travelDate: "",
  amount: "",
  baseFareAmount: "",
  currency: "USD",
  airlineId: "",
  sellerId: "",
  saleNature: "CASH" as const,
  paymentStatus: "UNPAID" as const,
  payerName: "",
  agencyMarkupAmount: "0",
  notes: "",
};

export function TicketForm({
  users,
  airlines,
}: {
  users: UserOption[];
  airlines: AirlineOption[];
}) {
  const [status, setStatus] = useState<string>("");
  const [statusType, setStatusType] = useState<"idle" | "success" | "error" | "loading">("idle");
  const [editTicketId, setEditTicketId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM });

  useEffect(() => {
    function handleEdit(event: Event) {
      const customEvent = event as CustomEvent<EditableTicket>;
      const ticket = customEvent.detail;
      if (!ticket) {
        return;
      }

      setEditTicketId(ticket.id);
      setForm({
        ticketNumber: ticket.ticketNumber,
        customerName: ticket.customerName,
        route: ticket.route,
        travelClass: ticket.travelClass,
        travelDate: ticket.travelDate,
        amount: String(ticket.amount),
        baseFareAmount: ticket.baseFareAmount ? String(ticket.baseFareAmount) : "",
        currency: ticket.currency,
        airlineId: ticket.airlineId,
        sellerId: ticket.sellerId,
        saleNature: ticket.saleNature,
        paymentStatus: ticket.paymentStatus,
        payerName: ticket.payerName ?? "",
        agencyMarkupAmount: String(ticket.agencyMarkupAmount ?? 0),
        notes: ticket.notes ?? "",
      });

      setStatusType("idle");
      setStatus("Billet chargé dans le formulaire. Modifiez puis validez.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    window.addEventListener("ticket:edit", handleEdit);
    return () => window.removeEventListener("ticket:edit", handleEdit);
  }, []);

  const selectedAirline = useMemo(
    () => airlines.find((airline) => airline.id === form.airlineId),
    [airlines, form.airlineId],
  );

  const isAirCongo = selectedAirline?.code === "ACG";
  const isMontGabaon = selectedAirline?.code === "MGB";
  const isEthiopian = selectedAirline?.code === "ET";
  const isAirFast = selectedAirline?.code === "FST";

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function resetForm() {
    setForm({ ...EMPTY_FORM });
    setEditTicketId(null);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatusType("loading");
    setStatus(editTicketId ? "Mise à jour..." : "Enregistrement...");

    const amount = Number(form.amount);
    const baseFareAmount = form.baseFareAmount.trim() ? Number(form.baseFareAmount) : undefined;
    const agencyMarkupAmount = form.agencyMarkupAmount.trim() ? Number(form.agencyMarkupAmount) : 0;

    const payload = {
      ticketNumber: form.ticketNumber,
      customerName: form.customerName,
      route: form.route,
      travelClass: form.travelClass,
      travelDate: form.travelDate,
      amount,
      ...(baseFareAmount !== undefined ? { baseFareAmount } : {}),
      currency: form.currency,
      airlineId: form.airlineId,
      sellerId: form.sellerId,
      saleNature: form.saleNature,
      paymentStatus: form.paymentStatus,
      payerName: form.payerName,
      agencyMarkupAmount,
      notes: form.notes || undefined,
    };

    const response = await fetch(editTicketId ? `/api/tickets/${editTicketId}` : "/api/tickets", {
      method: editTicketId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      setStatusType("success");
      setStatus(editTicketId ? "Billet modifié." : "Vente enregistrée.");
      resetForm();
      window.location.reload();
      return;
    }

    const errorPayload = await response.json().catch(() => null);
    setStatusType("error");
    setStatus(errorPayload?.error ?? "Erreur de validation.");
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid gap-3 rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{editTicketId ? "Modifier un billet" : "Nouvelle vente billet"}</h3>
        {editTicketId ? (
          <button
            type="button"
            onClick={resetForm}
            className="rounded-md border border-black/15 px-2 py-1 text-xs hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Annuler l'édition
          </button>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <input
          name="ticketNumber"
          required
          value={form.ticketNumber}
          onChange={(event) => updateField("ticketNumber", event.target.value)}
          placeholder="Code billet (PNR)"
          className="rounded-md border px-3 py-2"
        />
        <input
          name="customerName"
          required
          value={form.customerName}
          onChange={(event) => updateField("customerName", event.target.value)}
          placeholder="Client"
          className="rounded-md border px-3 py-2"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <input
          name="route"
          required
          value={form.route}
          onChange={(event) => updateField("route", event.target.value)}
          placeholder="Itinéraire (ex: BZV-LFW)"
          className="rounded-md border px-3 py-2"
        />
        <select
          name="travelClass"
          value={form.travelClass}
          onChange={(event) => updateField("travelClass", event.target.value as typeof form.travelClass)}
          className="rounded-md border px-3 py-2"
        >
          <option value="ECONOMY">Economy</option>
          <option value="PREMIUM_ECONOMY">Premium Economy</option>
          <option value="BUSINESS">Business</option>
          <option value="FIRST">First</option>
        </select>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <input
          name="travelDate"
          type="date"
          required
          value={form.travelDate}
          onChange={(event) => updateField("travelDate", event.target.value)}
          className="rounded-md border px-3 py-2"
        />
        <select
          name="saleNature"
          value={form.saleNature}
          onChange={(event) => updateField("saleNature", event.target.value as typeof form.saleNature)}
          className="rounded-md border px-3 py-2"
        >
          <option value="CASH">Cash</option>
          <option value="CREDIT">Crédit</option>
        </select>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <input
          name="amount"
          type="number"
          step="0.01"
          min="0"
          required
          value={form.amount}
          onChange={(event) => updateField("amount", event.target.value)}
          placeholder="Montant"
          className="rounded-md border px-3 py-2"
        />
        <input
          name="baseFareAmount"
          type="number"
          step="0.01"
          min="0"
          required={isAirCongo || isMontGabaon || isEthiopian}
          value={form.baseFareAmount}
          onChange={(event) => updateField("baseFareAmount", event.target.value)}
          placeholder={isAirCongo || isMontGabaon || isEthiopian ? "BaseFare (obligatoire)" : "BaseFare (optionnel)"}
          className="rounded-md border px-3 py-2"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <input
          name="currency"
          required
          value={form.currency}
          onChange={(event) => updateField("currency", event.target.value)}
          className="rounded-md border px-3 py-2"
        />
        <input
          name="agencyMarkupAmount"
          type="number"
          step="0.01"
          min="0"
          value={form.agencyMarkupAmount}
          onChange={(event) => updateField("agencyMarkupAmount", event.target.value)}
          placeholder="Majoration agence (montant USD)"
          className="rounded-md border px-3 py-2"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <select
          name="airlineId"
          required
          value={form.airlineId}
          onChange={(event) => updateField("airlineId", event.target.value)}
          className="rounded-md border px-3 py-2"
        >
          <option value="">Compagnie</option>
          {airlines.map((airline) => (
            <option key={airline.id} value={airline.id}>
              {airline.code} - {airline.name}
            </option>
          ))}
        </select>
        <select
          name="sellerId"
          required
          value={form.sellerId}
          onChange={(event) => updateField("sellerId", event.target.value)}
          className="rounded-md border px-3 py-2"
        >
          <option value="">Vendeur</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <select
          name="paymentStatus"
          value={form.paymentStatus}
          onChange={(event) => updateField("paymentStatus", event.target.value as typeof form.paymentStatus)}
          className="rounded-md border px-3 py-2"
        >
          <option value="PAID">Payé</option>
          <option value="PARTIAL">Partiel</option>
          <option value="UNPAID">Non payé</option>
        </select>
        <input
          name="payerName"
          value={form.payerName}
          onChange={(event) => updateField("payerName", event.target.value)}
          placeholder="Payant (personne à recouvrer)"
          className="rounded-md border px-3 py-2"
        />
      </div>

      {isAirCongo ? (
        <p className="text-xs text-black/60 dark:text-white/60">
          Air Congo: commission fixe 5% sur le BaseFare saisi.
        </p>
      ) : null}
      {isMontGabaon ? (
        <p className="text-xs text-black/60 dark:text-white/60">
          Mont Gabaon: commission fixe 9% sur le BaseFare saisi.
        </p>
      ) : null}
      {isEthiopian ? (
        <p className="text-xs text-black/60 dark:text-white/60">
          Ethiopian: commission = 5% du BaseFare + majoration (montant).
        </p>
      ) : null}
      {isAirFast ? (
        <p className="text-xs text-black/60 dark:text-white/60">
          Air Fast: après 12 billets vendus, le 13ème est compté comme commission.
        </p>
      ) : null}

      <textarea
        name="notes"
        value={form.notes}
        onChange={(event) => updateField("notes", event.target.value)}
        placeholder="Notes"
        className="rounded-md border px-3 py-2"
      />

      <button className="rounded-md bg-black px-3 py-2 text-white dark:bg-white dark:text-black">
        {editTicketId ? "Mettre à jour" : "Enregistrer"}
      </button>

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
