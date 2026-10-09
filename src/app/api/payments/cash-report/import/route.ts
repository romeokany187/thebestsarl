import { NextRequest, NextResponse } from "next/server";
import { requireCashReportImportApiAccess } from "@/lib/cash-report-import-api-auth";
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
  const access = await requireCashReportImportApiAccess();
  if (access.error) return access.error;

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
