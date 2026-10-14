import { AppShell } from "@/components/app-shell";
import { RecouvrementWorkspace, type RecouvrementGroupRow } from "@/components/recouvrement-workspace";
import { loadKinshasaWorkspaceUsers, matchKinshasaUsersForPayer } from "@/lib/kinshasa-team";
import { monthLabelFromKey, monthRangeFromValue } from "@/lib/month-range";
import { requirePageModuleAccess } from "@/lib/rbac";
import { fetchOpenReceivableRowsForSoldAtRange } from "@/lib/ticket-recovery-dispatch";
import { groupOpenReceivablesByPayer } from "@/lib/ticket-recovery";

type SearchParams = { month?: string };

export default async function RecouvrementPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { role } = await requirePageModuleAccess("recouvrement", ["ADMIN", "DIRECTEUR_GENERAL", "ACCOUNTANT"], "READ");
  const params = await searchParams;
  const range = monthRangeFromValue(params.month);
  const periodLabel = monthLabelFromKey(range.monthRaw);

  const [openRows, kinshasaUsers] = await Promise.all([
    fetchOpenReceivableRowsForSoldAtRange(range.start, range.end),
    loadKinshasaWorkspaceUsers(),
  ]);

  const balances = openRows.map((row) => row.balance);
  const payerGroups = groupOpenReceivablesByPayer(balances);

  const groups: RecouvrementGroupRow[] = payerGroups.map((group) => ({
    ...group,
    recipients: matchKinshasaUsersForPayer(group.payerLabel, kinshasaUsers).map((user) => ({
      id: user.id,
      name: user.name,
    })),
  }));

  const reportQuery = new URLSearchParams({
    mode: "month",
    month: range.monthRaw,
    desk: "THE_BEST",
  }).toString();

  return (
    <AppShell role={role}>
      <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
        <header>
          <h1 className="text-xl font-bold tracking-tight">Recouvrement billets</h1>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            Outil comptabilite / direction : relancer le payant mois par mois, sur la base des encaissements caisse.
          </p>
        </header>
        <RecouvrementWorkspace
          monthRaw={range.monthRaw}
          periodLabel={periodLabel}
          groups={groups}
          kinshasaUserCount={kinshasaUsers.length}
          reportQuery={reportQuery}
        />
      </div>
    </AppShell>
  );
}
