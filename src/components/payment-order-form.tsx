"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type PaymentOrderAssignment = "A_MON_COMPTE" | "VISAS" | "SAFETY" | "BILLETTERIE" | "TSL";

const ASSIGNMENT_LABELS: Record<PaymentOrderAssignment, string> = {
  A_MON_COMPTE: "À mon compte",
  VISAS: "Visas",
  SAFETY: "Safety",
  BILLETTERIE: "Billetterie",
  TSL: "TSL",
};

export function PaymentOrderForm() {
  const router = useRouter();
  const [beneficiary, setBeneficiary] = useState("");
  const [purpose, setPurpose] = useState("");
  const [description, setDescription] = useState("");
  const [assignment, setAssignment] = useState<PaymentOrderAssignment>("A_MON_COMPTE");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<"CDF" | "USD">("CDF");
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  async function submitOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedAmount = Number(amount);
    if (!beneficiary.trim() || !purpose.trim() || !description.trim() || !Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      setState("error");
      setMessage("Renseignez le bénéficiaire, le motif, la description et un montant valide.");
      return;
    }

    setState("loading");
    setMessage("");
    setPdfUrl(null);

    try {
      const response = await fetch("/api/payment-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          beneficiary: beneficiary.trim(),
          purpose: purpose.trim(),
          description: description.trim(),
          assignment,
          amount: normalizedAmount,
          currency,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setState("error");
        setMessage(payload?.error ?? "Impossible de créer l'ordre de paiement.");
        return;
      }

      setState("success");
      setMessage(`Ordre de paiement ${payload?.data?.code ?? ""} envoyé pour validation.`.trim());
      setPdfUrl(payload?.pdf?.url ?? null);
      setBeneficiary("");
      setPurpose("");
      setDescription("");
      setAssignment("A_MON_COMPTE");
      setAmount("");
      setCurrency("CDF");
      router.refresh();
    } catch {
      setState("error");
      setMessage("Erreur réseau pendant la création de l'ordre de paiement.");
    }
  }

  return (
    <form onSubmit={(event) => void submitOrder(event)} className="mb-6 rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold">Nouvel ordre de paiement (DG)</h2>
      <p className="mt-1 text-xs text-black/60 dark:text-white/60">
        L&apos;OP exige le bénéficiaire, le motif, la description, l&apos;affectation, le montant et la devise. Le document PDF est généré automatiquement.
      </p>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <input
          value={beneficiary}
          onChange={(event) => setBeneficiary(event.target.value)}
          placeholder="Bénéficiaire"
          maxLength={180}
          className="rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
          disabled={state === "loading"}
        />
        <input
          value={purpose}
          onChange={(event) => setPurpose(event.target.value)}
          placeholder="Motif"
          maxLength={180}
          className="rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
          disabled={state === "loading"}
        />
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_120px_96px]">
        <input
          type="text"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Description"
          maxLength={1500}
          className="min-w-0 rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
          disabled={state === "loading"}
        />
        <select
          value={assignment}
          onChange={(event) => setAssignment(event.target.value as PaymentOrderAssignment)}
          className="min-w-0 rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
          disabled={state === "loading"}
        >
          {Object.entries(ASSIGNMENT_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <input
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="Montant"
          inputMode="decimal"
          className="min-w-0 rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
          disabled={state === "loading"}
        />
        <select
          value={currency}
          onChange={(event) => setCurrency(event.target.value as "CDF" | "USD")}
          className="min-w-0 rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
          disabled={state === "loading"}
        >
          <option value="CDF">CDF</option>
          <option value="USD">USD</option>
        </select>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={state === "loading"}
          className="rounded-md border border-black/20 px-3 py-1.5 text-xs font-semibold hover:bg-black/5 disabled:opacity-60 dark:border-white/20 dark:hover:bg-white/10"
        >
          Envoyer OP
        </button>
        {pdfUrl ? (
          <a
            href={pdfUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-black/20 px-3 py-1.5 text-xs font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Voir le PDF
          </a>
        ) : null}
        {message ? <span className="text-xs text-black/65 dark:text-white/65">{message}</span> : null}
      </div>
    </form>
  );
}
