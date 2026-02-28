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
    findBrandAsset(["logo thebest.png", "logo.png", "logo.jpg", "branding/logo.png", "branding/logo thebest.png"]),
    findBrandAsset(["signature.png", "signature.jpg", "branding/signature.png"]),
    findBrandAsset(["cachet.png", "cachet.jpg", "branding/cachet.png"]),
  ]);

  return (
    <main className="min-h-screen bg-white p-4 text-black print:bg-white print:p-0">
      <style>{`
        @font-face {
          font-family: 'Montserrat';
          src: url('/fonts/Montserrat-Regular.ttf') format('truetype');
          font-weight: 400;
          font-style: normal;
          font-display: swap;
        }
        @font-face {
          font-family: 'Montserrat';
          src: url('/fonts/Montserrat-Bold.ttf') format('truetype');
          font-weight: 700;
          font-style: normal;
          font-display: swap;
        }
        @media print {
          @page { size: A4; margin: 14mm; }
          .no-print { display: none !important; }
          .print-card { box-shadow: none !important; border-color: #ffffff !important; }
        }
        .print-card { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      `}</style>

      <div className="mx-auto w-full max-w-4xl bg-white px-8 py-6 print-card" style={{ fontFamily: "Montserrat, Arial, sans-serif" }}>

        <header className="border-b border-zinc-200 pb-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              {logoPath ? <Image src={logoPath} alt="Logo entreprise" width={120} height={48} className="h-12 w-auto" /> : null}
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-700">THEBEST SARL</p>
                <h1 className="mt-1 text-2xl font-semibold text-zinc-900">Rapport professionnel</h1>
                <p className="mt-1 text-sm text-zinc-600">Document officiel de suivi opérationnel</p>
              </div>
            </div>

            <div className="no-print">
              <PrintReportButton />
            </div>
          </div>
        </header>

        <section className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="p-3 text-sm">
            <p><span className="font-semibold">Titre:</span> {report.title}</p>
            <p><span className="font-semibold">Période:</span> {formatPeriodLabel(report.period)}</p>
            <p><span className="font-semibold">Début:</span> {new Date(report.periodStart).toLocaleDateString()}</p>
            <p><span className="font-semibold">Fin:</span> {new Date(report.periodEnd).toLocaleDateString()}</p>
          </div>
          <div className="p-3 text-sm">
            <p><span className="font-semibold">Employé:</span> {report.author.name}</p>
            <p><span className="font-semibold">Fonction:</span> {jobTitleLabel(report.author.jobTitle)}</p>
            <p><span className="font-semibold">Service:</span> {report.author.team?.name ?? "Service non défini"}</p>
            <p><span className="font-semibold">Statut:</span> {report.status}</p>
          </div>
        </section>

        <section className="relative mt-6 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-zinc-700">Contenu du rapport</h2>
          <div className="mt-3 space-y-2 text-sm leading-6 text-zinc-900">
            {lines.map((line, index) => (
              <p key={`${index}-${line.slice(0, 12)}`}>{line}</p>
            ))}
          </div>
        </section>

        <section className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="p-3 text-sm">
            <p className="font-semibold">Soumis le</p>
            <p>{report.submittedAt ? new Date(report.submittedAt).toLocaleString() : "Non soumis"}</p>
          </div>
          <div className="p-3 text-sm">
            <p className="font-semibold">Validation</p>
            <p>
              {report.reviewer ? `${report.reviewer.name} - ${report.approvedAt ? new Date(report.approvedAt).toLocaleString() : "En attente"}` : "En attente"}
            </p>
          </div>
        </section>

        <section className="mt-8 grid gap-6 border-t border-zinc-200 pt-6 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-700">Direction Générale</p>
            <p className="mt-1 text-sm text-zinc-900">Validation et visa officiel</p>
          </div>
          <div className="min-h-24 text-right">
            <div className="ml-auto flex w-full max-w-[450px] items-end justify-end gap-2">
              {stampPath ? <Image src={stampPath} alt="Cachet" width={110} height={110} className="h-[110px] w-[110px] opacity-95" /> : null}
              {signaturePath ? <Image src={signaturePath} alt="Signature" width={360} height={140} className="h-[140px] w-auto" /> : null}
            </div>
          </div>
        </section>

        <footer className="mt-8 border-t border-zinc-200 py-5 text-[11px] text-zinc-500">
          Document généré automatiquement par THEBEST SARL
        </footer>
      </div>
    </main>
  );
}
