import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { requireApiRoles } from "@/lib/rbac";
import { CommissionMode, TravelClass } from "@prisma/client";
import { ensureAirlineCatalog } from "@/lib/airline-catalog";

export const dynamic = "force-dynamic";

const airlineSchema = z.object({
  code: z.string().min(2).max(4).toUpperCase(),
  name: z.string().min(2),
  ratePercent: z.number().min(0).max(100).default(0),
  routePattern: z.string().min(1).default("*"),
  travelClass: z.nativeEnum(TravelClass).optional(),
  commissionMode: z.nativeEnum(CommissionMode).default("IMMEDIATE"),
  systemRatePercent: z.number().min(0).max(100).default(0),
  markupRatePercent: z.number().min(0).max(100).default(0),
  depositStockTargetAmount: z.number().positive().optional(),
  batchCommissionAmount: z.number().positive().optional(),
});

export async function GET() {
  const access = await requireApiRoles(["ADMIN", "MANAGER", "ACCOUNTANT", "EMPLOYEE"]);
  if (access.error) {
    return access.error;
  }

  await ensureAirlineCatalog(prisma);

  const airlines = await prisma.airline.findMany({
    include: { commissionRules: { where: { isActive: true } } },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ data: airlines });
}

export async function POST(request: NextRequest) {
  const access = await requireApiRoles(["ADMIN"]);
  if (access.error) {
    return access.error;
  }

  const body = await request.json();
  const parsed = airlineSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const airline = await prisma.airline.create({
    data: {
      code: parsed.data.code,
      name: parsed.data.name,
      commissionRules: {
        create: {
          ratePercent: parsed.data.ratePercent,
          routePattern: parsed.data.routePattern,
          travelClass: parsed.data.travelClass,
          commissionMode: parsed.data.commissionMode,
          systemRatePercent: parsed.data.systemRatePercent,
          markupRatePercent: parsed.data.markupRatePercent,
          depositStockTargetAmount: parsed.data.depositStockTargetAmount,
          batchCommissionAmount: parsed.data.batchCommissionAmount,
          startsAt: new Date(),
          isActive: true,
        },
      },
    },
    include: { commissionRules: true },
  });

  return NextResponse.json({ data: airline }, { status: 201 });
}
