"use client";

import { useState } from "react";
import { PaymentOrderForm } from "@/components/payment-order-form";
import {
  EdbSearchableTable,
  OpSearchableTable,
  StatusFilterPills,
} from "@/components/op-edb-searchable-lists";
import type { EdbTableRow, OpTableRow } from "@/lib/op-edb-list-rows";
import { NEED_FILTER_LABELS } from "@/lib/need-filters";
import { OP_FILTER_LABELS } from "@/lib/op-filters";

type TabKey = "edb" | "op";

export function AdminOpEdbWorkspace({
  edbRows,
  opAdminRows,
  needStats,
  opStats,
}: {
  edbRows: EdbTableRow[];
  opAdminRows: OpTableRow[];
  needStats: { total: number; enAttente: number; approuves: number; executes: number; rejetes: number };
  opStats: { total: number; enAttente: number; approuves: number; executes: number; rejetes: number };
}) {
  const [tab, setTab] = useState<TabKey>("edb");
  const [showOpForm, setShowOpForm] = useState(false);

  const edbPills = [
    { href: "/admin/ordres-paiement/edb/total", count: needStats.total, label: NEED_FILTER_LABELS.total, className: "border-black/10 bg-black/3 dark:border-white/10 dark:bg-white/3" },
    { href: "/admin/ordres-paiement/edb/en-attente", count: needStats.enAttente, label: NEED_FILTER_LABELS["en-attente"], className: "border-amber-200 bg-amber-50/50 text-amber-900 dark:border-amber-800/40 dark:bg-amber-950/20 dark:text-amber-300" },
    { href: "/admin/ordres-paiement/edb/approuves", count: needStats.approuves, label: NEED_FILTER_LABELS.approuves, className: "border-emerald-200 bg-emerald-50/50 text-emerald-900 dark:border-emerald-800/40 dark:bg-emerald-950/20 dark:text-emerald-300" },
    { href: "/admin/ordres-paiement/edb/executes", count: needStats.executes, label: NEED_FILTER_LABELS.executes, className: "border-sky-200 bg-sky-50/50 text-sky-900 dark:border-sky-800/40 dark:bg-sky-950/20 dark:text-sky-300" },
    { href: "/admin/ordres-paiement/edb/rejetes", count: needStats.rejetes, label: NEED_FILTER_LABELS.rejetes, className: "border-red-200 bg-red-50/50 text-red-900 dark:border-red-800/40 dark:bg-red-950/20 dark:text-red-300" },
  ];

  const opPills = [
    { href: "/admin/ordres-paiement/op/total", count: opStats.total, label: OP_FILTER_LABELS.total, className: "border-black/10 bg-black/3 dark:border-white/10 dark:bg-white/3" },
    { href: "/admin/ordres-paiement/op/en-attente", count: opStats.enAttente, label: OP_FILTER_LABELS["en-attente"], className: "border-amber-200 bg-amber-50/50 text-amber-900 dark:border-amber-800/40 dark:bg-amber-950/20 dark:text-amber-300" },
    { href: "/admin/ordres-paiement/op/approuves", count: opStats.approuves, label: OP_FILTER_LABELS.approuves, className: "border-emerald-200 bg-emerald-50/50 text-emerald-900 dark:border-emerald-800/40 dark:bg-emerald-950/20 dark:text-emerald-300" },
    { href: "/admin/ordres-paiement/op/executes", count: opStats.executes, label: OP_FILTER_LABELS.executes, className: "border-sky-200 bg-sky-50/50 text-sky-900 dark:border-sky-800/40 dark:bg-sky-950/20 dark:text-sky-300" },
    { href: "/admin/ordres-paiement/op/rejetes", count: opStats.rejetes, label: OP_FILTER_LABELS.rejetes, className: "border-red-200 bg-red-50/50 text-red-900 dark:border-red-800/40 dark:bg-red-950/20 dark:text-red-300" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 rounded-xl border border-black/10 bg-white p-1 dark:border-white/10 dark:bg-zinc-900">
        <button
          type="button"
          onClick={() => setTab("edb")}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${tab === "edb" ? "bg-black text-white dark:bg-white dark:text-black" : "text-black/70 hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/10"}`}
        >
          États de besoin ({needStats.total})
        </button>
        <button
          type="button"
          onClick={() => setTab("op")}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${tab === "op" ? "bg-black text-white dark:bg-white dark:text-black" : "text-black/70 hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/10"}`}
        >
          Ordres de paiement ({opStats.total})
        </button>
      </div>

      {tab === "edb" ? (
        <section className="space-y-4 rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <div>
            <h2 className="text-base font-semibold">États de besoin</h2>
            <p className="mt-1 text-xs text-black/55 dark:text-white/55">
              Recherche instantanée sur objet, demandeur, lignes du devis et code.
            </p>
          </div>
          <StatusFilterPills items={edbPills} />
          <EdbSearchableTable rows={edbRows} emptyMessage="Aucun état de besoin émis pour le moment." />
        </section>
      ) : (
        <section className="space-y-4">
          <div className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold">Ordres de paiement</h2>
                <p className="mt-1 text-xs text-black/55 dark:text-white/55">
                  Recherche sur bénéficiaire, motif, libellé (description) et code OP.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <a
                  href="/admin/ordres-paiement/rapport-periodique"
                  className="rounded-md border border-black/20 px-3 py-1.5 text-xs font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                >
                  Rapport périodique
                </a>
                <button
                  type="button"
                  onClick={() => setShowOpForm((value) => !value)}
                  className="rounded-md bg-black px-3 py-1.5 text-xs font-semibold text-white dark:bg-white dark:text-black"
                >
                  {showOpForm ? "Masquer le formulaire" : "Nouvel OP admin"}
                </button>
              </div>
            </div>
            <StatusFilterPills items={opPills} />
          </div>

          {showOpForm ? <PaymentOrderForm issuerRole="ADMIN" /> : null}

          <div className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
            <h3 className="mb-3 text-sm font-semibold">OP émis par l&apos;administration</h3>
            <OpSearchableTable rows={opAdminRows} emptyMessage="Aucun ordre de paiement admin créé pour le moment." />
          </div>
        </section>
      )}
    </div>
  );
}
