"use client";

import { useMemo, useState } from "react";

const usdDenominations = [100, 50, 20, 10, 5, 1] as const;
const cdfDenominations = [20000, 10000, 5000, 1000, 500, 200, 100, 50] as const;
const STORAGE_PREFIX = "thebestsarl:cash-billetage";

type CountsMap = Record<number, string>;

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

function storageKey(date: string) {
  return `${STORAGE_PREFIX}:${date}`;
}

function CountTable({
  title,
  currency,
  denominations,
  counts,
  onCountChange,
  expected,
  disabled,
}: {
  title: string;
  currency: "USD" | "CDF";
  denominations: readonly number[];
  counts: CountsMap;
  onCountChange: (denomination: number, value: string) => void;
  expected: number;
  disabled: boolean;
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
                    disabled={disabled}
                    className="w-24 rounded-md border border-black/15 bg-white px-2 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/15 dark:bg-zinc-900"
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

      <p className="mt-3 text-xs text-black/60 dark:text-white/60">
        {disabled
          ? "Billetage verrouillé. Cliquez sur Ouvrir ou Modifier pour saisir les coupures de cette date."
          : `Saisie active • Attendu ${expected.toLocaleString("fr-FR", { minimumFractionDigits: currency === "USD" ? 2 : 0, maximumFractionDigits: currency === "USD" ? 2 : 0 })} ${currency}`}
      </p>
    </section>
  );
}

export function CashBilletageWorkspace({ expectedUsd, expectedCdf }: { expectedUsd: number; expectedCdf: number }) {
  const today = new Date().toISOString().slice(0, 10);
  const [selectedDate, setSelectedDate] = useState(today);
  const [usdCounts, setUsdCounts] = useState<CountsMap>({});
  const [cdfCounts, setCdfCounts] = useState<CountsMap>({});
  const [isOpen, setIsOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

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

  const hasAnyCount = [...Object.values(usdCounts), ...Object.values(cdfCounts)].some((value) => {
    const parsed = Number.parseInt(value ?? "", 10);
    return Number.isFinite(parsed) && parsed > 0;
  });
  const overallConform = Math.abs(usdDelta) <= 0.0001 && Math.abs(cdfDelta) <= 0.0001;
  const overallTone = !hasAnyCount
    ? "border-black/15 bg-black/5 text-black/70 dark:border-white/15 dark:bg-white/10 dark:text-white/70"
    : overallConform
      ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:border-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300"
      : "border-red-500 bg-red-50 text-red-700 dark:border-red-600 dark:bg-red-950/40 dark:text-red-300";
  const overallLabel = !hasAnyCount
    ? "Billetage non encore saisi"
    : overallConform
      ? "Billetage conforme à la caisse"
      : "Déséquilibre détecté entre billetage et caisse";

  function openBilletage() {
    try {
      const raw = window.localStorage.getItem(storageKey(selectedDate));
      if (raw) {
        const saved = JSON.parse(raw) as { usdCounts?: CountsMap; cdfCounts?: CountsMap };
        setUsdCounts(saved.usdCounts ?? {});
        setCdfCounts(saved.cdfCounts ?? {});
        setStatusMessage(`Billetage du ${selectedDate} ouvert avec les dernières valeurs enregistrées.`);
      } else {
        setUsdCounts({});
        setCdfCounts({});
        setStatusMessage(`Billetage du ${selectedDate} ouvert. Vous pouvez commencer la saisie.`);
      }
    } catch {
      setUsdCounts({});
      setCdfCounts({});
      setStatusMessage(`Billetage du ${selectedDate} ouvert.`);
    }
    setIsOpen(true);
  }

  function saveBilletage() {
    try {
      window.localStorage.setItem(
        storageKey(selectedDate),
        JSON.stringify({
          date: selectedDate,
          savedAt: new Date().toISOString(),
          expectedUsd,
          expectedCdf,
          usdCounts,
          cdfCounts,
        }),
      );
      setStatusMessage(`Billetage du ${selectedDate} enregistré et verrouillé.`);
    } catch {
      setStatusMessage(`Billetage du ${selectedDate} enregistré dans la session en cours.`);
    }
    setIsOpen(false);
  }

  function reopenBilletage() {
    setIsOpen(true);
    setStatusMessage(`Billetage du ${selectedDate} rouvert pour correction.`);
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold">Billetage de caisse</h2>
        <p className="mt-2 text-xs text-black/60 dark:text-white/60">
          Pour chaque jour, choisissez la date puis cliquez sur <strong>Ouvrir</strong> pour activer la saisie. Après <strong>Enregistrer</strong>, les champs se referment automatiquement.
        </p>
        <p className={`mt-3 inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${overallTone}`}>
          {overallLabel}
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Date du billetage</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(event) => {
                setSelectedDate(event.target.value);
                setIsOpen(false);
                setStatusMessage("");
              }}
              className="rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            />
          </div>

          <button
            type="button"
            onClick={openBilletage}
            className="rounded-md border border-black/20 px-3 py-2 text-xs font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Ouvrir
          </button>

          {isOpen ? (
            <button
              type="button"
              onClick={saveBilletage}
              className="rounded-md bg-black px-3 py-2 text-xs font-semibold text-white dark:bg-white dark:text-black"
            >
              Enregistrer et fermer
            </button>
          ) : (
            <button
              type="button"
              onClick={reopenBilletage}
              className="rounded-md border border-sky-300 px-3 py-2 text-xs font-semibold text-sky-700 hover:bg-sky-50 dark:border-sky-700/60 dark:text-sky-300 dark:hover:bg-sky-950/30"
            >
              Modifier
            </button>
          )}
        </div>

        {statusMessage ? <p className="mt-3 text-xs text-black/60 dark:text-white/60">{statusMessage}</p> : null}
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <CountTable
          title="Billetage caisse USD"
          currency="USD"
          denominations={usdDenominations}
          counts={usdCounts}
          onCountChange={(denomination, value) => setUsdCounts((current) => ({ ...current, [denomination]: value }))}
          expected={expectedUsd}
          disabled={!isOpen}
        />
        <CountTable
          title="Billetage caisse CDF"
          currency="CDF"
          denominations={cdfDenominations}
          counts={cdfCounts}
          onCountChange={(denomination, value) => setCdfCounts((current) => ({ ...current, [denomination]: value }))}
          expected={expectedCdf}
          disabled={!isOpen}
        />
      </div>
    </div>
  );
}