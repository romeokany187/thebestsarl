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

export function shouldShowPerformanceSplashForRole(role: string) {
  const normalized = role.trim().toUpperCase();
  return normalized !== "ADMIN" && normalized !== "DIRECTEUR_GENERAL";
}

export type PerformancePresentation = {
  title: string;
  subtitle: string;
  message: string;
  accentClass: string;
  glowClass: string;
  badgeLabel: string;
};

export function presentationForPerformance(
  tier: PerformanceTier,
  stats: Pick<AgentMonthlyPerformance, "totalTickets" | "paidCount" | "openCount">,
): PerformancePresentation {
  const collectionHint =
    stats.openCount > 0
      ? ` Encaissements caisse : ${stats.paidCount} soldé(s), ${stats.openCount} encore ouvert(s) — priorisez le recouvrement.`
      : stats.totalTickets > 0
        ? " Tous vos billets du mois sont soldés selon la caisse. Excellent suivi."
        : "";

  if (tier === "high") {
    return {
      badgeLabel: "Excellent rendement",
      title: "Vous êtes sur la bonne trajectoire",
      subtitle: "Plus de 15 billets ce mois — payant",
      message: `Volume solide pour ${stats.totalTickets} billet(s). Continuez la rigueur sur les encaissements et la qualité client.${collectionHint}`,
      accentClass: "from-emerald-600 via-teal-600 to-cyan-700",
      glowClass: "shadow-[0_0_80px_rgba(16,185,129,0.45)]",
    };
  }

  if (tier === "medium") {
    return {
      badgeLabel: "Rendement moyen",
      title: "Bonne base — accélérez maintenant",
      subtitle: "Entre 6 et 15 billets ce mois — payant",
      message: `${stats.totalTickets} billet(s) enregistré(s). Visez la régularité quotidienne et le suivi des impayés pour passer au niveau supérieur.${collectionHint}`,
      accentClass: "from-blue-700 via-indigo-700 to-violet-800",
      glowClass: "shadow-[0_0_80px_rgba(59,130,246,0.4)]",
    };
  }

  return {
    badgeLabel: "Rendement à renforcer",
    title: "Chaque billet compte",
    subtitle: "5 billets ou moins ce mois — payant",
    message:
      stats.totalTickets === 0
        ? "Aucun billet rattaché à votre nom payant ce mois. Contactez la caisse si des ventes manquent, et relancez vos prospects dès aujourd'hui."
        : `${stats.totalTickets} billet(s) seulement. Structurez vos relances, sécurisez les encaissements et visez au moins 6 ventes d'ici la fin du mois.${collectionHint}`,
    accentClass: "from-amber-600 via-orange-600 to-rose-700",
    glowClass: "shadow-[0_0_80px_rgba(245,158,11,0.35)]",
  };
}
