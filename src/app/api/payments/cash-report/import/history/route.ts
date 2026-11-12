import { NextRequest, NextResponse } from "next/server";
import { requireCashReportImportApiAccess } from "@/lib/cash-report-import-api-auth";
import { listCashReportImportsForRestore } from "@/lib/cash-report-import-restore";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await requireCashReportImportApiAccess();
  if (access.error) return access.error;

  const reportMonth = request.nextUrl.searchParams.get("reportMonth")?.trim() || undefined;
  // Limite haute : l'UI ne montre qu'1 restauration / mois, le reste est replié.
  const rows = await listCashReportImportsForRestore({ reportMonth, limit: reportMonth ? 80 : 40 });

  return NextResponse.json({
    data: rows.map(({ preImportSnapshot, _count, importedBy, ...row }) => ({
      id: row.id,
      reportMonth: row.reportMonth,
      fileName: row.fileName,
      closingDate: row.closingDate,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      restoredAt: row.restoredAt?.toISOString() ?? null,
      journalLineCount: _count.journalLines,
      cashOpSyncCount: row.cashOpSyncCount,
      importedByLabel: importedBy.name ?? importedBy.email ?? "Utilisateur",
      canRestore: row.status === "COMPLETED" && !row.restoredAt && preImportSnapshot != null,
    })),
  });
}
