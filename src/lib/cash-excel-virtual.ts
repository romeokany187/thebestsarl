import { prisma } from "@/lib/prisma";

export type AppVirtualChannelKey =
  | "AIRTEL_MONEY"
  | "ORANGE_MONEY"
  | "MPESA"
  | "EQUITY"
  | "RAWBANK_ILLICOCASH";

export type ExcelVirtualChannelRow = {
  key: string;
  label: string;
  usd: number;
  cdf: number;
};

export type VirtualAccountRowStats = {
  openingUsd: number;
  openingCdf: number;
  inUsd: number;
  outUsd: number;
  inCdf: number;
  outCdf: number;
  closingUsd: number;
  closingCdf: number;
};

function normalizeVirtualMatchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim()
    .toUpperCase();
}

/** Associe une ligne feuille VIRTUEL (Excel) à un compte virtuel de l’application. */
export function mapExcelVirtualLabelToChannel(label: string, parsedKey = ""): AppVirtualChannelKey | null {
  const method = normalizeVirtualMatchText(`${label} ${parsedKey}`.replace(/_/g, " "));
  if (!method) return null;
  if (method.includes("AIRTEL")) return "AIRTEL_MONEY";
  if (method.includes("ORANGE")) return "ORANGE_MONEY";
  if (method.includes("M-PESA") || method.includes("MPESA") || method.includes("M PESA")) return "MPESA";
  if (method.includes("EQUITY")) return "EQUITY";
  if (
    method.includes("RAWBANK")
    || method.includes("ROWBANK")
    || method.includes("ROW BANK")
    || method.includes("ILLICOCASH")
    || method.includes("ILLICO CASH")
    || method.includes("ILLICO")
  ) {
    return "RAWBANK_ILLICOCASH";
  }
  return null;
}

function parseSnapshotChannels(raw: unknown): ExcelVirtualChannelRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const row = entry as Record<string, unknown>;
      const label = String(row.label ?? "").trim();
      const key = String(row.key ?? "").trim();
      const usd = Number(row.usd ?? 0);
      const cdf = Number(row.cdf ?? 0);
      if (!label && !key) return null;
      return { key, label, usd: Number.isFinite(usd) ? usd : 0, cdf: Number.isFinite(cdf) ? cdf : 0 };
    })
    .filter((row): row is ExcelVirtualChannelRow => row != null);
}

export function buildVirtualRowsFromExcelSnapshot(
  snapshot: { channels: unknown; closingDate: string },
  channelDefs: ReadonlyArray<{ key: AppVirtualChannelKey; label: string }>,
) {
  const parsed = parseSnapshotChannels(snapshot.channels);
  const statsByKey = Object.fromEntries(
    channelDefs.map(({ key }) => [
      key,
      {
        openingUsd: 0,
        openingCdf: 0,
        inUsd: 0,
        outUsd: 0,
        inCdf: 0,
        outCdf: 0,
        closingUsd: 0,
        closingCdf: 0,
      },
    ]),
  ) as Record<AppVirtualChannelKey, VirtualAccountRowStats>;

  for (const channel of parsed) {
    const appKey = mapExcelVirtualLabelToChannel(channel.label, channel.key);
    if (!appKey) continue;
    statsByKey[appKey].closingUsd += channel.usd;
    statsByKey[appKey].closingCdf += channel.cdf;
  }

  const rows = channelDefs.map(({ key, label }) => ({
    key,
    label,
    ...statsByKey[key],
  }));

  const totals = rows.reduce(
    (sum, row) => {
      sum.openingUsd += row.openingUsd;
      sum.openingCdf += row.openingCdf;
      sum.inUsd += row.inUsd;
      sum.outUsd += row.outUsd;
      sum.inCdf += row.inCdf;
      sum.outCdf += row.outCdf;
      sum.closingUsd += row.closingUsd;
      sum.closingCdf += row.closingCdf;
      return sum;
    },
    {
      openingUsd: 0,
      openingCdf: 0,
      inUsd: 0,
      outUsd: 0,
      inCdf: 0,
      outCdf: 0,
      closingUsd: 0,
      closingCdf: 0,
    },
  );

  return { rows, totals, closingDate: snapshot.closingDate, channelCount: parsed.length };
}

export async function loadMainDeskExcelVirtualSnapshot(
  reportMonth: string,
  preferredClosingDate?: string | null,
  cashDesk = "THE_BEST",
) {
  if (preferredClosingDate) {
    const exact = await prisma.cashReportVirtualSnapshot.findUnique({
      where: { closingDate_cashDesk: { closingDate: preferredClosingDate, cashDesk } },
    });
    if (exact) return exact;

    const onOrBefore = await prisma.cashReportVirtualSnapshot.findFirst({
      where: {
        cashDesk,
        closingDate: { lte: preferredClosingDate, startsWith: `${reportMonth}-` },
      },
      orderBy: { closingDate: "desc" },
    });
    if (onOrBefore) return onOrBefore;
  }

  return prisma.cashReportVirtualSnapshot.findFirst({
    where: {
      cashDesk,
      closingDate: { startsWith: `${reportMonth}-` },
    },
    orderBy: { closingDate: "desc" },
  });
}
