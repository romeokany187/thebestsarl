const fs = require('fs')
const path = require('path')

const infile = path.join(process.cwd(), 'imports', 'plan-comptable-full.json')
const outfile = path.join(process.cwd(), 'imports', 'plan-comptable-structured.json')

if (!fs.existsSync(infile)) {
  console.error('Input file not found:', infile)
  process.exit(1)
}

const raw = JSON.parse(fs.readFileSync(infile, 'utf-8'))

// Normalize codes to strings without spaces
const accounts = raw.map(a => ({ code: String(a.code).trim(), label: String(a.label).trim() }))

const map = new Map()
for (const a of accounts) {
  map.set(a.code, { code: a.code, label: a.label, children: [] })
}

// Helper: find longest existing prefix (< full length)
function findParent(code) {
  // try decreasing lengths from code.length-1 down to 1
  for (let len = code.length - 1; len >= 1; len--) {
    const candidate = code.slice(0, len)
    if (map.has(candidate)) return candidate
  }
  return null
}

// Build tree by attaching nodes to their parent if exists
for (const node of map.values()) {
  const parentCode = findParent(node.code)
  if (parentCode) {
    const parent = map.get(parentCode)
    if (parent) parent.children.push(node)
  }
}

// Collect roots (nodes without parent)
const roots = []
for (const node of map.values()) {
  const parentCode = findParent(node.code)
  if (!parentCode) roots.push(node)
}

// Sort function: numeric-aware on code, shorter first
function sortNodes(list) {
  list.sort((a, b) => {
    const na = Number(a.code)
    const nb = Number(b.code)
    if (!isNaN(na) && !isNaN(nb)) return na - nb
    return a.code.localeCompare(b.code, undefined, { numeric: true })
  })
  for (const n of list) if (n.children && n.children.length) sortNodes(n.children)
}

sortNodes(roots)

fs.writeFileSync(outfile, JSON.stringify(roots, null, 2), 'utf-8')
console.log('Structured plan written to', outfile)
