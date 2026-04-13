Short instructions to add `cashDesk` column on Hostinger (phpMyAdmin)

1) Open hPanel → Databases → phpMyAdmin and select the production database used by the app.

2) (Optional) Inspect the table: click on the `CashOperation` table → Structure. If `cashDesk` already exists, stop.

3) Execute SQL: open the `SQL` tab and paste the contents of `prisma/mysql-add-cashDesk.sql` (or paste the SQL below) and click `Go`.

SQL to run:

ALTER TABLE `CashOperation`
  ADD COLUMN `cashDesk` VARCHAR(191) NOT NULL DEFAULT 'THE_BEST';

CREATE INDEX `CashOperation_cashDesk_idx` ON `CashOperation` (`cashDesk`);

4) Verify the column appears in Structure and reload the application. Users should now be able to use payments without the Prisma error.

5) (Optional) To keep repo/prisma in sync: commit & push. The repository already contains `prisma/schema.mysql.prisma` and CI runs `npx prisma db push --schema prisma/schema.mysql.prisma` during deploy; future deploys will also keep schema in sync.
