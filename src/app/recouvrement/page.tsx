import { AppShell } from "@/components/app-shell";
import { RecouvrementWorkspace, type RecouvrementGroupRow } from "@/components/recouvrement-workspace";
import { kinshasaDateKey } from "@/lib/kinshasa-time";
import { loadKinshasaWorkspaceUsers, resolveKinshasaRecoveryRecipients } from "@/lib/kinshasa-team";
import { monthLabelFromKey, monthRangeFromValue } from "@/lib/month-range";
import { requirePageModuleAccess } from "@/lib/rbac";
import { loadPayerRecoveryTargetUsers } from "@/lib/ticket-payer-recovery-targets";
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

  const [openRows, workspaceUsers, kinshasaUsers] = await Promise.all([
    fetchOpenReceivableRowsForSoldAtRange(range.start, range.end),
    loadPayerRecoveryTargetUsers(),
    loadKinshasaWorkspaceUsers(),
  ]);

  const balances = openRows.map((row) => row.balance);
  const payerGroups = groupOpenReceivablesByPayer(balances);

  const groups: RecouvrementGroupRow[] = payerGroups.map((group) => {
    const { recipients, matchedOutsideKinshasa } = resolveKinshasaRecoveryRecipients(
      group.payerLabel,
      kinshasaUsers,
      workspaceUsers,
    );

    let resolutionHint: string | null = null;
    if (recipients.length === 0 && matchedOutsideKinshasa.length > 0) {
      resolutionHint = `Compte trouvé (${matchedOutsideKinshasa.map((u) => u.email).join(", ")}) mais hors équipe Kinshasa — recouvrement réservé aux agents Kinshasa.`;
    } else if (recipients.length === 0) {
      resolutionHint =
        "Aucun agent Kinshasa : vérifiez que le nom après « Agent - » correspond exactement au profil utilisateur en base.";
    }

    return {
      ...group,
      recipients: recipients.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
      })),
      resolutionHint,
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
          kinshasaUserCount={kinshasaUsers.length}
          reportQuery={reportQuery}
        />
      </div>
    </AppShell>
  );
}
