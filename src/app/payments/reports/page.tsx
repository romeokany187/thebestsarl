import { AppShell } from "@/components/app-shell";
import { requirePageModuleAccess } from "@/lib/rbac";
import { resolvePaymentsDeskState } from "@/lib/payments-desk";

type SearchParams = {
  startDate?: string;
  endDate?: string;
  cashMonth?: string;
  airlineId?: string;
  desk?: string;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function currentMonthIso() {
  return new Date().toISOString().slice(0, 7);
}

export const dynamic = "force-dynamic";

export default async function PaymentReportsPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const { role, session } = await requirePageModuleAccess("payments", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  const deskState = resolvePaymentsDeskState({
    jobTitle: session.user.jobTitle,
    role,
    requestedDesk: typeof resolvedSearchParams.desk === "string" ? resolvedSearchParams.desk : null,
  });

  const startDate = resolvedSearchParams.startDate ?? todayIso();
  const endDate = resolvedSearchParams.endDate ?? startDate;
  const cashMonth = resolvedSearchParams.cashMonth ?? currentMonthIso();
  const selectedDesk = deskState.desk;

  const paymentsQuery = new URLSearchParams({
    startDate,
    endDate,
    desk: selectedDesk,
  }).toString();

  const cashJournalQuery = new URLSearchParams({
    reportType: "cash-journal",
    mode: "month",
    month: cashMonth,
    desk: selectedDesk,
  }).toString();

  const cashSummaryQuery = new URLSearchParams({
    reportType: "cash-summary",
    mode: "month",
    month: cashMonth,
    desk: selectedDesk,
  }).toString();

  return (
    <AppShell role={role}>
      <section className="space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Rapports paiements et caisse</h1>
          <p className="mt-2 text-sm text-black/65 dark:text-white/65">
            Espace dédié pour tirer les rapports PDF de la caisse active: {deskState.deskOptions.find((desk) => desk.value === selectedDesk)?.label ?? selectedDesk}.
          </p>
        </header>

        <section className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <form method="GET" className="grid gap-4 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Du</label>
              <input type="date" name="startDate" defaultValue={startDate} className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Au</label>
              <input type="date" name="endDate" defaultValue={endDate} className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Mois de caisse</label>
              <input type="month" name="cashMonth" defaultValue={cashMonth} className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Caisse active</label>
              <select name="desk" defaultValue={selectedDesk} className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900">
                {deskState.deskOptions.map((desk) => (
                  <option key={desk.value} value={desk.value}>{desk.label}</option>
                ))}
              </select>
            </div>
            <button type="submit" className="rounded-md bg-black px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black lg:col-span-4 lg:justify-self-start">
              Actualiser les liens
            </button>
          </form>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <a href={`/api/payments/report?${paymentsQuery}`} target="_blank" rel="noreferrer" className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm hover:bg-black/5 dark:border-white/10 dark:bg-zinc-900 dark:hover:bg-white/5">
            <h2 className="text-sm font-semibold">Lire PDF paiements billets</h2>
            <p className="mt-2 text-xs text-black/60 dark:text-white/60">Affiche les encaissements billets selon la période et la caisse active.</p>
          </a>
          <a href={`/api/payments/report?${paymentsQuery}&download=1`} className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm hover:bg-black/5 dark:border-white/10 dark:bg-zinc-900 dark:hover:bg-white/5">
            <h2 className="text-sm font-semibold">Télécharger PDF paiements billets</h2>
            <p className="mt-2 text-xs text-black/60 dark:text-white/60">Version téléchargeable du rapport des paiements billets.</p>
          </a>
          <a href={`/api/payments/report?${cashJournalQuery}`} target="_blank" rel="noreferrer" className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm hover:bg-black/5 dark:border-white/10 dark:bg-zinc-900 dark:hover:bg-white/5">
            <h2 className="text-sm font-semibold">Voir journal de caisse</h2>
            <p className="mt-2 text-xs text-black/60 dark:text-white/60">Journal mensuel de caisse filtré sur la caisse active.</p>
          </a>
          <a href={`/api/payments/report?${cashJournalQuery}&download=1`} className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm hover:bg-black/5 dark:border-white/10 dark:bg-zinc-900 dark:hover:bg-white/5">
            <h2 className="text-sm font-semibold">Télécharger journal de caisse</h2>
            <p className="mt-2 text-xs text-black/60 dark:text-white/60">Téléchargement direct du journal mensuel de caisse.</p>
          </a>
          <a href={`/api/payments/report?${cashSummaryQuery}`} target="_blank" rel="noreferrer" className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm hover:bg-black/5 dark:border-white/10 dark:bg-zinc-900 dark:hover:bg-white/5">
            <h2 className="text-sm font-semibold">Voir synthèse caisse</h2>
            <p className="mt-2 text-xs text-black/60 dark:text-white/60">Vue synthétique des soldes, flux et engagements de la caisse.</p>
          </a>
          <a href={`/api/payments/report?${cashSummaryQuery}&download=1`} className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm hover:bg-black/5 dark:border-white/10 dark:bg-zinc-900 dark:hover:bg-white/5">
            <h2 className="text-sm font-semibold">Télécharger synthèse caisse</h2>
            <p className="mt-2 text-xs text-black/60 dark:text-white/60">Téléchargement direct du récapitulatif mensuel.</p>
          </a>
        </section>
      </section>
    </AppShell>
  );
}
