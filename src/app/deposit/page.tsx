import { AppShell } from "@/components/app-shell";
import { AirlineDepositAccountManager } from "@/components/airline-deposit-account-manager";
import { prisma } from "@/lib/prisma";
import { buildAirlineDepositAccountSummaries } from "@/lib/airline-deposit";
import { requirePageModuleAccess } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function DepositPage() {
  const { role } = await requirePageModuleAccess("payments", ["ADMIN", "DIRECTEUR_GENERAL", "ACCOUNTANT", "EMPLOYEE"]);

  const accounts = await buildAirlineDepositAccountSummaries(
    prisma as unknown as { airlineDepositMovement: { findMany: (args: unknown) => Promise<any[]> } },
  );

  return (
    <AppShell
      role={role}
      accessNote="Espace admin / DG / comptable dédié aux opérations de dépôt compagnies: approvisionnements, suivi des soldes et historique des mouvements."
    >
      <section className="mb-6">
        <h1 className="text-2xl font-semibold">Dépôts compagnies</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Centralisation des crédits, débits automatiques et suivi des comptes de dépôt des compagnies aériennes.
        </p>
      </section>

      <AirlineDepositAccountManager
        accounts={accounts}
        canManage={role === "ADMIN" || role === "DIRECTEUR_GENERAL" || role === "ACCOUNTANT"}
      />
    </AppShell>
  );
}
