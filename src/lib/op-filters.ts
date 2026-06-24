import type { PaymentOrderStatus } from "@prisma/client";

export type OpFilter = "total" | "en-attente" | "approuves" | "executes" | "rejetes";

export const OP_FILTER_LABELS: Record<OpFilter, string> = {
  total: "Total OP",
  "en-attente": "En attente",
  approuves: "Approuvés",
  executes: "Exécutés",
  rejetes: "Rejetés",
};

export const OP_FILTER_COLORS: Record<OpFilter, string> = {
  total: "border-black/10 bg-black/3 text-black dark:text-white",
  "en-attente": "border-amber-200 bg-amber-50/50 text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/20 dark:text-amber-300",
  approuves: "border-emerald-200 bg-emerald-50/50 text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-950/20 dark:text-emerald-300",
  executes: "border-sky-200 bg-sky-50/50 text-sky-800 dark:border-sky-800/40 dark:bg-sky-950/20 dark:text-sky-300",
  rejetes: "border-red-200 bg-red-50/50 text-red-800 dark:border-red-800/40 dark:bg-red-950/20 dark:text-red-300",
};

export function opMatchesFilter(status: string, filter: OpFilter): boolean {
  switch (filter) {
    case "total":
      return true;
    case "en-attente":
      return status === "SUBMITTED";
    case "approuves":
      return status === "APPROVED";
    case "executes":
      return status === "EXECUTED";
    case "rejetes":
      return status === "REJECTED";
    default:
      return true;
  }
}

export function opStatusLabel(status: string): string {
  if (status === "SUBMITTED") return "En attente";
  if (status === "APPROVED") return "Approuvé";
  if (status === "EXECUTED") return "Exécuté";
  if (status === "REJECTED") return "Rejeté";
  return status;
}

export function opBadgeClass(status: string): string {
  if (status === "APPROVED" || status === "EXECUTED") {
    return "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700/50 dark:bg-emerald-950/30 dark:text-emerald-300";
  }
  if (status === "REJECTED") {
    return "border-red-300 bg-red-50 text-red-700 dark:border-red-700/50 dark:bg-red-950/30 dark:text-red-300";
  }
  if (status === "SUBMITTED") {
    return "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-300";
  }
  return "border-gray-300 bg-gray-50 text-gray-700 dark:border-gray-700/50 dark:bg-gray-950/30 dark:text-gray-300";
}
