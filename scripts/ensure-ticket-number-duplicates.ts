import { prisma } from "../src/lib/prisma";
import { ensureTicketNumberDuplicatesAllowed } from "../src/lib/ticket-number-duplicates";

async function main() {
  await ensureTicketNumberDuplicatesAllowed(prisma as unknown as {
    $queryRawUnsafe: <T = unknown>(query: string) => Promise<T>;
    $executeRawUnsafe: (query: string) => Promise<unknown>;
  });

  console.log("[ensure-ticket-number-duplicates] Legacy unique PNR indexes removed or already absent.");
}

main()
  .catch((error) => {
    console.error("[ensure-ticket-number-duplicates] Failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
