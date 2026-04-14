import xlsx from 'xlsx'
import { PrismaClient } from '@prisma/client'
import fs from 'fs'
import path from 'path'

const prisma = new PrismaClient()

async function main() {
  const filePath = process.env.FILE_PATH || process.argv[2]
  if (!filePath) {
    console.error('Usage: FILE_PATH="/path/to/COMPTABILITE THE BEST SARL.xlsx" tsx scripts/import-plan-comptable.ts')
    process.exit(1)
  }
  if (!fs.existsSync(filePath)) {
    console.error('Fichier introuvable:', filePath)
    process.exit(1)
  }

  const workbook = xlsx.readFile(filePath)
  const preview: any = { filePath, sheets: [] }

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, any>[]
    preview.sheets.push({ name: sheetName, rowsCount: rows.length, sample: rows.slice(0, 10) })

    // If sheet looks like a chart of accounts (has Code/Compte and Intitulé), upsert rows
    const looksLikePlan = rows.length > 0 && rows[0] && (Object.keys(rows[0]).some(k => /code|compte|n\u00b0|numero/i.test(k)) && Object.keys(rows[0]).some(k => /intitul|libell|label|intitule/i.test(k)))
    if (looksLikePlan) {
      for (const r of rows) {
        const code = String(r['Code'] || r['Compte'] || r['N°'] || r['Numero'] || r['N° compte'] || r['Numero compte'] || '').trim()
        const label = String(r['Intitulé'] || r['Intitule'] || r['Libellé'] || r['Libelle'] || r['Label'] || r['Intitulé du compte'] || '').trim()
        const parent = String(r['Parent'] || r['Compte parent'] || r['Parent code'] || r['Sous-compte de'] || '').trim() || null
        const levelRaw = r['Niveau'] || r['Level'] || r['Niveau compte']
        const level = levelRaw ? parseInt(String(levelRaw), 10) : null
        if (!code || !label) continue

        await prisma.account.upsert({
          where: { code },
          update: { label, parentCode: parent, level },
          create: { code, label, parentCode: parent, level },
        })
      }
    }
  }

  // Ensure imports directory exists
  const importsDir = path.join(process.cwd(), 'imports')
  if (!fs.existsSync(importsDir)) fs.mkdirSync(importsDir)
  const outPath = path.join(importsDir, 'plan-comptable-preview.json')
  fs.writeFileSync(outPath, JSON.stringify(preview, null, 2), 'utf-8')

  console.log('Preview written to', outPath)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
