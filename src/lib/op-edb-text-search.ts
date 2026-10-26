/** Recherche texte insensible aux accents (OP / EDB). */
export function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

export function matchesSearchQuery(haystack: string, query: string) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const normalizedHaystack = normalizeSearchText(haystack);
  return tokens.every((token) => normalizedHaystack.includes(token));
}

export function buildOpSearchHaystack(fields: {
  beneficiary?: string | null;
  purpose?: string | null;
  description?: string | null;
  code?: string | null;
  assignmentLabel?: string | null;
  statusLabel?: string | null;
}) {
  return [
    fields.beneficiary,
    fields.purpose,
    fields.description,
    fields.code,
    fields.assignmentLabel,
    fields.statusLabel,
  ]
    .filter(Boolean)
    .join(" ");
}

export function buildEdbSearchHaystack(fields: {
  title?: string | null;
  code?: string | null;
  requesterName?: string | null;
  category?: string | null;
  assignmentLabel?: string | null;
  statusLabel?: string | null;
  beneficiaryName?: string | null;
  lineText?: string | null;
  detailsExcerpt?: string | null;
}) {
  return [
    fields.title,
    fields.code,
    fields.requesterName,
    fields.category,
    fields.assignmentLabel,
    fields.statusLabel,
    fields.beneficiaryName,
    fields.lineText,
    fields.detailsExcerpt,
  ]
    .filter(Boolean)
    .join(" ");
}
