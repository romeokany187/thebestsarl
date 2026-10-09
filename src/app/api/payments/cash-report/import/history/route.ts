import { NextRequest, NextResponse } from "next/server";
import { requireApiModuleAccess } from "@/lib/rbac";
import { canImportCashReportExcel } from "@/lib/cash-report-access";
import { listCashReportImportsForRestore } from "@/lib/cash-report-import-restore";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await requireApiModuleAccess("payments", ["ADMIN", "ACCOUNTANT", "EMPLOYEE"]);
  if (access.error) return access.error;

  if (!canImportCashReportExcel({
    role: access.role,
    jobTitle: access.session.user.jobTitle,
    customModuleAccessLevel: access.customModuleAccess,
  })) {
    return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
  }

  const reportMonth = request.nextUrl.searchParams.get("reportMonth")?.trim() || undefined;
  const rows = await listCashReportImportsForRestore({ reportMonth, limit: 20 });

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
