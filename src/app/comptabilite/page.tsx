import React from 'react'
import { redirect } from 'next/navigation'
import { AppShell } from '@/components/app-shell'
import { AccountingPlanWorkspace } from '@/components/accounting-plan-workspace'
import { AccountingReportsWorkspace } from '@/components/accounting-reports-workspace'
import { AccountingWritingWorkspace } from '@/components/accounting-writing-workspace'
import { KpiCard } from '@/components/kpi-card'
import { syncStructuredPlanAccounts } from '@/lib/plan-comptable-sync'
import { prisma } from '@/lib/prisma'
import { requirePageRoles } from '@/lib/rbac'

export const metadata = {
  title: 'Comptabilité — Plan comptable',
}

export const dynamic = 'force-dynamic'

function formatClassLabel(cls: string) {
  return `Classe ${cls}`
}

export default async function Page() {
  const { role, session } = await requirePageRoles(['ADMIN', 'ACCOUNTANT', 'EMPLOYEE'])
  const normalizedJobTitle = (session.user.jobTitle ?? '').trim().toUpperCase()

  if (role !== 'ADMIN' && role !== 'ACCOUNTANT' && normalizedJobTitle !== 'COMPTABLE') {
    redirect('/')
  }

  await syncStructuredPlanAccounts()

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
    <AppShell role={role} accessNote="Référentiel comptable central: structure des comptes, import, ajustements et chargement du plan SYSCOHADA dans le cadre standard de l'application.">
      <div className="mx-auto w-full max-w-6xl">
        <section className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Comptabilite</h1>
        </section>

        <AccountingWritingWorkspace
          overviewWorkspace={(
            <div className="space-y-4">
              <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-black/50 dark:text-white/50">Comptabilite</p>
                <h2 className="mt-1 text-2xl font-semibold tracking-tight">Espace comptable</h2>
                <p className="mt-2 max-w-3xl text-sm text-black/60 dark:text-white/60">
                  Cet espace centralise le plan comptable, le pilotage des classes et la passation des ecritures. Chaque zone est isolee dans le panneau principal pour garder une lecture simple, comme dans le module Paiements.
                </p>
              </section>

              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <KpiCard
                  label="Total comptes"
                  value={String(totalAccounts)}
                  hint="Tous niveaux confondus, racines et sous-comptes detailles."
                />
                <KpiCard
                  label="Classes actives"
                  value={String(activeClasses.length)}
                  hint={activeClasses.length > 0 ? activeClasses.map(formatClassLabel).join(' • ') : 'Aucune classe detectee'}
                />
                <KpiCard
                  label="Comptes racines"
                  value={String(rootAccounts)}
                  hint="Niveau superieur directement visible dans l'arborescence."
                />
                <KpiCard
                  label="Comptes de detail"
                  value={String(detailAccounts)}
                  hint="Comptes sans sous-comptes enfants."
                />
              </section>
            </div>
          )}
          pilotageWorkspace={(
            <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
              <section className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-black/50 dark:text-white/50">Pilotage</p>
                <h2 className="mt-1 text-lg font-semibold tracking-tight">Lecture rapide du referentiel</h2>
                <p className="mt-2 text-sm text-black/60 dark:text-white/60">
                  Utilise cette vue pour controler la densite des classes, verifier l'equilibre global du referentiel et decider rapidement si tu dois intervenir sur le plan comptable ou passer directement au journal.
                </p>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-black/10 bg-black/2 p-4 dark:border-white/10 dark:bg-white/3">
                    <p className="text-xs text-black/55 dark:text-white/55">Classe la plus dense</p>
                    <p className="mt-1 text-base font-semibold">
                      {densestClass ? `${formatClassLabel(densestClass.cls)} • ${densestClass.count} comptes` : 'Aucune donnee'}
                    </p>
                  </div>
                  <div className="rounded-xl border border-black/10 bg-black/2 p-4 dark:border-white/10 dark:bg-white/3">
                    <p className="text-xs text-black/55 dark:text-white/55">Priorite de travail</p>
                    <p className="mt-1 text-base font-semibold">Journal manuel et plan comptable se pilotent separement</p>
                    <p className="mt-1 text-xs text-black/55 dark:text-white/55">Les notifications caisse servent de rappel, pas de source automatique.</p>
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-black/50 dark:text-white/50">Repartition</p>
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
          journalWorkspace={(
            <div className="space-y-4">
              <section className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-black/50 dark:text-white/50">Livre journal</p>
                <h2 className="mt-1 text-lg font-semibold tracking-tight">Passation des operations comptables</h2>
                <p className="mt-2 text-sm text-black/60 dark:text-white/60">
                  Le comptable saisit manuellement ses ecritures equilibrees en partie double, avec un ou plusieurs comptes au debit et au credit selon le modele du livre journal de votre fichier Excel. Les operations de caisse ne servent qu'a notifier qu'une passation comptable est attendue.
                </p>
              </section>

              <AccountingJournalWorkspace />
            </div>
          )}
          reportsWorkspace={<AccountingReportsWorkspace accounts={accounts.map((account) => ({ code: account.code, label: account.label }))} />}
          planWorkspace={(
            <AccountingPlanWorkspace
              totalAccounts={totalAccounts}
              activeClasses={activeClasses.length}
              rootAccounts={rootAccounts}
              detailAccounts={detailAccounts}
              densestClassLabel={densestClass ? `${formatClassLabel(densestClass.cls)} • ${densestClass.count} comptes` : 'Aucune donnee'}
              topClasses={topClasses.map((entry) => ({ label: formatClassLabel(entry.cls), count: entry.count }))}
              manager={<AccountsManager />}
            />
          )}
        />
      </div>
    </AppShell>
  )
}
