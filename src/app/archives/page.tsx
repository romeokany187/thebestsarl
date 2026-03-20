import { AppShell } from "@/components/app-shell";
import Link from "next/link";
import { ArchiveFolder } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  archiveFolderLabel,
  canWriteArchiveFolder,
  getAccessibleArchiveFolders,
  normalizeLegacyArchiveReferences,
  parseArchiveFolder,
  syncSystemArchiveDocuments,
} from "@/lib/archive";
import { requirePageModuleAccess } from "@/lib/rbac";

export const dynamic = "force-dynamic";

type SearchParams = {
  folder?: string;
  uploaded?: string;
  deleted?: string;
  deleteError?: string;
};

function fileTypeLabel(mimeType: string) {
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType.startsWith("image/")) return "Image";
  return "Fichier";
}

function sizeLabel(bytes: number) {
  if (!bytes || bytes <= 0) return "-";
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

export default async function ArchivesPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const { role, session } = await requirePageModuleAccess("archives", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  const resolvedSearchParams = (await searchParams) ?? {};
  const accessibleFolders = getAccessibleArchiveFolders(role, session.user.jobTitle ?? null);
  const fallbackFolder = accessibleFolders[0]?.key ?? "NOTES_LETTRES_INTERNES";
  const requestedFolder = parseArchiveFolder(resolvedSearchParams.folder);
  const selectedFolder = requestedFolder && accessibleFolders.some((folder) => folder.key === requestedFolder)
    ? requestedFolder
    : fallbackFolder;
  const canArchiveWrite = canWriteArchiveFolder(role, session.user.jobTitle ?? null, selectedFolder);

  await normalizeLegacyArchiveReferences(prisma);
  await syncSystemArchiveDocuments(prisma);

  const [documents, groupedCounts] = await Promise.all([
    prisma.archiveDocument.findMany({
      where: { folder: selectedFolder },
      orderBy: { createdAt: "desc" },
      take: 300,
      select: {
        id: true,
        reference: true,
        title: true,
        originalFileName: true,
        mimeType: true,
        fileSize: true,
        externalUrl: true,
        origin: true,
        createdAt: true,
      },
    }),
    prisma.archiveDocument.groupBy({
      by: ["folder"],
      where: {
        folder: { in: accessibleFolders.map((folder) => folder.key) },
      },
      _count: { _all: true },
    }),
  ]);

  const folderCountMap = new Map<ArchiveFolder, number>(
    groupedCounts.map((item) => [item.folder, item._count._all]),
  );

  const totalDocuments = groupedCounts.reduce((sum, item) => sum + item._count._all, 0);

  return (
    <AppShell
      role={role}
      accessNote={canArchiveWrite
        ? "Archives: lecture et archivage autorisés selon les catégories accessibles à votre profil."
        : "Mode lecture: consultation et export PDF limités aux catégories accessibles à votre profil."}
    >
      <section className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Archives</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Gestion type explorateur de fichiers: choisissez un dossier, ajoutez des documents et consultez l&apos;historique référencé.
        </p>
      </section>

      <section className="mb-5 grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <article className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <p className="text-xs text-black/60 dark:text-white/60">Total documents</p>
          <p className="mt-1 text-2xl font-semibold">{totalDocuments}</p>
        </article>
        <article className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <p className="text-xs text-black/60 dark:text-white/60">Dossier actif</p>
          <p className="mt-1 text-sm font-semibold">{archiveFolderLabel(selectedFolder)}</p>
        </article>
        <article className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <p className="text-xs text-black/60 dark:text-white/60">Documents dossier actif</p>
          <p className="mt-1 text-2xl font-semibold">{documents.length}</p>
        </article>
        <article className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <p className="text-xs text-black/60 dark:text-white/60">Référencement</p>
          <p className="mt-1 text-sm font-semibold">Automatique global</p>
        </article>
      </section>

      <section className="mb-6 rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <h2 className="mb-3 text-base font-semibold">Classeur de dossiers</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {accessibleFolders.map((folder) => {
            const isActive = folder.key === selectedFolder;
            const count = folderCountMap.get(folder.key) ?? 0;

            return (
              <Link
                key={folder.key}
                href={`/archives?folder=${folder.key}`}
                className={`rounded-xl border p-4 transition ${
                  isActive
                    ? "border-black/40 bg-black/5 dark:border-white/40 dark:bg-white/10"
                    : "border-black/10 hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
                }`}
              >
                <p className="text-lg">📁</p>
                <p className="mt-1 text-sm font-semibold">{folder.label}</p>
                <p className="mt-1 text-xs text-black/60 dark:text-white/60">{folder.description}</p>
                <p className="mt-2 text-xs font-semibold text-black/70 dark:text-white/70">{count} document(s)</p>
              </Link>
            );
          })}
        </div>
      </section>

      {canArchiveWrite ? (
        <section className="mb-6 rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <h2 className="mb-3 text-base font-semibold">Ajouter un document dans {archiveFolderLabel(selectedFolder)}</h2>
          <form action="/api/archives/upload" method="POST" encType="multipart/form-data" className="grid gap-3 sm:grid-cols-[1fr,1fr,auto] sm:items-end">
            <input type="hidden" name="folder" value={selectedFolder} />
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Titre document</label>
              <input name="title" required minLength={3} className="w-full rounded-md border px-3 py-2 text-sm" placeholder="Ex: Déclaration DGI Février" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Fichier (PDF/Image)</label>
              <input name="file" type="file" required accept="application/pdf,image/png,image/jpeg,image/webp,image/gif" className="w-full rounded-md border px-3 py-2 text-sm" />
            </div>
            <button className="rounded-md bg-black px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black">Archiver</button>
          </form>
          {resolvedSearchParams.uploaded === "1" ? (
            <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              Document archivé avec succès.
            </p>
          ) : null}
          {resolvedSearchParams.deleted === "1" ? (
            <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              Document supprimé avec succès.
            </p>
          ) : null}
          {resolvedSearchParams.deleteError === "1" ? (
            <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
              Suppression impossible (document introuvable ou document système protégé).
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="mb-6 rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <h2 className="mb-3 text-base font-semibold">Tirer le rapport PDF des archives</h2>
        <form method="GET" action="/api/archives/report" target="_blank" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Mode</label>
            <select name="mode" defaultValue="month" className="w-full rounded-md border px-3 py-2 text-sm">
              <option value="date">Journalier</option>
              <option value="week">Hebdomadaire</option>
              <option value="month">Mensuel</option>
              <option value="year">Annuel</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Date (jour/semaine)</label>
            <input type="date" name="date" className="w-full rounded-md border px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Mois</label>
            <input type="month" name="month" className="w-full rounded-md border px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Année</label>
            <input type="number" name="year" min={2000} max={2100} className="w-full rounded-md border px-3 py-2 text-sm" placeholder="2026" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Catégorie</label>
            <select name="folder" defaultValue={selectedFolder} className="w-full rounded-md border px-3 py-2 text-sm">
              <option value="">Toutes</option>
              {accessibleFolders.map((folder) => (
                <option key={folder.key} value={folder.key}>{folder.label}</option>
              ))}
            </select>
          </div>
          <button className="rounded-md bg-black px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black">
            Générer PDF
          </button>
        </form>
      </section>

      <section className="mb-6 rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <h2 className="mb-3 text-base font-semibold">Voir le répertoire Archives en PDF</h2>
        <ul className="space-y-2 text-sm text-black/70 dark:text-white/70">
          <li>1. Choisissez le <span className="font-semibold">mode</span>: Journalier, Hebdomadaire, Mensuel ou Annuel.</li>
          <li>2. Sélectionnez la <span className="font-semibold">date</span> correspondant au mode choisi.</li>
          <li>3. Filtrez la <span className="font-semibold">catégorie</span> (dossier) ou laissez &ldquo;Toutes&rdquo;.</li>
          <li>4. Cliquez sur <span className="font-semibold">Générer PDF</span> pour obtenir le registre des documents archivés.</li>
        </ul>
      </section>

      <section className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <div className="border-b border-black/10 px-4 py-3 dark:border-white/10">
          <h2 className="text-base font-semibold">Registre des archives - {archiveFolderLabel(selectedFolder)}</h2>
        </div>
        <div className="h-105 overflow-auto overscroll-contain">
          <table className="min-w-full text-sm">
            <thead className="bg-black/5 dark:bg-white/10">
              <tr>
                <th className="px-3 py-2 text-left">Référence</th>
                <th className="px-3 py-2 text-left">Document</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Origine</th>
                <th className="px-3 py-2 text-left">Taille</th>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {documents.length > 0 ? documents.map((entry) => (
                <tr key={entry.id} className="border-t border-black/5 dark:border-white/10">
                  <td className="px-3 py-2 font-medium">{entry.reference}</td>
                  <td className="px-3 py-2">{entry.title}</td>
                  <td className="px-3 py-2">{fileTypeLabel(entry.mimeType)}</td>
                  <td className="px-3 py-2">
                    <span className="rounded-full border border-black/15 bg-black/5 px-2 py-1 text-[11px] font-semibold dark:border-white/20 dark:bg-white/10">
                      {entry.origin === "SYSTEM" ? "Système" : "Upload manuel"}
                    </span>
                  </td>
                  <td className="px-3 py-2">{sizeLabel(entry.fileSize)}</td>
                  <td className="px-3 py-2">{new Date(entry.createdAt).toLocaleString("fr-FR")}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <a
                        href={entry.externalUrl ?? `/api/archives/files/${entry.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-md border border-black/15 px-2.5 py-1 text-xs font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                      >
                        Ouvrir
                      </a>
                      {canArchiveWrite && entry.origin !== "SYSTEM" ? (
                        <form action="/api/archives/delete" method="POST">
                          <input type="hidden" name="id" value={entry.id} />
                          <input type="hidden" name="folder" value={selectedFolder} />
                          <button className="rounded-md border border-red-300 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40">
                            Supprimer
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </td>
                </tr>
              )) : (
                <tr className="border-t border-black/5 dark:border-white/10">
                  <td className="px-3 py-6 text-sm text-black/60 dark:text-white/60" colSpan={7}>
                    Aucun document dans ce dossier pour le moment.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
