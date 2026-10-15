"use client";

import { Fragment, useState } from "react";
import type { PayerRecoveryGroup } from "@/lib/ticket-recovery";

type RecipientPreview = { id: string; name: string; email: string };

export type RecouvrementGroupRow = PayerRecoveryGroup & {
  recipients: RecipientPreview[];
};

export function RecouvrementWorkspace({
  monthRaw,
  periodLabel,
  groups,
  workspaceUserCount,
  reportQuery,
}: {
  monthRaw: string;
  periodLabel: string;
  groups: RecouvrementGroupRow[];
  workspaceUserCount: number;
  reportQuery: string;
}) {
  const [busyPayerKey, setBusyPayerKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function handleRecover(payerKey: string, payerLabel: string) {
    setBusyPayerKey(payerKey);
    setFeedback(null);
    try {
      const res = await fetch("/api/recouvrement/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: monthRaw, payerKey }),
      });
      const data = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        setFeedback(data.error ?? data.message ?? "Echec de l'envoi.");
        return;
      }
      setFeedback(data.message ?? `Recouvrement lance pour ${payerLabel}.`);
    } catch {
      setFeedback("Erreur reseau.");
    } finally {
      setBusyPayerKey(null);
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">Mois de vente</span>
            <input
              type="month"
              name="month"
              defaultValue={monthRaw}
              className="rounded-md border border-black/15 bg-white px-3 py-2 dark:border-white/15 dark:bg-zinc-900"
            />
          </label>
          <button
            type="submit"
            className="rounded-md bg-black px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black"
          >
            Afficher
          </button>
        </form>
        <p className="mt-3 text-xs text-black/60 dark:text-white/60">
          Periode affichee : <strong>{periodLabel}</strong>. Statut paye / partiel / impaye = somme des encaissements caisse (
          table Payment) comparee au montant billet ; a chaque encaissement le statut billet en base est aussi mis a jour.
        </p>
        <p className="mt-1 text-xs text-black/60 dark:text-white/60">
          Cible d&apos;envoi : compte applicatif lie au payant ({workspaceUserCount} utilisateur
          {workspaceUserCount > 1 ? "s" : ""} en base). Pour « Agent - Nom », le nom apres le prefixe est rapproche du
          profil (e-mail de connexion).
        </p>
      </section>

      {feedback ? (
        <p className="rounded-lg border border-black/10 bg-black/[0.03] px-3 py-2 text-sm dark:border-white/10 dark:bg-white/[0.04]">
          {feedback}
        </p>
      ) : null}

      <section className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Creances ouvertes par payant</h2>
          <div className="flex flex-wrap gap-2 text-xs">
            <a
              href={`/api/payments/report?${reportQuery}&ticketStatus=UNPAID`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex rounded-md border border-black/20 px-2.5 py-1.5 font-semibold hover:bg-black/5 dark:border-white/20"
            >
              PDF impayes (caisse)
            </a>
            <a
              href={`/api/payments/report?${reportQuery}&ticketStatus=PARTIAL`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex rounded-md border border-black/20 px-2.5 py-1.5 font-semibold hover:bg-black/5 dark:border-white/20"
            >
              PDF partiels (caisse)
            </a>
          </div>
        </div>

        {groups.length === 0 ? (
          <p className="mt-4 text-sm text-black/55 dark:text-white/55">
            Aucune creance ouverte pour ce mois selon les paiements enregistres en caisse.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-black/5 dark:bg-white/10">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Payant</th>
                  <th className="px-3 py-2 text-left font-semibold">Billets</th>
                  <th className="px-3 py-2 text-left font-semibold">Reste USD eq.</th>
                  <th className="px-3 py-2 text-left font-semibold">Destinataire (compte + e-mail)</th>
                  <th className="px-3 py-2 text-left font-semibold" />
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => {
                  const canSend = group.recipients.length > 0;
                  return (
                    <Fragment key={group.payerKey}>
                      <tr className="border-t border-black/5 dark:border-white/10">
                        <td className="px-3 py-2 font-medium">{group.payerLabel}</td>
                        <td className="px-3 py-2">
                          {group.ticketCount} ({group.unpaidCount} imp. / {group.partialCount} part.)
                        </td>
                        <td className="px-3 py-2 font-semibold">{group.remainingUsd.toFixed(2)}</td>
                        <td className="px-3 py-2 text-xs">
                          {canSend
                            ? group.recipients.map((r) => `${r.name} (${r.email})`).join(", ")
                            : "Aucun compte utilisateur ne correspond au payant"}
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            disabled={!canSend || busyPayerKey === group.payerKey}
                            onClick={() => handleRecover(group.payerKey, group.payerLabel)}
                            className="rounded-md bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {busyPayerKey === group.payerKey ? "Envoi…" : "Recouvrer"}
                          </button>
                        </td>
                      </tr>
                      <tr className="border-t border-black/5 bg-black/[0.02] dark:border-white/10 dark:bg-white/[0.03]">
                        <td colSpan={5} className="px-3 py-2 text-xs text-black/70 dark:text-white/70">
                          {group.tickets.map((t) => t.ticketNumber).join(" · ")}
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
