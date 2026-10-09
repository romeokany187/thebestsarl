import type { ModuleAccessLevel } from "@/lib/user-module-access";
import { hasRequiredModuleAccessLevel } from "@/lib/user-module-access";

export function canImportCashReportExcel(options: {
  role: string;
  jobTitle?: string | null;
  customModuleAccessLevel?: ModuleAccessLevel | null;
}) {
  if (hasRequiredModuleAccessLevel(options.customModuleAccessLevel, "FULL")) return true;
  if (
    options.role === "ADMIN"
    || options.role === "ACCOUNTANT"
    || options.role === "DIRECTEUR_GENERAL"
  ) {
    return true;
  }
  const jobTitle = (options.jobTitle ?? "").trim().toUpperCase();
  return jobTitle === "CAISSE_2_SIEGE" || jobTitle === "COMPTABLE";
}
