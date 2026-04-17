import { NextResponse } from 'next/server'
import { syncStructuredPlanAccounts } from '@/lib/plan-comptable-sync'
import { requireApiModuleAccess } from '@/lib/rbac'
import { prisma } from '@/lib/prisma'

function canManageAccounting(role: string, jobTitle: string | null | undefined) {
  return role === 'ADMIN' || role === 'ACCOUNTANT' || (jobTitle ?? '').trim().toUpperCase() === 'COMPTABLE'
}

export async function GET() {
  const access = await requireApiModuleAccess('payments', ['ADMIN', 'ACCOUNTANT', 'EMPLOYEE'])
  if (access.error) return access.error
  if (!canManageAccounting(access.role, access.session.user.jobTitle)) {
    return NextResponse.json({ error: 'Accès réservé au comptable et à l\'administrateur.' }, { status: 403 })
  }

  await syncStructuredPlanAccounts()
  const accounts = await prisma.account.findMany({ orderBy: { code: 'asc' } })
  return NextResponse.json(accounts)
}

export async function POST(req: Request) {
  const access = await requireApiModuleAccess('payments', ['ADMIN', 'ACCOUNTANT', 'EMPLOYEE'])
  if (access.error) return access.error
  if (!canManageAccounting(access.role, access.session.user.jobTitle)) {
    return NextResponse.json({ error: 'Accès réservé au comptable et à l\'administrateur.' }, { status: 403 })
  }

  const body = await req.json()
  const { code, label, parentCode, level } = body
  if (!code || !label) return NextResponse.json({ error: 'code and label required' }, { status: 400 })

  try {
    const created = await prisma.account.create({ data: { code: String(code), label: String(label), parentCode: parentCode || null, level: level ?? null } })
    return NextResponse.json(created)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  const access = await requireApiModuleAccess('payments', ['ADMIN', 'ACCOUNTANT', 'EMPLOYEE'])
  if (access.error) return access.error
  if (!canManageAccounting(access.role, access.session.user.jobTitle)) {
    return NextResponse.json({ error: 'Accès réservé au comptable et à l\'administrateur.' }, { status: 403 })
  }

  const body = await req.json()
  const { id, code, label, parentCode, level } = body
  if (!id || !code || !label) return NextResponse.json({ error: 'id, code and label required' }, { status: 400 })

  try {
    const updated = await prisma.account.update({ where: { id }, data: { code: String(code), label: String(label), parentCode: parentCode || null, level: level ?? null } })
    return NextResponse.json(updated)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  const access = await requireApiModuleAccess('payments', ['ADMIN', 'ACCOUNTANT', 'EMPLOYEE'])
  if (access.error) return access.error
  if (!canManageAccounting(access.role, access.session.user.jobTitle)) {
    return NextResponse.json({ error: 'Accès réservé au comptable et à l\'administrateur.' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  try {
    await prisma.account.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
