import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { authOptions } from "@/auth";

export type AppRole = "ADMIN" | "MANAGER" | "EMPLOYEE" | "ACCOUNTANT";
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

const ALL_ROLES: AppRole[] = ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"];

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

  if (role === "ADMIN") {
    return true;
  }

  // Without assignment/function, only home and profile are visible until affectation.
  if (!isAssignedNonAdmin(jobTitle, teamName)) {
    return false;
  }

  if (module === "dashboard" || module === "teams" || module === "admin") {
    return false;
  }

  if (module === "reports" || module === "attendance" || module === "news" || module === "settings") {
    return true;
  }

  if (module === "sales") {
    return jobTitle === "COMMERCIAL"
      || jobTitle === "DIRECTION_GENERALE"
      || teamIncludes(teamName, ["VENTE", "COMMERCIAL"]);
  }

  if (module === "tickets") {
    return jobTitle === "COMMERCIAL"
      || jobTitle === "AUDITEUR"
      || jobTitle === "COMPTABLE"
      || jobTitle === "CAISSIERE"
      || jobTitle === "DIRECTION_GENERALE"
        || teamIncludes(teamName, ["VENTE", "COMMERCIAL", "AUDIT", "COMPTA", "CAISSE"]);
  }

  if (module === "invoices") {
    return jobTitle === "COMMERCIAL"
      || jobTitle === "COMPTABLE"
      || jobTitle === "CAISSIERE"
      || jobTitle === "DIRECTION_GENERALE"
      || teamIncludes(teamName, ["VENTE", "COMMERCIAL", "COMPTA", "CAISSE"]);
  }

  if (module === "payments") {
    return jobTitle === "CAISSIERE"
      || jobTitle === "COMPTABLE";
  }

  if (module === "procurement") {
    return jobTitle === "APPROVISIONNEMENT_MARKETING"
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

function extractRole(role: unknown): AppRole | null {
  if (role === "ADMIN" || role === "MANAGER" || role === "EMPLOYEE" || role === "ACCOUNTANT") {
    return role;
  }
  return null;
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

  const role = extractRole(session.user.role);

  if (!role || !allowedRoles.includes(role)) {
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

  const role = extractRole(session.user.role);

  if (!role || !allowedRoles.includes(role)) {
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
