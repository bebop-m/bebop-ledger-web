import json
import math
import os
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

import requests

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / 'data'
WATCHLIST_PATH = DATA_DIR / 'watchlist.json'
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
VALID_DIVIDEND_SOURCES = {'yahoo', 'eodhd', 'manual', 'cache'}
VALID_DIVIDEND_STATUSES = {'manual', 'fresh', 'stale', 'missing'}

TENCENT_QUOTE_ENDPOINT = 'https://qt.gtimg.cn/q='
YAHOO_CHART_ENDPOINT = 'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}'
EODHD_DIVIDEND_ENDPOINT = 'https://eodhd.com/api/div/{symbol}'

REQUEST_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                  '(KHTML, like Gecko) Chrome/134.0 Safari/537.36',
    'Accept': 'application/json,text/plain,*/*',
    'Accept-Language': 'en-US,en;q=0.9'
}
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
    if re.fullmatch(r'\d{6}\.SS', value):
        return value.replace('.SS', '.SH')
    if re.fullmatch(r'\d{5}\.HK', value) or re.fullmatch(r'\d{6}\.(SH|SZ)', value):
        return value
    if re.fullmatch(r'[A-Z][A-Z0-9.-]*', value):
        return value
    if re.fullmatch(r'\d{5}', value):
        return f'{value}.HK'
    if re.fullmatch(r'\d{6}', value):
        return f'{value}.SH' if re.match(r'^[569]', value) else f'{value}.SZ'
    return value


def load_watchlist():
    payload = json.loads(WATCHLIST_PATH.read_text(encoding='utf-8-sig'))
    return [normalize_symbol(symbol) for symbol in payload.get('symbols', []) if normalize_symbol(symbol)]


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


def fetch_text(url, params=None, timeout=20, encoding=None, headers=None):
    response = requests.get(url, params=params, timeout=timeout, headers=headers or REQUEST_HEADERS)
    response.raise_for_status()
    if encoding:
        response.encoding = encoding
    return response.text


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


def to_yahoo_symbol(symbol):
    normalized = str(symbol).strip().upper()
    if normalized.endswith('.HK'):
        raw = normalized[:-3]
        digits = raw.lstrip('0')
        digits = digits.zfill(4) if digits else '0000'
        return f'{digits}.HK'
    if normalized.endswith('.SH'):
        return f'{normalized[:-3]}.SS'
    return normalized


def to_eodhd_symbol(symbol):
    normalized = str(symbol).strip().upper()
    if normalized.endswith('.HK'):
        raw = normalized[:-3]
        digits = raw.lstrip('0')
        digits = digits.zfill(4) if digits else '0000'
        return f'{digits}.HK'
    if normalized.endswith('.SH'):
        return f'{normalized[:-3]}.SHG'
    if normalized.endswith('.SZ'):
        return f'{normalized[:-3]}.SHE'
    return f'{normalized}.US'


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
    entry.update(build_dividend_payload_from_quote(quote, stale_days))
    return entry


def merge_quote_snapshots(base_quotes, next_quotes, stale_days):
    merged = {**(base_quotes or {})}
    for symbol, next_quote in (next_quotes or {}).items():
        merged[symbol] = {**(merged.get(symbol) or {}), **(next_quote or {})}
    return {
        symbol: normalize_quote_entry(symbol, quote, stale_days)
        for symbol, quote in merged.items()
    }


def chunked(items, size):
    for index in range(0, len(items), size):
        yield items[index:index + size]


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
            if len(fields) < 4:
                continue

            symbol = tencent_code_map.get(raw_symbol, from_tencent_symbol(raw_symbol))
            market, currency = infer_market_currency(symbol)
            price = safe_float(fields[3], safe_float(fields[4], 0))
            name = str(fields[1] or symbol).strip()

            if price <= 0:
                continue

            quotes[symbol] = {
                'symbol': symbol,
                'name': name,
                'market': market,
                'currency': currency,
                'price': round(price, 6)
            }

    return quotes


def sum_ttm_dividends_from_yahoo(dividend_events):
    if not dividend_events:
        return 0.0
    threshold = utc_now() - timedelta(days=365)
    total = 0.0
    for event in dividend_events.values():
        amount = safe_float(event.get('amount'), 0.0)
        event_dt = parse_date_value(event.get('date'))
        if amount <= 0 or event_dt is None:
            continue
        if event_dt >= threshold:
            total += amount
    return round(total, 6)


def latest_ex_date_from_yahoo(dividend_events):
    latest_dt = None
    for event in (dividend_events or {}).values():
        event_dt = parse_date_value(event.get('date'))
        if event_dt is None:
            continue
        latest_dt = event_dt if latest_dt is None else max(latest_dt, event_dt)
    return latest_dt.date().isoformat() if latest_dt else ''


def sum_ttm_dividends_from_eodhd(events):
    threshold = utc_now() - timedelta(days=365)
    total = 0.0
    for event in events or []:
        amount = safe_float(
            event.get('value'),
            safe_float(event.get('unadjusted_value'), safe_float(event.get('unadjustedValue'), 0.0))
        )
        event_dt = parse_date_value(event.get('date'))
        if amount <= 0 or event_dt is None:
            continue
        if event_dt >= threshold:
            total += amount
    return round(total, 6)


def latest_ex_date_from_eodhd(events):
    latest_dt = None
    for event in events or []:
        event_dt = parse_date_value(event.get('date'))
        if event_dt is None:
            continue
        latest_dt = event_dt if latest_dt is None else max(latest_dt, event_dt)
    return latest_dt.date().isoformat() if latest_dt else ''


def fetch_yahoo_dividend_metrics(symbol, stale_days):
    yahoo_symbol = to_yahoo_symbol(symbol)
    payload = fetch_json(
        YAHOO_CHART_ENDPOINT.format(symbol=quote(yahoo_symbol, safe='')),
        params={'range': '2y', 'interval': '1d', 'events': 'div'}
    )
    result = ((payload.get('chart') or {}).get('result') or [None])[0] or {}
    events = (result.get('events') or {}).get('dividends') or {}
    return build_dividend_payload(
        dividend_per_share_ttm=sum_ttm_dividends_from_yahoo(events),
        dividend_source='yahoo',
        dividend_updated_at=utc_now_iso(),
        last_ex_date=latest_ex_date_from_yahoo(events),
        stale_days=stale_days
    )


def fetch_eodhd_dividend_metrics(symbol, api_key, stale_days):
    eodhd_symbol = to_eodhd_symbol(symbol)
    from_date = (datetime.now(LOCAL_TZ) - timedelta(days=730)).date().isoformat()
    payload = fetch_json(
        EODHD_DIVIDEND_ENDPOINT.format(symbol=quote(eodhd_symbol, safe='')),
        params={
            'from': from_date,
            'api_token': api_key,
            'fmt': 'json'
        }
    )
    if not isinstance(payload, list):
        raise ValueError(f'unexpected EODHD payload for {symbol}')
    return build_dividend_payload(
        dividend_per_share_ttm=sum_ttm_dividends_from_eodhd(payload),
        dividend_source='eodhd',
        dividend_updated_at=utc_now_iso(),
        last_ex_date=latest_ex_date_from_eodhd(payload),
        stale_days=stale_days
    )


def build_cached_dividend(previous_quote, config, error_text=''):
    previous_quote = previous_quote or {}
    return build_dividend_payload(
        dividend_per_share_ttm=previous_quote.get('dividendPerShareTtm'),
        dividend_source='cache',
        dividend_updated_at=previous_quote.get('dividendUpdatedAt'),
        last_ex_date=previous_quote.get('lastExDate'),
        stale_days=config['staleDays'],
        dividend_fetch_error=error_text
    )


def should_verify_with_eodhd(symbol, yahoo_payload, previous_quote, config, now_local):
    reasons = []
    yahoo_value = safe_float((yahoo_payload or {}).get('dividendPerShareTtm'), 0.0)
    previous_value = safe_float((previous_quote or {}).get('dividendPerShareTtm'), 0.0)

    if yahoo_value <= 0:
        reasons.append('yahoo-empty')

    if previous_value > 0 and yahoo_value > 0:
        if relative_change(yahoo_value, previous_value) > config['dividendChangeThreshold']:
            reasons.append('threshold-change')

    if symbol in set(config['coreSymbols']):
        reasons.append('core-symbol')

    if now_local.month in set(config['forceVerifyMonths']):
        reasons.append('force-month')

    return reasons


def resolve_dividend_for_symbol(symbol, previous_quote, config, eodhd_api_key, now_local):
    previous_quote = normalize_quote_entry(symbol, previous_quote or {}, config['staleDays'])
    yahoo_payload = None
    eodhd_payload = None
    yahoo_error = ''
    eodhd_error = ''

    try:
        yahoo_payload = fetch_with_retry(
            f'yahoo dividend {symbol}',
            fetch_yahoo_dividend_metrics,
            symbol,
            config['staleDays'],
            retries=2,
            delay_seconds=1
        )
    except Exception as error:
        yahoo_error = str(error)
        print(f'yahoo dividend refresh skipped for {symbol}: {error}')

    verify_reasons = should_verify_with_eodhd(symbol, yahoo_payload, previous_quote, config, now_local)
    if eodhd_api_key and verify_reasons:
        try:
            eodhd_payload = fetch_with_retry(
                f'eodhd dividend {symbol}',
                fetch_eodhd_dividend_metrics,
                symbol,
                eodhd_api_key,
                config['staleDays'],
                retries=2,
                delay_seconds=1
            )
        except Exception as error:
            eodhd_error = str(error)
            print(f'eodhd dividend verify skipped for {symbol}: {error}')

    yahoo_value = safe_float((yahoo_payload or {}).get('dividendPerShareTtm'), 0.0)
    eodhd_value = safe_float((eodhd_payload or {}).get('dividendPerShareTtm'), 0.0)
    cached_value = safe_float(previous_quote.get('dividendPerShareTtm'), 0.0)

    # Stage 2 rule:
    # manual override stays highest in frontend merge;
    # when verification is triggered and EODHD returns a valid value, EODHD may replace Yahoo;
    # otherwise Yahoo remains the daily default source.
    if verify_reasons and eodhd_value > 0:
        selected = eodhd_payload
    elif yahoo_value > 0:
        selected = yahoo_payload
    elif cached_value > 0:
        selected = build_cached_dividend(previous_quote, config)
    elif yahoo_payload is not None:
        selected = build_dividend_payload(
            dividend_per_share_ttm=0,
            dividend_source='yahoo',
            dividend_updated_at=yahoo_payload.get('dividendUpdatedAt'),
            last_ex_date=yahoo_payload.get('lastExDate'),
            stale_days=config['staleDays']
        )
    else:
        selected = build_cached_dividend(previous_quote, config)

    error_parts = []
    if selected['dividendSource'] == 'cache' and yahoo_payload is not None and yahoo_value <= 0:
        error_parts.append('Yahoo returned empty dividend result')
    if yahoo_error:
        error_parts.append(f'Yahoo: {yahoo_error}')
    if eodhd_error:
        error_parts.append(f'EODHD: {eodhd_error}')

    if selected['dividendSource'] == 'cache' and error_parts:
        selected['dividendFetchError'] = '; '.join(error_parts)[:300]

    return selected


def fetch_daily_dividend_metrics(watchlist, previous_quotes, config, eodhd_api_key):
    metrics = {}
    now_local = datetime.now(LOCAL_TZ)
    previous_quotes = previous_quotes or {}
    for symbol in watchlist:
        metrics[symbol] = resolve_dividend_for_symbol(
            symbol,
            previous_quotes.get(symbol) or {},
            config,
            eodhd_api_key,
            now_local
        )
    return metrics


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
    watchlist = load_watchlist()
    previous_snapshot = load_previous_snapshot()
    previous_quotes = previous_snapshot.get('quotes') or {}
    eodhd_api_key = str(os.getenv('EODHD_API_KEY', '') or '').strip()

    quotes = seed_quotes_from_previous(previous_snapshot, watchlist, config['staleDays'])
    rates = {**DEFAULT_RATES, **(previous_snapshot.get('rates') or {})}

    try:
        fresh_quotes = fetch_with_retry('tencent quotes', fetch_quotes, watchlist, retries=3, delay_seconds=2)
        quotes = merge_quote_snapshots(quotes, fresh_quotes, config['staleDays'])
    except Exception as error:
        print(f'quote refresh skipped: {error}')

    try:
        dividend_metrics = fetch_daily_dividend_metrics(watchlist, previous_quotes, config, eodhd_api_key)
        quotes = merge_quote_snapshots(quotes, dividend_metrics, config['staleDays'])
    except Exception as error:
        print(f'dividend refresh skipped: {error}')

    try:
        rates = fetch_with_retry('fx rates', fetch_rates, retries=3, delay_seconds=2)
    except Exception as error:
        print(f'fx refresh skipped: {error}')

    payload = {
        'ok': True,
        'provider': {
            'quote': 'tencent-finance',
            'fx': 'frankfurter',
            'dividend': 'yahoo-finance',
            'dividendVerify': 'eodhd' if eodhd_api_key else 'disabled'
        },
        'updatedAt': utc_now_iso(),
        'rates': rates,
        'quotes': quotes
    }
    OUTPUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'updated {len(quotes)} quotes into {OUTPUT_PATH}')


if __name__ == '__main__':
    main()
