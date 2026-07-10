"""Fetch per-company yearly fundamentals into data/fundamentals.json.

For every symbol in the portfolio/watchlist universe, pulls from yfinance:
  - dividends per share summed by calendar year (long history, trading currency)
  - Basic/Diluted EPS and Net Income from annual income statements
  - Total Assets / Total Liabilities from annual balance sheets (debt ratio)
  - Cash Dividends Paid from annual cash-flow statements (payout ratio vs net income)

Annual statements only cover ~4-5 fiscal years on Yahoo; dividend history is longer.
ETFs and symbols without financials degrade gracefully to dividend-only rows.
"""

import json
from datetime import datetime, timezone
from pathlib import Path

import yfinance as yf

from update_market_data import (
    infer_market_currency,
    load_symbol_universe,
    normalize_date_string,
    parse_date_value,
    safe_float,
    to_yfinance_symbol,
    utc_now_iso,
)

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT / 'data' / 'fundamentals.json'

# Keep at most this many yearly rows per company (dividend history can be long).
MAX_YEARS = 12

INCOME_EPS_KEYS = ('Basic EPS', 'Diluted EPS')
INCOME_NET_KEYS = ('Net Income', 'Net Income Common Stockholders')
BALANCE_ASSET_KEYS = ('Total Assets',)
BALANCE_LIABILITY_KEYS = (
    'Total Liabilities Net Minority Interest',
    'Total Liabilities',
)
CASHFLOW_DIVIDEND_KEYS = (
    'Cash Dividends Paid',
    'Common Stock Dividend Paid',
)


def frame_rows(frame):
    """DataFrame -> {row_label: {year: value}} with only finite values."""
    result = {}
    if frame is None:
        return result
    try:
        if frame.empty:
            return result
    except Exception:
        return result
    for label, series in frame.iterrows():
        row = {}
        for column, raw in series.items():
            year_dt = parse_date_value(column)
            if year_dt is None:
                continue
            value = safe_float(raw, None)
            if value is None:
                continue
            row[year_dt.year] = value
        if row:
            result[str(label)] = row
    return result


def pick_row(rows, keys):
    for key in keys:
        if key in rows:
            return rows[key]
    return {}


def dividends_by_year(ticker):
    totals = {}
    last_ex = {}
    try:
        series = ticker.dividends
    except Exception as error:
        print(f'dividend history failed: {error}')
        return totals, last_ex
    if series is None:
        return totals, last_ex
    try:
        items = list(series.items())
    except Exception:
        return totals, last_ex
    for index_value, raw_value in items:
        amount = safe_float(raw_value, 0.0)
        event_dt = parse_date_value(index_value)
        if amount <= 0 or event_dt is None:
            continue
        year = event_dt.year
        totals[year] = round(totals.get(year, 0.0) + amount, 6)
        label = normalize_date_string(index_value)
        if label and label > last_ex.get(year, ''):
            last_ex[year] = label
    return totals, last_ex


def resolve_name(ticker, symbol):
    try:
        info = ticker.get_info()
        if isinstance(info, dict):
            for key in ('shortName', 'longName', 'displayName'):
                value = str(info.get(key) or '').strip()
                if value:
                    return value
    except Exception:
        pass
    return symbol


def build_company(symbol):
    yf_symbol = to_yfinance_symbol(symbol)
    ticker = yf.Ticker(yf_symbol)
    _, trade_currency = infer_market_currency(symbol)

    dps_by_year, last_ex_by_year = dividends_by_year(ticker)

    income = {}
    balance = {}
    cashflow = {}
    try:
        income = frame_rows(ticker.income_stmt)
    except Exception as error:
        print(f'income statement failed for {symbol}: {error}')
    try:
        balance = frame_rows(ticker.balance_sheet)
    except Exception as error:
        print(f'balance sheet failed for {symbol}: {error}')
    try:
        cashflow = frame_rows(ticker.cashflow)
    except Exception as error:
        print(f'cash flow failed for {symbol}: {error}')

    eps_row = pick_row(income, INCOME_EPS_KEYS)
    net_income_row = pick_row(income, INCOME_NET_KEYS)
    assets_row = pick_row(balance, BALANCE_ASSET_KEYS)
    liabilities_row = pick_row(balance, BALANCE_LIABILITY_KEYS)
    dividends_paid_row = pick_row(cashflow, CASHFLOW_DIVIDEND_KEYS)

    statement_currency = ''
    try:
        info = ticker.get_info()
        if isinstance(info, dict):
            statement_currency = str(info.get('financialCurrency') or '').strip().upper()
    except Exception:
        pass

    years = set(dps_by_year) | set(eps_row) | set(net_income_row) | set(assets_row) | set(liabilities_row)
    current_year = datetime.now(timezone.utc).year
    years = sorted(year for year in years if 1990 <= year <= current_year)[-MAX_YEARS:]
    if not years:
        return None

    rows = []
    for year in years:
        dps = round(max(0.0, safe_float(dps_by_year.get(year), 0.0)), 6)
        eps = safe_float(eps_row.get(year), None)
        net_income = safe_float(net_income_row.get(year), None)
        assets = safe_float(assets_row.get(year), None)
        liabilities = safe_float(liabilities_row.get(year), None)
        dividends_paid = safe_float(dividends_paid_row.get(year), None)

        payout_ratio = None
        if dividends_paid is not None and net_income is not None and net_income > 0:
            payout_ratio = round(abs(dividends_paid) / net_income, 4)
        elif dps > 0 and eps is not None and eps > 0 and (not statement_currency or statement_currency == trade_currency):
            # Fallback only when the DPS currency matches the reporting currency.
            payout_ratio = round(dps / eps, 4)

        debt_ratio = None
        if assets is not None and assets > 0 and liabilities is not None:
            debt_ratio = round(liabilities / assets, 4)

        row = {'year': year}
        if dps > 0:
            row['dividendPerShare'] = dps
        if last_ex_by_year.get(year):
            row['lastExDate'] = last_ex_by_year[year]
        if eps is not None:
            row['eps'] = round(eps, 4)
        if net_income is not None:
            row['netIncome'] = round(net_income, 2)
        if dividends_paid is not None:
            row['dividendsPaid'] = round(abs(dividends_paid), 2)
        if payout_ratio is not None:
            row['payoutRatio'] = payout_ratio
        if debt_ratio is not None:
            row['debtRatio'] = debt_ratio
        if len(row) > 1:
            rows.append(row)

    if not rows:
        return None

    return {
        'symbol': symbol,
        'name': resolve_name(ticker, symbol),
        'currency': trade_currency,
        'statementCurrency': statement_currency or trade_currency,
        'years': rows,
    }


def load_previous():
    if not OUTPUT_PATH.exists():
        return {}
    try:
        payload = json.loads(OUTPUT_PATH.read_text(encoding='utf-8-sig'))
        companies = payload.get('companies')
        return companies if isinstance(companies, dict) else {}
    except Exception:
        return {}


def main():
    symbols = load_symbol_universe()
    previous = load_previous()
    companies = {}
    for symbol in symbols:
        try:
            company = build_company(symbol)
        except Exception as error:
            print(f'fundamentals failed for {symbol}: {error}')
            company = None
        if company:
            companies[symbol] = company
            print(f'fundamentals ok for {symbol}: {len(company["years"])} years')
        elif symbol in previous:
            companies[symbol] = previous[symbol]
            print(f'fundamentals kept from cache for {symbol}')
        else:
            print(f'fundamentals empty for {symbol}')

    payload = {
        'ok': True,
        'provider': 'yfinance',
        'updatedAt': utc_now_iso(),
        'companies': companies,
    }
    OUTPUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'updated {len(companies)} companies into {OUTPUT_PATH}')


if __name__ == '__main__':
    main()
