import { AppShell } from "@/components/app-shell";
import { RecouvrementWorkspace, type RecouvrementGroupRow } from "@/components/recouvrement-workspace";
import { kinshasaDateKey } from "@/lib/kinshasa-time";
import { monthLabelFromKey, monthRangeFromValue } from "@/lib/month-range";
import { requirePageModuleAccess } from "@/lib/rbac";
import { loadPayerRecoveryTargetUsers, matchPayerToWorkspaceUsers } from "@/lib/ticket-payer-recovery-targets";
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
  const monthParam = params.month?.trim();
  const monthKey = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : kinshasaDateKey().slice(0, 7);
  const range = monthRangeFromValue(monthKey);
  const periodLabel = monthLabelFromKey(range.monthRaw);

  const [openRows, workspaceUsers] = await Promise.all([
    fetchOpenReceivableRowsForSoldAtRange(range.start, range.end),
    loadPayerRecoveryTargetUsers(),
  ]);

  const balances = openRows.map((row) => row.balance);
  const payerGroups = groupOpenReceivablesByPayer(balances);

  const groups: RecouvrementGroupRow[] = payerGroups.map((group) => {
    const matched = matchPayerToWorkspaceUsers(group.payerLabel, workspaceUsers);
    return {
      ...group,
      recipients: matched.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
      })),
    };
  });

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
          workspaceUserCount={workspaceUsers.length}
          reportQuery={reportQuery}
        />
      </div>
    </AppShell>
  );
}
