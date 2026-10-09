#!/usr/bin/env python3
"""Compare journal PDF (prod) vs rapport Excel caissière — sans base de données."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run_pdf_aggregate(pdf_path: str) -> dict:
    proc = subprocess.run(
        [sys.executable, str(Path(__file__).with_name("parse-cash-journal-pdf-text.py")), pdf_path, "--json"],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        print(proc.stderr, file=sys.stderr)
        sys.exit(proc.returncode)
    payload = json.loads(proc.stdout.strip())
    return payload["days"], payload["monthGross"]


def run_excel_aggregate(xlsx_path: str, report_month: str) -> dict:
    cmd = [
        "npx",
        "tsx",
        "-e",
        f"""
import {{ readFileSync }} from 'fs';
import {{ parseCashReportWorkbook }} from './src/lib/cash-report-excel-parse.ts';
import {{ aggregateJournalDayTotals, buildMonthlyConstat }} from './src/lib/cash-report-month-constat.ts';
const buf = readFileSync({json.dumps(xlsx_path)});
const p = parseCashReportWorkbook(buf, {{ fallbackYear: 2026 }});
const c = buildMonthlyConstat({{ reportMonth: {json.dumps(report_month)}, excelLines: p.journalLines, systemByDay: new Map() }});
const days = {{}};
for (const d of c.days) {{
  days[d.date] = {{
    lineCount: d.excel.lineCount,
    inUsd: d.excel.ticketInUsd + d.excel.otherInUsd,
    inCdf: d.excel.ticketInCdf + d.excel.otherInCdf,
    outUsd: d.excel.outUsd,
    outCdf: d.excel.outCdf,
  }};
}}
console.log(JSON.stringify({{ meta: c.excelJournalMeta, monthGross: c.monthGross.excel, days }}));
""",
    ]
    proc = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    if proc.returncode != 0:
        print(proc.stderr, file=sys.stderr)
        sys.exit(proc.returncode)
    return json.loads(proc.stdout.strip())


def main() -> None:
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <journal.pdf> <rapport.xlsx> [YYYY-MM]", file=sys.stderr)
        sys.exit(1)
    pdf_path, xlsx_path = sys.argv[1], sys.argv[2]
    report_month = sys.argv[3] if len(sys.argv) > 3 else "2026-09"

    pdf_days, pdf_month_gross = run_pdf_aggregate(pdf_path)
    excel_payload = run_excel_aggregate(xlsx_path, report_month)
    excel_days = excel_payload["days"]

    all_dates = sorted(set(pdf_days.keys()) | set(excel_days.keys()))
    aligned = mismatch = missing_pdf = missing_excel = 0
    rows = []
    for date in all_dates:
        p = pdf_days.get(date)
        e = excel_days.get(date)
        if p and not e:
            missing_excel += 1
            status = "MISSING_IN_EXCEL"
        elif e and not p:
            missing_pdf += 1
            status = "MISSING_IN_PDF"
        elif not p or not e:
            continue
        else:
            ok = all(abs(p[k] - e[k]) <= 1 for k in ("inUsd", "inCdf", "outUsd", "outCdf"))
            if ok:
                aligned += 1
                status = "ALIGNED"
            else:
                mismatch += 1
                status = "MISMATCH"
        rows.append({"date": date, "status": status, "pdf": p, "excel": e})

    print(
        json.dumps(
            {
                "reportMonth": report_month,
                "excelMeta": excel_payload["meta"],
                "summary": {
                    "pdfDays": len(pdf_days),
                    "excelDays": len(excel_days),
                    "alignedDays": aligned,
                    "mismatchDays": mismatch,
                    "missingInExcel": missing_pdf,
                    "missingInPdf": missing_excel,
                },
                "monthGross": {
                    "pdf": pdf_month_gross,
                    "excel": excel_payload["monthGross"],
                },
                "sampleIssues": [r for r in rows if r["status"] != "ALIGNED"][:15],
            },
            indent=2,
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
