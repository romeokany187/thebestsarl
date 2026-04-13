-- Migration: add cashDesk column to CashOperation

ALTER TABLE "CashOperation"
ADD COLUMN "cashDesk" TEXT NOT NULL DEFAULT 'THE_BEST';

CREATE INDEX IF NOT EXISTS "CashOperation_cashDesk_idx" ON "CashOperation" ("cashDesk");
