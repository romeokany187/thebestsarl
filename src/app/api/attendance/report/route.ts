import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";

type ReportMode = "date" | "month" | "year";

type TeamOfficeTimezone = {
  names: string[];
  timeZone: string;
};

const TEAM_OFFICE_TIMEZONES: TeamOfficeTimezone[] = [
  {
    names: ["lubumbashi"],
    timeZone: "Africa/Lubumbashi",
  },
  {
    names: ["mbujimayi", "mbuji-mayi", "mbuji mayi"],
    timeZone: "Africa/Lubumbashi",
  },
];

const DEFAULT_ATTENDANCE_TIMEZONE = "Africa/Kinshasa";

function normalizeTeamName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function resolveAttendanceTimeZone(teamName?: string | null) {
  if (!teamName?.trim()) {
    return DEFAULT_ATTENDANCE_TIMEZONE;
  }

  const normalized = normalizeTeamName(teamName);
  const matched = TEAM_OFFICE_TIMEZONES.find((item) => item.names.includes(normalized));
  return matched?.timeZone ?? DEFAULT_ATTENDANCE_TIMEZONE;
}

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

function wrapTextByWidth(text: string, font: any, fontSize: number, maxWidth: number) {
  const clean = (text || "-").replace(/\s+/g, " ").trim() || "-";
  const words = clean.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, fontSize) <= maxWidth) {
      current = next;
      continue;
    }

    if (current) {
      lines.push(current);
      current = word;
      continue;
    }

    let chunk = "";
    for (const char of word) {
      const nextChunk = `${chunk}${char}`;
      if (font.widthOfTextAtSize(nextChunk, fontSize) <= maxWidth) {
        chunk = nextChunk;
      } else {
        if (chunk) lines.push(chunk);
        chunk = char;
      }
    }
    current = chunk;
  }

  if (current) lines.push(current);
  return lines.length > 0 ? lines : ["-"];
}

async function readFirstExistingFile(candidates: string[]) {
  for (const candidate of candidates) {
    try {
      return await readFile(path.join(process.cwd(), candidate));
    } catch {
      continue;
    }
  }
  return null;
}

function attendanceStatusLabel(status: string): string {
  switch (status.toUpperCase()) {
    case "PRESENT": return "Présent";
    case "ABSENT": return "Absent";
    case "LATE": return "En retard";
    case "HALF_DAY": return "Demi-journée";
    case "REMOTE": return "Télétravail";
    case "LEAVE": return "Congé";
    case "SICK": return "Maladie";
    case "HOLIDAY": return "Jour férié";
    default: return status;
  }
}

function locationStatusLabel(status: string): string {
  switch (status.toUpperCase()) {
    case "SITE_MATCH": return "Sur site";
    case "OFF_SITE": return "Hors site";
    case "NEAR_SITE": return "Proximité site";
    case "UNKNOWN": return "Inconnu";
    case "NO_LOCATION": return "Non renseigné";
    default: return status;
  }
}

function formatMinutes(mins: number): string {
  if (!mins || mins <= 0) return "-";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

function formatAttendanceDate(value: string | Date, timeZone: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone,
  }).format(new Date(value));
}

function formatAttendanceTime(value: string | Date | null, timeZone: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date(value));
}

export async function GET(request: NextRequest) {
  const access = await requireApiModuleAccess("attendance", ["ADMIN", "DIRECTEUR_GENERAL", "ACCOUNTANT", "EMPLOYEE"]);
  if (access.error) {
    return access.error;
  }

  const isComptable = access.role === "ACCOUNTANT" || (access.session.user.jobTitle ?? "").trim().toUpperCase() === "COMPTABLE";
  const canExportAttendanceReport = access.role === "ADMIN" || access.role === "DIRECTEUR_GENERAL" || isComptable;

  if (!canExportAttendanceReport) {
    return NextResponse.json({ error: "Accès refusé au rapport des présences." }, { status: 403 });
  }

  const range = dateRangeFromParams(request.nextUrl.searchParams);
  const requestedUserId = request.nextUrl.searchParams.get("userId")?.trim();
  const roleFilter = requestedUserId ? { userId: requestedUserId } : {};

  const rows = await prisma.attendance.findMany({
    where: {
      ...roleFilter,
      date: { gte: range.start, lt: range.end },
    },
    include: { user: { select: { name: true, team: { select: { name: true } } } } },
    orderBy: [{ date: "asc" }, { user: { name: "asc" } }],
    take: 1200,
  });

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  const preferredFont = await readFirstExistingFile([
    "public/fonts/MAIAN.TTF",
    "public/branding/fonts/MAIAN.TTF",
    "public/fonts/Montserrat-Regular.ttf",
    "public/branding/fonts/Montserrat-Regular.ttf",
  ]);

  if (!preferredFont) {
    return NextResponse.json({ error: "Police PDF introuvable sur le serveur (MAIAN/Montserrat)." }, { status: 500 });
  }

  const font = await pdf.embedFont(preferredFont);
  const fontBold = font;
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
  const x = [24, 90, 225, 290, 340, 390, 450, 525, 610];
  const widths = [62, 131, 61, 46, 46, 56, 74, 81, 208];
  const cellSize = 7.2;
  const cellLineHeight = 8.8;

  for (const row of rows) {
    const rowTimezone = resolveAttendanceTimeZone(row.user.team?.name);
    const values = [
      formatAttendanceDate(row.date, rowTimezone),
      row.user.name,
      attendanceStatusLabel(row.status),
      formatAttendanceTime(row.clockIn, rowTimezone),
      formatAttendanceTime(row.clockOut, rowTimezone),
      formatMinutes(row.latenessMins),
      formatMinutes(row.overtimeMins),
      locationStatusLabel(row.locationStatus),
      row.notes ?? "-",
    ];

    const wrappedCells = values.map((value, index) => wrapTextByWidth(value, font, cellSize, widths[index]));
    const lineCount = wrappedCells.reduce((max, lines) => Math.max(max, lines.length), 1);
    const rowHeight = Math.max(11, lineCount * cellLineHeight);

    if (y - rowHeight < 42) {
      page = pdf.addPage([842, 595]);
      drawHeader();
      y = 510;
    }

    wrappedCells.forEach((lines, index) => {
      lines.forEach((line, lineIndex) => {
        page.drawText(line, {
          x: x[index],
          y: y - (lineIndex * cellLineHeight),
          size: cellSize,
          font,
          color: textBlack,
        });
      });
    });

    y -= rowHeight;
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
