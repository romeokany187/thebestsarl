import { AppShell } from "@/components/app-shell";
import { RapportPeriodiqueContent } from "@/components/rapport-periodique-content";
import { requirePageModuleAccess } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function RapportPeriodiquePage() {
  const { role } = await requirePageModuleAccess("admin", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "ACCOUNTANT"]);

  return (
    <AppShell
      role={role}
      accessNote="Rapport périodique: tous les OP et EDB émis dans une plage de dates, tous statuts confondus."
    >
      <RapportPeriodiqueContent />
    </AppShell>
  );
}
