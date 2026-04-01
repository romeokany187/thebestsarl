"use client";

import { useMemo, useState } from "react";

const usdDenominations = [100, 50, 20, 10, 5, 1] as const;
const cdfDenominations = [20000, 10000, 5000, 1000, 500, 200, 100, 50] as const;

function varianceStatus(delta: number): { label: string; tone: string } {
  if (Math.abs(delta) <= 0.0001) {
    return {
      label: "Conforme",
      tone: "border-emerald-500 bg-emerald-50 text-emerald-700 dark:border-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300",
    };
  }

  if (delta > 0) {
    return {
      label: `Excédent ${delta.toFixed(2)}`,
      tone: "border-amber-500 bg-amber-50 text-amber-700 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-300",
    };
  }

  return {
    label: `Manquant ${Math.abs(delta).toFixed(2)}`,
    tone: "border-red-500 bg-red-50 text-red-700 dark:border-red-600 dark:bg-red-950/40 dark:text-red-300",
  };
}

function CountTable({
  title,
  currency,
  denominations,
  counts,
  onCountChange,
  expected,
}: {
  title: string;
  currency: "USD" | "CDF";
  denominations: readonly number[];
  counts: Record<number, string>;
  onCountChange: (denomination: number, value: string) => void;
  expected: number;
}) {
  const lines = useMemo(
    () => denominations.map((denomination) => {
      const rawCount = counts[denomination] ?? "";
      const parsedCount = Number.parseInt(rawCount, 10);
      const count = Number.isFinite(parsedCount) && parsedCount > 0 ? parsedCount : 0;
      return {
        denomination,
        count,
        amount: denomination * count,
      };
    }),
    [counts, denominations],
  );

  const countedTotal = lines.reduce((sum, line) => sum + line.amount, 0);
  const delta = countedTotal - expected;
  const status = varianceStatus(delta);

  return (
    <section className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-1 text-xs text-black/60 dark:text-white/60">
            Billetage manuel des coupures pour rapprocher le physique du solde de caisse.
          </p>
        </div>
        <div className={`rounded-full border px-3 py-1 text-xs font-semibold ${status.tone}`}>
          {status.label} {currency}
        </div>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-black/5 dark:bg-white/10">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">N°</th>
              <th className="px-3 py-2 text-left font-semibold">Coupure</th>
              <th className="px-3 py-2 text-left font-semibold">Nombre</th>
              <th className="px-3 py-2 text-left font-semibold">Montant</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={line.denomination} className="border-t border-black/5 dark:border-white/10">
                <td className="px-3 py-2">{String(index + 1).padStart(2, "0")}</td>
                <td className="px-3 py-2">{line.denomination.toLocaleString("fr-FR")}</td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={counts[line.denomination] ?? ""}
                    onChange={(event) => onCountChange(line.denomination, event.target.value)}
                    className="w-24 rounded-md border border-black/15 bg-white px-2 py-1.5 text-sm dark:border-white/15 dark:bg-zinc-900"
                    placeholder="0"
                  />
                </td>
                <td className="px-3 py-2">{line.amount.toLocaleString("fr-FR", { minimumFractionDigits: currency === "USD" ? 2 : 0, maximumFractionDigits: currency === "USD" ? 2 : 0 })} {currency}</td>
              </tr>
            ))}
            <tr className="border-t border-black/10 bg-black/5 font-semibold dark:border-white/10 dark:bg-white/10">
              <td className="px-3 py-2" colSpan={3}>TOTAL</td>
              <td className="px-3 py-2">{countedTotal.toLocaleString("fr-FR", { minimumFractionDigits: currency === "USD" ? 2 : 0, maximumFractionDigits: currency === "USD" ? 2 : 0 })} {currency}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-black/10 p-3 dark:border-white/10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-black/55 dark:text-white/55">Solde Caisse Attendu</p>
          <p className="mt-2 text-xl font-semibold">{expected.toLocaleString("fr-FR", { minimumFractionDigits: currency === "USD" ? 2 : 0, maximumFractionDigits: currency === "USD" ? 2 : 0 })} {currency}</p>
        </div>
        <div className="rounded-xl border border-black/10 p-3 dark:border-white/10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-black/55 dark:text-white/55">Billetage Compté</p>
          <p className="mt-2 text-xl font-semibold">{countedTotal.toLocaleString("fr-FR", { minimumFractionDigits: currency === "USD" ? 2 : 0, maximumFractionDigits: currency === "USD" ? 2 : 0 })} {currency}</p>
        </div>
        <div className={`rounded-xl border p-3 ${status.tone}`}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">Écart</p>
          <p className="mt-2 text-xl font-semibold">{delta.toLocaleString("fr-FR", { minimumFractionDigits: currency === "USD" ? 2 : 0, maximumFractionDigits: currency === "USD" ? 2 : 0 })} {currency}</p>
        </div>
      </div>
    </section>
  );
}

export function CashBilletageWorkspace({ expectedUsd, expectedCdf }: { expectedUsd: number; expectedCdf: number }) {
  const [usdCounts, setUsdCounts] = useState<Record<number, string>>({});
  const [cdfCounts, setCdfCounts] = useState<Record<number, string>>({});

  const usdDelta = useMemo(() => {
    const total = usdDenominations.reduce((sum, denomination) => {
      const parsed = Number.parseInt(usdCounts[denomination] ?? "", 10);
      return sum + denomination * (Number.isFinite(parsed) && parsed > 0 ? parsed : 0);
    }, 0);
    return total - expectedUsd;
  }, [expectedUsd, usdCounts]);

  const cdfDelta = useMemo(() => {
    const total = cdfDenominations.reduce((sum, denomination) => {
      const parsed = Number.parseInt(cdfCounts[denomination] ?? "", 10);
      return sum + denomination * (Number.isFinite(parsed) && parsed > 0 ? parsed : 0);
    }, 0);
    return total - expectedCdf;
  }, [cdfCounts, expectedCdf]);

  const overallConform = Math.abs(usdDelta) <= 0.0001 && Math.abs(cdfDelta) <= 0.0001;

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold">Billetage de caisse</h2>
        <p className="mt-2 text-xs text-black/60 dark:text-white/60">
          Référence feuille Excel BILLETAGE: le physique en coupures doit correspondre au solde théorique de la caisse. Tout écart signale un manquant ou un excédent.
        </p>
        <p className={`mt-3 inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${overallConform ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:border-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300" : "border-red-500 bg-red-50 text-red-700 dark:border-red-600 dark:bg-red-950/40 dark:text-red-300"}`}>
          {overallConform ? "Billetage conforme à la caisse" : "Déséquilibre détecté entre billetage et caisse"}
        </p>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <CountTable
          title="Billetage caisse USD"
          currency="USD"
          denominations={usdDenominations}
          counts={usdCounts}
          onCountChange={(denomination, value) => setUsdCounts((current) => ({ ...current, [denomination]: value }))}
          expected={expectedUsd}
        />
        <CountTable
          title="Billetage caisse CDF"
          currency="CDF"
          denominations={cdfDenominations}
          counts={cdfCounts}
          onCountChange={(denomination, value) => setCdfCounts((current) => ({ ...current, [denomination]: value }))}
          expected={expectedCdf}
        />
      </div>
    </div>
  );
}