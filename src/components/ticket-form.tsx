"use client";

import { useEffect, useMemo, useState } from "react";
import { defaultTravelMessage, extractTicketItinerary, getPlainTicketNotes, mergeTicketNotesWithItinerary, type TicketItineraryData } from "@/lib/ticket-itinerary";

type UserOption = { id: string; name: string };
type AirlineOption = { id: string; name: string; code: string };
type TeamOption = { id: string; name: string; kind: "AGENCE" | "PARTENAIRE" };
type DepositAccountOption = { key: string; label: string; airlineCodes: string[]; balance: number };

type EditableTicket = {
  id: string;
  ticketNumber: string;
  airlineId: string;
  sellerId: string | null;
  customerName: string;
  route: string;
  travelClass: "ECONOMY" | "PREMIUM_ECONOMY" | "BUSINESS" | "FIRST";
  travelDate: string;
  amount: number;
  baseFareAmount: number | null;
  currency: string;
  saleNature: "CASH" | "CREDIT";
  agencyMarkupPercent: number;
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

type ItineraryFormState = {
  departureAirport: string;
  arrivalAirport: string;
  departureAt: string;
  arrivalAt: string;
  layoverHours: string;
  checkInAt: string;
  travelMessage: string;
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

function todayDateInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function toDateTimeLocalValue(value?: string | null) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const offsetMs = parsed.getTimezoneOffset() * 60000;
  return new Date(parsed.getTime() - offsetMs).toISOString().slice(0, 16);
}

function formatApiError(error: unknown, fallback = "Erreur de validation.") {
  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (error && typeof error === "object") {
    const payload = error as {
      formErrors?: string[];
      fieldErrors?: Record<string, string[] | undefined>;
    };

    const messages = [
      ...(payload.formErrors ?? []),
      ...Object.values(payload.fieldErrors ?? {}).flatMap((value) => value ?? []),
    ].filter((value) => typeof value === "string" && value.trim().length > 0);

    if (messages.length > 0) {
      return messages.join(" • ");
    }
  }

  return fallback;
}

function buildItineraryForm(ticket?: Pick<EditableTicket, "customerName" | "notes"> | null): ItineraryFormState {
  const itinerary = extractTicketItinerary(ticket?.notes ?? null);
  return {
    departureAirport: itinerary?.departureAirport ?? "",
    arrivalAirport: itinerary?.arrivalAirport ?? "",
    departureAt: toDateTimeLocalValue(itinerary?.departureAt),
    arrivalAt: toDateTimeLocalValue(itinerary?.arrivalAt),
    layoverHours: itinerary?.layoverHours != null ? String(itinerary.layoverHours) : "",
    checkInAt: toDateTimeLocalValue(itinerary?.checkInAt),
    travelMessage: itinerary?.travelMessage ?? defaultTravelMessage(ticket?.customerName),
  };
}

export function TicketForm({
  users,
  airlines,
  teams,
  depositAccounts = [],
  allowAdminEncodingDate = false,
}: {
  users: UserOption[];
  airlines: AirlineOption[];
  teams: TeamOption[];
  depositAccounts?: DepositAccountOption[];
  allowAdminEncodingDate?: boolean;
}) {
  const [status, setStatus] = useState<string>("");
  const [statusType, setStatusType] = useState<"idle" | "success" | "error" | "loading">("idle");
  const [editTicketId, setEditTicketId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM, travelDate: todayDateInputValue() });
  const [storedItinerary, setStoredItinerary] = useState<TicketItineraryData | null>(null);
  const [itineraryNotesBase, setItineraryNotesBase] = useState<string>("");
  const [itineraryTicketId, setItineraryTicketId] = useState<string | null>(null);
  const [itineraryTicketLabel, setItineraryTicketLabel] = useState<string>("");
  const [itineraryForm, setItineraryForm] = useState<ItineraryFormState>(buildItineraryForm());
  const [isItineraryOpen, setIsItineraryOpen] = useState(false);
  const [isSavingItinerary, setIsSavingItinerary] = useState(false);
  const [balancePreviewByKey, setBalancePreviewByKey] = useState<Record<string, number>>({});
  const [balancePreviewDate, setBalancePreviewDate] = useState<string>("");
  const [isLoadingBalancePreview, setIsLoadingBalancePreview] = useState(false);

  useEffect(() => {
    function openItineraryModal(ticket: EditableTicket) {
      setItineraryTicketId(ticket.id);
      setItineraryTicketLabel(`${ticket.ticketNumber} • ${ticket.customerName}`);
      setItineraryNotesBase(getPlainTicketNotes(ticket.notes ?? ""));
      setStoredItinerary(extractTicketItinerary(ticket.notes ?? null));
      setItineraryForm(buildItineraryForm(ticket));
      setIsItineraryOpen(true);
      setStatusType("success");
      setStatus("Renseignez ou modifiez maintenant l’itinérance du client.");
    }

    function handleEdit(event: Event) {
      const customEvent = event as CustomEvent<EditableTicket>;
      const ticket = customEvent.detail;
      if (!ticket) {
        return;
      }

      setEditTicketId(ticket.id);
      setStoredItinerary(extractTicketItinerary(ticket.notes ?? null));
      setItineraryNotesBase(getPlainTicketNotes(ticket.notes ?? ""));
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
        sellerId: ticket.sellerId ?? "",
        saleNature: ticket.saleNature,
        paymentStatus: ticket.paymentStatus,
        payerName: ticket.payerName ?? "",
        agencyMarkupAmount: String(ticket.agencyMarkupAmount ?? 0),
        notes: getPlainTicketNotes(ticket.notes ?? ""),
      });

      setStatusType("idle");
      setStatus("Billet chargé dans le formulaire. Modifiez puis validez.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    function handleItinerary(event: Event) {
      const customEvent = event as CustomEvent<EditableTicket>;
      const ticket = customEvent.detail;
      if (!ticket) {
        return;
      }
      openItineraryModal(ticket);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    window.addEventListener("ticket:edit", handleEdit);
    window.addEventListener("ticket:itinerary", handleItinerary);
    return () => {
      window.removeEventListener("ticket:edit", handleEdit);
      window.removeEventListener("ticket:itinerary", handleItinerary);
    };
  }, []);

  const selectedAirline = useMemo(
    () => airlines.find((airline) => airline.id === form.airlineId),
    [airlines, form.airlineId],
  );

  const isAirCongo = selectedAirline?.code === "ACG";
  const isMontGabaon = selectedAirline?.code === "MGB";
  const isAirFast = selectedAirline?.code === "FST";
  const selectedDepositAccount = useMemo(
    () => depositAccounts.find((account) => selectedAirline?.code ? account.airlineCodes.includes(selectedAirline.code) : false) ?? null,
    [depositAccounts, selectedAirline],
  );
  const requestedTicketAmount = Number(form.amount) || 0;
  const selectedPreviewBalance = selectedDepositAccount ? balancePreviewByKey[selectedDepositAccount.key] : undefined;
  const effectiveDepositBalance = typeof selectedPreviewBalance === "number" ? selectedPreviewBalance : selectedDepositAccount?.balance;
  const isBackdatedAdminEntry = allowAdminEncodingDate && Boolean(form.travelDate) && form.travelDate !== todayDateInputValue();

  const clientPayerValue = useMemo(() => {
    const customer = form.customerName.trim();
    return customer ? `Client - ${customer}` : "Client - Direct";
  }, [form.customerName]);

  const agentPayerOptions = useMemo(
    () => users.map((user) => `Agent - ${user.name}`),
    [users],
  );

  const teamPayerOptions = useMemo(
    () => teams.map((team) => `Équipe - ${team.name}`),
    [teams],
  );

  const payerOptions = useMemo(
    () => [clientPayerValue, ...agentPayerOptions, ...teamPayerOptions],
    [clientPayerValue, agentPayerOptions, teamPayerOptions],
  );

  useEffect(() => {
    setForm((prev) => { // eslint-disable-line react-hooks/set-state-in-effect
      if (!prev.payerName) {
        return { ...prev, payerName: clientPayerValue };
      }

      if (prev.payerName.startsWith("Client - ") && prev.payerName !== clientPayerValue) {
        return { ...prev, payerName: clientPayerValue };
      }

      return prev;
    });
  }, [clientPayerValue]);

  useEffect(() => {
    if (!allowAdminEncodingDate || !form.travelDate) {
      setBalancePreviewByKey({});
      setBalancePreviewDate("");
      return;
    }

    const controller = new AbortController();
    setIsLoadingBalancePreview(true);

    fetch(`/api/airline-deposits?asOfDate=${encodeURIComponent(form.travelDate)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("BALANCE_PREVIEW_FAILED");
        }
        return response.json();
      })
      .then((payload) => {
        const nextBalances = Object.fromEntries(
          Array.isArray(payload?.data)
            ? payload.data.map((account: { key: string; balance: number }) => [account.key, Number(account.balance) || 0])
            : [],
        ) as Record<string, number>;
        setBalancePreviewByKey(nextBalances);
        setBalancePreviewDate(typeof payload?.asOfDate === "string" ? payload.asOfDate : form.travelDate);
      })
      .catch((error: unknown) => {
        if ((error as { name?: string })?.name === "AbortError") {
          return;
        }
        setBalancePreviewByKey({});
        setBalancePreviewDate("");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoadingBalancePreview(false);
        }
      });

    return () => controller.abort();
  }, [allowAdminEncodingDate, form.travelDate]);

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function resetForm() {
    setForm({ ...EMPTY_FORM, travelDate: todayDateInputValue() });
    setEditTicketId(null);
    setStoredItinerary(null);
    setItineraryNotesBase("");
  }

  function updateItineraryField<K extends keyof ItineraryFormState>(key: K, value: ItineraryFormState[K]) {
    setItineraryForm((prev) => ({ ...prev, [key]: value }));
  }

  async function saveItinerary() {
    if (!itineraryTicketId) {
      return;
    }

    setIsSavingItinerary(true);
    const itineraryPayload: TicketItineraryData = {
      departureAirport: itineraryForm.departureAirport.trim() || undefined,
      arrivalAirport: itineraryForm.arrivalAirport.trim() || undefined,
      departureAt: itineraryForm.departureAt ? new Date(itineraryForm.departureAt).toISOString() : undefined,
      arrivalAt: itineraryForm.arrivalAt ? new Date(itineraryForm.arrivalAt).toISOString() : undefined,
      layoverHours: itineraryForm.layoverHours.trim() ? Number(itineraryForm.layoverHours) : undefined,
      checkInAt: itineraryForm.checkInAt ? new Date(itineraryForm.checkInAt).toISOString() : undefined,
      travelMessage: itineraryForm.travelMessage.trim() || undefined,
    };

    const mergedNotes = mergeTicketNotesWithItinerary(itineraryNotesBase, itineraryPayload);
    const response = await fetch(`/api/tickets/${itineraryTicketId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: mergedNotes }),
    });

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => null);
      setStatusType("error");
      setStatus(formatApiError(errorPayload?.error, "Erreur lors de l'enregistrement de l'itinérance."));
      setIsSavingItinerary(false);
      return;
    }

    setStoredItinerary(itineraryPayload);
    setIsSavingItinerary(false);
    setIsItineraryOpen(false);
    setStatusType("success");
    setStatus("Itinérance enregistrée avec succès.");
    window.location.reload();
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatusType("loading");
    setStatus(editTicketId ? "Mise à jour..." : "Enregistrement...");

    const amount = Number(form.amount);
    const baseFareAmount = form.baseFareAmount.trim() ? Number(form.baseFareAmount) : undefined;
    const agencyMarkupAmount = form.agencyMarkupAmount.trim() ? Number(form.agencyMarkupAmount) : 0;

    const mergedNotes = mergeTicketNotesWithItinerary(form.notes || undefined, storedItinerary);
    const payload = {
      ticketNumber: form.ticketNumber,
      customerName: form.customerName,
      route: form.route,
      travelClass: form.travelClass,
      travelDate: form.travelDate,
      ...(allowAdminEncodingDate ? { soldAt: form.travelDate } : {}),
      amount,
      ...(baseFareAmount !== undefined ? { baseFareAmount } : {}),
      currency: form.currency,
      airlineId: form.airlineId,
      ...(form.sellerId.trim() ? { sellerId: form.sellerId } : {}),
      saleNature: form.saleNature,
      paymentStatus: form.paymentStatus,
      payerName: form.payerName,
      agencyMarkupPercent: 0,
      agencyMarkupAmount,
      ...(mergedNotes ? { notes: mergedNotes } : {}),
    };

    const response = await fetch(editTicketId ? `/api/tickets/${editTicketId}` : "/api/tickets", {
      method: editTicketId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      const result = await response.json().catch(() => null);
      setStatusType("success");

      if (!editTicketId && result?.data?.id) {
        resetForm();
        setStatus("Billet enregistré avec succès. Renseignez maintenant l'itinérance du client.");
        setItineraryTicketId(result.data.id);
        setItineraryTicketLabel(`${result.data.ticketNumber ?? form.ticketNumber} • ${result.data.customerName ?? form.customerName}`);
        setItineraryNotesBase(getPlainTicketNotes(result?.data?.notes ?? form.notes));
        setStoredItinerary(extractTicketItinerary(result?.data?.notes ?? null));
        setItineraryForm(buildItineraryForm({
          customerName: result.data.customerName ?? form.customerName,
          notes: result?.data?.notes ?? null,
        }));
        setIsItineraryOpen(true);
        return;
      }

      setStatus(editTicketId ? "Billet modifié." : "Vente enregistrée.");
      resetForm();
      window.location.reload();
      return;
    }

    const errorPayload = await response.json().catch(() => null);
    setStatusType("error");
    setStatus(formatApiError(errorPayload?.error, "Erreur de validation."));
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
            Annuler l&apos;édition
          </button>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <input
          name="ticketNumber"
          required
          value={form.ticketNumber}
          onChange={(event) => updateField("ticketNumber", event.target.value)}
          placeholder="Code billet / PNR (ex: AB12CD)"
          className="rounded-md border px-3 py-2"
        />
        <input
          name="customerName"
          required
          value={form.customerName}
          onChange={(event) => updateField("customerName", event.target.value)}
          placeholder="Nom complet du client"
          className="rounded-md border px-3 py-2"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <input
          name="route"
          required
          value={form.route}
          onChange={(event) => updateField("route", event.target.value)}
          placeholder="Itinéraire (ex: BZV-CDG aller/retour)"
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
        {allowAdminEncodingDate ? (
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">
              Date d'encodage (admin)
            </label>
            <input
              type="date"
              name="travelDate"
              required
              value={form.travelDate}
              onChange={(event) => updateField("travelDate", event.target.value)}
              className="w-full rounded-md border px-3 py-2"
            />
          </div>
        ) : (
          <div className="rounded-md border px-3 py-2 text-sm">
            Date d'encodage : <span className="font-semibold">{form.travelDate}</span>
          </div>
        )}
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
          placeholder="Montant total du billet (ex: 450)"
          className="rounded-md border px-3 py-2"
        />
        <input
          name="baseFareAmount"
          type="number"
          step="0.01"
          min="0"
          required={isAirCongo || isMontGabaon}
          value={form.baseFareAmount}
          onChange={(event) => updateField("baseFareAmount", event.target.value)}
          placeholder={isAirCongo || isMontGabaon ? "BaseFare (obligatoire)" : "BaseFare (optionnel)"}
          className="rounded-md border px-3 py-2"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <input
          name="currency"
          required
          value={form.currency}
          onChange={(event) => updateField("currency", event.target.value)}
          placeholder="Devise (ex: USD)"
          className="rounded-md border px-3 py-2"
        />
        <input
          name="agencyMarkupAmount"
          type="number"
          step="0.01"
          min="0"
          value={form.agencyMarkupAmount}
          onChange={(event) => updateField("agencyMarkupAmount", event.target.value)}
          placeholder="Majoration agence (montant manuel)"
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
          required={!editTicketId}
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
        <select
          name="payerName"
          required
          value={form.payerName}
          onChange={(event) => updateField("payerName", event.target.value)}
          className="rounded-md border px-3 py-2"
        >
          {form.payerName && !payerOptions.includes(form.payerName) ? (
            <option value={form.payerName}>Historique - {form.payerName}</option>
          ) : null}
          <optgroup label="Client">
            <option value={clientPayerValue}>{clientPayerValue}</option>
          </optgroup>
          <optgroup label="Agents de l'agence">
            {agentPayerOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </optgroup>
          <optgroup label="Équipes">
            {teamPayerOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </optgroup>
        </select>
      </div>

      <p className="text-xs text-black/60 dark:text-white/60">
        Le champ payant est auto-rempli: Client, Agent de l&apos;agence ou Équipe (Lubumbashi/Partenaires selon les équipes disponibles).
      </p>
      {allowAdminEncodingDate ? (
        <p className="text-xs text-black/60 dark:text-white/60">
          Admin uniquement: vous pouvez ajuster la date d&apos;encodage du billet pour la conformité des données.
        </p>
      ) : null}

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
      <p className="text-xs text-black/60 dark:text-white/60">
        Règle standard: commission compagnie (%) sur le BaseFare + majoration agence en montant (devise).
      </p>
      {isAirFast ? (
        <p className="text-xs text-black/60 dark:text-white/60">
          Air Fast: bonus spécial conservé (après 12 billets vendus, le 13ème est compté comme commission).
        </p>
      ) : null}
      {selectedDepositAccount ? (
        <div className={`space-y-1 text-xs ${requestedTicketAmount > (effectiveDepositBalance ?? 0) ? "text-red-600 dark:text-red-300" : "text-black/60 dark:text-white/60"}`}>
          <p>
            {selectedDepositAccount.label}: {allowAdminEncodingDate && balancePreviewDate ? `solde à la date du ${balancePreviewDate}` : "solde disponible"} {typeof effectiveDepositBalance === "number" ? `${effectiveDepositBalance.toFixed(2)} USD` : "indisponible"}. Chaque billet de cette compagnie sera débité automatiquement.
          </p>
          {isLoadingBalancePreview ? (
            <p className="text-black/55 dark:text-white/55">Vérification du solde à la date choisie...</p>
          ) : null}
          {isBackdatedAdminEntry ? (
            <p className="text-black/55 dark:text-white/55">
              Solde actuel: {selectedDepositAccount.balance.toFixed(2)} USD. Pour un billet antidaté, le contrôle se fait sur le solde disponible à la date d&apos;encodage choisie.
            </p>
          ) : null}
        </div>
      ) : null}

      <textarea
        name="notes"
        value={form.notes}
        onChange={(event) => updateField("notes", event.target.value)}
        placeholder="Notes complémentaires (optionnel)"
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

      {isItineraryOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-black/10 bg-white p-4 shadow-2xl dark:border-white/10 dark:bg-zinc-900">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">Renseigner l&apos;itinérance</h3>
                <p className="text-xs text-black/60 dark:text-white/60">Billet {itineraryTicketLabel}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsItineraryOpen(false);
                  window.location.reload();
                }}
                className="rounded-md border border-black/15 px-2 py-1 text-xs hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
              >
                Plus tard
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <input
                value={itineraryForm.departureAirport}
                onChange={(event) => updateItineraryField("departureAirport", event.target.value)}
                placeholder="Aéroport de départ"
                className="rounded-md border px-3 py-2"
              />
              <input
                value={itineraryForm.arrivalAirport}
                onChange={(event) => updateItineraryField("arrivalAirport", event.target.value)}
                placeholder="Aéroport d'arrivée"
                className="rounded-md border px-3 py-2"
              />
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Départ (date & heure)</label>
                <input
                  type="datetime-local"
                  value={itineraryForm.departureAt}
                  onChange={(event) => updateItineraryField("departureAt", event.target.value)}
                  className="w-full rounded-md border px-3 py-2"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Arrivée (date & heure)</label>
                <input
                  type="datetime-local"
                  value={itineraryForm.arrivalAt}
                  onChange={(event) => updateItineraryField("arrivalAt", event.target.value)}
                  className="w-full rounded-md border px-3 py-2"
                />
              </div>
              <input
                type="number"
                step="0.5"
                min="0"
                value={itineraryForm.layoverHours}
                onChange={(event) => updateItineraryField("layoverHours", event.target.value)}
                placeholder="Heures d'escale"
                className="rounded-md border px-3 py-2"
              />
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Heure conseillée de check-in</label>
                <input
                  type="datetime-local"
                  value={itineraryForm.checkInAt}
                  onChange={(event) => updateItineraryField("checkInAt", event.target.value)}
                  className="w-full rounded-md border px-3 py-2"
                />
              </div>
            </div>

            <textarea
              value={itineraryForm.travelMessage}
              onChange={(event) => updateItineraryField("travelMessage", event.target.value)}
              placeholder="Message de bon voyage"
              className="mt-3 min-h-28 w-full rounded-md border px-3 py-2"
            />

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsItineraryOpen(false);
                  window.location.reload();
                }}
                className="rounded-md border border-black/15 px-3 py-2 text-sm hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
              >
                Ignorer pour l&apos;instant
              </button>
              <button
                type="button"
                onClick={saveItinerary}
                disabled={isSavingItinerary}
                className="rounded-md bg-black px-3 py-2 text-sm text-white disabled:opacity-60 dark:bg-white dark:text-black"
              >
                {isSavingItinerary ? "Enregistrement..." : "Enregistrer l'itinérance"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </form>
  );
}
