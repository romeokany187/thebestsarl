import { AppShell } from "@/components/app-shell";
import { requirePageRoles } from "@/lib/rbac";

export const dynamic = "force-dynamic";

const settingBlocks = [
  {
    title: "Profil utilisateur",
    description: "Mettre à jour les informations personnelles, email et préférences de notification.",
  },
  {
    title: "Sécurité",
    description: "Préparer l'activation de l'authentification Google à double facteur (prochaine étape).",
  },
  {
    title: "Affichage",
    description: "Choisir la densité d'interface et les préférences d'affichage par module.",
  },
  {
    title: "Exports",
    description: "Configurer les formats d'export des rapports, ventes et indicateurs comptables.",
  },
];

export default async function SettingsPage() {
  const { role } = await requirePageRoles(["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);

  return (
    <AppShell role={role} accessNote="Paramètres compte: configuration utilisateur et préparation sécurité renforcée.">
      <section className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Paramètres</h1>
        <p className="text-sm text-black/60 dark:text-white/60">Configuration du compte, sécurité et préférences d&apos;interface.</p>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        {settingBlocks.map((block) => (
          <section key={block.title} className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
            <h2 className="text-lg font-semibold">{block.title}</h2>
            <p className="mt-2 text-sm text-black/65 dark:text-white/65">{block.description}</p>
            <button className="mt-4 rounded-lg border border-black/15 px-3 py-2 text-xs font-semibold hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10">
              Configurer
            </button>
          </section>
        ))}
      </div>
    </AppShell>
  );
}
