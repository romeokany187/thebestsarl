export function invoiceNumberFromTicket(ticketNumber: string, soldAt: Date) {
  const datePart = soldAt.toISOString().slice(0, 10).replace(/-/g, "");
  const token = ticketNumber.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return `FAC-${datePart}-${token || "BILLET"}`;
}

export function invoiceFileName(invoiceNumber: string) {
  return `${invoiceNumber}.pdf`;
}
