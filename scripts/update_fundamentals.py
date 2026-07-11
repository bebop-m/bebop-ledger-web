"""Fetch per-company yearly fundamentals into data/fundamentals.json.

For every symbol in the portfolio/watchlist universe, pulls from yfinance:
  - dividends per share summed by calendar year (long history, trading currency),
    with a heuristic split of special dividends (payments far above the company's
    recent payout pattern)
  - Basic/Diluted EPS and Net Income from annual income statements
  - Total Assets / Total Liabilities from annual balance sheets (debt ratio)
  - Stockholders Equity (ROE) and Ordinary Shares Number (share-count trend)
  - Cash Dividends Paid from annual cash-flow statements (payout ratio vs net income)
  - Repurchase / Issuance Of Capital Stock (net buyback) and Free Cash Flow
    (dividend coverage) from annual cash-flow statements
  - sector / industry labels (with a Chinese sector mapping)
  - yearly average close price in trading currency (split-adjusted, matching the
    split-adjusted dividend series) for historical dividend-yield percentile

Annual statements only cover ~4-5 fiscal years on Yahoo; dividend and price history
are longer. ETFs and symbols without financials degrade gracefully to
dividend/price-only rows.

Monetary statement values (netIncome, buyback, fcf, ...) are in statementCurrency;
dividendPerShare and avgPrice are in trading currency. The frontend converts.
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
BALANCE_EQUITY_KEYS = (
    'Stockholders Equity',
    'Common Stock Equity',
    'Total Equity Gross Minority Interest',
)
BALANCE_SHARES_KEYS = (
    'Ordinary Shares Number',
    'Share Issued',
)
CASHFLOW_BUYBACK_KEYS = (
    'Repurchase Of Capital Stock',
    'Common Stock Payments',
)
CASHFLOW_ISSUANCE_KEYS = (
    'Issuance Of Capital Stock',
    'Common Stock Issuance',
)
CASHFLOW_FCF_KEYS = ('Free Cash Flow',)
CASHFLOW_OCF_KEYS = ('Operating Cash Flow', 'Cash Flow From Continuing Operating Activities')
CASHFLOW_CAPEX_KEYS = ('Capital Expenditure',)

# yfinance sector labels -> Chinese display labels.
SECTOR_CN = {
    'Technology': '科技',
    'Financial Services': '金融',
    'Consumer Cyclical': '可选消费',
    'Consumer Defensive': '必需消费',
    'Industrials': '工业',
    'Basic Materials': '原材料',
    'Energy': '能源',
    'Utilities': '公用事业',
    'Communication Services': '通信服务',
    'Healthcare': '医疗保健',
    'Real Estate': '房地产',
}

# Special-dividend heuristic: a payment counts as special when it is at least this
# many times the median of the company's other payments within +/-2 years, AND the
# year's total also spikes vs nearby years (filters out big regular final dividends
# in interim+final patterns, and old payments before a switch to smaller cadence).
SPECIAL_DIVIDEND_RATIO = 2.5
SPECIAL_DIVIDEND_WINDOW_DAYS = 730
SPECIAL_DIVIDEND_MIN_PEERS = 3
SPECIAL_DIVIDEND_YEAR_RATIO = 1.6
SPECIAL_DIVIDEND_YEAR_SPAN = 2
SPECIAL_DIVIDEND_MIN_PEER_YEARS = 2


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


def dividend_payments(ticker):
    """Dividend series -> chronological [(datetime, amount, dateLabel)]."""
    payments = []
    try:
        series = ticker.dividends
    except Exception as error:
        print(f'dividend history failed: {error}')
        return payments
    if series is None:
        return payments
    try:
        items = list(series.items())
    except Exception:
        return payments
    for index_value, raw_value in items:
        amount = safe_float(raw_value, 0.0)
        event_dt = parse_date_value(index_value)
        if amount <= 0 or event_dt is None:
            continue
        payments.append((event_dt, amount, normalize_date_string(index_value)))
    payments.sort(key=lambda item: item[0])
    return payments


def median(values):
    ordered = sorted(values)
    count = len(ordered)
    if not count:
        return 0.0
    middle = count // 2
    if count % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2


def year_total_spikes(totals, year):
    """True when a year's dividend total clearly exceeds nearby years' totals."""
    peers = [
        totals[peer_year]
        for peer_year in totals
        if peer_year != year and abs(peer_year - year) <= SPECIAL_DIVIDEND_YEAR_SPAN
    ]
    if len(peers) < SPECIAL_DIVIDEND_MIN_PEER_YEARS:
        return False
    base = median(peers)
    return base > 0 and totals.get(year, 0.0) >= SPECIAL_DIVIDEND_YEAR_RATIO * base


def special_dividends_by_year(payments):
    """Heuristic: a payment far above the median of nearby payments is special.

    Needs at least SPECIAL_DIVIDEND_MIN_PEERS other payments within the window so
    that a company's normal cadence is established before anything is flagged.
    The year-total spike check then rejects payments that only look big because
    the company pays one large final dividend among smaller interim ones.
    """
    totals, _last_ex = dividends_by_year(payments)
    specials = {}
    for index, (event_dt, amount, _label) in enumerate(payments):
        peers = [
            peer_amount
            for peer_index, (peer_dt, peer_amount, _peer_label) in enumerate(payments)
            if peer_index != index
            and abs((peer_dt - event_dt).days) <= SPECIAL_DIVIDEND_WINDOW_DAYS
        ]
        if len(peers) < SPECIAL_DIVIDEND_MIN_PEERS:
            continue
        base = median(peers)
        if base > 0 and amount >= SPECIAL_DIVIDEND_RATIO * base and year_total_spikes(totals, event_dt.year):
            year = event_dt.year
            specials[year] = round(specials.get(year, 0.0) + amount, 6)
    return specials


def dividends_by_year(payments):
    totals = {}
    last_ex = {}
    for _event_dt, amount, label in payments:
        year = _event_dt.year
        totals[year] = round(totals.get(year, 0.0) + amount, 6)
        if label and label > last_ex.get(year, ''):
            last_ex[year] = label
    return totals, last_ex


def yearly_avg_prices(ticker, symbol):
    """Yearly mean close in trading currency, adjusted for splits only.

    yfinance's dividend series is split-adjusted, so prices must be too or the
    historical dividend yield would jump across split dates. auto_adjust=False
    keeps dividends out of the price adjustment.
    """
    try:
        history = ticker.history(period=f'{MAX_YEARS}y', interval='1d', auto_adjust=False)
    except Exception as error:
        print(f'price history failed for {symbol}: {error}')
        return {}
    if history is None:
        return {}
    try:
        if history.empty or 'Close' not in history.columns:
            return {}
    except Exception:
        return {}

    splits = []
    if 'Stock Splits' in history.columns:
        for index_value, raw in history['Stock Splits'].items():
            ratio = safe_float(raw, 0.0)
            split_dt = parse_date_value(index_value)
            if ratio and ratio > 0 and split_dt is not None:
                splits.append((split_dt, ratio))

    sums = {}
    counts = {}
    for index_value, raw in history['Close'].items():
        price = safe_float(raw, None)
        event_dt = parse_date_value(index_value)
        if price is None or price <= 0 or event_dt is None:
            continue
        factor = 1.0
        for split_dt, ratio in splits:
            if split_dt > event_dt:
                factor *= ratio
        adjusted = price / factor
        year = event_dt.year
        sums[year] = sums.get(year, 0.0) + adjusted
        counts[year] = counts.get(year, 0) + 1
    return {year: round(sums[year] / counts[year], 4) for year in sums}


def fetch_info(ticker):
    try:
        info = ticker.get_info()
        if isinstance(info, dict):
            return info
    except Exception:
        pass
    return {}


def resolve_name(info, symbol):
    for key in ('shortName', 'longName', 'displayName'):
        value = str(info.get(key) or '').strip()
        if value:
            return value
    return symbol


def build_company(symbol):
    yf_symbol = to_yfinance_symbol(symbol)
    ticker = yf.Ticker(yf_symbol)
    _, trade_currency = infer_market_currency(symbol)

    payments = dividend_payments(ticker)
    dps_by_year, last_ex_by_year = dividends_by_year(payments)
    special_by_year = special_dividends_by_year(payments)
    avg_price_by_year = yearly_avg_prices(ticker, symbol)

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
    equity_row = pick_row(balance, BALANCE_EQUITY_KEYS)
    shares_row = pick_row(balance, BALANCE_SHARES_KEYS)
    dividends_paid_row = pick_row(cashflow, CASHFLOW_DIVIDEND_KEYS)
    buyback_row = pick_row(cashflow, CASHFLOW_BUYBACK_KEYS)
    issuance_row = pick_row(cashflow, CASHFLOW_ISSUANCE_KEYS)
    fcf_row = pick_row(cashflow, CASHFLOW_FCF_KEYS)
    ocf_row = pick_row(cashflow, CASHFLOW_OCF_KEYS)
    capex_row = pick_row(cashflow, CASHFLOW_CAPEX_KEYS)

    info = fetch_info(ticker)
    statement_currency = str(info.get('financialCurrency') or '').strip().upper()
    sector = str(info.get('sector') or '').strip()
    industry = str(info.get('industry') or '').strip()

    years = set(dps_by_year) | set(eps_row) | set(net_income_row) | set(assets_row) | set(liabilities_row)
    current_year = datetime.now(timezone.utc).year
    years = sorted(year for year in years if 1990 <= year <= current_year)[-MAX_YEARS:]
    if not years:
        return None

    rows = []
    for year in years:
        dps = round(max(0.0, safe_float(dps_by_year.get(year), 0.0)), 6)
        special_dps = round(max(0.0, safe_float(special_by_year.get(year), 0.0)), 6)
        eps = safe_float(eps_row.get(year), None)
        net_income = safe_float(net_income_row.get(year), None)
        assets = safe_float(assets_row.get(year), None)
        liabilities = safe_float(liabilities_row.get(year), None)
        equity = safe_float(equity_row.get(year), None)
        shares = safe_float(shares_row.get(year), None)
        dividends_paid = safe_float(dividends_paid_row.get(year), None)
        buyback = safe_float(buyback_row.get(year), None)
        issuance = safe_float(issuance_row.get(year), None)
        fcf = safe_float(fcf_row.get(year), None)
        if fcf is None:
            ocf = safe_float(ocf_row.get(year), None)
            capex = safe_float(capex_row.get(year), None)
            if ocf is not None and capex is not None:
                fcf = ocf - abs(capex)
        avg_price = safe_float(avg_price_by_year.get(year), None)

        payout_ratio = None
        if dividends_paid is not None and net_income is not None and net_income > 0:
            payout_ratio = round(abs(dividends_paid) / net_income, 4)
        elif dps > 0 and eps is not None and eps > 0 and (not statement_currency or statement_currency == trade_currency):
            # Fallback only when the DPS currency matches the reporting currency.
            payout_ratio = round(dps / eps, 4)

        debt_ratio = None
        if assets is not None and assets > 0 and liabilities is not None:
            debt_ratio = round(liabilities / assets, 4)

        # Net buyback > 0 means real shareholder return; < 0 means dilution.
        net_buyback = None
        if buyback is not None or issuance is not None:
            net_buyback = abs(buyback or 0.0) - abs(issuance or 0.0)

        row = {'year': year}
        if dps > 0:
            row['dividendPerShare'] = dps
        if special_dps > 0:
            row['specialDividendPerShare'] = min(special_dps, dps)
        if last_ex_by_year.get(year):
            row['lastExDate'] = last_ex_by_year[year]
        if avg_price is not None and avg_price > 0:
            row['avgPrice'] = avg_price
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
        if equity is not None and equity > 0 and net_income is not None:
            row['roe'] = round(net_income / equity, 4)
        if shares is not None and shares > 0:
            row['sharesOutstanding'] = round(shares, 0)
        if net_buyback is not None:
            row['netBuyback'] = round(net_buyback, 2)
        if fcf is not None:
            row['fcf'] = round(fcf, 2)
        if fcf is not None and dividends_paid is not None and abs(dividends_paid) > 0:
            row['fcfDividendCoverage'] = round(fcf / abs(dividends_paid), 4)
        if len(row) > 1:
            rows.append(row)

    if not rows:
        return None

    company = {
        'symbol': symbol,
        'name': resolve_name(info, symbol),
        'currency': trade_currency,
        'statementCurrency': statement_currency or trade_currency,
        'years': rows,
    }
    if sector:
        company['sector'] = sector
        company['sectorCn'] = SECTOR_CN.get(sector, sector)
    if industry:
        company['industry'] = industry
    return company


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
