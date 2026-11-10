import { NextRequest, NextResponse } from "next/server";
import { loadKinshasaWorkspaceUsers, resolveKinshasaRecoveryRecipients } from "@/lib/kinshasa-team";
import { monthLabelFromKey, monthRangeFromValue } from "@/lib/month-range";
import { requireApiModuleAccess } from "@/lib/rbac";
import { loadPayerRecoveryTargetUsers } from "@/lib/ticket-payer-recovery-targets";
import {
  buildRecoveryPdf,
  fetchOpenReceivableRowsForSoldAtRange,
} from "@/lib/ticket-recovery-dispatch";
import { payerRecoveryKey } from "@/lib/ticket-recovery";

/** GET /api/recouvrement/pdf?month=YYYY-MM&payerKey=… — même PDF que la pièce jointe mail. */
export async function GET(request: NextRequest) {
  const access = await requireApiModuleAccess("recouvrement", ["ADMIN", "DIRECTEUR_GENERAL", "ACCOUNTANT"], "READ");
  if (access.error) return access.error;

  const { searchParams } = request.nextUrl;
  const payerKey = (searchParams.get("payerKey") ?? "").trim();
  if (!payerKey || payerKey === "__missing_payer__") {
    return NextResponse.json({ error: "Payant non renseigné ou invalide." }, { status: 400 });
  }

  const range = monthRangeFromValue(searchParams.get("month") ?? undefined);
  const periodLabel = monthLabelFromKey(range.monthRaw);

  const openRows = await fetchOpenReceivableRowsForSoldAtRange(range.start, range.end);
  const scopedRows = openRows.filter((row) => payerRecoveryKey(row.balance.payerName) === payerKey);

  if (scopedRows.length === 0) {
    return NextResponse.json({ error: "Aucune créance ouverte pour ce payant sur ce mois." }, { status: 404 });
  }

  const displayPayerLabel = scopedRows[0]?.balance.payerName?.trim() || payerKey;

  const [workspaceUsers, kinshasaUsers] = await Promise.all([
    loadPayerRecoveryTargetUsers(),
    loadKinshasaWorkspaceUsers(),
  ]);

  const { recipients } = resolveKinshasaRecoveryRecipients(
    displayPayerLabel,
    kinshasaUsers,
    workspaceUsers,
  );

  const recipientName = recipients[0]?.name?.trim() || displayPayerLabel;
  const pdfBuffer = await buildRecoveryPdf({
    recipientName,
    payerLabel: displayPayerLabel,
    periodLabel,
    generatedBy: access.session?.user?.name ?? "Recouvrement",
    rows: scopedRows,
  });

  const safeLabel = displayPayerLabel.replace(/[^\w\-]+/g, "-").replace(/-+/g, "-").slice(0, 40);
  const filename = `recouvrement-${range.monthRaw}-${safeLabel || "payant"}.pdf`;
  const forceDownload = searchParams.get("download") === "1";

  return new NextResponse(pdfBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${forceDownload ? "attachment" : "inline"}; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
