"use client"
import React, { useEffect, useMemo, useState } from 'react'

type Account = {
  id: string
  code: string
  label: string
  parentCode?: string | null
  level?: number | null
  normalBalance?: string | null
}

type AccountNode = Account & { children: AccountNode[] }

const CLASS_LABELS: Record<string, string> = {
  '1': 'Classe 1 — Comptes de capitaux',
  '2': 'Classe 2 — Comptes d\'immobilisations',
  '3': 'Classe 3 — Comptes de stocks',
  '4': 'Classe 4 — Comptes de tiers',
  '5': 'Classe 5 — Comptes de trésorerie',
  '6': 'Classe 6 — Comptes de charges',
  '7': 'Classe 7 — Comptes de produits',
  '8': 'Classe 8 — Comptes des résultats',
  '9': 'Classe 9 — Comptes analytiques',
}

const CLASS_COLORS: Record<string, string> = {
  '1': 'border-violet-200/70 dark:border-violet-800/60',
  '2': 'border-blue-200/70 dark:border-blue-800/60',
  '3': 'border-amber-200/70 dark:border-amber-800/60',
  '4': 'border-rose-200/70 dark:border-rose-800/60',
  '5': 'border-emerald-200/70 dark:border-emerald-800/60',
  '6': 'border-red-200/70 dark:border-red-800/60',
  '7': 'border-green-200/70 dark:border-green-800/60',
  '8': 'border-sky-200/70 dark:border-sky-800/60',
  '9': 'border-zinc-200/70 dark:border-zinc-700/60',
}

const CLASS_HEADER: Record<string, string> = {
  '1': 'bg-violet-50/80 dark:bg-violet-950/20',
  '2': 'bg-blue-50/80 dark:bg-blue-950/20',
  '3': 'bg-amber-50/80 dark:bg-amber-950/20',
  '4': 'bg-rose-50/80 dark:bg-rose-950/20',
  '5': 'bg-emerald-50/80 dark:bg-emerald-950/20',
  '6': 'bg-red-50/80 dark:bg-red-950/20',
  '7': 'bg-green-50/80 dark:bg-green-950/20',
  '8': 'bg-sky-50/80 dark:bg-sky-950/20',
  '9': 'bg-zinc-50/80 dark:bg-zinc-900/40',
}

const CLASS_BADGE: Record<string, string> = {
  '1': 'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300',
  '2': 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
  '3': 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
  '4': 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300',
  '5': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300',
  '6': 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300',
  '7': 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300',
  '8': 'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300',
  '9': 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
}

function buildTree(accounts: Account[]): AccountNode[] {
  const map = new Map<string, AccountNode>()
  for (const a of accounts) map.set(a.code, { ...a, children: [] })
  const roots: AccountNode[] = []
  for (const node of map.values()) {
    if (node.parentCode && map.has(node.parentCode)) {
      map.get(node.parentCode)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  // Sort children by code at every level
  function sortNode(n: AccountNode) {
    n.children.sort((a, b) => a.code.localeCompare(b.code))
    n.children.forEach(sortNode)
  }
  roots.sort((a, b) => a.code.localeCompare(b.code))
  roots.forEach(sortNode)
  return roots
}

function flattenTree(nodes: AccountNode[]): Account[] {
  const result: Account[] = []
  function walk(n: AccountNode) {
    result.push(n)
    n.children.forEach(walk)
  }
  nodes.forEach(walk)
  return result
}

function countNodes(nodes: AccountNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countNodes(node.children), 0)
}

function matchesSearch(node: AccountNode, q: string): boolean {
  const lq = q.toLowerCase()
  if (node.code.toLowerCase().includes(lq) || node.label.toLowerCase().includes(lq)) return true
  return node.children.some(c => matchesSearch(c, lq))
}

function filterTree(nodes: AccountNode[], q: string): AccountNode[] {
  if (!q) return nodes
  return nodes
    .map(node => {
      if (node.code.toLowerCase().includes(q.toLowerCase()) || node.label.toLowerCase().includes(q.toLowerCase())) {
        return node
      }
      const filteredChildren = filterTree(node.children, q)
      if (filteredChildren.length > 0) return { ...node, children: filteredChildren }
      return null
    })
    .filter(Boolean) as AccountNode[]
}

// ─── AccountRow ───────────────────────────────────────────────────────────────
function AccountRow({
  node,
  depth,
  onEdit,
  onDelete,
  forceOpen,
}: {
  node: AccountNode
  depth: number
  onEdit: (a: Account) => void
  onDelete: (id: string) => void
  forceOpen: boolean
}) {
  const [open, setOpen] = useState(forceOpen)
  const hasChildren = node.children.length > 0
  const isGroup = depth === 0
  const isSubGroup = depth === 1
  const cls = node.code[0]

  useEffect(() => { setOpen(forceOpen) }, [forceOpen])

  return (
    <>
      <div
        className={[
          'flex items-center gap-2 py-1.5 px-2 rounded-md group',
          isGroup ? `border bg-black/2 font-semibold text-sm dark:bg-white/3 ${CLASS_COLORS[cls] ?? 'border-black/10 dark:border-white/10'}` : '',
          isSubGroup ? 'font-medium text-sm' : '',
          !isGroup && !isSubGroup ? 'text-xs text-black/70 dark:text-white/60' : '',
          hasChildren ? 'cursor-pointer hover:bg-black/5 dark:hover:bg-white/5' : '',
        ].join(' ')}
        style={{ paddingLeft: `${(depth * 20) + 8}px` }}
        onClick={() => hasChildren && setOpen(o => !o)}
      >
        {hasChildren ? (
          <span className="text-black/40 dark:text-white/30 w-3 shrink-0">
            {open ? '▾' : '▸'}
          </span>
        ) : (
          <span className="w-3 shrink-0" />
        )}

        <span className={[
          'font-mono shrink-0 px-1.5 py-0.5 rounded text-xs',
          CLASS_BADGE[cls] ?? 'bg-zinc-100 text-zinc-600',
        ].join(' ')}>
          {node.code}
        </span>

        <span className="flex-1 truncate">{node.label}</span>

        {node.normalBalance && (
          <span className="hidden group-hover:inline text-[10px] text-black/40 dark:text-white/30 shrink-0">
            {node.normalBalance === 'DEBIT' ? 'D' : 'C'}
          </span>
        )}

        <span className="hidden group-hover:flex items-center gap-1 shrink-0">
          <button
            onClick={e => { e.stopPropagation(); onEdit(node) }}
            className="px-1.5 py-0.5 text-[10px] rounded border border-black/20 hover:bg-black/10 dark:border-white/20 dark:hover:bg-white/10"
          >
            Éditer
          </button>
          <button
            onClick={e => { e.stopPropagation(); onDelete(node.id) }}
            className="px-1.5 py-0.5 text-[10px] rounded border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30"
          >
            ✕
          </button>
        </span>
      </div>

      {hasChildren && open && node.children.map(child => (
        <AccountRow
          key={child.id}
          node={child}
          depth={depth + 1}
          onEdit={onEdit}
          onDelete={onDelete}
          forceOpen={forceOpen}
        />
      ))}
    </>
  )
}

// ─── AccountFormModal ─────────────────────────────────────────────────────────
function AccountFormModal({
  editing,
  onClose,
  onSaved,
  allAccounts,
}: {
  editing: Partial<Account>
  onClose: () => void
  onSaved: () => void
  allAccounts: Account[]
}) {
  const [code, setCode] = useState(editing.code ?? '')
  const [label, setLabel] = useState(editing.label ?? '')
  const [parentCode, setParentCode] = useState(editing.parentCode ?? '')
  const [normalBalance, setNormalBalance] = useState(editing.normalBalance ?? 'DEBIT')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // When code changes, auto-infer parent
  function handleCodeChange(val: string) {
    setCode(val)
    if (!editing.id) {
      // try to infer parent
      const codes = new Set(allAccounts.map(a => a.code))
      for (let len = val.length - 1; len >= 1; len--) {
        const candidate = val.slice(0, len)
        if (codes.has(candidate)) { setParentCode(candidate); break }
      }
    }
  }

  async function save() {
    if (!code.trim() || !label.trim()) { setError('Code et intitulé obligatoires.'); return }
    setLoading(true)
    setError('')
    try {
      const body = {
        id: editing.id,
        code: code.trim(),
        label: label.trim(),
        parentCode: parentCode.trim() || null,
        level: code.trim().length,
        normalBalance,
      }
      const method = editing.id ? 'PUT' : 'POST'
      const res = await fetch('/api/comptabilite/accounts', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) { setError(payload?.error ?? 'Erreur lors de l\'enregistrement.'); setLoading(false); return }
      onSaved()
    } catch {
      setError('Erreur réseau.')
    }
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-6 shadow-xl dark:border-white/10 dark:bg-zinc-900"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold mb-4">{editing.id ? 'Modifier le compte' : 'Nouveau compte'}</h3>

        <div className="grid gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">Code</label>
            <input
              value={code}
              onChange={e => handleCodeChange(e.target.value)}
              placeholder="ex: 5711"
              className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm font-mono dark:border-white/15 dark:bg-zinc-800"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">Intitulé</label>
            <input
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="ex: Caisse en francs congolais"
              className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-800"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">Compte parent (code)</label>
            <input
              value={parentCode}
              onChange={e => setParentCode(e.target.value)}
              placeholder="ex: 571"
              className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm font-mono dark:border-white/15 dark:bg-zinc-800"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">Solde normal</label>
            <select
              value={normalBalance}
              onChange={e => setNormalBalance(e.target.value)}
              className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-800"
            >
              <option value="DEBIT">Débit</option>
              <option value="CREDIT">Crédit</option>
            </select>
          </div>
        </div>

        {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-black/15 px-4 py-2 text-sm hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/5"
          >
            Annuler
          </button>
          <button
            onClick={save}
            disabled={loading}
            className="rounded-md bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
          >
            {loading ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function AccountsManager() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<Partial<Account> | null>(null)
  const [search, setSearch] = useState('')
  const [expandAll, setExpandAll] = useState(false)
  const [notify, setNotify] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [seeding, setSeeding] = useState(false)

  function showNotify(type: 'success' | 'error', message: string) {
    setNotify({ type, message })
    setTimeout(() => setNotify(null), 3500)
  }

  async function seedPlanComptable() {
    const currentCount = totalAccounts
    const message = currentCount > 0
      ? `Recharger le plan comptable actif (${currentCount} comptes) sans reinitialiser vos modifications ?`
      : 'Initialiser le plan comptable SYSCOHADA de base ?'
    if (!confirm(message)) return
    setSeeding(true)
    try {
      const res = await fetch('/api/admin/seed-plan-comptable', { method: 'POST' })
      const payload = await res.json().catch(() => null)
      if (!res.ok) {
        showNotify('error', payload?.error ?? 'Erreur lors du chargement.')
      } else {
        const sourceLabel = payload?.source === 'active' ? 'plan actif' : 'plan initial SYSCOHADA'
        showNotify('success', `${payload.count} comptes synchronisés (${sourceLabel}).`)
        await fetchAccounts()
      }
    } catch {
      showNotify('error', 'Erreur réseau.')
    }
    setSeeding(false)
  }

  async function fetchAccounts() {
    setLoading(true)
    const res = await fetch('/api/comptabilite/accounts')
    if (res.ok) setAccounts(await res.json())
    setLoading(false)
  }

  useEffect(() => { fetchAccounts() }, [])

  const tree = useMemo(() => buildTree(accounts), [accounts])
  const filtered = useMemo(() => filterTree(tree, search), [tree, search])

  // Group filtered by class
  const byClass = useMemo(() => {
    const map: Record<string, AccountNode[]> = {}
    for (const node of filtered) {
      const cls = node.code[0]
      if (!map[cls]) map[cls] = []
      map[cls].push(node)
    }
    return map
  }, [filtered])

  const classKeys = Object.keys(byClass).sort()

  const totalAccounts = useMemo(() => flattenTree(tree).length, [tree])

  async function handleDelete(id: string) {
    if (!confirm('Supprimer ce compte ?')) return
    const res = await fetch(`/api/comptabilite/accounts?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (res.ok) {
      showNotify('success', 'Compte supprimé.')
      await fetchAccounts()
    } else {
      const payload = await res.json().catch(() => null)
      showNotify('error', payload?.error ?? 'Impossible de supprimer ce compte.')
    }
  }

  async function handleFile(file: File) {
    const name = file.name.toLowerCase()
    let accountsParsed: any[] = []
    if (name.endsWith('.json')) {
      const text = await file.text()
      const data = JSON.parse(text)
      if (Array.isArray(data)) accountsParsed = data
      else if (data.accounts && Array.isArray(data.accounts)) accountsParsed = data.accounts
    } else {
      const XLSX = await import('xlsx')
      const ab = await file.arrayBuffer()
      const wb = XLSX.read(ab, { type: 'array' })
      const sheetName = wb.SheetNames.find(n => /plan comptable/i.test(n)) || wb.SheetNames[0]
      const matrix = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' }) as Array<Array<string | number>>
      const headerIndex = matrix.findIndex((row) => row.some((cell) => String(cell || '').trim().toUpperCase() === 'CODE'))
      const rows = headerIndex >= 0 ? matrix.slice(headerIndex + 1) : matrix
      accountsParsed = rows.map((row) => ({
        code: String(row[0] ?? '').trim().replace(/\s+/g, ''),
        label: String(row[1] ?? '').trim(),
      })).filter(a => a.code && a.label)
    }

    if (!accountsParsed.length) { showNotify('error', 'Aucun compte trouvé.'); return }

    const codesSet = new Set([
      ...accounts.map((account) => String(account.code)),
      ...accountsParsed.map((a: any) => String(a.code)),
    ])
    function inferParent(code: string): string | null {
      for (let len = code.length - 1; len >= 1; len--) {
        const c = code.slice(0, len)
        if (codesSet.has(c)) return c
      }
      return null
    }

    const withParents = accountsParsed.map((a: any) => ({
      code: String(a.code),
      label: String(a.label),
      parentCode: a.parentCode ?? inferParent(String(a.code)),
      level: String(a.code).length,
    }))

    setLoading(true)
    const res = await fetch('/api/comptabilite/accounts/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accounts: withParents }),
    })
    setLoading(false)
    if (res.ok) {
      const j = await res.json()
      showNotify('success', `${j.count ?? withParents.length} comptes importés.`)
      await fetchAccounts()
    } else {
      const err = await res.json().catch(() => ({ error: 'Erreur inconnue' }))
      showNotify('error', err.error || 'Erreur lors de l\'import.')
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    handleFile(f)
    e.currentTarget.value = ''
  }

  return (
    <div className="space-y-4">
      {/* Notification banner */}
      {notify && (
        <div className={`rounded-md px-4 py-2.5 text-sm font-medium ${notify.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800' : 'bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-800'}`}>
          {notify.message}
        </div>
      )}
      <section className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher par code ou intitulé…"
            className="w-72 rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
          />
          <button
            onClick={() => setExpandAll(v => !v)}
            className="rounded-md border border-black/15 px-3 py-2 text-sm hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/5"
          >
            {expandAll ? 'Réduire tout' : 'Développer tout'}
          </button>
          {loading && <span className="text-xs text-black/40 dark:text-white/40">Chargement…</span>}
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-black/10 px-2.5 py-1 text-xs font-medium text-black/55 dark:border-white/10 dark:text-white/55">{totalAccounts} comptes</span>
          <label className="cursor-pointer rounded-md border border-black/15 px-3 py-2 text-sm hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/5">
            Importer
            <input type="file" accept=".xlsx,.xls,.csv,.json" onChange={onFileChange} className="hidden" />
          </label>
          <button
            onClick={seedPlanComptable}
            disabled={seeding}
            className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300 dark:hover:bg-indigo-900/40"
          >
            {seeding ? 'Chargement…' : '↓ Charger plan SYSCOHADA'}
          </button>
          <button
            onClick={() => setEditing({})}
            className="rounded-md bg-black px-3 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black"
          >
            + Ajouter
          </button>
        </div>
        </div>
      </section>

      {/* Plan comptable by class */}
      {classKeys.length === 0 && !loading && (
        <div className="rounded-xl border border-dashed border-black/20 px-6 py-10 text-center text-sm text-black/50 dark:border-white/20 dark:text-white/50">
          {accounts.length === 0
            ? 'Aucun compte dans la base. Importez le plan comptable via le bouton ci-dessus.'
            : 'Aucun résultat pour cette recherche.'}
        </div>
      )}

      {classKeys.map(cls => (
        <section key={cls} className={`overflow-hidden rounded-2xl border bg-white shadow-sm dark:bg-zinc-900 ${CLASS_COLORS[cls] ?? 'border-black/10 dark:border-white/10'}`}>
          <div className={`flex items-center gap-2 px-4 py-3 ${CLASS_HEADER[cls] ?? 'bg-black/2 dark:bg-white/3'}`}>
            <span className={`rounded px-2 py-0.5 text-xs font-bold ${CLASS_BADGE[cls] ?? ''}`}>Classe {cls}</span>
            <span className="text-sm font-semibold">{CLASS_LABELS[cls]?.replace(`Classe ${cls} — `, '') ?? ''}</span>
            <span className="ml-auto text-xs text-black/40 dark:text-white/30">
              {countNodes(byClass[cls])} comptes
            </span>
          </div>
          <div className="space-y-0.5 border-t border-black/10 px-2 py-2 dark:border-white/10 dark:bg-zinc-950/30">
            {byClass[cls].map(node => (
              <AccountRow
                key={node.id}
                node={node}
                depth={0}
                onEdit={setEditing}
                onDelete={handleDelete}
                forceOpen={expandAll || search.length > 0}
              />
            ))}
          </div>
        </section>
      ))}

      {/* Modal */}
      {editing !== null && (
        <AccountFormModal
          editing={editing}
          allAccounts={accounts}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await fetchAccounts() }}
        />
      )}
    </div>
  )
}
