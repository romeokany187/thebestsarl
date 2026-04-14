const xlsx = require('xlsx')
const fs = require('fs')
const path = require('path')

function usage() {
  console.error('Usage: FILE_PATH="/path/to/file.xlsx" node scripts/preview-plan-comptable.js')
  process.exit(1)
}

const filePath = process.env.FILE_PATH || process.argv[2]
if (!filePath) usage()
if (!fs.existsSync(filePath)) {
  console.error('Fichier introuvable:', filePath)
  process.exit(1)
}

const workbook = xlsx.readFile(filePath)
const preview = { file: path.basename(filePath), path: filePath, sheets: [] }

for (const sheetName of workbook.SheetNames) {
  const sheet = workbook.Sheets[sheetName]
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' })
  const headers = rows.length > 0 ? Object.keys(rows[0]) : []
  preview.sheets.push({ name: sheetName, rowsCount: rows.length, headers, sampleRows: rows.slice(0, 20) })
}

const outDir = path.join(process.cwd(), 'imports')
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir)
const outFile = path.join(outDir, 'plan-comptable-preview.json')
fs.writeFileSync(outFile, JSON.stringify(preview, null, 2), 'utf-8')
console.log('Preview saved to', outFile)
