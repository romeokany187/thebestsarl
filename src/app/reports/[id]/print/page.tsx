import { notFound } from "next/navigation";
import { requirePageRoles } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { PrintReportButton } from "@/components/print-report-button";
import { access } from "node:fs/promises";
import path from "node:path";
import Image from "next/image";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

async function findBrandAsset(candidates: string[]) {
  for (const candidate of candidates) {
    try {
      await access(path.join(process.cwd(), "public", candidate));
      return `/${candidate}`;
    } catch {
      continue;
    }
  }
  return null;
}

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
  const [logoPath, signaturePath, stampPath] = await Promise.all([
    findBrandAsset(["branding/logo.png", "branding/logo thebest.png", "logo thebest.png", "logo.png", "logo.jpg"]),
    findBrandAsset(["branding/signature.png", "signature.png", "signature.jpg"]),
    findBrandAsset(["branding/cachet.png", "cachet.png", "cachet.jpg"]),
  ]);

  return (
    <main className="min-h-screen bg-blue-50 p-4 text-black print:bg-white print:p-0">
      <style>{`
        @media print {
          @page { size: A4; margin: 14mm; }
          .no-print { display: none !important; }
          .print-card { box-shadow: none !important; border-color: #bfdbfe !important; }
        }
        .print-card { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      `}</style>

      <div className="mx-auto w-full max-w-4xl overflow-hidden rounded-2xl border border-blue-200 bg-white shadow-sm print-card">
        <div className="h-3 w-full bg-blue-700" />

        <header className="border-b border-blue-200 px-8 pb-6 pt-7">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              {logoPath ? <Image src={logoPath} alt="Logo entreprise" width={140} height={56} className="h-14 w-auto" /> : null}
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">THEBEST SARL</p>
                <h1 className="mt-2 text-2xl font-semibold text-blue-900">Rapport professionnel</h1>
                <p className="mt-1 text-sm text-blue-800/80">Document officiel de suivi opérationnel</p>
              </div>
            </div>

            <div className="no-print">
              <PrintReportButton />
            </div>
          </div>
        </header>

        <section className="mt-6 grid gap-4 px-8 sm:grid-cols-2">
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm">
            <p><span className="font-semibold">Titre:</span> {report.title}</p>
            <p><span className="font-semibold">Période:</span> {formatPeriodLabel(report.period)}</p>
            <p><span className="font-semibold">Début:</span> {new Date(report.periodStart).toLocaleDateString()}</p>
            <p><span className="font-semibold">Fin:</span> {new Date(report.periodEnd).toLocaleDateString()}</p>
          </div>
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm">
            <p><span className="font-semibold">Employé:</span> {report.author.name}</p>
            <p><span className="font-semibold">Fonction:</span> {jobTitleLabel(report.author.jobTitle)}</p>
            <p><span className="font-semibold">Service:</span> {report.author.team?.name ?? "Service non défini"}</p>
            <p><span className="font-semibold">Statut:</span> {report.status}</p>
          </div>
        </section>

        <section className="relative mt-6 rounded-lg border border-blue-200 p-4 mx-8">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-blue-700">Contenu du rapport</h2>
          <div className="mt-3 space-y-2 text-sm leading-6 text-blue-950/90">
            {lines.map((line, index) => (
              <p key={`${index}-${line.slice(0, 12)}`}>{line}</p>
            ))}
          </div>

          {stampPath ? (
            <Image
              src={stampPath}
              alt="Cachet officiel"
              width={96}
              height={96}
              className="pointer-events-none absolute bottom-6 right-6 h-24 w-24 opacity-90"
            />
          ) : null}
        </section>

        <section className="mt-6 grid gap-4 px-8 sm:grid-cols-2">
          <div className="rounded-lg border border-blue-200 bg-white p-3 text-sm">
            <p className="font-semibold">Soumis le</p>
            <p>{report.submittedAt ? new Date(report.submittedAt).toLocaleString() : "Non soumis"}</p>
          </div>
          <div className="rounded-lg border border-blue-200 bg-white p-3 text-sm">
            <p className="font-semibold">Validation</p>
            <p>
              {report.reviewer ? `${report.reviewer.name} - ${report.approvedAt ? new Date(report.approvedAt).toLocaleString() : "En attente"}` : "En attente"}
            </p>
          </div>
        </section>

        <section className="mt-8 grid gap-6 border-t border-blue-200 px-8 pt-6 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-700">Direction Générale</p>
            <p className="mt-1 text-sm text-blue-900">Validation et visa officiel</p>
          </div>
          <div className="relative min-h-24 text-right">
            {signaturePath ? <Image src={signaturePath} alt="Signature" width={180} height={48} className="ml-auto h-12 w-auto" /> : null}
            {stampPath ? <Image src={stampPath} alt="Cachet" width={80} height={80} className="absolute -bottom-1 right-10 h-20 w-20 opacity-90" /> : null}
          </div>
        </section>

        <footer className="mt-8 border-t border-blue-200 px-8 py-5 text-[11px] text-blue-800/80">
          Document généré automatiquement par THEBEST SARL • Modèle rapport officiel bleu et blanc
        </footer>
      </div>
    </main>
  );
}
