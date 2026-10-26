import { parseNeedQuote } from "@/lib/need-lines";
import { workflowAssignmentLabel } from "@/lib/workflow-assignment";
import { buildEdbSearchHaystack, buildOpSearchHaystack } from "@/lib/op-edb-text-search";
import { needStatusLabel } from "@/lib/need-filters";
import { opStatusLabel } from "@/lib/op-filters";
export type OpTableRow = {
  id: string;
  createdAtLabel: string;
  code: string;
  beneficiary: string;
  purpose: string;
  description: string;
  assignmentLabel: string;
  amountLabel: string;
  status: string;
  searchHaystack: string;
};

export type EdbTableRow = {
  id: string;
  createdAtLabel: string;
  code: string;
  title: string;
  requesterName: string;
  assignmentLabel: string;
  amountLabel: string;
  statusLabel: string;
  searchHaystack: string;
};

function normalizeMoneyCurrency(value: string | null | undefined): "USD" | "CDF" {
  const normalized = (value ?? "CDF").trim().toUpperCase();
  return normalized === "USD" ? "USD" : "CDF";
}

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function toOpTableRow(order: {
  id: string;
  createdAt: Date;
  code?: string | null;
  beneficiary: string;
  purpose: string;
  description: string;
  assignment: string;
  amount: number;
  currency: string;
  status: string;
}): OpTableRow {
  const assignmentLabel = workflowAssignmentLabel(order.assignment);
  const statusLabel = opStatusLabel(order.status);
  return {
    id: order.id,
    createdAtLabel: formatDate(order.createdAt),
    code: order.code ?? order.id.slice(0, 8).toUpperCase(),
    beneficiary: order.beneficiary?.trim() || "-",
    purpose: order.purpose?.trim() || "-",
    description: order.description?.trim() || "-",
    assignmentLabel,
    amountLabel: `${order.amount.toFixed(2)} ${normalizeMoneyCurrency(order.currency)}`,
    status: order.status,
    searchHaystack: buildOpSearchHaystack({
      beneficiary: order.beneficiary,
      purpose: order.purpose,
      description: order.description,
      code: order.code,
      assignmentLabel,
      statusLabel,
    }),
  };
}

export function toEdbTableRow(need: {
  id: string;
  createdAt: Date;
  code?: string | null;
  title: string;
  category: string;
  details: string;
  estimatedAmount?: number | null;
  currency?: string | null;
  status: string;
  reviewComment?: string | null;
  requester: { name: string };
}): EdbTableRow {
  const quote = parseNeedQuote(need.details ?? null);
  const assignmentLabel = workflowAssignmentLabel(quote?.assignment);
  const statusLabel = needStatusLabel(need.status, need.reviewComment);
  const lineText = quote?.items?.map((line) => `${line.designation} ${line.description}`).join(" ") ?? "";
  const amountLabel =
    typeof need.estimatedAmount === "number"
      ? `${need.estimatedAmount.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} ${normalizeMoneyCurrency(need.currency)}`
      : "-";

  return {
    id: need.id,
    createdAtLabel: formatDate(need.createdAt),
    code: need.code ?? need.id.slice(0, 8).toUpperCase(),
    title: need.title,
    requesterName: need.requester.name,
    assignmentLabel,
    amountLabel,
    statusLabel,
    searchHaystack: buildEdbSearchHaystack({
      title: need.title,
      code: need.code,
      requesterName: need.requester.name,
      category: need.category,
      assignmentLabel,
      statusLabel,
      beneficiaryName: quote?.beneficiaryPersonName,
      lineText,
      detailsExcerpt: need.details?.slice(0, 2500),
    }),
  };
}
