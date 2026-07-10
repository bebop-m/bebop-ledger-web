"""Build a current-holdings financial-report calendar.

Sources, in descending confidence:
  - HKEX consolidated board-meeting notifications (confirmed)
  - Eastmoney mirror of CN exchange appointment dates (scheduled)
  - Yahoo/yfinance earnings calendar (estimated fallback)
  - data/report_override.json (manual corrections, always wins)
"""

import html
import json
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
import yfinance as yf

from update_market_data import load_symbol_universe, normalize_date_string, to_yfinance_symbol, utc_now_iso


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT / 'data' / 'report_calendar.json'
OVERRIDE_PATH = ROOT / 'data' / 'report_override.json'
EASTMONEY_ENDPOINT = 'https://datacenter-web.eastmoney.com/api/data/v1/get'
HKEX_BOARD_MEETING_URL = 'https://www.hkex-is.hk/wwwroot/link/ebmn.htm'
HEADERS = {'User-Agent': 'Mozilla/5.0 (compatible; bebop-ledger/1.0)'}
CACHE_HOURS = 18


def load_json(path, fallback):
    try:
        return json.loads(path.read_text(encoding='utf-8-sig'))
    except Exception:
        return fallback


def should_skip_cached():
    if os.environ.get('FORCE_REPORT_CALENDAR') == '1' or not OUTPUT_PATH.exists():
        return False
    payload = load_json(OUTPUT_PATH, {})
    try:
        updated = datetime.fromisoformat(str(payload.get('updatedAt') or '').replace('Z', '+00:00'))
        return datetime.now(timezone.utc) - updated < timedelta(hours=CACHE_HOURS)
    except Exception:
        return False


def clean_cell(value):
    return html.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', str(value or ''))).strip())


def normalize_event(symbol, report_date, report_type, status, source, **extra):
    date = normalize_date_string(report_date)
    if not symbol or not date:
        return None
    return {
        'symbol': symbol,
        'reportDate': date,
        'reportType': str(report_type or '财报').strip() or '财报',
        'dateStatus': status if status in {'confirmed', 'scheduled', 'estimated'} else 'estimated',
        'source': source,
        **{key: value for key, value in extra.items() if value not in (None, '')},
    }


def fetch_cn_events(symbol):
    code = symbol[:6]
    response = requests.get(
        EASTMONEY_ENDPOINT,
        params={
            'reportName': 'RPT_PUBLIC_BS_APPOIN',
            'columns': 'ALL',
            'pageSize': '20',
            'pageNumber': '1',
            'source': 'WEB',
            'client': 'WEB',
            'filter': f'(SECURITY_CODE="{code}")',
        },
        headers=HEADERS,
        timeout=15,
    )
    response.raise_for_status()
    rows = (response.json().get('result') or {}).get('data') or []
    type_names = {'1': '一季报', '2': '中报', '3': '三季报', '4': '年报'}
    events = []
    for row in rows:
        date = row.get('ACTUAL_PUBLISH_DATE') or row.get('APPOINT_PUBLISH_DATE') or row.get('FIRST_APPOINT_DATE')
        event = normalize_event(
            symbol,
            date,
            type_names.get(str(row.get('REPORT_TYPE')), '定期报告'),
            'confirmed' if str(row.get('IS_PUBLISH')) == '1' else 'scheduled',
            'eastmoney',
            fiscalPeriodEnd=normalize_date_string(row.get('REPORT_DATE')),
        )
        if event:
            events.append(event)
    return events


def infer_hk_report_type(purpose, period):
    value = f'{purpose} {period}'.upper()
    if 'QTR' in value or '3-MTH' in value:
        return '季报'
    if 'INT' in value or '6-MTH' in value:
        return '中期业绩'
    if 'Y.E.' in value or 'FIN RES' in value:
        return '全年业绩'
    return '业绩公告'


def fetch_hkex_events():
    response = requests.get(HKEX_BOARD_MEETING_URL, headers=HEADERS, timeout=15)
    response.raise_for_status()
    markup = response.content.decode('utf-8', 'replace')
    events = []
    for row_markup in re.findall(r'<tr[^>]*>(.*?)</tr>', markup, re.S | re.I):
        cells = [clean_cell(value) for value in re.findall(r'<td[^>]*>(.*?)</td>', row_markup, re.S | re.I)]
        if len(cells) < 6 or not re.fullmatch(r'\d{2}/\d{2}/\d{4}', cells[0]):
            continue
        code = re.sub(r'\D', '', cells[3]).zfill(5)
        if not code:
            continue
        day, month, year = cells[0].split('/')
        event = normalize_event(
            f'{code}.HK',
            f'{year}-{month}-{day}',
            infer_hk_report_type(cells[4], cells[5]),
            'confirmed',
            'hkex',
            purpose=cells[4],
            fiscalPeriod=cells[5],
        )
        if event:
            events.append(event)
    return events


def fetch_yahoo_events(symbols):
    start = datetime.now()
    end = start + timedelta(days=370)
    try:
        frame = yf.Calendars(start, end).get_earnings_calendar(limit=1000, filter_most_active=False)
    except Exception as error:
        print(f'yahoo earnings calendar skipped: {error}')
        return []
    wanted = {to_yfinance_symbol(symbol): symbol for symbol in symbols}
    events = []
    for row in frame.reset_index().to_dict(orient='records'):
        raw_symbol = str(row.get('Symbol') or row.get('symbol') or '').strip().upper()
        symbol = wanted.get(raw_symbol)
        if not symbol:
            continue
        raw_date = row.get('Event Start Date') or row.get('Earnings Date') or row.get('Start Date')
        event = normalize_event(symbol, raw_date, '业绩公告', 'estimated', 'yahoo')
        if event:
            events.append(event)
    return events


def merge_events(base, overrides):
    merged = {}
    for event in base:
        key = f"{event.get('symbol')}|{event.get('reportDate')}|{event.get('reportType')}"
        merged[key] = event
    for raw in overrides:
        if not isinstance(raw, dict):
            continue
        event = normalize_event(
            str(raw.get('symbol') or '').strip().upper(),
            raw.get('reportDate'),
            raw.get('reportType'),
            raw.get('dateStatus') or 'confirmed',
            'manual',
            fiscalPeriodEnd=normalize_date_string(raw.get('fiscalPeriodEnd')),
            note=str(raw.get('note') or '').strip(),
        )
        if not event:
            continue
        if raw.get('disabled') is True:
            for key in list(merged):
                if key.startswith(f"{event['symbol']}|") and event['reportDate'] in key:
                    merged.pop(key, None)
            continue
        key = str(raw.get('replaceKey') or f"{event['symbol']}|{event['reportDate']}|{event['reportType']}")
        merged[key] = event
    return sorted(merged.values(), key=lambda item: (item['reportDate'], item['symbol'], item['reportType']))


def main():
    if should_skip_cached():
        print('report calendar cache is still fresh; skip')
        return
    symbols = load_symbol_universe()
    previous = load_json(OUTPUT_PATH, {})
    events = []
    hk_symbols = {symbol for symbol in symbols if symbol.endswith('.HK')}
    cn_symbols = {symbol for symbol in symbols if symbol.endswith('.SH') or symbol.endswith('.SZ')}
    try:
        events.extend(event for event in fetch_hkex_events() if event['symbol'] in hk_symbols)
    except Exception as error:
        print(f'HKEX report calendar skipped: {error}')
    for symbol in sorted(cn_symbols):
        try:
            events.extend(fetch_cn_events(symbol))
        except Exception as error:
            print(f'CN report calendar skipped for {symbol}: {error}')
    events.extend(fetch_yahoo_events(symbols))

    today = datetime.now().date().isoformat()
    cutoff = (datetime.now().date() - timedelta(days=370)).isoformat()
    fresh_symbols = {event['symbol'] for event in events}
    for event in previous.get('events') or []:
        if event.get('symbol') not in fresh_symbols and str(event.get('reportDate') or '') >= cutoff:
            events.append(event)
    overrides = load_json(OVERRIDE_PATH, {}).get('events') or []
    events = [event for event in merge_events(events, overrides) if event['reportDate'] >= cutoff]
    covered = sorted({event['symbol'] for event in events if event['reportDate'] >= today})
    payload = {
        'ok': True,
        'updatedAt': utc_now_iso(),
        'symbolsTotal': len(symbols),
        'symbolsCovered': len(covered),
        'coveredSymbols': covered,
        'events': events,
    }
    OUTPUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'updated {len(events)} report events; future coverage {len(covered)}/{len(symbols)}')


if __name__ == '__main__':
    main()
