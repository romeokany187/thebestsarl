export type AppRoleLike = "ADMIN" | "DIRECTEUR_GENERAL" | "MANAGER" | "EMPLOYEE" | "ACCOUNTANT";
type ModuleAccessLevelLike = "READ" | "WRITE" | "FULL" | null | undefined;
type CashAuthorizationModule = "payments" | "caisse_1_siege" | "caisse_2_siege" | "caisse_agence";
type CashModuleAccessMap = Partial<Record<CashAuthorizationModule, ModuleAccessLevelLike>>;

export type CashDeskValue = "PROXY_BANKING" | "THE_BEST" | "CAISSE_2_SIEGE" | "CAISSE_SAFETY" | "CAISSE_VISAS" | "CAISSE_TSL" | "CAISSE_AGENCE";
export type CashDeskOption = { value: CashDeskValue; label: string; description: string };
export type AdminCashRoleScope = "CAISSIER" | "CAISSE_2_SIEGE" | "CAISSE_AGENCE";

export const KNOWN_CASH_DESK_PREFIXES = [
  "PROXY_BANKING:",
  "THE_BEST:",
  "CAISSE_2_SIEGE:",
  "CAISSE_SAFETY:",
  "CAISSE_VISAS:",
  "CAISSE_TSL:",
  "CAISSE_AGENCE:",
] as const;

export const ALL_CASH_DESKS: CashDeskOption[] = [
  {
    value: "PROXY_BANKING",
    label: "Proxy Banking",
    description: "Airtel Money, Orange Money, M-Pesa, Equity, TMB et Illicocash : dépôts, retraits, virtuel et billetage.",
  },
  {
    value: "THE_BEST",
    label: "THE BEST",
    description: "Caisse principale THE BEST : paiements billets + autres opérations de caisse.",
  },
  {
    value: "CAISSE_2_SIEGE",
    label: "Caisse 2 Siège",
    description: "Alias historique de la caisse 2 siège pour retrouver les opérations déjà encodées.",
  },
  {
    value: "CAISSE_SAFETY",
    label: "Caisse Safety",
    description: "Compte Safety : opérations de caisse, billetage, virtuel, OP et EDB.",
  },
  {
    value: "CAISSE_VISAS",
    label: "Caisse Visas",
    description: "Compte Visas : opérations de caisse, billetage, virtuel, OP et EDB.",
  },
  {
    value: "CAISSE_TSL",
    label: "Caisse TSL",
    description: "Compte TSL : opérations de caisse, billetage, virtuel, OP et EDB.",
  },
  {
    value: "CAISSE_AGENCE",
    label: "Caisse agence",
    description: "Caisse locale de l'agence : opérations de caisse, billetage, virtuel, OP et EDB.",
  },
];

export const ADMIN_CASH_ROLE_OPTIONS: Array<{ value: AdminCashRoleScope; label: string; description: string }> = [
  {
    value: "CAISSIER",
    label: "Caisse 1 Siège",
    description: "Vue admin du proxy banking, du billetage et des OP/EDB de la caisse 1 siège.",
  },
  {
    value: "CAISSE_2_SIEGE",
    label: "Caisse 2 Siège",
    description: "Vue admin du caissier 2 siège et des comptes qu'il gère.",
  },
  {
    value: "CAISSE_AGENCE",
    label: "Caisse agence",
    description: "Vue admin de la caisse agence et de ses opérations.",
  },
];

function hasModuleReadAccess(level?: ModuleAccessLevelLike) {
  return level === "READ" || level === "WRITE" || level === "FULL";
}

function resolveCustomCashScopes(customModuleAccessMap?: CashModuleAccessMap): AdminCashRoleScope[] {
  if (!customModuleAccessMap) return [] as AdminCashRoleScope[];

  if (hasModuleReadAccess(customModuleAccessMap.payments)) {
    return ["CAISSIER", "CAISSE_2_SIEGE", "CAISSE_AGENCE"] as AdminCashRoleScope[];
  }

  const scopes: AdminCashRoleScope[] = [];
  if (hasModuleReadAccess(customModuleAccessMap.caisse_1_siege)) scopes.push("CAISSIER");
  if (hasModuleReadAccess(customModuleAccessMap.caisse_2_siege)) scopes.push("CAISSE_2_SIEGE");
  if (hasModuleReadAccess(customModuleAccessMap.caisse_agence)) scopes.push("CAISSE_AGENCE");
  return scopes;
}

function hasCustomPaymentsModuleAccess(level?: ModuleAccessLevelLike, customModuleAccessMap?: CashModuleAccessMap) {
  if (resolveCustomCashScopes(customModuleAccessMap).length > 0) {
    return true;
  }

  return level === "FULL";
}

export function getManagedCashDesksForScope(scope?: string | null) {
  const normalizedScope = (scope ?? "").trim().toUpperCase();

  if (normalizedScope === "CAISSIER") {
    return ALL_CASH_DESKS.filter((desk) => desk.value === "PROXY_BANKING");
  }

  if (normalizedScope === "CAISSE_2_SIEGE") {
    return ALL_CASH_DESKS.filter((desk) => [
      "THE_BEST",
      "CAISSE_2_SIEGE",
      "CAISSE_SAFETY",
      "CAISSE_VISAS",
      "CAISSE_TSL",
    ].includes(desk.value));
  }

  if (normalizedScope === "CAISSE_AGENCE") {
    return ALL_CASH_DESKS.filter((desk) => desk.value === "CAISSE_AGENCE");
  }

  return ALL_CASH_DESKS.filter((desk) => desk.value === "PROXY_BANKING");
}

export function getDefaultCashRoleScope(
  jobTitle?: string | null,
  role?: AppRoleLike | string | null,
  customModuleAccessLevel?: ModuleAccessLevelLike,
  customModuleAccessMap?: CashModuleAccessMap,
): AdminCashRoleScope {
  const customScopes = resolveCustomCashScopes(customModuleAccessMap);
  if (customScopes.length > 0) {
    return customScopes[0];
  }

  if (hasCustomPaymentsModuleAccess(customModuleAccessLevel, customModuleAccessMap)) {
    return "CAISSIER";
  }

  const normalizedJobTitle = (jobTitle ?? "").trim().toUpperCase();
  const normalizedRole = (role ?? "").trim().toUpperCase();

  if (normalizedJobTitle === "CAISSE_2_SIEGE") return "CAISSE_2_SIEGE";
  if (normalizedJobTitle === "CAISSE_AGENCE") return "CAISSE_AGENCE";
  if (
    normalizedRole === "ADMIN"
    || normalizedRole === "DIRECTEUR_GENERAL"
    || normalizedRole === "ACCOUNTANT"
    || normalizedJobTitle === "COMPTABLE"
  ) {
    return "CAISSIER";
  }

  return "CAISSIER";
}

export function getVisibleCashRoleOptions(
  jobTitle?: string | null,
  role?: AppRoleLike | string | null,
  customModuleAccessLevel?: ModuleAccessLevelLike,
  customModuleAccessMap?: CashModuleAccessMap,
) {
  const customScopes = resolveCustomCashScopes(customModuleAccessMap);
  if (customScopes.length > 0) {
    return ADMIN_CASH_ROLE_OPTIONS.filter((option) => customScopes.includes(option.value));
  }

  if (hasCustomPaymentsModuleAccess(customModuleAccessLevel, customModuleAccessMap)) {
    return ADMIN_CASH_ROLE_OPTIONS;
  }

  const normalizedJobTitle = (jobTitle ?? "").trim().toUpperCase();
  const normalizedRole = (role ?? "").trim().toUpperCase();

  if (
    normalizedRole === "ADMIN"
    || normalizedRole === "DIRECTEUR_GENERAL"
    || normalizedRole === "ACCOUNTANT"
    || normalizedJobTitle === "COMPTABLE"
  ) {
    return ADMIN_CASH_ROLE_OPTIONS;
  }

  if (normalizedJobTitle === "CAISSE_2_SIEGE") {
    return ADMIN_CASH_ROLE_OPTIONS.filter((option) => option.value === "CAISSE_2_SIEGE");
  }

  if (normalizedJobTitle === "CAISSE_AGENCE") {
    return ADMIN_CASH_ROLE_OPTIONS.filter((option) => option.value === "CAISSE_AGENCE");
  }

  if (normalizedJobTitle === "CAISSIER") {
    return ADMIN_CASH_ROLE_OPTIONS.filter((option) => option.value === "CAISSIER");
  }

  return [];
}

export function getManagedCashDesks(
  jobTitle?: string | null,
  role?: AppRoleLike | string | null,
  scope?: AdminCashRoleScope | null,
  customModuleAccessLevel?: ModuleAccessLevelLike,
  customModuleAccessMap?: CashModuleAccessMap,
) {
  const normalizedJobTitle = (jobTitle ?? "").trim().toUpperCase();
  const visibleScopeOptions = getVisibleCashRoleOptions(jobTitle, role, customModuleAccessLevel, customModuleAccessMap);

  if (visibleScopeOptions.length > 0) {
    const fallbackScope = visibleScopeOptions[0]?.value ?? getDefaultCashRoleScope(jobTitle, role, customModuleAccessLevel);
    const selectedScope = visibleScopeOptions.some((option) => option.value === scope)
      ? (scope ?? fallbackScope)
      : fallbackScope;

    return getManagedCashDesksForScope(selectedScope);
  }

  return getManagedCashDesksForScope(normalizedJobTitle);
}

export function normalizeCashDeskValue(value?: string | null): CashDeskValue | null {
  const normalized = (value ?? "").trim().toUpperCase();
  return ALL_CASH_DESKS.some((desk) => desk.value === normalized as CashDeskValue)
    ? normalized as CashDeskValue
    : null;
}

export function isMainCashDesk(value?: string | null) {
  const normalized = normalizeCashDeskValue(value);
  return normalized === "THE_BEST" || normalized === "CAISSE_2_SIEGE";
}

export function inferCashDeskFromDescription(value?: string | null): CashDeskValue {
  const normalized = (value ?? "").trim().toUpperCase();
  if (normalized.startsWith("PROXY_BANKING:")) return "PROXY_BANKING";
  if (normalized.startsWith("CAISSE_2_SIEGE:")) return "CAISSE_2_SIEGE";
  if (normalized.startsWith("THE_BEST:")) return "THE_BEST";
  if (normalized.startsWith("CAISSE_SAFETY:")) return "CAISSE_SAFETY";
  if (normalized.startsWith("CAISSE_VISAS:")) return "CAISSE_VISAS";
  if (normalized.startsWith("CAISSE_TSL:")) return "CAISSE_TSL";
  if (normalized.startsWith("CAISSE_AGENCE:")) return "CAISSE_AGENCE";
  return "THE_BEST";
}

export function buildDeskScopedCashOperationWhere(
  selectedDesk: CashDeskValue,
  options?: { strict?: boolean },
) {
  const strict = options?.strict === true;
  const selectedPrefix = `${selectedDesk}:`;
  const foreignDeskPrefixFilters = KNOWN_CASH_DESK_PREFIXES
    .filter((prefix) => prefix !== selectedPrefix)
    .map((prefix) => ({ description: { startsWith: prefix } })) as any;

  if (selectedDesk === "THE_BEST") {
    return {
      OR: [
        { description: { startsWith: "THE_BEST:" } },
        ...(strict
          ? [{
            AND: [
              { cashDesk: "THE_BEST" },
              { NOT: foreignDeskPrefixFilters },
            ],
          }]
          : [{
            AND: [
              { cashDesk: "THE_BEST" },
              { NOT: KNOWN_CASH_DESK_PREFIXES.map((prefix) => ({ description: { startsWith: prefix } })) as any },
            ],
          }]),
      ],
    };
  }

  if (selectedDesk === "CAISSE_2_SIEGE") {
    return {
      OR: [
        { description: { startsWith: "CAISSE_2_SIEGE:" } },
        ...(strict
          ? [{
            AND: [
              { cashDesk: "CAISSE_2_SIEGE" },
              { NOT: foreignDeskPrefixFilters },
            ],
          }]
          : [{ cashDesk: "CAISSE_2_SIEGE" }]),
      ],
    };
  }

  return {
    OR: [
      { description: { startsWith: `${selectedDesk}:` } },
      ...(strict
        ? [{
          AND: [
            { cashDesk: selectedDesk },
            { NOT: foreignDeskPrefixFilters },
          ],
        }]
        : [{ cashDesk: selectedDesk }]),
    ],
  };
}

export function inferScopeFromDesk(desk?: string | null): AdminCashRoleScope | null {
  const normalizedDesk = (desk ?? "").trim().toUpperCase();

  if (normalizedDesk === "PROXY_BANKING") return "CAISSIER";
  if (normalizedDesk === "CAISSE_AGENCE") return "CAISSE_AGENCE";
  if (["THE_BEST", "CAISSE_2_SIEGE", "CAISSE_SAFETY", "CAISSE_VISAS", "CAISSE_TSL"].includes(normalizedDesk)) {
    return "CAISSE_2_SIEGE";
  }

  return null;
}

export function resolvePaymentsDeskState({
  jobTitle,
  role,
  requestedDesk,
  requestedScope,
  customModuleAccessLevel,
  customModuleAccessMap,
}: {
  jobTitle?: string | null;
  role?: AppRoleLike | string | null;
  requestedDesk?: string | null;
  requestedScope?: string | null;
  customModuleAccessLevel?: ModuleAccessLevelLike;
  customModuleAccessMap?: CashModuleAccessMap;
}) {
  const scopeOptions = getVisibleCashRoleOptions(jobTitle, role, customModuleAccessLevel, customModuleAccessMap);
  const fallbackScope = getDefaultCashRoleScope(jobTitle, role, customModuleAccessLevel, customModuleAccessMap);
  const inferredScope = inferScopeFromDesk(requestedDesk);
  const scope = scopeOptions.length > 0
    ? (scopeOptions.some((option) => option.value === requestedScope)
      ? requestedScope as AdminCashRoleScope
      : scopeOptions.some((option) => option.value === inferredScope)
        ? inferredScope as AdminCashRoleScope
        : scopeOptions.some((option) => option.value === fallbackScope)
          ? fallbackScope
          : scopeOptions[0].value)
    : (requestedScope as AdminCashRoleScope | null) ?? inferredScope ?? fallbackScope;
  const deskOptions = getManagedCashDesks(jobTitle, role, scope, customModuleAccessLevel, customModuleAccessMap);
  const normalizedRequestedDesk = (requestedDesk ?? "").trim().toUpperCase() as CashDeskValue;
  const desk = deskOptions.some((option) => option.value === normalizedRequestedDesk)
    ? normalizedRequestedDesk
    : (deskOptions[0]?.value ?? "PROXY_BANKING");

  return {
    scopeOptions,
    scope,
    deskOptions,
    desk,
  };
}

export function resolveExecutionCashDesk({
  requestedDesk,
  jobTitle,
  role,
  customModuleAccessLevel,
  customModuleAccessMap,
}: {
  requestedDesk?: string | null;
  jobTitle?: string | null;
  role?: AppRoleLike | string | null;
  customModuleAccessLevel?: ModuleAccessLevelLike;
  customModuleAccessMap?: CashModuleAccessMap;
}): CashDeskValue {
  const normalizedRequestedDesk = normalizeCashDeskValue(requestedDesk);
  if (normalizedRequestedDesk) {
    const inferredScope = inferScopeFromDesk(normalizedRequestedDesk);
    const fallbackScope = getDefaultCashRoleScope(jobTitle, role, customModuleAccessLevel, customModuleAccessMap);
    const visibleDesks = getManagedCashDesks(jobTitle, role, inferredScope ?? fallbackScope, customModuleAccessLevel, customModuleAccessMap);
    if (visibleDesks.some((desk) => desk.value === normalizedRequestedDesk)) {
      return normalizedRequestedDesk;
    }
  }

  const normalizedJobTitle = (jobTitle ?? "").trim().toUpperCase();
  if (normalizedJobTitle === "CAISSIER") return "PROXY_BANKING";
  if (normalizedJobTitle === "CAISSE_AGENCE") return "CAISSE_AGENCE";
  return "THE_BEST";
}

export function isDeskAllowedForUser({
  desk,
  jobTitle,
  role,
  customModuleAccessLevel,
  customModuleAccessMap,
}: {
  desk: CashDeskValue;
  jobTitle?: string | null;
  role?: AppRoleLike | string | null;
  customModuleAccessLevel?: ModuleAccessLevelLike;
  customModuleAccessMap?: CashModuleAccessMap;
}) {
  const inferredScope = inferScopeFromDesk(desk);
  const fallbackScope = getDefaultCashRoleScope(jobTitle, role, customModuleAccessLevel, customModuleAccessMap);
  const visibleDesks = getManagedCashDesks(jobTitle, role, inferredScope ?? fallbackScope, customModuleAccessLevel, customModuleAccessMap);
  return visibleDesks.some((item) => item.value === desk);
}
