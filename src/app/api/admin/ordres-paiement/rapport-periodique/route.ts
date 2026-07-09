import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";

export const dynamic = "force-dynamic";

function parseIsoDate(value: string) {
  const parsed = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!parsed) return null;

  const year = Number.parseInt(parsed[1], 10);
  const month = Number.parseInt(parsed[2], 10);
  const day = Number.parseInt(parsed[3], 10);
  const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));

  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function endOfDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

export async function GET(request: NextRequest) {
  const access = await requireApiModuleAccess("admin", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "ACCOUNTANT"]);
  if (access.error) return access.error;

  const startRaw = request.nextUrl.searchParams.get("start")?.trim() ?? "";
  const endRaw = request.nextUrl.searchParams.get("end")?.trim() ?? "";

  if (!startRaw || !endRaw) {
    return NextResponse.json(
      { error: "Paramètres 'start' et 'end' requis (format AAAA-MM-JJ)." },
      { status: 400 },
    );
  }

  const start = parseIsoDate(startRaw);
  const end = parseIsoDate(endRaw);

  if (!start || !end) {
    return NextResponse.json(
      { error: "Dates invalides. Format attendu: AAAA-MM-JJ." },
      { status: 400 },
    );
  }

  if (end < start) {
    return NextResponse.json(
      { error: "La date de fin doit être après la date de début." },
      { status: 400 },
    );
  }

  const endWithTime = endOfDay(end);

  const [paymentOrders, needRequests] = await Promise.all([
    (prisma as unknown as { paymentOrder: any }).paymentOrder.findMany({
      where: {
        createdAt: { gte: start, lte: endWithTime },
      },
      include: {
        issuedBy: { select: { name: true } },
        approvedBy: { select: { name: true } },
        executedBy: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
      take: 1000,
    }),
    prisma.needRequest.findMany({
      where: {
        createdAt: { gte: start, lte: endWithTime },
      },
      include: {
        requester: { select: { name: true } },
        reviewedBy: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
      take: 1000,
    }),
  ]);

  const totalOpAmount = paymentOrders.reduce(
    (sum: number, order: { amount: number }) => sum + order.amount,
    0,
  );
  const totalEdbAmount = needRequests.reduce(
    (sum: number, need: { estimatedAmount: number | null }) => sum + (need.estimatedAmount ?? 0),
    0,
  );

  return NextResponse.json({
    paymentOrders,
    needRequests,
    totalOpCount: paymentOrders.length,
    totalEdbCount: needRequests.length,
    totalOpAmount,
    totalEdbAmount,
    range: { start: startRaw, end: endRaw },
  });
}
