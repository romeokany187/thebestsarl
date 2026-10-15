import { NextRequest, NextResponse } from "next/server";
import { loadKinshasaWorkspaceUsers, resolveKinshasaRecoveryRecipients } from "@/lib/kinshasa-team";
import { monthLabelFromKey, monthRangeFromValue } from "@/lib/month-range";
import { requireApiModuleAccess } from "@/lib/rbac";
import { loadPayerRecoveryTargetUsers } from "@/lib/ticket-payer-recovery-targets";
import {
  dispatchRecoveryToRecipients,
  fetchOpenReceivableRowsForSoldAtRange,
} from "@/lib/ticket-recovery-dispatch";
import { payerRecoveryKey } from "@/lib/ticket-recovery";

export async function POST(req: NextRequest) {
  const access = await requireApiModuleAccess("recouvrement", ["ADMIN", "DIRECTEUR_GENERAL", "ACCOUNTANT"], "WRITE");
  if (access.error) return access.error;

  let body: { month?: string; payerKey?: string };
  try {
    body = (await req.json()) as { month?: string; payerKey?: string };
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide." }, { status: 400 });
  }

  const payerKey = (body.payerKey ?? "").trim();
  if (!payerKey || payerKey === "__missing_payer__") {
    return NextResponse.json({ error: "Payant non renseigne ou invalide." }, { status: 400 });
  }

  const range = monthRangeFromValue(body.month);
  const periodLabel = monthLabelFromKey(range.monthRaw);

  const openRows = await fetchOpenReceivableRowsForSoldAtRange(range.start, range.end);
  const scopedRows = openRows.filter((row) => payerRecoveryKey(row.balance.payerName) === payerKey);

  if (scopedRows.length === 0) {
    return NextResponse.json({ error: "Aucune creance ouverte pour ce payant sur ce mois." }, { status: 404 });
  }

  const displayPayerLabel = scopedRows[0]?.balance.payerName?.trim() || payerKey;

  const [workspaceUsers, kinshasaUsers] = await Promise.all([
    loadPayerRecoveryTargetUsers(),
    loadKinshasaWorkspaceUsers(),
  ]);

  const { recipients, matchedOutsideKinshasa } = resolveKinshasaRecoveryRecipients(
    displayPayerLabel,
    kinshasaUsers,
    workspaceUsers,
  );

  if (recipients.length === 0) {
    if (matchedOutsideKinshasa.length > 0) {
      return NextResponse.json(
        {
          error: `Payant « ${displayPayerLabel} » correspond à ${matchedOutsideKinshasa.map((u) => u.email).join(", ")} mais ce compte n'est pas dans l'équipe Kinshasa.`,
        },
        { status: 422 },
      );
    }

    return NextResponse.json(
      {
        error: `Aucun agent Kinshasa ne correspond au payant « ${displayPayerLabel} ». Le nom après « Agent - » doit être identique au profil utilisateur (e-mail de connexion).`,
      },
      { status: 422 },
    );
  }

  const result = await dispatchRecoveryToRecipients({
    recipients: recipients.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
    })),
    rows: scopedRows,
    payerLabel: displayPayerLabel,
    periodLabel,
    monthKey: range.monthRaw,
    senderName: access.session?.user?.name ?? "Recouvrement",
  });

  return NextResponse.json(result);
}
