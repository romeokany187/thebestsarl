"use client";

import { useMemo, useState } from "react";
import { PaymentOrderDeleteButton } from "@/components/payment-order-delete-button";
import { matchesSearchQuery } from "@/lib/op-edb-text-search";
import type { EdbTableRow, OpTableRow } from "@/lib/op-edb-list-rows";
import { opBadgeClass, opStatusLabel } from "@/lib/op-filters";
import { needBadgeClass } from "@/lib/need-filters";

export type { EdbTableRow, OpTableRow } from "@/lib/op-edb-list-rows";

function SearchField({
  value,
  onChange,
  placeholder,
  matched,
  total,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  matched: number;
  total: number;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <label className="relative block min-w-0 flex-1">
        <span className="sr-only">Rechercher</span>
        <input
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="w-full rounded-lg border border-black/15 bg-white py-2 pl-9 pr-3 text-sm dark:border-white/15 dark:bg-zinc-950"
        />
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-black/40 dark:text-white/40" aria-hidden>
          ⌕
        </span>
      </label>
      <p className="shrink-0 text-xs text-black/55 dark:text-white/55">
        {value.trim() ? `${matched} / ${total} résultat${matched > 1 ? "s" : ""}` : `${total} au total`}
      </p>
    </div>
  );
}

export function OpSearchableTable({
  rows,
  emptyMessage = "Aucun ordre de paiement.",
  compact = false,
  showAdminActions = true,
}: {
  rows: OpTableRow[];
  emptyMessage?: string;
  compact?: boolean;
  showAdminActions?: boolean;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => rows.filter((row) => matchesSearchQuery(row.searchHaystack, query)),
    [rows, query],
  );
  const cellPad = compact ? "px-3 py-2" : "px-4 py-3";

  return (
    <div className="space-y-3">
      <SearchField
        value={query}
        onChange={setQuery}
        placeholder="Bénéficiaire, motif, libellé, code OP, affectation…"
        matched={filtered.length}
        total={rows.length}
      />
      <div className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/10">
        <table className="min-w-full text-sm">
          <thead className="bg-black/5 dark:bg-white/10">
            <tr>
              <th className={`${cellPad} text-left font-semibold`}>Date</th>
              <th className={`${cellPad} text-left font-semibold`}>Code</th>
              <th className={`${cellPad} text-left font-semibold`}>Bénéficiaire</th>
              <th className={`${cellPad} text-left font-semibold`}>Motif</th>
              {!compact ? <th className={`${cellPad} text-left font-semibold`}>Libellé</th> : null}
              <th className={`${cellPad} text-left font-semibold`}>Affectation</th>
              <th className={`${cellPad} text-left font-semibold`}>Montant</th>
              <th className={`${cellPad} text-left font-semibold`}>Statut</th>
              <th className={`${cellPad} text-left font-semibold`}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.id} className="border-t border-black/5 dark:border-white/10 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                <td className={`${cellPad} whitespace-nowrap text-xs text-black/65 dark:text-white/65`}>{row.createdAtLabel}</td>
                <td className={`${cellPad} font-mono text-xs font-semibold text-blue-700 dark:text-blue-400 whitespace-nowrap`}>{row.code}</td>
                <td className={cellPad}>{row.beneficiary}</td>
                <td className={`${cellPad} max-w-[180px] truncate`} title={row.purpose}>{row.purpose}</td>
                {!compact ? (
                  <td className={`${cellPad} max-w-[200px] truncate text-black/75 dark:text-white/75`} title={row.description}>
                    {row.description}
                  </td>
                ) : null}
                <td className={`${cellPad} text-xs`}>{row.assignmentLabel}</td>
                <td className={`${cellPad} whitespace-nowrap`}>{row.amountLabel}</td>
                <td className={cellPad}>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${opBadgeClass(row.status)}`}>
                    {opStatusLabel(row.status)}
                  </span>
                </td>
                <td className={cellPad}>
                  <div className="flex flex-wrap gap-2">
                    <a
                      href={`/api/payment-orders/${row.id}/pdf`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex rounded-md border border-black/20 px-2.5 py-1 text-[11px] font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                    >
                      PDF
                    </a>
                    {showAdminActions ? (
                      <PaymentOrderDeleteButton paymentOrderId={row.id} status={row.status} compact />
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={compact ? 8 : 9} className="px-4 py-8 text-center text-sm text-black/55 dark:text-white/55">
                  {query.trim() ? "Aucun OP ne correspond à la recherche." : emptyMessage}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function EdbSearchableTable({
  rows,
  emptyMessage = "Aucun état de besoin.",
}: {
  rows: EdbTableRow[];
  emptyMessage?: string;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => rows.filter((row) => matchesSearchQuery(row.searchHaystack, query)),
    [rows, query],
  );

  return (
    <div className="space-y-3">
      <SearchField
        value={query}
        onChange={setQuery}
        placeholder="Objet, libellé, demandeur, bénéficiaire, lignes, code EDB…"
        matched={filtered.length}
        total={rows.length}
      />
      <div className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/10">
        <table className="min-w-full text-sm">
          <thead className="bg-black/5 dark:bg-white/10">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Date</th>
              <th className="px-3 py-2 text-left font-semibold">Code</th>
              <th className="px-3 py-2 text-left font-semibold">Objet / libellé</th>
              <th className="px-3 py-2 text-left font-semibold">Demandeur</th>
              <th className="px-3 py-2 text-left font-semibold">Affectation</th>
              <th className="px-3 py-2 text-left font-semibold">Montant</th>
              <th className="px-3 py-2 text-left font-semibold">Statut</th>
              <th className="px-3 py-2 text-left font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.id} className="border-t border-black/5 dark:border-white/10 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                <td className="px-3 py-2 whitespace-nowrap text-xs text-black/65 dark:text-white/65">{row.createdAtLabel}</td>
                <td className="px-3 py-2 font-mono text-xs font-semibold text-blue-700 dark:text-blue-400 whitespace-nowrap">{row.code}</td>
                <td className="px-3 py-2 font-medium max-w-[240px] truncate" title={row.title}>{row.title}</td>
                <td className="px-3 py-2 text-xs">{row.requesterName}</td>
                <td className="px-3 py-2 text-xs">{row.assignmentLabel}</td>
                <td className="px-3 py-2 whitespace-nowrap">{row.amountLabel}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${needBadgeClass(row.statusLabel)}`}>
                    {row.statusLabel}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-2">
                    <a
                      href={`/approvisionnement/${row.id}`}
                      className="inline-flex rounded-md border border-black/20 px-2.5 py-1 text-[11px] font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                    >
                      Ouvrir
                    </a>
                    <a
                      href={`/api/procurement/needs/${row.id}/pdf`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex rounded-md border border-black/20 px-2.5 py-1 text-[11px] font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                    >
                      PDF
                    </a>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-black/55 dark:text-white/55">
                  {query.trim() ? "Aucun EDB ne correspond à la recherche." : emptyMessage}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function StatusFilterPills({
  items,
}: {
  items: Array<{ href: string; count: number; label: string; className: string }>;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {items.map((item) => (
        <a
          key={item.href}
          href={item.href}
          className={`shrink-0 rounded-lg border px-3 py-2 transition hover:shadow-sm ${item.className}`}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wide opacity-80">{item.label}</p>
          <p className="text-lg font-semibold leading-tight">{item.count}</p>
        </a>
      ))}
    </div>
  );
}
