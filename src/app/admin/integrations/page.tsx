import { AppShell } from "@/components/app-shell";
import { IntegrationAdmin } from "@/components/integration-admin";
import { requirePageModuleAccess } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function AdminIntegrationsPage() {
  const { role } = await requirePageModuleAccess("admin", ["ADMIN"]);

  return (
    <AppShell role={role}>
      <section className="mb-6">
        <h1 className="text-2xl font-semibold">Connexion externe</h1>
        <p className="mt-1 max-w-3xl text-sm text-black/60 dark:text-white/60">
          Prépare l&apos;échange avec une autre application. Elle s&apos;authentifie avec une clé, envoie des événements, et peut recevoir les nôtres par webhook. Les données précises seront branchées plus tard.
        </p>
      </section>
      <IntegrationAdmin />
    </AppShell>
  );
}
