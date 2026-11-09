import { NextRequest, NextResponse } from "next/server";
import { requireApiModuleAccess } from "@/lib/rbac";
import { analyzeMbujimayiReportBuffer } from "@/lib/mbujimayi-report-reconcile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedMimeTypes = new Set([
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
]);

/** POST /api/sales/mbujimayi-reconcile — compare le rapport Excel MJM au mois choisi vs billets Mbujimayi. */
export async function POST(request: NextRequest) {
  const access = await requireApiModuleAccess("sales", [
    "ADMIN",
    "DIRECTEUR_GENERAL",
    "MANAGER",
    "ACCOUNTANT",
    "EMPLOYEE",
  ]);
  if (access.error) return access.error;

  try {
    const form = await request.formData();
    const file = form.get("file");
    const monthRaw = form.get("month");
    const month = typeof monthRaw === "string" ? monthRaw.trim() : "";

    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: "Choisissez un mois valide (YYYY-MM)." }, { status: 400 });
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Fichier Excel Mbujimayi manquant." }, { status: 400 });
    }

    const mime = file.type || "application/octet-stream";
    if (!allowedMimeTypes.has(mime) && !/\.xlsx?$/i.test(file.name)) {
      return NextResponse.json({ error: "Format attendu : fichier Excel (.xlsx)." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.byteLength < 64) {
      return NextResponse.json({ error: "Fichier vide ou illisible." }, { status: 400 });
    }

    const result = await analyzeMbujimayiReportBuffer(buffer, month);
    return NextResponse.json({
      ok: true,
      fileName: file.name,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analyse Mbujimayi impossible.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
