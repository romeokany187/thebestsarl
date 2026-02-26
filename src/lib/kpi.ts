import { PaymentStatus, TicketSale } from "@prisma/client";

export function calculateTicketMetrics(tickets: TicketSale[]) {
  const totalSales = tickets.reduce((acc, ticket) => acc + ticket.amount, 0);
  const grossCommission = tickets.reduce(
    (acc, ticket) => acc + (ticket.commissionAmount ?? ticket.amount * (ticket.commissionRateUsed / 100)),
    0,
  );

  const paidSales = tickets
    .filter((ticket) => ticket.paymentStatus === PaymentStatus.PAID)
    .reduce((acc, ticket) => acc + ticket.amount, 0);

  const partialSales = tickets
    .filter((ticket) => ticket.paymentStatus === PaymentStatus.PARTIAL)
    .reduce((acc, ticket) => acc + ticket.amount, 0);

  const paidRatio = totalSales === 0 ? 0 : (paidSales + partialSales * 0.5) / totalSales;
  const netCommission = grossCommission * paidRatio;

  return {
    totalSales,
    grossCommission,
    netCommission,
    paidRatio,
  };
}
