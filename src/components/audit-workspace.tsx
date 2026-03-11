"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type AuditDossier = {
  entityType: "TICKET_SALE" | "PAYMENT" | "WORKER_REPORT" | "NEED_REQUEST" | "ATTENDANCE";
  entityId: string;
  reference: string;
  client: string;
  amount: number;
  margin: number | null;
  service: string;
  status: string;
  auditDecision: "PENDING" | "VALIDATED" | "REJECTED";
  ownerName: string;
  createdAt: string;
  riskScore: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  riskReason: string;
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
  actionItems: Array<{
    id: string;
    title: string;
    owner: string;
    dueDate: string;
    severity: "LOW" | "MEDIUM" | "HIGH";
    status: "OPEN" | "IN_PROGRESS" | "CLOSED";
    updatedAt: string;
  }>;
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

type CompareResultRow = {
  key: string;
  issue: "OK" | "MISSING_IN_SYSTEM" | "MISSING_IN_FILE" | "AMOUNT_DIFF" | "FIELD_DIFF";
  systemValue: string;
  externalValue: string;
  severity: "low" | "medium" | "high";
};

type CompareResult = {
  summary: {
    compareType: "CAISSE" | "VENTES" | "PRESENCES" | "RAPPORTS" | "ARCHIVES" | "BESOINS_CAISSE";
    period: string;
    externalRows: number;
    checkedRows: number;
    ok: number;
    mismatches: number;
    highSeverity: number;
    scope?: string | null;
  };
  rows: CompareResultRow[];
};

type EmployeeAuditMetric = {
  name: string;
  attendanceDays: number;
  attendanceRate: number;
  reportsSubmitted: number;
  reportsApproved: number;
  ticketsSold: number;
  ticketsAmount: number;
  score: number;
  level: "EXCELLENT" | "GOOD" | "WATCH" | "CRITICAL";
  recommendation: string;
};

const serviceTabs = ["TOUS", "BILLETS", "CAISSE", "RAPPORTS", "APPROVISIONNEMENT", "PRESENCES"];
const rowTabs = ["TOUS", "A_AUDITER", "VALIDES", "REJETES"];

function serviceChecklist(service: string) {
  if (service === "BILLETS") {
    return [
      "Concordance ticket / client / compagnie",
      "Montant facturé cohérent avec le billet",
      "Rapprochement commission et marge",
      "Conformité des dates de vente et voyage",
    ];
  }

  if (service === "CAISSE") {
    return [
      "Rapprochement entrée caisse avec billet source",
      "Présence d'une référence de paiement traçable",
      "Absence d'écart entre encaissement et facturation",
      "Justification des sorties et mouvements sensibles",
    ];
  }

  if (service === "PRESENCES") {
    return [
      "Signature entrée/sortie valide",
      "Cohérence localisation et horaires",
      "Retards/heures supp justifiés",
      "Traçabilité quotidienne des pointages",
    ];
  }

  if (service === "RAPPORTS") {
    return [
      "Période du rapport conforme",
      "Contenu aligné à la fonction",
      "Indicateurs clés correctement renseignés",
      "Circuit de soumission/approbation respecté",
    ];
  }

  return [
    "Pièces justificatives présentes",
    "Montants et volumes cohérents",
    "Processus métier respecté",
    "Traçabilité et responsabilité établies",
  ];
}

export function AuditWorkspace({
  dossiers,
  alerts,
  employees,
  defaultStartDate,
  defaultEndDate,
  canWrite,
  insights,
  employeeAudits,
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
  canWrite: boolean;
  insights: {
    globalRiskIndex: number;
    criticalPendingCount: number;
    topServiceAtRisk: string;
    recommendations: string[];
    prioritizedQueue: AuditDossier[];
  };
  employeeAudits: EmployeeAuditMetric[];
}) {
  const router = useRouter();
  const [dossierRows, setDossierRows] = useState(dossiers);
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
    actionItems: [],
  });
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState("");
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [savingAction, setSavingAction] = useState(false);
  const [newActionTitle, setNewActionTitle] = useState("");
  const [newActionOwner, setNewActionOwner] = useState("");
  const [newActionDueDate, setNewActionDueDate] = useState("");
  const [newActionSeverity, setNewActionSeverity] = useState<"LOW" | "MEDIUM" | "HIGH">("MEDIUM");
  const [compareType, setCompareType] = useState<"CAISSE" | "VENTES" | "PRESENCES" | "RAPPORTS" | "ARCHIVES" | "BESOINS_CAISSE">("VENTES");
  const [airlineScope, setAirlineScope] = useState("");
  const [compareFile, setCompareFile] = useState<File | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);
  const [selectedAgent, setSelectedAgent] = useState(employeeAudits[0]?.name ?? "");

  const selectedAgentMetric = useMemo(
    () => employeeAudits.find((item) => item.name === selectedAgent) ?? employeeAudits[0] ?? null,
    [employeeAudits, selectedAgent],
  );

  const selected = useMemo(
    () => dossierRows.find((item) => `${item.entityType}:${item.entityId}` === selectedKey) ?? null,
    [dossierRows, selectedKey],
  );

  const filtered = useMemo(() => {
    return dossierRows.filter((item) => {
      const serviceOk = service === "TOUS" || item.service === service;
      const employeeOk = employee === "TOUS" || item.ownerName === employee;
      const text = `${item.reference} ${item.client} ${item.status} ${item.service} ${item.auditDecision}`.toLowerCase();
      const searchOk = !search.trim() || text.includes(search.toLowerCase());
      const dateKey = item.createdAt.slice(0, 10);
      const dateOk = dateKey >= startDate && dateKey <= endDate;

      let tabOk = true;
      if (rowTab === "A_AUDITER") tabOk = item.auditDecision === "PENDING";
      if (rowTab === "VALIDES") tabOk = item.auditDecision === "VALIDATED";
      if (rowTab === "REJETES") tabOk = item.auditDecision === "REJECTED";

      return serviceOk && employeeOk && searchOk && dateOk && tabOk;
    });
  }, [dossierRows, service, employee, search, startDate, endDate, rowTab]);

  async function openAuditModal(row: AuditDossier) {
    const key = `${row.entityType}:${row.entityId}`;
    setSelectedKey(key);
    setIsAuditModalOpen(true);
    await loadSelectedDetails(row.entityType, row.entityId);
  }

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

  async function saveAction(action: string, payload?: Record<string, unknown>, useSelected = true) {
    if (!canWrite) {
      setStatus("Mode lecture: seules les actions de l'auditeur sont autorisées.");
      return;
    }

    if (useSelected && !selected) {
      setStatus("Sélectionnez un dossier à auditer.");
      return;
    }

    setSavingAction(true);

    const response = await fetch("/api/audit/dossier", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(useSelected && selected ? {
          entityType: selected.entityType,
          entityId: selected.entityId,
        } : {}),
        action,
        payload,
      }),
    });

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setStatus(body?.error ?? "Action audit échouée.");
      setSavingAction(false);
      return;
    }

    setStatus("Action audit enregistrée et tracée.");
    if (useSelected && selected) {
      await loadSelectedDetails(selected.entityType, selected.entityId);
      if (action === "AUDIT_VALIDATE" || action === "AUDIT_REJECT") {
        const nextDecision = action === "AUDIT_VALIDATE" ? "VALIDATED" : "REJECTED";
        setState((prev) => ({ ...prev, decision: nextDecision }));
        setDossierRows((prev) => prev.map((row) => (
          row.entityType === selected.entityType && row.entityId === selected.entityId
            ? { ...row, auditDecision: nextDecision }
            : row
        )));
      }
    }
    setSavingAction(false);
  }

  async function runExternalCompare() {
    if (!canWrite) {
      setStatus("Mode lecture: comparaison externe réservée à l'auditeur.");
      return;
    }

    if (!compareFile) {
      setStatus("Choisissez un fichier CSV externe à comparer.");
      return;
    }

    setCompareLoading(true);
    const formData = new FormData();
    formData.append("compareType", compareType);
    formData.append("startDate", startDate);
    formData.append("endDate", endDate);
    formData.append("airlineScope", airlineScope.trim());
    formData.append("file", compareFile);

    const response = await fetch("/api/audit/compare", {
      method: "POST",
      body: formData,
    });

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setStatus(body?.error ?? "Échec de la comparaison externe.");
      setCompareLoading(false);
      return;
    }

    setCompareResult(body?.data ?? null);
    setStatus("Comparaison externe terminée. Rapport d'écarts prêt.");
    setCompareLoading(false);
  }

  const compareGuide = compareType === "VENTES"
    ? "Audit ventes compagnie: comparez le rapport externe d'une compagnie (ex: AIRCONGO) avec les billets de cette compagnie encodes dans le systeme."
    : compareType === "CAISSE"
      ? "Audit caisse: comparez les mouvements externes (entrees/sorties) avec les paiements billets + sorties liees aux besoins approuves."
      : compareType === "BESOINS_CAISSE"
        ? "Audit besoins vs caisse: comparez les besoins approuves avec les sorties de caisse declarees dans le fichier externe."
        : compareType === "ARCHIVES"
          ? "Audit archives: comparez le registre externe des dossiers (excel/csv/pdf) avec les references archivees dans l'application."
          : compareType === "PRESENCES"
            ? "Audit presences: confrontez les pointages externes avec les signatures et horaires du systeme."
            : "Audit rapports: confrontez les rapports externes avec les rapports saisis dans l'application.";

  function exportCompareCsv() {
    if (!compareResult || compareResult.rows.length === 0) {
      setStatus("Aucun résultat à exporter.");
      return;
    }

    const header = "key,issue,severity,systemValue,externalValue";
    const lines = compareResult.rows.map((row) => {
      const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
      return [
        escape(row.key),
        escape(row.issue),
        escape(row.severity),
        escape(row.systemValue),
        escape(row.externalValue),
      ].join(",");
    });

    const csv = [header, ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `audit-compare-${compareResult.summary.compareType.toLowerCase()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="grid h-full min-h-0 gap-4 overflow-hidden lg:grid-cols-[minmax(0,1.65fr)_minmax(380px,1fr)]">
      <section className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900 lg:col-span-2">
        <h2 className="text-base font-semibold">Audit clair et concret</h2>
        <p className="mt-1 text-xs text-black/60 dark:text-white/60">
          Etape 1: filtrez les dossiers. Etape 2: cliquez sur Auditer. Etape 3: validez/rejetez et suivez les actions correctives.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <article className="rounded-lg border border-black/10 bg-black/3 px-3 py-2 dark:border-white/10 dark:bg-white/3">
            <p className="text-[11px] uppercase tracking-wide text-black/60 dark:text-white/60">Risque global</p>
            <p className="text-xl font-semibold">{insights.globalRiskIndex}/100</p>
          </article>
          <article className="rounded-lg border border-black/10 bg-black/3 px-3 py-2 dark:border-white/10 dark:bg-white/3">
            <p className="text-[11px] uppercase tracking-wide text-black/60 dark:text-white/60">Critiques en attente</p>
            <p className="text-xl font-semibold">{insights.criticalPendingCount}</p>
          </article>
          <article className="rounded-lg border border-black/10 bg-black/3 px-3 py-2 dark:border-white/10 dark:bg-white/3">
            <p className="text-[11px] uppercase tracking-wide text-black/60 dark:text-white/60">Service exposé</p>
            <p className="text-sm font-semibold">{insights.topServiceAtRisk}</p>
          </article>
          <article className="rounded-lg border border-black/10 bg-black/3 px-3 py-2 dark:border-white/10 dark:bg-white/3">
            <p className="text-[11px] uppercase tracking-wide text-black/60 dark:text-white/60">Action immédiate</p>
            <p className="text-xs font-semibold">{insights.recommendations[0]}</p>
          </article>
        </div>
      </section>

      <section className="flex min-h-0 min-w-0 flex-col rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
        <h2 className="text-base font-semibold">Dossiers a auditer</h2>
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20" />
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20" />
          <select value={service} onChange={(e) => setService(e.target.value)} className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20">
            {serviceTabs.map((tab) => <option key={tab} value={tab}>{tab}</option>)}
          </select>
          <select value={employee} onChange={(e) => setEmployee(e.target.value)} className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20">
            <option value="TOUS">Employes: tous</option>
            {employees.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Recherche" className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20" />
        </div>

        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2 text-xs">
            {rowTabs.map((tab) => (
              <button key={tab} type="button" onClick={() => setRowTab(tab)} className={`rounded-full border px-2.5 py-1 font-semibold ${rowTab === tab ? "border-black bg-black/5 dark:border-white dark:bg-white/10" : "border-black/15 dark:border-white/20"}`}>
                {tab}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              const params = new URLSearchParams({ startDate, endDate });
              router.push(`/audit?${params.toString()}`);
            }}
            className="rounded-md border border-black/15 px-3 py-1.5 text-xs font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Appliquer
          </button>
        </div>

        <div className="mt-3 min-h-0 flex-1 overflow-auto rounded-lg border border-black/10 dark:border-white/10">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-black/5 dark:bg-white/10">
              <tr>
                <th className="px-3 py-2 text-left">Ref</th>
                <th className="px-3 py-2 text-left">Client</th>
                <th className="px-3 py-2 text-left">Montant</th>
                <th className="px-3 py-2 text-left">Service</th>
                <th className="px-3 py-2 text-left">Audit</th>
                <th className="px-3 py-2 text-left">Risque</th>
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
                    <td className="px-3 py-2">{row.service}</td>
                    <td className="px-3 py-2">{row.auditDecision}</td>
                    <td className="px-3 py-2">
                      <span className="rounded-full border border-black/15 bg-black/5 px-2 py-0.5 text-[11px] font-semibold dark:border-white/20 dark:bg-white/10">
                        {row.riskLevel} {row.riskScore}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => void openAuditModal(row)}
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

      <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
        <h2 className="text-base font-semibold">Panneau concret</h2>
        <p className="mt-1 text-xs text-black/60 dark:text-white/60">Cliquez sur un dossier puis sur Auditer pour ouvrir l'assistant.</p>

        <div className="mt-3 rounded-xl border border-black/10 p-3 dark:border-white/10">
          <p className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Comparaison fichier externe</p>
          <p className="mt-1 text-[11px] text-black/60 dark:text-white/60">{compareGuide}</p>
          <div className="mt-2 grid gap-2">
            <select value={compareType} onChange={(e) => setCompareType(e.target.value as typeof compareType)} className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20">
              <option value="VENTES">Ventes compagnie vs billets systeme</option>
              <option value="CAISSE">Mouvements caisse vs paiements/besoins</option>
              <option value="BESOINS_CAISSE">Besoins approuves vs sorties caisse</option>
              <option value="PRESENCES">Presences</option>
              <option value="RAPPORTS">Rapports</option>
              <option value="ARCHIVES">Archives externes vs internes</option>
            </select>
            {compareType === "VENTES" ? (
              <input
                value={airlineScope}
                onChange={(e) => setAirlineScope(e.target.value)}
                placeholder="Code compagnie (ex: AIRCONGO)"
                className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20"
              />
            ) : null}
            <input type="file" accept=".csv,.xls,.xlsx,.pdf" onChange={(e) => setCompareFile(e.target.files?.[0] ?? null)} className="rounded-md border border-black/15 px-3 py-2 text-xs dark:border-white/20" />
            <button type="button" disabled={compareLoading || !canWrite} onClick={() => void runExternalCompare()} className="rounded-md border border-black/15 px-3 py-2 text-sm font-semibold hover:bg-black/5 disabled:opacity-60 dark:border-white/20 dark:hover:bg-white/10">
              {compareLoading ? "Comparaison..." : "Comparer"}
            </button>
            <button type="button" onClick={exportCompareCsv} className="rounded-md border border-black/15 px-3 py-2 text-sm font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10">Exporter CSV</button>
            <p className="text-[11px] text-black/60 dark:text-white/60">Formats acceptes: CSV, Excel (.xls/.xlsx), PDF. Si le document est binaire non tabulaire, exportez en CSV UTF-8.</p>
          </div>
        </div>

        <div className="mt-3 min-h-0 flex-1 overflow-auto rounded-xl border border-black/10 p-3 dark:border-white/10">
          <p className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Points a surveiller</p>
          <ul className="mt-2 space-y-2 text-sm">
            {alerts.anomalies.slice(0, 4).map((item, index) => (
              <li key={`${item.label}-${index}`} className="rounded-md border border-black/10 px-3 py-2 dark:border-white/10">
                <p className="font-semibold">{item.label}</p>
                <p className="text-xs text-black/60 dark:text-white/60">{item.detail}</p>
              </li>
            ))}
          </ul>

          {compareResult ? (
            <div className="mt-3 rounded-md border border-black/10 p-2 text-xs dark:border-white/10">
              <p>
                {compareResult.summary.compareType}
                {compareResult.summary.scope ? ` (${compareResult.summary.scope})` : ""}
                {` • OK ${compareResult.summary.ok} • Ecarts ${compareResult.summary.mismatches} • Critiques ${compareResult.summary.highSeverity}`}
              </p>
              <div className="mt-2 max-h-40 overflow-auto rounded-md border border-black/10 dark:border-white/10">
                <table className="min-w-full text-xs">
                  <thead className="sticky top-0 bg-black/5 dark:bg-white/10">
                    <tr>
                      <th className="px-2 py-1 text-left">Cle</th>
                      <th className="px-2 py-1 text-left">Ecart</th>
                      <th className="px-2 py-1 text-left">Severite</th>
                    </tr>
                  </thead>
                  <tbody>
                    {compareResult.rows.slice(0, 40).map((row, index) => (
                      <tr key={`${row.key}-${index}`} className="border-t border-black/5 dark:border-white/10">
                        <td className="px-2 py-1">{row.key}</td>
                        <td className="px-2 py-1">{row.issue}</td>
                        <td className="px-2 py-1">{row.severity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="mt-3 border-t border-black/10 pt-3 dark:border-white/10">
            <p className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Audit performance agent</p>
            {employeeAudits.length > 0 ? (
              <div className="mt-2 space-y-2">
                <select
                  value={selectedAgent}
                  onChange={(e) => setSelectedAgent(e.target.value)}
                  className="w-full rounded-md border border-black/15 px-3 py-2 text-xs dark:border-white/20"
                >
                  {employeeAudits.map((item) => (
                    <option key={item.name} value={item.name}>{item.name}</option>
                  ))}
                </select>

                {selectedAgentMetric ? (
                  <div className="rounded-md border border-black/10 p-2 text-xs dark:border-white/10">
                    <p className="font-semibold">{selectedAgentMetric.name} • Score {selectedAgentMetric.score}/100 ({selectedAgentMetric.level})</p>
                    <p className="mt-1">Presences: {selectedAgentMetric.attendanceRate}% ({selectedAgentMetric.attendanceDays} jours)</p>
                    <p>Rapports: {selectedAgentMetric.reportsApproved} approuves / {selectedAgentMetric.reportsSubmitted} soumis</p>
                    <p>Billets: {selectedAgentMetric.ticketsSold} • {selectedAgentMetric.ticketsAmount.toFixed(2)} USD</p>
                    <p className="mt-1 text-black/60 dark:text-white/60">{selectedAgentMetric.recommendation}</p>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-xs text-black/60 dark:text-white/60">Aucune donnee agent disponible sur la periode.</p>
            )}
          </div>
        </div>

        <p className="mt-2 text-xs text-black/60 dark:text-white/60">{status}</p>
      </section>

      {selected && isAuditModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-2xl border border-black/10 bg-white p-4 shadow-2xl dark:border-white/10 dark:bg-zinc-900">
            <div className="flex items-center justify-between gap-3 border-b border-black/10 pb-3 dark:border-white/10">
              <div>
                <p className="text-xs uppercase tracking-wide text-black/60 dark:text-white/60">Audit structuré</p>
                <h3 className="text-lg font-semibold">{detail?.header.title ?? selected.reference}</h3>
                <p className="text-xs text-black/60 dark:text-white/60">{detail?.header.subtitle ?? `${selected.client} • ${selected.service}`} • Risque {selected.riskLevel} ({selected.riskScore}/100)</p>
              </div>
              <button
                type="button"
                onClick={() => setIsAuditModalOpen(false)}
                className="rounded-md border border-black/15 px-3 py-1.5 text-xs font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
              >
                Fermer
              </button>
            </div>

            <div className="mt-3 grid gap-4 lg:grid-cols-[1fr,300px]">
              <div>
                <div className="flex flex-wrap gap-2 text-xs">
                  {(["FINANCIER", "CONFORMITE", "TRAIL"] as const).map((tab) => (
                    <button key={tab} type="button" onClick={() => setDetailTab(tab)} className={`rounded-full border px-2.5 py-1 font-semibold ${detailTab === tab ? "border-black bg-black/5 dark:border-white dark:bg-white/10" : "border-black/15 dark:border-white/20"}`}>
                      {tab}
                    </button>
                  ))}
                </div>

                <div className="mt-3">
                  {loadingDetail ? <p className="text-xs text-black/60 dark:text-white/60">Chargement du dossier...</p> : null}

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
                    <div className="space-y-3 text-sm">
                      <ul className="space-y-1 rounded-md border border-black/10 p-3 text-xs dark:border-white/10">
                        {serviceChecklist(selected.service).map((item) => (
                          <li key={item}>• {item}</li>
                        ))}
                      </ul>

                      <label className="flex items-center gap-2"><input type="checkbox" checked={state.compliance.documentsOk} disabled={!canWrite} onChange={async (event) => {
                        const compliance = { ...state.compliance, documentsOk: event.target.checked };
                        setState((prev) => ({ ...prev, compliance }));
                        await saveAction("AUDIT_CONFORMITY_SAVE", { compliance });
                      }} /> Documents vérifiés</label>
                      <label className="flex items-center gap-2"><input type="checkbox" checked={state.compliance.amountsOk} disabled={!canWrite} onChange={async (event) => {
                        const compliance = { ...state.compliance, amountsOk: event.target.checked };
                        setState((prev) => ({ ...prev, compliance }));
                        await saveAction("AUDIT_CONFORMITY_SAVE", { compliance });
                      }} /> Chiffres validés</label>
                      <label className="flex items-center gap-2"><input type="checkbox" checked={state.compliance.processOk} disabled={!canWrite} onChange={async (event) => {
                        const compliance = { ...state.compliance, processOk: event.target.checked };
                        setState((prev) => ({ ...prev, compliance }));
                        await saveAction("AUDIT_CONFORMITY_SAVE", { compliance });
                      }} /> Processus conforme</label>
                      <label className="flex items-center gap-2"><input type="checkbox" checked={state.compliance.riskChecked} disabled={!canWrite} onChange={async (event) => {
                        const compliance = { ...state.compliance, riskChecked: event.target.checked };
                        setState((prev) => ({ ...prev, compliance }));
                        await saveAction("AUDIT_CONFORMITY_SAVE", { compliance });
                      }} /> Risques contrôlés</label>
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
              </div>

              <aside className="rounded-lg border border-black/10 p-3 dark:border-white/10">
                <div className="mb-3 rounded-md border border-black/10 bg-black/5 p-2 text-xs dark:border-white/10 dark:bg-white/5">
                  <p className="font-semibold">Workflow assistant</p>
                  <p className="mt-1 text-black/70 dark:text-white/70">
                    {state.decision === "VALIDATED"
                      ? "Cloture: dossier conforme."
                      : state.decision === "REJECTED"
                        ? "Action corrective requise avant cloture."
                        : state.compliance.documentsOk && state.compliance.amountsOk && state.compliance.processOk && state.compliance.riskChecked
                          ? "Pret pour decision: valider ou rejeter."
                          : "Collecte et verification en cours."}
                  </p>
                </div>

                <p className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Décision audit</p>
                <p className="mt-1 text-sm">Statut courant: <span className="font-semibold">{state.decision}</span></p>
                <p className="mt-1 text-xs text-black/60 dark:text-white/60">Motif risque: {selected.riskReason}</p>

                <textarea
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="Commentaire d'audit..."
                  disabled={!canWrite}
                  className="mt-3 min-h-24 w-full rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20"
                />
                <button type="button" disabled={!canWrite} onClick={async () => {
                  if (!comment.trim()) {
                    setStatus("Ajoutez un commentaire avant enregistrement.");
                    return;
                  }
                  await saveAction("AUDIT_COMMENT", { text: comment.trim() });
                  setComment("");
                }} className="mt-2 w-full rounded-md border border-black/15 px-3 py-2 text-sm font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10">
                  Enregistrer commentaire
                </button>

                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <button type="button" disabled={savingAction || !canWrite} onClick={() => void saveAction("AUDIT_VALIDATE", { decision: "VALIDATED" })} className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">Valider</button>
                  <button type="button" disabled={savingAction || !canWrite} onClick={() => void saveAction("AUDIT_REJECT", { decision: "REJECTED" })} className="rounded-md bg-red-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">Rejeter</button>
                </div>

                <div className="mt-4 border-t border-black/10 pt-3 dark:border-white/10">
                  <p className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Plan d'actions correctives</p>
                  {canWrite ? (
                    <div className="mt-2 space-y-2">
                      <input
                        value={newActionTitle}
                        onChange={(event) => setNewActionTitle(event.target.value)}
                        placeholder="Action a lancer..."
                        className="w-full rounded-md border border-black/15 px-2 py-1.5 text-xs dark:border-white/20"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          value={newActionOwner}
                          onChange={(event) => setNewActionOwner(event.target.value)}
                          placeholder="Responsable"
                          className="rounded-md border border-black/15 px-2 py-1.5 text-xs dark:border-white/20"
                        />
                        <input
                          type="date"
                          value={newActionDueDate}
                          onChange={(event) => setNewActionDueDate(event.target.value)}
                          className="rounded-md border border-black/15 px-2 py-1.5 text-xs dark:border-white/20"
                        />
                      </div>
                      <div className="grid grid-cols-[1fr,auto] gap-2">
                        <select
                          value={newActionSeverity}
                          onChange={(event) => setNewActionSeverity(event.target.value as "LOW" | "MEDIUM" | "HIGH")}
                          className="rounded-md border border-black/15 px-2 py-1.5 text-xs dark:border-white/20"
                        >
                          <option value="LOW">Priorite basse</option>
                          <option value="MEDIUM">Priorite moyenne</option>
                          <option value="HIGH">Priorite haute</option>
                        </select>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!newActionTitle.trim()) {
                              setStatus("Renseignez le titre de l'action.");
                              return;
                            }
                            const id = `act-${Date.now()}`;
                            await saveAction("AUDIT_ACTION_CREATE", {
                              id,
                              title: newActionTitle.trim(),
                              owner: newActionOwner.trim() || "Non assigne",
                              dueDate: newActionDueDate,
                              severity: newActionSeverity,
                            });
                            setNewActionTitle("");
                            setNewActionOwner("");
                            setNewActionDueDate("");
                            setNewActionSeverity("MEDIUM");
                          }}
                          className="rounded-md border border-black/15 px-2 py-1.5 text-xs font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                        >
                          Ajouter
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <ul className="mt-2 space-y-2">
                    {state.actionItems.map((item) => (
                      <li key={item.id} className="rounded-md border border-black/10 px-2 py-2 text-xs dark:border-white/10">
                        <p className="font-semibold">{item.title}</p>
                        <p className="mt-0.5 text-black/60 dark:text-white/60">{item.owner} • echeance {item.dueDate || "non definie"} • {item.severity}</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <span className="rounded-full border border-black/15 px-2 py-0.5 dark:border-white/20">{item.status}</span>
                          {canWrite && item.status !== "IN_PROGRESS" && item.status !== "CLOSED" ? (
                            <button
                              type="button"
                              onClick={() => void saveAction("AUDIT_ACTION_PROGRESS", { id: item.id, status: "IN_PROGRESS" })}
                              className="rounded-full border border-black/15 px-2 py-0.5 font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                            >
                              Demarrer
                            </button>
                          ) : null}
                          {canWrite && item.status !== "CLOSED" ? (
                            <button
                              type="button"
                              onClick={() => void saveAction("AUDIT_ACTION_CLOSE", { id: item.id })}
                              className="rounded-full border border-emerald-600 px-2 py-0.5 font-semibold text-emerald-700 hover:bg-emerald-50 dark:border-emerald-400 dark:text-emerald-300 dark:hover:bg-emerald-900/30"
                            >
                              Cloturer
                            </button>
                          ) : null}
                        </div>
                      </li>
                    ))}
                    {state.actionItems.length === 0 ? (
                      <li className="rounded-md border border-black/10 px-2 py-2 text-xs text-black/60 dark:border-white/10 dark:text-white/60">
                        Aucune action corrective enregistree sur ce dossier.
                      </li>
                    ) : null}
                  </ul>
                </div>
              </aside>
            </div>
          </div>
        </div>
      ) : null}

    </div>
  );
}
