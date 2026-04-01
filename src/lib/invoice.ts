function normalizeTeamCode(teamName: string | null | undefined) {
  const normalized = (teamName ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  if (!normalized) return "GEN";
  return normalized.slice(0, 3).padEnd(3, "X");
}

export function invoiceNumberFromChronology(params: {
  soldAt: Date;
  sellerTeamName?: string | null;
  sequence: number;
}) {
  const year = params.soldAt.getUTCFullYear();
  const teamCode = normalizeTeamCode(params.sellerTeamName);
  const sequencePart = String(Math.max(1, params.sequence)).padStart(4, "0");
  return `FAC-TB-${teamCode}-${sequencePart}-${year}`;
}

export function invoiceFileName(invoiceNumber: string) {
  return `${invoiceNumber}.pdf`;
}
