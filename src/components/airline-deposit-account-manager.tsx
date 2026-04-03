"use client";

import { useMemo, useState } from "react";
import type { AirlineDepositAccountSummary } from "@/lib/airline-deposit";

type FormState = {
  accountKey: string;
  amount: string;
  reference: string;
  description: string;
};

function formatUsd(value: number) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(value);
}

export function AirlineDepositAccountManager({
  accounts,
  canManage,
}: {
  accounts: AirlineDepositAccountSummary[];
  canManage: boolean;
}) {
  const defaultAccountKey = accounts[0]?.key ?? "";
  const [form, setForm] = useState<FormState>({
    accountKey: defaultAccountKey,
    amount: "",
    reference: "",
    description: "Approvisionnement compte dépôt compagnie",
  });
  const [status, setStatus] = useState("");
  const [statusType, setStatusType] = useState<"idle" | "success" | "error" | "loading">("idle");

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.key === form.accountKey) ?? null,
    [accounts, form.accountKey],
  );

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatusType("loading");
    setStatus("Crédit du compte en cours...");

    const response = await fetch("/api/airline-deposits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountKey: form.accountKey,
        amount: Number(form.amount),
        reference: form.reference,
        description: form.description,
      }),
    });

    if (response.ok) {
      setStatusType("success");
      setStatus("Compte dépôt crédité avec succès.");
      window.location.reload();
      return;
    }

    const payload = await response.json().catch(() => null);
    setStatusType("error");
    setStatus(payload?.error ?? "Impossible de créditer ce compte dépôt.");
  }

  if (accounts.length === 0) {
    return null;
  }

  return (
    <section className="mb-6 rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
      <div className="mb-4 flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Comptes dépôts compagnies</h2>
        <p className="text-sm text-black/60 dark:text-white/60">
          Section comptable: le comptable crédite ces comptes, puis chaque billet des compagnies concernées est débité automatiquement.
        </p>
      </div>

      {canManage ? (
        <form onSubmit={onSubmit} className="mb-4 grid gap-3 rounded-lg border border-black/10 p-3 dark:border-white/10">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <select
              required
              value={form.accountKey}
              onChange={(event) => updateField("accountKey", event.target.value)}
              className="rounded-md border px-3 py-2"
            >
              {accounts.map((account) => (
                <option key={account.key} value={account.key}>
                  {account.label}
                </option>
              ))}
            </select>
            <input
              required
              type="number"
              min="0.01"
              step="0.01"
              value={form.amount}
              onChange={(event) => updateField("amount", event.target.value)}
              placeholder="Montant à créditer (USD)"
              className="rounded-md border px-3 py-2"
            />
            <input
              required
              value={form.reference}
              onChange={(event) => updateField("reference", event.target.value)}
              placeholder="Référence justificative / OP"
              className="rounded-md border px-3 py-2"
            />
            <input
              required
              value={form.description}
              onChange={(event) => updateField("description", event.target.value)}
              placeholder="Libellé"
              className="rounded-md border px-3 py-2"
            />
          </div>

          {selectedAccount ? (
            <p className="text-xs text-black/60 dark:text-white/60">
              Solde actuel: <span className="font-semibold">{formatUsd(selectedAccount.balance)}</span> • Compagnies liées: {selectedAccount.airlineNames.join(", ")}
            </p>
          ) : null}

          <div className="flex items-center gap-3">
            <button className="rounded-md bg-black px-3 py-2 text-sm text-white dark:bg-white dark:text-black">
              Créditer le compte
            </button>
            {status ? (
              <p
                className={`text-xs ${
                  statusType === "error"
                    ? "text-red-600 dark:text-red-300"
                    : statusType === "success"
                      ? "text-emerald-600 dark:text-emerald-300"
                      : "text-black/60 dark:text-white/60"
                }`}
              >
                {status}
              </p>
            ) : null}
          </div>
        </form>
      ) : (
        <p className="mb-4 text-xs text-black/60 dark:text-white/60">
          Section réservée au comptable.
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {accounts.map((account) => (
          <article key={account.key} className="rounded-lg border border-black/10 p-3 dark:border-white/10">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold">{account.label}</h3>
                <p className="text-xs text-black/60 dark:text-white/60">{account.airlineNames.join(", ")}</p>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-wide text-black/50 dark:text-white/50">Solde</p>
                <p className={`text-lg font-semibold ${account.balance < 0 ? "text-red-600 dark:text-red-300" : ""}`}>
                  {formatUsd(account.balance)}
                </p>
              </div>
            </div>

            <div className="mb-3 grid gap-2 text-xs sm:grid-cols-2">
              <div className="rounded-md bg-black/5 px-2 py-1 dark:bg-white/10">
                Total crédité: <span className="font-semibold">{formatUsd(account.totalCredits)}</span>
              </div>
              <div className="rounded-md bg-black/5 px-2 py-1 dark:bg-white/10">
                Total débité: <span className="font-semibold">{formatUsd(account.totalDebits)}</span>
              </div>
            </div>

            <div className="space-y-2 text-xs">
              {account.recentMovements.length === 0 ? (
                <p className="text-black/60 dark:text-white/60">Aucun mouvement pour l&apos;instant.</p>
              ) : (
                account.recentMovements.map((movement) => (
                  <div key={movement.id} className="rounded-md border border-black/10 px-2 py-2 dark:border-white/10">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`rounded-full px-2 py-0.5 font-semibold ${
                        movement.movementType === "CREDIT"
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                          : "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                      }`}>
                        {movement.movementType === "CREDIT" ? "Crédit" : "Débit"}
                      </span>
                      <span className="font-semibold">{formatUsd(movement.amount)}</span>
                    </div>
                    <p className="mt-1 font-medium">{movement.reference}</p>
                    <p className="text-black/70 dark:text-white/70">{movement.description}</p>
                    <p className="text-black/50 dark:text-white/50">
                      {new Date(movement.createdAt).toLocaleString("fr-FR")} • {movement.airlineCode ?? "Compte"}{movement.ticketNumber ? ` • Billet ${movement.ticketNumber}` : ""}{movement.createdByName ? ` • par ${movement.createdByName}` : ""}
                    </p>
                  </div>
                ))
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
