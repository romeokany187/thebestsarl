import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { PaymentStatus } from "@prisma/client";
import { requireApiModuleAccess } from "@/lib/rbac";
import {
  TICKET_PAYMENT_STATUS_COLUMN_HEADERS,
  loadTicketPaymentStatusRows,
  ticketPaymentStatusRowToCells,
  type TicketPaymentStatusScope,
} from "@/lib/ticket-payment-status-export";

function dateRangeFromParams(params: URLSearchParams) {
  const now = new Date();
  const defaultDay = now.toISOString().slice(0, 10);
  const startRaw = params.get("startDate") ?? defaultDay;
  const endRaw = params.get("endDate") ?? startRaw;
  const start = new Date(`${startRaw}T00:00:00.000Z`);
  const end = new Date(`${endRaw}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end, startRaw, endRaw };
}

function parseTicketStatus(value: string | null): PaymentStatus | "ALL" {
  const normalized = (value ?? "ALL").trim().toUpperCase();
  if (normalized === "PAID" || normalized === "PAYÉ" || normalized === "PAYE") return PaymentStatus.PAID;
  if (normalized === "PARTIAL" || normalized === "PARTIEL") return PaymentStatus.PARTIAL;
  if (normalized === "UNPAID" || normalized === "NON PAYÉ" || normalized === "NON PAYE" || normalized === "IMPAYÉ") {
    return PaymentStatus.UNPAID;
  }
  return "ALL";
}

function parseScope(value: string | null): TicketPaymentStatusScope {
  return value === "paid" ? "paid" : "issued";
}

export async function GET(request: NextRequest) {
  const access = await requireApiModuleAccess("payments", ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  if (access.error) {
    return access.error;
  }

  const params = request.nextUrl.searchParams;
  const range = dateRangeFromParams(params);
  const ticketStatus = parseTicketStatus(params.get("ticketStatus"));
  const scope = parseScope(params.get("scope"));
  const airlineId = params.get("airlineId")?.trim() || null;
  const format = (params.get("format") ?? "json").trim().toLowerCase();

  const rows = await loadTicketPaymentStatusRows({
    start: range.start,
    end: range.end,
    scope,
    ticketStatus,
    airlineId,
  });

  if (format === "xlsx" || format === "excel") {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Statut paiements billets");
    sheet.addRow([...TICKET_PAYMENT_STATUS_COLUMN_HEADERS]);
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    for (const row of rows) {
      sheet.addRow(ticketPaymentStatusRowToCells(row));
    }
    sheet.columns.forEach((column) => {
      column.width = 18;
    });

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const filename = `statut-paiements-billets-${range.startRaw}-${range.endRaw}.xlsx`;
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  return NextResponse.json({
    meta: {
      startDate: range.startRaw,
      endDate: range.endRaw,
      scope,
      ticketStatus,
      airlineId,
      count: rows.length,
      columns: TICKET_PAYMENT_STATUS_COLUMN_HEADERS,
      source: "TicketSale + Payment (pas de table dédiée ; statut calculé depuis les encaissements caisse).",
    },
    rows,
  });
}
