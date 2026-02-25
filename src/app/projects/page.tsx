import { AppShell } from "@/components/app-shell";
import { requirePageRoles } from "@/lib/rbac";

export const dynamic = "force-dynamic";

const columns = [
  {
    title: "À planifier",
    cards: [
      "Campagne saison été (Air France)",
      "Formation process reporting équipe ventes",
    ],
  },
  {
    title: "En cours",
    cards: [
      "Suivi recouvrement billets partiels",
      "Audit qualité rapport hebdomadaire",
      "Optimisation commissions compagnies",
    ],
  },
  {
    title: "En revue",
    cards: [
      "Validation tableau de bord direction",
      "Mise à jour politique présences",
    ],
  },
  {
    title: "Terminé",
    cards: [
      "Migration base client 2026",
      "Template rapport journalier v2",
    ],
  },
];

export default async function ProjectsPage() {
  const { role } = await requirePageRoles(["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);

  return (
    <AppShell
      role={role}
      accessNote="Espace projet: visualisation des initiatives opérationnelles dans un flux de travail collaboratif."
    >
      <section className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Projets</h1>
        <p className="text-sm text-black/60 dark:text-white/60">Vue type board pour organiser les actions de l&apos;agence.</p>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {columns.map((column) => (
          <section key={column.title} className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">{column.title}</h2>
            <div className="space-y-3">
              {column.cards.map((card) => (
                <article key={card} className="rounded-xl border border-black/10 bg-background px-3 py-3 text-sm font-medium dark:border-white/10">
                  {card}
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </AppShell>
  );
}
