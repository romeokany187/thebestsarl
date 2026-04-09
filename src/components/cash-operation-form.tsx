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

const categories: Array<{ value: string; label: string }> = [
  { value: "OPENING_BALANCE", label: "Report à nouveau initial (solde d'ouverture)" },
  { value: "OTHER_SALE", label: "Autres ventes" },
  { value: "COMMISSION_INCOME", label: "Commissions" },
  { value: "SERVICE_INCOME", label: "Prestations de service" },
  { value: "LOAN_INFLOW", label: "Emprunt reçu" },
  { value: "ADVANCE_RECOVERY", label: "Récupération d'avance" },
  { value: "SUPPLIER_PAYMENT", label: "Paiement fournisseur" },
  { value: "SALARY_PAYMENT", label: "Paiement salaires" },
  { value: "RENT_PAYMENT", label: "Paiement loyer" },
  { value: "TAX_PAYMENT", label: "Paiement taxes" },
  { value: "UTILITY_PAYMENT", label: "Charges (eau/élec/net)" },
  { value: "TRANSPORT_PAYMENT", label: "Transport" },
  { value: "OTHER_EXPENSE", label: "Autres dépenses" },
];

const cashMethodOptions: Array<{ value: string; label: string }> = [
  { value: "CASH", label: "Cash" },
  { value: "AIRTEL_MONEY", label: "Airtel Money" },
  { value: "ORANGE_MONEY", label: "Orange Money" },
  { value: "MPESA", label: "M-Pesa" },
  { value: "EQUITY", label: "Equity" },
  { value: "RAWBANK_ILLICOCASH", label: "Rawbank & Illicocash" },
];

export function CashOperationForm({
  hasInitialOpening = false,
  allowedMethods,
  title = "Caisse - report à nouveau initial et nouvelles opérations",
  showConversionSection = true,
  descriptionPrefix = "",
  categoryInputMode = "select",
}: {
  hasInitialOpening?: boolean;
  allowedMethods?: string[];
  title?: string;
  showConversionSection?: boolean;
  descriptionPrefix?: string;
  categoryInputMode?: "select" | "text";
}) {
  const router = useRouter();
  const methodOptions = (allowedMethods?.length
    ? cashMethodOptions.filter((option) => allowedMethods.includes(option.value))
    : cashMethodOptions);
  const [direction, setDirection] = useState<"INFLOW" | "OUTFLOW">("INFLOW");
  const [category, setCategory] = useState<string>("OTHER_SALE");
  const [amount, setAmount] = useState<string>("");
  const [currency, setCurrency] = useState<"USD" | "CDF">("USD");
  const [method, setMethod] = useState<string>(methodOptions[0]?.value ?? "CASH");
  const [categoryLabel, setCategoryLabel] = useState<string>("");
  const [reference, setReference] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [occurredAt, setOccurredAt] = useState<string>(toLocalDateTimeInputValue(new Date()));
  const [fxRateUsdToCdf, setFxRateUsdToCdf] = useState<string>("2800");
  const [conversionSourceCurrency, setConversionSourceCurrency] = useState<"USD" | "CDF">("USD");
  const [conversionSourceAmount, setConversionSourceAmount] = useState<string>("");
  const [conversionReference, setConversionReference] = useState<string>("");
  const [conversionDescription, setConversionDescription] = useState<string>("Conversion interne de caisse");
  const [conversionOccurredAt, setConversionOccurredAt] = useState<string>(toLocalDateTimeInputValue(new Date()));
  const [loading, setLoading] = useState<boolean>(false);
  const [conversionLoading, setConversionLoading] = useState<boolean>(false);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");

  const usesFreeTextCategory = categoryInputMode === "text";
  const isOpeningBalance = !usesFreeTextCategory && category === "OPENING_BALANCE";
  const referenceLabel = isOpeningBalance
    ? "Référence report initial"
    : direction === "OUTFLOW"
      ? "Référence justificative sortie"
      : "Référence justificative entrée";
  const referencePlaceholder = isOpeningBalance
    ? "N° PV / fiche de report initial / pièce de départ"
    : direction === "OUTFLOW"
      ? "N° EDB / OP / pièce justificative"
      : "N° bon d'entrée / reçu / pièce justificative";

  const conversionTargetCurrency = conversionSourceCurrency === "USD" ? "CDF" : "USD";
  const numericRatePreview = Number.parseFloat(fxRateUsdToCdf);
  const numericConversionSourceAmountPreview = Number.parseFloat(conversionSourceAmount);
  const conversionTargetAmountPreview = Number.isFinite(numericRatePreview)
    && numericRatePreview > 0
    && Number.isFinite(numericConversionSourceAmountPreview)
    && numericConversionSourceAmountPreview > 0
    ? conversionSourceCurrency === "USD"
      ? numericConversionSourceAmountPreview * numericRatePreview
      : numericConversionSourceAmountPreview / numericRatePreview
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

    if (!description.trim()) {
      setError("Ajoutez un libellé comptable.");
      setLoading(false);
      return;
    }

    if (usesFreeTextCategory && !categoryLabel.trim()) {
      setError("Saisissez la catégorie libre de l'opération.");
      setLoading(false);
      return;
    }

    if (isOpeningBalance && direction !== "INFLOW") {
      setError("Le solde d'ouverture doit être saisi comme une entrée de fonds.");
      setLoading(false);
      return;
    }

    if (!reference.trim()) {
      setError(direction === "OUTFLOW"
        ? "Le numéro justificatif de sortie est obligatoire (EDB, OP ou autre pièce)."
        : "Le numéro de bon d'entrée, reçu ou autre pièce justificative est obligatoire.");
      setLoading(false);
      return;
    }

    const normalizedCurrency = currency;
    const normalizedCategory = usesFreeTextCategory
      ? (direction === "OUTFLOW" ? "OTHER_EXPENSE" : "OTHER_SALE")
      : category;

    if (!occurredAt) {
      setError("Sélectionnez la date et l'heure de l'opération.");
      setLoading(false);
      return;
    }

    const response = await fetch("/api/payments/cash-operations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        direction,
        category: normalizedCategory,
        amount: numericAmount,
        currency: normalizedCurrency,
        method: method.trim(),
        reference: reference.trim(),
        description: `${descriptionPrefix}${usesFreeTextCategory ? `[${categoryLabel.trim()}] ` : ""}${description.trim()}`,
        occurredAt: new Date(occurredAt).toISOString(),
      }),
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      setError(payload?.error ?? "Impossible d'enregistrer l'opération de caisse.");
      setLoading(false);
      return;
    }

    const thresholdAlert = typeof payload?.thresholdAlert === "string" ? payload.thresholdAlert : null;
    setMessage(
      thresholdAlert
        ? `Opération enregistrée. ${thresholdAlert}`
        : "Opération de caisse enregistrée et notifiée à la comptabilité.",
    );
    setAmount("");
    setReference("");
    setDescription("");
    setLoading(false);
    router.refresh();
  }

  async function onConvertSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setConversionLoading(true);
    setMessage("");
    setError("");

    const sourceAmount = Number.parseFloat(conversionSourceAmount);
    const rate = Number.parseFloat(fxRateUsdToCdf);

    if (!Number.isFinite(sourceAmount) || sourceAmount <= 0) {
      setError("Saisissez un montant source valide pour la conversion.");
      setConversionLoading(false);
      return;
    }

    if (!Number.isFinite(rate) || rate <= 0) {
      setError("Saisissez un taux du jour valide (1 USD = X CDF).");
      setConversionLoading(false);
      return;
    }

    if (!conversionOccurredAt) {
      setError("Sélectionnez la date et l'heure de conversion.");
      setConversionLoading(false);
      return;
    }

    if (!conversionReference.trim()) {
      setError("La référence de la pièce justificative de conversion est obligatoire.");
      setConversionLoading(false);
      return;
    }

    const response = await fetch("/api/payments/cash-operations/convert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceCurrency: conversionSourceCurrency,
        sourceAmount,
        fxRateUsdToCdf: rate,
        reference: conversionReference.trim(),
        description: conversionDescription.trim() || undefined,
        occurredAt: new Date(conversionOccurredAt).toISOString(),
      }),
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      setError(payload?.error ?? "Impossible d'enregistrer la conversion de caisse.");
      setConversionLoading(false);
      return;
    }

    const converted = payload?.data;
    setMessage(
      `Conversion enregistrée: ${Number(converted?.sourceAmount ?? sourceAmount).toFixed(2)} ${converted?.sourceCurrency ?? conversionSourceCurrency} -> ${Number(converted?.targetAmount ?? conversionTargetAmountPreview).toFixed(2)} ${converted?.targetCurrency ?? conversionTargetCurrency}.`,
    );
    setConversionSourceAmount("");
    setConversionReference("");
    setConversionLoading(false);
    router.refresh();
  }

  return (
    <section className="mb-6 rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      <p className="mb-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900 dark:border-blue-800/60 dark:bg-blue-950/30 dark:text-blue-100">
        Le <strong>solde d&apos;ouverture</strong> correspond au <strong>report à nouveau initial</strong>. Il ne s&apos;encode qu&apos;une seule fois au démarrage pour une caisse/canal donné, puis le dernier solde du jour devient automatiquement le report à nouveau du lendemain.
      </p>
      <p className="mb-3 text-xs text-black/60 dark:text-white/60">
        Pour initialiser une caisse ou un compte virtuel, choisissez la catégorie <strong>Report à nouveau initial (solde d&apos;ouverture)</strong>, puis la méthode souhaitée <strong>(Cash, Airtel Money, Orange Money, M-Pesa, Equity, Rawbank & Illicocash)</strong>. Ensuite, n&apos;encodez plus de nouveaux soldes d&apos;ouverture: seuls les mouvements réels restent à saisir.
      </p>
      {hasInitialOpening ? (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-100">
          Un report à nouveau initial existe déjà. Le reste du report à nouveau est désormais automatique de jour en jour.
        </p>
      ) : null}
      <form onSubmit={onSubmit} className="grid gap-3 lg:grid-cols-4 lg:items-end">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Type</label>
          <select
            value={direction}
            onChange={(event) => setDirection(event.target.value as "INFLOW" | "OUTFLOW")}
            disabled={isOpeningBalance}
            className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/15 dark:bg-zinc-900"
          >
            <option value="INFLOW">Entrée de fonds</option>
            <option value="OUTFLOW">Sortie de fonds</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">
            {usesFreeTextCategory ? "Catégorie libre" : "Catégorie"}
          </label>
          {usesFreeTextCategory ? (
            <input
              value={categoryLabel}
              onChange={(event) => setCategoryLabel(event.target.value)}
              className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
              placeholder="Ex: ajustement cash, frais client, correction"
            />
          ) : (
            <select
              value={category}
              onChange={(event) => {
                const nextCategory = event.target.value;
                setCategory(nextCategory);
                if (nextCategory === "OPENING_BALANCE") {
                  setDirection("INFLOW");
                }
              }}
              className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            >
              {categories.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          )}
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
            className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm uppercase dark:border-white/15 dark:bg-zinc-900"
          >
            <option value="USD">USD</option>
            <option value="CDF">CDF</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Méthode</label>
          <select
            value={method}
            onChange={(event) => setMethod(event.target.value)}
            disabled={methodOptions.length === 1}
            className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-70 dark:border-white/15 dark:bg-zinc-900"
          >
            {methodOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">{referenceLabel}</label>
          <input
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            required
            className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            placeholder={referencePlaceholder}
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

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Libellé</label>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            placeholder="Motif comptable"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-black px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {loading ? "Enregistrement..." : "Enregistrer l'opération"}
        </button>
      </form>

      {showConversionSection ? (
        <div className="mt-4 border-t border-black/10 pt-4 dark:border-white/10">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">
            Conversion caisse USD/CDF (à utiliser uniquement si nécessaire)
          </h3>
          <form onSubmit={onConvertSubmit} className="grid gap-3 lg:grid-cols-5 lg:items-end">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Débiter</label>
              <select
                value={conversionSourceCurrency}
                onChange={(event) => setConversionSourceCurrency(event.target.value as "USD" | "CDF")}
                className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm uppercase dark:border-white/15 dark:bg-zinc-900"
              >
                <option value="USD">USD</option>
                <option value="CDF">CDF</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Montant débité</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={conversionSourceAmount}
                onChange={(event) => setConversionSourceAmount(event.target.value)}
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
                value={fxRateUsdToCdf}
                onChange={(event) => setFxRateUsdToCdf(event.target.value)}
                className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
                placeholder="1 USD = X CDF"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Date conversion</label>
              <input
                type="datetime-local"
                value={conversionOccurredAt}
                onChange={(event) => setConversionOccurredAt(event.target.value)}
                className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
              />
            </div>

            <button
              type="submit"
              disabled={conversionLoading}
              className="rounded-md border border-black/20 px-4 py-2 text-sm font-semibold hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10"
            >
              {conversionLoading ? "Conversion..." : `Convertir vers ${conversionTargetCurrency}`}
            </button>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Référence conversion</label>
              <input
                value={conversionReference}
                onChange={(event) => setConversionReference(event.target.value)}
                required
                className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
                placeholder="N° pièce justificative / bordereau"
              />
            </div>

            <div className="lg:col-span-3">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Libellé conversion</label>
              <input
                value={conversionDescription}
                onChange={(event) => setConversionDescription(event.target.value)}
                className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
                placeholder="Conversion interne de caisse"
              />
            </div>
          </form>

          <p className="mt-2 text-xs text-black/60 dark:text-white/60">
            Toute entrée, sortie ou conversion doit être rattachée à une pièce justificative. Crédit cible estimé: {conversionTargetAmountPreview.toFixed(2)} {conversionTargetCurrency} (taux 1 USD = {Number.isFinite(numericRatePreview) ? numericRatePreview.toFixed(2) : "0.00"} CDF)
          </p>
        </div>
      ) : null}

      {message ? <p className="mt-2 text-xs text-emerald-600">{message}</p> : null}
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
    </section>
  );
}
