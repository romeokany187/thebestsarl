import { NextRequest, NextResponse } from "next/server";
import { requireApiModuleAccess } from "@/lib/rbac";
import { canImportTicketWorkbook } from "@/lib/assignment";
import { importTicketWorkbookFromBuffer, listTicketWorkbookImportHistory, recordTicketWorkbookImportLog } from "@/lib/ticket-excel-import";

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

export async function GET(request: NextRequest) {
  const access = await requireApiModuleAccess("tickets", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
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
  const access = await requireApiModuleAccess("tickets", ["ADMIN", "MANAGER", "EMPLOYEE"]);
  if (access.error) {
    return access.error;
  }

  if (!canImportTicketWorkbook(access.role, access.session.user.canImportTicketWorkbook)) {
    return NextResponse.json({ error: "Fonction non autorisée pour importer des billets." }, { status: 403 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const year = parseInteger(formData.get("year"));
    const month = parseInteger(formData.get("month"));
    const sheetNameValue = formData.get("sheetName");
    const defaultSellerEmailValue = formData.get("defaultSellerEmail");
    const dryRun = parseBoolean(formData.get("dryRun"));
    const replaceMonthRequested = parseBoolean(formData.get("replaceMonth"));

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Le fichier Excel est requis." }, { status: 400 });
    }

    if (!year || year < 2000 || year > 2100) {
      return NextResponse.json({ error: "Année invalide." }, { status: 400 });
    }

    if (!month || month < 1 || month > 12) {
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

    if (replaceMonthRequested && access.role === "EMPLOYEE") {
      return NextResponse.json({ error: "Le remplacement complet du mois est réservé à la supervision." }, { status: 403 });
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
      year,
      month,
      replaceMonth: replaceMonthRequested,
      includePreview: true,
      maxPreviewRows: 160,
    });

    const historyEntry = await recordTicketWorkbookImportLog({
      actorId: access.session.user.id,
      actorName: access.session.user.name ?? access.session.user.email ?? "Utilisateur",
      fileName: file.name,
      year,
      month,
      sheetName,
      dryRun,
      replaceMonth: replaceMonthRequested,
      result,
    });

    return NextResponse.json({
      data: {
        ...result,
        dryRun,
        replaceMonth: replaceMonthRequested,
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