#!/usr/bin/env python3
"""Agrège le journal de caisse PDF (export app) par jour — entrées/sorties USD/CDF."""
from __future__ import annotations

import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field

try:
    from pypdf import PdfReader
except ImportError:
    print("pip install pypdf", file=sys.stderr)
    sys.exit(1)

DATE_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})$")
NUM_RE = re.compile(r"^-?\d+(?:\.\d+)?$")


@dataclass
class DayTotals:
    line_count: int = 0
    ticket_in_usd: float = 0.0
    other_in_usd: float = 0.0
    ticket_in_cdf: float = 0.0
    other_in_cdf: float = 0.0
    out_usd: float = 0.0
    out_cdf: float = 0.0


def parse_pdf(path: str) -> dict[str, DayTotals]:
    reader = PdfReader(path)
    text = "\n".join((page.extract_text() or "") for page in reader.pages)
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]

    by_day: dict[str, DayTotals] = defaultdict(DayTotals)
    i = 0
    current_date: str | None = None

    while i < len(lines):
        line = lines[i]
        if DATE_RE.match(line):
            current_date = line
            i += 1
            continue

        if current_date is None:
            i += 1
            continue

        if line in ("Entrée en caisse", "Sortie en caisse"):
            op_type = line
            i += 1
            if i >= len(lines):
                break
            libelle = lines[i]
            i += 1
            # Colonnes PDF : USD+, USD-, USD solde, CDF+, CDF-, CDF solde (on ignore les soldes)
            slots: list[float | None] = []
            while i < len(lines) and len(slots) < 6:
                token = lines[i]
                if NUM_RE.match(token):
                    slots.append(float(token))
                    i += 1
                elif token == "-":
                    slots.append(0.0)
                    i += 1
                elif DATE_RE.match(token) or token in ("Entrée en caisse", "Sortie en caisse"):
                    break
                else:
                    i += 1

            if len(slots) < 2:
                continue

            usd_in = slots[0] or 0.0
            usd_out = slots[1] or 0.0
            cdf_in = (slots[3] or 0.0) if len(slots) > 3 else 0.0
            cdf_out = (slots[4] or 0.0) if len(slots) > 4 else 0.0

            bucket = by_day[current_date]
            bucket.line_count += 1
            is_ticket = "Paiement billet" in libelle

            if op_type == "Entrée en caisse":
                if is_ticket:
                    bucket.ticket_in_usd += usd_in
                    bucket.ticket_in_cdf += cdf_in
                else:
                    bucket.other_in_usd += usd_in
                    bucket.other_in_cdf += cdf_in
            else:
                bucket.out_usd += usd_out
                bucket.out_cdf += cdf_out
            continue

        if line == "Solde d'ouverture":
            i += 1
            continue

        i += 1

    return dict(by_day)


def gross(t: DayTotals) -> tuple[float, float, float, float]:
    return (
        t.ticket_in_usd + t.other_in_usd,
        t.ticket_in_cdf + t.other_in_cdf,
        t.out_usd,
        t.out_cdf,
    )


def main() -> None:
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <journal.pdf> [--json]", file=sys.stderr)
        sys.exit(1)

    pdf_path = sys.argv[1]
    as_json = len(sys.argv) > 2 and sys.argv[2] == "--json"
    by_day = parse_pdf(pdf_path)
    dates = sorted(by_day.keys())
    month_gross = [0.0, 0.0, 0.0, 0.0]
    days_out = {}
    for d in dates:
        t = by_day[d]
        g = gross(t)
        for j in range(4):
            month_gross[j] += g[j]
        days_out[d] = {
            "lineCount": t.line_count,
            "inUsd": round(g[0], 2),
            "inCdf": round(g[1], 2),
            "outUsd": round(g[2], 2),
            "outCdf": round(g[3], 2),
        }

    if as_json:
        import json

        print(
            json.dumps(
                {
                    "days": days_out,
                    "monthGross": {
                        "inUsd": round(month_gross[0], 2),
                        "inCdf": round(month_gross[1], 2),
                        "outUsd": round(month_gross[2], 2),
                        "outCdf": round(month_gross[3], 2),
                    },
                },
                ensure_ascii=False,
            )
        )
        return

    print(f"days={len(dates)} from={dates[0] if dates else None} to={dates[-1] if dates else None}")
    print(
        f"month_gross inUsd={month_gross[0]:.2f} inCdf={month_gross[1]:.2f} "
        f"outUsd={month_gross[2]:.2f} outCdf={month_gross[3]:.2f}"
    )


if __name__ == "__main__":
    main()
