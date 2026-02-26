import { AppShell } from "@/components/app-shell";
import { ApprovalForm } from "@/components/approval-form";
import { ReportsForm } from "@/components/reports-form";
import { prisma } from "@/lib/prisma";
import { requirePageRoles } from "@/lib/rbac";
import Link from "next/link";

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

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const { session, role } = await requirePageRoles(["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);

  const [users, reports] = await Promise.all([
    prisma.user.findMany({
      include: { team: true },
      orderBy: { name: "asc" },
    }),
    prisma.workerReport.findMany({
      include: {
        author: { select: { name: true, jobTitle: true, team: { select: { name: true } } } },
        reviewer: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);

  const managers = users.filter((user) => user.role === "MANAGER" || user.role === "ADMIN");
  const authorOptions = role === "EMPLOYEE" ? users.filter((user) => user.id === session.user.id) : users;
  const canCreateReport = role === "ADMIN" || role === "MANAGER" || role === "EMPLOYEE";
  const canApproveReport = role === "ADMIN" || role === "MANAGER";
  const accessNote = canApproveReport
    ? "Accès validation: vous pouvez créer et approuver les rapports."
    : canCreateReport
      ? "Accès contribution: vous pouvez créer vos rapports et suivre leur statut."
      : "Accès lecture seule: consultation des rapports uniquement.";

  return (
    <AppShell role={role} accessNote={accessNote}>
      <section className="mb-6">
        <h1 className="text-2xl font-semibold">Rapports de travail</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Journalier, hebdomadaire, mensuel et annuel avec workflow de validation.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-[380px,1fr]">
        {canCreateReport ? (
          <ReportsForm
            users={authorOptions.map((user) => ({
              id: user.id,
              name: user.name,
              role: jobTitleLabel(user.jobTitle),
              jobTitle: user.jobTitle,
              service: user.team?.name ?? "Service non défini",
            }))}
          />
        ) : (
          <section className="rounded-xl border border-black/10 bg-white p-4 text-sm text-black/70 dark:border-white/10 dark:bg-zinc-900 dark:text-white/70">
            Accès en lecture seule: vous pouvez consulter les rapports mais pas en créer.
          </section>
        )}

        <div className="space-y-3">
          {reports.map((report) => (
            <article key={report.id} className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-semibold">{report.title}</h3>
                <span className="rounded-full bg-black/5 px-2 py-1 text-xs dark:bg-white/10">{report.status}</span>
              </div>
              <p className="mt-2 text-sm text-black/80 dark:text-white/80">{report.content}</p>
              <p className="mt-2 text-xs text-black/60 dark:text-white/60">
                Auteur: {report.author.name} • Fonction: {jobTitleLabel(report.author.jobTitle)} • Service: {report.author.team?.name ?? "-"} • Période: {report.period}
              </p>
              <div className="mt-2">
                <Link
                  href={`/reports/${report.id}/print`}
                  target="_blank"
                  className="text-xs font-semibold text-black/70 underline underline-offset-2 dark:text-white/70"
                >
                  Version imprimable PDF
                </Link>
              </div>
              {canApproveReport ? (
                <ApprovalForm reportId={report.id} managers={managers.map((manager) => ({ id: manager.id, name: manager.name }))} />
              ) : null}
            </article>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
