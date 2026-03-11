"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type AuditDossier = {
  entityType: "TICKET_SALE" | "PAYMENT" | "WORKER_REPORT" | "NEED_REQUEST" | "ATTENDANCE";
  entityId: string;
  reference: string;
  client: string;
  amount: number;
  service: string;
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

type CompareResultRow = {
  key: string;
  issue: "OK" | "MISSING_IN_SYSTEM" | "MISSING_IN_FILE" | "AMOUNT_DIFF" | "FIELD_DIFF";
  systemValue: string;
  externalValue: string;
  severity: "low" | "medium" | "high";
  strictTextEqual?: boolean;
  strictAmountEqual?: boolean | null;
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
    isIdenticalStrictly?: boolean;
    strictTextMatches?: number;
    strictTextMismatches?: number;
    strictAmountMatches?: number;
    strictAmountMismatches?: number;
    verdict?: "IDENTIQUE" | "NON_IDENTIQUE";
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

type AiAnalysis = {
  mission: "GLOBAL" | "VENTES_COMPAGNIE" | "MOUVEMENTS_CAISSE" | "BESOINS_VS_CAISSE" | "ARCHIVES" | "AUDIT_AGENT";
  decisionSuggestion: "VALIDATE" | "REJECT" | "ESCALATE";
  confidence: number;
  reasons: string[];
  actionPlan: Array<{ title: string; priority: "HIGH" | "MEDIUM" | "LOW"; owner: string; dueInDays: number }>;
  keyIndicators: {
    pendingHighRisk: number;
    rejectedCount: number;
    comparedMismatches: number;
    comparedCritical: number;
  };
  deepAnalysis: {
    executiveSummary: string;
    controlMatrix: Array<{ control: string; score: number; status: "OK" | "WATCH" | "ALERT"; evidence: string }>;
    findings: Array<{ title: string; priority: "HIGH" | "MEDIUM" | "LOW"; impact: string; evidence: string; recommendation: string }>;
    evidenceSamples: Array<{ key: string; issue: string; severity: string; systemValue: string; externalValue: string }>;
    totalEstimatedDelta: number;
    strictVerdict: "IDENTIQUE" | "NON_IDENTIQUE";
  };
  priorityQueue: Array<{ reference: string; service: string; riskScore: number; reason: string }>;
};

const serviceTabs = ["TOUS", "BILLETS", "CAISSE", "RAPPORTS", "APPROVISIONNEMENT", "PRESENCES"];
const rowTabs = ["TOUS", "A_AUDITER", "VALIDES", "REJETES"];

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
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [service, setService] = useState("TOUS");
  const [employee, setEmployee] = useState("TOUS");
  const [search, setSearch] = useState("");
  const [rowTab, setRowTab] = useState("TOUS");

  const [mission, setMission] = useState<AiAnalysis["mission"]>("GLOBAL");
  const [compareType, setCompareType] = useState<"CAISSE" | "VENTES" | "PRESENCES" | "RAPPORTS" | "ARCHIVES" | "BESOINS_CAISSE">("VENTES");
  const [airlineScope, setAirlineScope] = useState("");
  const [compareFile, setCompareFile] = useState<File | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);

  const [selectedAgent, setSelectedAgent] = useState(employeeAudits[0]?.name ?? "");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<AiAnalysis | null>(null);
  const [status, setStatus] = useState("");
  const [focusPane, setFocusPane] = useState<"ASSISTANT" | "ENGINE">("ASSISTANT");

  const filtered = useMemo(() => {
    return dossiers.filter((item) => {
      const serviceOk = service === "TOUS" || item.service === service;
      const employeeOk = employee === "TOUS" || item.ownerName === employee;
      const text = `${item.reference} ${item.client} ${item.service} ${item.auditDecision}`.toLowerCase();
      const searchOk = !search.trim() || text.includes(search.toLowerCase());
      const dateKey = item.createdAt.slice(0, 10);
      const dateOk = dateKey >= startDate && dateKey <= endDate;

      let tabOk = true;
      if (rowTab === "A_AUDITER") tabOk = item.auditDecision === "PENDING";
      if (rowTab === "VALIDES") tabOk = item.auditDecision === "VALIDATED";
      if (rowTab === "REJETES") tabOk = item.auditDecision === "REJECTED";

      return serviceOk && employeeOk && searchOk && dateOk && tabOk;
    });
  }, [dossiers, service, employee, search, startDate, endDate, rowTab]);

  const selectedAgentMetric = useMemo(
    () => employeeAudits.find((item) => item.name === selectedAgent) ?? employeeAudits[0] ?? null,
    [employeeAudits, selectedAgent],
  );

  const missionGuide = mission === "GLOBAL"
    ? "Vue IA globale: priorise les dossiers a risque, propose une decision de cloture et un plan d'actions transverse."
    : mission === "VENTES_COMPAGNIE"
      ? "Mission ventes compagnie: confrontez le rapport externe (ex: AIRCONGO) avec les billets encodes de cette compagnie."
      : mission === "MOUVEMENTS_CAISSE"
        ? "Mission caisse: verifie coherence entre mouvements externes et paiements/decaissements internes."
        : mission === "BESOINS_VS_CAISSE"
          ? "Mission besoins vs caisse: rapproche besoins approuves et sorties effectives de caisse."
          : mission === "ARCHIVES"
            ? "Mission archives: verifie que le registre externe correspond aux dossiers archives dans l'application."
            : "Mission agent: evalue la performance d'un employe via presences, rapports et billets vendus.";

  async function runExternalCompare() {
    if (!canWrite) {
      setStatus("Mode lecture: comparaison externe reservee a l'auditeur.");
      return;
    }

    if (!compareFile) {
      setStatus("Choisissez un fichier externe avant comparaison.");
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
      setStatus(body?.error ?? "Comparaison externe echouee.");
      setCompareLoading(false);
      return;
    }

    setCompareResult(body?.data ?? null);
    setStatus("Comparaison terminee. Vous pouvez lancer l'analyse IA.");
    setCompareLoading(false);
  }

  async function runAiAnalysis() {
    if (!canWrite) {
      setStatus("Mode lecture: analyse IA reservee a l'auditeur.");
      return;
    }

    setAiLoading(true);

    const payload = {
      mission,
      airlineScope,
      compareResult: compareResult
        ? {
          summary: compareResult.summary,
          rows: compareResult.rows.slice(0, 250).map((row) => ({
            key: row.key,
            issue: row.issue,
            severity: row.severity,
            systemValue: row.systemValue,
            externalValue: row.externalValue,
            strictTextEqual: row.strictTextEqual,
            strictAmountEqual: row.strictAmountEqual,
          })),
        }
        : undefined,
      dossiers: filtered.slice(0, 500).map((item) => ({
        entityType: item.entityType,
        entityId: item.entityId,
        reference: item.reference,
        service: item.service,
        auditDecision: item.auditDecision,
        riskScore: item.riskScore,
        riskLevel: item.riskLevel,
        riskReason: item.riskReason,
        amount: item.amount,
      })),
      employeeAudits: employeeAudits.map((item) => ({
        name: item.name,
        attendanceRate: item.attendanceRate,
        reportsSubmitted: item.reportsSubmitted,
        reportsApproved: item.reportsApproved,
        ticketsSold: item.ticketsSold,
        ticketsAmount: item.ticketsAmount,
        score: item.score,
        level: item.level,
      })),
      selectedAgent,
    };

    const response = await fetch("/api/audit/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setStatus(body?.error ?? "Analyse IA indisponible.");
      setAiLoading(false);
      return;
    }

    setAiResult(body?.data ?? null);
    setStatus("Analyse IA prete: decision, raisons et plan d'actions proposes.");
    setAiLoading(false);
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
      <section className="grid shrink-0 gap-3 md:grid-cols-2">
        <button
          type="button"
          onClick={() => setFocusPane("ASSISTANT")}
          className={`rounded-2xl border p-4 text-left transition ${focusPane === "ASSISTANT" ? "border-black/25 bg-black/5 dark:border-white/30 dark:bg-white/10" : "border-black/10 bg-white dark:border-white/10 dark:bg-zinc-900"}`}
        >
          <p className="text-base font-semibold">Assistant IA Audit</p>
          <p className="mt-1 text-xs text-black/60 dark:text-white/60">Filtres, dossiers et supervision. Cette vue prend tout l'espace quand elle est active.</p>
        </button>
        <button
          type="button"
          onClick={() => setFocusPane("ENGINE")}
          className={`rounded-2xl border p-4 text-left transition ${focusPane === "ENGINE" ? "border-black/25 bg-black/5 dark:border-white/30 dark:bg-white/10" : "border-black/10 bg-white dark:border-white/10 dark:bg-zinc-900"}`}
        >
          <p className="text-base font-semibold">Moteur IA</p>
          <p className="mt-1 text-xs text-black/60 dark:text-white/60">Mission, comparaison externe, raisonnement IA et plan d'actions. Cette vue prend tout l'espace quand elle est active.</p>
        </button>
      </section>

      {focusPane === "ASSISTANT" ? (
        <section className="flex min-h-0 min-w-0 flex-1 flex-col rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-zinc-900">
          <div className="shrink-0">
            <h2 className="text-base font-semibold">Assistant IA Audit</h2>
            <p className="mt-1 text-xs text-black/60 dark:text-white/60">Espace de travail audit: filtrez, visualisez et priorisez les dossiers.</p>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
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

          <div className="mt-3 flex items-center justify-between gap-3">
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

          <div className="mt-4 min-h-0 flex-1 overflow-auto rounded-lg border border-black/10 dark:border-white/10">
          <table className="min-w-full text-sm leading-6">
            <thead className="sticky top-0 bg-black/5 dark:bg-white/10">
              <tr>
                <th className="px-3 py-2 text-left">Ref</th>
                <th className="px-3 py-2 text-left">Client</th>
                <th className="px-3 py-2 text-left">Montant</th>
                <th className="px-3 py-2 text-left">Service</th>
                <th className="px-3 py-2 text-left">Audit</th>
                <th className="px-3 py-2 text-left">Risque</th>
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
                  </tr>
                );
              })}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-xs text-black/60 dark:text-white/60">Aucun dossier sur ce filtre.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
          </div>
        </section>
      ) : null}

      {focusPane === "ENGINE" ? (
        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-zinc-900">
          <h2 className="text-base font-semibold">Moteur IA</h2>
          <p className="mt-1 text-xs text-black/60 dark:text-white/60">{missionGuide}</p>

          <div className="mt-4 space-y-3 rounded-xl border border-black/10 p-4 dark:border-white/10">
          <select value={mission} onChange={(e) => setMission(e.target.value as AiAnalysis["mission"])} className="w-full rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20">
            <option value="GLOBAL">Mission globale</option>
            <option value="VENTES_COMPAGNIE">Mission ventes compagnie</option>
            <option value="MOUVEMENTS_CAISSE">Mission mouvements caisse</option>
            <option value="BESOINS_VS_CAISSE">Mission besoins vs caisse</option>
            <option value="ARCHIVES">Mission archives</option>
            <option value="AUDIT_AGENT">Mission audit agent</option>
          </select>

          {mission === "AUDIT_AGENT" ? (
            <select value={selectedAgent} onChange={(e) => setSelectedAgent(e.target.value)} className="w-full rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20">
              {employeeAudits.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
            </select>
          ) : null}

          {mission !== "GLOBAL" && mission !== "AUDIT_AGENT" ? (
            <>
              <select value={compareType} onChange={(e) => setCompareType(e.target.value as typeof compareType)} className="w-full rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20">
                <option value="VENTES">Ventes compagnie vs billets</option>
                <option value="CAISSE">Mouvements caisse</option>
                <option value="BESOINS_CAISSE">Besoins approuves vs caisse</option>
                <option value="ARCHIVES">Archives externes vs internes</option>
                <option value="PRESENCES">Presences</option>
                <option value="RAPPORTS">Rapports</option>
              </select>
              {compareType === "VENTES" ? (
                <input
                  value={airlineScope}
                  onChange={(e) => setAirlineScope(e.target.value)}
                  placeholder="Code compagnie (ex: AIRCONGO)"
                  className="w-full rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20"
                />
              ) : null}
              <input type="file" accept=".csv,.xls,.xlsx,.pdf" onChange={(e) => setCompareFile(e.target.files?.[0] ?? null)} className="w-full rounded-md border border-black/15 px-3 py-2 text-xs dark:border-white/20" />
              <button type="button" disabled={compareLoading || !canWrite} onClick={() => void runExternalCompare()} className="w-full rounded-md border border-black/15 px-3 py-2 text-sm font-semibold hover:bg-black/5 disabled:opacity-60 dark:border-white/20 dark:hover:bg-white/10">
                {compareLoading ? "Comparaison..." : "1) Comparer fichier externe"}
              </button>
            </>
          ) : null}

          <button type="button" disabled={aiLoading || !canWrite} onClick={() => void runAiAnalysis()} className="w-full rounded-md bg-black px-3 py-2 text-sm font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-black">
            {aiLoading ? "Analyse IA..." : "2) Lancer analyse IA"}
          </button>

          <div className="grid grid-cols-3 gap-3 text-xs">
            <div className="rounded-md border border-black/10 px-2 py-1 dark:border-white/10">
              <p className="text-black/60 dark:text-white/60">Risque global</p>
              <p className="font-semibold">{insights.globalRiskIndex}/100</p>
            </div>
            <div className="rounded-md border border-black/10 px-2 py-1 dark:border-white/10">
              <p className="text-black/60 dark:text-white/60">Critiques</p>
              <p className="font-semibold">{insights.criticalPendingCount}</p>
            </div>
            <div className="rounded-md border border-black/10 px-2 py-1 dark:border-white/10">
              <p className="text-black/60 dark:text-white/60">Service expose</p>
              <p className="font-semibold">{insights.topServiceAtRisk}</p>
            </div>
          </div>
          </div>

          <div className="mt-4 min-h-0 flex-1 overflow-auto rounded-xl border border-black/10 p-4 text-sm dark:border-white/10">
          {aiResult ? (
            <div className="space-y-4">
              <div className="rounded-md border border-black/10 bg-black/5 p-3 dark:border-white/10 dark:bg-white/5">
                <p className="text-xs uppercase tracking-wide text-black/60 dark:text-white/60">Decision suggeree</p>
                <p className="text-lg font-semibold">{aiResult.decisionSuggestion} • Confiance {aiResult.confidence}%</p>
                <p className="mt-1 text-xs text-black/60 dark:text-white/60">
                  Risque eleve en attente: {aiResult.keyIndicators.pendingHighRisk} • Rejetes: {aiResult.keyIndicators.rejectedCount} • Ecarts: {aiResult.keyIndicators.comparedMismatches}
                </p>
                <p className="mt-1 text-xs text-black/70 dark:text-white/70">
                  Verdict strict: {aiResult.deepAnalysis.strictVerdict} • Delta estime: {aiResult.deepAnalysis.totalEstimatedDelta.toFixed(2)}
                </p>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Synthese complete IA</p>
                <p className="mt-2 rounded-md border border-black/10 px-3 py-2 text-xs dark:border-white/10">{aiResult.deepAnalysis.executiveSummary}</p>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Matrice de controle</p>
                <ul className="mt-2 space-y-2 text-xs">
                  {aiResult.deepAnalysis.controlMatrix.map((item, index) => (
                    <li key={`${item.control}-${index}`} className="rounded-md border border-black/10 px-3 py-2 dark:border-white/10">
                      <p className="font-semibold">{item.control} • {item.score}% • {item.status}</p>
                      <p className="text-black/60 dark:text-white/60">{item.evidence}</p>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Constats detailles releves par l'IA</p>
                <ul className="mt-2 space-y-2 text-xs">
                  {aiResult.deepAnalysis.findings.map((item, index) => (
                    <li key={`${item.title}-${index}`} className="rounded-md border border-black/10 px-3 py-2 dark:border-white/10">
                      <p className="font-semibold">{item.title} • Priorite {item.priority}</p>
                      <p className="mt-0.5">Impact: {item.impact}</p>
                      <p className="text-black/60 dark:text-white/60">Preuve: {item.evidence}</p>
                      <p className="text-black/60 dark:text-white/60">Recommandation: {item.recommendation}</p>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Echantillon des divergences</p>
                <div className="mt-2 overflow-auto rounded-md border border-black/10 dark:border-white/10">
                  <table className="min-w-full text-xs">
                    <thead className="sticky top-0 bg-black/5 dark:bg-white/10">
                      <tr>
                        <th className="px-2 py-1 text-left">Cle</th>
                        <th className="px-2 py-1 text-left">Issue</th>
                        <th className="px-2 py-1 text-left">Severite</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aiResult.deepAnalysis.evidenceSamples.map((item, index) => (
                        <tr key={`${item.key}-${index}`} className="border-t border-black/5 dark:border-white/10">
                          <td className="px-2 py-1">{item.key}</td>
                          <td className="px-2 py-1">{item.issue}</td>
                          <td className="px-2 py-1">{item.severity}</td>
                        </tr>
                      ))}
                      {aiResult.deepAnalysis.evidenceSamples.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="px-2 py-3 text-center text-black/60 dark:text-white/60">Aucune divergence detaillee.</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Raisonnement IA</p>
                <ul className="mt-2 space-y-2 text-xs">
                  {aiResult.reasons.map((reason, index) => (
                    <li key={`${reason}-${index}`} className="rounded-md border border-black/10 px-3 py-2 dark:border-white/10">{reason}</li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Plan d'actions propose</p>
                <ul className="mt-2 space-y-2 text-xs">
                  {aiResult.actionPlan.map((action, index) => (
                    <li key={`${action.title}-${index}`} className="rounded-md border border-black/10 px-3 py-2 dark:border-white/10">
                      <p className="font-semibold">{action.title}</p>
                      <p className="text-black/60 dark:text-white/60">Priorite {action.priority} • Owner {action.owner} • Echeance J+{action.dueInDays}</p>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">File prioritaire</p>
                <ul className="mt-2 space-y-2 text-xs">
                  {aiResult.priorityQueue.map((item, index) => (
                    <li key={`${item.reference}-${index}`} className="rounded-md border border-black/10 px-3 py-2 dark:border-white/10">
                      {item.reference} • {item.service} • {item.riskScore}/100
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <div className="space-y-3 text-xs text-black/70 dark:text-white/70">
              <p>Aucune analyse IA lancee.</p>
              <p>Workflow recommande:</p>
              <ul className="space-y-1">
                <li>1. Choisissez une mission d'audit.</li>
                <li>2. Comparez un fichier externe si necessaire (excel/csv/pdf).</li>
                <li>3. Lancez l'analyse IA pour obtenir decision + plan d'actions.</li>
              </ul>
              {selectedAgentMetric ? (
                <div className="rounded-md border border-black/10 px-2 py-1 dark:border-white/10">
                  <p className="font-semibold">Agent observe: {selectedAgentMetric.name}</p>
                  <p>Score: {selectedAgentMetric.score}/100 ({selectedAgentMetric.level})</p>
                  <p>Presences: {selectedAgentMetric.attendanceRate}% • Billets: {selectedAgentMetric.ticketsSold}</p>
                </div>
              ) : null}
              <ul className="space-y-1">
                {alerts.anomalies.slice(0, 3).map((item, index) => (
                  <li key={`${item.label}-${index}`} className="rounded-md border border-black/10 px-2 py-1 dark:border-white/10">
                    {item.label}: {item.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {compareResult ? (
            <div className="mt-4 rounded-md border border-black/10 bg-black/5 p-3 text-xs dark:border-white/10 dark:bg-white/5">
              <p className="font-semibold">
                Verdict comparaison stricte: {compareResult.summary.verdict ?? (compareResult.summary.isIdenticalStrictly ? "IDENTIQUE" : "NON_IDENTIQUE")}
              </p>
              <p className="mt-1 text-black/70 dark:text-white/70">
                Texte exact: {compareResult.summary.strictTextMatches ?? 0} identique(s), {compareResult.summary.strictTextMismatches ?? 0} different(s)
              </p>
              <p className="text-black/70 dark:text-white/70">
                Chiffres exacts: {compareResult.summary.strictAmountMatches ?? 0} egaux, {compareResult.summary.strictAmountMismatches ?? 0} non egaux
              </p>
            </div>
          ) : null}
          </div>

          <p className="mt-3 text-xs text-black/60 dark:text-white/60">{status}</p>
        </section>
      ) : null}
    </div>
  );
}
