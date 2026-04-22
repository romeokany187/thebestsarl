import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { PrismaClient } from "@prisma/client";

type AccountRow = {
  code: string;
  label: string;
  parentCode: string | null;
  level: number | null;
  normalBalance: "DEBIT" | "CREDIT";
};

const prisma = new PrismaClient();

function getArg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  if (i < 0) return null;
  return process.argv[i + 1] ?? null;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function usageAndExit(message?: string): never {
  if (message) console.error(message);
  console.error(
    [
      "Usage:",
      "  tsx scripts/restore-account-plan-from-sql-backup.ts --backup /path/to/backup.sql.gz --dry-run",
      "  tsx scripts/restore-account-plan-from-sql-backup.ts --backup /path/to/backup.sql --apply",
      "",
      "Flags:",
      "  --backup <path>   Required. SQL backup file (.sql or .sql.gz)",
      "  --dry-run         Parse and validate only (default mode)",
      "  --apply           Apply to current DB (replaces only table Account)",
    ].join("\n"),
  );
  process.exit(1);
}

function loadSqlFile(backupPath: string): string {
  if (!fs.existsSync(backupPath)) {
    usageAndExit(`Backup file not found: ${backupPath}`);
  }
  const raw = fs.readFileSync(backupPath);
  if (backupPath.endsWith(".gz")) {
    return zlib.gunzipSync(raw).toString("utf-8");
  }
  return raw.toString("utf-8");
}

function splitTopLevelTuples(valuesSection: string): string[] {
  const tuples: string[] = [];
  let inString = false;
  let escaped = false;
  let depth = 0;
  let start = -1;

  for (let i = 0; i < valuesSection.length; i++) {
    const ch = valuesSection[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "'") {
        inString = false;
      }
      continue;
    }

    if (ch === "'") {
      inString = true;
      continue;
    }

    if (ch === "(") {
      if (depth === 0) start = i;
      depth++;
      continue;
    }

    if (ch === ")") {
      depth--;
      if (depth === 0 && start >= 0) {
        tuples.push(valuesSection.slice(start, i + 1));
      }
      continue;
    }
  }

  return tuples;
}

function splitTupleValues(tuple: string): string[] {
  const src = tuple.trim();
  if (!src.startsWith("(") || !src.endsWith(")")) {
    throw new Error(`Invalid tuple format: ${src.slice(0, 80)}`);
  }

  const inner = src.slice(1, -1);
  const values: string[] = [];
  let inString = false;
  let escaped = false;
  let tokenStart = 0;

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "'") {
        inString = false;
      }
      continue;
    }

    if (ch === "'") {
      inString = true;
      continue;
    }

    if (ch === ",") {
      values.push(inner.slice(tokenStart, i).trim());
      tokenStart = i + 1;
    }
  }

  values.push(inner.slice(tokenStart).trim());
  return values;
}

function decodeSqlScalar(raw: string): string | number | null {
  const upper = raw.toUpperCase();
  if (upper === "NULL") return null;
  if (raw.startsWith("'") && raw.endsWith("'")) {
    const body = raw.slice(1, -1);
    return body
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, "\\")
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t");
  }
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

function parseInsertStatements(sql: string): AccountRow[] {
  const re = /INSERT\s+INTO\s+`?Account`?\s*(?:\(([^)]*)\))?\s*VALUES\s*([\s\S]*?);/gi;
  const rows: AccountRow[] = [];

  let match: RegExpExecArray | null = re.exec(sql);
  while (match) {
    const columnListRaw = match[1] ?? "";
    const valuesSection = match[2] ?? "";
    const columns = columnListRaw
      ? columnListRaw.split(",").map((c) => c.replace(/`/g, "").trim())
      : ["id", "code", "label", "parentCode", "level", "normalBalance", "createdAt", "updatedAt"];

    const tuples = splitTopLevelTuples(valuesSection);
    for (const tuple of tuples) {
      const tokens = splitTupleValues(tuple);
      if (tokens.length !== columns.length) {
        throw new Error(`Column/value mismatch in tuple. columns=${columns.length}, values=${tokens.length}`);
      }

      const map = new Map<string, string | number | null>();
      for (let i = 0; i < columns.length; i++) {
        map.set(columns[i], decodeSqlScalar(tokens[i]));
      }

      const code = String(map.get("code") ?? "").trim();
      const label = String(map.get("label") ?? "").trim();
      if (!code || !label) continue;

      const parentRaw = map.get("parentCode");
      const parentCode = parentRaw == null ? null : String(parentRaw).trim() || null;
      const levelRaw = map.get("level");
      const level = levelRaw == null || Number.isNaN(Number(levelRaw)) ? null : Number(levelRaw);
      const balanceRaw = String(map.get("normalBalance") ?? "DEBIT").toUpperCase();
      const normalBalance: "DEBIT" | "CREDIT" = balanceRaw === "CREDIT" ? "CREDIT" : "DEBIT";

      rows.push({ code, label, parentCode, level, normalBalance });
    }

    match = re.exec(sql);
  }

  return rows;
}

function validateRows(rows: AccountRow[]) {
  if (!rows.length) {
    throw new Error("No Account INSERT statements found in backup file.");
  }
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const row of rows) {
    if (seen.has(row.code)) dupes.push(row.code);
    seen.add(row.code);
  }
  if (dupes.length) {
    throw new Error(`Backup contains duplicate account codes: ${dupes.slice(0, 20).join(", ")}`);
  }
}

async function main() {
  const backupPath = getArg("--backup");
  const apply = hasFlag("--apply");
  const dryRun = hasFlag("--dry-run") || !apply;

  if (!backupPath) usageAndExit("Missing required --backup argument.");

  const sql = loadSqlFile(path.resolve(backupPath));
  const rows = parseInsertStatements(sql);
  validateRows(rows);

  console.log(`Parsed ${rows.length} account rows from backup.`);
  console.log(`Sample codes: ${rows.slice(0, 8).map((r) => r.code).join(", ")}`);

  if (dryRun) {
    console.log("Dry-run only. No database change applied.");
    return;
  }

  const importsDir = path.join(process.cwd(), "imports");
  if (!fs.existsSync(importsDir)) fs.mkdirSync(importsDir);

  const nowStamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupSnapshotPath = path.join(importsDir, `account-before-restore-${nowStamp}.json`);
  const existing = await prisma.account.findMany({
    select: { code: true, label: true, parentCode: true, level: true, normalBalance: true },
    orderBy: { code: "asc" },
  });
  fs.writeFileSync(backupSnapshotPath, JSON.stringify(existing, null, 2), "utf-8");
  console.log(`Current Account snapshot saved: ${backupSnapshotPath}`);

  await prisma.$transaction(async (tx) => {
    await tx.account.deleteMany({});
    await tx.account.createMany({ data: rows });
  });

  const finalCount = await prisma.account.count();
  console.log(`Restore complete. Account rows in DB: ${finalCount}`);
}

main()
  .catch((error) => {
    console.error("Account restore failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
