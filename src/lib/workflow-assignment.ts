export const WORKFLOW_ASSIGNMENT_VALUES = [
  "A_MON_COMPTE",
  "DIRECTEUR_GENERAL",
  "VISAS",
  "SAFETY",
  "BILLETTERIE",
  "TSL",
] as const;

export type WorkflowAssignmentValue = (typeof WORKFLOW_ASSIGNMENT_VALUES)[number];

export const WORKFLOW_ASSIGNMENT_OPTIONS: Array<{ value: WorkflowAssignmentValue; label: string }> = [
  { value: "A_MON_COMPTE", label: "À mon compte" },
  { value: "DIRECTEUR_GENERAL", label: "Directeur Général" },
  { value: "VISAS", label: "Visas" },
  { value: "SAFETY", label: "Safety" },
  { value: "BILLETTERIE", label: "THE BEST" },
  { value: "TSL", label: "TSL" },
];

export function normalizeWorkflowAssignment(value: string | null | undefined): WorkflowAssignmentValue {
  const normalized = (value ?? "A_MON_COMPTE").trim().toUpperCase();
  return WORKFLOW_ASSIGNMENT_VALUES.includes(normalized as WorkflowAssignmentValue)
    ? normalized as WorkflowAssignmentValue
    : "A_MON_COMPTE";
}

export function workflowAssignmentLabel(value: string | null | undefined) {
  const normalized = normalizeWorkflowAssignment(value);
  return WORKFLOW_ASSIGNMENT_OPTIONS.find((option) => option.value === normalized)?.label ?? "À mon compte";
}