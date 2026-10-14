import { PaymentStatus } from "@prisma/client";
import type { OpenReceivableRow } from "@/lib/ticket-recovery-dispatch";

export function buildRecoveryTextMessage(params: {
  recipientName: string;
  payerLabel: string;
  periodLabel: string;
  rows: OpenReceivableRow[];
  includePdfMention?: boolean;
  appUrl?: string;
}) {
  const { recipientName, payerLabel, periodLabel, rows, includePdfMention, appUrl } = params;

  const scopedUnpaid = rows.filter(({ balance }) => balance.computedStatus === PaymentStatus.UNPAID).length;
  const scopedPartial = rows.filter(({ balance }) => balance.computedStatus === PaymentStatus.PARTIAL).length;
  const scopedRemainingUsd = rows.reduce((sum, { balance }) => sum + balance.remainingUsd, 0);

  const ticketLines = rows
    .slice(0, 25)
    .map(({ ticket, balance }, index) => {
      const status = balance.computedStatus === PaymentStatus.UNPAID ? "Impayé" : "Partiel";
      const reste =
        balance.remainingAmount > 0
          ? ` · reste ${balance.remainingAmount.toFixed(2)} ${balance.currency}`
          : "";
      return `${index + 1}. ${ticket.ticketNumber} · ${ticket.customerName} · ${balance.totalTicketAmount.toFixed(2)} ${balance.currency}${reste} · ${status}`;
    })
    .join("\n");

  const moreCount = rows.length > 25 ? `\n… et ${rows.length - 25} autre(s) billet(s).` : "";

  return [
    "THEBEST SARL — Recouvrement billets",
    `Bonjour ${recipientName},`,
    "",
    `Période : ${periodLabel}`,
    `Payant : ${payerLabel}`,
    "",
    `Synthèse : ${rows.length} billet(s) ouvert(s) · ${scopedUnpaid} impayé(s) · ${scopedPartial} partiel(s)`,
    scopedRemainingUsd > 0 ? `Reste estimé (caisse) : ${scopedRemainingUsd.toFixed(2)} USD eq.` : null,
    "",
    "Détail (statut = encaissements saisis en caisse) :",
    ticketLines,
    moreCount,
    includePdfMention ? "\nLe détail complet est aussi disponible en PDF par e-mail si configuré." : null,
    appUrl ? `\nEspace recouvrement : ${appUrl}` : null,
  ]
    .filter((line) => line !== null && line !== undefined)
    .join("\n");
}
