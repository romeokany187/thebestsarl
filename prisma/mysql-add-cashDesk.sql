-- MySQL migration SQL: add cashDesk column to CashOperation
-- Paste this into phpMyAdmin → SQL if you need to apply immediately on Hostinger

ALTER TABLE `CashOperation`
  ADD COLUMN `cashDesk` VARCHAR(191) NOT NULL DEFAULT 'THE_BEST';

CREATE INDEX `CashOperation_cashDesk_idx` ON `CashOperation` (`cashDesk`);

-- Notes:
-- - VARCHAR(191) is safe for indexed utf8mb4 columns.
-- - If the column or index already exists, phpMyAdmin will return an error; review the table structure first.
