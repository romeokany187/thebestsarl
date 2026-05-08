-- Fix EDB line-item truncation: NeedRequest.details must store full QUOTE_V1 JSON payload.
ALTER TABLE `NeedRequest`
  MODIFY COLUMN `details` LONGTEXT NOT NULL;
