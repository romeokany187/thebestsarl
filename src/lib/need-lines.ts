export type NeedLine = {
  designation: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type NeedDetailsQuote = {
  format: "QUOTE_V1";
  items: NeedLine[];
  totalGeneral: number;
  urgencyLevel?: "CRITIQUE" | "ELEVEE" | "NORMALE" | "FAIBLE";
  beneficiaryTeam?: "KINSHASA" | "LUBUMBASHI" | "MBUJIMAYI";
  beneficiaryPersonId?: string;
  beneficiaryPersonName?: string;
};

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

export function normalizeNeedLines(
  items: Array<{ designation: string; description?: string; quantity: number; unitPrice: number }>,
): NeedLine[] {
  return items
    .map((item) => {
      const designation = item.designation.trim();
      const description = (item.description ?? "").trim();
      const quantity = Number(item.quantity);
      const unitPrice = Number(item.unitPrice);
      return {
        designation,
        description,
        quantity,
        unitPrice,
        lineTotal: round2(quantity * unitPrice),
      };
    })
    .filter((item) => item.designation.length > 0 && item.quantity > 0 && item.unitPrice >= 0);
}

export function quoteFromItems(
  items: Array<{ designation: string; description?: string; quantity: number; unitPrice: number }>,
  options?: {
    urgencyLevel?: "CRITIQUE" | "ELEVEE" | "NORMALE" | "FAIBLE";
    beneficiaryTeam?: "KINSHASA" | "LUBUMBASHI" | "MBUJIMAYI";
    beneficiaryPersonId?: string;
    beneficiaryPersonName?: string;
  },
): NeedDetailsQuote {
  const normalized = normalizeNeedLines(items);
  const totalGeneral = round2(normalized.reduce((sum, item) => sum + item.lineTotal, 0));

  return {
    format: "QUOTE_V1",
    items: normalized,
    totalGeneral,
    urgencyLevel: options?.urgencyLevel,
    beneficiaryTeam: options?.beneficiaryTeam,
    beneficiaryPersonId: options?.beneficiaryPersonId,
    beneficiaryPersonName: options?.beneficiaryPersonName,
  };
}

export function serializeNeedQuote(quote: NeedDetailsQuote) {
  return JSON.stringify(quote);
}

function sanitizeQuoteJsonCandidate(value: string) {
  let result = "";
  let inString = false;
  let escaped = false;

  for (const char of value) {
    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      result += char;
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      result += char;
      continue;
    }

    if (inString && (char === "\n" || char === "\r")) {
      result += "\\n";
      continue;
    }

    result += char;
  }

  return result;
}

function parseQuotePayload(details: string) {
  const candidates = [details.trim()];
  const firstBrace = details.indexOf("{");
  const lastBrace = details.lastIndexOf("}");

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(details.slice(firstBrace, lastBrace + 1).trim());
  }

  for (const candidate of candidates) {
    if (!candidate) continue;

    try {
      const parsed = JSON.parse(sanitizeQuoteJsonCandidate(candidate)) as {
        format?: string;
        urgencyLevel?: string;
        beneficiaryTeam?: string;
        beneficiaryPersonId?: string;
        beneficiaryPersonName?: string;
        items?: Array<{
          designation?: string;
          description?: string;
          quantity?: number;
          unitPrice?: number;
          lineTotal?: number;
        }>;
        totalGeneral?: number;
      };

      if (parsed?.format === "QUOTE_V1" && Array.isArray(parsed.items)) {
        return parsed;
      }
    } catch {
      continue;
    }
  }

  return null;
}

export function parseNeedQuote(details: string | null | undefined): NeedDetailsQuote | null {
  if (!details) return null;

  const payload = parseQuotePayload(details);
  if (!payload) {
    return null;
  }

  const rawItems = Array.isArray(payload.items) ? payload.items : [];

  const items: NeedLine[] = rawItems
    .map((item) => {
      const designation = (item.designation ?? "").trim();
      const description = (item.description ?? "").trim();
      const quantity = Number(item.quantity ?? 0);
      const unitPrice = Number(item.unitPrice ?? 0);
      const lineTotal = Number(item.lineTotal ?? quantity * unitPrice);

      return {
        designation,
        description,
        quantity,
        unitPrice,
        lineTotal: round2(lineTotal),
      };
    })
    .filter((item) => item.designation.length > 0 && item.quantity > 0 && item.unitPrice >= 0);

  return {
    format: "QUOTE_V1",
    items,
    totalGeneral: round2(Number(payload.totalGeneral ?? items.reduce((sum, item) => sum + item.lineTotal, 0))),
    urgencyLevel:
      payload.urgencyLevel === "CRITIQUE"
      || payload.urgencyLevel === "ELEVEE"
      || payload.urgencyLevel === "NORMALE"
      || payload.urgencyLevel === "FAIBLE"
        ? payload.urgencyLevel
        : undefined,
    beneficiaryTeam:
      payload.beneficiaryTeam === "KINSHASA"
      || payload.beneficiaryTeam === "LUBUMBASHI"
      || payload.beneficiaryTeam === "MBUJIMAYI"
        ? payload.beneficiaryTeam
        : undefined,
    beneficiaryPersonId: typeof payload.beneficiaryPersonId === "string" ? payload.beneficiaryPersonId : undefined,
    beneficiaryPersonName: typeof payload.beneficiaryPersonName === "string" ? payload.beneficiaryPersonName : undefined,
  };
}
