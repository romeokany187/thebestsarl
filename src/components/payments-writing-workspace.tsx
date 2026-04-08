"use client";

import { useEffect, useMemo, useState } from "react";

type WritingMode = "none" | "tickets" | "cash" | "virtual" | "billetage" | "payment-orders" | "needs";
type CashDeskValue = "PROXY_BANKING" | "THE_BEST" | "CAISSE_SAFETY" | "CAISSE_VISAS" | "CAISSE_TSL" | "CAISSE_AGENCE";
type CashDeskOption = { value: CashDeskValue; label: string; description: string };
type AdminCashRoleScope = "CAISSIER" | "CAISSE_2_SIEGE" | "CAISSE_AGENCE";
type DeskWorkspaceOverride = Partial<Record<Exclude<WritingMode, "none"> | "summary", React.ReactNode>>;

type AppRoleLike = "ADMIN" | "DIRECTEUR_GENERAL" | "MANAGER" | "EMPLOYEE" | "ACCOUNTANT";

const ALL_CASH_DESKS: CashDeskOption[] = [
  {
    value: "PROXY_BANKING",
    label: "Proxy Banking",
    description: "Airtel Money, Orange Money, M-Pesa, Equity et Illicocash : dépôts, retraits, virtuel et billetage.",
  },
  {
    value: "THE_BEST",
    label: "THE BEST",
    description: "Caisse principale THE BEST : paiements billets + autres opérations de caisse.",
  },
  {
    value: "CAISSE_SAFETY",
    label: "Caisse Safety",
    description: "Compte Safety : opérations de caisse, billetage, virtuel, OP et EDB.",
  },
  {
    value: "CAISSE_VISAS",
    label: "Caisse Visas",
    description: "Compte Visas : opérations de caisse, billetage, virtuel, OP et EDB.",
  },
  {
    value: "CAISSE_TSL",
    label: "Caisse TSL",
    description: "Compte TSL : opérations de caisse, billetage, virtuel, OP et EDB.",
  },
  {
    value: "CAISSE_AGENCE",
    label: "Caisse agence",
    description: "Caisse locale de l'agence : opérations de caisse, billetage, virtuel, OP et EDB.",
  },
];

const ADMIN_CASH_ROLE_OPTIONS: Array<{ value: AdminCashRoleScope; label: string; description: string }> = [
  {
    value: "CAISSIER",
    label: "Caisse 1 Siège",
    description: "Vue admin du proxy banking, du billetage et des OP/EDB de la caisse 1 siège.",
  },
  {
    value: "CAISSE_2_SIEGE",
    label: "Caisse 2 Siège",
    description: "Vue admin du caissier 2 siège et des comptes qu'il gère.",
  },
  {
    value: "CAISSE_AGENCE",
    label: "Caisse agence",
    description: "Vue admin de la caisse agence et de ses opérations.",
  },
];

function getManagedCashDesksForScope(scope?: string | null) {
  const normalizedScope = (scope ?? "").trim().toUpperCase();

  if (normalizedScope === "CAISSIER") {
    return ALL_CASH_DESKS.filter((desk) => desk.value === "PROXY_BANKING");
  }

  if (normalizedScope === "CAISSE_2_SIEGE") {
    return ALL_CASH_DESKS.filter((desk) => [
      "THE_BEST",
      "CAISSE_SAFETY",
      "CAISSE_VISAS",
      "CAISSE_TSL",
    ].includes(desk.value));
  }

  if (normalizedScope === "CAISSE_AGENCE") {
    return ALL_CASH_DESKS.filter((desk) => desk.value === "CAISSE_AGENCE");
  }

  return ALL_CASH_DESKS.filter((desk) => desk.value === "PROXY_BANKING");
}

function getManagedCashDesks(
  jobTitle?: string | null,
  role?: AppRoleLike | string | null,
  adminScope?: AdminCashRoleScope | null,
) {
  const normalizedJobTitle = (jobTitle ?? "").trim().toUpperCase();
  const normalizedRole = (role ?? "").trim().toUpperCase();

  if (normalizedRole === "ADMIN") {
    return getManagedCashDesksForScope(adminScope ?? "CAISSIER");
  }

  if (
    normalizedRole === "DIRECTEUR_GENERAL"
    || normalizedRole === "ACCOUNTANT"
    || normalizedJobTitle === "COMPTABLE"
  ) {
    return ALL_CASH_DESKS;
  }

  return getManagedCashDesksForScope(normalizedJobTitle);
}

function getAllowedActionsForDesk(deskValue: CashDeskValue | string): Array<Exclude<WritingMode, "none">> {
  if (deskValue === "THE_BEST") {
    return ["tickets", "cash", "payment-orders", "billetage", "virtual", "needs"];
  }

  if (deskValue === "PROXY_BANKING") {
    return ["cash", "virtual", "billetage", "payment-orders", "needs"];
  }

  if (deskValue === "CAISSE_AGENCE") {
    return [];
  }

  return ["cash", "payment-orders", "billetage", "virtual", "needs"];
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
  workspaceOverrides,
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
  workspaceOverrides?: Partial<Record<CashDeskValue, DeskWorkspaceOverride>>;
  jobTitle?: string | null;
  role?: AppRoleLike | string | null;
}) {
  const [mode, setMode] = useState<WritingMode>("none");
  const isAdminUser = (role ?? "").trim().toUpperCase() === "ADMIN";
  const [adminScope, setAdminScope] = useState<AdminCashRoleScope>("CAISSIER");
  const deskOptions = useMemo(() => getManagedCashDesks(jobTitle, role, adminScope), [jobTitle, role, adminScope]);
  const [selectedDesk, setSelectedDesk] = useState<CashDeskValue | "">(deskOptions[0]?.value ?? "");

  useEffect(() => {
    if (!deskOptions.some((desk) => desk.value === selectedDesk)) {
      setSelectedDesk(deskOptions[0]?.value ?? "");
    }
  }, [deskOptions, selectedDesk]);

  const currentDesk = deskOptions.find((desk) => desk.value === selectedDesk) ?? deskOptions[0] ?? null;
  const deskOverride = selectedDesk ? workspaceOverrides?.[selectedDesk] : undefined;
  const resolvedTicketWorkspace = deskOverride?.tickets ?? ticketWorkspace;
  const resolvedCashWorkspace = deskOverride?.cash ?? cashWorkspace;
  const resolvedVirtualWorkspace = deskOverride?.virtual ?? virtualWorkspace;
  const resolvedBilletageWorkspace = deskOverride?.billetage ?? billetageWorkspace;
  const resolvedPaymentOrdersWorkspace = deskOverride?.["payment-orders"] ?? paymentOrdersWorkspace;
  const resolvedNeedsWorkspace = deskOverride?.needs ?? needsWorkspace;
  const resolvedClosedSummary = deskOverride?.summary ?? closedSummary;

  const actionItems = [
    resolvedTicketWorkspace ? { key: "tickets" as const, label: "Paiement des billets (THE BEST)", tone: "emerald" } : null,
    resolvedCashWorkspace
      ? {
          key: "cash" as const,
          label: selectedDesk === "PROXY_BANKING" ? "Dépôts / retraits proxy banking" : "Autres opérations de caisse",
          tone: "blue",
        }
      : null,
    resolvedPaymentOrdersWorkspace ? { key: "payment-orders" as const, label: paymentOrdersLabel ?? "OP à exécuter", tone: "amber" } : null,
    resolvedBilletageWorkspace ? { key: "billetage" as const, label: "Billetage", tone: "sky" } : null,
    resolvedVirtualWorkspace ? { key: "virtual" as const, label: "Virtuel", tone: "cyan" } : null,
    resolvedNeedsWorkspace ? { key: "needs" as const, label: needsLabel ?? "EDB à exécuter", tone: "violet" } : null,
  ].filter(Boolean) as Array<{ key: Exclude<WritingMode, "none">; label: string; tone: string }>;
  const allowedActionKeys = getAllowedActionsForDesk(selectedDesk);
  const visibleActionItems = actionItems.filter((item) => allowedActionKeys.includes(item.key));

  useEffect(() => {
    if (mode !== "none" && !visibleActionItems.some((item) => item.key === mode)) {
      setMode("none");
    }
  }, [mode, visibleActionItems]);

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
      <section className="mb-6 grid items-start gap-4 xl:grid-cols-[300px_minmax(0,1fr)] 2xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm xl:sticky xl:top-24 xl:max-h-[calc(100vh-7rem)] xl:overflow-y-auto dark:border-white/10 dark:bg-zinc-900">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-black/50 dark:text-white/50">Caisses</p>
          <h2 className="mt-1 text-sm font-semibold">Sous-menu Paiements</h2>

          {isAdminUser ? (
            <div className="mt-4">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Caisse générale</label>
              <select
                value={adminScope}
                onChange={(event) => {
                  setAdminScope(event.target.value as AdminCashRoleScope);
                  setMode("none");
                }}
                className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
              >
                {ADMIN_CASH_ROLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="mt-4">
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Caisses gérées</label>
            <select
              value={selectedDesk}
              onChange={(event) => {
                setSelectedDesk(event.target.value as CashDeskValue);
                setMode("none");
              }}
              className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            >
              {deskOptions.map((desk) => (
                <option key={desk.value} value={desk.value}>{desk.label}</option>
              ))}
            </select>
          </div>

          <div className="mt-4 space-y-2">
            {visibleActionItems.map((item) => (
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
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-black/55 dark:text-white/55">Caisse active</p>
                <h3 className="text-sm font-semibold">{currentDesk?.label ?? "Aucune caisse"}</h3>
              </div>
              {mode !== "none" ? (
                <span className="rounded-full border border-black/15 px-3 py-1 text-[11px] font-semibold dark:border-white/15">
                  {visibleActionItems.find((item) => item.key === mode)?.label ?? "Action"}
                </span>
              ) : null}
            </div>
          </section>

          <div className="space-y-4">
            {mode === "none" ? resolvedClosedSummary : null}
            {mode === "tickets" ? resolvedTicketWorkspace : null}
            {mode === "cash" ? resolvedCashWorkspace : null}
            {mode === "virtual" ? resolvedVirtualWorkspace : null}
            {mode === "billetage" ? resolvedBilletageWorkspace : null}
            {mode === "payment-orders" ? resolvedPaymentOrdersWorkspace : null}
            {mode === "needs" ? resolvedNeedsWorkspace : null}
          </div>
        </div>
      </section>

    </>
  );
}
