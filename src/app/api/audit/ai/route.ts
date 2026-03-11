import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";

const requestSchema = z.object({
  mission: z.enum(["GLOBAL", "VENTES_COMPAGNIE", "MOUVEMENTS_CAISSE", "BESOINS_VS_CAISSE", "ARCHIVES", "AUDIT_AGENT"]),
  airlineScope: z.string().optional(),
  compareResult: z.object({
    summary: z.object({
      compareType: z.string(),
      period: z.string(),
      externalRows: z.number(),
      checkedRows: z.number(),
      ok: z.number(),
      mismatches: z.number(),
      highSeverity: z.number(),
      scope: z.string().nullable().optional(),
    }),
    rows: z.array(z.object({
      key: z.string(),
      issue: z.string(),
      severity: z.enum(["low", "medium", "high"]),
      systemValue: z.string().optional(),
      externalValue: z.string().optional(),
    })).max(400).optional(),
  }).optional(),
  dossiers: z.array(z.object({
    entityType: z.string(),
    entityId: z.string(),
    reference: z.string(),
    service: z.string(),
    auditDecision: z.enum(["PENDING", "VALIDATED", "REJECTED"]),
    riskScore: z.number(),
    riskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]),
    riskReason: z.string(),
    amount: z.number(),
  })).max(800),
  employeeAudits: z.array(z.object({
    name: z.string(),
    attendanceRate: z.number(),
    reportsSubmitted: z.number(),
    reportsApproved: z.number(),
    ticketsSold: z.number(),
    ticketsAmount: z.number(),
    score: z.number(),
    level: z.enum(["EXCELLENT", "GOOD", "WATCH", "CRITICAL"]),
  })).max(800),
  selectedAgent: z.string().optional(),
});

type Priority = "HIGH" | "MEDIUM" | "LOW";

function cap(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function confidenceFromSignals(signals: number[]) {
  if (signals.length === 0) return 35;
  const avg = signals.reduce((a, b) => a + b, 0) / signals.length;
  return Math.round(cap(avg, 25, 96));
}

function rankIssues(compareRows: Array<{ issue: string; severity: "low" | "medium" | "high" }>) {
  const count = {
    missingSystem: 0,
    missingFile: 0,
    amountDiff: 0,
    fieldDiff: 0,
    high: 0,
  };

  for (const row of compareRows) {
    if (row.issue === "MISSING_IN_SYSTEM") count.missingSystem += 1;
    if (row.issue === "MISSING_IN_FILE") count.missingFile += 1;
    if (row.issue === "AMOUNT_DIFF") count.amountDiff += 1;
    if (row.issue === "FIELD_DIFF") count.fieldDiff += 1;
    if (row.severity === "high") count.high += 1;
  }

  return count;
}

export async function POST(request: NextRequest) {
  const access = await requireApiModuleAccess("audit", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) return access.error;

  const canWrite = access.session.user.role === "ADMIN"
    || (access.session.user.jobTitle ?? "").toUpperCase() === "AUDITEUR";

  if (!canWrite) {
    return NextResponse.json({ error: "Mode lecture: écriture réservée à l'auditeur ou à l'admin." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const payload = parsed.data;
  const compareRows = payload.compareResult?.rows ?? [];
  const issueRank = rankIssues(compareRows);

  const pendingHigh = payload.dossiers.filter((d) => d.auditDecision === "PENDING" && d.riskLevel === "HIGH").length;
  const rejected = payload.dossiers.filter((d) => d.auditDecision === "REJECTED").length;

  const topDossiers = payload.dossiers
    .slice()
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 10)
    .map((d) => ({
      reference: d.reference,
      service: d.service,
      riskScore: d.riskScore,
      reason: d.riskReason,
    }));

  let decisionSuggestion: "VALIDATE" | "REJECT" | "ESCALATE" = "VALIDATE";
  const reasons: string[] = [];
  const actions: Array<{ title: string; priority: Priority; owner: string; dueInDays: number }> = [];
  const confidenceSignals: number[] = [];

  if (payload.mission === "VENTES_COMPAGNIE") {
    const scope = payload.airlineScope?.trim() || "COMPAGNIE";
    if (!payload.compareResult) {
      decisionSuggestion = "ESCALATE";
      reasons.push("Aucun fichier externe n'a été comparé pour la mission ventes compagnie.");
      actions.push({ title: `Importer le rapport externe ${scope} puis relancer l'analyse`, priority: "HIGH", owner: "AUDIT", dueInDays: 1 });
      confidenceSignals.push(30);
    } else {
      reasons.push(`Comparaison ventes ${scope}: ${payload.compareResult.summary.mismatches} ecart(s), ${payload.compareResult.summary.highSeverity} critique(s).`);
      if (issueRank.amountDiff > 0 || issueRank.missingSystem > 0) {
        decisionSuggestion = "ESCALATE";
        reasons.push("Des ecarts de montant ou des ventes absentes du systeme ont ete detectes.");
        actions.push({ title: "Bloquer la cloture compagnie et lancer rapprochement billet par billet", priority: "HIGH", owner: "AUDITEUR", dueInDays: 1 });
        actions.push({ title: `Demander attestation de vente signee a ${scope}`, priority: "MEDIUM", owner: "COMPTABLE", dueInDays: 2 });
        confidenceSignals.push(88);
      } else if (payload.compareResult.summary.mismatches > 0) {
        decisionSuggestion = "REJECT";
        reasons.push("Des incoherences de champs subsistent, correction requise avant validation.");
        actions.push({ title: "Corriger les references/champs non alignes puis rejouer la comparaison", priority: "MEDIUM", owner: "COMMERCIAL", dueInDays: 2 });
        confidenceSignals.push(73);
      } else {
        decisionSuggestion = "VALIDATE";
        reasons.push("Concordance externe/interne satisfaisante sur les ventes de la compagnie ciblee.");
        actions.push({ title: "Valider l'audit ventes compagnie et archiver la preuve de rapprochement", priority: "LOW", owner: "AUDITEUR", dueInDays: 1 });
        confidenceSignals.push(91);
      }
    }
  }

  if (payload.mission === "MOUVEMENTS_CAISSE") {
    if (!payload.compareResult) {
      decisionSuggestion = "ESCALATE";
      reasons.push("Mission caisse sans fichier de mouvements externe: analyse incomplete.");
      actions.push({ title: "Charger l'etat des mouvements de caisse (excel/csv/pdf tabulaire)", priority: "HIGH", owner: "CAISSIERE", dueInDays: 1 });
      confidenceSignals.push(28);
    } else {
      reasons.push(`Etat caisse compare: ${payload.compareResult.summary.mismatches} ecart(s), ${issueRank.amountDiff} ecart(s) montant.`);
      if (issueRank.amountDiff >= 1 || issueRank.high >= 1) {
        decisionSuggestion = "ESCALATE";
        reasons.push("Risque financier eleve sur la coherence encaissements/decaissements.");
        actions.push({ title: "Lancer contre-verification caisse avec comptable + auditeur", priority: "HIGH", owner: "COMPTABLE", dueInDays: 1 });
        actions.push({ title: "Verifier justificatifs des sorties liees aux besoins approuves", priority: "HIGH", owner: "APPRO", dueInDays: 2 });
        confidenceSignals.push(90);
      } else if (payload.compareResult.summary.mismatches > 0) {
        decisionSuggestion = "REJECT";
        reasons.push("Des ecarts non critiques existent, ajustement requis avant cloture.");
        actions.push({ title: "Corriger les references de mouvements caisse puis relancer", priority: "MEDIUM", owner: "CAISSIERE", dueInDays: 2 });
        confidenceSignals.push(71);
      } else {
        decisionSuggestion = "VALIDATE";
        reasons.push("Mouvements caisse coherents avec paiements billets et sorties attendues.");
        actions.push({ title: "Cloturer le controle caisse de la periode", priority: "LOW", owner: "AUDITEUR", dueInDays: 1 });
        confidenceSignals.push(92);
      }
    }
  }

  if (payload.mission === "BESOINS_VS_CAISSE") {
    if (!payload.compareResult) {
      decisionSuggestion = "ESCALATE";
      reasons.push("Aucune confrontation besoins approuves vs sorties caisse n'a ete fournie.");
      actions.push({ title: "Importer l'etat externe des sorties caisse liees aux besoins", priority: "HIGH", owner: "APPRO", dueInDays: 1 });
      confidenceSignals.push(30);
    } else {
      reasons.push(`Confrontation besoins/caisse: ${issueRank.missingFile} besoin(s) sans trace externe, ${issueRank.amountDiff} ecart(s) montant.`);
      if (issueRank.missingFile > 0 || issueRank.amountDiff > 0) {
        decisionSuggestion = "ESCALATE";
        reasons.push("Incoherences critiques detectees entre besoins approuves et mouvements de caisse.");
        actions.push({ title: "Suspendre nouveaux decaissements non rapproches", priority: "HIGH", owner: "DIRECTION", dueInDays: 1 });
        actions.push({ title: "Rapprocher chaque besoin approuve avec piece de sortie correspondante", priority: "HIGH", owner: "COMPTABLE", dueInDays: 2 });
        confidenceSignals.push(89);
      } else {
        decisionSuggestion = "VALIDATE";
        reasons.push("Besoins approuves couverts par les sorties caisse sans ecart majeur.");
        actions.push({ title: "Valider la chaine besoin -> caisse de la periode", priority: "LOW", owner: "AUDITEUR", dueInDays: 1 });
        confidenceSignals.push(87);
      }
    }
  }

  if (payload.mission === "ARCHIVES") {
    if (!payload.compareResult) {
      decisionSuggestion = "ESCALATE";
      reasons.push("Aucun registre externe archives n'a ete fourni pour confrontation.");
      actions.push({ title: "Charger le registre externe des dossiers archives", priority: "MEDIUM", owner: "RELATION_PUBLIQUE", dueInDays: 2 });
      confidenceSignals.push(35);
    } else {
      reasons.push(`Confrontation archives: ${payload.compareResult.summary.mismatches} ecart(s), ${issueRank.missingSystem} absent(s) du systeme.`);
      if (issueRank.missingSystem > 0) {
        decisionSuggestion = "ESCALATE";
        reasons.push("Des dossiers repertories en externe sont absents en archivage interne.");
        actions.push({ title: "Verifier la chaine de numerotation et ajouter les dossiers manquants", priority: "HIGH", owner: "RELATION_PUBLIQUE", dueInDays: 2 });
        confidenceSignals.push(86);
      } else if (payload.compareResult.summary.mismatches > 0) {
        decisionSuggestion = "REJECT";
        reasons.push("Incoherences de reference/classeur detectees dans les archives.");
        actions.push({ title: "Corriger les metadonnees archives puis relancer la comparaison", priority: "MEDIUM", owner: "RH", dueInDays: 3 });
        confidenceSignals.push(68);
      } else {
        decisionSuggestion = "VALIDATE";
        reasons.push("Registre externe coherent avec les archives internes.");
        actions.push({ title: "Valider et verrouiller l'inventaire documentaire de la periode", priority: "LOW", owner: "AUDITEUR", dueInDays: 1 });
        confidenceSignals.push(90);
      }
    }
  }

  if (payload.mission === "AUDIT_AGENT") {
    const agent = payload.employeeAudits.find((item) => item.name === payload.selectedAgent)
      ?? payload.employeeAudits[0];

    if (!agent) {
      decisionSuggestion = "ESCALATE";
      reasons.push("Aucune donnee agent disponible sur la periode.");
      actions.push({ title: "Etendre la periode pour recuperer un historique exploitable", priority: "MEDIUM", owner: "AUDIT", dueInDays: 1 });
      confidenceSignals.push(25);
    } else {
      reasons.push(`Profil agent ${agent.name}: score ${agent.score}/100, presences ${agent.attendanceRate}%, rapports approuves ${agent.reportsApproved}, billets ${agent.ticketsSold}.`);
      if (agent.score < 40) {
        decisionSuggestion = "ESCALATE";
        reasons.push("Performance critique: ecart important entre presence, reporting et production commerciale.");
        actions.push({ title: `Mettre en place un plan d'accompagnement pour ${agent.name}`, priority: "HIGH", owner: "MANAGER", dueInDays: 2 });
        actions.push({ title: `Controler quotidiennement presences + rapports de ${agent.name} pendant 2 semaines`, priority: "HIGH", owner: "AUDITEUR", dueInDays: 1 });
        confidenceSignals.push(84);
      } else if (agent.score < 60) {
        decisionSuggestion = "REJECT";
        reasons.push("Performance sous surveillance: amelioration requise avant validation complete.");
        actions.push({ title: `Definir objectifs hebdomadaires mesurables pour ${agent.name}`, priority: "MEDIUM", owner: "MANAGER", dueInDays: 3 });
        confidenceSignals.push(70);
      } else {
        decisionSuggestion = "VALIDATE";
        reasons.push("Performance agent globalement conforme aux attendus de la periode.");
        actions.push({ title: `Maintenir le suivi mensuel standard de ${agent.name}`, priority: "LOW", owner: "MANAGER", dueInDays: 7 });
        confidenceSignals.push(82);
      }
    }
  }

  if (payload.mission === "GLOBAL") {
    reasons.push(`Vue globale: ${pendingHigh} dossier(s) a risque eleve en attente, ${rejected} dossier(s) rejetes.`);
    if (pendingHigh >= 5 || rejected >= 5) {
      decisionSuggestion = "ESCALATE";
      reasons.push("Niveau de risque global eleve, arbitrage direction recommande.");
      actions.push({ title: "Prioriser les 10 dossiers les plus risques avec revue quotidienne", priority: "HIGH", owner: "AUDITEUR", dueInDays: 1 });
      actions.push({ title: "Reunion de gouvernance risque avec direction", priority: "HIGH", owner: "DIRECTION", dueInDays: 2 });
      confidenceSignals.push(87);
    } else if (pendingHigh > 0 || rejected > 0) {
      decisionSuggestion = "REJECT";
      reasons.push("Des points de non-conformite persistent avant cloture globale.");
      actions.push({ title: "Traiter les rejets et relancer verification de conformite", priority: "MEDIUM", owner: "AUDITEUR", dueInDays: 2 });
      confidenceSignals.push(72);
    } else {
      decisionSuggestion = "VALIDATE";
      reasons.push("Aucun signal critique bloquant sur la periode analysee.");
      actions.push({ title: "Cloturer l'audit global et archiver les preuves", priority: "LOW", owner: "AUDITEUR", dueInDays: 1 });
      confidenceSignals.push(90);
    }
  }

  const confidence = confidenceFromSignals(confidenceSignals);

  const result = {
    mission: payload.mission,
    decisionSuggestion,
    confidence,
    reasons: reasons.slice(0, 8),
    actionPlan: actions.slice(0, 8),
    keyIndicators: {
      pendingHighRisk: pendingHigh,
      rejectedCount: rejected,
      comparedMismatches: payload.compareResult?.summary.mismatches ?? 0,
      comparedCritical: payload.compareResult?.summary.highSeverity ?? 0,
    },
    priorityQueue: topDossiers,
  };

  await prisma.auditLog.create({
    data: {
      actorId: access.session.user.id,
      action: "AUDIT_AI_ANALYSIS",
      entityType: "AUDIT_WORKSPACE",
      entityId: "GLOBAL",
      payload: {
        mission: payload.mission,
        decisionSuggestion: result.decisionSuggestion,
        confidence: result.confidence,
        keyIndicators: result.keyIndicators,
      } as Prisma.InputJsonValue,
    },
  });

  return NextResponse.json({ data: result });
}
