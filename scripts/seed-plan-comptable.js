const { PrismaClient } = require('@prisma/client')
const fs = require('fs')
const path = require('path')

async function main() {
  const file = path.join(process.cwd(), 'imports', 'plan-comptable-full.json')
  if (!fs.existsSync(file)) {
    console.error('Missing', file, '— export first with export-plan-comptable.js')
    process.exit(1)
  }

  const data = JSON.parse(fs.readFileSync(file, 'utf-8'))
  const prisma = new PrismaClient()
  let count = 0
  for (const a of data) {
    try {
      await prisma.account.upsert({
        where: { code: a.code },
        update: { label: a.label },
        create: { code: a.code, label: a.label },
      })
      count++
    } catch (e) {
      console.error('Error upserting', a.code, e.message)
    }
  }
  console.log('Seeded', count, 'accounts')
  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
