"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

function toLocalDateTimeInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

type ProxyOperationType = "OPENING_BALANCE" | "DEPOSIT" | "WITHDRAWAL";
type ProxyChannel = "CASH" | "AIRTEL_MONEY" | "ORANGE_MONEY" | "MPESA" | "EQUITY" | "RAWBANK_ILLICOCASH";

const channelOptions: Array<{ value: ProxyChannel; label: string }> = [
  { value: "CASH", label: "Cash" },
  { value: "AIRTEL_MONEY", label: "Airtel Money" },
  { value: "ORANGE_MONEY", label: "Orange Money" },
  { value: "MPESA", label: "M-Pesa" },
  { value: "EQUITY", label: "Equity" },
  { value: "RAWBANK_ILLICOCASH", label: "Rawbank & Illicocash" },
];

export function ProxyBankingForm() {
  const router = useRouter();
  const [operationType, setOperationType] = useState<ProxyOperationType>("DEPOSIT");
  const [channel, setChannel] = useState<ProxyChannel>("AIRTEL_MONEY");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<"USD" | "CDF">("USD");
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [occurredAt, setOccurredAt] = useState(toLocalDateTimeInputValue(new Date()));
  const [changeReceivedCurrency, setChangeReceivedCurrency] = useState<"USD" | "CDF">("CDF");
  const [changeReceivedAmount, setChangeReceivedAmount] = useState("");
  const [changeReference, setChangeReference] = useState("");
  const [changeDescription, setChangeDescription] = useState("");
  const [changeOccurredAt, setChangeOccurredAt] = useState(toLocalDateTimeInputValue(new Date()));
  const [changeRateUsdToCdf, setChangeRateUsdToCdf] = useState("2800");
  const [loading, setLoading] = useState(false);
  const [changeLoading, setChangeLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const isOpening = operationType === "OPENING_BALANCE";
  const isDeposit = operationType === "DEPOSIT";
  const changePaidCurrency = changeReceivedCurrency === "USD" ? "CDF" : "USD";
  const numericChangeRate = Number.parseFloat(changeRateUsdToCdf);
  const numericChangeReceivedAmount = Number.parseFloat(changeReceivedAmount);
  const changePaidAmountPreview = Number.isFinite(numericChangeRate)
    && numericChangeRate > 0
    && Number.isFinite(numericChangeReceivedAmount)
    && numericChangeReceivedAmount > 0
    ? changeReceivedCurrency === "USD"
      ? numericChangeReceivedAmount * numericChangeRate
      : numericChangeReceivedAmount / numericChangeRate
    : 0;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    setError("");

    const numericAmount = Number.parseFloat(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError("Saisissez un montant valide.");
      setLoading(false);
      return;
    }

    if (!reference.trim()) {
      setError("La référence justificative est obligatoire.");
      setLoading(false);
      return;
    }

    if (!occurredAt) {
      setError("Sélectionnez la date et l'heure de l'opération.");
      setLoading(false);
      return;
    }

    if (!isOpening && channel === "CASH") {
      setError("Choisissez un canal virtuel pour un dépôt ou un retrait client.");
      setLoading(false);
      return;
    }

    try {
      const response = await fetch("/api/payments/proxy-banking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationType,
          channel,
          amount: numericAmount,
          currency,
          reference: reference.trim(),
          description: description.trim() || undefined,
          occurredAt: new Date(occurredAt).toISOString(),
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error ?? "Impossible d'enregistrer l'opération proxy banking.");
        setLoading(false);
        return;
      }

      if (operationType === "OPENING_BALANCE") {
        setMessage("Solde initial proxy banking enregistré.");
      } else if (operationType === "DEPOSIT") {
        setMessage("Dépôt client enregistré : cash reçu et compte virtuel débité.");
      } else {
        setMessage("Retrait client enregistré : compte virtuel crédité et cash remis.");
      }

      setAmount("");
      setReference("");
      setDescription("");
      setLoading(false);
      router.refresh();
    } catch {
      setError("Erreur réseau pendant l'opération proxy banking.");
      setLoading(false);
    }
  }

  async function onChangeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setChangeLoading(true);
    setMessage("");
    setError("");

    const receivedAmount = Number.parseFloat(changeReceivedAmount);
    const rate = Number.parseFloat(changeRateUsdToCdf);

    if (!Number.isFinite(receivedAmount) || receivedAmount <= 0) {
      setError("Saisissez le montant réellement reçu du client.");
      setChangeLoading(false);
      return;
    }

    if (!Number.isFinite(rate) || rate <= 0) {
      setError("Saisissez un taux du jour valide (1 USD = X CDF).");
      setChangeLoading(false);
      return;
    }

    if (!changeOccurredAt) {
      setError("Sélectionnez la date et l'heure du change.");
      setChangeLoading(false);
      return;
    }

    if (!changeReference.trim()) {
      setError("La référence justificative du change est obligatoire.");
      setChangeLoading(false);
      return;
    }

    const paidAmount = changeReceivedCurrency === "USD"
      ? receivedAmount * rate
      : receivedAmount / rate;

    try {
      const response = await fetch("/api/payments/cash-operations/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceCurrency: changePaidCurrency,
          sourceAmount: paidAmount,
          fxRateUsdToCdf: rate,
          reference: changeReference.trim(),
          description: `PROXY_BANKING:EXCHANGE:${changeDescription.trim() || `Change client ${changeReceivedCurrency} vers ${changePaidCurrency}`}`,
          occurredAt: new Date(changeOccurredAt).toISOString(),
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error ?? "Impossible d'enregistrer l'opération de change.");
        setChangeLoading(false);
        return;
      }

      setMessage(
        `Change enregistré : caisse créditée de ${receivedAmount.toFixed(2)} ${changeReceivedCurrency} et débitée de ${paidAmount.toFixed(2)} ${changePaidCurrency}.`,
      );
      setChangeReceivedAmount("");
      setChangeReference("");
      setChangeDescription("");
      setChangeLoading(false);
      router.refresh();
    } catch {
      setError("Erreur réseau pendant l'opération de change.");
      setChangeLoading(false);
    }
  }

  return (
    <section className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold">Proxy Banking</h2>
      <p className="mt-2 text-xs text-black/60 dark:text-white/60">
        Dépôt client : <strong>cash +</strong> et <strong>virtuel -</strong>. Retrait client : <strong>virtuel +</strong> et <strong>cash -</strong>. <strong>Change client</strong> : la caisse cash est créditée dans la devise reçue et débitée dans la devise remise au client, sans toucher aux comptes virtuels.
      </p>
      <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
        <strong>Seul l'administrateur peut supprimer ou modifier une opération proxy banking, toutes caisses confondues.</strong>
      </p>

      <form onSubmit={onSubmit} className="mt-4 grid gap-3 lg:grid-cols-4 lg:items-end">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Opération</label>
          <select
            value={operationType}
            onChange={(event) => {
              const nextValue = event.target.value as ProxyOperationType;
              setOperationType(nextValue);
              if (nextValue !== "OPENING_BALANCE" && channel === "CASH") {
                setChannel("AIRTEL_MONEY");
              }
            }}
            className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
          >
            <option value="DEPOSIT">Dépôt client</option>
            <option value="WITHDRAWAL">Retrait client</option>
            <option value="OPENING_BALANCE">Solde initial</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">
            {isOpening ? "Compte à initialiser" : "Canal virtuel"}
          </label>
          <select
            value={channel}
            onChange={(event) => setChannel(event.target.value as ProxyChannel)}
            className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
          >
            {channelOptions
              .filter((option) => isOpening || option.value !== "CASH")
              .map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Montant</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            placeholder="0.00"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Devise</label>
          <select
            value={currency}
            onChange={(event) => setCurrency(event.target.value as "USD" | "CDF")}
            className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
          >
            <option value="USD">USD</option>
            <option value="CDF">CDF</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Référence</label>
          <input
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            required
            className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            placeholder="N° reçu / bordereau / pièce"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Date opération</label>
          <input
            type="datetime-local"
            value={occurredAt}
            onChange={(event) => setOccurredAt(event.target.value)}
            className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
          />
        </div>

        <div className="lg:col-span-2">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Libellé</label>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            placeholder={isDeposit ? "Dépôt client proxy banking" : operationType === "WITHDRAWAL" ? "Retrait client proxy banking" : "Solde initial proxy banking"}
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-black px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {loading ? "Enregistrement..." : "Enregistrer"}
        </button>
      </form>

      <div className="mt-4 border-t border-black/10 pt-4 dark:border-white/10">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Opération de change cash USD/CDF</h3>
        <p className="mt-1 text-xs text-black/60 dark:text-white/60">
          Indiquez la <strong>devise reçue du client</strong>. Le système crédite cette devise dans la caisse et débite automatiquement la devise remise au client.
        </p>

        <form onSubmit={onChangeSubmit} className="mt-3 grid gap-3 lg:grid-cols-5 lg:items-end">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Reçu du client</label>
            <select
              value={changeReceivedCurrency}
              onChange={(event) => setChangeReceivedCurrency(event.target.value as "USD" | "CDF")}
              className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm uppercase dark:border-white/15 dark:bg-zinc-900"
            >
              <option value="CDF">CDF</option>
              <option value="USD">USD</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Montant reçu</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={changeReceivedAmount}
              onChange={(event) => setChangeReceivedAmount(event.target.value)}
              className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
              placeholder="0.00"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Taux du jour</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={changeRateUsdToCdf}
              onChange={(event) => setChangeRateUsdToCdf(event.target.value)}
              className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
              placeholder="1 USD = X CDF"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Date change</label>
            <input
              type="datetime-local"
              value={changeOccurredAt}
              onChange={(event) => setChangeOccurredAt(event.target.value)}
              className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            />
          </div>

          <button
            type="submit"
            disabled={changeLoading}
            className="rounded-md border border-black/20 px-4 py-2 text-sm font-semibold hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10"
          >
            {changeLoading ? "Enregistrement..." : `Valider le change (${changePaidCurrency})`}
          </button>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Référence change</label>
            <input
              value={changeReference}
              onChange={(event) => setChangeReference(event.target.value)}
              required
              className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
              placeholder="N° reçu / bordereau / pièce"
            />
          </div>

          <div className="lg:col-span-2">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Libellé change</label>
            <input
              value={changeDescription}
              onChange={(event) => setChangeDescription(event.target.value)}
              className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
              placeholder="Change client cash"
            />
          </div>

          <div className="lg:col-span-2 rounded-md border border-dashed border-black/15 px-3 py-2 text-xs text-black/70 dark:border-white/15 dark:text-white/70">
            Remise au client estimée : <strong>{changePaidAmountPreview.toFixed(2)} {changePaidCurrency}</strong>
          </div>
        </form>
      </div>

      {message ? <p className="mt-3 text-xs text-emerald-600">{message}</p> : null}
      {error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}
    </section>
  );
}
