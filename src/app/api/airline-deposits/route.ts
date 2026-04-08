import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  buildAirlineDepositAccountSummaries,
  getAirlineDepositAccountByKey,
  recordAirlineDepositMovement,
} from "@/lib/airline-deposit";
import { airlineDepositTopUpSchema } from "@/lib/validators";
import { requireApiModuleAccess } from "@/lib/rbac";
import { writeActivityLog } from "@/lib/activity-log";

export async function GET(request: NextRequest) {
  const access = await requireApiModuleAccess("payments", ["ADMIN", "DIRECTEUR_GENERAL", "ACCOUNTANT", "EMPLOYEE"]);
  if (access.error) {
    return access.error;
  }

  const asOfDateRaw = request.nextUrl.searchParams.get("asOfDate")?.trim() ?? "";
  const asOfDate = /^\d{4}-\d{2}-\d{2}$/.test(asOfDateRaw)
    ? new Date(`${asOfDateRaw}T23:59:59.999Z`)
    : undefined;

  const accounts = await buildAirlineDepositAccountSummaries(
    prisma as unknown as { airlineDepositMovement: { findMany: (args: unknown) => Promise<any[]> } },
    6,
    asOfDate ? { upTo: asOfDate } : undefined,
  );
  return NextResponse.json({ data: accounts, asOfDate: asOfDateRaw || null });
}

export async function POST(request: NextRequest) {
  const access = await requireApiModuleAccess("payments", ["ADMIN", "DIRECTEUR_GENERAL", "ACCOUNTANT", "MANAGER", "EMPLOYEE"]);
  if (access.error) {
    return access.error;
  }

  const canCreditDeposit = access.role === "ADMIN"
    || access.role === "DIRECTEUR_GENERAL"
    || access.role === "ACCOUNTANT"
    || access.session.user.jobTitle === "COMPTABLE";

  if (!canCreditDeposit) {
    return NextResponse.json(
      { error: "Le crédit des dépôts compagnies est réservé à l'administrateur, au DG ou au comptable." },
      { status: 403 },
    );
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

    await writeActivityLog({
      actorId: access.session.user.id,
      action: "AIRLINE_DEPOSIT_CREDITED",
      entityType: "AIRLINE_DEPOSIT",
      entityId: account.key,
      summary: `${account.label} crédité de ${parsed.data.amount.toFixed(2)} USD (${parsed.data.reference}).`,
      payload: {
        accountKey: account.key,
        accountLabel: account.label,
        amount: parsed.data.amount,
        reference: parsed.data.reference,
        description: parsed.data.description,
      },
    });

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
