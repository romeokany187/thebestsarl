import { AppShell } from "@/components/app-shell";
import { requirePageRoles } from "@/lib/rbac";

export const dynamic = "force-dynamic";

type ArchiveEntry = {
  id: string;
  type: "Lettre" | "Note interne" | "Ordre de mission";
  title: string;
  reference: string;
  department: string;
  date: string;
  status: "Validé" | "Brouillon" | "En révision";
};

const archiveEntries: ArchiveEntry[] = [
  {
    id: "ARC-001",
    type: "Lettre",
    title: "Lettre de partenariat – Compagnie Air Fast",
    reference: "LTR/2026/031",
    department: "Direction Générale",
    date: "2026-02-20",
    status: "Validé",
  },
  {
    id: "ARC-002",
    type: "Note interne",
    title: "Procédure de validation des paiements billets",
    reference: "NI/2026/014",
    department: "Finance",
    date: "2026-02-18",
    status: "Validé",
  },
  {
    id: "ARC-003",
    type: "Ordre de mission",
    title: "Mission aéroport – suivi opérations clients VIP",
    reference: "OM/2026/009",
    department: "Opérations",
    date: "2026-02-12",
    status: "En révision",
  },
  {
    id: "ARC-004",
    type: "Note interne",
    title: "Rappel règles de présence et pointage",
    reference: "NI/2026/011",
    department: "Ressources Humaines",
    date: "2026-02-03",
    status: "Validé",
  },
  {
    id: "ARC-005",
    type: "Lettre",
    title: "Lettre client – confirmation traitement dossier groupe",
    reference: "LTR/2026/022",
    department: "Service Commercial",
    date: "2026-01-28",
    status: "Brouillon",
  },
  {
    id: "ARC-006",
    type: "Ordre de mission",
    title: "Mission terrain – audit qualité réseau partenaire",
    reference: "OM/2026/006",
    department: "Contrôle Qualité",
    date: "2026-01-21",
    status: "Validé",
  },
];

function statusClassName(status: ArchiveEntry["status"]) {
  if (status === "Validé") {
    return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  if (status === "En révision") {
    return "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  }
  return "border-black/15 bg-black/5 text-black/70 dark:border-white/20 dark:bg-white/10 dark:text-white/70";
}

export default async function ArchivesPage() {
  const { role } = await requirePageRoles(["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);

  return (
    <AppShell
      role={role}
      accessNote="Archives d'entreprise: lettres, notes internes et ordres de mission centralisés pour consultation rapide."
    >
      <section className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Archives</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Répertoire des documents administratifs et opérationnels de l&apos;entreprise.
        </p>
      </section>

      <section className="mb-5 grid gap-4 sm:grid-cols-3">
        <article className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <p className="text-xs text-black/60 dark:text-white/60">Total documents</p>
          <p className="mt-1 text-2xl font-semibold">{archiveEntries.length}</p>
        </article>
        <article className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <p className="text-xs text-black/60 dark:text-white/60">Lettres & notes internes</p>
          <p className="mt-1 text-2xl font-semibold">
            {archiveEntries.filter((entry) => entry.type !== "Ordre de mission").length}
          </p>
        </article>
        <article className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <p className="text-xs text-black/60 dark:text-white/60">Ordres de mission</p>
          <p className="mt-1 text-2xl font-semibold">
            {archiveEntries.filter((entry) => entry.type === "Ordre de mission").length}
          </p>
        </article>
      </section>

      <section className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <div className="border-b border-black/10 px-4 py-3 dark:border-white/10">
          <h2 className="text-base font-semibold">Registre des archives</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-black/5 dark:bg-white/10">
              <tr>
                <th className="px-3 py-2 text-left">Référence</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Document</th>
                <th className="px-3 py-2 text-left">Service</th>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Statut</th>
              </tr>
            </thead>
            <tbody>
              {archiveEntries.map((entry) => (
                <tr key={entry.id} className="border-t border-black/5 dark:border-white/10">
                  <td className="px-3 py-2 font-medium">{entry.reference}</td>
                  <td className="px-3 py-2">{entry.type}</td>
                  <td className="px-3 py-2">{entry.title}</td>
                  <td className="px-3 py-2">{entry.department}</td>
                  <td className="px-3 py-2">{new Date(entry.date).toLocaleDateString("fr-FR")}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${statusClassName(entry.status)}`}>
                      {entry.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
