import { PrismaClient } from "@prisma/client";
import { parseNeedQuote, serializeNeedQuote } from "@/lib/need-lines";

const prisma = new PrismaClient();

type ParsedArgs = {
  apply: boolean;
  limit?: number;
  code?: string;
};

function readFlagValue(args: string[], flag: string) {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const limitRaw = readFlagValue(args, "--limit");
  const code = readFlagValue(args, "--code");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;

  if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
    throw new Error("Paramètre --limit invalide.");
  }

  return { apply, limit, code };
}

async function main() {
  const args = parseArgs();

  const rows = await prisma.needRequest.findMany({
    where: {
      ...(args.code ? { code: args.code } : {}),
    },
    select: {
      id: true,
      code: true,
      title: true,
      details: true,
      quantity: true,
      estimatedAmount: true,
      currency: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
    ...(args.limit ? { take: args.limit } : {}),
  });

  console.log(`Analysed ${rows.length} need request(s).`);

  let parseFailed = 0;
  let updated = 0;
  let unchanged = 0;
  const suspicious: Array<Record<string, unknown>> = [];
  const candidates: Array<{ id: string; code: string | null; normalizedDetails: string; itemCount: number }> = [];

  for (const row of rows) {
    const quote = parseNeedQuote(row.details);

    if (!quote || quote.items.length === 0) {
      parseFailed += 1;
      const detailsRaw = (row.details ?? "").trim();
      suspicious.push({
        code: row.code,
        id: row.id,
        reason: "parse_failed",
        detailsLength: detailsRaw.length,
        likelyTruncated: detailsRaw.length === 191,
        estimatedAmount: row.estimatedAmount,
        quantity: row.quantity,
      });
      continue;
    }

    const normalizedDetails = serializeNeedQuote(quote);
    const currentDetails = (row.details ?? "").trim();
    const normalizedTrimmed = normalizedDetails.trim();

    const recomputedTotal = quote.items.reduce((sum, item) => sum + item.lineTotal, 0);
    const amountDelta = Math.abs((row.estimatedAmount ?? recomputedTotal) - recomputedTotal);

    if (quote.items.length === 1 && amountDelta > 0.01) {
      suspicious.push({
        code: row.code,
        id: row.id,
        reason: "single_item_amount_mismatch",
        estimatedAmount: row.estimatedAmount,
        parsedTotal: recomputedTotal,
        itemCount: quote.items.length,
      });
    }

    if (currentDetails === normalizedTrimmed) {
      unchanged += 1;
      continue;
    }

    candidates.push({
      id: row.id,
      code: row.code,
      normalizedDetails,
      itemCount: quote.items.length,
    });
  }

  console.log(`Unchanged: ${unchanged}`);
  console.log(`Normalizable rows: ${candidates.length}`);
  console.log(`Parse failures: ${parseFailed}`);

  if (suspicious.length > 0) {
    console.log("Suspicious rows requiring review:");
    console.log(JSON.stringify(suspicious.slice(0, 100), null, 2));
  }

  if (!args.apply) {
    console.log("Dry-run only. Re-run with --apply to rewrite the normalizable rows.");
    return;
  }

  for (const candidate of candidates) {
    await prisma.needRequest.update({
      where: { id: candidate.id },
      data: { details: candidate.normalizedDetails },
    });
    updated += 1;
  }

  console.log(`Updated ${updated} need request(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
