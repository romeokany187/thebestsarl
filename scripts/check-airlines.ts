import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const codes = ['SA', '4Z'];
  const found = await prisma.airline.findMany({ where: { code: { in: codes } }, select: { id: true, code: true, name: true } });
  console.log('Found airlines:', found);
  const missing = codes.filter((c) => !found.some((a) => a.code === c));
  if (missing.length > 0) {
    console.log('Missing codes:', missing);
    process.exitCode = 2;
  } else {
    process.exitCode = 0;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
