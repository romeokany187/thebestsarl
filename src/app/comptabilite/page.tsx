import React from 'react'
import { requirePageRoles } from '@/lib/rbac'

export const metadata = {
  title: 'Comptabilité — Plan comptable',
}

// Server-side guard: only ADMIN and ACCOUNTANT can reach this page; the client component will call protected APIs
export default async function Page() {
  await requirePageRoles(['ADMIN', 'ACCOUNTANT'])
  const AccountsManager = (await import('@/components/accounts-manager')).default
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Plan comptable général</h1>
      <p className="text-sm text-muted-foreground mb-4">Accessible aux rôles Admin et Comptable. Vous pouvez ajouter, modifier ou supprimer des comptes.</p>
      <AccountsManager />
    </div>
  )
}
