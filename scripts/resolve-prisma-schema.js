#!/usr/bin/env node

const explicitSchema = (process.env.PRISMA_SCHEMA_FILE || "").trim();

if (explicitSchema) {
  process.stdout.write(explicitSchema);
  process.exit(0);
}

const databaseUrl = (process.env.DATABASE_URL || "").trim().toLowerCase();

if (databaseUrl.startsWith("mysql://")) {
  process.stdout.write("prisma/schema.mysql.prisma");
  process.exit(0);
}

process.stdout.write("prisma/schema.prisma");
