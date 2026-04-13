#!/usr/bin/env bash
set -euo pipefail

# Script safe migration for production DB to add cashDesk column
# Usage: DATABASE_URL="postgres://..." bash scripts/apply-cashdesk-production.sh
# Must be run on the production host (Hostinger) with psql and pg_dump available.

if [ -z "${DATABASE_URL:-}" ]; then
  echo "Error: DATABASE_URL must be set. Example: export DATABASE_URL=\"postgres://user:pass@host:5432/db\""
  exit 1
fi

TS=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="cashops_backup_${TS}.dump"

echo "Creating a pg_dump backup to $BACKUP_FILE"
pg_dump "$DATABASE_URL" -Fc -f "$BACKUP_FILE"

echo "Applying schema changes and initial data adjustments in a single transaction..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
-- Add column if missing (nullable at first)
ALTER TABLE "CashOperation" ADD COLUMN IF NOT EXISTS "cashDesk" TEXT;
-- Set proxy banking rows to PROXY_BANKING explicitly
UPDATE "CashOperation" SET "cashDesk" = 'PROXY_BANKING' WHERE (description IS NOT NULL AND description LIKE 'PROXY_BANKING:%');
-- For all other rows that are currently NULL, set them to THE_BEST (preserve existing data for THE_BEST)
UPDATE "CashOperation" SET "cashDesk" = 'THE_BEST' WHERE "cashDesk" IS NULL;
-- Set default and not null constraint
ALTER TABLE "CashOperation" ALTER COLUMN "cashDesk" SET DEFAULT 'THE_BEST';
ALTER TABLE "CashOperation" ALTER COLUMN "cashDesk" SET NOT NULL;
-- Create index
CREATE INDEX IF NOT EXISTS "CashOperation_cashDesk_idx" ON "CashOperation" ("cashDesk");
COMMIT;
SQL

echo "Migration SQL applied. Backup saved to $BACKUP_FILE"

echo "Recommended: restart your Node process or redeploy the app now."

echo "Done."
