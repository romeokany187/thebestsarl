import { NextResponse } from 'next/server'
import { requireApiRoles } from '@/lib/rbac'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const access = await requireApiRoles(['ADMIN', 'ACCOUNTANT'])
  if (access.error) return access.error

  const transfers = await prisma.floatTransfer.findMany({ orderBy: { createdAt: 'desc' } })
  return NextResponse.json(transfers)
}

export async function POST(req: Request) {
  const access = await requireApiRoles(['ADMIN', 'ACCOUNTANT'])
  if (access.error) return access.error

  const body = await req.json()
  const { fromKind, fromAccount, toKind, toAccount, amount, currency, note } = body
  if (!fromKind || !fromAccount || !toKind || !toAccount || !amount) return NextResponse.json({ error: 'missing fields' }, { status: 400 })

  try {
    const created = await prisma.floatTransfer.create({ data: {
      fromKind, fromAccount: String(fromAccount), toKind, toAccount: String(toAccount), amount: Number(amount), currency: currency || 'USD', note: note || '', initiatedById: access.session.user.id
    } })
    return NextResponse.json(created)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  // Use PUT to execute a transfer: body { id }
  const access = await requireApiRoles(['ADMIN', 'ACCOUNTANT'])
  if (access.error) return access.error

  const body = await req.json()
  const { id, action } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  try {
    if (action === 'execute') {
      const tx = await prisma.$transaction(async (prismaTx) => {
        const tr = await prismaTx.floatTransfer.update({ where: { id }, data: { status: 'COMPLETED', executedAt: new Date() } })

        // create corresponding CashOperation records if cash involved
        // outflow from fromAccount if it's CASH
        if (tr.fromKind === 'CASH') {
          await prismaTx.cashOperation.create({ data: {
            occurredAt: new Date(), direction: 'OUTFLOW', category: 'OTHER_EXPENSE', amount: tr.amount, currency: tr.currency, description: `Float transfer to ${tr.toAccount}`, cashDesk: tr.fromAccount, createdById: access.session.user.id
          } })
        }
        // inflow to toAccount if it's CASH
        if (tr.toKind === 'CASH') {
          await prismaTx.cashOperation.create({ data: {
            occurredAt: new Date(), direction: 'INFLOW', category: 'OTHER_SALE', amount: tr.amount, currency: tr.currency, description: `Float transfer from ${tr.fromAccount}`, cashDesk: tr.toAccount, createdById: access.session.user.id
          } })
        }

        return tr
      })
      return NextResponse.json(tx)
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  const access = await requireApiRoles(['ADMIN', 'ACCOUNTANT'])
  if (access.error) return access.error

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  try {
    await prisma.floatTransfer.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
