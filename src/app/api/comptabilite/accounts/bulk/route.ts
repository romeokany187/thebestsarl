import { NextResponse } from 'next/server'
import { requireApiModuleAccess } from '@/lib/rbac'
import { prisma } from '@/lib/prisma'

function canManageAccounting(role: string, jobTitle: string | null | undefined) {
  return role === 'ADMIN' || role === 'ACCOUNTANT' || (jobTitle ?? '').trim().toUpperCase() === 'COMPTABLE'
}

export async function POST(req: Request) {
  const access = await requireApiModuleAccess('payments', ['ADMIN', 'ACCOUNTANT', 'EMPLOYEE'])
  if (access.error) return access.error
  if (!canManageAccounting(access.role, access.session.user.jobTitle)) {
    return NextResponse.json({ error: 'Accès réservé au comptable et à l\'administrateur.' }, { status: 403 })
  }

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
