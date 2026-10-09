import { NextRequest, NextResponse } from "next/server";
import { requireApiModuleAccess } from "@/lib/rbac";
import { canImportCashReportExcel } from "@/lib/cash-report-access";
import { restoreCashReportImport } from "@/lib/cash-report-import-restore";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ importId: string }> };

export async function POST(_request: NextRequest, context: RouteContext) {
  const access = await requireApiModuleAccess("payments", ["ADMIN", "ACCOUNTANT", "EMPLOYEE"]);
  if (access.error) return access.error;

  if (!canImportCashReportExcel({
    role: access.role,
    jobTitle: access.session.user.jobTitle,
    customModuleAccessLevel: access.customModuleAccess,
  })) {
    return NextResponse.json({ error: "Restauration réservée à la caissière Caisse 2, au comptable ou à l'administrateur." }, { status: 403 });
  }

  const { importId } = await context.params;
  if (!importId?.trim()) {
    return NextResponse.json({ error: "Import invalide." }, { status: 400 });
  }

  try {
    const result = await restoreCashReportImport(importId.trim(), access.session.user.id);
    return NextResponse.json({ data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Restauration impossible.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
