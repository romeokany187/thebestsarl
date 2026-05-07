import { NextResponse } from 'next/server'
import { requireApiModuleAccess } from '@/lib/rbac'
import { prisma } from '@/lib/prisma'

export async function POST(req: Request) {
  const access = await requireApiModuleAccess('payments', ['ADMIN', 'DIRECTEUR_GENERAL', 'MANAGER', 'ACCOUNTANT', 'EMPLOYEE'], 'WRITE')
  if (access.error) return access.error

  const body = await req.json()
  const accounts = body.accounts
  if (!Array.isArray(accounts)) return NextResponse.json({ error: 'accounts array required' }, { status: 400 })

  let count = 0
  for (const a of accounts) {
    if (!a.code || !a.label) continue
    try {
      await prisma.account.upsert({
        where: { code: String(a.code) },
        update: { label: String(a.label), parentCode: a.parentCode ?? null, level: a.level ?? null },
        create: { code: String(a.code), label: String(a.label), parentCode: a.parentCode ?? null, level: a.level ?? null },
      })
      count++
    } catch (e: any) {
      console.error('Upsert account error', a.code, e.message)
    }
  }

  return NextResponse.json({ ok: true, count })
}
