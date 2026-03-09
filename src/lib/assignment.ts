export type JobTitleValue =
  | "COMMERCIAL"
  | "COMPTABLE"
  | "AUDITEUR"
  | "CAISSIERE"
  | "RELATION_PUBLIQUE"
  | "APPROVISIONNEMENT_MARKETING"
  | "AGENT_TERRAIN"
  | "DIRECTION_GENERALE";

export function jobTitleLabel(jobTitle: string) {
  const labels: Record<string, string> = {
    COMMERCIAL: "Commercial",
    COMPTABLE: "Comptable",
    AUDITEUR: "Auditeur",
    CAISSIERE: "Caissière",
    RELATION_PUBLIQUE: "Relations publiques & ressources humaines",
    APPROVISIONNEMENT_MARKETING: "Chargé des approvisionnements",
    AGENT_TERRAIN: "Non affecté",
    DIRECTION_GENERALE: "Direction générale",
  };

  return labels[jobTitle] ?? jobTitle;
}

export function assignmentCapabilities(jobTitle: string) {
  if (jobTitle === "COMMERCIAL") {
    return ["Encodage billets", "Suivi ventes", "Mise à jour de ses billets"];
  }

  if (jobTitle === "CAISSIERE" || jobTitle === "COMPTABLE") {
    return ["Encaissements", "Suivi créances", "Validation paiements"];
  }

  if (jobTitle === "AUDITEUR") {
    return ["Contrôle de conformité", "Analyse des écarts", "Traçabilité des constats"];
  }

  if (jobTitle === "DIRECTION_GENERALE") {
    return ["Supervision globale", "Affectation équipes", "Validation stratégique"];
  }

  if (jobTitle === "RELATION_PUBLIQUE") {
    return ["Relations publiques", "Suivi RH", "Coordination institutionnelle"];
  }

  if (jobTitle === "APPROVISIONNEMENT_MARKETING") {
    return ["Approvisionnement", "Suivi fournisseurs", "Coordination logistique"];
  }

  return ["Opérations terrain", "Suivi activité", "Support équipe"];
}

export function canSellTickets(jobTitle: string) {
  return jobTitle === "COMMERCIAL" || jobTitle === "DIRECTION_GENERALE";
}

export function canProcessPayments(jobTitle: string) {
  return jobTitle === "COMPTABLE" || jobTitle === "CAISSIERE";
}
