import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { WorkflowStatusBoard } from "@/components/workflow-status-board";
import { canAccessApprovalPage, getApprovalWorkflowData } from "@/lib/inbox-workflow";
import { requirePageModuleAccess } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function AdminApprovalsPage() {
  const { role } = await requirePageModuleAccess("admin", ["ADMIN", "DIRECTEUR_GENERAL"]);

  if (!canAccessApprovalPage(role)) {
    redirect("/inbox");
  }

  const { paymentOrders, needs } = await getApprovalWorkflowData(role);

  return (
    <AppShell
      role={role}
      accessNote="Route dédiée à l'admin / DG pour approuver les OP et EDB en attente."
    >
      <section className="mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Validation OP & EDB</h1>
          <p className="text-sm text-black/60 dark:text-white/60">
            Espace admin dédié aux dossiers à approuver. Les notifications vous amènent directement sur la bonne ligne.
          </p>
        </div>
      </section>

      <WorkflowStatusBoard
        mode="validate"
        paymentOrders={paymentOrders}
        needs={needs}
      />
    </AppShell>
  );
}
