/** Profil utilisateur pour rattacher un billet via la colonne payant (payerName). */
export type PayerUserMatchProfile = {
  name: string;
  email: string;
  teamName?: string | null;
};

export function normalizePayerLookupKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9@.+_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function compactPayerLookupKey(value: string) {
  return normalizePayerLookupKey(value).replace(/\s+/g, "");
}

function addLookupKeys(keys: Set<string>, value: string) {
  if (!value.trim()) return;
  const normalized = normalizePayerLookupKey(value);
  const compact = compactPayerLookupKey(value);
  if (normalized) keys.add(normalized);
  if (compact) keys.add(compact);
}

/** Nom affiché après le préfixe « Agent - » (valeur standard du formulaire ventes). */
export function extractAgentNameFromPayer(payerName: string | null | undefined) {
  const raw = (payerName ?? "").trim();
  if (!raw) return null;
  const match = raw.match(/^agent\s*[-–—:]\s*(.+)$/i);
  return match?.[1]?.trim() || null;
}

/** Nom d'équipe après le préfixe « Équipe - ». */
export function extractTeamNameFromPayer(payerName: string | null | undefined) {
  const raw = (payerName ?? "").trim();
  if (!raw) return null;
  const match = raw.match(/^(?:équipe|equipe|team)\s*[-–—:]\s*(.+)$/i);
  return match?.[1]?.trim() || null;
}

/** Retire les préfixes saisis en ventes : Agent -, Équipe -, Client -, etc. */
export function stripPayerRolePrefix(raw: string) {
  return raw
    .trim()
    .replace(/^(agent|employe|employe\(e\)|employée|equipe|équipe|team|agence|client)\s*[-–—:]?\s*/i, "")
    .trim();
}

/** Toutes les clés possibles pour une valeur payant en base. */
export function collectPayerNameMatchKeys(payerName: string | null | undefined) {
  const keys = new Set<string>();
  const raw = (payerName ?? "").trim();
  if (!raw) return keys;

  addLookupKeys(keys, raw);
  addLookupKeys(keys, stripPayerRolePrefix(raw));

  return keys;
}

/** Clés pour lesquelles un utilisateur peut apparaître comme payant (formulaire ventes). */
export function collectUserPayerMatchKeys(user: PayerUserMatchProfile) {
  const keys = new Set<string>();
  const name = user.name.trim();
  const email = user.email.trim();

  addLookupKeys(keys, name);
  addLookupKeys(keys, email);
  addLookupKeys(keys, `Agent - ${name}`);
  addLookupKeys(keys, `Agent ${name}`);

  const team = user.teamName?.trim();
  if (team) {
    addLookupKeys(keys, team);
    addLookupKeys(keys, `Équipe - ${team}`);
    addLookupKeys(keys, `Equipe - ${team}`);
  }

  return keys;
}

/** True si ce billet compte pour l'utilisateur connecté (colonne payant). */
export function ticketPayerMatchesUser(
  payerName: string | null | undefined,
  user: PayerUserMatchProfile,
): boolean {
  const raw = (payerName ?? "").trim();
  if (!raw) return false;

  const payerKeys = collectPayerNameMatchKeys(raw);
  const userKeys = collectUserPayerMatchKeys(user);

  for (const key of payerKeys) {
    if (userKeys.has(key)) return true;
  }

  const payerCompact = compactPayerLookupKey(stripPayerRolePrefix(raw));
  if (!payerCompact) return false;

  const identityCompacts = [
    compactPayerLookupKey(user.name),
    compactPayerLookupKey(user.email),
    compactPayerLookupKey(`Agent - ${user.name}`),
  ].filter(Boolean);

  if (identityCompacts.some((key) => key === payerCompact)) {
    return true;
  }

  const team = user.teamName?.trim();
  if (team) {
    const teamCompacts = [
      compactPayerLookupKey(team),
      compactPayerLookupKey(`Équipe - ${team}`),
      compactPayerLookupKey(`Equipe - ${team}`),
    ].filter(Boolean);
    if (teamCompacts.some((key) => key === payerCompact)) {
      return true;
    }
  }

  return false;
}
