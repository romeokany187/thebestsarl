import xlsx from 'xlsx'
import fs from 'fs'
import path from 'path'

function usage() {
  console.error('Usage: FILE_PATH="/path/to/file.xlsx" tsx scripts/preview-plan-comptable.ts')
  process.exit(1)
}

const filePath = process.env.FILE_PATH || process.argv[2]
if (!filePath) usage()
if (!fs.existsSync(filePath)) {
  console.error('Fichier introuvable:', filePath)
  process.exit(1)
}

const workbook = xlsx.readFile(filePath)
const preview: any = { file: path.basename(filePath), path: filePath, sheets: [] }

for (const sheetName of workbook.SheetNames) {
  const sheet = workbook.Sheets[sheetName]
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, any>[]
  const headers = rows.length > 0 ? Object.keys(rows[0]) : []
  preview.sheets.push({ name: sheetName, rowsCount: rows.length, headers, sampleRows: rows.slice(0, 20) })
}

const outDir = path.join(process.cwd(), 'imports')
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir)
const outFile = path.join(outDir, 'plan-comptable-preview.json')
fs.writeFileSync(outFile, JSON.stringify(preview, null, 2), 'utf-8')
console.log('Preview saved to', outFile)
