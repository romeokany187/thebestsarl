import { NextRequest, NextResponse } from "next/server";
import { requireApiModuleAccess } from "@/lib/rbac";
import {
  buildCashIncomeStatement,
  buildCashIncomeStatementExcelBuffer,
  buildCashIncomeStatementPdfBuffer,
} from "@/lib/cash-income-statement";

export const dynamic = "force-dynamic";

function resolveReportMonth(params: URLSearchParams) {
  const month = (params.get("month") ?? params.get("cashMonth") ?? "").trim();
  if (/^\d{4}-\d{2}$/.test(month)) return month;
  return new Date().toISOString().slice(0, 7);
}

/** GET /api/comptabilite/income-statement?month=YYYY-MM&format=xlsx|pdf|json */
export async function GET(request: NextRequest) {
  const access = await requireApiModuleAccess("comptabilite", [
    "ADMIN",
    "ACCOUNTANT",
    "DIRECTEUR_GENERAL",
    "MANAGER",
    "EMPLOYEE",
  ]);
  if (access.error) return access.error;

  const params = request.nextUrl.searchParams;
  const reportMonth = resolveReportMonth(params);
  const format = (params.get("format") ?? "xlsx").trim().toLowerCase();
  const forceDownload = params.get("download") === "1";

  try {
    const statement = await buildCashIncomeStatement(reportMonth);

    if (format === "json") {
      return NextResponse.json({
        reportType: "income-statement",
        periodLabel: reportMonth,
        data: statement,
      });
    }

    if (format === "pdf") {
      const buffer = await buildCashIncomeStatementPdfBuffer(statement);
      const filename = `compte-de-resultat-THE-BEST-SARL-${reportMonth}.pdf`;
      return new NextResponse(buffer, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `${forceDownload ? "attachment" : "inline"}; filename="${filename}"`,
        },
      });
    }

    const buffer = await buildCashIncomeStatementExcelBuffer(statement);
    const filename = `compte-de-resultat-THE-BEST-SARL-${reportMonth}.xlsx`;
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur compte de résultat.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
