"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type BidStatus = "IN_PROGRESS" | "SUBMITTED" | "WON" | "LOST" | "CANCELLED";

type FolderItem = {
  id: string;
  reference: string;
  title: string;
  clientName: string;
  deadline: string | null;
  estimatedAmount: number | null;
  currency: string;
  status: BidStatus;
  notes: string | null;
  createdById: string;
  createdBy: { id: string; name: string };
  requirements: Array<{
    id: string;
    label: string;
    description: string | null;
    category: string;
    isRequired: boolean;
    orderIndex: number;
  }>;
  documents: Array<{
    id: string;
    label: string;
    originalFileName: string;
    mimeType: string;
    fileSize: number;
    requirementId: string | null;
    uploadedBy: { id: string; name: string };
    createdAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
};

type FolderSummary = {
  id: string;
  title: string;
  reference: string;
  status: BidStatus;
};

const BID_STATUS_LABEL: Record<BidStatus, string> = {
  IN_PROGRESS: "En cours",
  SUBMITTED: "Soumis",
  WON: "Remporté",
  LOST: "Perdu",
  CANCELLED: "Annulé",
};

const CATEGORY_LABEL: Record<string, string> = {
  OFFRE_TECHNIQUE: "Offre technique",
  OFFRE_FINANCIERE: "Offre financière",
  ADMINISTRATIF: "Administratif",
  JURIDIQUE: "Juridique",
  ATTESTATION: "Attestation / Certificat",
  REFERENCE: "Référence",
  AUTRE: "Autre",
};

function sizeLabel(bytes: number) {
  if (!bytes || bytes <= 0) return "-";
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} Ko`;
  return `${(kb / 1024).toFixed(2)} Mo`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

function statusBadgeClass(status: BidStatus) {
  switch (status) {
    case "WON": return "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700/50 dark:bg-emerald-950/30 dark:text-emerald-300";
    case "LOST":
    case "CANCELLED": return "border-red-300 bg-red-50 text-red-700 dark:border-red-700/50 dark:bg-red-950/30 dark:text-red-300";
    case "SUBMITTED": return "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700/50 dark:bg-blue-950/30 dark:text-blue-300";
    default: return "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-300";
  }
}

export function ClientBidDetailPage({
  folder: initialFolder,
  allFolders,
  canManageAll,
  currentUserId,
}: {
  folder: FolderItem;
  allFolders: FolderSummary[];
  canManageAll: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const [folder, setFolder] = useState(initialFolder);
  const [statusMsg, setStatusMsg] = useState("");
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);

  const canEdit = canManageAll || folder.createdById === currentUserId;

  const reqTotal = folder.requirements.filter((r) => r.isRequired).length || 1;
  const reqDone = folder.requirements.filter((r) => {
    if (!r.isRequired) return true;
    return folder.documents.some((d) => d.requirementId === r.id);
  }).length;
  const completionPct = Math.round((reqDone / reqTotal) * 100);

  const notify = useCallback((msg: string) => {
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(""), 4000);
  }, []);

  async function refreshFolder() {
    const res = await fetch(`/api/dao/folders`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      const found = (data.data ?? []).find((f: { id: string }) => f.id === folder.id);
      if (found) {
        setFolder(found);
      }
    }
    router.refresh();
  }

  async function uploadDoc(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    notify("Upload en cours…");

    const res = await fetch("/api/dao/documents", {
      method: "POST",
      body: formData,
    });

    if (res.redirected) {
      // Extract the folder ID from the current page
      notify("✅ Document ajouté !");
      await refreshFolder();
      form.reset();
      return;
    }

    const payload = await res.json().catch(() => null);
    notify(payload?.error ?? "Erreur lors de l'upload.");
  }

  async function deleteDoc(docId: string) {
    if (!confirm("Supprimer ce document ?")) return;
    notify("Suppression…");
    const res = await fetch(`/api/dao/documents?id=${docId}`, { method: "DELETE" });
    if (!res.ok) { notify("Erreur"); return; }
    notify("Document supprimé.");
    await refreshFolder();
  }

  async function updateStatus(newStatus: BidStatus) {
    setShowStatusDropdown(false);
    notify("Mise à jour…");
    const res = await fetch("/api/dao/folders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId: folder.id, status: newStatus }),
    });
    if (!res.ok) { notify("Erreur"); return; }
    notify(`Statut → ${BID_STATUS_LABEL[newStatus]}`);
    await refreshFolder();
  }

  const groupedRequirements = useMemo(
    () => folder.requirements
      .slice()
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((req) => ({
        ...req,
        docs: folder.documents.filter((d) => d.requirementId === req.id),
        done: !req.isRequired || folder.documents.some((d) => d.requirementId === req.id),
      })),
    [folder],
  );

  const orphanDocs = folder.documents.filter((d) => !d.requirementId);

  return (
    <div className="space-y-6">
      {/* Notification */}
      {statusMsg && (
        <div className="fixed top-4 right-4 z-50 rounded-xl border border-black/15 bg-white px-4 py-2.5 text-sm font-semibold shadow-lg dark:border-white/15 dark:bg-zinc-800">
          {statusMsg}
        </div>
      )}

      {/* ── Navigation & header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <a
            href="/relation-publique"
            className="rounded-md border border-black/20 px-3 py-1.5 text-xs font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            ← Tous les dossiers
          </a>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${statusBadgeClass(folder.status)}`}>
            {BID_STATUS_LABEL[folder.status]}
          </span>
        </div>
      </div>

      {/* ── Folder info cards ── */}
      <div className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{folder.title}</h1>
            <p className="mt-0.5 text-xs text-black/60 dark:text-white/60">
              {folder.reference} · {folder.createdBy.name} · Créé le {formatDate(folder.createdAt)}
            </p>
          </div>

          {/* Status selector */}
          {canEdit && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowStatusDropdown(!showStatusDropdown)}
                className="rounded-md border border-black/20 px-3 py-1.5 text-xs font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
              >
                Changer le statut
              </button>
              {showStatusDropdown && (
                <div className="absolute right-0 top-full z-20 mt-1 space-y-0.5 rounded-xl border border-black/15 bg-white p-1.5 shadow-lg dark:border-white/15 dark:bg-zinc-800">
                  {(["IN_PROGRESS", "SUBMITTED", "WON", "LOST", "CANCELLED"] as BidStatus[]).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => updateStatus(s)}
                      className={`block w-full rounded-lg px-3 py-1.5 text-left text-xs font-semibold hover:bg-black/5 dark:hover:bg-white/10 ${
                        s === folder.status ? "bg-black/5 dark:bg-white/10" : ""
                      }`}
                    >
                      {BID_STATUS_LABEL[s]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Metadata */}
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-black/70 dark:text-white/70">
          {folder.clientName && <span>Client: <strong>{folder.clientName}</strong></span>}
          {folder.deadline && <span>Date limite: <strong>{formatDate(folder.deadline)}</strong></span>}
          {folder.estimatedAmount && (
            <span>
              Montant estimé: <strong>{folder.estimatedAmount.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} {folder.currency}</strong>
            </span>
          )}
        </div>

        {/* Notes */}
        {folder.notes && (
          <div className="mt-3 rounded-xl border border-black/10 bg-black/[0.02] p-3 text-xs text-black/70 dark:border-white/10 dark:bg-white/[0.02] dark:text-white/70">
            {folder.notes}
          </div>
        )}

        {/* Progress bar */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs font-semibold text-black/60 dark:text-white/60">
            <span>Complétude du dossier</span>
            <span>{reqDone}/{reqTotal} pièces · {completionPct}%</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-black/10 dark:bg-white/10">
            <div
              className="h-2 rounded-full bg-emerald-500 transition-all"
              style={{ width: `${completionPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* ── Sidebar: all folders ── */}
      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* Folder list sidebar */}
        <aside className="order-2 lg:order-1 space-y-1 lg:sticky lg:top-24 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">
            Tous les dossiers ({allFolders.length})
          </p>
          {allFolders.map((f) => {
            const isActive = f.id === folder.id;
            return (
              <a
                key={f.id}
                href={`/relation-publique/${f.id}`}
                className={`flex items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold transition ${
                  isActive
                    ? "bg-black/10 text-black dark:bg-white/10 dark:text-white"
                    : "text-black/70 hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/10"
                }`}
              >
                <span className="truncate">{f.title}</span>
                <span className={`shrink-0 ml-2 rounded-full px-2 py-0.5 text-[9px] font-semibold ${statusBadgeClass(f.status as BidStatus)}`}>
                  {BID_STATUS_LABEL[f.status as BidStatus]}
                </span>
              </a>
            );
          })}
        </aside>

        {/* ── Main content ── */}
        <div className="order-1 lg:order-2 space-y-4">
          {/* Requirements */}
          {groupedRequirements.map((req) => (
            <div
              key={req.id}
              className={`rounded-2xl border p-4 ${
                req.done
                  ? "border-emerald-200 bg-emerald-50/30 dark:border-emerald-800/40 dark:bg-emerald-950/10"
                  : "border-amber-200 bg-amber-50/30 dark:border-amber-800/40 dark:bg-amber-950/10"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{req.label}</span>
                    <span className="rounded-md border border-black/15 px-1.5 py-0.5 text-[10px] font-semibold bg-white dark:border-white/15 dark:bg-zinc-800">
                      {CATEGORY_LABEL[req.category] ?? req.category}
                    </span>
                    {req.isRequired && (
                      <span className="text-[10px] font-semibold text-red-600">Requis</span>
                    )}
                  </div>
                  {req.description && (
                    <p className="mt-0.5 text-xs text-black/60 dark:text-white/60">{req.description}</p>
                  )}
                </div>
                <span className="text-xs font-semibold text-black/50 dark:text-white/50">
                  {req.done ? "✅ Complété" : "⏳ En attente"}
                </span>
              </div>

              {/* Upload form */}
              <form
                action="/api/dao/documents"
                method="POST"
                encType="multipart/form-data"
                onSubmit={uploadDoc}
                className="flex flex-wrap items-end gap-2"
              >
                <input type="hidden" name="bidFolderId" value={folder.id} />
                <input type="hidden" name="requirementId" value={req.id} />
                <div className="flex-1 min-w-[160px]">
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">Libellé</label>
                  <input
                    name="label"
                    required
                    placeholder="Ex: Document signé"
                    defaultValue={req.label}
                    className="w-full rounded-md border border-black/15 bg-white px-2.5 py-2 text-xs dark:border-white/15 dark:bg-zinc-900"
                  />
                </div>
                <div className="flex-1 min-w-[120px]">
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">Fichier</label>
                  <input
                    name="file"
                    type="file"
                    required
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp"
                    className="w-full rounded-md border border-black/15 bg-white px-2.5 py-1.5 text-xs file:mr-2 file:rounded-md file:border-0 file:bg-black file:px-2 file:py-1 file:text-[10px] file:font-semibold file:text-white dark:border-white/15 dark:bg-zinc-900 dark:file:bg-white dark:file:text-black"
                  />
                </div>
                <button className="rounded-md border border-black/20 px-3 py-2 text-xs font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10">
                  Upload
                </button>
              </form>

              {/* Documents list */}
              {req.docs.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {req.docs.map((doc) => (
                    <div
                      key={doc.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-black/10 bg-white px-3 py-2 text-xs dark:border-white/10 dark:bg-zinc-900"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="truncate font-medium">{doc.originalFileName}</span>
                        <span className="shrink-0 text-black/40 dark:text-white/40">({sizeLabel(doc.fileSize)})</span>
                        <span className="shrink-0 text-black/40 dark:text-white/40">· {doc.uploadedBy.name}</span>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <a
                          href={`/api/dao/documents/${doc.id}/download`}
                          className="rounded-md border border-black/20 px-2 py-1 font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                        >
                          Ouvrir
                        </a>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => deleteDoc(doc.id)}
                            className="rounded-md border border-red-300 px-2 py-1 font-semibold text-red-600 hover:bg-red-50 dark:border-red-700/60 dark:text-red-400 dark:hover:bg-red-950/40"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* Orphan documents */}
          {orphanDocs.length > 0 && (
            <div className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
              <h3 className="text-sm font-semibold mb-3">Autres documents</h3>
              <div className="space-y-1.5">
                {orphanDocs.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-black/10 bg-white px-3 py-2 text-xs dark:border-white/10 dark:bg-zinc-900"
                  >
                    <span className="truncate font-medium">{doc.originalFileName}</span>
                    <div className="flex shrink-0 gap-1">
                      <a
                        href={`/api/dao/documents/${doc.id}/download`}
                        className="rounded-md border border-black/20 px-2 py-1 font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                      >
                        Ouvrir
                      </a>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => deleteDoc(doc.id)}
                          className="rounded-md border border-red-300 px-2 py-1 font-semibold text-red-600 hover:bg-red-50 dark:border-red-700/60 dark:text-red-400 dark:hover:bg-red-950/40"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {folder.requirements.length === 0 && (
            <div className="rounded-2xl border border-black/10 bg-white p-12 text-center text-sm text-black/60 dark:border-white/10 dark:bg-zinc-900 dark:text-white/60">
              Aucune exigence définie pour ce dossier.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
