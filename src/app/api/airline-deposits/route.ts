import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  buildAirlineDepositAccountSummaries,
  getAirlineDepositAccountByKey,
  recordAirlineDepositMovement,
} from "@/lib/airline-deposit";
import { airlineDepositTopUpSchema } from "@/lib/validators";
import { requireApiModuleAccess } from "@/lib/rbac";

export async function GET() {
  const access = await requireApiModuleAccess("payments", ["ACCOUNTANT"]);
  if (access.error) {
    return access.error;
  }

  const accounts = await buildAirlineDepositAccountSummaries(
    prisma as unknown as { airlineDepositMovement: { findMany: (args: unknown) => Promise<any[]> } },
  );
  return NextResponse.json({ data: accounts });
}

export async function POST(request: NextRequest) {
  const access = await requireApiModuleAccess("payments", ["ACCOUNTANT"]);
  if (access.error) {
    return access.error;
  }

  const body = await request.json();
  const parsed = airlineDepositTopUpSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const account = getAirlineDepositAccountByKey(parsed.data.accountKey);
  if (!account) {
    return NextResponse.json({ error: "Compte dépôt compagnie invalide." }, { status: 400 });
  }

  try {
    const movement = await prisma.$transaction((tx) => recordAirlineDepositMovement(tx, {
      accountKey: account.key,
      movementType: "CREDIT",
      amount: parsed.data.amount,
      reference: parsed.data.reference,
      description: parsed.data.description,
      createdById: access.session.user.id,
    }));

    return NextResponse.json({ data: movement }, { status: 201 });
  } catch (error) {
    console.error("POST /api/airline-deposits failed", error);

    if (error instanceof Error && error.message.startsWith("INVALID_AIRLINE_DEPOSIT_ACCOUNT:")) {
      return NextResponse.json({ error: "Compte dépôt compagnie invalide." }, { status: 400 });
    }

    return NextResponse.json(
      { error: "Erreur serveur lors du crédit du compte dépôt compagnie." },
      { status: 500 },
    );
  }
}
