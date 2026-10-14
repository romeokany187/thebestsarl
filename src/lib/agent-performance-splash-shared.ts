export const PERFORMANCE_SPLASH_PENDING_KEY = "thebest:pending-performance-splash";

export type PerformanceTier = "low" | "medium" | "high";

export type AgentMonthlyPerformance = {
  monthKey: string;
  monthLabel: string;
  totalTickets: number;
  paidCount: number;
  unpaidCount: number;
  partialCount: number;
  openCount: number;
  tier: PerformanceTier;
};

export function resolvePerformanceTier(totalTickets: number): PerformanceTier {
  if (totalTickets > 15) return "high";
  if (totalTickets > 5) return "medium";
  return "low";
}

export type PerformancePresentation = {
  message: string;
  accentClass: string;
  glowClass: string;
  badgeLabel: string;
  alert: boolean;
};

export function presentationForPerformance(
  tier: PerformanceTier,
  stats: Pick<AgentMonthlyPerformance, "totalTickets" | "paidCount" | "openCount">,
): PerformancePresentation {
  const collectionHint =
    stats.openCount > 0
      ? ` ${stats.paidCount} billet(s) soldé(s) en caisse, ${stats.openCount} encore ouvert(s) — le recouvrement est urgent.`
      : stats.totalTickets > 0
        ? " Tous vos billets du mois sont soldés selon la caisse."
        : "";

  if (tier === "high") {
    return {
      badgeLabel: "Excellent mois",
      alert: false,
      message: `Félicitations — volume solide.${collectionHint} Maintenez cette cadence et la qualité de service.`,
      accentClass: "from-emerald-600 via-teal-600 to-cyan-700",
      glowClass: "shadow-[0_0_80px_rgba(16,185,129,0.45)]",
    };
  }

  if (tier === "medium") {
    return {
      badgeLabel: "Bon rythme",
      alert: false,
      message: `Vous progressez.${collectionHint} Gardez le cap : chaque nouvelle vente compte pour atteindre vos objectifs.`,
      accentClass: "from-blue-700 via-indigo-700 to-violet-800",
      glowClass: "shadow-[0_0_80px_rgba(59,130,246,0.4)]",
    };
  }

  if (stats.totalTickets === 0) {
    return {
      badgeLabel: "Alerte performance",
      alert: true,
      message: `Aucune vente enregistrée à votre nom payant ce mois.${collectionHint} Relancez vos clients, vérifiez avec la caisse que rien ne manque, et reprenez l'activité dès aujourd'hui.`,
      accentClass: "from-red-950 via-red-700 to-orange-700",
      glowClass: "shadow-[0_0_100px_rgba(239,68,68,0.55)]",
    };
  }

  return {
    badgeLabel: "Alerte performance",
    alert: true,
    message: `Volume insuffisant pour le mois en cours.${collectionHint} Structurez vos relances, sécurisez les encaissements et accélérez vos ventes immédiatement.`,
    accentClass: "from-red-950 via-red-700 to-orange-700",
    glowClass: "shadow-[0_0_100px_rgba(239,68,68,0.55)]",
  };
}
