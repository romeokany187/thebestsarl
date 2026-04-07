"use client";

import { useEffect, useMemo, useState } from "react";

type WritingMode = "none" | "tickets" | "cash" | "virtual" | "billetage" | "payment-orders" | "needs";
type CashDeskOption = { value: string; label: string; description: string };

type AppRoleLike = "ADMIN" | "DIRECTEUR_GENERAL" | "MANAGER" | "EMPLOYEE" | "ACCOUNTANT";

const ALL_CASH_DESKS: CashDeskOption[] = [
  { value: "CAISSE_1_SIEGE", label: "Caisse 1 Siège", description: "Caisse principale du siège." },
  { value: "CAISSE_2_SIEGE", label: "Caisse 2 Siège", description: "Poste central qui pilote plusieurs caisses rattachées." },
  { value: "CAISSE_BILLETTERIE", label: "Caisse Billetterie", description: "Encaissements et suivi dédiés au billetage." },
  { value: "CAISSE_BESTSAFETY", label: "Caisse BestSafety", description: "Suivi des opérations de la caisse BestSafety." },
  { value: "CAISSE_TSL", label: "Caisse TSL", description: "Suivi des opérations de la caisse TSL." },
  { value: "CAISSE_AGENCE", label: "Caisse agence", description: "Caisse locale utilisée par les agences." },
];

function getManagedCashDesks(jobTitle?: string | null, role?: AppRoleLike | string | null) {
  const normalizedJobTitle = (jobTitle ?? "").trim().toUpperCase();
  const normalizedRole = (role ?? "").trim().toUpperCase();

  if (
    normalizedRole === "ADMIN"
    || normalizedRole === "DIRECTEUR_GENERAL"
    || normalizedRole === "ACCOUNTANT"
    || normalizedJobTitle === "COMPTABLE"
  ) {
    return ALL_CASH_DESKS;
  }

  if (normalizedJobTitle === "CAISSE_2_SIEGE") {
    return ALL_CASH_DESKS.filter((desk) => [
      "CAISSE_2_SIEGE",
      "CAISSE_BILLETTERIE",
      "CAISSE_BESTSAFETY",
      "CAISSE_TSL",
    ].includes(desk.value));
  }

  if (normalizedJobTitle === "CAISSE_AGENCE") {
    return ALL_CASH_DESKS.filter((desk) => desk.value === "CAISSE_AGENCE");
  }

  return ALL_CASH_DESKS.filter((desk) => desk.value === "CAISSE_1_SIEGE");
}

export function PaymentsWritingWorkspace({
  ticketWorkspace,
  cashWorkspace,
  virtualWorkspace,
  billetageWorkspace,
  paymentOrdersWorkspace,
  paymentOrdersLabel,
  needsWorkspace,
  needsLabel,
  closedSummary,
  jobTitle,
  role,
}: {
  ticketWorkspace?: React.ReactNode;
  cashWorkspace?: React.ReactNode;
  virtualWorkspace?: React.ReactNode;
  billetageWorkspace?: React.ReactNode;
  paymentOrdersWorkspace?: React.ReactNode;
  paymentOrdersLabel?: string;
  needsWorkspace?: React.ReactNode;
  needsLabel?: string;
  closedSummary?: React.ReactNode;
  jobTitle?: string | null;
  role?: AppRoleLike | string | null;
}) {
  const [mode, setMode] = useState<WritingMode>("none");
  const deskOptions = useMemo(() => getManagedCashDesks(jobTitle, role), [jobTitle, role]);
  const [selectedDesk, setSelectedDesk] = useState(deskOptions[0]?.value ?? "");

  useEffect(() => {
    if (!deskOptions.some((desk) => desk.value === selectedDesk)) {
      setSelectedDesk(deskOptions[0]?.value ?? "");
    }
  }, [deskOptions, selectedDesk]);

  const currentDesk = deskOptions.find((desk) => desk.value === selectedDesk) ?? deskOptions[0] ?? null;

  const actionItems = [
    ticketWorkspace ? { key: "tickets" as const, label: "Opérations de paiement des billets", tone: "emerald" } : null,
    cashWorkspace ? { key: "cash" as const, label: "Autres opérations de caisse", tone: "blue" } : null,
    paymentOrdersWorkspace ? { key: "payment-orders" as const, label: paymentOrdersLabel ?? "OP à exécuter", tone: "amber" } : null,
    billetageWorkspace ? { key: "billetage" as const, label: "Billetage", tone: "sky" } : null,
    virtualWorkspace ? { key: "virtual" as const, label: "Virtuel", tone: "cyan" } : null,
    needsWorkspace ? { key: "needs" as const, label: needsLabel ?? "EDB à exécuter", tone: "violet" } : null,
  ].filter(Boolean) as Array<{ key: Exclude<WritingMode, "none">; label: string; tone: string }>;

  function actionToneClass(itemTone: string, active: boolean) {
    if (!active) {
      return "border border-black/15 text-black/75 hover:bg-black/5 dark:border-white/15 dark:text-white/75 dark:hover:bg-white/10";
    }

    if (itemTone === "emerald") return "border border-emerald-500 bg-emerald-50 text-emerald-700 dark:border-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300";
    if (itemTone === "blue") return "border border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-600 dark:bg-blue-950/40 dark:text-blue-300";
    if (itemTone === "amber") return "border border-amber-500 bg-amber-50 text-amber-700 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-300";
    if (itemTone === "sky") return "border border-sky-500 bg-sky-50 text-sky-700 dark:border-sky-600 dark:bg-sky-950/40 dark:text-sky-300";
    if (itemTone === "cyan") return "border border-cyan-500 bg-cyan-50 text-cyan-700 dark:border-cyan-600 dark:bg-cyan-950/40 dark:text-cyan-300";
    return "border border-violet-500 bg-violet-50 text-violet-700 dark:border-violet-600 dark:bg-violet-950/40 dark:text-violet-300";
  }

  return (
    <>
      <section className="mb-6 grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-black/50 dark:text-white/50">Caisses</p>
          <h2 className="mt-1 text-sm font-semibold">Sous-menu Paiements</h2>
          <p className="mt-1 text-xs text-black/60 dark:text-white/60">
            Choisissez une caisse dans la liste puis ouvrez le menu d&apos;action correspondant, comme dans une navigation latérale dédiée.
          </p>

          <div className="mt-4">
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Caisses gérées</label>
            <select
              value={selectedDesk}
              onChange={(event) => {
                setSelectedDesk(event.target.value);
                setMode("none");
              }}
              className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            >
              {deskOptions.map((desk) => (
                <option key={desk.value} value={desk.value}>{desk.label}</option>
              ))}
            </select>
            {currentDesk ? (
              <p className="mt-2 rounded-lg border border-black/10 bg-black/5 px-3 py-2 text-xs text-black/65 dark:border-white/10 dark:bg-white/5 dark:text-white/65">
                {currentDesk.description}
              </p>
            ) : null}
          </div>

          <div className="mt-4 space-y-2">
            {actionItems.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setMode(item.key)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-semibold transition ${actionToneClass(item.tone, mode === item.key)}`}
              >
                <span>{item.label}</span>
                <span>›</span>
              </button>
            ))}
          </div>

          {mode !== "none" ? (
            <button
              type="button"
              onClick={() => setMode("none")}
              className="mt-4 w-full rounded-md border border-black/20 px-3 py-1.5 text-xs font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
            >
              Fermer l&apos;espace courant
            </button>
          ) : null}
        </aside>

        <div className="min-w-0">
          <section className="mb-4 rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-black/55 dark:text-white/55">Caisse active</p>
                <h3 className="text-sm font-semibold">{currentDesk?.label ?? "Aucune caisse"}</h3>
                <p className="mt-1 text-xs text-black/60 dark:text-white/60">
                  {mode === "none"
                    ? "Sélectionnez maintenant une action dans le menu latéral de gauche."
                    : `Vue ouverte : ${actionItems.find((item) => item.key === mode)?.label ?? "Action"}.`}
                </p>
              </div>
            </div>
          </section>

          <div>
            {mode === "tickets" ? ticketWorkspace : null}
            {mode === "cash" ? cashWorkspace : null}
            {mode === "virtual" ? virtualWorkspace : null}
            {mode === "billetage" ? billetageWorkspace : null}
            {mode === "payment-orders" ? paymentOrdersWorkspace : null}
            {mode === "needs" ? needsWorkspace : null}
            {mode === "none" ? (
              <p className="rounded-xl border border-dashed border-black/20 px-4 py-5 text-xs text-black/60 dark:border-white/20 dark:text-white/60">
                La caisse <span className="font-semibold">{currentDesk?.label ?? "sélectionnée"}</span> est prête. Utilisez le sous-menu de gauche pour ouvrir les opérations de paiement des billets, les autres opérations de caisse, les OP à exécuter, le billetage, le virtuel ou les EDB.
              </p>
            ) : null}
          </div>
        </div>
      </section>

      {mode === "none" && closedSummary ? (
        <section className="mb-6">{closedSummary}</section>
      ) : null}
    </>
  );
}
