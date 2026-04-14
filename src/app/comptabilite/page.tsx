import React from 'react'
import { requirePageRoles } from '@/lib/rbac'

export const metadata = {
  title: 'Comptabilité — Plan comptable',
}

export default async function Page() {
  await requirePageRoles(['ADMIN', 'ACCOUNTANT'])
  const AccountsManager = (await import('@/components/accounts-manager')).default
  return (
    <div className="px-4 py-6 md:px-6 lg:px-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Plan comptable général</h1>
        <p className="mt-1 text-sm text-black/50 dark:text-white/50">
          Référentiel des comptes de l'entreprise — SYSCOHADA révisé. Cliquez sur un groupe pour développer ses sous-comptes. Survolez un compte pour l'éditer.
        </p>
      </div>
      <AccountsManager />
    </div>
  )
}
