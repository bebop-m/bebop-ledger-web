import argparse
import base64
import copy
import json
import math
import os
import re
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


def round_money(value):
    return round(safe_float(value, 0.0) + 1e-9, 2)


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
        return raw
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
    return max(0.0, safe_float(raw, 0.0) / 100)


def build_source_id(symbol, ex_date, amount, currency):
    return "|".join([
        normalize_symbol(symbol),
        normalize_date(ex_date),
        str(round(safe_float(amount, 0.0), 6)),
        normalize_currency(currency, ""),
    ])


def normalize_dividend_event(item, symbol):
    if not isinstance(item, dict):
        return None
    ex_date = normalize_date(item.get("exDate") or item.get("date"))
    amount = round(max(0.0, safe_float(item.get("amountPerShare"), 0.0)), 6)
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
    result["version"] = max(4, int(safe_float(result.get("version"), 4)))
    result["holdings"] = [h for h in (normalize_holding(item, i) for i, item in enumerate(holdings)) if h]
    for key in ("dividendLedger", "dailySnapshots", "cashFlows", "yearlyManual", "yearlyArchives", "yearlyHoldings", "trades"):
        if not isinstance(result.get(key), list):
            result[key] = []
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
        "holdings": holdings,
    }


def find_snapshot_on_or_before(portfolio, date_label):
    target = normalize_date(date_label)
    if not target:
        return None
    candidates = [
        item for item in portfolio.get("dailySnapshots", [])
        if isinstance(item, dict) and normalize_date(item.get("date")) <= target
    ]
    candidates.sort(key=lambda item: normalize_date(item.get("date")), reverse=True)
    return candidates[0] if candidates else None


def dividend_context(portfolio, symbol, ex_date, currency):
    snapshot = find_snapshot_on_or_before(portfolio, ex_date)
    if snapshot:
        holding = next((item for item in snapshot.get("holdings", []) if normalize_symbol(item.get("symbol")) == symbol), None)
        if not holding or safe_float(holding.get("shares"), 0.0) <= 0:
            return None
        return {
            "shares": max(0.0, safe_float(holding.get("shares"), 0.0)),
            "sharesSource": "snapshot",
            "fxRate": resolve_fx(currency, snapshot.get("rates") or {}),
            "taxRate": max(0.0, safe_float(holding.get("taxRate"), 0.0)),
            "bucket": "income" if holding.get("bucket") == "income" else "core",
            "confidence": "snapshot" if normalize_date(snapshot.get("date")) == normalize_date(ex_date) else "carryForward",
        }

    holding = next((item for item in effective_holdings(portfolio) if item.get("symbol") == symbol), None)
    if not holding or safe_float(holding.get("quantity", holding.get("shares", 0.0)), 0.0) <= 0:
        return None
    rates = portfolio.get("rates") or DEFAULT_RATES
    return {
        "shares": max(0.0, safe_float(holding.get("quantity", holding.get("shares", 0.0)), 0.0)),
        "sharesSource": "current",
        "fxRate": resolve_fx(currency, rates),
        "taxRate": parse_tax_rate(holding),
        "bucket": "income" if holding.get("bucket") == "income" else "core",
        "confidence": "estimated",
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
        ids = {event["sourceId"] for event in events}
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
        source_id = str(entry.get("sourceId") or "").strip()
        ex_date = normalize_date(entry.get("exDate"))
        if source_id in valid["ids"] or (ex_date and valid["minExDate"] and ex_date < valid["minExDate"]):
            kept.append(entry)
        else:
            removed += 1
    portfolio["dividendLedger"] = kept
    return removed


def settle_portfolio(portfolio, market, today):
    portfolio = normalize_snapshot(portfolio)
    changed = False
    stats = {"snapshotAdded": False, "ledgerAdded": 0, "ledgerUpdated": 0, "ledgerRemoved": 0}

    if not any(normalize_date(item.get("date")) == today for item in portfolio.get("dailySnapshots", []) if isinstance(item, dict)):
        portfolio["dailySnapshots"].append(build_today_snapshot(portfolio, market, today))
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

    existing_by_id = {
        str(entry.get("sourceId") or ""): entry
        for entry in portfolio.get("dividendLedger", []) if isinstance(entry, dict) and entry.get("sourceId")
    }
    existing_ids = set(existing_by_id)
    quotes = market.get("quotes") or {}
    now_iso = utc_now_iso()
    for symbol in sorted(relevant):
        quote = quotes.get(symbol) or {}
        for raw_event in quote.get("dividends") or []:
            event = normalize_dividend_event(raw_event, symbol)
            if not event or event["exDate"] > today:
                continue
            existing = existing_by_id.get(event["sourceId"])
            if existing:
                if existing.get("confidence") == "manual":
                    continue
                next_pay = event.get("payDate") or normalize_date(existing.get("payDate"))
                effective_pay = resolve_effective_pay_date(event["exDate"], next_pay, event["symbol"])
                next_status = "received" if existing.get("confirmed") is True else ("due" if effective_pay and effective_pay <= today else "pending")
                if next_pay != normalize_date(existing.get("payDate")) or next_status != existing.get("receiptStatus") or event.get("source") != existing.get("eventSource"):
                    existing["payDate"] = next_pay
                    existing["receiptStatus"] = next_status
                    existing["eventSource"] = event.get("source")
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
            existing_ids.add(source_id)
            stats["ledgerAdded"] += 1
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
