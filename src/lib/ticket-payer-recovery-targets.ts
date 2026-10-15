import { prisma } from "@/lib/prisma";
import {
  compactPayerLookupKey,
  extractAgentNameFromPayer,
  extractTeamNameFromPayer,
  normalizePayerLookupKey,
  ticketPayerMatchesUser,
  type PayerUserMatchProfile,
} from "@/lib/ticket-payer-user-match";

export type PayerRecoveryTargetUser = {
  id: string;
  name: string;
  email: string;
  teamName: string | null;
};

/** Comptes workspace pouvant être payants (email + identité en base). */
export async function loadPayerRecoveryTargetUsers(): Promise<PayerRecoveryTargetUser[]> {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      team: { select: { name: true } },
    },
    orderBy: { name: "asc" },
  });

  return users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    teamName: user.team?.name ?? null,
  }));
}

function toProfile(user: PayerRecoveryTargetUser): PayerUserMatchProfile {
  return {
    name: user.name,
    email: user.email,
    teamName: user.teamName,
  };
}

function matchUsersByCompactName(users: PayerRecoveryTargetUser[], label: string) {
  const targetCompact = compactPayerLookupKey(label);
  const targetNorm = normalizePayerLookupKey(label);
  if (!targetCompact && !targetNorm) return [];
  return users.filter((user) => {
    if (targetCompact && compactPayerLookupKey(user.name) === targetCompact) return true;
    if (targetNorm && normalizePayerLookupKey(user.name) === targetNorm) return true;
    return false;
  });
}

function matchUsersByCompactEmail(users: PayerRecoveryTargetUser[], email: string) {
  const target = compactPayerLookupKey(email);
  if (!target) return [];
  return users.filter((user) => compactPayerLookupKey(user.email) === target);
}

function matchUsersByTeamName(users: PayerRecoveryTargetUser[], teamLabel: string) {
  const target = compactPayerLookupKey(teamLabel);
  if (!target) return [];
  return users.filter((user) => user.teamName && compactPayerLookupKey(user.teamName) === target);
}

function dedupeUsers(users: PayerRecoveryTargetUser[]) {
  const seen = new Set<string>();
  return users.filter((user) => {
    if (seen.has(user.id)) return false;
    seen.add(user.id);
    return true;
  });
}

/**
 * Résout le payant d'un billet vers le(s) compte(s) applicatif(s) (id + e-mail).
 * Priorité : « Agent - {nom} » → utilisateur par nom, puis e-mail, puis équipe.
 */
export function matchPayerToWorkspaceUsers(
  payerLabel: string,
  users: PayerRecoveryTargetUser[],
): PayerRecoveryTargetUser[] {
  const raw = payerLabel.trim();
  if (!raw) return [];

  const agentName = extractAgentNameFromPayer(raw);
  if (agentName) {
    const byName = matchUsersByCompactName(users, agentName);
    if (byName.length > 0) return dedupeUsers(byName);
  }

  if (raw.includes("@")) {
    const byEmail = matchUsersByCompactEmail(users, raw);
    if (byEmail.length > 0) return dedupeUsers(byEmail);
  }

  const teamName = extractTeamNameFromPayer(raw);
  if (teamName) {
    const byTeam = matchUsersByTeamName(users, teamName);
    if (byTeam.length > 0) return dedupeUsers(byTeam);
  }

  const byName = matchUsersByCompactName(users, stripPlainName(raw));
  if (byName.length === 1) return byName;

  const generic = users.filter((user) => ticketPayerMatchesUser(raw, toProfile(user)));
  return dedupeUsers(generic);
}

function stripPlainName(raw: string) {
  return raw.replace(/^(agent|employe|equipe|équipe|client)\s*[-–—:]?\s*/i, "").trim();
}
