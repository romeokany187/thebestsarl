import { NextResponse } from "next/server";
import { canImportCashReportExcel } from "@/lib/cash-report-access";
import { requireApiModuleAccess } from "@/lib/rbac";

const PAYMENTS_CASH_REPORT_IMPORT_ROLES = [
  "ADMIN",
  "ACCOUNTANT",
  "EMPLOYEE",
  "DIRECTEUR_GENERAL",
  "MANAGER",
] as const;

export async function requireCashReportImportApiAccess() {
  const access = await requireApiModuleAccess("payments", [...PAYMENTS_CASH_REPORT_IMPORT_ROLES]);
  if (access.error) {
    if (!access.session) {
      return {
        error: NextResponse.json({ error: "Session expirée — reconnectez-vous puis réessayez l’import." }, { status: 401 }),
      };
    }
    if (!access.role) {
      return {
        error: NextResponse.json(
          { error: "Profil utilisateur non reconnu pour l’import caisse (poste ou rôle manquant)." },
          { status: 403 },
        ),
      };
    }
    return {
      error: NextResponse.json(
        {
          error:
            "Accès au module Paiements insuffisant pour l’import Excel. Comptes autorisés : admin, direction générale, comptable, caisse 2 siège (THE BEST).",
        },
        { status: 403 },
      ),
    };
  }

  if (
    !canImportCashReportExcel({
      role: access.role!,
      jobTitle: access.session!.user.jobTitle,
      customModuleAccessLevel: access.customModuleAccess,
    })
  ) {
    return {
      error: NextResponse.json(
        {
          error:
            "Import réservé à la caissière Caisse 2 (THE BEST), au comptable, à la direction générale ou à l’administrateur (accès Paiements complet).",
        },
        { status: 403 },
      ),
    };
  }

  return {
    error: null,
    session: access.session!,
    role: access.role!,
    customModuleAccess: access.customModuleAccess,
  };
}
