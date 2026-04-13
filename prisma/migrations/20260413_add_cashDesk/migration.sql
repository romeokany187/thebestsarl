
-- Migration: add cashDesk column to CashOperation (MySQL)

ALTER TABLE `CashOperation`
	ADD COLUMN `cashDesk` VARCHAR(191) NOT NULL DEFAULT 'THE_BEST';

CREATE INDEX `CashOperation_cashDesk_idx` ON `CashOperation` (`cashDesk`);
