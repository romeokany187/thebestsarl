#!/usr/bin/env node

const fs = require("fs");

const explicitSchema = (process.env.PRISMA_SCHEMA_FILE || "").trim();

const defaultSchema = "prisma/schema.prisma";
const mysqlSchema = "prisma/schema.mysql.prisma";

if (explicitSchema) {
  process.stdout.write(explicitSchema);
  process.exit(0);
}

const databaseUrl = (process.env.DATABASE_URL || "").trim().toLowerCase();

if (databaseUrl.startsWith("mysql://")) {
  process.stdout.write(mysqlSchema);
  process.exit(0);
}

if (fs.existsSync(defaultSchema)) {
  process.stdout.write(defaultSchema);
  process.exit(0);
}

if (fs.existsSync(mysqlSchema)) {
  process.stdout.write(mysqlSchema);
  process.exit(0);
}

process.stdout.write(defaultSchema);
