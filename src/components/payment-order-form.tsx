"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { WORKFLOW_ASSIGNMENT_OPTIONS, type WorkflowAssignmentValue } from "@/lib/workflow-assignment";

type PaymentOrderIssuerRole = "ADMIN" | "DIRECTEUR_GENERAL";

const PURPOSE_SUGGESTIONS = [
  "Approvisionnement compagnie",
  "Paiement fournisseur",
  "Règlement visa",
  "Frais opérationnels",
  "Avance de mission",
];

function getApiErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;

  const error = "error" in payload ? payload.error : undefined;
  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (error && typeof error === "object") {
    const formErrors = Array.isArray((error as { formErrors?: unknown }).formErrors)
      ? (error as { formErrors: unknown[] }).formErrors.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];

    if (formErrors.length > 0) {
      return formErrors.join(" ");
    }
  }

  return fallback;
}

export function PaymentOrderForm({ issuerRole = "DIRECTEUR_GENERAL" }: { issuerRole?: PaymentOrderIssuerRole }) {
  const router = useRouter();
  const isAdminIssuer = issuerRole === "ADMIN";
  const [beneficiary, setBeneficiary] = useState("");
  const [purpose, setPurpose] = useState("");
  const [description, setDescription] = useState("");
  const [assignment, setAssignment] = useState<WorkflowAssignmentValue>("A_MON_COMPTE");
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
        setMessage(getApiErrorMessage(payload, "Impossible de créer l'ordre de paiement."));
        return;
      }

      const createdCode = payload?.data?.code ?? "";
      const createdStatus = payload?.data?.status ?? "";

      setState("success");
      setMessage(
        (createdStatus === "APPROVED"
          ? `Ordre de paiement ${createdCode} envoyé directement en exécution.`
          : `Ordre de paiement ${createdCode} envoyé pour validation.`).trim(),
      );
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
      <h2 className="text-sm font-semibold">{isAdminIssuer ? "Nouvel ordre de paiement (Admin)" : "Nouvel ordre de paiement (DG)"}</h2>
      <p className="mt-1 text-xs text-black/60 dark:text-white/60">
        {isAdminIssuer
          ? "Un OP émis par l'admin part directement en exécution caisse, sans attente d'approbation."
          : "Un OP émis par la DG part d'abord à l'approbation admin puis à l'exécution caisse."}
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
        <>
          <input
            list="payment-order-purpose-suggestions"
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
            placeholder="Motif (ex: Approvisionnement compagnie)"
            maxLength={180}
            className="rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            disabled={state === "loading"}
          />
          <datalist id="payment-order-purpose-suggestions">
            {PURPOSE_SUGGESTIONS.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
        </>
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
          onChange={(event) => setAssignment(event.target.value as WorkflowAssignmentValue)}
          className="min-w-0 rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
          disabled={state === "loading"}
        >
          {WORKFLOW_ASSIGNMENT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
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
          Émettre OP
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
