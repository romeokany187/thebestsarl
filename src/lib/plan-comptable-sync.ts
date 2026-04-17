import structuredPlan from '@/lib/plan-comptable-structured.json'
import { prisma } from '@/lib/prisma'

type PlanNode = {
  code: string
  label: string
  children?: PlanNode[]
}

export type FlatPlanAccount = {
  code: string
  label: string
  parentCode: string | null
  level: number
}

const PLAN_COMPTABLE_STRUCTURED = structuredPlan as PlanNode[]

export function flattenStructuredPlan(
  nodes: PlanNode[] = PLAN_COMPTABLE_STRUCTURED,
  parentCode: string | null = null,
): FlatPlanAccount[] {
  const result: FlatPlanAccount[] = []

  for (const node of nodes) {
    result.push({
      code: node.code,
      label: node.label,
      parentCode,
      level: node.code.length,
    })
    result.push(...flattenStructuredPlan(node.children ?? [], node.code))
  }

  return result
}

const STRUCTURED_PLAN_FLAT = flattenStructuredPlan()

export async function syncStructuredPlanAccounts() {
  const existingAccounts = await prisma.account.findMany({
    select: {
      code: true,
      label: true,
      parentCode: true,
      level: true,
    },
  })

  const existingByCode = new Map(existingAccounts.map((account) => [account.code, account]))
  const pendingSync = STRUCTURED_PLAN_FLAT.filter((account) => !existingByCode.has(account.code))

  if (pendingSync.length === 0) {
    return { synced: 0, total: existingAccounts.length }
  }

  for (const account of pendingSync) {
    await prisma.account.upsert({
      where: { code: account.code },
      update: {},
      create: {
        code: account.code,
        label: account.label,
        parentCode: account.parentCode,
        level: account.level,
      },
    })
  }

  return {
    synced: pendingSync.length,
    total: existingAccounts.length + pendingSync.filter((account) => !existingByCode.has(account.code)).length,
  }
}