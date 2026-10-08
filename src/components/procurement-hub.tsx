"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { parseNeedQuote } from "@/lib/need-lines";
import {
  WORKFLOW_ASSIGNMENT_OPTIONS,
  workflowAssignmentLabel,
  type WorkflowAssignmentValue,
} from "@/lib/workflow-assignment";

type NeedStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";
type MovementType = "IN" | "OUT";
type ProcurementView = "needs" | "stock";

type NeedItem = {
  id: string;
  code?: string | null;
  title: string;
  category: string;
  details: string;
  quantity: number;
  unit: string;
  estimatedAmount?: number | null;
  currency?: string | null;
  status: NeedStatus;
  requester: { id: string; name: string; jobTitle: string };
  reviewedBy?: { id: string; name: string } | null;
  reviewComment?: string | null;
  submittedAt?: string | null;
  approvedAt?: string | null;
  sealedAt?: string | null;
  createdAt: string;
};

type StockItem = {
  id: string;
  name: string;
  category: string;
  unit: string;
  currentQuantity: number;
  reorderLevel?: number | null;
  updatedAt: string;
};

type StockMovement = {
  id: string;
  movementType: MovementType;
  quantity: number;
  justification: string;
  referenceDoc: string;
  createdAt: string;
  stockItem: { id: string; name: string; category: string; unit: string };
  performedBy: { id: string; name: string };
  needRequest?: { id: string; title: string } | null;
};

type NeedLineForm = {
  designation: string;
  description: string;
  quantity: string;
  unitPrice: string;
};

type NeedUrgencyLevel = "CRITIQUE" | "ELEVEE" | "NORMALE" | "FAIBLE";
type NeedBeneficiaryTeam = "KINSHASA" | "LUBUMBASHI" | "MBUJIMAYI";

const URGENCY_LABEL: Record<NeedUrgencyLevel, string> = {
  CRITIQUE: "Critique",
  ELEVEE: "Élevée",
  NORMALE: "Normale",
  FAIBLE: "Faible",
};

const BENEFICIARY_LABEL: Record<NeedBeneficiaryTeam, string> = {
  KINSHASA: "Kinshasa",
  LUBUMBASHI: "Lubumbashi",
  MBUJIMAYI: "Mbujimayi",
};

const VIEW_ITEMS: { key: ProcurementView; label: string }[] = [
  { key: "needs", label: "États de besoin" },
  { key: "stock", label: "Stock" },
];

function resolveProcurementView(value: string | null | undefined): ProcurementView | null {
  if (!value) return null;
  const normalized = value.replace(/^#/, "").trim().toLowerCase();
  if (normalized === "needs" || normalized === "edb") return "needs";
  if (normalized === "stock") return "stock";
  return null;
}

function defaultProcurementView(): ProcurementView {
  if (typeof window === "undefined") return "needs";
  const url = new URL(window.location.href);
  return resolveProcurementView(url.searchParams.get("view"))
    ?? resolveProcurementView(window.location.hash)
    ?? "needs";
}

function viewToneClass(active: boolean) {
  if (!active) {
    return "border border-black/15 text-black/75 hover:bg-black/5 dark:border-white/15 dark:text-white/75 dark:hover:bg-white/10";
  }
  return "border border-emerald-500 bg-emerald-50 text-emerald-800 dark:border-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300";
}

function parseNeedMeta(details: string) {
  type NeedMeta = {
    urgencyLevel: NeedUrgencyLevel | null;
    beneficiaryTeam: NeedBeneficiaryTeam | null;
    beneficiaryPersonId: string | null;
    beneficiaryPersonName: string | null;
    items: Array<{ designation: string; description: string; quantity: number; unitPrice: number }>;
    assignment: WorkflowAssignmentValue;
  };

  const parsed = parseNeedQuote(details);
  if (!parsed) {
    const meta: NeedMeta = { urgencyLevel: null, beneficiaryTeam: null, beneficiaryPersonId: null, beneficiaryPersonName: null, assignment: "A_MON_COMPTE", items: [] };
    return meta;
  }

  return {
    urgencyLevel: parsed.urgencyLevel ?? null,
    beneficiaryTeam: parsed.beneficiaryTeam ?? null,
    beneficiaryPersonId: parsed.beneficiaryPersonId ?? null,
    beneficiaryPersonName: parsed.beneficiaryPersonName ?? null,
    assignment: parsed.assignment ?? "A_MON_COMPTE",
    items: parsed.items.map((item) => ({
      designation: item.designation,
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
    })),
  };
}

function statusLabel(status: NeedStatus) {
  if (status === "SUBMITTED") return "Soumis";
  if (status === "APPROVED") return "Approuvé";
  if (status === "REJECTED") return "Rejeté";
  return "Brouillon";
}

function hasCashExecutionMarker(value?: string | null) {
  return (value ?? "").includes("EXECUTION_CAISSE:");
}

function parseDecimal(value: string | number | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/,/g, ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeMoneyCurrency(value?: string | null): "USD" | "CDF" {
  const normalized = (value ?? "CDF").trim().toUpperCase();
  return normalized === "USD" ? "USD" : "CDF";
}

type UserOption = { id: string; name: string; teamName: string | null };

export function ProcurementHub({
  initialNeeds,
  initialStock,
  initialMovements,
  canCreateNeed,
  canManageStock,
  allUsers = [],
}: {
  initialNeeds: NeedItem[];
  initialStock: StockItem[];
  initialMovements: StockMovement[];
  canCreateNeed: boolean;
  canManageStock: boolean;
  allUsers?: UserOption[];
  /** @deprecated validation DG via inbox uniquement */
  canApproveNeed?: boolean;
  hideNeedWorkflow?: boolean;
  hideDynamicStock?: boolean;
}) {
  const defaultReportMonth = new Date().toISOString().slice(0, 7);
  const [view, setView] = useState<ProcurementView>(defaultProcurementView);
  const [needs, setNeeds] = useState(initialNeeds);
  const [stockItems, setStockItems] = useState(initialStock);
  const [movements, setMovements] = useState(initialMovements);
  const [needStatus, setNeedStatus] = useState("");
  const [stockCatalogStatus, setStockCatalogStatus] = useState("");
  const [stockStatus, setStockStatus] = useState("");
  const [editingNeedId, setEditingNeedId] = useState<string | null>(null);
  const [needTitle, setNeedTitle] = useState("");
  const [selectedUrgencyLevel, setSelectedUrgencyLevel] = useState<NeedUrgencyLevel>("NORMALE");
  const [stockReportMonth, setStockReportMonth] = useState(defaultReportMonth);
  const [needStatusFilter, setNeedStatusFilter] = useState<"ALL" | NeedStatus>("ALL");
  const [needSearch, setNeedSearch] = useState("");
  const [showNeedForm, setShowNeedForm] = useState(false);
  const [needLines, setNeedLines] = useState<NeedLineForm[]>([
    { designation: "", description: "", quantity: "1", unitPrice: "0" },
  ]);
  const [needCurrency, setNeedCurrency] = useState<"CDF" | "USD">("CDF");
  const [selectedBeneficiaryTeam, setSelectedBeneficiaryTeam] = useState<NeedBeneficiaryTeam>("KINSHASA");
  const [selectedBeneficiaryPerson, setSelectedBeneficiaryPerson] = useState("");
  const [selectedAssignment, setSelectedAssignment] = useState<WorkflowAssignmentValue>("A_MON_COMPTE");
  const [movementStockItemId, setMovementStockItemId] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;

    const syncViewFromUrl = () => {
      setView(defaultProcurementView());
    };

    syncViewFromUrl();
    window.addEventListener("hashchange", syncViewFromUrl);
    window.addEventListener("popstate", syncViewFromUrl);
    return () => {
      window.removeEventListener("hashchange", syncViewFromUrl);
      window.removeEventListener("popstate", syncViewFromUrl);
    };
  }, []);

  function selectView(nextView: ProcurementView) {
    setView(nextView);
    if (typeof window === "undefined") return;

    const url = new URL(window.location.href);
    url.searchParams.set("view", nextView);
    url.hash = nextView;
    window.history.replaceState(window.history.state, "", url.toString());
  }

  const filteredUsers = useMemo(() => {
    const keyword = selectedBeneficiaryTeam.toLowerCase();
    return allUsers.filter((u) => u.teamName?.toLowerCase().includes(keyword) ?? false);
  }, [allUsers, selectedBeneficiaryTeam]);

  const approvedNeeds = useMemo(
    () => needs.filter((need) => need.status === "APPROVED" && !hasCashExecutionMarker(need.reviewComment)),
    [needs],
  );

  const submittedCount = useMemo(
    () => needs.filter((need) => need.status === "SUBMITTED").length,
    [needs],
  );

  const quoteTotal = useMemo(
    () => needLines.reduce((sum, line) => sum + (parseDecimal(line.quantity) * parseDecimal(line.unitPrice)), 0),
    [needLines],
  );

  const selectedMovementItem = useMemo(
    () => stockItems.find((item) => item.id === movementStockItemId) ?? null,
    [stockItems, movementStockItemId],
  );

  const visibleNeeds = useMemo(() => {
    const search = needSearch.trim().toLowerCase();
    return needs.filter((need) => {
      const statusOk = needStatusFilter === "ALL" || need.status === needStatusFilter;
      if (!statusOk) return false;
      if (!search) return true;

      const meta = parseNeedMeta(need.details);
      const haystack = [
        need.code ?? "",
        need.title,
        need.requester.name,
        workflowAssignmentLabel(meta.assignment),
        meta.beneficiaryPersonName ?? "",
        meta.beneficiaryTeam ? BENEFICIARY_LABEL[meta.beneficiaryTeam] : "",
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(search);
    });
  }, [needs, needSearch, needStatusFilter]);

  const isEditingNeed = editingNeedId !== null;

  function isNeedEditable(need: NeedItem) {
    return (need.status === "SUBMITTED" || need.status === "DRAFT") && !hasCashExecutionMarker(need.reviewComment);
  }

  function updateNeedLine(index: number, key: keyof NeedLineForm, value: string) {
    setNeedLines((prev) => prev.map((line, lineIndex) => (lineIndex === index ? { ...line, [key]: value } : line)));
  }

  function resetNeedForm() {
    setEditingNeedId(null);
    setNeedTitle("");
    setSelectedUrgencyLevel("NORMALE");
    setSelectedBeneficiaryTeam("KINSHASA");
    setSelectedBeneficiaryPerson("");
    setSelectedAssignment("A_MON_COMPTE");
    setNeedCurrency("CDF");
    setNeedLines([{ designation: "", description: "", quantity: "1", unitPrice: "0" }]);
    setNeedStatus("");
  }

  function startNeedEdit(need: NeedItem) {
    const meta = parseNeedMeta(need.details);
    setEditingNeedId(need.id);
    setNeedTitle(need.title);
    setSelectedUrgencyLevel(meta.urgencyLevel ?? "NORMALE");
    setSelectedBeneficiaryTeam(meta.beneficiaryTeam ?? "KINSHASA");
    setSelectedBeneficiaryPerson(meta.beneficiaryPersonId ?? "");
    setSelectedAssignment(meta.assignment ?? "A_MON_COMPTE");
    setNeedCurrency(normalizeMoneyCurrency(need.currency));
    setNeedLines(
      meta.items.length > 0
        ? meta.items.map((item) => ({
          designation: item.designation,
          description: item.description,
          quantity: String(item.quantity || 1),
          unitPrice: String(item.unitPrice || 0),
        }))
        : [{ designation: need.title, description: "", quantity: String(need.quantity || 1), unitPrice: String(need.estimatedAmount || 0) }],
    );
    setShowNeedForm(true);
    selectView("needs");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function addNeedLine() {
    setNeedLines((prev) => [...prev, { designation: "", description: "", quantity: "1", unitPrice: "0" }]);
  }

  function removeNeedLine(index: number) {
    setNeedLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, lineIndex) => lineIndex !== index)));
  }

  async function refreshData() {
    const [needsRes, stockRes, movementsRes] = await Promise.all([
      fetch("/api/procurement/needs", { cache: "no-store" }),
      fetch("/api/procurement/stock/items", { cache: "no-store" }),
      fetch("/api/procurement/stock/movements", { cache: "no-store" }),
    ]);

    if (needsRes.ok) {
      const payload = await needsRes.json();
      setNeeds(payload.data ?? []);
    }

    if (stockRes.ok) {
      const payload = await stockRes.json();
      setStockItems(payload.data ?? []);
    }

    if (movementsRes.ok) {
      const payload = await movementsRes.json();
      setMovements(payload.data ?? []);
    }
  }

  async function submitNeed(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCreateNeed) return;

    const items = needLines
      .map((line) => ({
        designation: line.designation.trim(),
        description: line.description.trim(),
        quantity: parseDecimal(line.quantity),
        unitPrice: parseDecimal(line.unitPrice),
      }))
      .filter((line) => line.designation.length > 0 && line.quantity > 0 && line.unitPrice >= 0);

    if (items.length === 0) {
      setNeedStatus("Ajoutez au moins une ligne valide.");
      return;
    }

    setNeedStatus("En cours…");

    const beneficiaryPersonId = selectedBeneficiaryPerson.trim() || undefined;
    const beneficiaryPersonName = beneficiaryPersonId
      ? allUsers.find((u) => u.id === beneficiaryPersonId)?.name
      : undefined;

    const response = await fetch("/api/procurement/needs", {
      method: isEditingNeed ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(isEditingNeed ? { needRequestId: editingNeedId } : {}),
        title: needTitle,
        urgencyLevel: selectedUrgencyLevel,
        beneficiaryTeam: selectedBeneficiaryTeam,
        beneficiaryPersonId,
        beneficiaryPersonName,
        assignment: selectedAssignment,
        currency: needCurrency,
        items,
      }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setNeedStatus(payload?.error?.formErrors?.[0] ?? payload?.error ?? "Erreur.");
      return;
    }

    setNeedStatus(isEditingNeed ? "Modifications enregistrées." : "État de besoin émis.");
    resetNeedForm();
    setShowNeedForm(false);
    await refreshData();
  }

  async function submitStockItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManageStock) return;

    const form = event.currentTarget;
    const formData = new FormData(form);

    setStockCatalogStatus("En cours…");

    const response = await fetch("/api/procurement/stock/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        itemName: String(formData.get("itemName") ?? ""),
        category: String(formData.get("category") ?? ""),
        unit: String(formData.get("unit") ?? ""),
      }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setStockCatalogStatus(payload?.error?.formErrors?.[0] ?? payload?.error ?? "Erreur.");
      return;
    }

    setStockCatalogStatus("Article ajouté.");
    form.reset();
    await refreshData();
  }

  async function submitStockMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManageStock) return;

    const form = event.currentTarget;
    const formData = new FormData(form);
    const item = selectedMovementItem;

    if (!item) {
      setStockStatus("Choisissez un article du stock.");
      return;
    }

    setStockStatus("En cours…");

    const response = await fetch("/api/procurement/stock/movements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        itemName: item.name,
        category: item.category,
        unit: item.unit,
        movementType: String(formData.get("movementType") ?? "IN"),
        quantity: Number(formData.get("quantity") ?? 0),
        justification: String(formData.get("justification") ?? ""),
        referenceDoc: String(formData.get("referenceDoc") ?? ""),
        needRequestId: String(formData.get("needRequestId") ?? "") || undefined,
      }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setStockStatus(payload?.error?.formErrors?.[0] ?? payload?.error ?? "Erreur.");
      return;
    }

    setStockStatus("Mouvement enregistré.");
    form.reset();
    setMovementStockItemId("");
    await refreshData();
  }

  const needsPanel = (
    <div className="space-y-4">
      {canCreateNeed ? (
        <section className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">
              {isEditingNeed ? "Modifier l'état de besoin" : "État de besoin"}
            </h2>
            <div className="flex gap-2">
              {isEditingNeed ? (
                <button
                  type="button"
                  onClick={resetNeedForm}
                  className="rounded-md border border-black/20 px-2.5 py-1 text-xs font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                >
                  Annuler
                </button>
              ) : null}
              {!isEditingNeed ? (
                <button
                  type="button"
                  onClick={() => setShowNeedForm((open) => !open)}
                  className="rounded-md border border-black/20 px-2.5 py-1 text-xs font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                >
                  {showNeedForm ? "Masquer" : "Nouveau"}
                </button>
              ) : null}
            </div>
          </div>

          {showNeedForm || isEditingNeed ? (
            <form onSubmit={submitNeed} className="mt-3 grid gap-2">
              <input
                name="title"
                required
                value={needTitle}
                onChange={(event) => setNeedTitle(event.target.value)}
                placeholder="Objet"
                className="rounded-md border px-3 py-2 text-sm"
              />
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <select name="urgencyLevel" value={selectedUrgencyLevel} onChange={(event) => setSelectedUrgencyLevel(event.target.value as NeedUrgencyLevel)} required className="rounded-md border px-3 py-2 text-sm">
                  <option value="CRITIQUE">Critique</option>
                  <option value="ELEVEE">Élevée</option>
                  <option value="NORMALE">Normale</option>
                  <option value="FAIBLE">Faible</option>
                </select>
                <select
                  name="assignment"
                  value={selectedAssignment}
                  onChange={(event) => setSelectedAssignment(event.target.value as WorkflowAssignmentValue)}
                  required
                  className="rounded-md border px-3 py-2 text-sm"
                >
                  {WORKFLOW_ASSIGNMENT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <select
                  name="beneficiaryTeam"
                  value={selectedBeneficiaryTeam}
                  onChange={(e) => {
                    setSelectedBeneficiaryTeam(e.target.value as NeedBeneficiaryTeam);
                    setSelectedBeneficiaryPerson("");
                  }}
                  required
                  className="rounded-md border px-3 py-2 text-sm"
                >
                  <option value="KINSHASA">Kinshasa</option>
                  <option value="LUBUMBASHI">Lubumbashi</option>
                  <option value="MBUJIMAYI">Mbujimayi</option>
                </select>
                <select
                  name="currency"
                  value={needCurrency}
                  onChange={(event) => setNeedCurrency(event.target.value as "CDF" | "USD")}
                  className="rounded-md border px-3 py-2 text-sm"
                >
                  <option value="CDF">CDF</option>
                  <option value="USD">USD</option>
                </select>
              </div>
              <select
                name="beneficiaryPersonId"
                value={selectedBeneficiaryPerson}
                onChange={(e) => setSelectedBeneficiaryPerson(e.target.value)}
                className="rounded-md border px-3 py-2 text-sm"
              >
                <option value="">Bénéficiaire (optionnel)</option>
                {filteredUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>

              <div className="rounded-lg border border-black/10 p-3 dark:border-white/10">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-black/70 dark:text-white/70">Lignes</p>
                  <button
                    type="button"
                    onClick={addNeedLine}
                    className="rounded-md border border-black/20 px-2 py-1 text-xs font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                  >
                    + Ligne
                  </button>
                </div>

                <div className="mt-2 max-h-56 space-y-2 overflow-y-auto">
                  {needLines.map((line, index) => {
                    const lineTotal = parseDecimal(line.quantity) * parseDecimal(line.unitPrice);

                    return (
                      <div key={`line-${index}`} className="grid gap-2 rounded-md border border-black/10 p-2 dark:border-white/10 sm:grid-cols-[1fr,1fr,80px,100px,100px,auto] sm:items-center">
                        <input
                          value={line.designation}
                          onChange={(event) => updateNeedLine(index, "designation", event.target.value)}
                          placeholder="Désignation"
                          className="rounded-md border px-2 py-1.5 text-sm sm:col-span-1"
                        />
                        <input
                          value={line.description}
                          onChange={(event) => updateNeedLine(index, "description", event.target.value)}
                          placeholder="Description"
                          className="rounded-md border px-2 py-1.5 text-sm"
                        />
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={line.quantity}
                          onChange={(event) => updateNeedLine(index, "quantity", event.target.value)}
                          placeholder="Qté"
                          className="rounded-md border px-2 py-1.5 text-sm"
                        />
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.unitPrice}
                          onChange={(event) => updateNeedLine(index, "unitPrice", event.target.value)}
                          placeholder="P.U."
                          className="rounded-md border px-2 py-1.5 text-sm"
                        />
                        <span className="text-xs font-semibold tabular-nums">{lineTotal.toFixed(2)}</span>
                        <button
                          type="button"
                          onClick={() => removeNeedLine(index)}
                          disabled={needLines.length <= 1}
                          className="rounded-md border border-red-200 px-2 py-1 text-[11px] font-semibold text-red-700 disabled:opacity-40 dark:border-red-800 dark:text-red-300"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-2 text-sm font-semibold tabular-nums">
                  Total : {quoteTotal.toFixed(2)} {needCurrency}
                </p>
              </div>

              <button className="w-fit rounded-md bg-black px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black">
                {isEditingNeed ? "Enregistrer" : "Émettre"}
              </button>
            </form>
          ) : null}

          {needStatus ? <p className="mt-2 text-xs text-black/60 dark:text-white/60">{needStatus}</p> : null}
        </section>
      ) : null}

      <section className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-base font-semibold">Liste</h2>
          <p className="text-xs text-black/55 dark:text-white/55">
            {needs.length} EDB · {submittedCount} en attente
          </p>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-[180px,1fr]">
          <select
            value={needStatusFilter}
            onChange={(event) => setNeedStatusFilter(event.target.value as "ALL" | NeedStatus)}
            className="rounded-md border px-3 py-2 text-sm"
          >
            <option value="ALL">Tous</option>
            <option value="SUBMITTED">Soumis</option>
            <option value="APPROVED">Approuvés</option>
            <option value="REJECTED">Rejetés</option>
            <option value="DRAFT">Brouillons</option>
          </select>
          <input
            value={needSearch}
            onChange={(event) => setNeedSearch(event.target.value)}
            placeholder="Rechercher…"
            className="rounded-md border px-3 py-2 text-sm"
          />
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-black/5 dark:bg-white/10">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Réf.</th>
                <th className="px-3 py-2 text-left font-semibold">Objet</th>
                <th className="px-3 py-2 text-left font-semibold">Demandeur</th>
                <th className="px-3 py-2 text-left font-semibold">Urgence</th>
                <th className="px-3 py-2 text-left font-semibold">Montant</th>
                <th className="px-3 py-2 text-left font-semibold">Statut</th>
                <th className="px-3 py-2 text-left font-semibold">Date</th>
                <th className="px-3 py-2 text-left font-semibold" />
              </tr>
            </thead>
            <tbody>
              {visibleNeeds.slice(0, 40).map((need) => {
                const meta = parseNeedMeta(need.details);
                return (
                  <tr key={need.id} className="border-t border-black/10 dark:border-white/10">
                    <td className="px-3 py-2 font-mono text-xs text-blue-700 dark:text-blue-400 whitespace-nowrap">{need.code ?? "-"}</td>
                    <td className="px-3 py-2 font-medium">{need.title}</td>
                    <td className="px-3 py-2">{need.requester.name}</td>
                    <td className="px-3 py-2 text-xs">{meta.urgencyLevel ? URGENCY_LABEL[meta.urgencyLevel] : "-"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {typeof need.estimatedAmount === "number"
                        ? `${new Intl.NumberFormat("fr-FR").format(need.estimatedAmount)} ${normalizeMoneyCurrency(need.currency)}`
                        : "-"}
                    </td>
                    <td className="px-3 py-2">
                      <span className="rounded-full border border-black/15 px-2 py-0.5 text-[11px] font-semibold dark:border-white/20">
                        {hasCashExecutionMarker(need.reviewComment) ? "Exécuté" : statusLabel(need.status)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-black/65 dark:text-white/65">{new Date(need.createdAt).toLocaleDateString()}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        <a
                          href={`/approvisionnement/${need.id}`}
                          className="rounded-md border border-black/20 px-2 py-1 text-[11px] font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                        >
                          Voir
                        </a>
                        <a
                          href={`/api/procurement/needs/${need.id}/pdf`}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-md border border-black/20 px-2 py-1 text-[11px] font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                        >
                          PDF
                        </a>
                        {canCreateNeed && isNeedEditable(need) ? (
                          <button
                            type="button"
                            onClick={() => startNeedEdit(need)}
                            className="rounded-md border border-emerald-300 px-2 py-1 text-[11px] font-semibold text-emerald-700 dark:border-emerald-700/60 dark:text-emerald-300"
                          >
                            Modifier
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {visibleNeeds.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-sm text-black/60 dark:text-white/60">
                    Aucun résultat.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );

  const stockPanel = (
    <div className="space-y-4">
      {canManageStock ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
            <h2 className="text-base font-semibold">Nouvel article</h2>
            <form onSubmit={submitStockItem} className="mt-3 grid gap-2">
              <input name="itemName" required placeholder="Nom" className="rounded-md border px-3 py-2 text-sm" />
              <div className="grid gap-2 sm:grid-cols-2">
                <input name="category" required placeholder="Catégorie" className="rounded-md border px-3 py-2 text-sm" />
                <input name="unit" required placeholder="Unité" className="rounded-md border px-3 py-2 text-sm" />
              </div>
              <button className="w-fit rounded-md bg-black px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black">
                Ajouter
              </button>
            </form>
            {stockCatalogStatus ? <p className="mt-2 text-xs text-black/60 dark:text-white/60">{stockCatalogStatus}</p> : null}
          </section>

          <section className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
            <h2 className="text-base font-semibold">Mouvement</h2>
            <form onSubmit={submitStockMovement} className="mt-3 grid gap-2">
              <select
                required
                value={movementStockItemId}
                onChange={(e) => setMovementStockItemId(e.target.value)}
                className="rounded-md border px-3 py-2 text-sm"
              >
                <option value="">Article</option>
                {stockItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.currentQuantity} {item.unit})
                  </option>
                ))}
              </select>
              <div className="grid gap-2 sm:grid-cols-3">
                <input name="quantity" type="number" min="0.01" step="0.01" required placeholder="Quantité" className="rounded-md border px-3 py-2 text-sm" />
                <select name="movementType" defaultValue="IN" className="rounded-md border px-3 py-2 text-sm">
                  <option value="IN">Entrée</option>
                  <option value="OUT">Sortie</option>
                </select>
                <select name="needRequestId" className="rounded-md border px-3 py-2 text-sm">
                  <option value="">Sans EDB</option>
                  {approvedNeeds.map((need) => (
                    <option key={need.id} value={need.id}>{need.code ?? need.title}</option>
                  ))}
                </select>
              </div>
              <input name="referenceDoc" required placeholder="Réf. justificatif" className="rounded-md border px-3 py-2 text-sm" />
              <textarea name="justification" required rows={2} placeholder="Motif" className="rounded-md border px-3 py-2 text-sm" />
              <button className="w-fit rounded-md bg-black px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black">
                Enregistrer
              </button>
            </form>
            {stockStatus ? <p className="mt-2 text-xs text-black/60 dark:text-white/60">{stockStatus}</p> : null}
          </section>
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-black/20 px-4 py-3 text-sm text-black/70 dark:border-white/20 dark:text-white/70">
          Gestion du stock réservée au service approvisionnement.
        </p>
      )}

      <section className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">
            Inventaire · {stockItems.length} articles
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <input
              type="month"
              value={stockReportMonth}
              onChange={(event) => setStockReportMonth(event.target.value || defaultReportMonth)}
              className="rounded-md border border-black/15 bg-transparent px-2 py-1 dark:border-white/20"
            />
            <a
              href={`/api/procurement/stock/report?mode=month&month=${encodeURIComponent(stockReportMonth)}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-black/20 px-2.5 py-1 font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
            >
              PDF
            </a>
          </div>
        </div>

        <div className="mt-3 max-h-72 overflow-auto rounded-md border border-black/10 dark:border-white/10">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-black/5 dark:bg-zinc-800">
              <tr className="text-left">
                <th className="px-2 py-2">Produit</th>
                <th className="px-2 py-2">Catégorie</th>
                <th className="px-2 py-2">Stock</th>
              </tr>
            </thead>
            <tbody>
              {stockItems.map((item) => (
                <tr key={item.id} className="border-t border-black/5 dark:border-white/10">
                  <td className="px-2 py-2">{item.name}</td>
                  <td className="px-2 py-2">{item.category}</td>
                  <td className="px-2 py-2 font-semibold tabular-nums">
                    {item.currentQuantity} {item.unit}
                    {item.currentQuantity <= 5 ? (
                      <span className="ml-1 text-[10px] font-semibold text-amber-700 dark:text-amber-400">bas</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className="mt-4 text-sm font-semibold">Derniers mouvements</h3>
        <div className="mt-2 max-h-48 space-y-1.5 overflow-y-auto">
          {movements.length > 0 ? movements.slice(0, 12).map((movement) => (
            <p key={movement.id} className="text-xs text-black/75 dark:text-white/75">
              <span className="font-semibold">{movement.movementType === "IN" ? "+" : "−"}</span>
              {" "}{movement.quantity} {movement.stockItem.unit} {movement.stockItem.name}
              {" · "}{movement.referenceDoc}
              {" · "}{new Date(movement.createdAt).toLocaleDateString()}
            </p>
          )) : (
            <p className="text-xs text-black/60 dark:text-white/60">Aucun mouvement.</p>
          )}
        </div>
      </section>
    </div>
  );

  return (
    <section className="grid items-start gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm lg:sticky lg:top-28 dark:border-white/10 dark:bg-zinc-900">
        <div className="space-y-2">
          {VIEW_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => selectView(item.key)}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-semibold transition ${viewToneClass(view === item.key)}`}
            >
              <span>{item.label}</span>
              <span>›</span>
            </button>
          ))}
        </div>
      </aside>

      <div className="min-w-0">
        {view === "needs" ? needsPanel : stockPanel}
      </div>
    </section>
  );
}
