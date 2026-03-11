import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiModuleAccess } from "@/lib/rbac";

type CompareType = "CAISSE" | "VENTES" | "PRESENCES" | "RAPPORTS" | "ARCHIVES" | "BESOINS_CAISSE";

type CompareRow = {
  key: string;
  issue: "OK" | "MISSING_IN_SYSTEM" | "MISSING_IN_FILE" | "AMOUNT_DIFF" | "FIELD_DIFF";
  systemValue: string;
  externalValue: string;
  severity: "low" | "medium" | "high";
};

function parseDateRange(startDate: string | null, endDate: string | null) {
  const now = new Date();
  const startRaw = startDate ?? now.toISOString().slice(0, 10);
  const endRaw = endDate ?? startRaw;
  const start = new Date(`${startRaw}T00:00:00.000Z`);
  const end = new Date(`${endRaw}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end, startRaw, endRaw };
}

function parseDelimitedLine(line: string, delimiter: string) {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === delimiter && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += ch;
  }

  values.push(current.trim());
  return values;
}

function chooseDelimiter(header: string) {
  const delimiters = [",", ";", "|", "\t"];
  let winner = ",";
  let best = -1;
  for (const delimiter of delimiters) {
    const score = header.split(delimiter).length;
    if (score > best) {
      best = score;
      winner = delimiter;
    }
  }
  return best >= 2 ? winner : null;
}

function parseTabularText(text: string) {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) return [];

  const delimiter = chooseDelimiter(lines[0]);
  if (!delimiter) return [];

  const headers = parseDelimitedLine(lines[0], delimiter).map((item) => item.toLowerCase());
  const rows: Array<Record<string, string>> = [];

  for (let i = 1; i < lines.length; i += 1) {
    const values = parseDelimitedLine(lines[i], delimiter);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    rows.push(row);
  }

  return rows;
}

function normalizeKey(value: string) {
  return value.trim().toUpperCase();
}

function asAmount(value: string | null | undefined) {
  if (!value) return 0;
  const normalized = value.replace(/\s/g, "").replace(/,/g, ".").replace(/[^0-9.-]/g, "");
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
}

function getValue(row: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    const value = row[key.toLowerCase()];
    if (value && value.trim()) return value.trim();
  }
  return "";
}

function compareNumeric(a: number, b: number) {
  return Math.abs(a - b) < 0.01;
}

async function parseExternalRowsFromFile(file: File) {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";

  if (ext === "csv") {
    const text = await file.text();
    return parseTabularText(text);
  }

  if (ext === "xls" || ext === "xlsx" || ext === "pdf") {
    // Without extra parsing libraries, we try tabular-text extraction first.
    const bytes = new Uint8Array(await file.arrayBuffer());
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const rows = parseTabularText(text);
    if (rows.length > 0) return rows;

    throw new Error(
      "Impossible de parser automatiquement ce fichier Excel/PDF binaire. Exportez-le en CSV (UTF-8) ou utilisez un fichier délimité (.csv/.txt).",
    );
  }

  throw new Error("Format non supporté. Formats acceptés: .csv, .xls, .xlsx, .pdf");
}

async function compareCaisse(range: { start: Date; end: Date }, externalRows: Array<Record<string, string>>) {
  const [payments, approvedNeeds] = await Promise.all([
    prisma.payment.findMany({
      where: { paidAt: { gte: range.start, lt: range.end } },
      include: {
        ticket: { select: { ticketNumber: true } },
      },
      take: 6000,
    }),
    prisma.needRequest.findMany({
      where: {
        status: "APPROVED",
        OR: [
          { approvedAt: { gte: range.start, lt: range.end } },
          { createdAt: { gte: range.start, lt: range.end } },
        ],
      },
      select: { id: true, title: true, estimatedAmount: true },
      take: 4000,
    }),
  ]);

  const systemMap = new Map<string, { amount: number; type: "IN" | "OUT" }>();

  for (const payment of payments) {
    const key = normalizeKey(`IN:${payment.ticket.ticketNumber}`);
    systemMap.set(key, {
      amount: (systemMap.get(key)?.amount ?? 0) + payment.amount,
      type: "IN",
    });
  }

  for (const need of approvedNeeds) {
    const amount = need.estimatedAmount ?? 0;
    const key = normalizeKey(`OUT:${need.title}`);
    systemMap.set(key, {
      amount: (systemMap.get(key)?.amount ?? 0) + amount,
      type: "OUT",
    });
  }

  const externalMap = new Map<string, { amount: number; type: "IN" | "OUT" }>();

  for (const row of externalRows) {
    const ref = getValue(row, ["reference", "ref", "libelle", "description", "ticket", "titre"]);
    const typeRaw = getValue(row, ["type", "sens", "mouvement"]);
    const amount = asAmount(getValue(row, ["amount", "montant", "value", "valeur"]));
    const type = typeRaw.toUpperCase().includes("OUT") || typeRaw.toUpperCase().includes("DEP") ? "OUT" : "IN";
    const key = normalizeKey(`${type}:${ref || amount.toFixed(2)}`);
    externalMap.set(key, {
      amount: (externalMap.get(key)?.amount ?? 0) + amount,
      type,
    });
  }

  const keys = new Set([...systemMap.keys(), ...externalMap.keys()]);
  const rows: CompareRow[] = [];

  keys.forEach((key) => {
    const s = systemMap.get(key);
    const e = externalMap.get(key);
    if (!s && e) {
      rows.push({
        key,
        issue: "MISSING_IN_SYSTEM",
        systemValue: "-",
        externalValue: `${e.type} ${e.amount.toFixed(2)}`,
        severity: "high",
      });
      return;
    }

    if (s && !e) {
      rows.push({
        key,
        issue: "MISSING_IN_FILE",
        systemValue: `${s.type} ${s.amount.toFixed(2)}`,
        externalValue: "-",
        severity: "medium",
      });
      return;
    }

    if (s && e && !compareNumeric(s.amount, e.amount)) {
      rows.push({
        key,
        issue: "AMOUNT_DIFF",
        systemValue: `${s.type} ${s.amount.toFixed(2)}`,
        externalValue: `${e.type} ${e.amount.toFixed(2)}`,
        severity: "high",
      });
      return;
    }

    if (s && e) {
      rows.push({
        key,
        issue: "OK",
        systemValue: `${s.type} ${s.amount.toFixed(2)}`,
        externalValue: `${e.type} ${e.amount.toFixed(2)}`,
        severity: "low",
      });
    }
  });

  return rows;
}

async function compareVentes(
  range: { start: Date; end: Date },
  externalRows: Array<Record<string, string>>,
  airlineScope?: string,
) {
  const airlineScopeNormalized = normalizeKey(airlineScope ?? "");

  const tickets = await prisma.ticketSale.findMany({
    where: {
      soldAt: { gte: range.start, lt: range.end },
      ...(airlineScopeNormalized ? {
        airline: { code: { equals: airlineScopeNormalized, mode: "insensitive" as const } },
      } : {}),
    },
    select: {
      ticketNumber: true,
      customerName: true,
      amount: true,
      soldAt: true,
      airline: { select: { code: true } },
    },
    take: 6000,
  });

  const systemMap = new Map<string, { amount: number; client: string; date: string; airline: string }>();
  tickets.forEach((ticket) => {
    systemMap.set(normalizeKey(ticket.ticketNumber), {
      amount: ticket.amount,
      client: ticket.customerName,
      date: ticket.soldAt.toISOString().slice(0, 10),
      airline: normalizeKey(ticket.airline.code),
    });
  });

  const externalMap = new Map<string, { amount: number; client: string; date: string; airline: string }>();
  externalRows.forEach((row) => {
    const key = normalizeKey(getValue(row, ["ticket", "ticketnumber", "pnr", "reference", "ref"]));
    if (!key) return;

    const airline = normalizeKey(getValue(row, ["airline", "compagnie", "carrier", "code_compagnie"]));
    if (airlineScopeNormalized && airline && airline !== airlineScopeNormalized) return;

    externalMap.set(key, {
      amount: asAmount(getValue(row, ["amount", "montant"])),
      client: getValue(row, ["client", "customer", "nom"]),
      date: getValue(row, ["date", "soldat", "vente_date"]).slice(0, 10),
      airline,
    });
  });

  const keys = new Set([...systemMap.keys(), ...externalMap.keys()]);
  const rows: CompareRow[] = [];

  keys.forEach((key) => {
    const s = systemMap.get(key);
    const e = externalMap.get(key);
    if (!s && e) {
      rows.push({ key, issue: "MISSING_IN_SYSTEM", systemValue: "-", externalValue: `${e.client} ${e.amount.toFixed(2)}`, severity: "high" });
      return;
    }
    if (s && !e) {
      rows.push({ key, issue: "MISSING_IN_FILE", systemValue: `${s.client} ${s.amount.toFixed(2)}`, externalValue: "-", severity: "medium" });
      return;
    }
    if (s && e) {
      const sameAmount = compareNumeric(s.amount, e.amount);
      const sameClient = normalizeKey(s.client) === normalizeKey(e.client);
      const sameAirline = !airlineScopeNormalized || !e.airline || normalizeKey(s.airline) === normalizeKey(e.airline);
      if (!sameAmount || !sameClient || !sameAirline) {
        rows.push({
          key,
          issue: !sameAmount ? "AMOUNT_DIFF" : "FIELD_DIFF",
          systemValue: `${s.airline} ${s.client} ${s.amount.toFixed(2)} ${s.date}`,
          externalValue: `${e.airline || "-"} ${e.client} ${e.amount.toFixed(2)} ${e.date}`,
          severity: "high",
        });
        return;
      }
      rows.push({ key, issue: "OK", systemValue: `${s.client} ${s.amount.toFixed(2)}`, externalValue: `${e.client} ${e.amount.toFixed(2)}`, severity: "low" });
    }
  });

  return rows;
}

async function comparePresences(range: { start: Date; end: Date }, externalRows: Array<Record<string, string>>) {
  const rowsDb = await prisma.attendance.findMany({
    where: { date: { gte: range.start, lt: range.end } },
    include: { user: { select: { name: true } } },
    take: 6000,
  });

  const systemMap = new Map<string, { in: string; out: string; status: string }>();
  rowsDb.forEach((row) => {
    const key = normalizeKey(`${row.user.name}|${row.date.toISOString().slice(0, 10)}`);
    systemMap.set(key, {
      in: row.clockIn ? row.clockIn.toISOString().slice(11, 16) : "",
      out: row.clockOut ? row.clockOut.toISOString().slice(11, 16) : "",
      status: row.status,
    });
  });

  const externalMap = new Map<string, { in: string; out: string; status: string }>();
  externalRows.forEach((row) => {
    const name = getValue(row, ["employee", "employe", "nom", "name"]);
    const date = getValue(row, ["date", "jour"]).slice(0, 10);
    if (!name || !date) return;
    const key = normalizeKey(`${name}|${date}`);
    externalMap.set(key, {
      in: getValue(row, ["clockin", "entree", "in"]),
      out: getValue(row, ["clockout", "sortie", "out"]),
      status: getValue(row, ["status", "statut"]),
    });
  });

  const keys = new Set([...systemMap.keys(), ...externalMap.keys()]);
  const rows: CompareRow[] = [];

  keys.forEach((key) => {
    const s = systemMap.get(key);
    const e = externalMap.get(key);
    if (!s && e) {
      rows.push({ key, issue: "MISSING_IN_SYSTEM", systemValue: "-", externalValue: `${e.in}/${e.out}`, severity: "high" });
      return;
    }
    if (s && !e) {
      rows.push({ key, issue: "MISSING_IN_FILE", systemValue: `${s.in}/${s.out}`, externalValue: "-", severity: "medium" });
      return;
    }
    if (s && e) {
      const sameIn = s.in === e.in || !e.in;
      const sameOut = s.out === e.out || !e.out;
      if (!sameIn || !sameOut) {
        rows.push({ key, issue: "FIELD_DIFF", systemValue: `${s.in}/${s.out}`, externalValue: `${e.in}/${e.out}`, severity: "medium" });
      } else {
        rows.push({ key, issue: "OK", systemValue: `${s.in}/${s.out}`, externalValue: `${e.in}/${e.out}`, severity: "low" });
      }
    }
  });

  return rows;
}

async function compareRapports(range: { start: Date; end: Date }, externalRows: Array<Record<string, string>>) {
  const reports = await prisma.workerReport.findMany({
    where: { createdAt: { gte: range.start, lt: range.end } },
    include: { author: { select: { name: true } } },
    take: 5000,
  });

  const systemMap = new Map<string, { status: string; period: string }>();
  reports.forEach((report) => {
    const key = normalizeKey(`${report.author.name}|${report.title}`);
    systemMap.set(key, { status: report.status, period: report.period });
  });

  const externalMap = new Map<string, { status: string; period: string }>();
  externalRows.forEach((row) => {
    const name = getValue(row, ["employee", "employe", "author", "auteur"]);
    const title = getValue(row, ["title", "titre", "report"]);
    if (!name || !title) return;
    const key = normalizeKey(`${name}|${title}`);
    externalMap.set(key, {
      status: normalizeKey(getValue(row, ["status", "statut"])),
      period: normalizeKey(getValue(row, ["period", "periode"])),
    });
  });

  const keys = new Set([...systemMap.keys(), ...externalMap.keys()]);
  const rows: CompareRow[] = [];

  keys.forEach((key) => {
    const s = systemMap.get(key);
    const e = externalMap.get(key);
    if (!s && e) {
      rows.push({ key, issue: "MISSING_IN_SYSTEM", systemValue: "-", externalValue: `${e.status}/${e.period}`, severity: "high" });
      return;
    }
    if (s && !e) {
      rows.push({ key, issue: "MISSING_IN_FILE", systemValue: `${s.status}/${s.period}`, externalValue: "-", severity: "medium" });
      return;
    }
    if (s && e) {
      const sameStatus = !e.status || normalizeKey(s.status) === e.status;
      const samePeriod = !e.period || normalizeKey(s.period) === e.period;
      if (!sameStatus || !samePeriod) {
        rows.push({ key, issue: "FIELD_DIFF", systemValue: `${s.status}/${s.period}`, externalValue: `${e.status}/${e.period}`, severity: "medium" });
      } else {
        rows.push({ key, issue: "OK", systemValue: `${s.status}/${s.period}`, externalValue: `${e.status}/${e.period}`, severity: "low" });
      }
    }
  });

  return rows;
}

async function compareArchives(range: { start: Date; end: Date }, externalRows: Array<Record<string, string>>) {
  const archives = await prisma.archiveDocument.findMany({
    where: { createdAt: { gte: range.start, lt: range.end } },
    select: { reference: true, title: true, folder: true, originalFileName: true },
    take: 5000,
  });

  const systemMap = new Map<string, { title: string; folder: string; file: string }>();
  for (const doc of archives) {
    const key = normalizeKey(doc.reference || doc.title);
    systemMap.set(key, { title: doc.title, folder: doc.folder, file: doc.originalFileName });
  }

  const externalMap = new Map<string, { title: string; folder: string; file: string }>();
  for (const row of externalRows) {
    const ref = getValue(row, ["reference", "ref", "code"]);
    const title = getValue(row, ["title", "titre", "dossier"]);
    const folder = getValue(row, ["folder", "classeur", "rubrique"]);
    const file = getValue(row, ["file", "fichier", "nom_fichier"]);
    const key = normalizeKey(ref || title);
    if (!key) continue;
    externalMap.set(key, { title, folder, file });
  }

  const keys = new Set([...systemMap.keys(), ...externalMap.keys()]);
  const rows: CompareRow[] = [];

  keys.forEach((key) => {
    const s = systemMap.get(key);
    const e = externalMap.get(key);
    if (!s && e) {
      rows.push({ key, issue: "MISSING_IN_SYSTEM", systemValue: "-", externalValue: `${e.title} ${e.folder}`, severity: "high" });
      return;
    }
    if (s && !e) {
      rows.push({ key, issue: "MISSING_IN_FILE", systemValue: `${s.title} ${s.folder}`, externalValue: "-", severity: "medium" });
      return;
    }
    if (s && e) {
      const sameFolder = !e.folder || normalizeKey(s.folder) === normalizeKey(e.folder);
      const sameTitle = !e.title || normalizeKey(s.title) === normalizeKey(e.title);
      if (!sameFolder || !sameTitle) {
        rows.push({ key, issue: "FIELD_DIFF", systemValue: `${s.title} ${s.folder}`, externalValue: `${e.title} ${e.folder}`, severity: "medium" });
      } else {
        rows.push({ key, issue: "OK", systemValue: `${s.title} ${s.folder}`, externalValue: `${e.title} ${e.folder}`, severity: "low" });
      }
    }
  });

  return rows;
}

async function compareBesoinsCaisse(range: { start: Date; end: Date }, externalRows: Array<Record<string, string>>) {
  const approvedNeeds = await prisma.needRequest.findMany({
    where: {
      status: "APPROVED",
      OR: [
        { approvedAt: { gte: range.start, lt: range.end } },
        { createdAt: { gte: range.start, lt: range.end } },
      ],
    },
    select: { title: true, estimatedAmount: true },
    take: 5000,
  });

  const systemMap = new Map<string, number>();
  for (const need of approvedNeeds) {
    const key = normalizeKey(need.title);
    systemMap.set(key, (systemMap.get(key) ?? 0) + (need.estimatedAmount ?? 0));
  }

  const externalMap = new Map<string, number>();
  for (const row of externalRows) {
    const typeRaw = normalizeKey(getValue(row, ["type", "sens", "mouvement"]));
    if (typeRaw && !typeRaw.includes("OUT") && !typeRaw.includes("DEP")) continue;

    const key = normalizeKey(getValue(row, ["libelle", "description", "reference", "ref", "titre"]));
    if (!key) continue;
    const amount = asAmount(getValue(row, ["amount", "montant", "value", "valeur"]));
    externalMap.set(key, (externalMap.get(key) ?? 0) + amount);
  }

  const keys = new Set([...systemMap.keys(), ...externalMap.keys()]);
  const rows: CompareRow[] = [];

  keys.forEach((key) => {
    const s = systemMap.get(key);
    const e = externalMap.get(key);
    if (s == null && e != null) {
      rows.push({ key, issue: "MISSING_IN_SYSTEM", systemValue: "-", externalValue: e.toFixed(2), severity: "high" });
      return;
    }
    if (s != null && e == null) {
      rows.push({ key, issue: "MISSING_IN_FILE", systemValue: s.toFixed(2), externalValue: "-", severity: "high" });
      return;
    }
    if (s != null && e != null && !compareNumeric(s, e)) {
      rows.push({ key, issue: "AMOUNT_DIFF", systemValue: s.toFixed(2), externalValue: e.toFixed(2), severity: "high" });
      return;
    }
    if (s != null && e != null) {
      rows.push({ key, issue: "OK", systemValue: s.toFixed(2), externalValue: e.toFixed(2), severity: "low" });
    }
  });

  return rows;
}

export async function POST(request: NextRequest) {
  const access = await requireApiModuleAccess("audit", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) return access.error;

  if ((access.session.user.jobTitle ?? "").toUpperCase() !== "AUDITEUR") {
    return NextResponse.json({ error: "Mode lecture: écriture réservée à l'auditeur." }, { status: 403 });
  }

  const formData = await request.formData();
  const compareTypeRaw = String(formData.get("compareType") ?? "").toUpperCase();
  const file = formData.get("file");
  const startDate = String(formData.get("startDate") ?? "");
  const endDate = String(formData.get("endDate") ?? "");
  const airlineScope = String(formData.get("airlineScope") ?? "").trim();

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Fichier requis." }, { status: 400 });
  }

  if (![
    "CAISSE",
    "VENTES",
    "PRESENCES",
    "RAPPORTS",
    "ARCHIVES",
    "BESOINS_CAISSE",
  ].includes(compareTypeRaw)) {
    return NextResponse.json({ error: "Type de comparaison invalide." }, { status: 400 });
  }

  let externalRows: Array<Record<string, string>> = [];
  try {
    externalRows = await parseExternalRowsFromFile(file);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Fichier externe invalide." }, { status: 400 });
  }

  if (externalRows.length === 0) {
    return NextResponse.json({ error: "Le fichier est vide ou invalide." }, { status: 400 });
  }

  const range = parseDateRange(startDate || null, endDate || null);
  const compareType = compareTypeRaw as CompareType;

  let rows: CompareRow[] = [];
  if (compareType === "CAISSE") {
    rows = await compareCaisse(range, externalRows);
  } else if (compareType === "VENTES") {
    rows = await compareVentes(range, externalRows, airlineScope);
  } else if (compareType === "PRESENCES") {
    rows = await comparePresences(range, externalRows);
  } else if (compareType === "RAPPORTS") {
    rows = await compareRapports(range, externalRows);
  } else if (compareType === "ARCHIVES") {
    rows = await compareArchives(range, externalRows);
  } else {
    rows = await compareBesoinsCaisse(range, externalRows);
  }

  const summary = {
    compareType,
    period: `${range.startRaw} -> ${range.endRaw}`,
    externalRows: externalRows.length,
    checkedRows: rows.length,
    ok: rows.filter((row) => row.issue === "OK").length,
    mismatches: rows.filter((row) => row.issue !== "OK").length,
    highSeverity: rows.filter((row) => row.severity === "high").length,
    scope: airlineScope || null,
  };

  await prisma.auditLog.create({
    data: {
      actorId: access.session.user.id,
      action: "AUDIT_EXTERNAL_COMPARE",
      entityType: "AUDIT_WORKSPACE",
      entityId: "GLOBAL",
      payload: {
        summary,
        fileName: file.name,
      } as Prisma.InputJsonValue,
    },
  });

  return NextResponse.json({
    data: {
      summary,
      rows: rows.slice(0, 1500),
    },
  });
}
