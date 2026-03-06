"use client";

import { FormEvent, useMemo, useState } from "react";
import { parseNeedQuote } from "@/lib/need-lines";

type NeedStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";
type MovementType = "IN" | "OUT";

type NeedItem = {
  id: string;
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

function statusLabel(status: NeedStatus) {
  if (status === "SUBMITTED") return "Soumis";
  if (status === "APPROVED") return "Approuvé";
  if (status === "REJECTED") return "Rejeté";
  return "Brouillon";
}

export function ProcurementHub({
  initialNeeds,
  initialStock,
  initialMovements,
  canCreateNeed,
  canApproveNeed,
  canManageStock,
}: {
  initialNeeds: NeedItem[];
  initialStock: StockItem[];
  initialMovements: StockMovement[];
  canCreateNeed: boolean;
  canApproveNeed: boolean;
  canManageStock: boolean;
}) {
  const [needs, setNeeds] = useState(initialNeeds);
  const [stockItems, setStockItems] = useState(initialStock);
  const [movements, setMovements] = useState(initialMovements);
  const [needStatus, setNeedStatus] = useState("");
  const [stockStatus, setStockStatus] = useState("");
  const [approvalStatus, setApprovalStatus] = useState("");
  const [needLines, setNeedLines] = useState<NeedLineForm[]>([
    { designation: "", description: "", quantity: "1", unitPrice: "0" },
  ]);

  const approvedNeeds = useMemo(
    () => needs.filter((need) => need.status === "APPROVED"),
    [needs],
  );

  const quoteTotal = useMemo(
    () => needLines.reduce((sum, line) => sum + ((Number(line.quantity) || 0) * (Number(line.unitPrice) || 0)), 0),
    [needLines],
  );

  function updateNeedLine(index: number, key: keyof NeedLineForm, value: string) {
    setNeedLines((prev) => prev.map((line, lineIndex) => (lineIndex === index ? { ...line, [key]: value } : line)));
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

    const form = event.currentTarget;
    const formData = new FormData(form);

    const items = needLines
      .map((line) => ({
        designation: line.designation.trim(),
        description: line.description.trim(),
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
      }))
      .filter((line) => line.designation.length > 0 && line.quantity > 0 && line.unitPrice >= 0);

    if (items.length === 0) {
      setNeedStatus("Ajoutez au moins une ligne avec désignation, quantité et prix unitaire.");
      return;
    }

    setNeedStatus("Émission en cours...");

    const response = await fetch("/api/procurement/needs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: String(formData.get("title") ?? ""),
        category: String(formData.get("category") ?? ""),
        currency: String(formData.get("currency") ?? "XAF").trim() || "XAF",
        items,
      }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setNeedStatus(payload?.error?.formErrors?.[0] ?? payload?.error ?? "Erreur lors de l'émission.");
      return;
    }

    setNeedStatus("État de besoin émis et transféré à la Direction/Finance.");
    form.reset();
    setNeedLines([{ designation: "", description: "", quantity: "1", unitPrice: "0" }]);
    await refreshData();
  }

  async function submitApproval(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canApproveNeed) return;

    const form = event.currentTarget;
    const formData = new FormData(form);
    setApprovalStatus("Validation en cours...");

    const response = await fetch("/api/procurement/needs/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        needRequestId: String(formData.get("needRequestId") ?? ""),
        status: String(formData.get("status") ?? "APPROVED"),
        reviewComment: String(formData.get("reviewComment") ?? "").trim() || undefined,
      }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setApprovalStatus(payload?.error?.formErrors?.[0] ?? payload?.error ?? "Erreur de validation.");
      return;
    }

    setApprovalStatus("Décision enregistrée.");
    form.reset();
    await refreshData();
  }

  async function submitStockMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManageStock) return;

    const form = event.currentTarget;
    const formData = new FormData(form);
    setStockStatus("Mise à jour de la fiche stock...");

    const response = await fetch("/api/procurement/stock/movements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        itemName: String(formData.get("itemName") ?? ""),
        category: String(formData.get("category") ?? ""),
        unit: String(formData.get("unit") ?? ""),
        movementType: String(formData.get("movementType") ?? "IN"),
        quantity: Number(formData.get("quantity") ?? 0),
        justification: String(formData.get("justification") ?? ""),
        referenceDoc: String(formData.get("referenceDoc") ?? ""),
        needRequestId: String(formData.get("needRequestId") ?? "") || undefined,
      }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setStockStatus(payload?.error?.formErrors?.[0] ?? payload?.error ?? "Erreur sur la fiche stock.");
      return;
    }

    setStockStatus("Fiche stock mise à jour avec traçabilité.");
    form.reset();
    await refreshData();
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[420px,1fr]">
        <section className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
          <h2 className="text-base font-semibold">Émettre un état de besoin</h2>
          <p className="mt-1 text-xs text-black/60 dark:text-white/60">
            Le document est transmis à la Direction Générale et à la Finance pour validation.
          </p>

          {canCreateNeed ? (
            <form onSubmit={submitNeed} className="mt-3 grid gap-2">
              <input name="title" required placeholder="Objet du besoin" className="rounded-md border px-3 py-2 text-sm" />
              <input name="category" required placeholder="Catégorie" className="rounded-md border px-3 py-2 text-sm" />
              <div className="rounded-lg border border-black/10 p-3 dark:border-white/10">
                <div className="grid grid-cols-[40px,1.1fr,1.2fr,120px,140px,130px,42px] gap-2 text-[11px] font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">
                  <span>N°</span>
                  <span>Libellé</span>
                  <span>Description</span>
                  <span>Quantité</span>
                  <span>Prix unitaire</span>
                  <span>Prix total</span>
                  <span />
                </div>
                <div className="mt-2 space-y-2">
                  {needLines.map((line, index) => {
                    const lineTotal = (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0);

                    return (
                      <div key={`line-${index}`} className="grid grid-cols-[40px,1.1fr,1.2fr,120px,140px,130px,42px] gap-2">
                        <div className="rounded-md border px-2 py-2 text-xs text-center">{index + 1}</div>
                        <input
                          value={line.designation}
                          onChange={(event) => updateNeedLine(index, "designation", event.target.value)}
                          placeholder="Désignation"
                          className="rounded-md border px-2 py-2 text-sm"
                        />
                        <input
                          value={line.description}
                          onChange={(event) => updateNeedLine(index, "description", event.target.value)}
                          placeholder="Description"
                          className="rounded-md border px-2 py-2 text-sm"
                        />
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={line.quantity}
                          onChange={(event) => updateNeedLine(index, "quantity", event.target.value)}
                          className="rounded-md border px-2 py-2 text-sm"
                        />
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.unitPrice}
                          onChange={(event) => updateNeedLine(index, "unitPrice", event.target.value)}
                          className="rounded-md border px-2 py-2 text-sm"
                        />
                        <div className="rounded-md border bg-black/5 px-2 py-2 text-sm dark:bg-white/10">
                          {lineTotal.toFixed(2)}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeNeedLine(index)}
                          className="rounded-md border border-red-300 text-xs text-red-700 hover:bg-red-50 dark:border-red-700/60 dark:text-red-300 dark:hover:bg-red-950/40"
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={addNeedLine}
                    className="rounded-md border border-black/20 px-2.5 py-1 text-xs font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                  >
                    + Ajouter ligne
                  </button>
                  <div className="text-sm font-semibold">
                    Total général: {quoteTotal.toFixed(2)}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-[120px,120px] gap-2">
                <input name="currency" defaultValue="XAF" maxLength={3} placeholder="Devise" className="rounded-md border px-3 py-2 text-sm uppercase" />
              </div>
              <p className="text-[11px] text-black/55 dark:text-white/55">Format devis: chaque ligne = désignation + description + quantité + prix unitaire.</p>
              <button className="rounded-md bg-black px-3 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black">Émettre</button>
            </form>
          ) : (
            <p className="mt-3 rounded-md border border-dashed border-black/20 px-3 py-2 text-xs text-black/70 dark:border-white/20 dark:text-white/70">
              Émission réservée au service Approvisionnement.
            </p>
          )}

          {needStatus ? <p className="mt-2 text-xs text-black/60 dark:text-white/60">{needStatus}</p> : null}
        </section>

        <section className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
          <h2 className="text-base font-semibold">Validation Direction / Finance</h2>
          <p className="mt-1 text-xs text-black/60 dark:text-white/60">
            Un état approuvé revient avec statut Approuvé et sceau documentaire.
          </p>

          {canApproveNeed ? (
            <form onSubmit={submitApproval} className="mt-3 grid gap-2 sm:grid-cols-2">
              <select name="needRequestId" required className="rounded-md border px-3 py-2 text-sm sm:col-span-2">
                <option value="">Sélectionner un état de besoin</option>
                {needs
                  .filter((need) => need.status === "SUBMITTED")
                  .map((need) => (
                    <option key={need.id} value={need.id}>{need.title} • {need.requester.name}</option>
                  ))}
              </select>
              <select name="status" defaultValue="APPROVED" className="rounded-md border px-3 py-2 text-sm">
                <option value="APPROVED">Approuver</option>
                <option value="REJECTED">Rejeter</option>
              </select>
              <input name="reviewComment" placeholder="Commentaire" className="rounded-md border px-3 py-2 text-sm" />
              <button className="rounded-md bg-black px-3 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black sm:col-span-2">Valider</button>
            </form>
          ) : (
            <p className="mt-3 rounded-md border border-dashed border-black/20 px-3 py-2 text-xs text-black/70 dark:border-white/20 dark:text-white/70">
              Validation réservée à la Direction et à la Finance.
            </p>
          )}

          {approvalStatus ? <p className="mt-2 text-xs text-black/60 dark:text-white/60">{approvalStatus}</p> : null}
        </section>
      </div>

      <section className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
        <h2 className="text-base font-semibold">Suivi des états de besoin</h2>
        <div className="mt-3 space-y-2">
          {needs.length > 0 ? needs.map((need) => (
            <article key={need.id} className="rounded-lg border border-black/10 p-3 text-sm dark:border-white/10">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{need.title}</p>
                <span className="rounded-full border border-black/15 px-2 py-0.5 text-[10px] font-semibold dark:border-white/20">
                  {statusLabel(need.status)}
                </span>
              </div>
              <p className="mt-1 text-xs text-black/70 dark:text-white/70">
                {need.category} • {need.quantity} {need.unit} • Demandeur: {need.requester.name}
              </p>
              {typeof need.estimatedAmount === "number" ? (
                <p className="mt-1 text-xs font-semibold text-black dark:text-white">
                  Montant estimatif: {new Intl.NumberFormat("fr-FR").format(need.estimatedAmount)} {need.currency ?? "XAF"}
                </p>
              ) : null}
              {parseNeedQuote(need.details)?.items?.length ? (
                <div className="mt-2 overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead className="bg-black/5 dark:bg-white/10">
                      <tr>
                        <th className="px-2 py-1 text-left">N°</th>
                        <th className="px-2 py-1 text-left">Désignation</th>
                        <th className="px-2 py-1 text-left">Qté</th>
                        <th className="px-2 py-1 text-left">PU</th>
                        <th className="px-2 py-1 text-left">PT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parseNeedQuote(need.details)?.items.map((line, lineIndex) => (
                        <tr key={`${need.id}-line-${lineIndex}`} className="border-t border-black/10 dark:border-white/10">
                          <td className="px-2 py-1">{lineIndex + 1}</td>
                          <td className="px-2 py-1">{line.designation}</td>
                          <td className="px-2 py-1">{line.quantity}</td>
                          <td className="px-2 py-1">{line.unitPrice.toFixed(2)}</td>
                          <td className="px-2 py-1">{line.lineTotal.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-1 whitespace-pre-wrap text-xs text-black/65 dark:text-white/65">{need.details}</p>
              )}
              <p className="mt-1 text-[11px] text-black/55 dark:text-white/55">
                Créé le {new Date(need.createdAt).toLocaleString()}
                {need.approvedAt ? ` • Approuvé le ${new Date(need.approvedAt).toLocaleString()}` : ""}
                {need.sealedAt ? " • Document scellé" : ""}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <a
                  href={`/approvisionnement/${need.id}`}
                  className="inline-flex rounded-md border border-black/20 px-2.5 py-1 text-[11px] font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                >
                  Lire l&apos;état
                </a>
                <a
                  href={`/api/procurement/needs/${need.id}/pdf`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex rounded-md border border-black/20 px-2.5 py-1 text-[11px] font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                >
                  Lire PDF
                </a>
                <a
                  href={`/api/procurement/needs/${need.id}/pdf?download=1`}
                  className="inline-flex rounded-md border border-black/20 px-2.5 py-1 text-[11px] font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                >
                  Télécharger PDF
                </a>
                <span className="text-[11px] text-black/55 dark:text-white/55">
                  {need.status === "APPROVED" ? "Preuve d'approbation incluse" : "Le document sera marqué non scellé"}
                </span>
              </div>
            </article>
          )) : (
            <p className="text-sm text-black/60 dark:text-white/60">Aucun état de besoin pour le moment.</p>
          )}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[420px,1fr]">
        <section className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
          <h2 className="text-base font-semibold">Fiche stock dynamique</h2>
          <p className="mt-1 text-xs text-black/60 dark:text-white/60">
            Chaque entrée/sortie exige un justificatif pour garder la traçabilité complète.
          </p>

          {canManageStock ? (
            <form onSubmit={submitStockMovement} className="mt-3 grid gap-2">
              <input name="itemName" required placeholder="Produit / Matériel" className="rounded-md border px-3 py-2 text-sm" />
              <input name="category" required placeholder="Catégorie" className="rounded-md border px-3 py-2 text-sm" />
              <div className="grid grid-cols-[1fr,120px] gap-2">
                <input name="quantity" type="number" min="0.01" step="0.01" required placeholder="Quantité" className="rounded-md border px-3 py-2 text-sm" />
                <input name="unit" required placeholder="Unité" className="rounded-md border px-3 py-2 text-sm" />
              </div>
              <select name="movementType" defaultValue="IN" className="rounded-md border px-3 py-2 text-sm">
                <option value="IN">Entrée stock</option>
                <option value="OUT">Sortie stock</option>
              </select>
              <input name="referenceDoc" required placeholder="Référence justificatif" className="rounded-md border px-3 py-2 text-sm" />
              <textarea name="justification" required rows={3} placeholder="Motif / justification" className="rounded-md border px-3 py-2 text-sm" />
              <select name="needRequestId" className="rounded-md border px-3 py-2 text-sm">
                <option value="">Aucun état de besoin lié</option>
                {approvedNeeds.map((need) => (
                  <option key={need.id} value={need.id}>{need.title}</option>
                ))}
              </select>
              <button className="rounded-md bg-black px-3 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black">Enregistrer mouvement</button>
            </form>
          ) : (
            <p className="mt-3 rounded-md border border-dashed border-black/20 px-3 py-2 text-xs text-black/70 dark:border-white/20 dark:text-white/70">
              Gestion de stock réservée à l&apos;Approvisionnement.
            </p>
          )}

          {stockStatus ? <p className="mt-2 text-xs text-black/60 dark:text-white/60">{stockStatus}</p> : null}
        </section>

        <section className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
          <h2 className="text-base font-semibold">Fiche stock (état courant)</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-black/10 text-left dark:border-white/10">
                  <th className="px-2 py-2">Produit</th>
                  <th className="px-2 py-2">Catégorie</th>
                  <th className="px-2 py-2">Stock</th>
                  <th className="px-2 py-2">Maj</th>
                </tr>
              </thead>
              <tbody>
                {stockItems.map((item) => (
                  <tr key={item.id} className="border-b border-black/5 dark:border-white/10">
                    <td className="px-2 py-2">{item.name}</td>
                    <td className="px-2 py-2">{item.category}</td>
                    <td className="px-2 py-2 font-semibold">{item.currentQuantity} {item.unit}</td>
                    <td className="px-2 py-2 text-xs text-black/60 dark:text-white/60">{new Date(item.updatedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="mt-5 text-sm font-semibold">Historique des mouvements</h3>
          <div className="mt-2 space-y-2">
            {movements.length > 0 ? movements.map((movement) => (
              <article key={movement.id} className="rounded-lg border border-black/10 p-2 text-xs dark:border-white/10">
                <p className="font-semibold">
                  {movement.movementType === "IN" ? "Entrée" : "Sortie"} • {movement.stockItem.name} • {movement.quantity} {movement.stockItem.unit}
                </p>
                <p className="text-black/70 dark:text-white/70">Justificatif: {movement.referenceDoc}</p>
                <p className="text-black/65 dark:text-white/65">{movement.justification}</p>
                <p className="text-black/55 dark:text-white/55">
                  {new Date(movement.createdAt).toLocaleString()} • Par {movement.performedBy.name}
                  {movement.needRequest ? ` • EDB: ${movement.needRequest.title}` : ""}
                </p>
              </article>
            )) : (
              <p className="text-xs text-black/60 dark:text-white/60">Aucun mouvement enregistré.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
