import { state, refs } from './state.js';
import { REPORT_CALENDAR_ENDPOINT } from './constants.js';
import { escapeHtml, formatDateLabel, normalizeSymbol, safeNumber } from './utils.js';
import { computeHoldings, inferQuote } from './compute.js';
import { getSelectedFundamentalsSymbol } from './fundamentals.js';

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

function statusLabel(status) {
  if (status === 'confirmed') return '已确认';
  if (status === 'scheduled') return '预约';
  return '预计';
}

/* 页尾折叠面板：未来 90 天的持仓财报，默认收起；覆盖率作小注。 */
export function renderReportCalendarPanel() {
  if (!refs.reportCalendarPanel) return;
  const model = getCurrentMonthReportModel();
  const events = getUpcomingReportEvents({ withinDays: 90 });
  const coverage = model.coverage.total > 0 ? `已收录 ${model.coverage.covered}/${model.coverage.total} 家，公告后自动补齐` : '数据准备中';
  const wasOpen = Boolean(refs.reportCalendarPanel.querySelector('details[open]'));
  const selectedSymbol = getSelectedFundamentalsSymbol();
  const rows = events.length
    ? events.map((event) => `<button class="report-event-row${event.symbol === selectedSymbol ? ' is-self' : ''}" type="button" data-report-symbol="${escapeHtml(event.symbol)}">
        <span class="report-event-date"><strong>${Number(event.reportDate.slice(8, 10))}</strong><small>${Number(event.reportDate.slice(5, 7))}月</small></span>
        <span class="report-event-company"><strong>${escapeHtml(event.name)}</strong><small>${escapeHtml(event.reportType)} · ${escapeHtml(event.symbol)}</small></span>
        <span class="report-event-status is-${escapeHtml(event.dateStatus)}">${statusLabel(event.dateStatus)}</span>
      </button>`).join('')
    : '<div class="report-calendar-empty">未来 90 天暂未收录持仓财报日期</div>';
  refs.reportCalendarPanel.innerHTML = `<details class="fund-fold"${wasOpen ? ' open' : ''}>
    <summary><span>持仓财报日历</span><small>${events.length ? `未来 90 天 · ${events.length} 场` : '暂无收录'}</small></summary>
    <div class="report-event-list">${rows}</div>
    <p class="report-calendar-coverage">${escapeHtml(coverage)}</p>
  </details>`;
}
