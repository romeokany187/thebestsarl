import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { WorkflowStatusBoard } from "@/components/workflow-status-board";
import { canAccessExecutionPage, getExecutionWorkflowData } from "@/lib/inbox-workflow";
import { requirePageModuleAccess } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function InboxExecutePage() {
  const { role, session } = await requirePageModuleAccess("profile", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  const currentJobTitle = session.user.jobTitle ?? "AGENT_TERRAIN";

  if (!canAccessExecutionPage(currentJobTitle, role)) {
    redirect("/inbox");
  }

  const { paymentOrders, needs } = await getExecutionWorkflowData(currentJobTitle, role);

  return (
    <AppShell
      role={role}
      accessNote="Route dédiée aux OP / EDB à exécuter pour l’admin, le comptable et le caissier autorisés."
    >
      <section className="mb-6 space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
          <Link href="/inbox" className="rounded-full border border-black/15 px-3 py-1 dark:border-white/20">Notifications</Link>
          <Link href="/inbox/validate" className="rounded-full border border-black/15 px-3 py-1 dark:border-white/20">À approuver</Link>
          <span className="rounded-full border border-black bg-black px-3 py-1 text-white dark:border-white dark:bg-white dark:text-black">À exécuter</span>
          <Link href="/inbox/history" className="rounded-full border border-black/15 px-3 py-1 dark:border-white/20">Historique</Link>
        </div>

        <div>
          <h1 className="text-2xl font-semibold tracking-tight">OP & EDB à exécuter</h1>
          <p className="text-sm text-black/60 dark:text-white/60">
            Espace réservé aux profils autorisés pour les exécutions. Un clic sur la notification ouvre directement le bon dossier dans cette section.
          </p>
        </div>
      </section>

      <WorkflowStatusBoard
        mode="execute"
        paymentOrders={paymentOrders}
        needs={needs}
      />
    </AppShell>
  );
}