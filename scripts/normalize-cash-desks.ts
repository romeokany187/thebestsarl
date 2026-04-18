import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KNOWN_PREFIXES = [
  "PROXY_BANKING:",
  "THE_BEST:",
  "CAISSE_2_SIEGE:",
  "CAISSE_SAFETY:",
  "CAISSE_VISAS:",
  "CAISSE_TSL:",
  "CAISSE_AGENCE:",
] as const;

function inferCashDesk(description?: string | null) {
  const normalized = (description ?? "").trim().toUpperCase();
  if (normalized.startsWith("PROXY_BANKING:")) return "PROXY_BANKING";
  if (normalized.startsWith("CAISSE_2_SIEGE:")) return "CAISSE_2_SIEGE";
  if (normalized.startsWith("THE_BEST:")) return "THE_BEST";
  if (normalized.startsWith("CAISSE_SAFETY:")) return "CAISSE_SAFETY";
  if (normalized.startsWith("CAISSE_VISAS:")) return "CAISSE_VISAS";
  if (normalized.startsWith("CAISSE_TSL:")) return "CAISSE_TSL";
  if (normalized.startsWith("CAISSE_AGENCE:")) return "CAISSE_AGENCE";
  return "THE_BEST";
}

async function main() {
  const apply = process.argv.includes("--apply");

  const rows = await prisma.cashOperation.findMany({
    select: {
      id: true,
      occurredAt: true,
      cashDesk: true,
      description: true,
      category: true,
      amount: true,
      currency: true,
    },
    orderBy: { occurredAt: "desc" },
    take: 20000,
  });

  const candidates = rows
    .map((row) => {
      const inferred = inferCashDesk(row.description);
      const hasKnownPrefix = KNOWN_PREFIXES.some((prefix) => (row.description ?? "").toUpperCase().startsWith(prefix));
      const shouldUpdate = row.cashDesk !== inferred && hasKnownPrefix;
      return {
        ...row,
        inferred,
        hasKnownPrefix,
        shouldUpdate,
      };
    })
    .filter((row) => row.shouldUpdate);

  console.log(`Analysed ${rows.length} cash operations.`);
  console.log(`Detected ${candidates.length} operations with desk mismatch and reliable prefix.`);

  if (candidates.length > 0) {
    console.log(JSON.stringify(candidates.slice(0, 100), null, 2));
  }

  if (!apply) {
    console.log("Dry-run only. Re-run with --apply to update the mismatched rows.");
    return;
  }

  for (const row of candidates) {
    await prisma.cashOperation.update({
      where: { id: row.id },
      data: { cashDesk: row.inferred },
    });
  }

  console.log(`Updated ${candidates.length} cash operations.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
