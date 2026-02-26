import { notFound } from "next/navigation";
import { requirePageRoles } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { PrintReportButton } from "@/components/print-report-button";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

function formatPeriodLabel(period: string) {
  if (period === "DAILY") return "Journalier";
  if (period === "WEEKLY") return "Hebdomadaire";
  if (period === "MONTHLY") return "Mensuel";
  if (period === "ANNUAL") return "Annuel";
  return period;
}

function jobTitleLabel(jobTitle: string) {
  const labels: Record<string, string> = {
    COMMERCIAL: "Commercial",
    COMPTABLE: "Comptable",
    CAISSIERE: "Caissière",
    RELATION_PUBLIQUE: "Relation publique",
    APPROVISIONNEMENT_MARKETING: "Chargé des approvisionnements marketing",
    AGENT_TERRAIN: "Agent de terrain",
    DIRECTION_GENERALE: "Direction générale",
  };

  return labels[jobTitle] ?? jobTitle;
}

function renderContentParagraphs(content: string) {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export default async function ReportPrintPage({ params }: PageProps) {
  const { session, role } = await requirePageRoles(["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  const { id } = await params;

  const report = await prisma.workerReport.findUnique({
    where: { id },
    include: {
      author: {
        include: { team: true },
      },
      reviewer: true,
    },
  });

  if (!report) {
    notFound();
  }

  if (role === "EMPLOYEE" && report.authorId !== session.user.id) {
    notFound();
  }

  const lines = renderContentParagraphs(report.content);

  return (
    <main className="min-h-screen bg-zinc-100 p-4 text-black print:bg-white print:p-0">
      <style>{`
        @media print {
          @page { size: A4; margin: 14mm; }
          .no-print { display: none !important; }
          .print-card { box-shadow: none !important; border-color: #d4d4d8 !important; }
        }
      `}</style>

      <div className="mx-auto w-full max-w-4xl rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm print-card">
        <header className="border-b border-zinc-200 pb-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">THEBEST SARL</p>
              <h1 className="mt-2 text-2xl font-semibold">Rapport professionnel</h1>
              <p className="mt-1 text-sm text-zinc-600">Document officiel de suivi opérationnel</p>
            </div>
            <PrintReportButton />
          </div>
        </header>

        <section className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-zinc-200 p-3 text-sm">
            <p><span className="font-semibold">Titre:</span> {report.title}</p>
            <p><span className="font-semibold">Période:</span> {formatPeriodLabel(report.period)}</p>
            <p><span className="font-semibold">Début:</span> {new Date(report.periodStart).toLocaleDateString()}</p>
            <p><span className="font-semibold">Fin:</span> {new Date(report.periodEnd).toLocaleDateString()}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 p-3 text-sm">
            <p><span className="font-semibold">Employé:</span> {report.author.name}</p>
            <p><span className="font-semibold">Fonction:</span> {jobTitleLabel(report.author.jobTitle)}</p>
            <p><span className="font-semibold">Service:</span> {report.author.team?.name ?? "Service non défini"}</p>
            <p><span className="font-semibold">Statut:</span> {report.status}</p>
          </div>
        </section>

        <section className="mt-6 rounded-lg border border-zinc-200 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-zinc-600">Contenu du rapport</h2>
          <div className="mt-3 space-y-2 text-sm leading-6 text-zinc-800">
            {lines.map((line, index) => (
              <p key={`${index}-${line.slice(0, 12)}`}>{line}</p>
            ))}
          </div>
        </section>

        <section className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-zinc-200 p-3 text-sm">
            <p className="font-semibold">Soumis le</p>
            <p>{report.submittedAt ? new Date(report.submittedAt).toLocaleString() : "Non soumis"}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 p-3 text-sm">
            <p className="font-semibold">Validation</p>
            <p>
              {report.reviewer ? `${report.reviewer.name} - ${report.approvedAt ? new Date(report.approvedAt).toLocaleString() : "En attente"}` : "En attente"}
            </p>
          </div>
        </section>

        <footer className="mt-10 border-t border-zinc-200 pt-5 text-[11px] text-zinc-500">
          Document généré automatiquement par THEBEST SARL • Version imprimable conforme PDF
        </footer>
      </div>
    </main>
  );
}
