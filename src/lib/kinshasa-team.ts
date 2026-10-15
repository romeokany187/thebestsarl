import { prisma } from "@/lib/prisma";
import { payerRecoveryKey } from "@/lib/ticket-recovery";
import {
  matchPayerToWorkspaceUsers,
  type PayerRecoveryTargetUser,
} from "@/lib/ticket-payer-recovery-targets";

export function isKinshasaTeamName(teamName: string | null | undefined) {
  return (teamName ?? "").trim().toLowerCase().includes("kinshasa");
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

  const matched = matchPayerToWorkspaceUsers(payerLabel, workspaceUsers);
  const kinshasaIds = new Set(kinshasaUsers.map((user) => user.id));

  const recipients = matched.filter((user) => kinshasaIds.has(user.id));
  const matchedOutsideKinshasa = matched.filter((user) => !kinshasaIds.has(user.id));

  return { recipients, matchedOutsideKinshasa };
}
