"use client"
import React, { useEffect, useState } from 'react'
import { toast } from 'react-hot-toast'

type Account = {
  id: string
  code: string
  label: string
  parentCode?: string | null
  level?: number | null
}

export default function AccountsManager() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<Account | null>(null)
  const [showForm, setShowForm] = useState(false)

  async function fetchAccounts() {
    setLoading(true)
    const res = await fetch('/api/comptabilite/accounts')
    if (res.ok) {
      const data = await res.json()
      setAccounts(data)
    }
    setLoading(false)
  }

  useEffect(() => { fetchAccounts() }, [])

  function startCreate() {
    setEditing({ id: '', code: '', label: '', parentCode: null, level: null })
    setShowForm(true)
  }

  function startEdit(a: Account) {
    setEditing(a)
    setShowForm(true)
  }

  async function save() {
    if (!editing) return
    const payload = { id: editing.id, code: editing.code, label: editing.label, parentCode: editing.parentCode, level: editing.level }
    if (!editing.id) {
      const res = await fetch('/api/comptabilite/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (res.ok) { await fetchAccounts(); setShowForm(false); setEditing(null) }
    } else {
      const res = await fetch('/api/comptabilite/accounts', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (res.ok) { await fetchAccounts(); setShowForm(false); setEditing(null) }
    }
  }

  async function remove(id?: string) {
    if (!id) return
    if (!confirm('Supprimer ce compte ?')) return
    const res = await fetch(`/api/comptabilite/accounts?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (res.ok) await fetchAccounts()
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
      // assume excel
      const XLSX = await import('xlsx')
      const arrayBuffer = await file.arrayBuffer()
      const wb = XLSX.read(arrayBuffer, { type: 'array' })
      const sheetName = wb.SheetNames.find(n => /plan comptable/i.test(n)) || wb.SheetNames[0]
      const sheet = wb.Sheets[sheetName]
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, any>[]
      accountsParsed = rows.map(r => {
        const code = String(r['CODE'] || r['Code'] || r['Compte'] || r['N°'] || r['Numero'] || '').trim()
        const label = String(r['COMPTE'] || r['Compte'] || r['Intitulé'] || r['Intitule'] || '').trim()
        return { code, label }
      }).filter(a => a.code && a.label)
    }

    if (!accountsParsed.length) { toast.error('Aucun compte trouvé dans le fichier'); return }

    // normalize codes as strings without spaces
    accountsParsed = accountsParsed.map(a => ({ code: String(a.code).replace(/\s+/g, ''), label: String(a.label).trim() }))

    const codesSet = new Set(accountsParsed.map(a => a.code))
    // infer parent by trimming rightmost digit until found
    function inferParent(code: string) {
      for (let len = code.length - 1; len >= 1; len--) {
        const candidate = code.slice(0, len)
        if (codesSet.has(candidate)) return candidate
      }
      return null
    }

    const withParents = accountsParsed.map(a => ({
      code: a.code,
      label: a.label,
      parentCode: inferParent(a.code),
      level: a.code.length,
    }))

    // send to backend
    setLoading(true)
    const res = await fetch('/api/comptabilite/accounts/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accounts: withParents }) })
    setLoading(false)
    if (res.ok) {
      const j = await res.json()
      toast.success(`Importé ${j.count} comptes`)
      await fetchAccounts()
    } else {
      const err = await res.json().catch(() => ({ error: 'Erreur inconnue' }))
      toast.error(err.error || 'Erreur lors de limport')
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files && e.target.files[0]
    if (!f) return
    handleFile(f)
    e.currentTarget.value = ''
  }

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-medium">Plan comptable</h2>
        <div>
          <button onClick={startCreate} className="btn">Ajouter un compte</button>
          <label className="ml-2 btn">
            Importer
            <input type="file" accept=".xlsx,.xls,.csv,.json" onChange={onFileChange} style={{ display: 'none' }} />
          </label>
        </div>
      </div>

      {loading ? <div>Chargement...</div> : (
        <div className="grid gap-2">
          {accounts.map((a) => (
            <div key={a.id} className="flex justify-between items-center border p-2 rounded">
              <div>
                <div className="font-medium">{a.code} — {a.label}</div>
                {a.parentCode ? <div className="text-xs text-muted-foreground">Parent: {a.parentCode}</div> : null}
              </div>
              <div className="flex gap-2">
                <button onClick={() => startEdit(a)} className="btn">Éditer</button>
                <button onClick={() => remove(a.id)} className="btn btn-danger">Supprimer</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && editing && (
        <div className="mt-4 border p-4 rounded">
          <h3 className="font-semibold mb-2">{editing.id ? 'Modifier' : 'Créer'} compte</h3>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label>Code</label>
              <input value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value })} className="input" />
            </div>
            <div>
              <label>Intitulé</label>
              <input value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} className="input" />
            </div>
            <div>
              <label>Parent (code)</label>
              <input value={editing.parentCode ?? ''} onChange={(e) => setEditing({ ...editing, parentCode: e.target.value || null })} className="input" />
            </div>
            <div>
              <label>Niveau</label>
              <input type="number" value={editing.level ?? ''} onChange={(e) => setEditing({ ...editing, level: e.target.value ? Number(e.target.value) : null })} className="input" />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={save} className="btn btn-primary">Enregistrer</button>
            <button onClick={() => { setShowForm(false); setEditing(null) }} className="btn">Annuler</button>
          </div>
        </div>
      )}
    </div>
  )
}
