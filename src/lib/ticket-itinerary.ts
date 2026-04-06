export type TicketItineraryData = {
  departureAirport?: string;
  arrivalAirport?: string;
  departureAt?: string;
  arrivalAt?: string;
  layoverHours?: number;
  checkInAt?: string;
  travelMessage?: string;
};

const ITINERARY_PREFIX = "\n\nITINERARY_JSON:";

function cleanString(value: string | undefined) {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function defaultTravelMessage(customerName?: string | null) {
  const name = cleanString(customerName ?? undefined);
  return name
    ? `Bon voyage ${name} ✈️ Merci de voyager avec THEBEST SARL.`
    : "Bon voyage ✈️ Merci de voyager avec THEBEST SARL.";
}

export function normalizeTicketItinerary(data?: TicketItineraryData | null) {
  if (!data) return null;

  const normalized: TicketItineraryData = {
    departureAirport: cleanString(data.departureAirport),
    arrivalAirport: cleanString(data.arrivalAirport),
    departureAt: cleanString(data.departureAt),
    arrivalAt: cleanString(data.arrivalAt),
    layoverHours: typeof data.layoverHours === "number" && Number.isFinite(data.layoverHours) && data.layoverHours >= 0
      ? Number(data.layoverHours.toFixed(2))
      : undefined,
    checkInAt: cleanString(data.checkInAt),
    travelMessage: cleanString(data.travelMessage),
  };

  return Object.values(normalized).some((value) => value !== undefined) ? normalized : null;
}

export function extractTicketItinerary(notes?: string | null) {
  if (!notes) return null;

  const markerIndex = notes.indexOf(ITINERARY_PREFIX);
  if (markerIndex === -1) {
    return null;
  }

  const rawJson = notes.slice(markerIndex + ITINERARY_PREFIX.length).trim();
  if (!rawJson) return null;

  try {
    return normalizeTicketItinerary(JSON.parse(rawJson) as TicketItineraryData);
  } catch {
    return null;
  }
}

export function getPlainTicketNotes(notes?: string | null) {
  if (!notes) return "";
  const markerIndex = notes.indexOf(ITINERARY_PREFIX);
  if (markerIndex === -1) {
    return notes;
  }
  return notes.slice(0, markerIndex).trim();
}

export function mergeTicketNotesWithItinerary(notes?: string | null, itinerary?: TicketItineraryData | null) {
  const plainNotes = getPlainTicketNotes(notes).trim();
  const normalizedItinerary = normalizeTicketItinerary(itinerary);

  if (!normalizedItinerary) {
    return plainNotes || undefined;
  }

  const serialized = `${plainNotes}${ITINERARY_PREFIX}${JSON.stringify(normalizedItinerary)}`;
  return serialized.trim();
}

export function itineraryFileName(ticketNumber: string) {
  const safe = ticketNumber.trim().replace(/[^a-zA-Z0-9_-]+/g, "-");
  return `itinerance-${safe || "billet"}.pdf`;
}
