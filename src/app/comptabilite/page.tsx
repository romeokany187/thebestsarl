import React from 'react'
import Link from 'next/link'
import { AppShell } from '@/components/app-shell'
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
  const { role } = await requirePageModuleAccess('payments', ['ADMIN', 'ACCOUNTANT'])
  const accounts = await prisma.account.findMany({
    select: {
      code: true,
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
      <div className="mx-auto w-full max-w-5xl">
        <section id="overview" className="mb-6 rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-black/50 dark:text-white/50">Comptabilité</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">Plan comptable général</h1>
              <p className="mt-2 max-w-2xl text-sm text-black/60 dark:text-white/60">
                Référentiel des comptes de l'entreprise, structuré par classes et sous-comptes, avec import, seed SYSCOHADA et ajustements manuels dans le même cadre que le module paiements.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link
                href="#pilotage"
                className="rounded-md border border-black/15 px-3 py-2 text-sm font-semibold hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
              >
                Vue pilotage
              </Link>
              <Link
                href="#plan-comptable"
                className="rounded-md bg-black px-3 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black"
              >
                Ouvrir le plan
              </Link>
            </div>
          </div>
        </section>

        <section className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Total comptes"
            value={String(totalAccounts)}
            hint="Tous niveaux confondus, racines et sous-comptes détaillés."
          />
          <KpiCard
            label="Classes actives"
            value={String(activeClasses.length)}
            hint={activeClasses.length > 0 ? activeClasses.map(formatClassLabel).join(' • ') : 'Aucune classe détectée'}
          />
          <KpiCard
            label="Comptes racines"
            value={String(rootAccounts)}
            hint="Niveau supérieur directement visible dans l'arborescence."
          />
          <KpiCard
            label="Comptes de détail"
            value={String(detailAccounts)}
            hint="Comptes sans sous-comptes enfants."
          />
        </section>

        <section id="pilotage" className="mb-6 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
          <div className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-black/50 dark:text-white/50">Sous-menu comptabilité</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href="#overview" className="rounded-full border border-black/15 px-3 py-2 text-xs font-semibold hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10">Vue d'ensemble</Link>
              <Link href="#pilotage" className="rounded-full border border-black/15 px-3 py-2 text-xs font-semibold hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10">Pilotage</Link>
              <Link href="#journal" className="rounded-full border border-black/15 px-3 py-2 text-xs font-semibold hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10">Livre journal</Link>
              <Link href="#plan-comptable" className="rounded-full border border-black/15 px-3 py-2 text-xs font-semibold hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10">Plan détaillé</Link>
            </div>
            <p className="mt-4 text-sm text-black/60 dark:text-white/60">
              Utilise ce module pour charger le référentiel SYSCOHADA, contrôler la densité des classes et ajuster rapidement les comptes sans sortir du cadre standard de l'application.
            </p>
          </div>

          <div className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-black/50 dark:text-white/50">Répartition</p>
            <div className="mt-3 space-y-3">
              <div className="rounded-xl border border-black/10 bg-black/2 p-3 dark:border-white/10 dark:bg-white/3">
                <p className="text-xs text-black/55 dark:text-white/55">Classe la plus dense</p>
                <p className="mt-1 text-base font-semibold">
                  {densestClass ? `${formatClassLabel(densestClass.cls)} • ${densestClass.count} comptes` : 'Aucune donnée'}
                </p>
              </div>
              <div className="space-y-2">
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
            </div>
          </div>
        </section>

        <section id="journal" className="mb-6">
          <div className="mb-4 rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-black/50 dark:text-white/50">Livre journal</p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight">Passation des opérations comptables</h2>
            <p className="mt-2 text-sm text-black/60 dark:text-white/60">
              Le comptable peut rattacher une opération de caisse au livre journal et saisir une écriture équilibrée en partie double, avec un ou plusieurs comptes au débit et au crédit selon le modèle de votre fichier Excel.
            </p>
          </div>

          <AccountingJournalWorkspace />
        </section>

        <section id="plan-comptable">
          <AccountsManager />
        </section>
      </div>
    </AppShell>
  )
}
