import React from 'react'
import { AppShell } from '@/components/app-shell'
import { AccountingPlanWorkspace } from '@/components/accounting-plan-workspace'
import { AccountingReportsWorkspace } from '@/components/accounting-reports-workspace'
import { AccountingWritingWorkspace } from '@/components/accounting-writing-workspace'
import { KpiCard } from '@/components/kpi-card'
import { prisma } from '@/lib/prisma'
import { requirePageModuleAccess } from '@/lib/rbac'

export const metadata = {
  title: 'Comptabilité — Plan comptable',
}

export const dynamic = 'force-dynamic'

function formatClassLabel(cls: string) {
  return `Classe ${cls}`
}

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
  const totalAccounts = accounts.length
  const rootAccounts = accounts.filter((account) => !account.parentCode).length
  const detailAccounts = accounts.filter((account) => !accounts.some((candidate) => candidate.parentCode === account.code)).length
  const classCounts = accounts.reduce<Record<string, number>>((acc, account) => {
    const cls = account.code.slice(0, 1)
    if (!cls) return acc
    acc[cls] = (acc[cls] ?? 0) + 1
    return acc
  }, {})
  const activeClasses = Object.keys(classCounts).sort()
  const densestClass = activeClasses
    .map((cls) => ({ cls, count: classCounts[cls] }))
    .sort((left, right) => right.count - left.count)[0] ?? null
  const topClasses = activeClasses
    .map((cls) => ({ cls, count: classCounts[cls] }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 3)

  return (
    <AppShell role={role}>
      <div className="mx-auto w-full max-w-6xl">
        <section className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Comptabilité</h1>
        </section>

        <AccountingWritingWorkspace
          overviewWorkspace={(
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard label="Total comptes" value={String(totalAccounts)} />
              <KpiCard
                label="Classes actives"
                value={String(activeClasses.length)}
                hint={activeClasses.length > 0 ? activeClasses.map(formatClassLabel).join(' • ') : undefined}
              />
              <KpiCard label="Comptes racines" value={String(rootAccounts)} />
              <KpiCard label="Comptes de détail" value={String(detailAccounts)} />
            </section>
          )}
          pilotageWorkspace={(
            <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
              <section className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
                <h2 className="text-sm font-semibold tracking-tight">Pilotage</h2>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-black/10 bg-black/2 p-4 dark:border-white/10 dark:bg-white/3">
                    <p className="text-xs text-black/55 dark:text-white/55">Classe la plus dense</p>
                    <p className="mt-1 text-base font-semibold">
                      {densestClass ? `${formatClassLabel(densestClass.cls)} • ${densestClass.count} comptes` : 'Aucune donnée'}
                    </p>
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
                <h2 className="text-sm font-semibold tracking-tight">Répartition</h2>
                <div className="mt-3 space-y-2">
                  {topClasses.length === 0 ? (
                    <p className="text-sm text-black/55 dark:text-white/55">Aucune classe disponible.</p>
                  ) : (
                    topClasses.map((entry) => (
                      <div key={entry.cls} className="flex items-center justify-between rounded-lg border border-black/10 px-3 py-2 text-sm dark:border-white/10">
                        <span>{formatClassLabel(entry.cls)}</span>
                        <span className="font-semibold">{entry.count} comptes</span>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </div>
          )}
          journalWorkspace={<AccountingJournalWorkspace />}
          reportsWorkspace={<AccountingReportsWorkspace accounts={accounts.map((account) => ({ code: account.code, label: account.label }))} />}
          planWorkspace={(
            <AccountingPlanWorkspace
              totalAccounts={totalAccounts}
              activeClasses={activeClasses.length}
              rootAccounts={rootAccounts}
              detailAccounts={detailAccounts}
              densestClassLabel={densestClass ? `${formatClassLabel(densestClass.cls)} • ${densestClass.count} comptes` : 'Aucune donnée'}
              topClasses={topClasses.map((entry) => ({ label: formatClassLabel(entry.cls), count: entry.count }))}
              manager={<AccountsManager />}
            />
          )}
        />
      </div>
    </AppShell>
  )
}
