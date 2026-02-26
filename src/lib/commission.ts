import { CommissionMode, CommissionRule, TravelClass } from "@prisma/client";

type RuleLike = Pick<
  CommissionRule,
  | "id"
  | "routePattern"
  | "travelClass"
  | "commissionMode"
  | "systemRatePercent"
  | "markupRatePercent"
  | "defaultBaseFareRatio"
  | "ratePercent"
  | "depositStockTargetAmount"
  | "depositStockConsumedAmount"
  | "batchCommissionAmount"
  | "startsAt"
  | "endsAt"
  | "isActive"
>;

function normalizeRoute(value: string) {
  return value.trim().toUpperCase();
}

function patternToRegex(pattern: string) {
  const escaped = pattern
    .trim()
    .toUpperCase()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

export function routeMatches(route: string, routePattern: string) {
  if (!routePattern || routePattern.trim() === "*") {
    return true;
  }

  return patternToRegex(routePattern).test(normalizeRoute(route));
}

function ruleScore(rule: RuleLike) {
  const classScore = rule.travelClass ? 100 : 0;
  const pattern = rule.routePattern?.trim() ?? "*";
  const routeScore = pattern === "*" ? 0 : pattern.replace(/\*/g, "").length;
  return classScore + routeScore;
}

export function pickCommissionRule(rules: RuleLike[], route: string, travelClass: TravelClass) {
  const now = new Date();

  const eligible = rules.filter((rule) => {
    if (!rule.isActive) return false;
    if (rule.startsAt > now) return false;
    if (rule.endsAt && rule.endsAt < now) return false;
    if (rule.travelClass && rule.travelClass !== travelClass) return false;
    return routeMatches(route, rule.routePattern);
  });

  if (eligible.length === 0) {
    return null;
  }

  return eligible
    .sort((a, b) => {
      const scoreDiff = ruleScore(b) - ruleScore(a);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }
      return b.startsAt.getTime() - a.startsAt.getTime();
    })[0] ?? null;
}

export function computeCommissionAmount(amount: number, rule: RuleLike, extraMarkupPercent = 0) {
  const systemRate = rule.systemRatePercent > 0 ? rule.systemRatePercent : rule.ratePercent;
  const markupRate = rule.markupRatePercent + Math.max(0, extraMarkupPercent);

  if (rule.commissionMode === CommissionMode.AFTER_DEPOSIT) {
    const targetAmount = rule.depositStockTargetAmount ?? 0;
    const batchAmount = rule.batchCommissionAmount ?? 0;

    if (targetAmount <= 0 || batchAmount <= 0) {
      return { ratePercent: 0, amount: 0, modeApplied: CommissionMode.AFTER_DEPOSIT };
    }

    const consumedBefore = rule.depositStockConsumedAmount;
    const consumedAfter = consumedBefore + amount;
    const batchesBefore = Math.floor(consumedBefore / targetAmount);
    const batchesAfter = Math.floor(consumedAfter / targetAmount);
    const newBatches = Math.max(0, batchesAfter - batchesBefore);
    const commissionAmount = newBatches * batchAmount;
    const ratePercent = amount > 0 ? (commissionAmount / amount) * 100 : 0;

    return {
      ratePercent,
      amount: commissionAmount,
      modeApplied: CommissionMode.AFTER_DEPOSIT,
    };
  }

  if (rule.commissionMode === CommissionMode.SYSTEM_PLUS_MARKUP) {
    const ratePercent = systemRate + markupRate;
    return {
      ratePercent,
      amount: amount * (ratePercent / 100),
      modeApplied: CommissionMode.SYSTEM_PLUS_MARKUP,
    };
  }

  if (rule.commissionMode === CommissionMode.MARKUP_ONLY) {
    const ratePercent = markupRate;
    return {
      ratePercent,
      amount: amount * (ratePercent / 100),
      modeApplied: CommissionMode.MARKUP_ONLY,
    };
  }

  const ratePercent = systemRate;
  return {
    ratePercent,
    amount: amount * (ratePercent / 100),
    modeApplied: CommissionMode.IMMEDIATE,
  };
}
