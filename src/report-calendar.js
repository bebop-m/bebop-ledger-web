import { state, refs } from './state.js';
import { REPORT_CALENDAR_ENDPOINT } from './constants.js';
import { escapeHtml, formatDateLabel, normalizeSymbol, safeNumber } from './utils.js';
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

export function getReportHomeSummary() {
  const model = getCurrentMonthReportModel();
  if (!model.companyCount) return '';
  if (model.upcoming) {
    const date = `${Number(model.upcoming.reportDate.slice(5, 7))}月${Number(model.upcoming.reportDate.slice(8, 10))}日`;
    return `${model.label} ${model.companyCount}家 · 最近 ${model.upcoming.name} ${date}`;
  }
  return `${model.label} ${model.companyCount}家 · 本月已发布`;
}

function statusLabel(status) {
  if (status === 'confirmed') return '已确认';
  if (status === 'scheduled') return '预约';
  return '预计';
}

export function renderReportCalendarPanel() {
  if (!refs.reportCalendarPanel) return;
  const model = getCurrentMonthReportModel();
  const coverage = model.coverage.total > 0 ? `已收录 ${model.coverage.covered}/${model.coverage.total} 家` : '数据准备中';
  const rows = model.events.length
    ? model.events.map((event) => `<button class="report-event-row${event.isPast ? ' is-past' : ''}" type="button" data-report-symbol="${escapeHtml(event.symbol)}">
        <span class="report-event-date"><strong>${Number(event.reportDate.slice(8, 10))}</strong><small>${model.month}月</small></span>
        <span class="report-event-company"><strong>${escapeHtml(event.name)}</strong><small>${escapeHtml(event.reportType)} · ${escapeHtml(event.symbol)}</small></span>
        <span class="report-event-status is-${escapeHtml(event.dateStatus)}">${statusLabel(event.dateStatus)}</span>
      </button>`).join('')
    : '<div class="report-calendar-empty">本月暂未收录持仓财报日期</div>';
  refs.reportCalendarPanel.innerHTML = `<section class="panel report-calendar-panel-inner">
    <header class="report-calendar-head">
      <div><span>持仓财报</span><h3>${escapeHtml(model.label)}${model.companyCount ? ` · ${model.companyCount} 家` : ''}</h3></div>
      <small>${escapeHtml(coverage)}</small>
    </header>
    <div class="report-event-list">${rows}</div>
  </section>`;
}
