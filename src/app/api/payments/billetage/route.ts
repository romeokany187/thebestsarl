import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";
import { getUserModuleAccessMap } from "@/lib/user-module-access";
import { isDeskAllowedForUser, normalizeCashDeskValue } from "@/lib/payments-desk";

export const dynamic = "force-dynamic";

// GET /api/payments/billetage?date=YYYY-MM-DD&cashDesk=THE_BEST
export async function GET(request: NextRequest) {
  const access = await requireApiModuleAccess("payments", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "ACCOUNTANT", "EMPLOYEE"]);
  if (access.error) return access.error;

  const { searchParams } = request.nextUrl;
  const date = searchParams.get("date");
  const cashDesk = normalizeCashDeskValue(searchParams.get("cashDesk"));

  if (!date || !cashDesk) {
    return NextResponse.json({ error: "date et cashDesk requis" }, { status: 400 });
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

  const snapshot = await prisma.cashBilletageSnapshot.findUnique({
    where: { date_cashDesk: { date, cashDesk } },
    select: {
      id: true,
      date: true,
      cashDesk: true,
      usdCounts: true,
      cdfCounts: true,
      expectedUsd: true,
      expectedCdf: true,
      savedAt: true,
      savedBy: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({ data: snapshot ?? null });
}

// POST /api/payments/billetage
export async function POST(request: NextRequest) {
  const access = await requireApiModuleAccess("payments", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "ACCOUNTANT", "EMPLOYEE"]);
  if (access.error) return access.error;

  const body = await request.json() as {
    date?: string;
    cashDesk?: string;
    usdCounts?: Record<string, string>;
    cdfCounts?: Record<string, string>;
    expectedUsd?: number;
    expectedCdf?: number;
  };

  const { date, cashDesk, usdCounts, cdfCounts, expectedUsd, expectedCdf } = body;

  const normalizedCashDesk = normalizeCashDeskValue(cashDesk);

  if (!date || !normalizedCashDesk) {
    return NextResponse.json({ error: "date et cashDesk requis" }, { status: 400 });
  }

  const moduleAccessMap = await getUserModuleAccessMap(access.session.user.id);
  if (!isDeskAllowedForUser({
    desk: normalizedCashDesk,
    jobTitle: access.session.user.jobTitle,
    role: access.role,
    customModuleAccessLevel: access.customModuleAccess,
    customModuleAccessMap: moduleAccessMap,
  })) {
    return NextResponse.json({ error: "Accès refusé pour cette caisse." }, { status: 403 });
  }

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Format de date invalide (YYYY-MM-DD attendu)" }, { status: 400 });
  }

  const snapshot = await prisma.cashBilletageSnapshot.upsert({
    where: { date_cashDesk: { date, cashDesk: normalizedCashDesk } },
    create: {
      date,
      cashDesk: normalizedCashDesk,
      usdCounts: usdCounts ?? {},
      cdfCounts: cdfCounts ?? {},
      expectedUsd: expectedUsd ?? 0,
      expectedCdf: expectedCdf ?? 0,
      savedById: access.session.user.id,
    },
    update: {
      usdCounts: usdCounts ?? {},
      cdfCounts: cdfCounts ?? {},
      expectedUsd: expectedUsd ?? 0,
      expectedCdf: expectedCdf ?? 0,
      savedById: access.session.user.id,
      savedAt: new Date(),
    },
    select: {
      id: true,
      date: true,
      cashDesk: true,
      savedAt: true,
      savedBy: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({ data: snapshot });
}
