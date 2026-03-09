"use client";

import { useMemo, useState } from "react";

type AuditDossier = {
  entityType: "TICKET_SALE" | "WORKER_REPORT" | "NEED_REQUEST" | "ATTENDANCE";
  entityId: string;
  reference: string;
  client: string;
  amount: number;
  margin: number | null;
  service: string;
  status: string;
  ownerName: string;
  createdAt: string;
};

type AlertItem = {
  label: string;
  detail: string;
  severity: "high" | "medium" | "low";
};

type TrailItem = {
  id: string;
  action: string;
  createdAt: string;
  actor: { name: string };
  payload: unknown;
};

type DossierState = {
  compliance: {
    documentsOk: boolean;
    amountsOk: boolean;
    processOk: boolean;
    riskChecked: boolean;
  };
  decision: "PENDING" | "VALIDATED" | "REJECTED";
  comments: Array<{ text: string; createdAt: string; author: string }>;
};

type DossierDetail = {
  header: {
    title: string;
    subtitle: string;
    status: string;
  };
  financial: Array<{ label: string; value: string }>;
  conformity: Array<{ label: string; value: string }>;
};

const serviceTabs = ["TOUS", "BILLETS", "RAPPORTS", "APPROVISIONNEMENT", "PRESENCES"];
const rowTabs = ["TOUS", "A_AUDITER", "VALIDES", "REJETES"];

export function AuditWorkspace({
  dossiers,
  alerts,
  employees,
  defaultStartDate,
  defaultEndDate,
}: {
  dossiers: AuditDossier[];
  alerts: {
    anomalies: AlertItem[];
    stocks: AlertItem[];
    signalements: AlertItem[];
  };
  employees: string[];
  defaultStartDate: string;
  defaultEndDate: string;
}) {
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [service, setService] = useState("TOUS");
  const [employee, setEmployee] = useState("TOUS");
  const [search, setSearch] = useState("");
  const [rowTab, setRowTab] = useState("TOUS");
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [detailTab, setDetailTab] = useState<"FINANCIER" | "CONFORMITE" | "TRAIL">("FINANCIER");
  const [detail, setDetail] = useState<DossierDetail | null>(null);
  const [trail, setTrail] = useState<TrailItem[]>([]);
  const [state, setState] = useState<DossierState>({
    compliance: {
      documentsOk: false,
      amountsOk: false,
      processOk: false,
      riskChecked: false,
    },
    decision: "PENDING",
    comments: [],
  });
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState("");
  const [loadingDetail, setLoadingDetail] = useState(false);

  const selected = useMemo(
    () => dossiers.find((item) => `${item.entityType}:${item.entityId}` === selectedKey) ?? null,
    [dossiers, selectedKey],
  );

  const filtered = useMemo(() => {
    return dossiers.filter((item) => {
      const serviceOk = service === "TOUS" || item.service === service;
      const employeeOk = employee === "TOUS" || item.ownerName === employee;
      const text = `${item.reference} ${item.client} ${item.status} ${item.service}`.toLowerCase();
      const searchOk = !search.trim() || text.includes(search.toLowerCase());
      const dateKey = item.createdAt.slice(0, 10);
      const dateOk = dateKey >= startDate && dateKey <= endDate;

      let tabOk = true;
      if (rowTab === "A_AUDITER") tabOk = item.status !== "VALIDATED" && item.status !== "REJECTED";
      if (rowTab === "VALIDES") tabOk = item.status === "VALIDATED";
      if (rowTab === "REJETES") tabOk = item.status === "REJECTED";

      return serviceOk && employeeOk && searchOk && dateOk && tabOk;
    });
  }, [dossiers, service, employee, search, startDate, endDate, rowTab]);

  async function loadSelectedDetails(entityType: string, entityId: string) {
    setLoadingDetail(true);
    const params = new URLSearchParams({ entityType, entityId });
    const response = await fetch(`/api/audit/dossier?${params.toString()}`, { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setStatus(payload?.error ?? "Impossible de charger le détail du dossier.");
      setLoadingDetail(false);
      return;
    }

    setDetail(payload?.data?.detail ?? null);
    setTrail(Array.isArray(payload?.data?.trail) ? payload.data.trail : []);
    setState(payload?.data?.state ?? state);
    setLoadingDetail(false);
  }

  async function saveAction(action: string, payload?: Record<string, unknown>) {
    if (!selected) {
      setStatus("Sélectionnez un dossier à auditer.");
      return;
    }

    const response = await fetch("/api/audit/dossier", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entityType: selected.entityType,
        entityId: selected.entityId,
        action,
        payload,
      }),
    });

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setStatus(body?.error ?? "Action audit échouée.");
      return;
    }

    setStatus("Action audit enregistrée et tracée.");
    await loadSelectedDetails(selected.entityType, selected.entityId);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr,1fr,340px]">
      <section className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900 lg:col-span-2">
        <h2 className="text-base font-semibold">1. Filtres audit</h2>
        <div className="mt-3 grid gap-2 md:grid-cols-5">
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20" />
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20" />
          <select value={service} onChange={(e) => setService(e.target.value)} className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20">
            {serviceTabs.map((tab) => <option key={tab} value={tab}>{tab}</option>)}
          </select>
          <select value={employee} onChange={(e) => setEmployee(e.target.value)} className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20">
            <option value="TOUS">Employés: tous</option>
            {employees.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Recherche ref/client/statut" className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20" />
        </div>
      </section>

      <section className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
        <h2 className="text-base font-semibold">5. Actions rapides</h2>
        <div className="mt-3 grid gap-2">
          <button type="button" onClick={() => void saveAction("AUDIT_IMPORT", { source: "manual" })} className="rounded-md border border-black/15 px-3 py-2 text-sm font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10">Importer dossiers</button>
          <button type="button" onClick={() => void saveAction("AUDIT_AUTO_CONTROL", { mode: "standard" })} className="rounded-md border border-black/15 px-3 py-2 text-sm font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10">Contrôle auto</button>
          <button type="button" onClick={() => void saveAction("AUDIT_EXPORT", { format: "pdf" })} className="rounded-md border border-black/15 px-3 py-2 text-sm font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10">Exporter</button>
          <button type="button" onClick={() => void saveAction("AUDIT_SIGNAL", { level: "medium" })} className="rounded-md bg-black px-3 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black">Créer signalement</button>
        </div>
      </section>

      <section className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900 lg:col-span-2">
        <h2 className="text-base font-semibold">2. Dossiers à auditer</h2>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          {rowTabs.map((tab) => (
            <button key={tab} type="button" onClick={() => setRowTab(tab)} className={`rounded-full border px-2.5 py-1 font-semibold ${rowTab === tab ? "border-black bg-black/5 dark:border-white dark:bg-white/10" : "border-black/15 dark:border-white/20"}`}>
              {tab}
            </button>
          ))}
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-black/5 dark:bg-white/10">
              <tr>
                <th className="px-3 py-2 text-left">Réf</th>
                <th className="px-3 py-2 text-left">Client</th>
                <th className="px-3 py-2 text-left">Montant</th>
                <th className="px-3 py-2 text-left">Marge</th>
                <th className="px-3 py-2 text-left">Service</th>
                <th className="px-3 py-2 text-left">Statut</th>
                <th className="px-3 py-2 text-left">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const key = `${row.entityType}:${row.entityId}`;
                return (
                  <tr key={key} className="border-t border-black/5 dark:border-white/10">
                    <td className="px-3 py-2">{row.reference}</td>
                    <td className="px-3 py-2">{row.client}</td>
                    <td className="px-3 py-2">{row.amount.toFixed(2)} USD</td>
                    <td className="px-3 py-2">{row.margin == null ? "-" : `${row.margin.toFixed(2)} USD`}</td>
                    <td className="px-3 py-2">{row.service}</td>
                    <td className="px-3 py-2">{row.status}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={async () => {
                          setSelectedKey(key);
                          await loadSelectedDetails(row.entityType, row.entityId);
                        }}
                        className="rounded-md border border-black/15 px-2.5 py-1 text-xs font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                      >
                        Auditer
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-xs text-black/60 dark:text-white/60">Aucun dossier correspondant aux filtres.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900 lg:row-span-2">
        <h2 className="text-base font-semibold">4. Alertes</h2>
        <div className="mt-3 space-y-4 text-sm">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Anomalies</p>
            <ul className="space-y-2">
              {alerts.anomalies.map((item, index) => (
                <li key={`${item.label}-${index}`} className="rounded-md border border-black/10 px-3 py-2 dark:border-white/10">
                  <p className="font-semibold">{item.label}</p>
                  <p className="text-xs text-black/60 dark:text-white/60">{item.detail}</p>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Stocks</p>
            <ul className="space-y-2">
              {alerts.stocks.map((item, index) => (
                <li key={`${item.label}-${index}`} className="rounded-md border border-black/10 px-3 py-2 dark:border-white/10">
                  <p className="font-semibold">{item.label}</p>
                  <p className="text-xs text-black/60 dark:text-white/60">{item.detail}</p>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Signalements</p>
            <ul className="space-y-2">
              {alerts.signalements.map((item, index) => (
                <li key={`${item.label}-${index}`} className="rounded-md border border-black/10 px-3 py-2 dark:border-white/10">
                  <p className="font-semibold">{item.label}</p>
                  <p className="text-xs text-black/60 dark:text-white/60">{item.detail}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900 lg:col-span-2">
        <h2 className="text-base font-semibold">3. Détail dossier</h2>
        {selected ? (
          <>
            <div className="mt-3 rounded-lg border border-black/10 bg-black/5 px-3 py-2 text-sm dark:border-white/10 dark:bg-white/5">
              <p className="font-semibold">{detail?.header.title ?? selected.reference}</p>
              <p className="text-xs text-black/60 dark:text-white/60">{detail?.header.subtitle ?? `${selected.client} • ${selected.service}`} • Statut audit: {state.decision}</p>
            </div>

            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {(["FINANCIER", "CONFORMITE", "TRAIL"] as const).map((tab) => (
                <button key={tab} type="button" onClick={() => setDetailTab(tab)} className={`rounded-full border px-2.5 py-1 font-semibold ${detailTab === tab ? "border-black bg-black/5 dark:border-white dark:bg-white/10" : "border-black/15 dark:border-white/20"}`}>
                  {tab}
                </button>
              ))}
            </div>

            <div className="mt-3">
              {loadingDetail ? (
                <p className="text-xs text-black/60 dark:text-white/60">Chargement du dossier...</p>
              ) : null}

              {!loadingDetail && detailTab === "FINANCIER" ? (
                <ul className="space-y-2 text-sm">
                  {(detail?.financial ?? []).map((item) => (
                    <li key={item.label} className="rounded-md border border-black/10 px-3 py-2 dark:border-white/10">
                      <span className="font-semibold">{item.label}:</span> {item.value}
                    </li>
                  ))}
                </ul>
              ) : null}

              {!loadingDetail && detailTab === "CONFORMITE" ? (
                <div className="space-y-2 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={state.compliance.documentsOk}
                      onChange={async (event) => {
                        const compliance = { ...state.compliance, documentsOk: event.target.checked };
                        setState((prev) => ({ ...prev, compliance }));
                        await saveAction("AUDIT_CONFORMITY_SAVE", { compliance });
                      }}
                    />
                    Documents vérifiés
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={state.compliance.amountsOk}
                      onChange={async (event) => {
                        const compliance = { ...state.compliance, amountsOk: event.target.checked };
                        setState((prev) => ({ ...prev, compliance }));
                        await saveAction("AUDIT_CONFORMITY_SAVE", { compliance });
                      }}
                    />
                    Chiffres validés
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={state.compliance.processOk}
                      onChange={async (event) => {
                        const compliance = { ...state.compliance, processOk: event.target.checked };
                        setState((prev) => ({ ...prev, compliance }));
                        await saveAction("AUDIT_CONFORMITY_SAVE", { compliance });
                      }}
                    />
                    Processus conforme
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={state.compliance.riskChecked}
                      onChange={async (event) => {
                        const compliance = { ...state.compliance, riskChecked: event.target.checked };
                        setState((prev) => ({ ...prev, compliance }));
                        await saveAction("AUDIT_CONFORMITY_SAVE", { compliance });
                      }}
                    />
                    Risques contrôlés
                  </label>
                  <ul className="mt-2 space-y-2">
                    {(detail?.conformity ?? []).map((item) => (
                      <li key={item.label} className="rounded-md border border-black/10 px-3 py-2 text-xs dark:border-white/10">
                        <span className="font-semibold">{item.label}:</span> {item.value}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {!loadingDetail && detailTab === "TRAIL" ? (
                <ul className="space-y-2 text-sm">
                  {trail.map((item) => (
                    <li key={item.id} className="rounded-md border border-black/10 px-3 py-2 dark:border-white/10">
                      <p className="font-semibold">{item.action}</p>
                      <p className="text-xs text-black/60 dark:text-white/60">{item.actor.name} • {new Date(item.createdAt).toLocaleString()}</p>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className="mt-4 grid gap-2 md:grid-cols-[1fr,auto,auto] md:items-end">
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Commentaire d'audit..."
                className="min-h-20 rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20"
              />
              <button
                type="button"
                onClick={async () => {
                  if (!comment.trim()) {
                    setStatus("Ajoutez un commentaire avant enregistrement.");
                    return;
                  }
                  await saveAction("AUDIT_COMMENT", { text: comment.trim() });
                  setComment("");
                }}
                className="rounded-md border border-black/15 px-3 py-2 text-sm font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
              >
                Commenter
              </button>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => void saveAction("AUDIT_VALIDATE", { decision: "VALIDATED" })} className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white">Valider</button>
                <button type="button" onClick={() => void saveAction("AUDIT_REJECT", { decision: "REJECTED" })} className="rounded-md bg-red-700 px-3 py-2 text-sm font-semibold text-white">Rejeter</button>
              </div>
            </div>

            {state.comments.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {state.comments.slice(-5).reverse().map((item, index) => (
                  <li key={`${item.createdAt}-${index}`} className="rounded-md border border-black/10 px-3 py-2 text-xs dark:border-white/10">
                    <p>{item.text}</p>
                    <p className="mt-1 text-black/60 dark:text-white/60">{item.author} • {new Date(item.createdAt).toLocaleString()}</p>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <p className="mt-3 text-xs text-black/60 dark:text-white/60">Choisissez un dossier et cliquez sur Auditer.</p>
        )}

        <p className="mt-3 text-xs text-black/60 dark:text-white/60">{status}</p>
      </section>
    </div>
  );
}
