"use client";

import { FormEvent, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

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

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
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

// ─── Modal component ──────────────────────────────────────────
function Modal({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto pt-10 pb-10">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl mx-4">
        {children}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────
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
  const router = useRouter();
  const [folders, setFolders] = useState(initialFolders);
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

  async function deleteDocument(docId: string) {
    if (!confirm("Supprimer ce document ?")) return;
    notify("Suppression…");
    const res = await fetch(`/api/dao/documents?id=${docId}`, { method: "DELETE" });
    if (!res.ok) { notify("Erreur"); return; }
    notify("Document supprimé.");
    await refreshFolders();
  }

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
      {/* Notification toast */}
      {statusMsg && (
        <div className="fixed top-4 right-4 z-[200] rounded-xl border border-black/15 bg-white px-4 py-2.5 text-sm font-semibold shadow-lg dark:border-white/15 dark:bg-zinc-800">
          {statusMsg}
        </div>
      )}

      {/* KPI banner */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Total dossiers", value: globalStats.total },
          { label: "En cours", value: globalStats.inProgress },
          { label: "Soumis", value: globalStats.submitted },
          { label: "Remportés", value: globalStats.won },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900"
          >
            <p className="text-2xl font-semibold tracking-tight">{kpi.value}</p>
            <p className="mt-0.5 text-xs font-semibold text-black/60 dark:text-white/60">{kpi.label}</p>
          </div>
        ))}
      </div>

      {/* Create button */}
      <button
        onClick={openCreate}
        className="rounded-md border border-black/20 px-4 py-2 text-sm font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
      >
        + Nouvel appel d'offres
      </button>

      {/* Folder cards */}
      {folders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-black/20 bg-white p-12 text-center dark:border-white/20 dark:bg-zinc-900">
          <p className="text-lg font-semibold text-black/50 dark:text-white/50">Aucun dossier pour le moment</p>
          <p className="text-sm text-black/40 dark:text-white/40">Cliquez sur "Nouvel appel d'offres" pour commencer</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {folders.map((folder) => {
            const reqTotal = folder.requirements.filter((r) => r.isRequired).length || 1;
            const reqDone = folder.requirements.filter((r) => {
              if (!r.isRequired) return true;
              return folder.documents.some((d) => d.requirementId === r.id);
            }).length;
            const pct = Math.round((reqDone / reqTotal) * 100);

            return (
              <a
                key={folder.id}
                href={`/relation-publique/${folder.id}`}
                className="block rounded-xl border border-black/10 bg-white p-4 transition hover:border-black/20 hover:shadow-sm dark:border-white/10 dark:bg-zinc-900 dark:hover:border-white/20"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="text-sm font-semibold truncate leading-tight">{folder.title}</p>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusBadgeClass(folder.status)}`}>
                    {BID_STATUS_LABEL[folder.status]}
                  </span>
                </div>
                <p className="text-xs text-black/50 dark:text-white/50 truncate">
                  {folder.reference}
                  {folder.clientName ? ` · ${folder.clientName}` : ""}
                </p>
                <div className="mt-3">
                  <div className="flex items-center justify-between text-[10px] font-semibold text-black/50 dark:text-white/50">
                    <span>Complétude</span>
                    <span>{reqDone}/{reqTotal} · {pct}%</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-black/10 dark:bg-white/10">
                    <div
                      className="h-1.5 rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
                <p className="mt-2 text-[11px] text-black/40 dark:text-white/40">
                  {folder.documents.length} doc{folder.documents.length > 1 ? "s" : ""} · {folder.createdBy.name}
                </p>
              </a>
            );
          })}
        </div>
      )}

      {/* Modal: Create / Edit */}
      <Modal open={modalOpen} onClose={resetForm}>
        <div className="rounded-2xl border border-black/10 bg-white shadow-lg dark:border-white/10 dark:bg-zinc-900">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-black/10 px-5 py-4 dark:border-white/10">
            <div>
              <h2 className="text-base font-semibold">
                {isEditing ? "Modifier le dossier" : "Nouvel appel d'offres"}
              </h2>
              <p className="text-xs text-black/60 dark:text-white/60 mt-0.5">
                {isEditing
                  ? "Modifiez les informations et les exigences du dossier."
                  : "Définissez le cadre de l'appel d'offres et ses exigences."}
              </p>
            </div>
            <button
              onClick={resetForm}
              className="rounded-md border border-black/20 px-3 py-1.5 text-xs font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
            >
              ✕ Fermer
            </button>
          </div>

          {/* Body */}
          <form onSubmit={submitFolder} className="p-5 space-y-4 max-h-[65vh] overflow-y-auto">
            {/* Title + Client row */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-semibold uppercase tracking-wide mb-1 text-black/60 dark:text-white/60">Titre du DAO *</label>
                <input
                  value={folderTitle}
                  onChange={(e) => setFolderTitle(e.target.value)}
                  required
                  placeholder="Ex: Appel d'offres Fourniture de bureau 2026"
                  className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide mb-1 text-black/60 dark:text-white/60">Client / Émetteur</label>
                <input
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Ex: Ministère des Finances"
                  className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide mb-1 text-black/60 dark:text-white/60">Date limite</label>
                <input
                  type="datetime-local"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide mb-1 text-black/60 dark:text-white/60">Montant estimé</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={estimatedAmount}
                  onChange={(e) => setEstimatedAmount(e.target.value)}
                  placeholder="0"
                  className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide mb-1 text-black/60 dark:text-white/60">Devise</label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
                >
                  <option value="CDF">CDF</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide mb-1 text-black/60 dark:text-white/60">Notes / Cahier des charges</label>
              <textarea
                value={folderNotes}
                onChange={(e) => setFolderNotes(e.target.value)}
                rows={3}
                placeholder="Détails importants, instructions, informations complémentaires…"
                className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
              />
            </div>

            {/* Requirements */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">
                  Exigences ({requirements.length})
                </label>
                <button
                  type="button"
                  onClick={addRequirement}
                  className="rounded-md border border-black/20 px-2.5 py-1 text-xs font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                >
                  + Ajouter
                </button>
              </div>
              <p className="text-[10px] font-semibold text-black/50 dark:text-white/50 mb-3">
                Définissez chaque pièce demandée : offre technique, caution, attestation, etc.
              </p>

              <div className="space-y-3 max-h-56 overflow-y-auto pr-1">
                {requirements.map((req, index) => (
                  <div
                    key={req.key}
                    className="rounded-lg border border-black/10 bg-black/[0.02] p-3 dark:border-white/10 dark:bg-white/[0.02]"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-black/60 dark:text-white/60">Pièce #{index + 1}</p>
                      <button
                        type="button"
                        onClick={() => removeRequirement(index)}
                        className="rounded-md border border-red-300 px-2 py-1 text-[10px] font-semibold text-red-600 hover:bg-red-50 dark:border-red-700/60 dark:text-red-400 dark:hover:bg-red-950/40"
                      >
                        × Retirer
                      </button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input
                        value={req.label}
                        onChange={(e) => updateRequirement(index, "label", e.target.value)}
                        placeholder="Nom (ex: Offre technique)"
                        className="rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
                      />
                      <select
                        value={req.category}
                        onChange={(e) => updateRequirement(index, "category", e.target.value)}
                        className="rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
                      >
                        {DEFAULT_CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>{CATEGORY_LABEL[cat]}</option>
                        ))}
                      </select>
                    </div>
                    <div className="mt-2 flex items-start gap-2">
                      <input
                        value={req.description}
                        onChange={(e) => updateRequirement(index, "description", e.target.value)}
                        placeholder="Description (optionnelle)"
                        className="flex-1 rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
                      />
                      <label className="flex items-center gap-1.5 text-xs font-semibold shrink-0 mt-1 text-black/60 dark:text-white/60">
                        <input
                          type="checkbox"
                          checked={req.isRequired}
                          onChange={(e) => updateRequirement(index, "isRequired", e.target.checked)}
                          className="h-4 w-4 rounded border border-black/30 dark:border-white/30"
                        />
                        Requis
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Submit */}
            <div className="border-t border-black/10 pt-4 flex items-center justify-between dark:border-white/10">
              <button
                type="button"
                onClick={resetForm}
                className="rounded-md border border-black/20 px-4 py-2 text-sm font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
              >
                Annuler
              </button>
              <button className="rounded-md bg-black px-6 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black">
                {isEditing ? "Enregistrer" : "Créer le dossier"}
              </button>
            </div>
          </form>
        </div>
      </Modal>
    </div>
  );
}
