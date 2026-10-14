import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/auth";
import { isPasswordAuthActive } from "@/lib/auth-rollout";
import {
  loadAgentMonthlyPayantPerformance,
  shouldShowPerformanceSplashForRole,
} from "@/lib/agent-monthly-performance";
import { resolvePostLoginPath } from "@/lib/workspace-home";
import { prisma } from "@/lib/prisma";
import { AgentPerformanceSplash } from "@/components/agent-performance-splash";

export const dynamic = "force-dynamic";

export default async function PostLoginPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect("/auth/signin");
  }

  const email = session.user.email.trim().toLowerCase();
  const dbUser = await prisma.user.findUnique({
    where: { email },
    select: {
      name: true,
      role: true,
      passwordHash: true,
    },
  });

  if (!dbUser) {
    redirect("/auth/signin");
  }

  if (isPasswordAuthActive() && !dbUser.passwordHash?.trim()) {
    redirect(`/auth/signin?setup=required&email=${encodeURIComponent(email)}`);
  }

  const enabledForRole = shouldShowPerformanceSplashForRole(dbUser.role);
  const redirectPath = resolvePostLoginPath();
  const displayName = dbUser.name?.trim() || session.user.name?.trim() || "Agent";

  const stats = enabledForRole
    ? await loadAgentMonthlyPayantPerformance({ name: displayName, email })
    : {
        monthKey: "",
        monthLabel: "",
        totalTickets: 0,
        paidCount: 0,
        unpaidCount: 0,
        partialCount: 0,
        openCount: 0,
        tier: "low" as const,
      };

  return (
    <AgentPerformanceSplash
      stats={stats}
      redirectPath={redirectPath}
      enabledForRole={enabledForRole}
      userName={displayName}
    />
  );
}
