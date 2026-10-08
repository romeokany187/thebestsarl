import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { WorkflowStatusBoard } from "@/components/workflow-status-board";
import { canAccessApprovalPage, getApprovalWorkflowData } from "@/lib/inbox-workflow";
import { requirePageModuleAccess } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function InboxValidatePage() {
  const { role } = await requirePageModuleAccess("profile", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);

  if (!canAccessApprovalPage(role)) {
    redirect("/inbox");
  }

  const { paymentOrders, needs } = await getApprovalWorkflowData(role);

  return (
    <AppShell
      role={role}
    >
      <section className="mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">OP & EDB à approuver</h1>
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