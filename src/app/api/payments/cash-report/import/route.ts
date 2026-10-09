import { NextRequest, NextResponse } from "next/server";
import { requireApiModuleAccess } from "@/lib/rbac";
import { canImportCashReportExcel } from "@/lib/cash-report-access";
import { runCashReportExcelImport } from "@/lib/cash-report-excel-import";

export const dynamic = "force-dynamic";

function kinshasaTodayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Kinshasa",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function POST(request: NextRequest) {
  const access = await requireApiModuleAccess("payments", [
    "ADMIN",
    "ACCOUNTANT",
    "EMPLOYEE",
    "DIRECTEUR_GENERAL",
    "MANAGER",
  ]);
  if (access.error) {
    if (!access.session) {
      return NextResponse.json({ error: "Session expirée — reconnectez-vous puis réessayez l’import." }, { status: 401 });
    }
    if (!access.role) {
      return NextResponse.json(
        { error: "Profil utilisateur non reconnu pour l’import caisse (poste ou rôle manquant)." },
        { status: 403 },
      );
    }
    return NextResponse.json(
      {
        error:
          "Accès au module Paiements insuffisant pour l’import Excel. Comptes autorisés : admin, direction générale, comptable, caisse 2 siège (THE BEST).",
      },
      { status: 403 },
    );
  }

  if (!canImportCashReportExcel({
    role: access.role,
    jobTitle: access.session!.user.jobTitle,
    customModuleAccessLevel: access.customModuleAccess,
  })) {
    return NextResponse.json(
      {
        error:
          "Import réservé à la caissière Caisse 2 (THE BEST), au comptable, à la direction générale ou à l’administrateur (accès Paiements complet).",
      },
      { status: 403 },
    );
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const dryRunRaw = String(formData.get("dryRun") ?? "true").toLowerCase();
  const dryRun = dryRunRaw !== "false" && dryRunRaw !== "0";
  const closingDate = String(formData.get("closingDate") ?? kinshasaTodayKey()).trim();
  const reconcileDatesRaw = String(formData.get("reconcileDates") ?? "").trim();
  const reconcileDates = reconcileDatesRaw
    ? reconcileDatesRaw.split(",").map((value) => value.trim()).filter(Boolean)
    : [];

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Fichier Excel requis." }, { status: 400 });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(closingDate)) {
    return NextResponse.json({ error: "Date de clôture invalide (YYYY-MM-DD)." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const result = await runCashReportExcelImport({
      buffer,
      fileName: file.name,
      closingDate,
      importedById: access.session.user.id,
      dryRun,
      reconcileDates,
    });

    return NextResponse.json({ data: result });
  } catch (error) {
    let message = error instanceof Error ? error.message : "Import impossible.";
    if (/preImportSnapshot|restoredAt|does not exist in the current database/i.test(message)) {
      message =
        "La base de données n’est pas à jour pour l’import caisse (colonnes manquantes). Sur le serveur, exécutez : npm run db:ensure:cash-report-import-schema — ou relancez un déploiement Hostinger récent.";
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
