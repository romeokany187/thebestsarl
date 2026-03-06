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
): NeedDetailsQuote {
  const normalized = normalizeNeedLines(items);
  const totalGeneral = round2(normalized.reduce((sum, item) => sum + item.lineTotal, 0));

  return {
    format: "QUOTE_V1",
    items: normalized,
    totalGeneral,
  };
}

export function serializeNeedQuote(quote: NeedDetailsQuote) {
  return JSON.stringify(quote);
}

export function parseNeedQuote(details: string | null | undefined): NeedDetailsQuote | null {
  if (!details) return null;

  try {
    const payload = JSON.parse(details) as {
      format?: string;
      items?: Array<{
        designation?: string;
        description?: string;
        quantity?: number;
        unitPrice?: number;
        lineTotal?: number;
      }>;
      totalGeneral?: number;
    };

    if (payload.format !== "QUOTE_V1" || !Array.isArray(payload.items)) {
      return null;
    }

    const items: NeedLine[] = payload.items
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
    };
  } catch {
    return null;
  }
}
