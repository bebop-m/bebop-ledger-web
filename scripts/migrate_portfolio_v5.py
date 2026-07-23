"""Audit and migrate a private portfolio snapshot to schema v5.

Dry-run is the default. The report intentionally contains counts only and never
prints symbols, holdings, balances, transaction amounts, or credentials.
"""

import argparse
import copy
import json
import sys
from pathlib import Path

import settle_private_portfolio as settlement


def collapse_holdings(items):
    merged = {}
    order = []
    for index, raw in enumerate(items or []):
        holding = settlement.normalize_holding(raw, index)
        if not holding:
            continue
        symbol = holding["symbol"]
        if symbol not in merged:
            merged[symbol] = holding
            order.append(symbol)
            continue
        previous = merged[symbol]
        previous["quantity"] = settlement.safe_float(previous.get("quantity")) + settlement.safe_float(holding.get("quantity"))
        previous["shares"] = previous["quantity"]
        if holding.get("taxRateOverride") not in (None, ""):
            previous["taxRateOverride"] = holding["taxRateOverride"]
        if holding.get("bucket") == "income":
            previous["bucket"] = "income"
    return [merged[symbol] for symbol in order]


def migrate_snapshot(payload, today=None):
    source = payload.get("state") if isinstance(payload, dict) and isinstance(payload.get("state"), dict) else payload
    raw = copy.deepcopy(source) if isinstance(source, dict) else {}
    raw_holdings = raw.get("holdings") if isinstance(raw.get("holdings"), list) else raw.get("positions", [])
    raw_ledger = raw.get("dividendLedger") if isinstance(raw.get("dividendLedger"), list) else []
    raw_snapshots = raw.get("dailySnapshots") if isinstance(raw.get("dailySnapshots"), list) else []
    raw_backfills = [item for item in raw.get("yearlyHoldings", [])
                     if isinstance(item, dict) and item.get("source") == "backfill"]

    migrated = settlement.normalize_snapshot(raw)
    collapsed = collapse_holdings(raw_holdings)
    holdings_removed = max(0, len([item for item in raw_holdings if isinstance(item, dict)]) - len(collapsed))
    migrated["holdings"] = collapsed

    tax_capped = 0
    for holding in migrated["holdings"]:
        raw_tax = holding.get("taxRateOverride")
        if raw_tax in (None, ""):
            continue
        numeric = settlement.safe_float(raw_tax, 0.0)
        capped = min(100.0, max(0.0, numeric))
        if capped != numeric:
            tax_capped += 1
        holding["taxRateOverride"] = str(int(capped)) if capped.is_integer() else str(capped)

    snapshots_by_date = {}
    for snapshot in raw_snapshots:
        date = settlement.normalize_date((snapshot or {}).get("date"))
        if date:
            snapshots_by_date[date] = snapshot
    migrated["dailySnapshots"] = [snapshots_by_date[date] for date in sorted(snapshots_by_date)]
    snapshots_removed = max(0, len(raw_snapshots) - len(migrated["dailySnapshots"]))

    flagged = 0
    normalized_ledger = []
    for entry in raw_ledger:
        if not isinstance(entry, dict):
            continue
        next_entry = copy.deepcopy(entry)
        original_tax = settlement.safe_float(next_entry.get("taxRate"), 0.0)
        capped_tax = min(1.0, max(0.0, original_tax))
        if capped_tax != original_tax:
            tax_capped += 1
        next_entry["taxRate"] = capped_tax
        is_auto_historical = (
            next_entry.get("confirmed") is not True
            and next_entry.get("confidence") != "manual"
            and next_entry.get("sharesSource") == "current"
        )
        if is_auto_historical:
            context = settlement.dividend_context(
                migrated,
                settlement.normalize_symbol(next_entry.get("symbol")),
                settlement.normalize_date(next_entry.get("exDate")),
                next_entry.get("currency"),
            )
            if context:
                next_entry.update({
                    "shares": context["shares"],
                    "sharesSource": context["sharesSource"],
                    "fxRate": context["fxRate"],
                    "taxRate": context["taxRate"],
                    "bucket": context["bucket"],
                    "confidence": context["confidence"],
                })
                gross = settlement.round_money(
                    settlement.safe_float(next_entry.get("amountPerShare"))
                    * context["shares"] * context["fxRate"])
                next_entry["grossCny"] = gross
                next_entry["netCny"] = settlement.round_money(gross * (1 - context["taxRate"]))
            else:
                next_entry["confidence"] = "unverifiedHistorical"
                next_entry["excludedFromTotals"] = True
                flagged += 1
        normalized_ledger.append(next_entry)

    migrated["dividendLedger"] = settlement.normalize_economic_entries(normalized_ledger, migrated.get("rates"))
    duplicates_removed = max(0, len(normalized_ledger) - len(migrated["dividendLedger"]))
    archives_changed = settlement.rebuild_completed_year_archives(migrated, today or settlement.today_label())
    migrated["version"] = 5

    report = {
        "schemaVersion": 5,
        "changed": migrated != raw,
        "holdingsCollapsed": holdings_removed,
        "dividendDuplicatesRemoved": duplicates_removed,
        "unverifiedHistoricalFlagged": flagged,
        "taxRatesCapped": tax_capped,
        "duplicateDailySnapshotsRemoved": snapshots_removed,
        "unsafeYearlyBackfillsRemoved": len(raw_backfills),
        "archivesRebuilt": bool(archives_changed),
    }
    return migrated, report


def parse_args():
    parser = argparse.ArgumentParser(description="Dry-run or migrate a portfolio snapshot to v5.")
    parser.add_argument("--input", default="-", help="Input JSON path, or - for stdin.")
    parser.add_argument("--output", default="", help="Required output path when --apply is used.")
    parser.add_argument("--apply", action="store_true", help="Write the migrated snapshot to --output.")
    parser.add_argument("--today", default=settlement.today_label())
    return parser.parse_args()


def main():
    args = parse_args()
    if args.apply and not args.output:
        raise RuntimeError("--output is required with --apply")
    if args.input == "-":
        payload = json.load(sys.stdin)
    else:
        payload = json.loads(Path(args.input).read_text(encoding="utf-8-sig"))
    migrated, report = migrate_snapshot(payload, settlement.normalize_date(args.today) or settlement.today_label())
    if args.apply:
        Path(args.output).write_text(json.dumps(migrated, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
