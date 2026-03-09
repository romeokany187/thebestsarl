"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type ReportSectionItem = {
  id: string;
  title: string;
  content: string;
  period: string;
  submittedAt: string | null;
  createdAt: string;
  authorName: string;
  authorJobTitle: string;
  service: string;
};

type ReportSection = {
  key: string;
  title: string;
  description: string;
  accentClass: string;
  reports: ReportSectionItem[];
};

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function folderIcon(accentClass: string) {
  return (
    <div className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border border-black/10 ${accentClass}`}>
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
      </svg>
    </div>
  );
}

function fileIcon() {
  return (
    <span className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-black/10 bg-black/5 dark:border-white/10 dark:bg-white/10">
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
        <path d="M14 3v5h5" />
      </svg>
    </span>
  );
}

export function AdminReportsSections({ sections }: { sections: ReportSection[] }) {
  const [activeSectionKey, setActiveSectionKey] = useState<string | null>(null);

  const activeSection = useMemo(
    () => sections.find((section) => section.key === activeSectionKey) ?? null,
    [sections, activeSectionKey],
  );

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
        <h2 className="text-base font-semibold">Rapports soumis par fonction</h2>
        <p className="mt-1 text-xs text-black/60 dark:text-white/60">
          Cliquez sur une section pour afficher tous les rapports soumis dans une fenetre detaillee.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sections.map((section) => (
          <article key={section.key} className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                {folderIcon(section.accentClass)}
                <div>
                  <h3 className="text-sm font-semibold">{section.title}</h3>
                  <p className="mt-0.5 text-[11px] text-black/60 dark:text-white/60">{section.description}</p>
                </div>
              </div>
              <span className="rounded-full border border-black/15 bg-black/5 px-2 py-0.5 text-[11px] font-semibold dark:border-white/15 dark:bg-white/10">
                {section.reports.length}
              </span>
            </div>

            <button
              type="button"
              onClick={() => setActiveSectionKey(section.key)}
              className="mt-4 w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-xs font-semibold hover:bg-black/5 dark:border-white/15 dark:bg-zinc-900 dark:hover:bg-white/10"
            >
              Ouvrir les rapports
            </button>
          </article>
        ))}
      </div>

      {activeSection ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6" role="dialog" aria-modal="true">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-white/15 bg-zinc-950 text-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-white/60">Section</p>
                <h3 className="text-lg font-semibold">{activeSection.title}</h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveSectionKey(null)}
                className="rounded-md border border-white/20 px-3 py-1.5 text-xs font-semibold hover:bg-white/10"
              >
                Fermer
              </button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto p-5">
              {activeSection.reports.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/20 px-4 py-5 text-sm text-white/70">
                  Aucun rapport soumis dans cette section.
                </div>
              ) : (
                <div className="space-y-3">
                  {activeSection.reports.map((report) => (
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
                        <div className="text-right text-[11px] text-white/65">
                          <p>Soumis: {formatDate(report.submittedAt)}</p>
                          <p>Creation: {formatDate(report.createdAt)}</p>
                        </div>
                      </div>

                      <p className="mt-3 line-clamp-3 text-sm text-white/85">{report.content}</p>

                      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                        <span className="rounded-full border border-white/20 px-2 py-1 text-[11px]">{report.period}</span>
                        <Link
                          href={`/reports/${report.id}/print`}
                          target="_blank"
                          className="rounded-md border border-white/20 px-3 py-1.5 text-xs font-semibold hover:bg-white/10"
                        >
                          Ouvrir / Imprimer
                        </Link>
                      </div>
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
