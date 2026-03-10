import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";

type ReportMode = "date" | "month" | "year";

function parseYear(value: string | null) {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 2000 || parsed > 2100) return null;
  return parsed;
}

function dateRangeFromParams(params: URLSearchParams) {
  const now = new Date();
  const defaultDay = now.toISOString().slice(0, 10);
  const startDate = params.get("startDate");
  const endDate = params.get("endDate");

  if (startDate || endDate) {
    const startRaw = startDate ?? defaultDay;
    const endRaw = endDate ?? startRaw;
    const start = new Date(`${startRaw}T00:00:00.000Z`);
    const end = new Date(`${endRaw}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    return { start, end, label: `Rapport du ${startRaw} au ${endRaw}` };
  }

  const mode = (["date", "month", "year"].includes(params.get("mode") ?? "")
    ? params.get("mode")
    : "date") as ReportMode;

  if (mode === "year") {
    const year = parseYear(params.get("year")) ?? now.getUTCFullYear();
    const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0, 0));
    return { start, end, label: `Rapport annuel ${year}` };
  }

  if (mode === "month") {
    const rawMonth = params.get("month");
    const monthMatch = rawMonth?.match(/^(\d{4})-(\d{2})$/);
    const year = monthMatch ? Number.parseInt(monthMatch[1], 10) : now.getUTCFullYear();
    const month = monthMatch ? Number.parseInt(monthMatch[2], 10) - 1 : now.getUTCMonth();
    const safeMonth = Math.min(11, Math.max(0, month));
    const start = new Date(Date.UTC(year, safeMonth, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year, safeMonth + 1, 1, 0, 0, 0, 0));
    return { start, end, label: `Rapport mensuel ${start.toISOString().slice(0, 7)}` };
  }

  const rawDate = params.get("date");
  const date = rawDate ? new Date(`${rawDate}T00:00:00.000Z`) : now;
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1, 0, 0, 0, 0));
  return { start, end, label: `Rapport du ${start.toISOString().slice(0, 10)}` };
}

function short(value: string, max: number) {
  const clean = value.trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

export async function GET(request: NextRequest) {
  const access = await requireApiModuleAccess("attendance", ["ADMIN"]);
  if (access.error) {
    return access.error;
  }

  const range = dateRangeFromParams(request.nextUrl.searchParams);
  const requestedUserId = request.nextUrl.searchParams.get("userId")?.trim();
  const roleFilter = requestedUserId ? { userId: requestedUserId } : {};

  const rows = await prisma.attendance.findMany({
    where: {
      ...roleFilter,
      date: { gte: range.start, lt: range.end },
    },
    include: { user: { select: { name: true } } },
    orderBy: [{ date: "asc" }, { user: { name: "asc" } }],
    take: 1200,
  });

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const textBlack = rgb(0, 0, 0);
  let page = pdf.addPage([842, 595]);

  const drawHeader = () => {
    page.drawText("THEBEST SARL - Rapport des présences", { x: 24, y: 566, size: 13, font: fontBold, color: textBlack });
    page.drawText(range.label, { x: 24, y: 550, size: 9, font, color: textBlack });
    page.drawLine({ start: { x: 24, y: 544 }, end: { x: 818, y: 544 }, thickness: 0.8, color: rgb(0.8, 0.8, 0.8) });
    const headers = ["Date", "Employé", "Statut", "Entrée", "Sortie", "Retard", "Heures supp.", "Lieu", "Observation"];
    const x = [24, 90, 225, 290, 340, 390, 450, 525, 610];
    headers.forEach((header, index) => {
      page.drawText(header, { x: x[index], y: 528, size: 8, font: fontBold, color: textBlack });
    });
    page.drawLine({ start: { x: 24, y: 523 }, end: { x: 818, y: 523 }, thickness: 0.6, color: rgb(0.86, 0.86, 0.86) });
  };

  drawHeader();
  let y = 510;

  for (const row of rows) {
    if (y < 42) {
      page = pdf.addPage([842, 595]);
      drawHeader();
      y = 510;
    }

    const values = [
      new Date(row.date).toISOString().slice(0, 10),
      short(row.user.name, 18),
      row.status,
      row.clockIn ? new Date(row.clockIn).toISOString().slice(11, 16) : "-",
      row.clockOut ? new Date(row.clockOut).toISOString().slice(11, 16) : "-",
      `${row.latenessMins} min`,
      `${row.overtimeMins} min`,
      row.locationStatus,
      short(row.notes ?? "-", 42),
    ];
    const x = [24, 90, 225, 290, 340, 390, 450, 525, 610];

    values.forEach((value, index) => {
      page.drawText(value, { x: x[index], y, size: 7.2, font, color: textBlack });
    });

    y -= 11;
  }

  const pages = pdf.getPages();
  pages.forEach((p, index) => {
    p.drawLine({ start: { x: 24, y: 20 }, end: { x: 818, y: 20 }, thickness: 0.6, color: rgb(0.84, 0.84, 0.84) });
    p.drawText(`Page ${index + 1}/${pages.length}`, { x: 24, y: 10, size: 8, font, color: textBlack });
    const printedBy = access.session.user.name ?? access.session.user.email ?? "Utilisateur";
    const rightText = `Par ${printedBy}`;
    const rightWidth = font.widthOfTextAtSize(rightText, 8);
    p.drawText(rightText, { x: 818 - rightWidth, y: 10, size: 8, font, color: textBlack });
  });

  const bytes = await pdf.save();
  return new NextResponse(Uint8Array.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${request.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="rapport-presences-${new Date().toISOString().slice(0, 10)}.pdf"`,
      "Cache-Control": "private, max-age=60",
    },
  });
}
