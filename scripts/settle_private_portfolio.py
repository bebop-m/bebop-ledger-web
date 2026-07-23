import argparse
import base64
import copy
import json
import math
import os
import re
from decimal import Decimal, ROUND_HALF_UP
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests


DEFAULT_RATES = {"CNY": 1, "USD": 7.22, "HKD": 0.92}
PAYDATE_LAG_DAYS = {"CN": 0, "HK": 30, "US": 14}
LOCAL_TZ = timezone(timedelta(hours=8))


def safe_float(value, default=0.0):
    try:
        parsed = float(value)
    except Exception:
        return default
    return parsed if math.isfinite(parsed) else default


def round_decimal(value, digits=6):
    quantum = Decimal(1).scaleb(-max(0, int(digits)))
    return float(Decimal(str(safe_float(value, 0.0))).quantize(quantum, rounding=ROUND_HALF_UP))


def round_money(value):
    return round_decimal(value, 2)


def normalize_symbol(raw_symbol):
    value = str(raw_symbol or "").strip().upper()
    if not value:
        return ""

    def normalize_cn_suffix(digits):
        return f"{digits}.SH" if re.match(r"^[569]", digits) else f"{digits}.SZ"

    if re.fullmatch(r"\d{6}\.SS", value):
        return value.replace(".SS", ".SH")
    if re.fullmatch(r"\d{5}\.HK", value):
        return value
    if re.fullmatch(r"\d{6}\.(SH|SZ)", value):
        return normalize_cn_suffix(value[:6])
    if re.fullmatch(r"[A-Z][A-Z0-9.-]*", value):
        return value
    if re.fullmatch(r"\d{5}", value):
        return f"{value}.HK"
    if re.fullmatch(r"\d{6}", value):
        return normalize_cn_suffix(value)
    return value


def normalize_date(value):
    raw = str(value or "").strip()
    if not raw:
        return ""
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
        try:
            return datetime.strptime(raw, "%Y-%m-%d").date().isoformat()
        except ValueError:
            return ""
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return parsed.date().isoformat()
    except Exception:
        return ""


def today_label():
    return datetime.now(LOCAL_TZ).date().isoformat()


def utc_now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def market_from_symbol(symbol):
    value = normalize_symbol(symbol)
    if value.endswith(".HK"):
        return "HK"
    if value.endswith(".SH") or value.endswith(".SZ"):
        return "CN"
    return "US"


def infer_currency(symbol):
    market = market_from_symbol(symbol)
    if market == "HK":
        return "HKD"
    if market == "US":
        return "USD"
    return "CNY"


def normalize_currency(value, fallback="CNY"):
    currency = str(value or "").strip().upper()
    return currency if re.fullmatch(r"[A-Z]{3}", currency) else fallback


def resolve_fx(currency, rates):
    currency = normalize_currency(currency)
    if currency == "USD":
        return safe_float((rates or {}).get("USD"), DEFAULT_RATES["USD"])
    if currency == "HKD":
        return safe_float((rates or {}).get("HKD"), DEFAULT_RATES["HKD"])
    return 1.0


def parse_tax_rate(holding):
    raw = holding.get("taxRateOverride", holding.get("taxRate", ""))
    if raw in ("", None):
        return 0.0
    return min(1.0, max(0.0, safe_float(raw, 0.0) / 100))


def canonical_source_id(source_id):
    """归一化 sourceId 的金额段，用于跨端比对。

    前端 JS 拼整数金额得到 "1"，本脚本得到 "1.0"，直接比字符串会漏掉整数股息。
    只用于比对，不改动任何已存储的 sourceId。
    """
    raw = str(source_id or "").strip()
    parts = raw.split("|")
    if len(parts) != 4:
        return raw
    try:
        value = round_decimal(parts[2], 6)
    except (TypeError, ValueError):
        return raw
    amount = f"{value:.6f}".rstrip("0").rstrip(".") or "0"
    return "|".join([parts[0], parts[1], amount, parts[3]])


def dividend_ignore_key(source_id):
    """删除墓碑的匹配键：只取「股票 + 除息日」，不含金额。

    金额被数据源小幅修订会让完整 sourceId 变样，删掉的记录随即复活；
    除息日含年份，所以挡不到以后年份的同期派息。须与前端 dividendIgnoreKey 一致。
    """
    raw = str(source_id or "").strip()
    parts = raw.split("|")
    if len(parts) < 2 or not parts[0] or not parts[1]:
        return raw
    return f"{parts[0]}|{parts[1]}"


def build_source_id(symbol, ex_date, amount, currency):
    amount_key = f"{round_decimal(amount, 6):.6f}".rstrip("0").rstrip(".") or "0"
    return "|".join([
        normalize_symbol(symbol),
        normalize_date(ex_date),
        amount_key,
        normalize_currency(currency, ""),
    ])


def normalize_dividend_event(item, symbol):
    if not isinstance(item, dict):
        return None
    ex_date = normalize_date(item.get("exDate") or item.get("date"))
    amount = round_decimal(max(0.0, safe_float(item.get("amountPerShare"), 0.0)), 6)
    currency = normalize_currency(item.get("currency"), infer_currency(symbol))
    if not ex_date or amount <= 0:
        return None
    return {
        "sourceId": str(item.get("sourceId") or build_source_id(symbol, ex_date, amount, currency)).strip(),
        "symbol": normalize_symbol(item.get("symbol") or symbol),
        "exDate": ex_date,
        "payDate": normalize_date(item.get("payDate")),
        "amountPerShare": amount,
        "currency": currency,
        "source": str(item.get("source") or "unknown").strip() or "unknown",
        "status": str(item.get("status") or "").strip().lower(),
    }


def add_days(date_label, days):
    parsed = normalize_date(date_label)
    if not parsed:
        return ""
    date = datetime.strptime(parsed, "%Y-%m-%d").date()
    return (date + timedelta(days=int(days))).isoformat()


def resolve_effective_pay_date(ex_date, pay_date, symbol):
    real_pay = normalize_date(pay_date)
    if real_pay:
        return real_pay
    ex = normalize_date(ex_date)
    if not ex:
        return ""
    lag = PAYDATE_LAG_DAYS.get(market_from_symbol(symbol), 0)
    return add_days(ex, lag) if lag > 0 else ex


def normalize_holding(item, index=0):
    if not isinstance(item, dict):
        return None
    symbol = normalize_symbol(item.get("symbol"))
    if not symbol:
        return None
    quantity = max(0.0, safe_float(item.get("quantity", item.get("shares", 0.0)), 0.0))
    return {
        **item,
        "localId": int(safe_float(item.get("localId"), index + 1)),
        "symbol": symbol,
        "quantity": quantity,
        "shares": quantity,
        "bucket": "income" if item.get("bucket") == "income" else "core",
        "taxRateOverride": "" if item.get("taxRateOverride") is None else str(item.get("taxRateOverride", "")),
    }


def cash_flow_impact(entry):
    amount = abs(safe_float((entry or {}).get("amountCny"), 0.0))
    entry_type = str((entry or {}).get("type") or "").strip().lower()
    return -amount if entry_type in {"withdraw", "withdrawal", "out", "outflow"} else amount


def trade_impact(entry):
    entry = entry or {}
    value = safe_float(entry.get("shares", entry.get("quantity")), 0.0) * safe_float(entry.get("price"), 0.0) * safe_float(entry.get("fxRate"), 1.0)
    fee = max(0.0, safe_float(entry.get("feeCny"), 0.0))
    return value - fee if str(entry.get("side") or "").lower() == "sell" else -(value + fee)


def derive_legacy_current_cash(portfolio):
    opening_date = normalize_date(portfolio.get("openingDate"))
    if not opening_date:
        return None
    cash = safe_float(portfolio.get("openingCashCny"), 0.0)
    for entry in portfolio.get("cashFlows", []):
        if normalize_date((entry or {}).get("date")) >= opening_date:
            cash += cash_flow_impact(entry)
    for entry in portfolio.get("trades", []):
        if normalize_date((entry or {}).get("date")) >= opening_date:
            cash += trade_impact(entry)
    for entry in portfolio.get("dividendLedger", []):
        if not isinstance(entry, dict) or entry.get("confirmed") is not True:
            continue
        entry_date = normalize_date(entry.get("receivedDate") or entry.get("payDate") or entry.get("exDate"))
        if entry_date >= opening_date:
            cash += safe_float(entry.get("netCny"), 0.0)
    return round_money(cash)


def effective_holdings(portfolio):
    holdings = [copy.deepcopy(item) for item in portfolio.get("holdings", []) if isinstance(item, dict)]
    by_symbol = {item.get("symbol"): item for item in holdings if item.get("symbol")}
    opening_date = normalize_date(portfolio.get("positionOpeningDate"))
    if not opening_date:
        return holdings
    for trade in portfolio.get("trades", []):
        if not isinstance(trade, dict) or normalize_date(trade.get("date")) < opening_date:
            continue
        symbol = normalize_symbol(trade.get("symbol"))
        if not symbol:
            continue
        holding = by_symbol.get(symbol)
        if holding is None:
            holding = normalize_holding({"symbol": symbol, "quantity": 0, "bucket": trade.get("bucket")}, len(holdings))
            holdings.append(holding)
            by_symbol[symbol] = holding
        delta = max(0.0, safe_float(trade.get("shares", trade.get("quantity")), 0.0))
        if str(trade.get("side") or "").lower() == "sell":
            delta = -delta
        holding["quantity"] = max(0.0, safe_float(holding.get("quantity"), 0.0) + delta)
        holding["shares"] = holding["quantity"]
    return holdings


def normalize_snapshot(snapshot):
    result = copy.deepcopy(snapshot) if isinstance(snapshot, dict) else {}
    holdings = result.get("holdings")
    if not isinstance(holdings, list):
        holdings = result.get("positions") if isinstance(result.get("positions"), list) else []
    result["type"] = "portfolio-snapshot"
    result["version"] = max(5, int(safe_float(result.get("version"), 5)))
    result["holdings"] = [h for h in (normalize_holding(item, i) for i, item in enumerate(holdings)) if h]
    for key in ("dividendLedger", "dailySnapshots", "cashFlows", "yearlyManual", "yearlyArchives",
                "yearlyHoldings", "trades", "dividendLedgerIgnored", "dividendLedgerTombstones"):
        if not isinstance(result.get(key), list):
            result[key] = []
    tombstones = result.get("recordTombstones") if isinstance(result.get("recordTombstones"), dict) else {}
    result["recordTombstones"] = {
        "cashFlowIds": list(dict.fromkeys(str(item).strip() for item in tombstones.get("cashFlowIds", []) if str(item).strip())),
        "tradeIds": list(dict.fromkeys(str(item).strip() for item in tombstones.get("tradeIds", []) if str(item).strip())),
        "holdingSymbols": list(dict.fromkeys(normalize_symbol(item) for item in tombstones.get("holdingSymbols", []) if normalize_symbol(item))),
        "holdingDeletes": [item for item in tombstones.get("holdingDeletes", [])
                           if isinstance(item, dict) and normalize_symbol(item.get("symbol"))],
    }
    legacy_opening_date = normalize_date(result.get("openingDate"))
    result["positionOpeningDate"] = normalize_date(result.get("positionOpeningDate") or legacy_opening_date)
    if not result.get("positionOpeningDate") or result.get("positionOpeningDate") > today_label():
        trade_dates = sorted(filter(None, (normalize_date((entry or {}).get("date")) for entry in result.get("trades", []))))
        if trade_dates and (not result.get("positionOpeningDate") or trade_dates[0] < result["positionOpeningDate"]):
            result["positionOpeningDate"] = trade_dates[0]
    if "currentCashCny" not in result:
        result["currentCashCny"] = derive_legacy_current_cash(result)
    elif result.get("currentCashCny") is not None:
        result["currentCashCny"] = round_money(result.get("currentCashCny"))
    result["currentCashAsOfDate"] = "" if result.get("currentCashCny") is None else (normalize_date(result.get("currentCashAsOfDate")) or today_label())
    result.pop("openingCashCny", None)
    result.pop("openingDate", None)
    result["yearlyHoldings"] = [item for item in result.get("yearlyHoldings", [])
                                if isinstance(item, dict) and item.get("source") != "backfill"]
    return result


def _dividend_entry_priority(item):
    if item.get("confirmed") is True:
        return 5
    status = item.get("receiptStatus") or item.get("status")
    if status == "received":
        return 4
    if status == "announced" or item.get("isAnnounced") is True:
        return 3
    if status in {"pending", "due"}:
        return 2
    return 1


def _economic_priority(item):
    if item.get("confirmed") is True:
        return 100
    if item.get("confidence") == "manual":
        return 90
    if item.get("sharesSource") == "manual":
        return 80
    confidence_bonus = 3 if item.get("confidence") in {"snapshot", "replayed"} else (
        2 if item.get("confidence") == "carryForward" else 0)
    return _dividend_entry_priority(item) * 10 + confidence_bonus


def _economic_amount_cny(item, rates=None):
    gross = safe_float(item.get("grossCny"), 0.0)
    net = safe_float(item.get("netCny"), 0.0)
    if gross or net:
        return gross if gross else net
    return safe_float(item.get("amountPerShare"), 0.0) * resolve_fx(item.get("currency"), rates or DEFAULT_RATES)


def _economic_source(item):
    return str(item.get("eventSource") or item.get("source") or "").strip().lower()


def _economic_tolerance(left, right):
    return max(0.02, min(abs(left), abs(right)) * 0.005)


def _find_component_subset(items, target, rates):
    candidates = items[:12]
    if len(candidates) < 2:
        return None
    amounts = [_economic_amount_cny(item, rates) for item in candidates]
    best = None
    for mask in range(1, 1 << len(candidates)):
        indexes = [index for index in range(len(candidates)) if mask & (1 << index)]
        if len(indexes) < 2:
            continue
        total = sum(amounts[index] for index in indexes)
        if abs(total - target) > _economic_tolerance(total, target):
            continue
        if best is None or len(indexes) < len(best):
            best = indexes
    return best


def normalize_economic_entries(items, rates=None):
    """按经济事件折叠 sourceId 重复、等额替代和“汇总 = 多组件之和”的重复表示。"""
    exact = {}
    for item in items or []:
        if not isinstance(item, dict):
            continue
        key = canonical_source_id(item.get("sourceId"))
        if not key:
            key = f"{normalize_symbol(item.get('symbol'))}|{normalize_date(item.get('exDate'))}|{id(item)}"
        previous = exact.get(key)
        if previous is None or _economic_priority(item) > _economic_priority(previous):
            exact[key] = item

    groups = {}
    for item in exact.values():
        key = f"{normalize_symbol(item.get('symbol'))}|{normalize_date(item.get('exDate'))}"
        groups.setdefault(key, []).append(item)

    result = []
    for group in groups.values():
        unique = []
        for item in group:
            amount = _economic_amount_cny(item, rates)
            same_index = next((i for i, other in enumerate(unique)
                               if abs(_economic_amount_cny(other, rates) - amount)
                               <= _economic_tolerance(_economic_amount_cny(other, rates), amount)), None)
            if same_index is None:
                unique.append(item)
            elif _economic_priority(item) > _economic_priority(unique[same_index]):
                unique[same_index] = item
        pending = sorted(unique, key=lambda item: _economic_amount_cny(item, rates), reverse=True)
        while pending:
            aggregate = pending.pop(0)
            subset = _find_component_subset(pending, _economic_amount_cny(aggregate, rates), rates)
            aggregate_source = _economic_source(aggregate)
            cross_source = subset is not None and aggregate_source and all(
                _economic_source(pending[index]) and _economic_source(pending[index]) != aggregate_source
                for index in subset)
            if subset is None or not cross_source:
                result.append(aggregate)
                continue
            components = [pending[i] for i in subset]
            confirmed_components = [item for item in components if item.get("confirmed") is True]
            result.extend([aggregate] if aggregate.get("confirmed") is True or not confirmed_components else components)
            for index in sorted(subset, reverse=True):
                pending.pop(index)
    return result


def build_today_snapshot(portfolio, market, today):
    rates = {**DEFAULT_RATES, **(portfolio.get("rates") or {}), **(market.get("rates") or {})}
    quotes = market.get("quotes") or {}
    total = 0.0
    holdings = []
    for holding in effective_holdings(portfolio):
        symbol = holding["symbol"]
        quote = quotes.get(symbol) or {}
        currency = normalize_currency(quote.get("currency"), infer_currency(symbol))
        shares = max(0.0, safe_float(holding.get("quantity", holding.get("shares", 0.0)), 0.0))
        price = max(0.0, safe_float(quote.get("price"), 0.0))
        fx = resolve_fx(currency, rates)
        total += price * shares * fx
        holdings.append({
            "symbol": symbol,
            "shares": shares,
            "bucket": "income" if holding.get("bucket") == "income" else "core",
            "taxRate": parse_tax_rate(holding),
        })
    liability = max(0.0, safe_float(portfolio.get("liabilityCny"), 0.0))
    current_cash = safe_float(portfolio.get("currentCashCny"), 0.0) if portfolio.get("currentCashCny") is not None else 0.0
    return {
        "date": today,
        "rates": {"CNY": 1, "USD": rates["USD"], "HKD": rates["HKD"]},
        "netCny": round_money(total + current_cash - liability),
        "totalMarketValueCny": round_money(total),
        "liabilityCny": liability,
        "cashCny": round_money(current_cash) if portfolio.get("currentCashCny") is not None else None,
        "cashModelActive": portfolio.get("currentCashCny") is not None,
        "holdings": holdings,
    }


def find_snapshot_before(portfolio, date_label):
    target = normalize_date(date_label)
    if not target:
        return None
    candidates = [
        item for item in portfolio.get("dailySnapshots", [])
        if isinstance(item, dict) and normalize_date(item.get("date")) < target
    ]
    candidates.sort(key=lambda item: normalize_date(item.get("date")), reverse=True)
    return candidates[0] if candidates else None


def dividend_context(portfolio, symbol, ex_date, currency):
    snapshot = find_snapshot_before(portfolio, ex_date)
    if snapshot:
        holding = next((item for item in snapshot.get("holdings", []) if normalize_symbol(item.get("symbol")) == symbol), None)
        shares = max(0.0, safe_float((holding or {}).get("shares"), 0.0))
        snapshot_date = normalize_date(snapshot.get("date"))
        for trade in portfolio.get("trades", []):
            trade_date = normalize_date((trade or {}).get("date"))
            if normalize_symbol((trade or {}).get("symbol")) != symbol or not (snapshot_date < trade_date < ex_date):
                continue
            delta = max(0.0, safe_float((trade or {}).get("shares", (trade or {}).get("quantity")), 0.0))
            shares += -delta if str((trade or {}).get("side") or "").lower() == "sell" else delta
        if shares <= 0:
            return None
        return {
            "shares": max(0.0, shares),
            "sharesSource": "snapshotReplay",
            "fxRate": resolve_fx(currency, snapshot.get("rates") or {}),
            "taxRate": min(1.0, max(0.0, safe_float((holding or {}).get("taxRate"), 0.0))),
            "bucket": "income" if (holding or {}).get("bucket") == "income" else "core",
            "confidence": "snapshot" if add_days(snapshot_date, 1) == normalize_date(ex_date) else "replayed",
        }

    opening_date = normalize_date(portfolio.get("positionOpeningDate"))
    if not opening_date or normalize_date(ex_date) < opening_date:
        return None
    holding = next((item for item in portfolio.get("holdings", []) if normalize_symbol(item.get("symbol")) == symbol), None)
    if not holding:
        return None
    shares = max(0.0, safe_float(holding.get("quantity", holding.get("shares", 0.0)), 0.0))
    for trade in portfolio.get("trades", []):
        trade_date = normalize_date((trade or {}).get("date"))
        if normalize_symbol((trade or {}).get("symbol")) != symbol or not (opening_date <= trade_date < ex_date):
            continue
        delta = max(0.0, safe_float((trade or {}).get("shares", (trade or {}).get("quantity")), 0.0))
        shares += -delta if str((trade or {}).get("side") or "").lower() == "sell" else delta
    if shares <= 0:
        return None
    rates = portfolio.get("rates") or DEFAULT_RATES
    return {
        "shares": max(0.0, shares),
        "sharesSource": "positionLedger",
        "fxRate": resolve_fx(currency, rates),
        "taxRate": parse_tax_rate(holding),
        "bucket": "income" if holding.get("bucket") == "income" else "core",
        "confidence": "replayed",
    }


def should_preserve_ledger_entry(entry):
    return (
        entry.get("confirmed") is True
        or entry.get("sharesSource") == "manual"
        or entry.get("confidence") == "manual"
    )


def reconcile_ledger(portfolio, market):
    quotes = market.get("quotes") or {}
    valid_by_symbol = {}
    for symbol, quote in quotes.items():
        events = [normalize_dividend_event(item, symbol) for item in quote.get("dividends") or []]
        events = [event for event in events if event]
        ids = {canonical_source_id(event["sourceId"]) for event in events}
        ex_dates = [event["exDate"] for event in events if event.get("exDate")]
        if ids:
            valid_by_symbol[normalize_symbol(symbol)] = {"ids": ids, "minExDate": min(ex_dates) if ex_dates else ""}

    kept = []
    removed = 0
    for entry in portfolio.get("dividendLedger", []):
        if not isinstance(entry, dict):
            removed += 1
            continue
        symbol = normalize_symbol(entry.get("symbol"))
        valid = valid_by_symbol.get(symbol)
        if should_preserve_ledger_entry(entry) or not valid:
            kept.append(entry)
            continue
        source_id = canonical_source_id(entry.get("sourceId"))
        ex_date = normalize_date(entry.get("exDate"))
        if source_id in valid["ids"] or (ex_date and valid["minExDate"] and ex_date < valid["minExDate"]):
            kept.append(entry)
        else:
            removed += 1
    portfolio["dividendLedger"] = kept
    return removed


def ledger_net_cny(entry):
    net = safe_float((entry or {}).get("netCny"), 0.0)
    if net > 0:
        return net
    gross = safe_float((entry or {}).get("grossCny"), 0.0)
    if not gross:
        gross = (safe_float((entry or {}).get("amountPerShare"), 0.0)
                 * safe_float((entry or {}).get("shares"), 0.0)
                 * safe_float((entry or {}).get("fxRate"), 1.0))
    tax = min(1.0, max(0.0, safe_float((entry or {}).get("taxRate"), 0.0)))
    return round_money(gross * (1 - tax))


def ledger_calendar_date(entry):
    received = normalize_date((entry or {}).get("receivedDate"))
    return received or resolve_effective_pay_date(
        (entry or {}).get("exDate"), (entry or {}).get("payDate"), (entry or {}).get("symbol"))


def cash_flow_net(entry):
    amount = abs(safe_float((entry or {}).get("amountCny"), 0.0))
    kind = str((entry or {}).get("type") or "").strip().lower()
    return -amount if kind in {"withdraw", "withdrawal", "out", "outflow"} else amount


def rebuild_completed_year_archives(portfolio, today):
    current_year = int(today[:4])
    snapshots = {}
    for snapshot in portfolio.get("dailySnapshots", []):
        date = normalize_date((snapshot or {}).get("date"))
        if not date:
            continue
        year = int(date[:4])
        if year not in snapshots or date > snapshots[year]["date"]:
            snapshots[year] = {"date": date, "netCny": round_money((snapshot or {}).get("netCny"))}

    dividends = {}
    ledger_years = set()
    for entry in normalize_economic_entries(portfolio.get("dividendLedger", []), portfolio.get("rates")):
        date = ledger_calendar_date(entry)
        if date:
            ledger_years.add(int(date[:4]))
        if entry.get("confirmed") is not True:
            continue
        if date:
            dividends[int(date[:4])] = dividends.get(int(date[:4]), 0.0) + ledger_net_cny(entry)

    inflows = {}
    flow_counts = {}
    for entry in portfolio.get("cashFlows", []):
        date = normalize_date((entry or {}).get("date"))
        if not date:
            continue
        year = int(date[:4])
        inflows[year] = inflows.get(year, 0.0) + cash_flow_net(entry)
        flow_counts[year] = flow_counts.get(year, 0) + 1

    existing = {int(item.get("year")): item for item in portfolio.get("yearlyArchives", [])
                if isinstance(item, dict) and int(safe_float(item.get("year"), 0)) > 0}
    ignored_years = set()
    tombstoned_sources = set()
    for item in portfolio.get("dividendLedgerTombstones", []):
        if not isinstance(item, dict):
            continue
        source_id = str(item.get("sourceId") or "").strip()
        if source_id:
            tombstoned_sources.add(source_id)
        date = normalize_date(item.get("incomeDate"))
        if date:
            ignored_years.add(int(date[:4]))
    for source_id in portfolio.get("dividendLedgerIgnored", []):
        if str(source_id or "").strip() in tombstoned_sources:
            continue
        parts = str(source_id or "").split("|")
        date = normalize_date(parts[1] if len(parts) > 1 else "")
        if date:
            ignored_years.add(int(date[:4]))
    years = sorted(set(snapshots) | set(dividends) | set(inflows) | set(existing))
    rebuilt = []
    now_iso = utc_now_iso()
    for year in years:
        if year >= current_year:
            continue
        previous = existing.get(year) or {}
        end_net = snapshots.get(year, {}).get("netCny")
        if end_net is None:
            end_net = previous.get("yearEndNetCny")
        start_net = snapshots.get(year - 1, {}).get("netCny")
        if start_net is None:
            start_net = (existing.get(year - 1) or {}).get("yearEndNetCny")
        dividend_has_source = year in ledger_years or year in ignored_years
        dividend = round_money(dividends.get(year, 0.0)) if dividend_has_source else previous.get("dividendCny", 0.0)
        net_inflow = round_money(inflows.get(year, 0.0)) if flow_counts.get(year) else previous.get("netInflowCny", 0.0)
        if end_net is None and not dividend and not net_inflow:
            continue
        capital_has_source = end_net is not None and start_net is not None and (year in snapshots or year - 1 in snapshots or flow_counts.get(year))
        capital = round_money(end_net - start_net - net_inflow) if capital_has_source else previous.get("capitalReturnCny")
        base = start_net if start_net is not None and start_net > 0 else None
        candidate = {
            "year": year,
            "dividendCny": dividend,
            "dividendYieldRate": dividend / base if dividend_has_source and base else previous.get("dividendYieldRate"),
            "yearEndNetCny": end_net,
            "netInflowCny": net_inflow,
            "capitalReturnCny": capital,
            "capitalReturnRate": capital / base if capital_has_source and capital is not None and base else previous.get("capitalReturnRate"),
            "archivedAt": (existing.get(year) or {}).get("archivedAt") or now_iso,
            "source": "auto",
        }
        rebuilt.append(candidate)
    rebuilt.sort(key=lambda item: item["year"], reverse=True)
    changed = rebuilt != portfolio.get("yearlyArchives", [])
    portfolio["yearlyArchives"] = rebuilt
    return changed


def upsert_current_year_holdings(portfolio, market, today):
    year = int(today[:4])
    rates = portfolio.get("rates") or DEFAULT_RATES
    quotes = market.get("quotes") or {}
    holdings = []
    for item in effective_holdings(portfolio):
        shares = max(0.0, safe_float(item.get("quantity", item.get("shares")), 0.0))
        if shares <= 0:
            continue
        symbol = normalize_symbol(item.get("symbol"))
        quote = quotes.get(symbol) or {}
        price = max(0.0, safe_float(quote.get("price"), 0.0))
        currency = normalize_currency(quote.get("currency"), infer_currency(symbol))
        holdings.append({
            "symbol": symbol,
            "name": str(quote.get("name") or symbol),
            "shares": shares,
            "bucket": "income" if item.get("bucket") == "income" else "core",
            "currency": currency,
            "price": price,
            "marketValueCny": round_money(price * shares * resolve_fx(currency, rates)),
        })
    candidate = {
        "year": year,
        "date": today,
        "source": "auto",
        "totalMarketValueCny": round_money(sum(item["marketValueCny"] for item in holdings)),
        "holdings": holdings,
    }
    previous = next((item for item in portfolio.get("yearlyHoldings", [])
                     if isinstance(item, dict) and int(safe_float(item.get("year"), 0)) == year), None)
    if previous == candidate:
        return False
    portfolio["yearlyHoldings"] = [item for item in portfolio.get("yearlyHoldings", [])
                                   if not isinstance(item, dict) or int(safe_float(item.get("year"), 0)) != year]
    portfolio["yearlyHoldings"].append(candidate)
    portfolio["yearlyHoldings"].sort(key=lambda item: int(safe_float(item.get("year"), 0)), reverse=True)
    return True


def settle_portfolio(portfolio, market, today):
    portfolio = normalize_snapshot(portfolio)
    portfolio["rates"] = {**DEFAULT_RATES, **(portfolio.get("rates") or {}), **(market.get("rates") or {})}
    changed = False
    stats = {
        "snapshotAdded": False, "ledgerAdded": 0, "ledgerUpdated": 0, "ledgerRemoved": 0,
        "archivesRebuilt": False, "yearlyHoldingsUpdated": False,
    }

    today_snapshot = build_today_snapshot(portfolio, market, today)
    previous_today = next((item for item in portfolio.get("dailySnapshots", [])
                           if isinstance(item, dict) and normalize_date(item.get("date")) == today), None)
    if previous_today != today_snapshot:
        portfolio["dailySnapshots"] = [item for item in portfolio.get("dailySnapshots", [])
                                       if not isinstance(item, dict) or normalize_date(item.get("date")) != today]
        portfolio["dailySnapshots"].append(today_snapshot)
        portfolio["dailySnapshots"].sort(key=lambda item: normalize_date(item.get("date")))
        changed = True
        stats["snapshotAdded"] = True

    removed = reconcile_ledger(portfolio, market)
    if removed:
        changed = True
        stats["ledgerRemoved"] = removed

    relevant = {holding["symbol"] for holding in effective_holdings(portfolio) if holding.get("quantity", 0) > 0}
    for snapshot in portfolio.get("dailySnapshots", []):
        for holding in snapshot.get("holdings", []) if isinstance(snapshot, dict) else []:
            if safe_float(holding.get("shares"), 0.0) > 0:
                relevant.add(normalize_symbol(holding.get("symbol")))

    # 一律用 canonical ID 建索引：台账里可能混有前端写的 "1" 和本脚本写的 "1.0"，
    # 按原字符串查找会认不出同一笔派息，于是又追加一条，造成重复计账。
    existing_by_id = {
        canonical_source_id(entry.get("sourceId")): entry
        for entry in portfolio.get("dividendLedger", []) if isinstance(entry, dict) and entry.get("sourceId")
    }
    existing_ids = set(existing_by_id)
    # 用户在 App 里手动删掉的派息事件，这里也不能重建，否则删除会被云端结算还原。
    ignored_ids = {
        dividend_ignore_key(item)
        for item in (portfolio.get("dividendLedgerIgnored") or [])
        if str(item or "").strip()
    }
    quotes = market.get("quotes") or {}
    now_iso = utc_now_iso()
    for symbol in sorted(relevant):
        quote = quotes.get(symbol) or {}
        events = [normalize_dividend_event(raw_event, symbol) for raw_event in quote.get("dividends") or []]
        events = normalize_economic_entries([event for event in events if event], portfolio.get("rates"))
        for event in events:
            if not event or event["exDate"] > today:
                continue
            if dividend_ignore_key(event["sourceId"]) in ignored_ids:
                continue
            existing = existing_by_id.get(canonical_source_id(event["sourceId"]))
            if existing:
                if existing.get("confidence") == "manual":
                    continue
                user_pay_date = existing.get("payDateSource") == "manual"
                next_pay = normalize_date(existing.get("payDate")) if user_pay_date else (event.get("payDate") or normalize_date(existing.get("payDate")))
                effective_pay = resolve_effective_pay_date(event["exDate"], next_pay, event["symbol"])
                next_status = "received" if existing.get("confirmed") is True else ("due" if effective_pay and effective_pay <= today else "pending")
                next_source = existing.get("eventSource") if user_pay_date else event.get("source")
                if next_pay != normalize_date(existing.get("payDate")) or next_status != existing.get("receiptStatus") or next_source != existing.get("eventSource"):
                    existing["payDate"] = next_pay
                    existing["receiptStatus"] = next_status
                    existing["eventSource"] = next_source
                    existing["updatedAt"] = now_iso
                    stats["ledgerUpdated"] += 1
                    changed = True
                continue
            context = dividend_context(portfolio, event["symbol"], event["exDate"], event["currency"])
            if not context:
                continue
            gross = round_money(event["amountPerShare"] * context["shares"] * context["fxRate"])
            net = round_money(gross * (1 - context["taxRate"]))
            pay_date = event["payDate"]
            effective_pay = resolve_effective_pay_date(event["exDate"], pay_date, event["symbol"])
            source_id = event["sourceId"]
            suffix = re.sub(r"[^A-Z0-9]+", "_", source_id, flags=re.I).strip("_") or str(len(existing_ids) + 1)
            portfolio["dividendLedger"].append({
                "id": f"div_{suffix}",
                "sourceId": source_id,
                "symbol": event["symbol"],
                "exDate": event["exDate"],
                "payDate": pay_date,
                "amountPerShare": event["amountPerShare"],
                "currency": event["currency"],
                "shares": context["shares"],
                "sharesSource": context["sharesSource"],
                "fxRate": context["fxRate"],
                "taxRate": context["taxRate"],
                "grossCny": gross,
                "netCny": net,
                "bucket": context["bucket"],
                "receiptStatus": "due" if effective_pay and effective_pay <= today else "pending",
                "eventSource": event.get("source"),
                "confidence": context["confidence"],
                "confirmed": False,
                "note": "",
                "createdAt": now_iso,
                "updatedAt": now_iso,
            })
            existing_ids.add(canonical_source_id(source_id))
            stats["ledgerAdded"] += 1
            changed = True

    normalized_ledger = normalize_economic_entries(portfolio.get("dividendLedger", []), portfolio.get("rates"))
    if len(normalized_ledger) != len(portfolio.get("dividendLedger", [])):
        stats["ledgerRemoved"] += len(portfolio.get("dividendLedger", [])) - len(normalized_ledger)
        portfolio["dividendLedger"] = normalized_ledger
        changed = True

    if rebuild_completed_year_archives(portfolio, today):
        stats["archivesRebuilt"] = True
        changed = True
    if upsert_current_year_holdings(portfolio, market, today):
        stats["yearlyHoldingsUpdated"] = True
        changed = True

    if changed:
        portfolio["dividendLedger"].sort(key=lambda item: f"{normalize_date(item.get('exDate'))}|{item.get('symbol', '')}")
        portfolio["updatedAt"] = now_iso
    return portfolio, changed, stats


def load_json_file(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def write_json_file(path, payload):
    Path(path).write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_json_url(url, token=""):
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    response = requests.get(url, headers=headers, timeout=30)
    response.raise_for_status()
    return response.json()


def github_headers(token):
    return {"Accept": "application/vnd.github+json", "Authorization": f"Bearer {token}"}


def fetch_github_json(repo, path, token):
    response = requests.get(f"https://api.github.com/repos/{repo}/contents/{path}", headers=github_headers(token), timeout=30)
    response.raise_for_status()
    entry = response.json()
    content = base64.b64decode(str(entry.get("content", "")).replace("\n", "")).decode("utf-8")
    return json.loads(content), entry.get("sha")


def save_github_json(repo, path, token, payload, sha, message):
    body = {
        "message": message,
        "content": base64.b64encode((json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8")).decode("ascii"),
    }
    if sha:
        body["sha"] = sha
    response = requests.put(
        f"https://api.github.com/repos/{repo}/contents/{path}",
        headers={**github_headers(token), "Content-Type": "application/json"},
        data=json.dumps(body),
        timeout=30,
    )
    response.raise_for_status()
    return response.json()


def parse_args():
    parser = argparse.ArgumentParser(description="Settle private portfolio snapshots and dividend ledger.")
    parser.add_argument("--portfolio", default="")
    parser.add_argument("--output", default="")
    parser.add_argument("--market", default="data/market.json")
    parser.add_argument("--market-url", default="")
    parser.add_argument("--github-repo", default="")
    parser.add_argument("--github-path", default="data/portfolio.json")
    parser.add_argument("--token-env", default="GITHUB_TOKEN")
    parser.add_argument("--today", default=today_label())
    return parser.parse_args()


def main():
    args = parse_args()
    token = os.environ.get(args.token_env, "").strip()

    if args.github_repo:
        if not token:
            raise RuntimeError(f"{args.token_env} is required for --github-repo")
        portfolio, sha = fetch_github_json(args.github_repo, args.github_path, token)
    else:
        if not args.portfolio:
            raise RuntimeError("--portfolio is required without --github-repo")
        portfolio = load_json_file(args.portfolio)
        sha = None

    market = load_json_url(args.market_url, token if args.market_url.startswith("https://api.github.com/") else "") if args.market_url else load_json_file(args.market)
    settled, changed, stats = settle_portfolio(portfolio, market, normalize_date(args.today) or today_label())

    if args.github_repo:
        if changed:
            save_github_json(args.github_repo, args.github_path, token, settled, sha, "chore: settle portfolio revenue")
    else:
        output = args.output or args.portfolio
        if changed:
            write_json_file(output, settled)

    print(json.dumps({"changed": changed, **stats}, ensure_ascii=False))


if __name__ == "__main__":
    main()
