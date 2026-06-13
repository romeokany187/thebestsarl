"use client";

import { FormEvent, useMemo, useState, useCallback, useEffect } from "react";

type BidStatus = "IN_PROGRESS" | "SUBMITTED" | "WON" | "LOST" | "CANCELLED";

type BidFolderItem = {
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

type UserOption = { id: string; name: string };

const BID_STATUS_LABEL: Record<BidStatus, string> = {
  IN_PROGRESS: "En cours",
  SUBMITTED: "Soumis",
  WON: "Remporté",
  LOST: "Perdu",
  CANCELLED: "Annulé",
};

const STATUS_ICON: Record<BidStatus, string> = {
  IN_PROGRESS: "⚡",
  SUBMITTED: "📩",
  WON: "🏆",
  LOST: "💔",
  CANCELLED: "🚫",
};

const DEFAULT_CATEGORIES = [
  "OFFRE_TECHNIQUE",
  "OFFRE_FINANCIERE",
  "ADMINISTRATIF",
  "JURIDIQUE",
  "ATTESTATION",
  "REFERENCE",
  "AUTRE",
];

const CATEGORY_LABEL: Record<string, string> = {
  OFFRE_TECHNIQUE: "Offre technique",
  OFFRE_FINANCIERE: "Offre financière",
  ADMINISTRATIF: "Administratif",
  JURIDIQUE: "Juridique",
  ATTESTATION: "Attestation / Certificat",
  REFERENCE: "Référence / Expérience",
  AUTRE: "Autre",
};

const CATEGORY_ICON: Record<string, string> = {
  OFFRE_TECHNIQUE: "🔧",
  OFFRE_FINANCIERE: "💰",
  ADMINISTRATIF: "📋",
  JURIDIQUE: "⚖️",
  ATTESTATION: "✅",
  REFERENCE: "📁",
  AUTRE: "📎",
};

function mimeTypeLabel(mime: string) {
  if (mime.includes("pdf")) return "PDF";
  if (mime.includes("word") || mime.includes("doc")) return "Word";
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime.includes("xls")) return "Excel";
  if (mime.includes("image")) return "Image";
  return "Fichier";
}

function mimeIcon(mime: string) {
  if (mime.includes("pdf")) return "📄";
  if (mime.includes("word") || mime.includes("doc")) return "📝";
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime.includes("xls")) return "📊";
  if (mime.includes("image")) return "🖼️";
  return "📎";
}

function sizeLabel(bytes: number) {
  if (!bytes || bytes <= 0) return "-";
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} Ko`;
  return `${(kb / 1024).toFixed(2)} Mo`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ─── Modal component ───────────────────────────────────────────
function Modal({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto pt-10 pb-10">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl mx-4 animate-in slide-in-from-bottom-4 duration-200">
        {children}
      </div>
    </div>
  );
}

// ─── Progress ring ─────────────────────────────────────────────
function ProgressRing({ pct }: { pct: number }) {
  const r = 16;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (pct / 100) * circumference;
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" className="shrink-0">
      <circle cx="20" cy="20" r={r} fill="none" stroke="#e5e7eb" strokeWidth="4" />
      <circle
        cx="20" cy="20" r={r}
        fill="none"
        stroke={pct === 100 ? "#10b981" : "#f59e0b"}
        strokeWidth="4"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 20 20)"
        className="transition-all duration-500"
      />
      <text
        x="20" y="20"
        textAnchor="middle" dominantBaseline="central"
        className="text-[9px] font-bold fill-gray-800 dark:fill-gray-200"
      >
        {pct}%
      </text>
    </svg>
  );
}

// ─── Main Component ────────────────────────────────────────────
export function BidWorkspace({
  initialFolders,
  allUsers,
  canManageAll,
  currentUserId,
}: {
  initialFolders: BidFolderItem[];
  allUsers: UserOption[];
  canManageAll: boolean;
  currentUserId: string;
}) {
  const [folders, setFolders] = useState(initialFolders);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState("");
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  // Form state
  const [folderTitle, setFolderTitle] = useState("");
  const [clientName, setClientName] = useState("");
  const [deadline, setDeadline] = useState("");
  const [estimatedAmount, setEstimatedAmount] = useState("");
  const [currency, setCurrency] = useState("CDF");
  const [folderNotes, setFolderNotes] = useState("");
  const [requirements, setRequirements] = useState<Array<{
    key: string;
    label: string;
    description: string;
    category: string;
    isRequired: boolean;
  }>>([{ key: crypto.randomUUID(), label: "", description: "", category: "ADMINISTRATIF", isRequired: true }]);

  const selectedFolder = useMemo(
    () => folders.find((f) => f.id === selectedFolderId) ?? null,
    [folders, selectedFolderId],
  );

  // ── Helpers ──
  const notify = useCallback((msg: string) => {
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(""), 3000);
  }, []);

  function resetForm() {
    setEditingFolderId(null);
    setFolderTitle("");
    setClientName("");
    setDeadline("");
    setEstimatedAmount("");
    setCurrency("CDF");
    setFolderNotes("");
    setRequirements([{ key: crypto.randomUUID(), label: "", description: "", category: "ADMINISTRATIF", isRequired: true }]);
    setModalOpen(false);
  }

  function openCreate() {
    resetForm();
    setEditingFolderId(null);
    setModalOpen(true);
  }

  function openEdit(folder: BidFolderItem) {
    setEditingFolderId(folder.id);
    setFolderTitle(folder.title);
    setClientName(folder.clientName);
    setDeadline(folder.deadline ? folder.deadline.slice(0, 16) : "");
    setEstimatedAmount(folder.estimatedAmount ? String(folder.estimatedAmount) : "");
    setCurrency(folder.currency);
    setFolderNotes(folder.notes ?? "");
    setRequirements(
      folder.requirements.length > 0
        ? folder.requirements.map((r) => ({
            key: r.id,
            label: r.label,
            description: r.description ?? "",
            category: r.category,
            isRequired: r.isRequired,
          }))
        : [{ key: crypto.randomUUID(), label: "", description: "", category: "ADMINISTRATIF", isRequired: true }],
    );
    setModalOpen(true);
  }

  function addRequirement() {
    setRequirements((prev) => [
      ...prev,
      { key: crypto.randomUUID(), label: "", description: "", category: "ADMINISTRATIF", isRequired: true },
    ]);
  }

  function removeRequirement(index: number) {
    setRequirements((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  function updateRequirement(index: number, field: string, value: string | boolean) {
    setRequirements((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  }

  function canEdit(folder: BidFolderItem) {
    return canManageAll || folder.createdById === currentUserId;
  }

  async function refreshFolders() {
    const res = await fetch("/api/dao/folders", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      setFolders(data.data ?? []);
    }
  }

  async function submitFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    notify("Enregistrement…");

    const validRequirements = requirements
      .filter((r) => r.label.trim().length > 0 && CATEGORY_LABEL[r.category])
      .map((r, i) => ({
        ...(r.key.length < 20 ? { id: r.key } : {}),
        label: r.label.trim(),
        description: r.description.trim(),
        category: r.category,
        isRequired: r.isRequired,
        orderIndex: i,
      }));

    const body: Record<string, unknown> = {
      title: folderTitle.trim(),
      clientName: clientName.trim(),
      deadline: deadline || null,
      estimatedAmount: estimatedAmount ? Number(estimatedAmount) : null,
      currency,
      notes: folderNotes.trim() || null,
      requirements: validRequirements,
    };

    if (editingFolderId) body.folderId = editingFolderId;

    const res = await fetch("/api/dao/folders", {
      method: editingFolderId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      notify(payload?.error ?? "Erreur lors de l'enregistrement.");
      return;
    }

    notify(editingFolderId ? "✅ Dossier mis à jour !" : "✅ Dossier créé !");
    resetForm();
    await refreshFolders();
  }

  async function updateFolderStatus(folderId: string, newStatus: BidStatus) {
    notify("Mise à jour…");
    const res = await fetch("/api/dao/folders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId, status: newStatus }),
    });
    if (!res.ok) { notify("Erreur"); return; }
    notify(`✅ Statut → ${BID_STATUS_LABEL[newStatus]}`);
    await refreshFolders();
  }

  async function deleteDocument(docId: string) {
    if (!confirm("Supprimer ce document ?")) return;
    notify("Suppression…");
    const res = await fetch(`/api/dao/documents?id=${docId}`, { method: "DELETE" });
    if (!res.ok) { notify("Erreur"); return; }
    notify("Document supprimé.");
    await refreshFolders();
  }

  const folderStats = useMemo(() => {
    if (!selectedFolder) return { total: 0, completed: 0, percent: 0 };
    const total = selectedFolder.requirements.filter((r) => r.isRequired).length || 1;
    const completed = selectedFolder.requirements.filter((r) => {
      if (!r.isRequired) return true;
      return selectedFolder.documents.some((d) => d.requirementId === r.id);
    }).length;
    return { total, completed, percent: Math.round((completed / total) * 100) };
  }, [selectedFolder]);

  const globalStats = useMemo(() => {
    const total = folders.length;
    const inProgress = folders.filter((f) => f.status === "IN_PROGRESS").length;
    const submitted = folders.filter((f) => f.status === "SUBMITTED").length;
    const won = folders.filter((f) => f.status === "WON").length;
    return { total, inProgress, submitted, won };
  }, [folders]);

  const isEditing = editingFolderId !== null;

  return (
    <div className="space-y-6">
      {/* ── Notification toast ── */}
      {statusMsg && (
        <div className="fixed top-4 right-4 z-[200] rounded-2xl border-2 border-black bg-white px-5 py-3 text-sm font-bold shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] animate-in slide-in-from-top-2 duration-200">
          {statusMsg}
        </div>
      )}

      {/* ── KPI banner ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Total dossiers", value: globalStats.total, icon: "📦" },
          { label: "En cours", value: globalStats.inProgress, icon: "⚡" },
          { label: "Soumis", value: globalStats.submitted, icon: "📩" },
          { label: "Remportés", value: globalStats.won, icon: "🏆" },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-2xl border-2 border-black bg-white p-4 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]"
          >
            <p className="text-lg">{kpi.icon}</p>
            <p className="mt-1 text-2xl font-black tracking-tight">{kpi.value}</p>
            <p className="text-xs font-semibold text-black/60 uppercase tracking-wide">{kpi.label}</p>
          </div>
        ))}
      </div>

      {/* ── Create button ── */}
      <button
        onClick={openCreate}
        className="inline-flex items-center gap-2 rounded-2xl border-2 border-black bg-yellow-300 px-6 py-3 text-sm font-black uppercase tracking-wider shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all"
      >
        <span className="text-lg">📋</span>
        Nouvel appel d'offres
      </button>

      {/* ── Folder cards grid ── */}
      {folders.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-black/30 bg-white p-12 text-center">
          <p className="text-4xl">📭</p>
          <p className="mt-3 text-lg font-bold text-black/50">Aucun dossier pour le moment</p>
          <p className="text-sm text-black/40">Clique sur "Nouvel appel d'offres" pour commencer</p>
        </div>
      ) : (
        <div className="space-y-3">
          {folders.map((folder) => {
            const reqTotal = folder.requirements.filter((r) => r.isRequired).length || 1;
            const reqDone = folder.requirements.filter((r) => {
              if (!r.isRequired) return true;
              return folder.documents.some((d) => d.requirementId === r.id);
            }).length;
            const pct = Math.round((reqDone / reqTotal) * 100);
            const isActive = folder.id === selectedFolderId;

            return (
              <div
                key={folder.id}
                className={`rounded-2xl border-2 transition-all cursor-pointer ${
                  isActive
                    ? "border-black shadow-[5px_5px_0px_0px_rgba(0,0,0,1)]"
                    : "border-black/20 shadow-[2px_2px_0px_0px_rgba(0,0,0,0.4)] hover:shadow-[3px_3px_0px_0px_rgba(0,0,0,0.6)]"
                } bg-white`}
                onClick={() => setSelectedFolderId(folder.id)}
              >
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-lg font-black tracking-tight truncate">{folder.title}</p>
                        <span className="shrink-0 rounded-lg border-2 border-black bg-white px-2.5 py-0.5 text-[10px] font-bold">
                          {STATUS_ICON[folder.status]} {BID_STATUS_LABEL[folder.status]}
                        </span>
                      </div>
                      <p className="mt-1 text-xs font-semibold text-black/60">
                        {folder.reference}
                        {folder.clientName ? ` • ${folder.clientName}` : ""}
                        {folder.deadline ? ` • 🗓️ ${formatDate(folder.deadline)}` : ""}
                      </p>
                    </div>
                    <ProgressRing pct={pct} />
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <div className="flex-1 h-2 rounded-full bg-black/10">
                      <div
                        className="h-2 rounded-full bg-emerald-500 transition-all duration-300"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs font-bold text-black/50">{folder.documents.length} doc{/* */}
                      {folder.documents.length > 1 ? "s" : ""}
                    </span>
                  </div>
                </div>

                {/* Expanded detail */}
                {isActive && (
                  <div className="border-t-2 border-black/10 px-4 pb-4 pt-3">
                    {/* Meta row */}
                    <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-black/60 mb-3">
                      <span>👤 {folder.createdBy.name}</span>
                      <span>📅 {formatDate(folder.createdAt)}</span>
                      {folder.estimatedAmount && (
                        <span>💰 {new Intl.NumberFormat("fr-FR").format(folder.estimatedAmount)} {folder.currency}</span>
                      )}
                    </div>

                    {/* Notes */}
                    {folder.notes && (
                      <div className="mb-3 rounded-xl border-2 border-black/10 bg-black/[0.02] p-3 text-xs">
                        <p className="font-bold uppercase tracking-wide text-black/50 mb-1">Notes</p>
                        <p className="text-black/70">{folder.notes}</p>
                      </div>
                    )}

                    {/* Completion bar */}
                    <div className="mb-4">
                      <div className="flex items-center justify-between text-xs font-bold">
                        <span>Complétude</span>
                        <span>{folderStats.completed}/{folderStats.total} pièces • {folderStats.percent}%</span>
                      </div>
                      <div className="mt-1 h-3 rounded-full border border-black bg-black/5">
                        <div
                          className="h-3 rounded-full bg-emerald-500 transition-all"
                          style={{ width: `${folderStats.percent}%` }}
                        />
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex flex-wrap gap-2 mb-4">
                      {canEdit(folder) && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); openEdit(folder); }}
                          className="rounded-xl border-2 border-black bg-white px-3 py-1.5 text-xs font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all"
                        >
                          ✏️ Modifier
                        </button>
                      )}
                      {canEdit(folder) && (
                        <select
                          value={folder.status}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => updateFolderStatus(folder.id, e.target.value as BidStatus)}
                          className="rounded-xl border-2 border-black bg-white px-3 py-1.5 text-xs font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                        >
                          <option value="IN_PROGRESS">⚡ En cours</option>
                          <option value="SUBMITTED">📩 Soumis</option>
                          <option value="WON">🏆 Remporté</option>
                          <option value="LOST">💔 Perdu</option>
                          <option value="CANCELLED">🚫 Annulé</option>
                        </select>
                      )}
                    </div>

                    {/* Requirements */}
                    <h3 className="text-xs font-black uppercase tracking-wide mb-2">📋 Exigences du dossier</h3>
                    {folder.requirements.length === 0 ? (
                      <p className="text-xs text-black/40 italic">Aucune exigence définie.</p>
                    ) : (
                      <div className="space-y-2">
                        {folder.requirements.map((req) => {
                          const docs = folder.documents.filter((d) => d.requirementId === req.id);
                          const done = !req.isRequired || docs.length > 0;

                          return (
                            <div
                              key={req.id}
                              className={`rounded-xl border-2 p-3 ${
                                done
                                  ? "border-emerald-400 bg-emerald-50/50"
                                  : "border-amber-400 bg-amber-50/50"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span>{done ? "✅" : "⏳"}</span>
                                    <p className="text-sm font-bold">{req.label}</p>
                                    <span className="rounded-md border border-black/20 px-1.5 py-0.5 text-[9px] font-bold bg-white">
                                      {CATEGORY_ICON[req.category]} {CATEGORY_LABEL[req.category] ?? req.category}
                                    </span>
                                    {req.isRequired && (
                                      <span className="text-[10px] font-bold text-red-600">REQUIS</span>
                                    )}
                                  </div>
                                  {req.description && (
                                    <p className="mt-0.5 text-xs text-black/60">{req.description}</p>
                                  )}
                                </div>
                              </div>

                              {/* Upload form */}
                              <form
                                action="/api/dao/documents"
                                method="POST"
                                encType="multipart/form-data"
                                className="mt-2 flex flex-wrap items-end gap-2"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <input type="hidden" name="bidFolderId" value={folder.id} />
                                <input type="hidden" name="requirementId" value={req.id} />
                                <input
                                  name="label"
                                  required
                                  placeholder="Libellé"
                                  defaultValue={req.label}
                                  className="flex-1 min-w-[100px] rounded-xl border-2 border-black px-2.5 py-2 text-xs font-semibold shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
                                />
                                <input
                                  name="file"
                                  type="file"
                                  required
                                  accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp"
                                  className="flex-1 min-w-[120px] rounded-xl border-2 border-black px-2.5 py-2 text-xs font-semibold shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] file:mr-2 file:rounded-lg file:border-0 file:bg-black file:px-2 file:py-1 file:text-[10px] file:font-bold file:text-white"
                                />
                                <button className="rounded-xl border-2 border-black bg-black px-3 py-2 text-xs font-bold text-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all">
                                  Upload
                                </button>
                              </form>

                              {/* Documents list */}
                              {docs.length > 0 && (
                                <div className="mt-2 space-y-1" onClick={(e) => e.stopPropagation()}>
                                  {docs.map((doc) => (
                                    <div
                                      key={doc.id}
                                      className="flex items-center justify-between gap-2 rounded-lg border-2 border-black/15 bg-white px-3 py-1.5 text-xs font-semibold"
                                    >
                                      <div className="flex items-center gap-1.5 min-w-0">
                                        <span>{mimeIcon(doc.mimeType)}</span>
                                        <span className="truncate">{doc.originalFileName}</span>
                                        <span className="shrink-0 text-black/40">({sizeLabel(doc.fileSize)})</span>
                                        <span className="shrink-0 text-black/40">• {doc.uploadedBy.name}</span>
                                      </div>
                                      <div className="flex shrink-0 gap-1">
                                        <a
                                          href={`/api/dao/documents/${doc.id}/download`}
                                          className="rounded-lg border-2 border-black px-2 py-1 font-bold hover:bg-black/5 transition-all"
                                        >
                                          Ouvrir
                                        </a>
                                        <button
                                          type="button"
                                          onClick={() => deleteDocument(doc.id)}
                                          className="rounded-lg border-2 border-red-400 px-2 py-1 font-bold text-red-600 hover:bg-red-50 transition-all"
                                        >
                                          ×
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Orphan documents */}
                    {folder.documents.some((d) => !d.requirementId) && (
                      <div className="mt-3">
                        <p className="text-xs font-black uppercase tracking-wide mb-1">📎 Autres documents</p>
                        {folder.documents.filter((d) => !d.requirementId).map((doc) => (
                          <div key={doc.id} className="flex items-center justify-between gap-2 rounded-lg border-2 border-black/15 bg-white px-3 py-1.5 text-xs font-semibold mb-1">
                            <span>{mimeIcon(doc.mimeType)} {doc.originalFileName}</span>
                            <div className="flex gap-1">
                              <a href={`/api/dao/documents/${doc.id}/download`} className="rounded-lg border-2 border-black px-2 py-1 font-bold">Ouvrir</a>
                              <button onClick={() => deleteDocument(doc.id)} className="rounded-lg border-2 border-red-400 px-2 py-1 font-bold text-red-600">×</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Modal: Create / Edit ── */}
      <Modal open={modalOpen} onClose={resetForm}>
        <div className="rounded-2xl border-2 border-black bg-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
          {/* Header */}
          <div className="flex items-center justify-between border-b-2 border-black px-6 py-4">
            <div>
              <h2 className="text-lg font-black tracking-tight">
                {isEditing ? "✏️ Modifier le dossier" : "📋 Nouvel appel d'offres"}
              </h2>
              <p className="text-xs font-semibold text-black/60 mt-0.5">
                {isEditing
                  ? "Modifie les informations et les exigences du dossier."
                  : "Définis le cadre de l'appel d'offres et ses exigences."}
              </p>
            </div>
            <button
              onClick={resetForm}
              className="rounded-xl border-2 border-black bg-white px-3 py-1.5 text-xs font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all"
            >
              ✕ Fermer
            </button>
          </div>

          {/* Body */}
          <form onSubmit={submitFolder} className="p-6 space-y-4 max-h-[65vh] overflow-y-auto">
            {/* Title + Client row */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block text-xs font-bold uppercase tracking-wide mb-1">Titre du DAO *</label>
                <input
                  value={folderTitle}
                  onChange={(e) => setFolderTitle(e.target.value)}
                  required
                  placeholder="Ex: Appel d'offres Fourniture de bureau 2026"
                  className="w-full rounded-xl border-2 border-black px-4 py-2.5 text-sm font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] focus:outline-none focus:ring-2 focus:ring-yellow-300"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wide mb-1">Client / Émetteur</label>
                <input
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Ex: Ministère des Finances"
                  className="w-full rounded-xl border-2 border-black px-4 py-2.5 text-sm font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] focus:outline-none focus:ring-2 focus:ring-yellow-300"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wide mb-1">Date limite</label>
                <input
                  type="datetime-local"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  className="w-full rounded-xl border-2 border-black px-4 py-2.5 text-sm font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] focus:outline-none focus:ring-2 focus:ring-yellow-300"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wide mb-1">Montant estimé</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={estimatedAmount}
                  onChange={(e) => setEstimatedAmount(e.target.value)}
                  placeholder="0"
                  className="w-full rounded-xl border-2 border-black px-4 py-2.5 text-sm font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] focus:outline-none focus:ring-2 focus:ring-yellow-300"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wide mb-1">Devise</label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="w-full rounded-xl border-2 border-black px-4 py-2.5 text-sm font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] focus:outline-none focus:ring-2 focus:ring-yellow-300"
                >
                  <option value="CDF">🇨🇩 CDF</option>
                  <option value="USD">🇺🇸 USD</option>
                  <option value="EUR">🇪🇺 EUR</option>
                </select>
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wide mb-1">Notes / Cahier des charges</label>
              <textarea
                value={folderNotes}
                onChange={(e) => setFolderNotes(e.target.value)}
                rows={3}
                placeholder="Détails importants, instructions, informations complémentaires…"
                className="w-full rounded-xl border-2 border-black px-4 py-2.5 text-sm font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] focus:outline-none focus:ring-2 focus:ring-yellow-300"
              />
            </div>

            {/* Requirements */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-black uppercase tracking-wide">
                  📋 Exigences ({requirements.length})
                </label>
                <button
                  type="button"
                  onClick={addRequirement}
                  className="rounded-xl border-2 border-black bg-yellow-200 px-3 py-1.5 text-xs font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all"
                >
                  + Ajouter
                </button>
              </div>
              <p className="text-[10px] font-semibold text-black/50 mb-3">
                Définis chaque pièce demandée : offre technique, caution, attestation, etc.
              </p>

              <div className="space-y-3 max-h-56 overflow-y-auto pr-1">
                {requirements.map((req, index) => (
                  <div
                    key={req.key}
                    className="rounded-xl border-2 border-black bg-black/[0.02] p-3 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-black uppercase">Pièce #{index + 1}</p>
                      <button
                        type="button"
                        onClick={() => removeRequirement(index)}
                        className="rounded-lg border-2 border-red-400 px-2 py-1 text-[10px] font-bold text-red-600 hover:bg-red-50 transition-all"
                      >
                        ✕ Retirer
                      </button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input
                        value={req.label}
                        onChange={(e) => updateRequirement(index, "label", e.target.value)}
                        placeholder="Nom (ex: Offre technique)"
                        className="rounded-xl border-2 border-black px-3 py-2 text-sm font-bold shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] focus:outline-none focus:ring-2 focus:ring-yellow-300"
                      />
                      <select
                        value={req.category}
                        onChange={(e) => updateRequirement(index, "category", e.target.value)}
                        className="rounded-xl border-2 border-black px-3 py-2 text-sm font-bold shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] focus:outline-none focus:ring-2 focus:ring-yellow-300"
                      >
                        {DEFAULT_CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>{CATEGORY_ICON[cat]} {CATEGORY_LABEL[cat]}</option>
                        ))}
                      </select>
                    </div>
                    <div className="mt-2 flex items-start gap-2">
                      <input
                        value={req.description}
                        onChange={(e) => updateRequirement(index, "description", e.target.value)}
                        placeholder="Description (optionnelle)"
                        className="flex-1 rounded-xl border-2 border-black px-3 py-2 text-sm font-bold shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] focus:outline-none focus:ring-2 focus:ring-yellow-300"
                      />
                      <label className="flex items-center gap-1.5 text-xs font-bold shrink-0 mt-1">
                        <input
                          type="checkbox"
                          checked={req.isRequired}
                          onChange={(e) => updateRequirement(index, "isRequired", e.target.checked)}
                          className="h-4 w-4 rounded border-2 border-black"
                        />
                        Requis
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Submit */}
            <div className="border-t-2 border-black/10 pt-4 flex items-center justify-between">
              <button
                type="button"
                onClick={resetForm}
                className="rounded-xl border-2 border-black bg-white px-5 py-2.5 text-sm font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all"
              >
                Annuler
              </button>
              <button className="rounded-xl border-2 border-black bg-yellow-300 px-8 py-2.5 text-sm font-black tracking-wider shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition-all">
                {isEditing ? "💾 Enregistrer" : "🚀 Créer le dossier"}
              </button>
            </div>
          </form>
        </div>
      </Modal>
    </div>
  );
}
