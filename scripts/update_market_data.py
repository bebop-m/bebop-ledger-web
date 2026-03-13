import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import akshare as ak
import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / 'data'
WATCHLIST_PATH = DATA_DIR / 'watchlist.json'
OUTPUT_PATH = DATA_DIR / 'market.json'

COL_CODE = '\u4ee3\u7801'
COL_NAME = '\u540d\u79f0'
COL_PRICE = '\u6700\u65b0\u4ef7'
HK_DIV_PER_SHARE_TTM = '\u6bcf\u80a1\u80a1\u606fTTM(\u6e2f\u5143)'
HK_DIV_YIELD_TTM = '\u80a1\u606f\u7387TTM(%)'
CN_DIV_PAY_DATE = '\u6d3e\u606f\u65e5'
CN_DIV_EX_DATE = '\u9664\u6743\u65e5'
CN_DIV_RATIO = '\u6d3e\u606f\u6bd4\u4f8b'


def load_watchlist():
    payload = json.loads(WATCHLIST_PATH.read_text(encoding='utf-8-sig'))
    return [str(symbol).strip().upper() for symbol in payload.get('symbols', []) if str(symbol).strip()]


def safe_float(value, default=0.0):
    if value is None:
        return default
    if isinstance(value, str):
        cleaned = value.strip().replace(',', '').replace('%', '')
        if cleaned in {'', '--', 'nan', 'None', 'null'}:
            return default
        value = cleaned
    try:
        if pd.isna(value):
            return default
    except Exception:
        pass
    try:
        return float(value)
    except Exception:
        return default


def to_cn_symbol(code):
    if len(code) != 6 or not code.isdigit():
        return None
    if code.startswith(('6', '9')):
        return f'{code}.SH'
    return f'{code}.SZ'


def fetch_cn_quotes(watchlist):
    targets = {symbol for symbol in watchlist if symbol.endswith('.SH') or symbol.endswith('.SZ')}
    if not targets:
        return {}
    frame = ak.stock_zh_a_spot_em()
    quotes = {}
    for _, row in frame.iterrows():
        code = str(row.get(COL_CODE, '')).strip()
        symbol = to_cn_symbol(code)
        if symbol not in targets:
            continue
        quotes[symbol] = {
            'symbol': symbol,
            'name': str(row.get(COL_NAME, symbol)).strip(),
            'market': 'CN',
            'currency': 'CNY',
            'price': safe_float(row.get(COL_PRICE, 0))
        }
    return quotes


def fetch_hk_quotes(watchlist):
    targets = {symbol for symbol in watchlist if symbol.endswith('.HK')}
    if not targets:
        return {}
    frame = ak.stock_hk_main_board_spot_em()
    quotes = {}
    for _, row in frame.iterrows():
        code = str(row.get(COL_CODE, '')).strip().zfill(5)
        symbol = f'{code}.HK'
        if symbol not in targets:
            continue
        quotes[symbol] = {
            'symbol': symbol,
            'name': str(row.get(COL_NAME, symbol)).strip(),
            'market': 'HK',
            'currency': 'HKD',
            'price': safe_float(row.get(COL_PRICE, 0))
        }
    return quotes


def fetch_us_quotes(watchlist):
    targets = {symbol for symbol in watchlist if '.' not in symbol}
    if not targets:
        return {}
    frame = ak.stock_us_spot_em()
    quotes = {}
    for _, row in frame.iterrows():
        provider_code = str(row.get(COL_CODE, '')).strip().upper()
        symbol = provider_code.split('.')[-1]
        if symbol not in targets:
            continue
        quotes[symbol] = {
            'symbol': symbol,
            'name': str(row.get(COL_NAME, symbol)).strip(),
            'market': 'US',
            'currency': 'USD',
            'price': safe_float(row.get(COL_PRICE, 0))
        }
    return quotes


def fetch_hk_dividend_metrics(watchlist):
    targets = sorted(symbol for symbol in watchlist if symbol.endswith('.HK'))
    metrics = {}
    for symbol in targets:
        code = symbol.split('.')[0]
        try:
            frame = ak.stock_hk_financial_indicator_em(symbol=code)
            if frame is None or frame.empty:
                continue
            row = frame.iloc[0]
            dividend_per_share = safe_float(row.get(HK_DIV_PER_SHARE_TTM, 0))
            dividend_yield_pct = safe_float(row.get(HK_DIV_YIELD_TTM, 0))
            metrics[symbol] = {
                'dividendPerShareTtm': round(dividend_per_share, 6),
                'dividendYield': round(dividend_yield_pct / 100, 6)
            }
        except Exception as error:
            print(f'hk dividend fetch failed for {symbol}: {error}')
    return metrics


def resolve_cn_dividend_date(row):
    for field in (CN_DIV_PAY_DATE, CN_DIV_EX_DATE):
        value = pd.to_datetime(row.get(field), errors='coerce')
        if not pd.isna(value):
            return value
    return pd.NaT


def fetch_cn_dividend_metrics(watchlist, quotes):
    targets = sorted(symbol for symbol in watchlist if symbol.endswith('.SH') or symbol.endswith('.SZ'))
    threshold = datetime.now(timezone.utc).date() - timedelta(days=365)
    metrics = {}

    for symbol in targets:
        code = symbol.split('.')[0]
        try:
            frame = ak.stock_dividend_cninfo(symbol=code)
            if frame is None or frame.empty:
                continue

            ttm_dividend_per_share = 0.0
            for _, row in frame.iterrows():
                dividend_date = resolve_cn_dividend_date(row)
                if pd.isna(dividend_date) or dividend_date.date() < threshold:
                    continue
                per_ten_shares = safe_float(row.get(CN_DIV_RATIO, 0))
                if per_ten_shares <= 0:
                    continue
                ttm_dividend_per_share += per_ten_shares / 10

            price = safe_float((quotes.get(symbol) or {}).get('price', 0))
            dividend_yield = (ttm_dividend_per_share / price) if price > 0 else 0.0
            metrics[symbol] = {
                'dividendPerShareTtm': round(ttm_dividend_per_share, 6),
                'dividendYield': round(dividend_yield, 6)
            }
        except Exception as error:
            print(f'cn dividend fetch failed for {symbol}: {error}')
    return metrics


def fetch_rates():
    response = requests.get(
        'https://api.frankfurter.dev/v1/latest?base=CNY&symbols=USD,HKD',
        timeout=20,
        headers={'User-Agent': 'bopup-ledger-gh-action'}
    )
    response.raise_for_status()
    payload = response.json()
    usd = float(payload['rates']['USD'])
    hkd = float(payload['rates']['HKD'])
    return {
        'CNY': 1,
        'USD': round(1 / usd, 4),
        'HKD': round(1 / hkd, 4)
    }


def main():
    watchlist = load_watchlist()
    quotes = {}
    quotes.update(fetch_cn_quotes(watchlist))
    quotes.update(fetch_hk_quotes(watchlist))
    quotes.update(fetch_us_quotes(watchlist))

    hk_metrics = fetch_hk_dividend_metrics(watchlist)
    cn_metrics = fetch_cn_dividend_metrics(watchlist, quotes)

    for symbol, metric in {**hk_metrics, **cn_metrics}.items():
        if symbol not in quotes:
            continue
        quotes[symbol].update(metric)

    payload = {
        'ok': True,
        'provider': {
            'quote': 'akshare',
            'fx': 'frankfurter',
            'dividend': 'akshare'
        },
        'updatedAt': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        'rates': fetch_rates(),
        'quotes': quotes
    }
    OUTPUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'updated {len(quotes)} quotes into {OUTPUT_PATH}')


if __name__ == '__main__':
    main()
