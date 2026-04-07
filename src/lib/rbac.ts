import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { authOptions } from "@/auth";

export type AppRole = "ADMIN" | "DIRECTEUR_GENERAL" | "MANAGER" | "EMPLOYEE" | "ACCOUNTANT";
export type AppModule =
  | "home"
  | "dashboard"
  | "admin"
  | "teams"
  | "profile"
  | "reports"
  | "attendance"
  | "sales"
  | "tickets"
  | "invoices"
  | "payments"
  | "procurement"
  | "archives"
  | "news"
  | "settings"
  | "audit";

const ALL_ROLES: AppRole[] = ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "EMPLOYEE", "ACCOUNTANT"];

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toUpperCase();
}

function teamIncludes(teamName: string | null | undefined, terms: string[]) {
  const normalized = normalize(teamName);
  if (!normalized) return false;
  return terms.some((term) => normalized.includes(term));
}

function isAssignedNonAdmin(jobTitle: string | null | undefined, teamName: string | null | undefined) {
  return Boolean(normalize(teamName)) && normalize(jobTitle) !== "AGENT_TERRAIN";
}

export function hasModuleAccess(params: {
  role: AppRole;
  jobTitle?: string | null;
  teamName?: string | null;
  module: AppModule;
}) {
  const { role, module } = params;
  const jobTitle = normalize(params.jobTitle);
  const teamName = normalize(params.teamName);

  if (module === "home") {
    return true;
  }

  if (module === "profile") {
    return true;
  }

  if (module === "settings") {
    return true;
  }

  if (module === "payments") {
    if (role === "ADMIN") {
      return true;
    }

    return role === "ACCOUNTANT" || jobTitle === "CAISSIER" || jobTitle === "COMPTABLE";
  }

  if (role === "ADMIN") {
    return true;
  }

  if (role === "DIRECTEUR_GENERAL") {
    return true;
  }

  if (module === "tickets") {
    return false;
  }

  // Without assignment/function, only home and profile are visible until affectation.
  if (!isAssignedNonAdmin(jobTitle, teamName)) {
    return false;
  }

  if (module === "dashboard" || module === "teams" || module === "admin") {
    return false;
  }

  if (module === "reports" || module === "attendance" || module === "news") {
    return true;
  }

  if (module === "sales") {
    return true;
  }

  if (module === "invoices") {
    return true;
  }

  if (module === "procurement") {
    return jobTitle === "APPROVISIONNEMENT"
      || teamIncludes(teamName, ["APPRO", "STOCK", "MARKETING"]);
  }

  if (module === "archives") {
    return true;
  }

  if (module === "audit") {
    return jobTitle === "AUDITEUR"
      || teamIncludes(teamName, ["AUDIT"]);
  }

  return false;
}

function extractRole(role: unknown, jobTitle: string | null | undefined): AppRole | null {
  if (role === "ADMIN") {
    return "ADMIN";
  }

  if (normalize(jobTitle) === "DIRECTION_GENERALE") {
    return "DIRECTEUR_GENERAL";
  }

  if (role === "MANAGER" || role === "EMPLOYEE" || role === "ACCOUNTANT") {
    return role;
  }
  return null;
}

function isRoleAllowed(role: AppRole, allowedRoles: AppRole[]) {
  if (allowedRoles.includes(role)) return true;
  // Backward compatibility: admin keeps historical DG-protected permissions.
  if (role === "ADMIN" && allowedRoles.includes("DIRECTEUR_GENERAL")) return true;
  // Backward compatibility: old ADMIN-allowed paths can still be used by DG.
  if (role === "DIRECTEUR_GENERAL" && allowedRoles.includes("ADMIN")) return true;
  return false;
}

export async function requireApiRoles(allowedRoles: AppRole[]) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      session: null,
      role: null,
    };
  }

  const role = extractRole(session.user.role, session.user.jobTitle);

  if (!role || !isRoleAllowed(role, allowedRoles)) {
    return {
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
      session,
      role,
    };
  }

  return {
    error: null,
    session,
    role,
  };
}

export async function requirePageRoles(allowedRoles: AppRole[]) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/api/auth/signin");
  }

  const role = extractRole(session.user.role, session.user.jobTitle);

  if (!role || !isRoleAllowed(role, allowedRoles)) {
    redirect("/");
  }

  return {
    session,
    role,
  };
}

export async function requirePageModuleAccess(module: AppModule, allowedRoles: AppRole[] = ALL_ROLES) {
  const access = await requirePageRoles(allowedRoles);

  if (!hasModuleAccess({
    role: access.role,
    jobTitle: access.session.user.jobTitle,
    teamName: access.session.user.teamName,
    module,
  })) {
    redirect("/");
  }

  return access;
}

export async function requireApiModuleAccess(module: AppModule, allowedRoles: AppRole[] = ALL_ROLES) {
  const access = await requireApiRoles(allowedRoles);
  if (access.error) {
    return access;
  }

  if (!hasModuleAccess({
    role: access.role,
    jobTitle: access.session.user.jobTitle,
    teamName: access.session.user.teamName,
    module,
  })) {
    return {
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
      session: access.session,
      role: access.role,
    };
  }

  return access;
}
