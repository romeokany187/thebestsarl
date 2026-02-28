export type JobTitleValue =
  | "COMMERCIAL"
  | "COMPTABLE"
  | "CAISSIERE"
  | "RELATION_PUBLIQUE"
  | "APPROVISIONNEMENT_MARKETING"
  | "AGENT_TERRAIN"
  | "DIRECTION_GENERALE";

export function jobTitleLabel(jobTitle: string) {
  const labels: Record<string, string> = {
    COMMERCIAL: "Commercial",
    COMPTABLE: "Comptable",
    CAISSIERE: "Caissière",
    RELATION_PUBLIQUE: "Relation publique",
    APPROVISIONNEMENT_MARKETING: "Approvisionnement marketing",
    AGENT_TERRAIN: "Agent de terrain",
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

  if (jobTitle === "DIRECTION_GENERALE") {
    return ["Supervision globale", "Affectation équipes", "Validation stratégique"];
  }

  if (jobTitle === "RELATION_PUBLIQUE") {
    return ["Suivi partenaires", "Communication externe", "Coordination client"];
  }

  if (jobTitle === "APPROVISIONNEMENT_MARKETING") {
    return ["Support marketing", "Approvisionnement", "Coordination campagnes"];
  }

  return ["Opérations terrain", "Suivi activité", "Support équipe"];
}

export function canSellTickets(jobTitle: string) {
  return jobTitle === "COMMERCIAL" || jobTitle === "DIRECTION_GENERALE";
}

export function canProcessPayments(jobTitle: string) {
  return jobTitle === "COMPTABLE" || jobTitle === "CAISSIERE" || jobTitle === "DIRECTION_GENERALE";
}
