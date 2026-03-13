import json
from datetime import datetime, timezone
from pathlib import Path

import akshare as ak
import requests

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / 'data'
WATCHLIST_PATH = DATA_DIR / 'watchlist.json'
OUTPUT_PATH = DATA_DIR / 'market.json'


def load_watchlist():
    payload = json.loads(WATCHLIST_PATH.read_text(encoding='utf-8'))
    return [str(symbol).strip().upper() for symbol in payload.get('symbols', []) if str(symbol).strip()]


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
        code = str(row.get('代码', '')).strip()
        symbol = to_cn_symbol(code)
        if symbol not in targets:
            continue
        quotes[symbol] = {
            'symbol': symbol,
            'name': str(row.get('名称', symbol)).strip(),
            'market': 'CN',
            'currency': 'CNY',
            'price': float(row.get('最新价', 0) or 0)
        }
    return quotes


def fetch_hk_quotes(watchlist):
    targets = {symbol for symbol in watchlist if symbol.endswith('.HK')}
    if not targets:
        return {}
    frame = ak.stock_hk_main_board_spot_em()
    quotes = {}
    for _, row in frame.iterrows():
        code = str(row.get('代码', '')).strip().zfill(5)
        symbol = f'{code}.HK'
        if symbol not in targets:
            continue
        quotes[symbol] = {
            'symbol': symbol,
            'name': str(row.get('名称', symbol)).strip(),
            'market': 'HK',
            'currency': 'HKD',
            'price': float(row.get('最新价', 0) or 0)
        }
    return quotes


def fetch_us_quotes(watchlist):
    targets = {symbol for symbol in watchlist if '.' not in symbol}
    if not targets:
        return {}
    frame = ak.stock_us_spot_em()
    quotes = {}
    for _, row in frame.iterrows():
        provider_code = str(row.get('代码', '')).strip().upper()
        symbol = provider_code.split('.')[-1]
        if symbol not in targets:
            continue
        quotes[symbol] = {
            'symbol': symbol,
            'name': str(row.get('名称', symbol)).strip(),
            'market': 'US',
            'currency': 'USD',
            'price': float(row.get('最新价', 0) or 0)
        }
    return quotes


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
    rates = fetch_rates()

    payload = {
        'ok': True,
        'provider': {
            'quote': 'akshare',
            'fx': 'frankfurter'
        },
        'updatedAt': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        'rates': rates,
        'quotes': quotes
    }
    OUTPUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'updated {len(quotes)} quotes into {OUTPUT_PATH}')


if __name__ == '__main__':
    main()
