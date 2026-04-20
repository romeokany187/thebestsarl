import { normalizeWorkflowAssignment, type WorkflowAssignmentValue } from "@/lib/workflow-assignment";

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
  assignment?: WorkflowAssignmentValue;
};

function round2(value: number) {
  return Math.round(value * 100) / 100;
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

function decodeJsonStringFragment(value: string | undefined) {
  if (!value) return "";

  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\\//g, "/")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
}

function extractLooseString(details: string, keys: string[]) {
  for (const key of keys) {
    const match = details.match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, "i"));
    if (match) {
      return decodeJsonStringFragment(match[1]);
    }
  }
  return undefined;
}

function extractLooseNumber(details: string, keys: string[]) {
  for (const key of keys) {
    const match = details.match(new RegExp(`"${key}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, "i"));
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) {
        return value;
      }
    }
  }
  return undefined;
}

function parseLooseQuotePayload(details: string) {
  if (!details.includes('"QUOTE_V1"')) {
    return null;
  }

  const itemPattern = /\{[^{}]*?"(?:designation|designationn)"\s*:\s*"((?:\\.|[^"\\])*)"[^{}]*?"description"\s*:\s*"((?:\\.|[^"\\])*)"[^{}]*?"quantity"\s*:\s*(-?\d+(?:\.\d+)?)\s*,[^{}]*?"unitPrice"\s*:\s*(-?\d+(?:\.\d+)?)(?:\s*,[^{}]*?"lineTotal"\s*:\s*(-?\d+(?:\.\d+)?))?[^{}]*?\}/gi;
  const items: Array<{
    designation?: string;
    description?: string;
    quantity?: number;
    unitPrice?: number;
    lineTotal?: number;
  }> = [];

  for (const match of details.matchAll(itemPattern)) {
    const quantity = Number(match[3]);
    const unitPrice = Number(match[4]);
    const lineTotal = match[5] ? Number(match[5]) : quantity * unitPrice;
    items.push({
      designation: decodeJsonStringFragment(match[1]),
      description: decodeJsonStringFragment(match[2]),
      quantity: Number.isFinite(quantity) ? quantity : undefined,
      unitPrice: Number.isFinite(unitPrice) ? unitPrice : undefined,
      lineTotal: Number.isFinite(lineTotal) ? lineTotal : undefined,
    });
  }

  if (items.length === 0) {
    const designation = extractLooseString(details, ["designation", "designationn"]);
    const description = extractLooseString(details, ["description"]);
    const quantity = extractLooseNumber(details, ["quantity"]);
    const unitPrice = extractLooseNumber(details, ["unitPrice"]);
    const lineTotal = extractLooseNumber(details, ["lineTotal"]);

    if (designation && typeof quantity === "number" && typeof unitPrice === "number") {
      items.push({
        designation,
        description,
        quantity,
        unitPrice,
        lineTotal: typeof lineTotal === "number" ? lineTotal : quantity * unitPrice,
      });
    }
  }

  if (items.length === 0) {
    return null;
  }

  return {
    format: "QUOTE_V1" as const,
    items,
    totalGeneral: extractLooseNumber(details, ["totalGeneral"]),
    urgencyLevel: extractLooseString(details, ["urgencyLevel"]),
    beneficiaryTeam: extractLooseString(details, ["beneficiaryTeam"]),
    beneficiaryPersonId: extractLooseString(details, ["beneficiaryPersonId"]),
    beneficiaryPersonName: extractLooseString(details, ["beneficiaryPersonName"]),
    assignment: extractLooseString(details, ["assignment"]),
  };
}

function looksLikeSerializedNeedQuote(value: string | null | undefined) {
  if (!value) return false;

  try {
    const parsed = JSON.parse(sanitizeQuoteJsonCandidate(value.trim())) as {
      format?: string;
      items?: unknown;
    };
    return parsed?.format === "QUOTE_V1" && Array.isArray(parsed.items);
  } catch {
    return false;
  }
}

function sanitizeNeedLineDescription(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  if (!normalized) return "";
  return looksLikeSerializedNeedQuote(normalized) ? "" : normalized;
}

export function normalizeNeedLines(
  items: Array<{ designation: string; description?: string; quantity: number; unitPrice: number }>,
): NeedLine[] {
  return items
    .map((item) => {
      const designation = item.designation.trim();
      const description = sanitizeNeedLineDescription(item.description);
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
    assignment?: WorkflowAssignmentValue;
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
    assignment: options?.assignment,
  };
}

export function serializeNeedQuote(quote: NeedDetailsQuote) {
  return JSON.stringify(quote);
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

    if (candidate.startsWith('"') && candidate.endsWith('"')) {
      try {
        const decoded = JSON.parse(candidate) as string;
        if (typeof decoded === "string" && decoded.trim()) {
          candidates.push(decoded.trim());
        }
      } catch {
        continue;
      }
    }

    try {
      const parsed = JSON.parse(sanitizeQuoteJsonCandidate(candidate)) as {
        format?: string;
        urgencyLevel?: string;
        beneficiaryTeam?: string;
        beneficiaryPersonId?: string;
        beneficiaryPersonName?: string;
        assignment?: string;
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

  return parseLooseQuotePayload(details);
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
      const description = sanitizeNeedLineDescription(item.description);
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
    assignment: normalizeWorkflowAssignment(payload.assignment),
  };
}
