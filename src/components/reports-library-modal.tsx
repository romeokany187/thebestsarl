"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ApprovalForm } from "@/components/approval-form";

type ReportStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";

type ReportItem = {
  id: string;
  title: string;
  content: string;
  period: string;
  status: ReportStatus;
  authorName: string;
  authorJobTitle: string;
  service: string;
  createdAt: string;
  submittedAt: string | null;
};

type ManagerOption = { id: string; name: string };

function periodLabel(period: string) {
  if (period === "DAILY") return "Journalier";
  if (period === "WEEKLY") return "Hebdomadaire";
  if (period === "MONTHLY") return "Mensuel";
  if (period === "SEMESTER") return "Semestriel";
  if (period === "ANNUAL") return "Annuel";
  return period;
}

function statusLabel(status: ReportStatus) {
  if (status === "DRAFT") return "Brouillons";
  if (status === "SUBMITTED") return "Soumis";
  if (status === "APPROVED") return "Approuves";
  return "Rejetes";
}

function statusBadgeClass(status: ReportStatus) {
  if (status === "DRAFT") return "border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200";
  if (status === "SUBMITTED") return "border-blue-300 bg-blue-100 text-blue-700 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-200";
  if (status === "APPROVED") return "border-emerald-300 bg-emerald-100 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200";
  return "border-rose-300 bg-rose-100 text-rose-700 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200";
}

function fileIcon() {
  return (
    <span className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/15 bg-white/5">
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
        <path d="M14 3v5h5" />
      </svg>
    </span>
  );
}

const statusOrder: ReportStatus[] = ["SUBMITTED", "APPROVED", "DRAFT", "REJECTED"];

export function ReportsLibraryModal({
  reports,
  managers,
  canApprove,
}: {
  reports: ReportItem[];
  managers: ManagerOption[];
  canApprove: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [activeStatus, setActiveStatus] = useState<ReportStatus>("SUBMITTED");

  const grouped = useMemo(() => {
    const init: Record<ReportStatus, ReportItem[]> = {
      DRAFT: [],
      SUBMITTED: [],
      APPROVED: [],
      REJECTED: [],
    };
    reports.forEach((report) => {
      init[report.status].push(report);
    });
    return init;
  }, [reports]);

  const activeReports = grouped[activeStatus] ?? [];

  return (
    <section className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Bibliotheque des rapports</h3>
          <p className="mt-1 text-xs text-black/60 dark:text-white/60">
            Acces rapide a vos rapports classes par statut dans une fenetre modale.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-lg border border-black/15 px-3 py-2 text-xs font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
        >
          Ouvrir la bibliotheque
        </button>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        {statusOrder.map((status) => (
          <div key={status} className={`rounded-lg border px-2.5 py-2 text-center text-[11px] font-semibold ${statusBadgeClass(status)}`}>
            {statusLabel(status)}: {grouped[status].length}
          </div>
        ))}
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4 py-6" role="dialog" aria-modal="true">
          <div className="max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-2xl border border-white/15 bg-zinc-950 text-white shadow-2xl">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-white/3 px-5 py-4">
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-white/60">Rapports</p>
                <h3 className="text-lg font-semibold">Bibliotheque par statut</h3>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-white/20 px-3 py-1.5 text-xs font-semibold hover:bg-white/10"
              >
                Fermer
              </button>
            </div>

            <div className="border-b border-white/10 px-5 py-3">
              <div className="flex flex-wrap gap-2">
                {statusOrder.map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setActiveStatus(status)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${activeStatus === status ? "border-white/40 bg-white/15" : "border-white/20 bg-transparent hover:bg-white/10"}`}
                  >
                    {statusLabel(status)} ({grouped[status].length})
                  </button>
                ))}
              </div>
            </div>

            <div className="max-h-[70vh] overflow-y-auto p-5">
              {activeReports.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/20 px-4 py-5 text-sm text-white/70">
                  Aucun rapport dans cette categorie.
                </div>
              ) : (
                <div className="space-y-3">
                  {activeReports.map((report) => (
                    <article key={report.id} className="rounded-xl border border-white/15 bg-white/5 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          {fileIcon()}
                          <div>
                            <h4 className="text-sm font-semibold">{report.title}</h4>
                            <p className="mt-0.5 text-[11px] text-white/65">
                              {report.authorName} • {report.authorJobTitle} • {report.service}
                            </p>
                          </div>
                        </div>
                        <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${statusBadgeClass(report.status)}`}>
                          {report.status}
                        </span>
                      </div>

                      <p className="mt-3 line-clamp-3 text-sm text-white/85">{report.content}</p>

                      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[11px] text-white/65">
                        <p>Periode: {periodLabel(report.period)}</p>
                        <p>Creation: {new Date(report.createdAt).toLocaleString()}</p>
                        <p>Soumission: {report.submittedAt ? new Date(report.submittedAt).toLocaleString() : "-"}</p>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                        <Link
                          href={`/reports/${report.id}/print`}
                          target="_blank"
                          className="rounded-md border border-white/20 px-3 py-1.5 text-xs font-semibold hover:bg-white/10"
                        >
                          Ouvrir / Imprimer
                        </Link>
                      </div>

                      {canApprove && report.status === "SUBMITTED" ? (
                        <ApprovalForm reportId={report.id} managers={managers} />
                      ) : null}
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
