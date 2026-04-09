type SqlCapablePrismaClient = {
  $queryRawUnsafe: <T = unknown>(query: string) => Promise<T>;
  $executeRawUnsafe: (query: string) => Promise<unknown>;
};

let ensurePromise: Promise<void> | null = null;
let ensureCompleted = false;

function sanitizeIdentifier(value: string) {
  return value.replace(/[^a-zA-Z0-9_]+/g, "");
}

async function dropMySqlLegacyTicketNumberUniqueIndexes(client: SqlCapablePrismaClient) {
  const indexes = await client.$queryRawUnsafe<Array<{ Key_name?: string; Column_name?: string; Non_unique?: number }>>(
    "SHOW INDEX FROM `TicketSale` WHERE Column_name = 'ticketNumber'",
  );

  const uniqueIndexNames = Array.from(new Set(
    indexes
      .filter((row) => (row.Column_name ?? "") === "ticketNumber" && Number(row.Non_unique ?? 1) === 0)
      .map((row) => sanitizeIdentifier(row.Key_name ?? ""))
      .filter((name) => name && name !== "PRIMARY"),
  ));

  for (const indexName of uniqueIndexNames) {
    await client.$executeRawUnsafe(`ALTER TABLE \`TicketSale\` DROP INDEX \`${indexName}\``);
  }
}

async function dropPostgresLegacyTicketNumberUniqueIndexes(client: SqlCapablePrismaClient) {
  const indexes = await client.$queryRawUnsafe<Array<{ indexname?: string; indexdef?: string }>>(
    "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = ANY(current_schemas(false)) AND tablename = 'TicketSale'",
  );

  const uniqueIndexNames = Array.from(new Set(
    indexes
      .filter((row) => /unique/i.test(row.indexdef ?? "") && /ticketNumber/i.test(row.indexdef ?? ""))
      .map((row) => sanitizeIdentifier(row.indexname ?? ""))
      .filter(Boolean),
  ));

  for (const indexName of uniqueIndexNames) {
    await client.$executeRawUnsafe(`DROP INDEX IF EXISTS \"${indexName}\"`);
  }
}

export async function ensureTicketNumberDuplicatesAllowed(client: SqlCapablePrismaClient) {
  if (ensureCompleted) {
    return;
  }

  if (!ensurePromise) {
    ensurePromise = (async () => {
      const databaseUrl = (process.env.DATABASE_URL ?? "").toLowerCase();

      if (databaseUrl.startsWith("mysql://")) {
        await dropMySqlLegacyTicketNumberUniqueIndexes(client);
      } else if (databaseUrl.startsWith("postgresql://") || databaseUrl.startsWith("postgres://")) {
        await dropPostgresLegacyTicketNumberUniqueIndexes(client);
      }

      ensureCompleted = true;
    })().catch((error) => {
      console.error("ensureTicketNumberDuplicatesAllowed failed", error);
    }).finally(() => {
      ensurePromise = null;
    });
  }

  await ensurePromise;
}
