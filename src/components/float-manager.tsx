"use client"
import React, { useEffect, useState } from 'react'

type FloatTransfer = {
  id: string
  fromKind: string
  fromAccount: string
  toKind: string
  toAccount: string
  amount: number
  currency: string
  status: string
}

export default function FloatManager() {
  const [transfers, setTransfers] = useState<FloatTransfer[]>([])
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ fromKind: 'VIRTUAL', fromAccount: '', toKind: 'CASH', toAccount: '', amount: '', currency: 'USD', note: '' })

  async function fetchTransfers() {
    setLoading(true)
    const res = await fetch('/api/payments/float')
    if (res.ok) setTransfers(await res.json())
    setLoading(false)
  }

  useEffect(() => { fetchTransfers() }, [])

  async function createTransfer() {
    const payload = { ...form, amount: Number(form.amount) }
    const res = await fetch('/api/payments/float', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    if (res.ok) { await fetchTransfers(); setForm({ fromKind: 'VIRTUAL', fromAccount: '', toKind: 'CASH', toAccount: '', amount: '', currency: 'USD', note: '' }) }
  }

  async function execute(id: string) {
    const res = await fetch('/api/payments/float', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action: 'execute' }) })
    if (res.ok) await fetchTransfers()
  }

  async function remove(id: string) {
    if (!confirm('Supprimer transfert ?')) return
    const res = await fetch(`/api/payments/float?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (res.ok) await fetchTransfers()
  }

  return (
    <div className="p-4">
      <h2 className="text-lg font-medium mb-2">Gestion du float</h2>
      <div className="grid grid-cols-3 gap-2 mb-4">
        <select value={form.fromKind} onChange={(e) => setForm({ ...form, fromKind: e.target.value })}>
          <option value="VIRTUAL">Virtual</option>
          <option value="CASH">Cash</option>
        </select>
        <input placeholder="From account (e.g., PROXYBANK)" value={form.fromAccount} onChange={(e) => setForm({ ...form, fromAccount: e.target.value })} />
        <select value={form.toKind} onChange={(e) => setForm({ ...form, toKind: e.target.value })}>
          <option value="CASH">Cash</option>
          <option value="VIRTUAL">Virtual</option>
        </select>
        <input placeholder="To account (e.g., CAISSE1)" value={form.toAccount} onChange={(e) => setForm({ ...form, toAccount: e.target.value })} />
        <input placeholder="Amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        <input placeholder="Currency" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
        <input className="col-span-3" placeholder="Note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
      </div>
      <div className="mb-4">
        <button onClick={createTransfer} className="btn btn-primary">Créer transfert</button>
      </div>

      {loading ? <div>Chargement...</div> : (
        <div>
          {transfers.map(t => (
            <div key={t.id} className="flex justify-between items-center border p-2 mb-2">
              <div>
                <div className="font-medium">{t.fromAccount} ({t.fromKind}) → {t.toAccount} ({t.toKind})</div>
                <div className="text-sm">{t.amount} {t.currency} — {t.status}</div>
              </div>
              <div className="flex gap-2">
                {t.status === 'PENDING' && <button onClick={() => execute(t.id)} className="btn">Exécuter</button>}
                <button onClick={() => remove(t.id)} className="btn btn-danger">Supprimer</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
