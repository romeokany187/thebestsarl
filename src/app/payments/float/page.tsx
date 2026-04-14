import React from 'react'
import { requirePageModuleAccess } from '@/lib/rbac'

export const metadata = { title: 'Payments — Float management' }

export default async function Page() {
  await requirePageModuleAccess('payments')
  const FloatManager = (await import('@/components/float-manager')).default
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Gestion du float</h1>
      <p className="mb-4">Transferts internes entre comptes virtuels et caisses physiques.</p>
      <FloatManager />
    </div>
  )
}
