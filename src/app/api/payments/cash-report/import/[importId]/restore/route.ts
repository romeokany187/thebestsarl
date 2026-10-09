import { NextRequest, NextResponse } from "next/server";
import { requireCashReportImportApiAccess } from "@/lib/cash-report-import-api-auth";
import { restoreCashReportImport } from "@/lib/cash-report-import-restore";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ importId: string }> };

export async function POST(_request: NextRequest, context: RouteContext) {
  const access = await requireCashReportImportApiAccess();
  if (access.error) return access.error;

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
