import { NextRequest, NextResponse } from "next/server";
import { CommissionMode } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";

const commissionQuickSchema = z.object({
  airlineId: z.string().min(1),
  ratePercent: z.number().min(0).max(100),
});

export async function POST(request: NextRequest) {
  const access = await requireApiModuleAccess("admin", ["ADMIN"]);
  if (access.error) {
    return access.error;
  }

  const body = await request.json();
  const parsed = commissionQuickSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const airline = await prisma.airline.findUnique({
    where: { id: parsed.data.airlineId },
    select: { id: true, code: true, name: true },
  });

  if (!airline) {
    return NextResponse.json({ error: "Compagnie introuvable." }, { status: 404 });
  }

  const currentRule = await prisma.commissionRule.findFirst({
    where: {
      airlineId: airline.id,
      isActive: true,
    },
    orderBy: { startsAt: "desc" },
  });

  const nextMode = currentRule?.commissionMode ?? CommissionMode.IMMEDIATE;
  const nextMarkup = currentRule?.markupRatePercent ?? 0;
  const nextBaseFareRatio = currentRule?.defaultBaseFareRatio ?? 0.6;
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.commissionRule.updateMany({
      where: {
        airlineId: airline.id,
        isActive: true,
      },
      data: {
        isActive: false,
        endsAt: now,
      },
    });

    await tx.commissionRule.create({
      data: {
        airlineId: airline.id,
        ratePercent: parsed.data.ratePercent,
        routePattern: "*",
        travelClass: null,
        commissionMode: nextMode,
        systemRatePercent: parsed.data.ratePercent,
        markupRatePercent: nextMarkup,
        defaultBaseFareRatio: nextBaseFareRatio,
        depositStockTargetAmount: currentRule?.depositStockTargetAmount ?? undefined,
        batchCommissionAmount: currentRule?.batchCommissionAmount ?? undefined,
        startsAt: now,
        endsAt: null,
        isActive: true,
      },
    });
  });

  return NextResponse.json({
    data: {
      airlineId: airline.id,
      airlineCode: airline.code,
      airlineName: airline.name,
      ratePercent: parsed.data.ratePercent,
    },
  });
}
