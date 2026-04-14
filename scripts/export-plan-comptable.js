const xlsx = require('xlsx')
const fs = require('fs')
const path = require('path')

function usage() {
  console.error('Usage: FILE_PATH="/path/to/file.xlsx" node scripts/export-plan-comptable.js')
  process.exit(1)
}

const filePath = process.env.FILE_PATH || process.argv[2]
if (!filePath) usage()
if (!fs.existsSync(filePath)) {
  console.error('Fichier introuvable:', filePath)
  process.exit(1)
}

const workbook = xlsx.readFile(filePath)
const sheetName = workbook.SheetNames.find(n => /plan comptable/i.test(n)) || workbook.SheetNames[0]
const sheet = workbook.Sheets[sheetName]
const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' })

const accounts = rows.map(r => {
  const code = String(r['CODE'] || r['Code'] || r['Compte'] || r['N°'] || r['Numero'] || '').trim()
  const label = String(r['COMPTE'] || r['Compte'] || r['Intitulé'] || r['Intitule'] || '').trim()
  return { code, label }
}).filter(a => a.code && a.label)

const outDir = path.join(process.cwd(), 'imports')
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir)
const outFile = path.join(outDir, 'plan-comptable-full.json')
fs.writeFileSync(outFile, JSON.stringify(accounts, null, 2), 'utf-8')
console.log('Exported', accounts.length, 'accounts to', outFile)
