"use client";

import { CashOperationRowActions } from "@/components/cash-operation-row-actions";

type OpeningBalanceRow = {
  id: string;
  occurredAt: string;
  method: string;
  currency: string;
  amount: number;
  reference: string | null;
  description: string;
  createdByName?: string | null;
};

function openingScopeLabel(description: string) {
  if (description.includes("PROXY_BANKING:")) {
    return "Proxy Banking";
  }

  return "Caisse / comptabilité";
}

function openingDescriptionLabel(description: string) {
  return description
    .replace(/^PROXY_BANKING:OPENING_BALANCE:/, "")
    .replace(/^PROXY_BANKING:OTHER:/, "")
    .trim() || "Solde d'ouverture";
}

export function AdminOpeningBalances({ entries }: { entries: OpeningBalanceRow[] }) {
  return (
    <section className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
      <div className="mb-3">
        <h2 className="text-lg font-semibold">Rectification des soldes d&apos;ouverture</h2>
        <p className="text-xs text-black/60 dark:text-white/60">
          L&apos;administrateur peut corriger ici toutes les entrées de <strong>solde d&apos;ouverture</strong> déjà saisies, toutes caisses confondues.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-black/10 dark:border-white/10">
        <table className="min-w-full text-sm">
          <thead className="bg-black/5 dark:bg-white/10">
            <tr>
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-left">Périmètre</th>
              <th className="px-3 py-2 text-left">Méthode</th>
              <th className="px-3 py-2 text-left">Montant</th>
              <th className="px-3 py-2 text-left">Référence</th>
              <th className="px-3 py-2 text-left">Libellé</th>
              <th className="px-3 py-2 text-left">Saisi par</th>
              <th className="px-3 py-2 text-left">Action</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className="border-t border-black/5 dark:border-white/10">
                <td className="px-3 py-2">{new Date(entry.occurredAt).toLocaleString("fr-FR")}</td>
                <td className="px-3 py-2">{openingScopeLabel(entry.description)}</td>
                <td className="px-3 py-2">{entry.method}</td>
                <td className="px-3 py-2 font-semibold">{entry.amount.toFixed(2)} {entry.currency}</td>
                <td className="px-3 py-2">{entry.reference ?? "-"}</td>
                <td className="px-3 py-2">{openingDescriptionLabel(entry.description)}</td>
                <td className="px-3 py-2">{entry.createdByName ?? "-"}</td>
                <td className="px-3 py-2">
                  <CashOperationRowActions
                    cashOperationId={entry.id}
                    amount={entry.amount}
                    currency={entry.currency}
                    method={entry.method}
                    reference={entry.reference}
                    description={entry.description}
                    occurredAt={entry.occurredAt}
                    direction={"INFLOW"}
                    category={"OPENING_BALANCE"}
                  />
                </td>
              </tr>
            ))}
            {entries.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-sm text-black/55 dark:text-white/55">
                  Aucun solde d&apos;ouverture enregistré pour le moment.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
