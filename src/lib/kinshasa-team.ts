import { prisma } from "@/lib/prisma";
import { payerRecoveryKey } from "@/lib/ticket-recovery";
import {
  compactPayerLookupKey,
  extractAgentNameFromPayer,
  extractTeamNameFromPayer,
  stripPayerRolePrefix,
} from "@/lib/ticket-payer-user-match";
import {
  matchPayerToWorkspaceUsers,
  type PayerRecoveryTargetUser,
} from "@/lib/ticket-payer-recovery-targets";

export function isKinshasaTeamName(teamName: string | null | undefined) {
  return (teamName ?? "").trim().toLowerCase().includes("kinshasa");
}

/**
 * Payant = agence / équipe Kinshasa (ex. « Équipe - Kinshasa », « Agence de Kinshasa »),
 * pas un agent nommé « Agent - … ».
 */
export function isKinshasaAgencyPayer(payerLabel: string | null | undefined) {
  const raw = (payerLabel ?? "").trim();
  if (!raw) return false;

  // Un agent nommé reste ciblé individuellement.
  if (extractAgentNameFromPayer(raw)) return false;

  const teamName = extractTeamNameFromPayer(raw);
  if (teamName && isKinshasaTeamName(teamName)) return true;

  const compact = compactPayerLookupKey(stripPayerRolePrefix(raw));
  if (!compact) return false;

  return (
    compact.includes("kinshasa")
    || compact === "agencekinshasa"
    || compact.includes("agencedekinshasa")
    || compact.includes("bureaukinshasa")
  );
}

function toRecoveryTarget(user: KinshasaWorkspaceUser): PayerRecoveryTargetUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    teamName: user.teamName,
  };
}

export type KinshasaWorkspaceUser = {
  id: string;
  name: string;
  email: string;
  jobTitle: string | null;
  role: string;
  teamName: string | null;
};

/** Tous les comptes rattachés à une équipe Kinshasa (tous grades / rôles). */
export async function loadKinshasaWorkspaceUsers(): Promise<KinshasaWorkspaceUser[]> {
  const users = await prisma.user.findMany({
    where: {
      team: {
        name: { contains: "Kinshasa" },
      },
    },
    select: {
      id: true,
      name: true,
      email: true,
      jobTitle: true,
      role: true,
      team: { select: { name: true } },
    },
    orderBy: { name: "asc" },
  });

  return users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    jobTitle: user.jobTitle,
    role: user.role,
    teamName: user.team?.name ?? null,
  }));
}

export type KinshasaRecoveryResolution = {
  recipients: PayerRecoveryTargetUser[];
  /** Compte trouvé en base mais hors équipe Kinshasa (envoi recouvrement impossible). */
  matchedOutsideKinshasa: PayerRecoveryTargetUser[];
};

/**
 * Résout le payant vers le compte applicatif (id + e-mail), puis ne retient que l'équipe Kinshasa.
 * Si le payant est l'agence Kinshasa (pas un agent nommé) → ADMIN Kinshasa uniquement.
 */
export function resolveKinshasaRecoveryRecipients(
  payerLabel: string,
  kinshasaUsers: KinshasaWorkspaceUser[],
  workspaceUsers: PayerRecoveryTargetUser[],
): KinshasaRecoveryResolution {
  const payerKey = payerRecoveryKey(payerLabel);
  if (payerKey === "__missing_payer__") {
    return { recipients: [], matchedOutsideKinshasa: [] };
  }

  if (isKinshasaAgencyPayer(payerLabel)) {
    const admins = kinshasaUsers
      .filter((user) => user.role === "ADMIN")
      .map(toRecoveryTarget);
    return { recipients: admins, matchedOutsideKinshasa: [] };
  }

  const matched = matchPayerToWorkspaceUsers(payerLabel, workspaceUsers);
  const kinshasaIds = new Set(kinshasaUsers.map((user) => user.id));

  const recipients = matched.filter((user) => kinshasaIds.has(user.id));
  const matchedOutsideKinshasa = matched.filter((user) => !kinshasaIds.has(user.id));

  return { recipients, matchedOutsideKinshasa };
}
