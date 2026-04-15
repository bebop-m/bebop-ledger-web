import json
import math
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
import yfinance as yf

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / 'data'
WATCHLIST_PATH = DATA_DIR / 'watchlist.json'
PORTFOLIO_SNAPSHOT_PATH = DATA_DIR / 'portfolio_snapshot.json'
OUTPUT_PATH = DATA_DIR / 'market.json'
CONFIG_PATH = ROOT / 'config.json'

LOCAL_TZ = timezone(timedelta(hours=8))
DEFAULT_RATES = {'CNY': 1, 'USD': 7.22, 'HKD': 0.92}
DEFAULT_CONFIG = {
    'coreSymbols': ['00700.HK', '600519.SH'],
    'dividendChangeThreshold': 0.3,
    'staleDays': 7,
    'forceVerifyMonths': [3, 4, 8, 9]
}
VALID_DIVIDEND_SOURCES = {'yfinance', 'manual', 'cache', 'yahoo', 'eodhd'}
VALID_DIVIDEND_STATUSES = {'manual', 'fresh', 'stale', 'missing'}

REQUEST_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                  '(KHTML, like Gecko) Chrome/134.0 Safari/537.36',
    'Accept': 'application/json,text/plain,*/*',
    'Accept-Language': 'en-US,en;q=0.9'
}
TENCENT_QUOTE_ENDPOINT = 'https://qt.gtimg.cn/q='
TENCENT_HEADERS = {
    **REQUEST_HEADERS,
    'Referer': 'https://gu.qq.com/'
}


def utc_now():
    return datetime.now(timezone.utc)


def utc_now_iso():
    return utc_now().isoformat().replace('+00:00', 'Z')


def normalize_symbol(raw_symbol):
    value = str(raw_symbol or '').strip().upper()
    if not value:
        return ''
    def normalize_cn_suffix(digits):
        return f'{digits}.SH' if re.match(r'^[569]', digits) else f'{digits}.SZ'
    if re.fullmatch(r'\d{6}\.SS', value):
        return value.replace('.SS', '.SH')
    if re.fullmatch(r'\d{5}\.HK', value):
        return value
    if re.fullmatch(r'\d{6}\.(SH|SZ)', value):
        return normalize_cn_suffix(value[:6])
    if re.fullmatch(r'[A-Z][A-Z0-9.-]*', value):
        return value
    if re.fullmatch(r'\d{5}', value):
        return f'{value}.HK'
    if re.fullmatch(r'\d{6}', value):
        return normalize_cn_suffix(value)
    return value


def load_watchlist():
    payload = json.loads(WATCHLIST_PATH.read_text(encoding='utf-8-sig'))
    return [normalize_symbol(symbol) for symbol in payload.get('symbols', []) if normalize_symbol(symbol)]


def load_portfolio_snapshot_symbols():
    if not PORTFOLIO_SNAPSHOT_PATH.exists():
        return []

    try:
        payload = json.loads(PORTFOLIO_SNAPSHOT_PATH.read_text(encoding='utf-8-sig'))
    except Exception as error:
        print(f'portfolio snapshot load skipped: {error}')
        return []

    if not isinstance(payload, dict):
        return []

    raw_holdings = payload.get('holdings')
    if not isinstance(raw_holdings, list):
        raw_holdings = payload.get('positions')

    if not isinstance(raw_holdings, list):
        return []

    symbols = []
    for item in raw_holdings:
        if not isinstance(item, dict):
            continue

        symbol = normalize_symbol(item.get('symbol'))
        if not symbol:
            continue

        has_size = 'quantity' in item or 'shares' in item
        position_size = safe_float(item.get('quantity'), safe_float(item.get('shares'), 0.0))
        if has_size and position_size <= 0:
            continue

        if symbol not in symbols:
            symbols.append(symbol)

    return symbols


def load_symbol_universe():
    snapshot_symbols = load_portfolio_snapshot_symbols()
    if snapshot_symbols:
        print(f'loaded {len(snapshot_symbols)} symbols from {PORTFOLIO_SNAPSHOT_PATH.name}')
        return snapshot_symbols

    watchlist_symbols = load_watchlist()
    print(f'loaded {len(watchlist_symbols)} symbols from {WATCHLIST_PATH.name}')
    return watchlist_symbols


def load_previous_snapshot():
    if not OUTPUT_PATH.exists():
        return {}
    try:
        return json.loads(OUTPUT_PATH.read_text(encoding='utf-8-sig'))
    except Exception:
        return {}


def load_config():
    config = dict(DEFAULT_CONFIG)
    if CONFIG_PATH.exists():
        try:
            payload = json.loads(CONFIG_PATH.read_text(encoding='utf-8-sig'))
            if isinstance(payload, dict):
                config.update(payload)
        except Exception as error:
            print(f'config load skipped: {error}')

    core_symbols = []
    for symbol in config.get('coreSymbols', []):
        normalized = normalize_symbol(symbol)
        if normalized and normalized not in core_symbols:
            core_symbols.append(normalized)

    threshold = max(0.0, safe_float(
        config.get('dividendChangeThreshold'),
        DEFAULT_CONFIG['dividendChangeThreshold']
    ))
    stale_days = max(1, int(safe_float(config.get('staleDays'), DEFAULT_CONFIG['staleDays'])))

    force_verify_months = []
    for month in config.get('forceVerifyMonths', []):
        try:
            month = int(month)
        except Exception:
            continue
        if 1 <= month <= 12 and month not in force_verify_months:
            force_verify_months.append(month)

    return {
        'coreSymbols': core_symbols,
        'dividendChangeThreshold': threshold,
        'staleDays': stale_days,
        'forceVerifyMonths': force_verify_months or list(DEFAULT_CONFIG['forceVerifyMonths'])
    }


def safe_float(value, default=0.0):
    if value is None:
        return default
    if isinstance(value, str):
        cleaned = value.strip().replace(',', '').replace('%', '')
        if cleaned in {'', '--', 'nan', 'None', 'null'}:
            return default
        value = cleaned
    try:
        parsed = float(value)
    except Exception:
        return default
    return parsed if math.isfinite(parsed) else default


def normalize_dividend_source(value, fallback='cache'):
    source = str(value or '').strip().lower()
    return source if source in VALID_DIVIDEND_SOURCES else fallback


def normalize_dividend_status(value, fallback='missing'):
    status = str(value or '').strip().lower()
    return status if status in VALID_DIVIDEND_STATUSES else fallback


def parse_datetime(value):
    raw = str(value or '').strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace('Z', '+00:00')).astimezone(timezone.utc)
    except Exception:
        return None


def parse_date_value(value):
    if value is None or value == '':
        return None

    if isinstance(value, datetime):
        return value.astimezone(timezone.utc) if value.tzinfo else value.replace(tzinfo=timezone.utc)

    if hasattr(value, 'to_pydatetime'):
        try:
            return parse_date_value(value.to_pydatetime())
        except Exception:
            return None

    if isinstance(value, (int, float)):
        timestamp = int(value)
        if timestamp > 10**12:
            timestamp //= 1000
        try:
            return datetime.fromtimestamp(timestamp, tz=timezone.utc)
        except Exception:
            return None

    raw = str(value).strip()
    if not raw:
        return None

    if re.fullmatch(r'\d{10,13}', raw):
        return parse_date_value(int(raw))

    try:
        return datetime.fromisoformat(raw.replace('Z', '+00:00')).astimezone(timezone.utc)
    except Exception:
        pass

    for fmt in ('%Y-%m-%d', '%Y/%m/%d', '%Y-%m-%d %H:%M:%S'):
        try:
            return datetime.strptime(raw, fmt).replace(tzinfo=timezone.utc)
        except Exception:
            continue
    return None


def normalize_date_string(value):
    dt = parse_date_value(value)
    return dt.date().isoformat() if dt else ''


def is_stale(updated_at, stale_days):
    dt = parse_datetime(updated_at)
    if dt is None:
        return True
    return utc_now() - dt > timedelta(days=stale_days)


def relative_change(next_value, previous_value):
    next_value = safe_float(next_value, 0.0)
    previous_value = safe_float(previous_value, 0.0)
    if next_value <= 0 or previous_value <= 0:
        return 0.0
    return abs(next_value - previous_value) / previous_value


def build_dividend_payload(
    dividend_per_share_ttm=0.0,
    dividend_source='cache',
    dividend_updated_at='',
    last_ex_date='',
    stale_days=7,
    dividend_fetch_error=''
):
    per_share = round(max(0.0, safe_float(dividend_per_share_ttm, 0.0)), 6)
    source = normalize_dividend_source(dividend_source, 'cache')
    updated_at = str(dividend_updated_at or '').strip()
    ex_date = normalize_date_string(last_ex_date)

    if source == 'manual':
        status = 'manual'
    elif per_share <= 0:
        status = 'missing'
    elif source == 'cache':
        status = 'stale'
    elif is_stale(updated_at, stale_days):
        status = 'stale'
    else:
        status = 'fresh'

    payload = {
        'dividendPerShareTtm': per_share,
        'dividendSource': source,
        'dividendUpdatedAt': updated_at,
        'lastExDate': ex_date,
        'dividendStatus': status
    }

    error_text = str(dividend_fetch_error or '').strip()
    if error_text:
        payload['dividendFetchError'] = error_text[:300]

    return payload


def build_dividend_payload_from_quote(quote, stale_days):
    quote = quote or {}
    dividend_per_share_ttm = quote.get('dividendPerShareTtm')
    if dividend_per_share_ttm is None:
        legacy_yield = safe_float(quote.get('dividendYield'), 0.0)
        price = safe_float(quote.get('price'), 0.0)
        dividend_per_share_ttm = legacy_yield * price if legacy_yield > 0 and price > 0 else 0.0

    return build_dividend_payload(
        dividend_per_share_ttm=dividend_per_share_ttm,
        dividend_source=quote.get('dividendSource'),
        dividend_updated_at=quote.get('dividendUpdatedAt'),
        last_ex_date=quote.get('lastExDate'),
        stale_days=stale_days,
        dividend_fetch_error=quote.get('dividendFetchError')
    )


def fetch_json(url, params=None, timeout=20):
    response = requests.get(url, params=params, timeout=timeout, headers=REQUEST_HEADERS)
    response.raise_for_status()
    return response.json()


def fetch_with_retry(label, fn, *args, retries=3, delay_seconds=2, **kwargs):
    last_error = None
    for attempt in range(1, retries + 1):
        try:
            return fn(*args, **kwargs)
        except Exception as error:
            last_error = error
            print(f'{label} failed on attempt {attempt}/{retries}: {error}')
            if attempt < retries:
                time.sleep(delay_seconds)
    raise last_error


def to_yfinance_symbol(symbol):
    normalized = str(symbol).strip().upper()
    if normalized.endswith('.HK'):
        raw = normalized[:-3]
        digits = raw.lstrip('0')
        digits = digits.zfill(4) if digits else '0000'
        return f'{digits}.HK'
    if normalized.endswith('.SH'):
        return f'{normalized[:-3]}.SS'
    return normalized


def infer_market_currency(symbol):
    if symbol.endswith('.HK'):
        return 'HK', 'HKD'
    if symbol.endswith('.SH') or symbol.endswith('.SZ'):
        return 'CN', 'CNY'
    return 'US', 'USD'


def normalize_quote_entry(symbol, quote, stale_days):
    quote = quote or {}
    market, currency = infer_market_currency(symbol)
    entry = {
        'symbol': symbol,
        'name': str(quote.get('name') or symbol).strip(),
        'market': str(quote.get('market') or market).strip() or market,
        'currency': str(quote.get('currency') or currency).strip() or currency,
        'price': round(safe_float(quote.get('price'), 0.0), 6)
    }
    prev_close = safe_float(quote.get('previousClose'), 0.0)
    if prev_close > 0:
        entry['previousClose'] = round(prev_close, 6)
    entry.update(build_dividend_payload_from_quote(quote, stale_days))
    return entry


def merge_quote_snapshots(base_quotes, next_quotes, stale_days):
    merged = {**(base_quotes or {})}
    dividend_keys = (
        'dividendPerShareTtm', 'dividendSource', 'dividendUpdatedAt',
        'lastExDate', 'dividendStatus', 'dividendFetchError'
    )
    for symbol, next_quote in (next_quotes or {}).items():
        base = merged.get(symbol) or {}
        combined = {**base, **(next_quote or {})}
        # Preserve existing dividend fields when the incoming quote has none.
        if not any(k in (next_quote or {}) for k in dividend_keys):
            for k in dividend_keys:
                if k in base:
                    combined[k] = base[k]
        merged[symbol] = combined
    return {
        symbol: normalize_quote_entry(symbol, quote, stale_days)
        for symbol, quote in merged.items()
    }


def chunked(items, size):
    for index in range(0, len(items), size):
        yield items[index:index + size]


def to_tencent_symbol(symbol):
    normalized = str(symbol).strip().upper()
    if normalized.endswith('.HK'):
        return f'hk{normalized[:-3].zfill(5)}'
    if normalized.endswith('.SH'):
        return f'sh{normalized[:-3]}'
    if normalized.endswith('.SZ'):
        return f'sz{normalized[:-3]}'
    return f'us{normalized}'


def from_tencent_symbol(symbol):
    normalized = str(symbol).strip()
    lower = normalized.lower()
    if lower.startswith('hk'):
        return f'{normalized[2:].upper().zfill(5)}.HK'
    if lower.startswith('sh'):
        return f'{normalized[2:].upper()}.SH'
    if lower.startswith('sz'):
        return f'{normalized[2:].upper()}.SZ'
    if lower.startswith('us'):
        return normalized[2:].upper()
    return normalized.upper()


def fetch_text(url, params=None, timeout=20, encoding=None, headers=None):
    response = requests.get(url, params=params, timeout=timeout, headers=headers or REQUEST_HEADERS)
    response.raise_for_status()
    if encoding:
        response.encoding = encoding
    return response.text


def parse_tencent_quote_payload(payload):
    text = str(payload or '')
    for match in re.finditer(r'v_([^=]+)="([^"]*)";?', text):
        yield match.group(1), match.group(2).split('~')


def fetch_quotes(watchlist):
    quotes = {}
    tencent_code_map = {to_tencent_symbol(symbol): symbol for symbol in watchlist}

    for code_batch in chunked(list(tencent_code_map.keys()), 60):
        payload = fetch_text(
            TENCENT_QUOTE_ENDPOINT + ','.join(code_batch),
            timeout=20,
            encoding='gb18030',
            headers=TENCENT_HEADERS
        )

        for raw_symbol, fields in parse_tencent_quote_payload(payload):
            if len(fields) < 5:
                continue

            symbol = tencent_code_map.get(raw_symbol, from_tencent_symbol(raw_symbol))
            market, currency = infer_market_currency(symbol)
            fallback = quotes.get(symbol) or {}
            price = safe_float(fields[3], safe_float(fields[4], 0))
            name = str(fields[1] or fallback.get('name') or symbol).strip()

            if price <= 0:
                continue

            quotes[symbol] = {
                'symbol': symbol,
                'name': name or symbol,
                'market': market,
                'currency': currency,
                'price': round(price, 6),
                'previousClose': round(safe_float(fields[4], 0), 6)
            }

    return quotes


def iter_series_items(series):
    if series is None:
        return []
    try:
        return list(series.items())
    except Exception:
        pass
    try:
        payload = series.to_dict()
        if isinstance(payload, dict):
            return list(payload.items())
    except Exception:
        pass
    return []


def last_positive_series_value(series):
    items = iter_series_items(series)
    for _, raw_value in reversed(items):
        value = safe_float(raw_value, 0.0)
        if value > 0:
            return round(value, 6)
    return 0.0


def sum_ttm_dividends_from_series(series):
    threshold = utc_now() - timedelta(days=365)
    total = 0.0
    for index_value, raw_value in iter_series_items(series):
        amount = safe_float(raw_value, 0.0)
        event_dt = parse_date_value(index_value)
        if amount <= 0 or event_dt is None:
            continue
        if event_dt >= threshold:
            total += amount
    return round(total, 6)


def latest_ex_date_from_series(series):
    latest_dt = None
    for index_value, raw_value in iter_series_items(series):
        if safe_float(raw_value, 0.0) <= 0:
            continue
        event_dt = parse_date_value(index_value)
        if event_dt is None:
            continue
        latest_dt = event_dt if latest_dt is None else max(latest_dt, event_dt)
    return latest_dt.date().isoformat() if latest_dt else ''


def resolve_company_name(ticker, previous_quote, symbol):
    previous_name = str((previous_quote or {}).get('name') or '').strip()
    if previous_name and previous_name != symbol:
        return previous_name

    try:
        info = ticker.get_info()
        if isinstance(info, dict):
            for key in ('shortName', 'longName', 'displayName'):
                value = str(info.get(key) or '').strip()
                if value:
                    return value
    except Exception:
        pass

    return previous_name or symbol


def resolve_currency(ticker, symbol):
    market, fallback_currency = infer_market_currency(symbol)

    try:
        fast_info = ticker.fast_info or {}
        currency = str(fast_info.get('currency') or '').strip().upper()
        if currency:
            return currency
    except Exception:
        pass

    try:
        metadata = ticker.history_metadata or {}
        currency = str(metadata.get('currency') or '').strip().upper()
        if currency:
            return currency
    except Exception:
        pass

    return fallback_currency


def extract_latest_price(ticker, history):
    for column in ('Close', 'Adj Close'):
        try:
            price = last_positive_series_value(history[column])
        except Exception:
            price = 0.0
        if price > 0:
            return price

    try:
        fast_info = ticker.fast_info or {}
        for key in ('lastPrice', 'regularMarketPrice', 'previousClose'):
            price = safe_float(fast_info.get(key), 0.0)
            if price > 0:
                return round(price, 6)
    except Exception:
        pass

    return 0.0


def build_cached_quote(symbol, previous_quote, stale_days, error_text=''):
    cached_quote = normalize_quote_entry(symbol, previous_quote or {}, stale_days)
    market, currency = infer_market_currency(symbol)
    cached_quote.update({
        'symbol': symbol,
        'name': str(cached_quote.get('name') or symbol).strip() or symbol,
        'market': str(cached_quote.get('market') or market).strip() or market,
        'currency': str(cached_quote.get('currency') or currency).strip() or currency,
        'price': round(safe_float(cached_quote.get('price'), 0.0), 6)
    })
    cached_quote.update(build_dividend_payload(
        dividend_per_share_ttm=cached_quote.get('dividendPerShareTtm'),
        dividend_source='cache',
        dividend_updated_at=cached_quote.get('dividendUpdatedAt'),
        last_ex_date=cached_quote.get('lastExDate'),
        stale_days=stale_days,
        dividend_fetch_error=error_text
    ))
    return cached_quote


def fetch_yfinance_snapshot(symbol, previous_quote, stale_days):
    previous_quote = normalize_quote_entry(symbol, previous_quote or {}, stale_days)
    ticker = yf.Ticker(to_yfinance_symbol(symbol))

    history = None
    try:
        history = ticker.history(period='10d', interval='1d', auto_adjust=False, actions=False)
    except Exception as error:
        print(f'yfinance price history skipped for {symbol}: {error}')
    price = extract_latest_price(ticker, history)

    # Price failure is no longer fatal — use cached price and still try to fetch dividends.
    if price <= 0:
        price = safe_float(previous_quote.get('price'), 0.0)
        if price <= 0:
            print(f'warning: no price available for {symbol}, using 0')

    # Use a fresh Ticker instance for dividends to avoid state pollution from
    # history() internally calling get_history_metadata() in yfinance 1.x,
    # which causes subsequent ticker.dividends to return an empty series.
    dividend_fetch_error = ''
    try:
        div_ticker = yf.Ticker(to_yfinance_symbol(symbol))
        dividends = div_ticker.dividends
    except Exception as error:
        dividends = None
        dividend_fetch_error = str(error).strip()
        print(f'yfinance dividends skipped for {symbol}: {error}')

    market, _ = infer_market_currency(symbol)
    quote = {
        'symbol': symbol,
        'name': resolve_company_name(ticker, previous_quote, symbol),
        'market': market,
        'currency': resolve_currency(ticker, symbol),
        'price': price
    }
    if dividend_fetch_error:
        quote.update(build_dividend_payload(
            dividend_per_share_ttm=previous_quote.get('dividendPerShareTtm'),
            dividend_source='cache',
            dividend_updated_at=previous_quote.get('dividendUpdatedAt'),
            last_ex_date=previous_quote.get('lastExDate'),
            stale_days=stale_days,
            dividend_fetch_error=dividend_fetch_error
        ))
    else:
        ttm_dps = sum_ttm_dividends_from_series(dividends)
        last_ex = latest_ex_date_from_series(dividends)
        if ttm_dps <= 0 and not last_ex and safe_float(previous_quote.get('dividendPerShareTtm'), 0) > 0:
            # yfinance returned an empty dividend series despite a known previous value.
            # This indicates a transient API or data issue — preserve the cached dividend.
            quote.update(build_dividend_payload(
                dividend_per_share_ttm=previous_quote.get('dividendPerShareTtm'),
                dividend_source='cache',
                dividend_updated_at=previous_quote.get('dividendUpdatedAt'),
                last_ex_date=previous_quote.get('lastExDate'),
                stale_days=stale_days,
                dividend_fetch_error='yfinance returned empty dividend series'
            ))
        else:
            quote.update(build_dividend_payload(
                dividend_per_share_ttm=ttm_dps,
                dividend_source='yfinance',
                dividend_updated_at=utc_now_iso(),
                last_ex_date=last_ex,
                stale_days=stale_days
            ))
    return normalize_quote_entry(symbol, quote, stale_days)


def fetch_yfinance_snapshots(watchlist, previous_quotes, stale_days):
    snapshots = {}
    previous_quotes = previous_quotes or {}

    for symbol in watchlist:
        previous_quote = previous_quotes.get(symbol) or {}
        try:
            snapshots[symbol] = fetch_with_retry(
                f'yfinance snapshot {symbol}',
                fetch_yfinance_snapshot,
                symbol,
                previous_quote,
                stale_days,
                retries=2,
                delay_seconds=1
            )
        except Exception as error:
            print(f'yfinance snapshot refresh skipped for {symbol}: {error}')
            snapshots[symbol] = build_cached_quote(symbol, previous_quote, stale_days, str(error))

    return snapshots


def fetch_rates():
    payload = fetch_json('https://api.frankfurter.dev/v1/latest?base=CNY&symbols=USD,HKD')
    usd = float(payload['rates']['USD'])
    hkd = float(payload['rates']['HKD'])
    return {
        'CNY': 1,
        'USD': round(1 / usd, 4),
        'HKD': round(1 / hkd, 4)
    }


def seed_quotes_from_previous(previous_snapshot, watchlist, stale_days):
    previous_quotes = previous_snapshot.get('quotes') or {}
    seeded = {}
    for symbol in watchlist:
        if symbol in previous_quotes:
            seeded[symbol] = normalize_quote_entry(symbol, previous_quotes[symbol], stale_days)
    return seeded


def main():
    config = load_config()
    watchlist = load_symbol_universe()
    previous_snapshot = load_previous_snapshot()
    previous_quotes = previous_snapshot.get('quotes') or {}

    quotes = seed_quotes_from_previous(previous_snapshot, watchlist, config['staleDays'])
    rates = {**DEFAULT_RATES, **(previous_snapshot.get('rates') or {})}

    # Step 1: Fetch Tencent prices first — they serve as price fallback for yfinance.
    try:
        fresh_prices = fetch_with_retry('tencent quotes', fetch_quotes, watchlist, retries=3, delay_seconds=2)
        quotes = merge_quote_snapshots(quotes, fresh_prices, config['staleDays'])
    except Exception as error:
        print(f'tencent quote refresh skipped: {error}')

    # Step 2: Fetch yfinance snapshots (dividends + price).
    # If yfinance price fails, it falls back to cached/Tencent price from step 1.
    try:
        fresh_quotes = fetch_yfinance_snapshots(watchlist, quotes, config['staleDays'])
        quotes = merge_quote_snapshots(quotes, fresh_quotes, config['staleDays'])
    except Exception as error:
        print(f'yfinance snapshot refresh skipped: {error}')

    # Step 3: Refresh Tencent prices again so final output has the freshest prices.
    # merge_quote_snapshots preserves dividend fields from step 2.
    try:
        final_prices = fetch_with_retry('tencent quotes final', fetch_quotes, watchlist, retries=2, delay_seconds=2)
        quotes = merge_quote_snapshots(quotes, final_prices, config['staleDays'])
    except Exception as error:
        print(f'tencent final price refresh skipped: {error}')

    try:
        rates = fetch_with_retry('fx rates', fetch_rates, retries=3, delay_seconds=2)
    except Exception as error:
        print(f'fx refresh skipped: {error}')

    payload = {
        'ok': True,
        'provider': {
            'quote': 'tencent-finance',
            'fx': 'frankfurter',
            'dividend': 'yfinance',
            'dividendVerify': 'disabled'
        },
        'updatedAt': utc_now_iso(),
        'rates': rates,
        'quotes': quotes
    }
    OUTPUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'updated {len(quotes)} quotes into {OUTPUT_PATH}')


if __name__ == '__main__':
    main()
