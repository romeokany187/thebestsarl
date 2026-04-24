CREATE TABLE `CashBilletageSnapshot` (
  `id`          VARCHAR(191) NOT NULL,
  `date`        VARCHAR(10)  NOT NULL,
  `cashDesk`    VARCHAR(191) NOT NULL,
  `usdCounts`   JSON         NOT NULL,
  `cdfCounts`   JSON         NOT NULL,
  `expectedUsd` DOUBLE       NOT NULL DEFAULT 0,
  `expectedCdf` DOUBLE       NOT NULL DEFAULT 0,
  `savedById`   VARCHAR(191) NOT NULL,
  `savedAt`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3)  NOT NULL,

  UNIQUE INDEX `CashBilletageSnapshot_date_cashDesk_key` (`date`, `cashDesk`),
  INDEX `CashBilletageSnapshot_cashDesk_date_idx` (`cashDesk`, `date`),
  INDEX `CashBilletageSnapshot_savedById_idx` (`savedById`),

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `CashBilletageSnapshot`
  ADD CONSTRAINT `CashBilletageSnapshot_savedById_fkey`
  FOREIGN KEY (`savedById`) REFERENCES `User` (`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
