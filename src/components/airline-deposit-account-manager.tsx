"use client";

import { useMemo, useState } from "react";
import {
  AIRLINE_TICKET_DEPOSIT_START_ISO,
  AIRLINE_TICKET_DEPOSIT_START_LABEL,
  type AirlineDepositAccountSummary,
} from "@/lib/airline-deposit";

type FormState = {
  accountKey: string;
  amount: string;
  reference: string;
  description: string;
  movementDate: string;
};

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

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
    movementDate: todayIsoDate(),
  });
  const [status, setStatus] = useState("");
  const [statusType, setStatusType] = useState<"idle" | "success" | "error" | "loading">("idle");
  const [detailAccountKey, setDetailAccountKey] = useState<string | null>(null);

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.key === form.accountKey) ?? null,
    [accounts, form.accountKey],
  );
  const detailAccount = useMemo(
    () => accounts.find((account) => account.key === detailAccountKey) ?? null,
    [accounts, detailAccountKey],
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
        createdAt: form.movementDate ? `${form.movementDate}T12:00:00.000Z` : undefined,
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
          Section admin / DG / comptable : vous pouvez réinitialiser puis ressaisir les dépôts à leur date réelle. Les billets et ajustements datés à partir du {AIRLINE_TICKET_DEPOSIT_START_LABEL} impactent automatiquement ces comptes.
        </p>
      </div>

      {canManage ? (
        <form onSubmit={onSubmit} className="mb-4 grid gap-3 rounded-lg border border-black/10 p-3 dark:border-white/10">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
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
            <input
              required
              type="date"
              min={AIRLINE_TICKET_DEPOSIT_START_ISO}
              max={todayIsoDate()}
              value={form.movementDate}
              onChange={(event) => updateField("movementDate", event.target.value)}
              className="rounded-md border px-3 py-2"
            />
          </div>

          {selectedAccount ? (
            <p className="text-xs text-black/60 dark:text-white/60">
              Solde actuel: <span className="font-semibold">{formatUsd(selectedAccount.balance)}</span> • Compagnies liées: {selectedAccount.airlineNames.join(", ")} • Date d&apos;écriture: {form.movementDate || "aujourd&apos;hui"}
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
          Section réservée à l'administrateur, au DG et au comptable.
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
              <div className="rounded-md bg-emerald-50 px-2 py-1 dark:bg-emerald-950/20">
                Total crédité: <span className="font-semibold">{formatUsd(account.totalCredits)}</span>
              </div>
              <div className="rounded-md bg-amber-50 px-2 py-1 dark:bg-amber-950/20">
                Total débité: <span className="font-semibold">{formatUsd(account.totalDebits)}</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed border-black/10 px-3 py-2 dark:border-white/10">
              <p className="text-xs text-black/60 dark:text-white/60">
                Les mouvements détaillés sont masqués sur la carte pour garder la page lisible.
              </p>
              <button
                type="button"
                onClick={() => setDetailAccountKey(account.key)}
                className="rounded-md border border-black/20 px-3 py-1.5 text-xs font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
              >
                Détail
              </button>
            </div>
          </article>
        ))}
      </div>

      {detailAccount ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="Fermer les détails"
            className="absolute inset-0 cursor-default"
            onClick={() => setDetailAccountKey(null)}
          />
          <div className="relative z-10 max-h-[85vh] w-full max-w-5xl overflow-hidden rounded-2xl border border-black/10 bg-white shadow-2xl dark:border-white/10 dark:bg-zinc-900">
            <div className="flex items-start justify-between gap-3 border-b border-black/10 px-4 py-3 dark:border-white/10">
              <div>
                <h3 className="text-base font-semibold">Détails — {detailAccount.label}</h3>
                <p className="text-xs text-black/60 dark:text-white/60">
                  {detailAccount.airlineNames.join(", ")} • Solde actuel {formatUsd(detailAccount.balance)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailAccountKey(null)}
                className="rounded-md border border-black/20 px-3 py-1.5 text-xs font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
              >
                Fermer
              </button>
            </div>

            <div className="max-h-[calc(85vh-72px)] overflow-y-auto p-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <section className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-800/40 dark:bg-emerald-950/20">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">Crédits</h4>
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                      {detailAccount.recentMovements.filter((movement) => movement.movementType === "CREDIT").length}
                    </span>
                  </div>
                  <div className="space-y-2 text-xs">
                    {detailAccount.recentMovements.filter((movement) => movement.movementType === "CREDIT").length === 0 ? (
                      <p className="text-black/60 dark:text-white/60">Aucun crédit récent.</p>
                    ) : (
                      detailAccount.recentMovements
                        .filter((movement) => movement.movementType === "CREDIT")
                        .map((movement) => (
                          <div key={movement.id} className="rounded-md border border-emerald-200 bg-white px-3 py-2 dark:border-emerald-800/40 dark:bg-zinc-950/40">
                            <div className="flex items-center justify-between gap-2">
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">Crédit</span>
                              <span className="font-semibold">{formatUsd(movement.amount)}</span>
                            </div>
                            <p className="mt-1 font-medium">{movement.reference}</p>
                            <p className="text-black/70 dark:text-white/70">{movement.description}</p>
                            <p className="text-black/50 dark:text-white/50">
                              {new Date(movement.createdAt).toLocaleString("fr-FR")} • {movement.airlineCode ?? "Compte"}{movement.createdByName ? ` • par ${movement.createdByName}` : ""}
                            </p>
                          </div>
                        ))
                    )}
                  </div>
                </section>

                <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-800/40 dark:bg-amber-950/20">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold text-amber-800 dark:text-amber-200">Débits</h4>
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                      {detailAccount.recentMovements.filter((movement) => movement.movementType === "DEBIT").length}
                    </span>
                  </div>
                  <div className="space-y-2 text-xs">
                    {detailAccount.recentMovements.filter((movement) => movement.movementType === "DEBIT").length === 0 ? (
                      <p className="text-black/60 dark:text-white/60">Aucun débit récent.</p>
                    ) : (
                      detailAccount.recentMovements
                        .filter((movement) => movement.movementType === "DEBIT")
                        .map((movement) => (
                          <div key={movement.id} className="rounded-md border border-amber-200 bg-white px-3 py-2 dark:border-amber-800/40 dark:bg-zinc-950/40">
                            <div className="flex items-center justify-between gap-2">
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">Débit</span>
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
                </section>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
