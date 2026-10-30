import { NextRequest, NextResponse } from "next/server";
import { listVirtualBalanceRowsFromSnapshot, loadMainDeskExcelVirtualSnapshot } from "@/lib/cash-excel-virtual";
import { requireApiModuleAccess } from "@/lib/rbac";
import { getUserModuleAccessMap } from "@/lib/user-module-access";
import { isDeskAllowedForUser, normalizeCashDeskValue } from "@/lib/payments-desk";

export const dynamic = "force-dynamic";

/** GET /api/payments/virtual-snapshot?date=YYYY-MM-DD&cashDesk=THE_BEST */
export async function GET(request: NextRequest) {
  const access = await requireApiModuleAccess("payments", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "ACCOUNTANT", "EMPLOYEE"]);
  if (access.error) return access.error;

  const { searchParams } = request.nextUrl;
  const date = searchParams.get("date")?.trim();
  const cashDesk = normalizeCashDeskValue(searchParams.get("cashDesk"));

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !cashDesk) {
    return NextResponse.json({ error: "date (YYYY-MM-DD) et cashDesk requis" }, { status: 400 });
  }

  const moduleAccessMap = await getUserModuleAccessMap(access.session.user.id);
  if (!isDeskAllowedForUser({
    desk: cashDesk,
    jobTitle: access.session.user.jobTitle,
    role: access.role,
    customModuleAccessLevel: access.customModuleAccess,
    customModuleAccessMap: moduleAccessMap,
  })) {
    return NextResponse.json({ error: "Accès refusé pour cette caisse." }, { status: 403 });
  }

  const reportMonth = date.slice(0, 7);
  const snapshot = await loadMainDeskExcelVirtualSnapshot(reportMonth, date, cashDesk);
  if (!snapshot) {
    return NextResponse.json({ data: null });
  }

  const rows = listVirtualBalanceRowsFromSnapshot(snapshot.channels);
  return NextResponse.json({
    data: {
      closingDate: snapshot.closingDate,
      requestedDate: date,
      rows,
      totalUsd: snapshot.totalUsd,
      totalCdf: snapshot.totalCdf,
      updatedAt: snapshot.updatedAt.toISOString(),
    },
  });
}
