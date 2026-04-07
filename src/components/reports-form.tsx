"use client";

import { useEffect, useState } from "react";

type JobTitle =
  | "COMMERCIAL"
  | "COMPTABLE"
  | "AUDITEUR"
  | "CAISSIER"
  | "CAISSE_2_SIEGE"
  | "CAISSE_AGENCE"
  | "RELATION_PUBLIQUE"
  | "APPROVISIONNEMENT"
  | "AGENT_TERRAIN"
  | "DIRECTION_GENERALE"
  | "CHEF_AGENCE";

type UserOption = { id: string; name: string; role: string; jobTitle: JobTitle; service: string };

type JobTemplateSection = {
  title: string;
  prompt: string;
};

type JobTemplate = {
  intro: string;
  sections: [JobTemplateSection, JobTemplateSection, JobTemplateSection, JobTemplateSection];
};

const rubricByJobTitle: Record<JobTitle, JobTemplate> = {
  COMMERCIAL: {
    intro: "Rapport commercial axe sur la performance de vente et la conversion client.",
    sections: [
      { title: "Resultats commerciaux", prompt: "Objectifs atteints, nouveaux clients, taux de conversion." },
      { title: "Actions de vente executees", prompt: "Billets emis, relances, devis et negociations realisees." },
      { title: "Freins commerciaux", prompt: "Annulations, objections client, impayes ou dossiers bloques." },
      { title: "Plan de progression", prompt: "Actions prevues pour augmenter les ventes sur la prochaine periode." },
    ],
  },
  COMPTABLE: {
    intro: "Rapport comptable axe sur la fiabilite des comptes et la regularite des pieces.",
    sections: [
      { title: "Etat comptable", prompt: "Synthese des ecritures, soldes et rapprochements realises." },
      { title: "Operations traitees", prompt: "Saisies, controles, pointages, justificatifs verifies." },
      { title: "Ecarts et anomalies", prompt: "Differences detectees, pieces manquantes, corrections necessaires." },
      { title: "Actions de regularisation", prompt: "Mesures pour corriger les ecarts et securiser la cloture." },
    ],
  },
  AUDITEUR: {
    intro: "Rapport d'audit axe sur la conformite, les risques et les preuves de controle.",
    sections: [
      { title: "Portee de l'audit", prompt: "Processus, dossiers et echantillons controles durant la periode." },
      { title: "Constats documentes", prompt: "Preuves collectees, verifications croisees, tests effectues." },
      { title: "Non-conformites et risques", prompt: "Ecarts, gravite, impacts potentiels, causes probables." },
      { title: "Recommandations et suivi", prompt: "Actions correctives proposees et calendrier de verification." },
    ],
  },
  CAISSIER: {
    intro: "Rapport de la caisse 1 siège axe sur les flux quotidiens et la maitrise des ecarts.",
    sections: [
      { title: "Etat de caisse", prompt: "Encaissements, decaissements, solde journalier et mouvements clés." },
      { title: "Operations de caisse", prompt: "Recus emis, paiements recus, remises et validations effectuees." },
      { title: "Incidents de caisse", prompt: "Ecarts constates, retards de reglement, anomalies operationnelles." },
      { title: "Mesures de securisation", prompt: "Actions prises pour fiabiliser la caisse et prevenir les ecarts." },
    ],
  },
  CAISSE_2_SIEGE: {
    intro: "Rapport de la caisse 2 siège axe sur les flux quotidiens et la maitrise des ecarts.",
    sections: [
      { title: "Etat de caisse", prompt: "Encaissements, decaissements, solde journalier et mouvements clés." },
      { title: "Operations de caisse", prompt: "Recus emis, paiements recus, remises et validations effectuees." },
      { title: "Incidents de caisse", prompt: "Ecarts constates, retards de reglement, anomalies operationnelles." },
      { title: "Mesures de securisation", prompt: "Actions prises pour fiabiliser la caisse et prevenir les ecarts." },
    ],
  },
  CAISSE_AGENCE: {
    intro: "Rapport de la caisse agence axe sur les flux quotidiens et la maitrise des ecarts.",
    sections: [
      { title: "Etat de caisse", prompt: "Encaissements, decaissements, solde journalier et mouvements clés." },
      { title: "Operations de caisse", prompt: "Recus emis, paiements recus, remises et validations effectuees." },
      { title: "Incidents de caisse", prompt: "Ecarts constates, retards de reglement, anomalies operationnelles." },
      { title: "Mesures de securisation", prompt: "Actions prises pour fiabiliser la caisse et prevenir les ecarts." },
    ],
  },
  RELATION_PUBLIQUE: {
    intro: "Rapport de relation publique axe sur la communication institutionnelle et la coordination.",
    sections: [
      { title: "Situation de communication", prompt: "Informations diffusees, coordinations menees, image institutionnelle." },
      { title: "Activites menees", prompt: "Relations publiques, accompagnements et communication institutionnelle." },
      { title: "Points sensibles", prompt: "Reclamations, incidents de communication et contraintes organisationnelles." },
      { title: "Plan d'amelioration", prompt: "Mesures prevues pour renforcer l'organisation et la communication." },
    ],
  },
  APPROVISIONNEMENT: {
    intro: "Rapport approvisionnement axe sur les besoins, commandes et disponibilites de stock.",
    sections: [
      { title: "Etat des besoins et stocks", prompt: "Articles critiques, niveaux de stock, urgences d'approvisionnement." },
      { title: "Commandes et livraisons", prompt: "Commandes lancees, receptions, suivi fournisseurs, delais." },
      { title: "Risques logistiques", prompt: "Ruptures, retards, non-conformites de livraison ou surcouts." },
      { title: "Plan d'achat prioritaire", prompt: "Priorites d'achat, alternatives fournisseurs, plan d'execution." },
    ],
  },
  AGENT_TERRAIN: {
    intro: "Rapport terrain axe sur les interventions et les resultats operationnels.",
    sections: [
      { title: "Synthese des interventions", prompt: "Sites visites, missions effectuees, resultats observes." },
      { title: "Actions executees", prompt: "Taches realisees sur le terrain et decisions prises." },
      { title: "Contraintes rencontrees", prompt: "Blocages logistiques, incidents, difficultes de coordination." },
      { title: "Plan de route", prompt: "Prochaines interventions, ressources necessaires, priorites." },
    ],
  },
  DIRECTION_GENERALE: {
    intro: "Rapport de direction axe sur le pilotage global et les arbitrages strategiques.",
    sections: [
      { title: "Vue d'ensemble", prompt: "Synthese des resultats globaux et de la performance interservices." },
      { title: "Arbitrages et decisions", prompt: "Decisions prises, instructions donnees, suivis transversaux." },
      { title: "Risques majeurs", prompt: "Blocages critiques, dependances et points de vigilance." },
      { title: "Orientations prioritaires", prompt: "Cap a suivre, objectifs et chantiers prioritaires." },
    ],
  },
  CHEF_AGENCE: {
    intro: "Rapport du Chef d'agence axe sur le pilotage local et la coordination d'equipe.",
    sections: [
      { title: "Vue locale", prompt: "Synthese des resultats de l'agence et de la performance par service." },
      { title: "Coordination d'equipe", prompt: "Animation, delegations, suivis des collaborateurs." },
      { title: "Points d'attention", prompt: "Blocages locaux, ressources limitantes, alertes." },
      { title: "Plan d'action", prompt: "Priorites operationnelles, objectifs et chantiers a piloter." },
    ],
  },
};

const titleByJobTitle: Record<JobTitle, string> = {
  COMMERCIAL: "Rapport de vente commerciale",
  COMPTABLE: "Rapport financier comptable",
  AUDITEUR: "Rapport d'audit de conformite",
  CAISSIER: "Rapport de caisse - Caisse 1 Siège",
  CAISSE_2_SIEGE: "Rapport de caisse - Caisse 2 Siège",
  CAISSE_AGENCE: "Rapport de caisse - Caisse agence",
  RELATION_PUBLIQUE: "Rapport de relation publique",
  APPROVISIONNEMENT: "Rapport d'approvisionnement",
  AGENT_TERRAIN: "Rapport d'activite terrain",
  DIRECTION_GENERALE: "Rapport du Directeur Général",
  CHEF_AGENCE: "Rapport du Manager",
};

export function ReportsForm({ users }: { users: UserOption[] }) {
  const [status, setStatus] = useState<string>("");
  const [selectedAuthorId, setSelectedAuthorId] = useState<string>(users[0]?.id ?? "");
  const [reportTitle, setReportTitle] = useState<string>("");

  const selectedAuthor = users.find((user) => user.id === selectedAuthorId) ?? null;
  const rubrics = selectedAuthor ? rubricByJobTitle[selectedAuthor.jobTitle] : null;

  useEffect(() => {
    if (!selectedAuthor) {
      setReportTitle(""); // eslint-disable-line react-hooks/set-state-in-effect
      return;
    }

    const baseTitle = titleByJobTitle[selectedAuthor.jobTitle] ?? "Rapport professionnel";
    setReportTitle(`${baseTitle} - ${new Date().toISOString().slice(0, 10)}`);
  }, [selectedAuthorId, selectedAuthor]);

  async function onSubmit(formData: FormData) {
    setStatus("Enregistrement...");
    const ticketsSoldRaw = String(formData.get("ticketsSoldCount") ?? "").trim();
    const ticketsSoldCount = Number.parseInt(ticketsSoldRaw, 10);
    if (!Number.isFinite(ticketsSoldCount) || ticketsSoldCount < 0) {
      setStatus("Indiquez un nombre valide de billets vendus (0 ou plus).");
      return;
    }

    const rubricSummary = String(formData.get("rubricSummary") ?? "").trim();
    const rubricTasks = String(formData.get("rubricTasks") ?? "").trim();
    const rubricIssues = String(formData.get("rubricIssues") ?? "").trim();
    const rubricPlan = String(formData.get("rubricPlan") ?? "").trim();

    const sectionOneTitle = rubrics?.sections[0].title ?? "Synthese des activites";
    const sectionTwoTitle = rubrics?.sections[1].title ?? "Taches executees";
    const sectionThreeTitle = rubrics?.sections[2].title ?? "Difficultes rencontrees";
    const sectionFourTitle = rubrics?.sections[3].title ?? "Plan d'action";

    const content = [
      "Indicateur commun",
      `Billets vendus: ${ticketsSoldCount}`,
      "",
      `Rubrique 1 - ${sectionOneTitle}`,
      rubricSummary,
      "",
      `Rubrique 2 - ${sectionTwoTitle}`,
      rubricTasks,
      "",
      `Rubrique 3 - ${sectionThreeTitle}`,
      rubricIssues,
      "",
      `Rubrique 4 - ${sectionFourTitle}`,
      rubricPlan,
    ].join("\n");

    const statusValue = String(formData.get("status") ?? "SUBMITTED");

    const payload = {
      title: reportTitle,
      content,
      period: formData.get("period"),
      periodStart: formData.get("periodStart"),
      periodEnd: formData.get("periodEnd"),
      status: statusValue,
      authorId: formData.get("authorId"),
    };

    const response = await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const payloadError = await response.json().catch(() => null);
      const periodEndErrors = payloadError?.error?.fieldErrors?.periodEnd;
      setStatus(
        periodEndErrors?.[0] ?? payloadError?.error ?? "Erreur de validation.",
      );
      return;
    }

    const result = await response.json();
    setStatus("Rapport enregistré.");

    if (statusValue === "SUBMITTED" && result?.data?.id) {
      window.open(`/reports/${result.data.id}/print`, "_blank", "noopener,noreferrer");
    }

    if (response.ok) {
      window.location.reload();
    }
  }

  return (
    <form
      action={async (formData) => {
        await onSubmit(formData);
      }}
      className="grid gap-3 rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900"
    >
      <h3 className="text-sm font-semibold">Nouveau rapport</h3>
      <div className="grid gap-2">
        <label htmlFor="reportTitle" className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">
          Titre du rapport (base selon la fonction)
        </label>
        <input
          id="reportTitle"
          name="title"
          required
          value={reportTitle}
          onChange={(event) => setReportTitle(event.target.value)}
          placeholder="Titre du rapport"
          className="rounded-md border px-3 py-2"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <select name="period" className="rounded-md border px-3 py-2" defaultValue="DAILY">
          <option value="DAILY">Journalier</option>
          <option value="WEEKLY">Hebdomadaire</option>
          <option value="MONTHLY">Mensuel</option>
          <option value="SEMESTER">Semestriel</option>
          <option value="ANNUAL">Annuel</option>
        </select>
        <select name="status" className="rounded-md border px-3 py-2" defaultValue="SUBMITTED">
          <option value="DRAFT">Brouillon</option>
          <option value="SUBMITTED">Soumis</option>
        </select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <input name="periodStart" type="date" required className="rounded-md border px-3 py-2" />
        <input name="periodEnd" type="date" required className="rounded-md border px-3 py-2" />
      </div>
      <select
        name="authorId"
        required
        className="rounded-md border px-3 py-2"
        value={selectedAuthorId}
        onChange={(event) => setSelectedAuthorId(event.target.value)}
      >
        <option value="">Sélectionner un employé</option>
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name}
          </option>
        ))}
      </select>
      <div className="rounded-lg border border-black/10 bg-black/5 px-3 py-2 text-xs dark:border-white/10 dark:bg-white/5">
        <p>Fonction: {selectedAuthor?.role ?? "-"}</p>
        <p>Service: {selectedAuthor?.service ?? "-"}</p>
        <p className="mt-1 text-black/70 dark:text-white/70">{rubrics?.intro ?? "Selectionnez une fonction pour charger la trame specialisee."}</p>
      </div>

      <div className="grid gap-2">
        <label htmlFor="ticketsSoldCount" className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">
          Billets vendus (obligatoire pour tous)
        </label>
        <input
          id="ticketsSoldCount"
          name="ticketsSoldCount"
          type="number"
          min={0}
          step={1}
          required
          placeholder="Ex: 12"
          className="rounded-md border px-3 py-2"
        />
      </div>

      <label htmlFor="rubricSummary" className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">
        {rubrics?.sections[0].title ?? "Rubrique 1"}
      </label>
      <textarea
        id="rubricSummary"
        name="rubricSummary"
        required
        placeholder={rubrics ? rubrics.sections[0].prompt : "Rubrique 1: Synthese des activites"}
        className="min-h-20 rounded-md border px-3 py-2"
      />

      <label htmlFor="rubricTasks" className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">
        {rubrics?.sections[1].title ?? "Rubrique 2"}
      </label>
      <textarea
        id="rubricTasks"
        name="rubricTasks"
        required
        placeholder={rubrics ? rubrics.sections[1].prompt : "Rubrique 2: Taches executees"}
        className="min-h-20 rounded-md border px-3 py-2"
      />

      <label htmlFor="rubricIssues" className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">
        {rubrics?.sections[2].title ?? "Rubrique 3"}
      </label>
      <textarea
        id="rubricIssues"
        name="rubricIssues"
        required
        placeholder={rubrics ? rubrics.sections[2].prompt : "Rubrique 3: Difficultes rencontrees"}
        className="min-h-20 rounded-md border px-3 py-2"
      />

      <label htmlFor="rubricPlan" className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">
        {rubrics?.sections[3].title ?? "Rubrique 4"}
      </label>
      <textarea
        id="rubricPlan"
        name="rubricPlan"
        required
        placeholder={rubrics ? rubrics.sections[3].prompt : "Rubrique 4: Plan d'action"}
        className="min-h-20 rounded-md border px-3 py-2"
      />
      <button className="rounded-md bg-black px-3 py-2 text-white dark:bg-white dark:text-black">Enregistrer</button>
      <p className="text-xs text-black/60 dark:text-white/60">{status}</p>
    </form>
  );
}
