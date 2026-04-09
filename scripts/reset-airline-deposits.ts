import { prisma } from "../src/lib/prisma";
import {
  AIRLINE_DEPOSIT_ACCOUNT_CONFIGS,
  AIRLINE_DEPOSIT_RESET_MARKER_DESCRIPTION,
  AIRLINE_DEPOSIT_RESET_MARKER_REFERENCE,
  AIRLINE_TICKET_DEPOSIT_START_DATE,
} from "../src/lib/airline-deposit";

async function main() {
  const forceReset = process.argv.includes("--force");
  const marker = await prisma.airlineDepositMovement.findFirst({
    where: { reference: AIRLINE_DEPOSIT_RESET_MARKER_REFERENCE },
    select: { id: true },
  });

  if (marker && !forceReset) {
    console.log("[reset-airline-deposits] Reset already applied. Skipping.");
    return;
  }

  const existingCount = await prisma.airlineDepositMovement.count();
  await prisma.airlineDepositMovement.deleteMany({});

  const anchorAccount = AIRLINE_DEPOSIT_ACCOUNT_CONFIGS[0];
  await prisma.airlineDepositMovement.create({
    data: {
      accountKey: anchorAccount.key,
      accountLabel: anchorAccount.label,
      movementType: "CREDIT",
      amount: 0,
      balanceAfter: 0,
      reference: AIRLINE_DEPOSIT_RESET_MARKER_REFERENCE,
      description: AIRLINE_DEPOSIT_RESET_MARKER_DESCRIPTION,
      createdAt: new Date(),
    },
  });

  console.log(`[reset-airline-deposits] Reset completed. Removed ${existingCount} movement(s).${forceReset ? " (forced)" : ""}`);
}

main()
  .catch((error) => {
    console.error("[reset-airline-deposits] Failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
