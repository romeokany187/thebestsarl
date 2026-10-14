"use client";

import { Fragment, useMemo, useState } from "react";
import type { PayerRecoveryGroup } from "@/lib/ticket-recovery";

function formatDate(value: Date | string) {
  return new Date(value).toLocaleDateString("fr-FR");
}

export function TicketRecoveryWorkspace({
  groups,
  paymentsReportQuery,
  totalOpenTickets,
  totalRemainingUsd,
}: {
  groups: PayerRecoveryGroup[];
  paymentsReportQuery: string;
  totalOpenTickets: number;
  totalRemainingUsd: number;
}) {
  const [expandedPayerKey, setExpandedPayerKey] = useState<string | null>(null);
  const hasGroups = groups.length > 0;

  const summaryLine = useMemo(() => {
    if (!hasGroups) return "Aucune créance ouverte sur la période filtrée.";
    return `${groups.length} payant(s) · ${totalOpenTickets} billet(s) · reste ≈ ${totalRemainingUsd.toFixed(2)} USD`;
  }, [groups.length, hasGroups, totalOpenTickets, totalRemainingUsd]);

  return (
    <section className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Recouvrement par payant</h2>
          <p className="mt-1 text-xs text-black/60 dark:text-white/60">
            Payé / impayé / partiel = encaissements saisis en caisse (rapport paiements billets). Le payant est la cible de recouvrement.
          </p>
          <p className="mt-1 text-xs font-medium text-black/75 dark:text-white/75">{summaryLine}</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <a
            href={`/api/payments/report?${paymentsReportQuery}&ticketStatus=UNPAID`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex rounded-md border border-black/20 px-2.5 py-1.5 font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            PDF impayés (caisse)
          </a>
          <a
            href={`/api/payments/report?${paymentsReportQuery}&ticketStatus=PARTIAL`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex rounded-md border border-black/20 px-2.5 py-1.5 font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            PDF partiels (caisse)
          </a>
        </div>
      </div>

      {!hasGroups ? (
        <p className="mt-4 text-sm text-black/55 dark:text-white/55">Tous les billets de la période sont soldés selon les paiements enregistrés.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-black/5 dark:bg-white/10">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Payant</th>
                <th className="px-3 py-2 text-left font-semibold">Billets</th>
                <th className="px-3 py-2 text-left font-semibold">Impayés</th>
                <th className="px-3 py-2 text-left font-semibold">Partiels</th>
                <th className="px-3 py-2 text-left font-semibold">Reste (USD eq.)</th>
                <th className="px-3 py-2 text-left font-semibold">Plus ancien</th>
                <th className="px-3 py-2 text-left font-semibold">Vendeur(s)</th>
                <th className="px-3 py-2 text-left font-semibold" />
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                const expanded = expandedPayerKey === group.payerKey;
                return (
                  <Fragment key={group.payerKey}>
                    <tr className="border-t border-black/5 dark:border-white/10">
                      <td className="px-3 py-2 font-medium">{group.payerLabel}</td>
                      <td className="px-3 py-2">{group.ticketCount}</td>
                      <td className="px-3 py-2">{group.unpaidCount}</td>
                      <td className="px-3 py-2">{group.partialCount}</td>
                      <td className="px-3 py-2 font-semibold">{group.remainingUsd.toFixed(2)}</td>
                      <td className="px-3 py-2">{formatDate(group.oldestSoldAt)}</td>
                      <td className="px-3 py-2">{group.sellerNames.join(", ") || "—"}</td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => setExpandedPayerKey(expanded ? null : group.payerKey)}
                          className="text-xs font-semibold underline"
                        >
                          {expanded ? "Masquer" : "Détail"}
                        </button>
                      </td>
                    </tr>
                    {expanded ? (
                      <tr className="border-t border-black/5 bg-black/[0.02] dark:border-white/10 dark:bg-white/[0.03]">
                        <td colSpan={8} className="px-3 py-3">
                          <ul className="space-y-1 text-xs">
                            {group.tickets.map((ticket) => (
                              <li key={ticket.id}>
                                <span className="font-semibold">{ticket.ticketNumber}</span>
                                {" · "}
                                client {ticket.customerName}
                                {" · "}
                                dû {ticket.totalTicketAmount.toFixed(2)} {ticket.currency}
                                {" · "}
                                encaissé {ticket.paidAmount.toFixed(2)} {ticket.currency}
                                {" · "}
                                reste {ticket.remainingAmount.toFixed(2)} {ticket.currency}
                                {" · "}
                                {ticket.computedStatus}
                                {" · "}
                                vendu {formatDate(ticket.soldAt)}
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
