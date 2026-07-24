import { REPORT_CALENDAR_ENDPOINT } from './constants.js';
import { formatDateLabel, normalizeSymbol, safeNumber } from './utils.js';
import { computeHoldings, inferQuote } from './compute.js';

const CACHE_KEY = 'bopup-report-calendar-cache-v1';
let _data = null;
let _loading = false;

function localToday() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function readCache() {
  try {
    const value = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    return value && Array.isArray(value.events) ? value : null;
  } catch (_error) { return null; }
}

function sanitizePayload(payload) {
  if (!payload || !Array.isArray(payload.events)) return null;
  const events = payload.events.map((item) => {
    const symbol = normalizeSymbol(item && item.symbol);
    const reportDate = formatDateLabel(item && item.reportDate);
    if (!symbol || !reportDate) return null;
    return {
      symbol,
      reportDate,
      reportType: String(item.reportType || '财报').trim() || '财报',
      dateStatus: ['confirmed', 'scheduled', 'estimated'].includes(item.dateStatus) ? item.dateStatus : 'estimated',
      source: String(item.source || '').trim(),
      fiscalPeriodEnd: formatDateLabel(item.fiscalPeriodEnd),
      note: String(item.note || '').trim()
    };
  }).filter(Boolean);
  return {
    updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : '',
    symbolsTotal: Math.max(0, Math.floor(safeNumber(payload.symbolsTotal, 0))),
    symbolsCovered: Math.max(0, Math.floor(safeNumber(payload.symbolsCovered, 0))),
    events
  };
}

export async function loadReportCalendar(opts = {}) {
  if (_loading || (_data && opts.force !== true)) return _data;
  _loading = true;
  try {
    const response = await fetch(`${REPORT_CALENDAR_ENDPOINT}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`report calendar request failed: ${response.status}`);
    const payload = sanitizePayload(await response.json());
    if (!payload) throw new Error('invalid report calendar payload');
    _data = payload;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(payload)); } catch (_error) { /* ignore */ }
  } catch (error) {
    console.warn('report calendar load failed', error);
    if (!_data) _data = readCache();
  } finally {
    _loading = false;
  }
  return _data;
}

function getHoldingSymbols() {
  return new Set(computeHoldings().holdings
    .filter((holding) => safeNumber(holding.quantity, 0) > 0)
    .map((holding) => holding.symbol));
}

function displayName(symbol) {
  const quote = inferQuote(symbol);
  return String(quote.name || symbol).trim() || symbol;
}

export function getCurrentMonthReportModel(today = localToday()) {
  const monthKey = String(today).slice(0, 7);
  const month = Number(monthKey.slice(5, 7));
  const holdingSymbols = getHoldingSymbols();
  const events = (_data && _data.events || [])
    .filter((event) => holdingSymbols.has(event.symbol) && event.reportDate.startsWith(monthKey))
    .map((event) => ({ ...event, name: displayName(event.symbol), isPast: event.reportDate < today }))
    .sort((a, b) => `${a.reportDate}|${a.symbol}`.localeCompare(`${b.reportDate}|${b.symbol}`));
  const companies = new Set(events.map((event) => event.symbol));
  const upcoming = events.find((event) => event.reportDate >= today) || null;
  return {
    month,
    label: `${month}月财报`,
    companyCount: companies.size,
    events,
    upcoming,
    coverage: _data ? { covered: _data.symbolsCovered, total: _data.symbolsTotal } : { covered: 0, total: holdingSymbols.size },
    updatedAt: _data && _data.updatedAt || ''
  };
}

/* 未来财报（默认限当前持仓），按日期升序；symbol 传入时只看该公司。 */
export function getUpcomingReportEvents(opts = {}) {
  const { symbol = '', withinDays = 0, today = localToday() } = opts;
  const holdingSymbols = symbol ? null : getHoldingSymbols();
  const limit = withinDays > 0
    ? new Date(new Date(`${today}T00:00:00`).getTime() + withinDays * 86400000).toISOString().slice(0, 10)
    : '';
  return (_data && _data.events || [])
    .filter((event) => (symbol ? event.symbol === symbol : holdingSymbols.has(event.symbol)))
    .filter((event) => event.reportDate >= today && (!limit || event.reportDate <= limit))
    .map((event) => ({ ...event, name: displayName(event.symbol) }))
    .sort((a, b) => `${a.reportDate}|${a.symbol}`.localeCompare(`${b.reportDate}|${b.symbol}`));
}

export function getNextReportEvent(symbol) {
  return getUpcomingReportEvents({ symbol })[0] || null;
}

function formatShortDate(dateLabel) {
  return `${Number(dateLabel.slice(5, 7))}月${Number(dateLabel.slice(8, 10))}日`;
}

/* 首页摘要：本月有财报 →「7月财报 · N家」；本月没有 →「下场财报 腾讯控股 8月12日」。 */
export function getReportHomeSummary() {
  const model = getCurrentMonthReportModel();
  if (model.companyCount) {
    return model.upcoming ? `${model.label} · ${model.companyCount}家` : `${model.label} · 本月已发布`;
  }
  const next = getUpcomingReportEvents()[0];
  return next ? `下场财报 ${next.name} ${formatShortDate(next.reportDate)}` : '';
}
