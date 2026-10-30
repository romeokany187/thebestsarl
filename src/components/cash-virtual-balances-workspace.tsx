"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatFrDecimal } from "@/lib/kinshasa-time";

type VirtualBalanceRow = {
  label: string;
  balanceUsd: number;
  balanceCdf: number;
};

type SnapshotPayload = {
  closingDate: string;
  requestedDate: string;
  rows: VirtualBalanceRow[];
  totalUsd: number;
  totalCdf: number;
  updatedAt: string;
};

export function CashVirtualBalancesWorkspace({
  cashDesk,
  defaultDate,
  initialSnapshot,
}: {
  cashDesk: string;
  defaultDate: string;
  initialSnapshot: SnapshotPayload | null;
}) {
  const [selectedDate, setSelectedDate] = useState(defaultDate);
  const [snapshot, setSnapshot] = useState<SnapshotPayload | null>(initialSnapshot);
  const [isLoading, setIsLoading] = useState(false);

  const loadSnapshot = useCallback(async (date: string) => {
    setIsLoading(true);
    try {
      const resp = await fetch(
        `/api/payments/virtual-snapshot?date=${encodeURIComponent(date)}&cashDesk=${encodeURIComponent(cashDesk)}`,
      );
      if (!resp.ok) {
        setSnapshot(null);
        return;
      }
      const json = (await resp.json()) as { data: SnapshotPayload | null };
      setSnapshot(json.data);
    } catch {
      setSnapshot(null);
    } finally {
      setIsLoading(false);
    }
  }, [cashDesk]);

  useEffect(() => {
    if (selectedDate === defaultDate && initialSnapshot) {
      setSnapshot(initialSnapshot);
      return;
    }
    void loadSnapshot(selectedDate);
  }, [selectedDate, defaultDate, initialSnapshot, loadSnapshot]);

  const rows = snapshot?.rows ?? [];
  const totals = useMemo(
    () => ({
      usd: snapshot?.totalUsd ?? rows.reduce((sum, row) => sum + row.balanceUsd, 0),
      cdf: snapshot?.totalCdf ?? rows.reduce((sum, row) => sum + row.balanceCdf, 0),
    }),
    [rows, snapshot],
  );

  const hasData = rows.length > 0;
  const statusTone = hasData
    ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:border-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300"
    : "border-black/15 bg-black/5 text-black/70 dark:border-white/15 dark:bg-white/10 dark:text-white/70";
  const statusLabel = isLoading
    ? "Chargement…"
    : hasData
      ? `Soldes importés (Excel) — ${snapshot?.closingDate ?? selectedDate}`
      : "Aucun solde virtuel importé pour cette date";

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold">Comptes virtuels</h2>
        <p className="mt-1 text-xs text-black/60 dark:text-white/60">
          Soldes issus de la feuille <strong>VIRTUEL</strong> lors de l&apos;import Excel caisse (un enregistrement par jour importé).
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <p className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusTone}`}>{statusLabel}</p>
          {snapshot?.updatedAt ? (
            <span className="text-xs text-black/50 dark:text-white/50">
              Dernière mise à jour {new Date(snapshot.updatedAt).toLocaleString("fr-FR")}
            </span>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">
              Date
            </label>
            <input
              type="date"
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
              className="rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            />
          </div>
        </div>

        {snapshot && snapshot.closingDate !== selectedDate ? (
          <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">
            Pas de feuille VIRTUEL au {selectedDate} : affichage du dernier import disponible ({snapshot.closingDate}).
          </p>
        ) : null}
      </section>

      <section className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-black/5 dark:bg-white/10">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Compte virtuel</th>
                <th className="px-4 py-3 text-left font-semibold">Solde USD</th>
                <th className="px-4 py-3 text-left font-semibold">Solde CDF</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.label}-${index}`} className="border-t border-black/5 dark:border-white/10">
                  <td className="px-4 py-3 font-medium">{row.label}</td>
                  <td className="px-4 py-3 tabular-nums">{formatFrDecimal(row.balanceUsd, 2)} USD</td>
                  <td className="px-4 py-3 tabular-nums">{formatFrDecimal(row.balanceCdf, 0)} CDF</td>
                </tr>
              ))}
              {hasData ? (
                <tr className="border-t border-black/10 bg-black/5 font-semibold dark:border-white/10 dark:bg-white/10">
                  <td className="px-4 py-3">TOTAL</td>
                  <td className="px-4 py-3 tabular-nums">{formatFrDecimal(totals.usd, 2)} USD</td>
                  <td className="px-4 py-3 tabular-nums">{formatFrDecimal(totals.cdf, 0)} CDF</td>
                </tr>
              ) : (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-sm text-black/55 dark:text-white/55">
                    Importez le fichier Excel caisse du jour (feuille VIRTUEL) via <strong>Import Excel caisse</strong>.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
