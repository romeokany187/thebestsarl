import { isCashierJobTitle, jobTitleLabel } from "@/lib/assignment";
import { hasModuleAccess, type AppModule, type AppRole } from "@/lib/rbac";
import { getEffectiveModuleAccessLevel, hasRequiredModuleAccessLevel, type ModuleAccessLevel } from "@/lib/user-module-access";

type ModuleAccessMap = Partial<Record<AppModule, ModuleAccessLevel>>;

export type HomeQuickAction = {
  href: string;
  label: string;
  description: string;
};

function canUseModule(
  module: AppModule,
  role: AppRole,
  jobTitle: string | null | undefined,
  teamName: string | null | undefined,
  accessMap: ModuleAccessMap,
  level: ModuleAccessLevel = "READ",
) {
  const custom = getEffectiveModuleAccessLevel(accessMap, module);
  if (hasRequiredModuleAccessLevel(custom, level)) {
    return true;
  }

  return hasModuleAccess({ role, jobTitle, teamName, module });
}

function pushUnique(actions: HomeQuickAction[], action: HomeQuickAction) {
  if (actions.some((item) => item.href === action.href)) {
    return;
  }
  actions.push(action);
}

export function resolvePostLoginPath() {
  return "/";
}

export function buildHomeQuickActions(params: {
  role: AppRole;
  jobTitle?: string | null;
  teamName?: string | null;
  accessMap: ModuleAccessMap;
}): HomeQuickAction[] {
  const { role, teamName, accessMap } = params;
  const jobTitle = (params.jobTitle ?? "AGENT_TERRAIN").trim().toUpperCase();
  const actions: HomeQuickAction[] = [];

  const salesWrite = canUseModule("sales", role, jobTitle, teamName, accessMap, "WRITE");
  const salesRead = canUseModule("sales", role, jobTitle, teamName, accessMap, "READ");
  const paymentsWrite = canUseModule("payments", role, jobTitle, teamName, accessMap, "WRITE");
  const paymentsRead = canUseModule("payments", role, jobTitle, teamName, accessMap, "READ");

  if (salesWrite) {
    pushUnique(actions, {
      href: "/sales?view=sell",
      label: "Vendre un billet",
      description: "Encoder une vente (l'encaissement se fait dans Paiements).",
    });
  }

  if (salesRead) {
    pushUnique(actions, {
      href: "/sales?view=list",
      label: "Liste des billets",
      description: "Consulter et filtrer les ventes sur une période.",
    });
    pushUnique(actions, {
      href: "/sales?view=stats",
      label: "Statistiques ventes",
      description: "KPI, progression et compagnies les plus vendues.",
    });
  }

  if (paymentsWrite) {
    pushUnique(actions, {
      href: "/payments?mode=tickets&ui=simple",
      label: "Encaisser un billet",
      description: "Enregistrer le paiement d'un billet déjà vendu.",
    });
    pushUnique(actions, {
      href: "/payments?mode=cash&ui=simple",
      label: "Opération de caisse",
      description: "Entrée ou sortie de caisse (hors vente billet).",
    });
  } else if (paymentsRead) {
    pushUnique(actions, {
      href: "/payments",
      label: "Paiements & caisse",
      description: "Consulter la caisse et l'historique.",
    });
  }

  if (canUseModule("attendance", role, jobTitle, teamName, accessMap, "READ")) {
    pushUnique(actions, {
      href: "/attendance",
      label: "Présences",
      description: "Signer l'entrée ou la sortie du jour.",
    });
  }

  if (canUseModule("reports", role, jobTitle, teamName, accessMap, "READ")) {
    pushUnique(actions, {
      href: "/reports",
      label: "Rapports",
      description: "Rapports journaliers, hebdo, mensuels.",
    });
  }

  if (canUseModule("procurement", role, jobTitle, teamName, accessMap, "READ")) {
    pushUnique(actions, {
      href: "/approvisionnement",
      label: "Approvisionnement",
      description: "Besoins, stock et exécution.",
    });
  }

  if (canUseModule("comptabilite", role, jobTitle, teamName, accessMap, "READ")) {
    pushUnique(actions, {
      href: "/comptabilite",
      label: "Comptabilité",
      description: "Journal, taux et états.",
    });
  }

  if (canUseModule("invoices", role, jobTitle, teamName, accessMap, "READ")) {
    pushUnique(actions, {
      href: "/factures",
      label: "Factures",
      description: "Suivi facturation billets.",
    });
  }

  if (canUseModule("teams", role, jobTitle, teamName, accessMap, "READ")) {
    pushUnique(actions, {
      href: "/teams",
      label: "Équipes",
      description: "Affectations et structure.",
    });
  }

  if (canUseModule("archives", role, jobTitle, teamName, accessMap, "READ")) {
    pushUnique(actions, {
      href: "/archives",
      label: "Archives",
      description: "Documents et dossiers.",
    });
  }

  if (canUseModule("audit", role, jobTitle, teamName, accessMap, "READ")) {
    pushUnique(actions, {
      href: "/audit",
      label: "Audit",
      description: "Contrôles et analyse IA.",
    });
  }

  if (canUseModule("dao", role, jobTitle, teamName, accessMap, "READ")) {
    pushUnique(actions, {
      href: "/relation-publique",
      label: "Appels d'offres",
      description: "Dossiers DAO / relation publique.",
    });
  }

  if (role === "ADMIN" || role === "DIRECTEUR_GENERAL") {
    pushUnique(actions, {
      href: "/admin/approvals",
      label: "À approuver",
      description: "Validations en attente.",
    });
  }

  if (role === "ADMIN") {
    pushUnique(actions, {
      href: "/admin",
      label: "Administration",
      description: "Configuration et supervision.",
    });
  }

  if (role === "DIRECTEUR_GENERAL") {
    pushUnique(actions, {
      href: "/dg/ordres-paiement",
      label: "Ordres de paiement (DG)",
      description: "Espace validation DG.",
    });
  }

  if (canUseModule("payments", role, jobTitle, teamName, accessMap, "READ")) {
    pushUnique(actions, {
      href: "/deposit",
      label: "Dépôts compagnies",
      description: "Soldes dépôts compagnies aériennes.",
    });
  }

  pushUnique(actions, {
    href: "/profile",
    label: "Mon profil",
    description: "Notifications et paramètres personnels.",
  });

  if (actions.length <= 2) {
    return actions;
  }

  const prioritized: HomeQuickAction[] = [];
  const priorityMatchers: Array<(href: string) => boolean> = [
    (href) => href.includes("view=sell"),
    (href) => href.includes("mode=tickets"),
    (href) => href.includes("mode=cash"),
    (href) => href === "/attendance",
    (href) => href === "/reports",
    (href) => href.startsWith("/admin"),
    (href) => href.startsWith("/approvisionnement"),
  ];

  for (const matcher of priorityMatchers) {
    const match = actions.find((action) => matcher(action.href));
    if (match) {
      pushUnique(prioritized, match);
    }
  }

  for (const action of actions) {
    pushUnique(prioritized, action);
  }

  return prioritized.slice(0, 8);
}

export function homeWelcomeTitle(role: AppRole, jobTitle?: string | null) {
  const normalized = (jobTitle ?? "").trim().toUpperCase();
  if (normalized && normalized !== "AGENT_TERRAIN") {
    return `Bonjour — ${jobTitleLabel(normalized)}`;
  }
  if (role === "ADMIN") return "Bonjour — Administration";
  if (role === "DIRECTEUR_GENERAL") return "Bonjour — Direction générale";
  if (role === "MANAGER") return "Bonjour — Chef d'agence";
  if (role === "ACCOUNTANT") return "Bonjour — Comptabilité";
  if (isCashierJobTitle(normalized)) return "Bonjour — Caisse";
  return "Bonjour";
}
