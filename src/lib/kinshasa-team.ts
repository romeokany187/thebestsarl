import { prisma } from "@/lib/prisma";
import { payerRecoveryKey } from "@/lib/ticket-recovery";

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

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

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

export function matchKinshasaUsersForPayer(
  payerLabel: string,
  kinshasaUsers: KinshasaWorkspaceUser[],
): KinshasaWorkspaceUser[] {
  const payerKey = payerRecoveryKey(payerLabel);
  if (payerKey === "__missing_payer__") {
    return [];
  }

  return kinshasaUsers.filter((user) => {
    const nameKey = payerRecoveryKey(user.name);
    const emailKey = normalize(user.email);
    return payerKey === nameKey || payerKey === emailKey;
  });
}
