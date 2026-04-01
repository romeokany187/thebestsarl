import { NextRequest, NextResponse } from "next/server";
import { requireApiModuleAccess } from "@/lib/rbac";
import { canImportTicketWorkbook } from "@/lib/assignment";
import { type ImportPeriodMode, importTicketWorkbookFromBuffer, listTicketWorkbookImportHistory, recordTicketWorkbookImportLog } from "@/lib/ticket-excel-import";

export const runtime = "nodejs";

const allowedMimeTypes = new Set([
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
]);

function parseBoolean(value: FormDataEntryValue | null) {
  return typeof value === "string" && ["1", "true", "on", "yes"].includes(value.trim().toLowerCase());
}

function parseInteger(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePeriodMode(value: FormDataEntryValue | null): ImportPeriodMode {
  if (typeof value !== "string") return "MONTH";
  if (value === "DAY" || value === "YEAR" || value === "CUSTOM") return value;
  return "MONTH";
}

function parseIsoDate(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return value.trim();
}

export async function GET(request: NextRequest) {
  const access = await requireApiModuleAccess("tickets", ["ADMIN"]);
  if (access.error) {
    return access.error;
  }

  if (!canImportTicketWorkbook(access.role, access.session.user.canImportTicketWorkbook)) {
    return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const yearParam = searchParams.get("year");
  const monthParam = searchParams.get("month");
  const emailParam = searchParams.get("email");

  const year = yearParam ? Number.parseInt(yearParam, 10) : undefined;
  const month = monthParam ? Number.parseInt(monthParam, 10) : undefined;
  const actorEmail = emailParam?.trim() || undefined;

  const filters =
    year !== undefined || month !== undefined || actorEmail
      ? {
          year: Number.isFinite(year) ? year : undefined,
          month: Number.isFinite(month) ? month : undefined,
          actorEmail,
        }
      : undefined;

  const history = await listTicketWorkbookImportHistory(20, filters);
  return NextResponse.json({ data: history });
}

export async function POST(request: NextRequest) {
  const access = await requireApiModuleAccess("tickets", ["ADMIN"]);
  if (access.error) {
    return access.error;
  }

  if (!canImportTicketWorkbook(access.role, access.session.user.canImportTicketWorkbook)) {
    return NextResponse.json({ error: "Fonction non autorisée pour importer des billets." }, { status: 403 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const periodMode = parsePeriodMode(formData.get("periodMode"));
    const year = parseInteger(formData.get("year"));
    const month = parseInteger(formData.get("month"));
    const date = parseIsoDate(formData.get("date"));
    const startDate = parseIsoDate(formData.get("startDate"));
    const endDate = parseIsoDate(formData.get("endDate"));
    const sheetNameValue = formData.get("sheetName");
    const defaultSellerEmailValue = formData.get("defaultSellerEmail");
    const dryRun = parseBoolean(formData.get("dryRun"));
    const replaceExistingPeriodRequested = parseBoolean(formData.get("replaceExistingPeriod")) || parseBoolean(formData.get("replaceMonth"));

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Le fichier Excel est requis." }, { status: 400 });
    }

    if ((periodMode === "MONTH" || periodMode === "YEAR") && (!year || year < 2000 || year > 2100)) {
      return NextResponse.json({ error: "Année invalide." }, { status: 400 });
    }

    if (periodMode === "MONTH" && (!month || month < 1 || month > 12)) {
      return NextResponse.json({ error: "Mois invalide." }, { status: 400 });
    }

    if (file.size <= 0) {
      return NextResponse.json({ error: "Fichier vide non autorisé." }, { status: 400 });
    }

    if (file.size > 15 * 1024 * 1024) {
      return NextResponse.json({ error: "Taille max: 15 MB." }, { status: 400 });
    }

    const lowerName = file.name.trim().toLowerCase();
    const hasSupportedExtension = lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls");
    if ((!file.type || !allowedMimeTypes.has(file.type)) && !hasSupportedExtension) {
      return NextResponse.json({ error: "Formats autorisés: XLSX, XLS." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const sheetName = typeof sheetNameValue === "string" && sheetNameValue.trim() ? sheetNameValue.trim() : undefined;
    const typedDefaultSellerEmail = typeof defaultSellerEmailValue === "string" && defaultSellerEmailValue.trim()
      ? defaultSellerEmailValue.trim().toLowerCase()
      : access.session.user.email?.trim().toLowerCase();

    const result = await importTicketWorkbookFromBuffer({
      fileBuffer: buffer,
      sheetName,
      dryRun,
      defaultSellerEmail: typedDefaultSellerEmail,
      periodMode,
      year: year ?? new Date().getUTCFullYear(),
      month: month ?? undefined,
      date,
      startDate,
      endDate,
      replaceExistingPeriod: replaceExistingPeriodRequested,
      includePreview: true,
      maxPreviewRows: 160,
    });

    const resultStart = new Date(`${result.range.start}T00:00:00.000Z`);

    const historyEntry = await recordTicketWorkbookImportLog({
      actorId: access.session.user.id,
      actorName: access.session.user.name ?? access.session.user.email ?? "Utilisateur",
      fileName: file.name,
      periodMode,
      year: resultStart.getUTCFullYear(),
      month: periodMode === "MONTH" ? (month ?? resultStart.getUTCMonth() + 1) : undefined,
      rangeStart: result.range.start,
      rangeEnd: result.range.end,
      sheetName,
      dryRun,
      replaceExistingPeriod: replaceExistingPeriodRequested,
      result,
    });

    return NextResponse.json({
      data: {
        ...result,
        dryRun,
        replaceExistingPeriod: replaceExistingPeriodRequested,
        historyEntry,
      },
    });
  } catch (error) {
    console.error("POST /api/tickets/import failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erreur serveur lors de l'import Excel." },
      { status: 500 },
    );
  }
}