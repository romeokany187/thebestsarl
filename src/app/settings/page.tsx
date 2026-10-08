import { AppShell } from "@/components/app-shell";
import { SettingsWorkspace } from "@/components/settings-workspace";
import { prisma } from "@/lib/prisma";
import { requirePageModuleAccess } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { role, session } = await requirePageModuleAccess("settings", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, email: true },
  });

  return (
    <AppShell role={role}>
      <section className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Paramètres</h1>
      </section>

      <SettingsWorkspace
        role={role}
        initialName={user?.name ?? session.user.name ?? ""}
        initialEmail={user?.email ?? session.user.email ?? ""}
      />
    </AppShell>
  );
}
