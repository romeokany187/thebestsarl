"use client";

import { FormEvent, useMemo, useState } from "react";

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

const BID_STATUS_COLORS: Record<BidStatus, string> = {
  IN_PROGRESS: "border-amber-300 text-amber-800 bg-amber-50 dark:border-amber-700/60 dark:text-amber-300 dark:bg-amber-950/30",
  SUBMITTED: "border-blue-300 text-blue-800 bg-blue-50 dark:border-blue-700/60 dark:text-blue-300 dark:bg-blue-950/30",
  WON: "border-emerald-300 text-emerald-800 bg-emerald-50 dark:border-emerald-700/60 dark:text-emerald-300 dark:bg-emerald-950/30",
  LOST: "border-red-300 text-red-800 bg-red-50 dark:border-red-700/60 dark:text-red-300 dark:bg-red-950/30",
  CANCELLED: "border-zinc-300 text-zinc-600 bg-zinc-50 dark:border-zinc-600 dark:text-zinc-400 dark:bg-zinc-900/50",
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

function mimeTypeLabel(mime: string) {
  if (mime.includes("pdf")) return "PDF";
  if (mime.includes("word") || mime.includes("doc")) return "Word";
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime.includes("xls")) return "Excel";
  if (mime.includes("image")) return "Image";
  return "Fichier";
}

function sizeLabel(bytes: number) {
  if (!bytes || bytes <= 0) return "-";
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

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
  const [status, setStatus] = useState("");
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

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

  // Reset form
  function resetForm() {
    setEditingFolderId(null);
    setFolderTitle("");
    setClientName("");
    setDeadline("");
    setEstimatedAmount("");
    setCurrency("CDF");
    setFolderNotes("");
    setRequirements([{ key: crypto.randomUUID(), label: "", description: "", category: "ADMINISTRATIF", isRequired: true }]);
    setShowForm(false);
  }

  function loadFolderForEdit(folder: BidFolderItem) {
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
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
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
    setStatus("Enregistrement...");

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

    if (editingFolderId) {
      body.folderId = editingFolderId;
    }

    const res = await fetch("/api/dao/folders", {
      method: editingFolderId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      setStatus(payload?.error ?? "Erreur lors de l'enregistrement.");
      return;
    }

    setStatus(editingFolderId ? "Dossier mis à jour." : "Dossier créé.");
    resetForm();
    await refreshFolders();
  }

  async function updateFolderStatus(folderId: string, newStatus: BidStatus) {
    setStatus("Mise à jour du statut...");
    const res = await fetch("/api/dao/folders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId, status: newStatus }),
    });

    if (!res.ok) {
      setStatus("Erreur de mise à jour du statut.");
      return;
    }
    setStatus("Statut mis à jour.");
    await refreshFolders();
  }

  // Count completion stats for selected folder
  const folderStats = useMemo(() => {
    if (!selectedFolder) return { total: 0, completed: 0, percent: 0 };
    const total = selectedFolder.requirements.filter((r) => r.isRequired).length || 1;
    const completed = selectedFolder.requirements.filter((r) => {
      if (!r.isRequired) return true;
      return selectedFolder.documents.some((d) => d.requirementId === r.id);
    }).length;
    const percent = Math.round((completed / total) * 100);
    return { total, completed, percent };
  }, [selectedFolder]);

  // All-time stats
  const globalStats = useMemo(() => {
    const total = folders.length;
    const inProgress = folders.filter((f) => f.status === "IN_PROGRESS").length;
    const submitted = folders.filter((f) => f.status === "SUBMITTED").length;
    const won = folders.filter((f) => f.status === "WON").length;
    return { total, inProgress, submitted, won };
  }, [folders]);

  async function deleteDocument(docId: string) {
    if (!confirm("Supprimer ce document ?")) return;
    setStatus("Suppression...");
    const res = await fetch(`/api/dao/documents?id=${docId}`, { method: "DELETE" });
    if (!res.ok) {
      setStatus("Erreur de suppression.");
      return;
    }
    setStatus("Document supprimé.");
    await refreshFolders();
  }

  const isEditing = editingFolderId !== null;

  return (
    <div className="space-y-6">
      {/* Global stats */}
      <section className="grid gap-4 sm:grid-cols-4">
        <article className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <p className="text-xs text-black/60 dark:text-white/60">Total dossiers</p>
          <p className="mt-1 text-2xl font-semibold">{globalStats.total}</p>
        </article>
        <article className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <p className="text-xs text-black/60 dark:text-white/60">En cours</p>
          <p className="mt-1 text-2xl font-semibold">{globalStats.inProgress}</p>
        </article>
        <article className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <p className="text-xs text-black/60 dark:text-white/60">Soumis</p>
          <p className="mt-1 text-2xl font-semibold">{globalStats.submitted}</p>
        </article>
        <article className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <p className="text-xs text-black/60 dark:text-white/60">Remportés</p>
          <p className="mt-1 text-2xl font-semibold">{globalStats.won}</p>
        </article>
      </section>

      {/* Create / Edit form */}
      <section className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">
              {isEditing ? "Modifier le dossier DAO" : "Nouveau dossier d'appel d'offres"}
            </h2>
            <p className="mt-1 text-xs text-black/60 dark:text-white/60">
              Définissez le titre, le client, les exigences techniques/financières/administratives.
              Chaque exigence pourra être complétée par un document.
            </p>
          </div>
          {isEditing ? (
            <button
              type="button"
              onClick={resetForm}
              className="rounded-md border border-black/20 px-2.5 py-1 text-xs font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
            >
              Annuler
            </button>
          ) : showForm ? (
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-md border border-black/20 px-2.5 py-1 text-xs font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
            >
              Fermer
            </button>
          ) : null}
        </div>

        {!showForm && !isEditing ? (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="mt-3 rounded-md bg-black px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black"
          >
            + Nouveau dossier
          </button>
        ) : null}

        {(showForm || isEditing) ? (
          <form onSubmit={submitFolder} className="mt-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                value={folderTitle}
                onChange={(e) => setFolderTitle(e.target.value)}
                required
                placeholder="Titre du DAO (ex: Appel d'offres Fourniture bureau 2026)"
                className="rounded-md border px-3 py-2 text-sm sm:col-span-2"
              />
              <input
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Client / Émetteur de l'appel d'offres"
                className="rounded-md border px-3 py-2 text-sm"
              />
              <input
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                placeholder="Date limite de dépôt"
                className="rounded-md border px-3 py-2 text-sm"
              />
              <input
                type="number"
                min="0"
                step="0.01"
                value={estimatedAmount}
                onChange={(e) => setEstimatedAmount(e.target.value)}
                placeholder="Montant estimé du marché"
                className="rounded-md border px-3 py-2 text-sm"
              />
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="rounded-md border px-3 py-2 text-sm"
              >
                <option value="CDF">CDF</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </div>

            <textarea
              value={folderNotes}
              onChange={(e) => setFolderNotes(e.target.value)}
              rows={2}
              placeholder="Notes générales sur ce DAO (objet, cahier des charges, informations complémentaires...)"
              className="w-full rounded-md border px-3 py-2 text-sm"
            />

            {/* Requirements */}
            <div className="rounded-lg border border-black/10 p-3 dark:border-white/10">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">
                  Exigences du dossier ({requirements.length})
                </p>
                <button
                  type="button"
                  onClick={addRequirement}
                  className="rounded-md border border-black/20 px-2.5 py-1 text-xs font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                >
                  + Ajouter une exigence
                </button>
              </div>
              <p className="mt-1 text-[11px] text-black/55 dark:text-white/55">
                Définissez chaque document ou pièce demandée. Exemples: offre technique, caution de soumission, attestation fiscale, etc.
              </p>

              <div className="mt-3 space-y-3">
                {requirements.map((req, index) => (
                  <div key={req.key} className="rounded-md border border-black/10 p-3 dark:border-white/10">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-xs font-bold text-black/70 dark:text-white/70">Exigence #{index + 1}</p>
                      <button
                        type="button"
                        onClick={() => removeRequirement(index)}
                        className="rounded-md border border-red-300 px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-50 dark:border-red-700/60 dark:text-red-300 dark:hover:bg-red-950/40"
                      >
                        Retirer
                      </button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input
                        value={req.label}
                        onChange={(e) => updateRequirement(index, "label", e.target.value)}
                        placeholder="Nom de la pièce (ex: Offre technique)"
                        className="rounded-md border px-2 py-2 text-sm"
                      />
                      <select
                        value={req.category}
                        onChange={(e) => updateRequirement(index, "category", e.target.value)}
                        className="rounded-md border px-2 py-2 text-sm"
                      >
                        {DEFAULT_CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>{CATEGORY_LABEL[cat] ?? cat}</option>
                        ))}
                      </select>
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-[1fr,auto]">
                      <input
                        value={req.description}
                        onChange={(e) => updateRequirement(index, "description", e.target.value)}
                        placeholder="Description / instructions sur cette pièce"
                        className="rounded-md border px-2 py-2 text-sm"
                      />
                      <label className="flex items-center gap-2 text-xs font-semibold">
                        <input
                          type="checkbox"
                          checked={req.isRequired}
                          onChange={(e) => updateRequirement(index, "isRequired", e.target.checked)}
                          className="rounded"
                        />
                        Requis
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <button className="rounded-md bg-black px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black">
              {isEditing ? "Enregistrer les modifications" : "Créer le dossier"}
            </button>
          </form>
        ) : null}

        {status ? <p className="mt-2 text-xs text-black/60 dark:text-white/60">{status}</p> : null}
      </section>

      {/* Folder list */}
      <section className="grid gap-4 lg:grid-cols-[380px,1fr]">
        {/* Sidebar: folders */}
        <div className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <h2 className="mb-3 text-base font-semibold">Dossiers DAO</h2>
          <div className="max-h-[500px] space-y-2 overflow-y-auto pr-1">
            {folders.length === 0 ? (
              <p className="text-xs text-black/60 dark:text-white/60">Aucun dossier pour le moment.</p>
            ) : (
              folders.map((folder) => {
                const reqTotal = folder.requirements.filter((r) => r.isRequired).length || 1;
                const reqDone = folder.requirements.filter((r) => {
                  if (!r.isRequired) return true;
                  return folder.documents.some((d) => d.requirementId === r.id);
                }).length;
                const pct = Math.round((reqDone / reqTotal) * 100);
                const isActive = folder.id === selectedFolderId;

                return (
                  <button
                    key={folder.id}
                    type="button"
                    onClick={() => setSelectedFolderId(folder.id)}
                    className={`w-full rounded-xl border p-3 text-left transition ${
                      isActive
                        ? "border-black/40 bg-black/5 dark:border-white/40 dark:bg-white/10"
                        : "border-black/10 hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold truncate">{folder.title}</p>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${BID_STATUS_COLORS[folder.status]}`}>
                        {BID_STATUS_LABEL[folder.status]}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-black/60 dark:text-white/60 truncate">
                      {folder.clientName || "Client non spécifié"} • {folder.reference}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-1.5 flex-1 rounded-full bg-black/10 dark:bg-white/10">
                        <div
                          className="h-1.5 rounded-full bg-emerald-500 transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-[11px] font-semibold text-black/65 dark:text-white/65">{pct}%</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Detail view */}
        <div className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          {selectedFolder ? (
            <div>
              {/* Header */}
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-black/10 pb-3 dark:border-white/10">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold">{selectedFolder.title}</h2>
                    <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${BID_STATUS_COLORS[selectedFolder.status]}`}>
                      {BID_STATUS_LABEL[selectedFolder.status]}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-black/60 dark:text-white/60">
                    {selectedFolder.reference} • {selectedFolder.clientName || "Client non spécifié"}
                    {selectedFolder.deadline ? ` • Dépôt: ${new Date(selectedFolder.deadline).toLocaleString("fr-FR")}` : ""}
                    {selectedFolder.estimatedAmount ? ` • Estimation: ${new Intl.NumberFormat("fr-FR").format(selectedFolder.estimatedAmount)} ${selectedFolder.currency}` : ""}
                  </p>
                  <p className="mt-1 text-[11px] text-black/55 dark:text-white/55">
                    Créé par {selectedFolder.createdBy.name} le {new Date(selectedFolder.createdAt).toLocaleString("fr-FR")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {canEdit(selectedFolder) ? (
                    <>
                      <button
                        type="button"
                        onClick={() => loadFolderForEdit(selectedFolder)}
                        className="rounded-md border border-black/20 px-2.5 py-1 text-xs font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                      >
                        Modifier
                      </button>
                      <select
                        value={selectedFolder.status}
                        onChange={(e) => updateFolderStatus(selectedFolder.id, e.target.value as BidStatus)}
                        className="rounded-md border px-2 py-1 text-xs"
                      >
                        <option value="IN_PROGRESS">En cours</option>
                        <option value="SUBMITTED">Soumis</option>
                        <option value="WON">Remporté</option>
                        <option value="LOST">Perdu</option>
                        <option value="CANCELLED">Annulé</option>
                      </select>
                    </>
                  ) : null}
                </div>
              </div>

              {/* Notes */}
              {selectedFolder.notes ? (
                <div className="mt-3 rounded-lg border border-black/10 bg-black/3 p-3 text-sm dark:border-white/10 dark:bg-white/3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Notes</p>
                  <p className="mt-1 text-black/80 dark:text-white/80">{selectedFolder.notes}</p>
                </div>
              ) : null}

              {/* Completion progress */}
              <div className="mt-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">
                    Complétude du dossier: {folderStats.completed}/{folderStats.total} pièces requises
                  </p>
                  <span className="text-lg font-bold">{folderStats.percent}%</span>
                </div>
                <div className="mt-2 h-3 rounded-full bg-black/10 dark:bg-white/10">
                  <div
                    className="h-3 rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${folderStats.percent}%` }}
                  />
                </div>
              </div>

              {/* Requirements and documents */}
              <div className="mt-6 space-y-4">
                <h3 className="text-sm font-semibold">Exigences et documents fournis</h3>

                {selectedFolder.requirements.length === 0 ? (
                  <p className="text-xs text-black/60 dark:text-white/60">Aucune exigence définie pour ce dossier.</p>
                ) : (
                  selectedFolder.requirements.map((req) => {
                    const docs = selectedFolder.documents.filter((d) => d.requirementId === req.id);
                    const isSatisfied = !req.isRequired || docs.length > 0;

                    return (
                      <div
                        key={req.id}
                        className={`rounded-lg border p-3 ${
                          isSatisfied
                            ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800/50 dark:bg-emerald-950/20"
                            : "border-amber-200 bg-amber-50/50 dark:border-amber-800/50 dark:bg-amber-950/20"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-base">{isSatisfied ? "✅" : "⏳"}</span>
                              <p className="text-sm font-semibold">{req.label}</p>
                              <span className="rounded-full border border-black/15 px-2 py-0.5 text-[10px] font-semibold dark:border-white/20">
                                {CATEGORY_LABEL[req.category] ?? req.category}
                              </span>
                              {req.isRequired ? (
                                <span className="text-[11px] text-red-600 dark:text-red-400">Requis</span>
                              ) : (
                                <span className="text-[11px] text-black/50 dark:text-white/50">Optionnel</span>
                              )}
                            </div>
                            {req.description ? (
                              <p className="mt-1 text-xs text-black/65 dark:text-white/65">{req.description}</p>
                            ) : null}
                          </div>
                        </div>

                        {/* Upload form for this requirement */}
                        <div className="mt-3">
                          <form
                            action="/api/dao/documents"
                            method="POST"
                            encType="multipart/form-data"
                            className="flex flex-wrap items-end gap-2"
                          >
                            <input type="hidden" name="bidFolderId" value={selectedFolder.id} />
                            <input type="hidden" name="requirementId" value={req.id} />
                            <input
                              name="label"
                              required
                              placeholder="Libellé du document"
                              defaultValue={req.label}
                              className="rounded-md border px-2.5 py-2 text-xs flex-1 min-w-[140px]"
                            />
                            <input
                              name="file"
                              type="file"
                              required
                              accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp"
                              className="rounded-md border px-2.5 py-2 text-xs flex-1 min-w-[140px]"
                            />
                            <button className="rounded-md bg-black px-3 py-2 text-xs font-semibold text-white dark:bg-white dark:text-black">
                              Upload
                            </button>
                          </form>
                        </div>

                        {/* Uploaded documents */}
                        {docs.length > 0 ? (
                          <div className="mt-3 space-y-1.5">
                            <p className="text-[11px] font-semibold text-black/60 dark:text-white/60">
                              Documents ({docs.length})
                            </p>
                            {docs.map((doc) => (
                              <div
                                key={doc.id}
                                className="flex items-center justify-between gap-2 rounded-md border border-black/10 bg-white px-3 py-1.5 text-xs dark:border-white/10 dark:bg-zinc-900"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="shrink-0 font-semibold">
                                    {mimeTypeLabel(doc.mimeType)}
                                  </span>
                                  <span className="truncate">{doc.originalFileName}</span>
                                  <span className="shrink-0 text-black/50 dark:text-white/50">
                                    ({sizeLabel(doc.fileSize)})
                                  </span>
                                  <span className="shrink-0 text-black/50 dark:text-white/50">
                                    • {doc.uploadedBy.name}
                                  </span>
                                </div>
                                <div className="flex shrink-0 gap-1.5">
                                  <a
                                    href={`/api/dao/documents/${doc.id}/download`}
                                    className="rounded-md border border-black/15 px-2 py-1 font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                                  >
                                    Ouvrir
                                  </a>
                                  <button
                                    type="button"
                                    onClick={() => deleteDocument(doc.id)}
                                    className="rounded-md border border-red-300 px-2 py-1 font-semibold text-red-700 hover:bg-red-50 dark:border-red-700/60 dark:text-red-300 dark:hover:bg-red-950/40"
                                  >
                                    ×
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-2 text-[11px] text-black/50 dark:text-white/50 italic">
                            Aucun document uploadé pour cette exigence.
                          </p>
                        )}
                      </div>
                    );
                  })
                )}

                {/* Documents without requirement */}
                {selectedFolder.documents.some((d) => !d.requirementId) ? (
                  <div className="mt-4">
                    <h4 className="mb-2 text-sm font-semibold">Autres documents du dossier</h4>
                    <div className="space-y-1.5">
                      {selectedFolder.documents
                        .filter((d) => !d.requirementId)
                        .map((doc) => (
                          <div
                            key={doc.id}
                            className="flex items-center justify-between gap-2 rounded-md border border-black/10 bg-white px-3 py-1.5 text-xs dark:border-white/10 dark:bg-zinc-900"
                          >
                            <span className="font-semibold">{doc.label}</span>
                            <span className="truncate">{doc.originalFileName}</span>
                            <span className="shrink-0">{mimeTypeLabel(doc.mimeType)} • {sizeLabel(doc.fileSize)}</span>
                            <div className="flex gap-1.5">
                              <a
                                href={`/api/dao/documents/${doc.id}/download`}
                                className="rounded-md border border-black/15 px-2 py-1 font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                              >
                                Ouvrir
                              </a>
                              <button
                                type="button"
                                onClick={() => deleteDocument(doc.id)}
                                className="rounded-md border border-red-300 px-2 py-1 font-semibold text-red-700 hover:bg-red-50 dark:border-red-700/60 dark:text-red-300 dark:hover:bg-red-950/40"
                              >
                                ×
                              </button>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center py-12">
              <p className="text-sm text-black/60 dark:text-white/60">
                Sélectionnez un dossier DAO à gauche pour voir les détails.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
