export type JobTitleValue =
  | "COMMERCIAL"
  | "COMPTABLE"
  | "AUDITEUR"
  | "CAISSIER"
  | "RELATION_PUBLIQUE"
  | "APPROVISIONNEMENT"
  | "AGENT_TERRAIN"
  | "DIRECTION_GENERALE"
  | "CHEF_AGENCE";

export function jobTitleLabel(jobTitle: string) {
  const labels: Record<string, string> = {
    COMMERCIAL: "Commercial",
    COMPTABLE: "Comptable",
    AUDITEUR: "Auditeur",
    CAISSIER: "Caissier",
    RELATION_PUBLIQUE: "Relation publique",
    APPROVISIONNEMENT: "Chargé des approvisionnements",
    AGENT_TERRAIN: "Non affecté",
    DIRECTION_GENERALE: "Directeur Général",
    CHEF_AGENCE: "Chef d'agence",
  };

  return labels[jobTitle] ?? jobTitle;
}

export function assignmentCapabilities(jobTitle: string) {
  if (jobTitle === "COMMERCIAL") {
    return ["Encodage billets", "Suivi ventes", "Mise à jour de ses billets"];
  }

  if (jobTitle === "CAISSIER" || jobTitle === "COMPTABLE") {
    return ["Encaissements", "Suivi créances", "Validation paiements"];
  }

  if (jobTitle === "AUDITEUR") {
    return ["Contrôle de conformité", "Analyse des écarts", "Traçabilité des constats"];
  }

  if (jobTitle === "DIRECTION_GENERALE") {
    return ["Supervision globale", "Affectation équipes", "Validation stratégique"];
  }

  if (jobTitle === "RELATION_PUBLIQUE") {
    return ["Relation publique", "Communication institutionnelle", "Coordination"];
  }

  if (jobTitle === "APPROVISIONNEMENT") {
    return ["Approvisionnement", "Suivi fournisseurs", "Coordination logistique"];
  }

  return ["Opérations terrain", "Suivi activité", "Support équipe"];
}

export function canSellTickets(_jobTitle: string) {
  return true;
}

export function canManageTicketRecord(role: string) {
  return role === "ADMIN";
}

export function canImportTicketWorkbook(role: string, _explicitPermission?: boolean | null, _jobTitle?: string | null) {
  return role === "ADMIN";
}

export function canProcessPayments(jobTitle: string) {
  return jobTitle === "COMPTABLE" || jobTitle === "CAISSIER";
}
