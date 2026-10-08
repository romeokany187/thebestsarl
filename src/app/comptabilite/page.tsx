import React from 'react'
import { AppShell } from '@/components/app-shell'
import { AccountingPlanWorkspace } from '@/components/accounting-plan-workspace'
import { AccountingReportsWorkspace } from '@/components/accounting-reports-workspace'
import { AccountingWritingWorkspace } from '@/components/accounting-writing-workspace'
import { prisma } from '@/lib/prisma'
import { requirePageModuleAccess } from '@/lib/rbac'

export const metadata = {
  title: 'Comptabilité',
}

export const dynamic = 'force-dynamic'

export default async function Page() {
  const { role } = await requirePageModuleAccess('comptabilite', ['ADMIN', 'ACCOUNTANT', 'EMPLOYEE'])

  const accounts = await prisma.account.findMany({
    select: {
      code: true,
      label: true,
      parentCode: true,
    },
    orderBy: {
      code: 'asc',
    },
  })

  const AccountsManager = (await import('@/components/accounts-manager')).default
  const AccountingJournalWorkspace = (await import('@/components/accounting-journal-workspace')).AccountingJournalWorkspace

  return (
    <AppShell role={role}>
      <div className="mx-auto w-full max-w-6xl">
        <section className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Comptabilité</h1>
        </section>

        <AccountingWritingWorkspace
          journalWorkspace={<AccountingJournalWorkspace />}
          reportsWorkspace={<AccountingReportsWorkspace accounts={accounts.map((account) => ({ code: account.code, label: account.label }))} />}
          planWorkspace={(
            <AccountingPlanWorkspace manager={<AccountsManager />} />
          )}
        />
      </div>
    </AppShell>
  )
}
