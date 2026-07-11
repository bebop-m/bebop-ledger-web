/* ── 公司基本面：历年每股股息 / 分红率 / 负债率 / EPS ──
   数据来自 data/fundamentals.json（scripts/update_fundamentals.py 每周抓取年报口径数据）。
   本模块自持 DOM 容器，懒加载 + localStorage 离线缓存。 */
import { state, refs } from './state.js';
import { safeNumber, escapeHtml, formatDateLabel } from './utils.js';
import { computeHoldings, inferQuote } from './compute.js';
import { FUNDAMENTALS_ENDPOINT } from './constants.js';
import { getNextReportEvent } from './report-calendar.js';

const CACHE_KEY = 'bopup-fundamentals-cache-v1';

let _data = null;          // { updatedAt, companies }
let _loading = false;
let _attempted = false;
let _loadError = '';
let _selectedSymbol = '';

function readCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (raw && raw.companies && typeof raw.companies === 'object') return raw;
  } catch (_error) { /* ignore */ }
  return null;
}

function writeCache(payload) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(payload)); } catch (_error) { /* ignore */ }
}

export async function loadFundamentals(opts = {}) {
  const { force = false } = opts;
  if (_loading || (_data && !force)) return;
  _loading = true; _attempted = true; _loadError = '';
  renderFundamentalsPage();
  try {
    const response = await fetch(FUNDAMENTALS_ENDPOINT + '?t=' + Date.now(), { cache: 'no-store' });
    if (!response.ok) throw new Error('fundamentals request failed: ' + response.status);
    const payload = await response.json();
    if (!payload || payload.ok === false || !payload.companies || typeof payload.companies !== 'object') {
      throw new Error('invalid fundamentals payload');
    }
    _data = { updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : '', companies: payload.companies };
    writeCache(_data);
  } catch (error) {
    console.warn('fundamentals load failed', error);
    _loadError = String((error && error.message) || error);
    if (!_data) _data = readCache();
  } finally {
    _loading = false;
    renderFundamentalsPage();
  }
}

export function selectFundamentalsSymbol(symbol) {
  if (!symbol || symbol === _selectedSymbol) return;
  _selectedSymbol = symbol;
  renderFundamentalsPage();
}

/* 公司选择弹窗的数据：持仓按市值降序在前（附市值），观察/已清仓排在后。 */
export function getFundamentalsPickerModel() {
  const { holdings, others } = getGroupedCompanies();
  const valueBySymbol = new Map(computeHoldings().holdings
    .map((holding) => [holding.symbol, safeNumber(holding.marketValueCny, 0)]));
  const toItem = (company) => ({
    symbol: company.symbol,
    name: getCompanyDisplayName(company),
    marketValueCny: valueBySymbol.get(company.symbol) || 0,
    selected: company.symbol === _selectedSymbol
  });
  return { holdings: holdings.map(toItem), others: others.map(toItem) };
}

export function getFundamentalsCompanyCount() {
  return _data ? Object.keys(_data.companies).length : 0;
}

/* 公司分组：当前持仓按市值降序在前；观察/已清仓标的默认折叠在「更多」里。 */
function getGroupedCompanies() {
  if (!_data) return { holdings: [], others: [] };
  const companies = _data.companies;
  const holdings = [];
  const seen = new Set();
  computeHoldings().holdings.forEach((holding) => {
    if (safeNumber(holding.quantity, 0) > 0 && companies[holding.symbol] && !seen.has(holding.symbol)) {
      seen.add(holding.symbol);
      holdings.push(companies[holding.symbol]);
    }
  });
  const others = Object.keys(companies).sort()
    .filter((symbol) => !seen.has(symbol))
    .map((symbol) => companies[symbol]);
  return { holdings, others };
}

// 展示名优先用行情里的中文名（yfinance 返回的多为英文名）。
function getCompanyDisplayName(company) {
  const quoteName = String(inferQuote(company.symbol).name || '').trim();
  if (quoteName && quoteName !== company.symbol && !/^未识别/.test(quoteName)) return quoteName;
  return company.name || company.symbol;
}

function isFiniteValue(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function formatMetricValue(value, kind) {
  if (!isFiniteValue(value)) return '—';
  const numeric = Number(value);
  if (kind === 'percent') return `${(numeric * 100).toFixed(1)}%`;
  const abs = Math.abs(numeric);
  const digits = abs >= 100 ? 1 : abs >= 10 ? 2 : 3;
  return numeric.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

// 连续增长年数：从最近一年往前数，每年都比上一年高才算。
function getGrowthStreak(rows, key) {
  const values = rows.map((row) => (isFiniteValue(row[key]) ? Number(row[key]) : null));
  let streak = 0;
  for (let index = values.length - 1; index > 0; index -= 1) {
    if (values[index] === null || values[index - 1] === null) break;
    if (values[index] <= values[index - 1]) break;
    streak += 1;
  }
  return streak;
}

const CHART_W = 720;
const CHART_H = 170;
const CHART_PAD_X = 34;
const CHART_PAD_TOP = 26;
const CHART_PAD_BOTTOM = 14;

function roundSvg(value) { return Math.round(value * 100) / 100; }

/* 单指标线图：横轴用全量年份序列（四张图对齐），纵轴含 0 基线；点上标数值。 */
function buildMetricChartSvg(rows, metric) {
  const points = [];
  rows.forEach((row, index) => {
    if (isFiniteValue(row[metric.key])) points.push({ index, value: Number(row[metric.key]) });
  });
  if (points.length < 2) return '';
  const values = points.map((point) => point.value);
  const minValue = Math.min(0, ...values);
  const maxValue = Math.max(0, ...values);
  const range = maxValue === minValue ? 1 : maxValue - minValue;
  const innerW = CHART_W - CHART_PAD_X * 2;
  const innerH = CHART_H - CHART_PAD_TOP - CHART_PAD_BOTTOM;
  const total = rows.length;
  const toX = (index) => (total <= 1 ? CHART_W / 2 : CHART_PAD_X + (innerW * index) / (total - 1));
  const toY = (value) => CHART_PAD_TOP + ((maxValue - value) / range) * innerH;
  const zeroY = roundSvg(toY(0));
  const coords = points.map((point) => ({ x: roundSvg(toX(point.index)), y: roundSvg(toY(point.value)), value: point.value }));
  const polyline = coords.map((c) => `${c.x},${c.y}`).join(' ');
  const circles = coords.map((c, i) => `<circle cx="${c.x}" cy="${c.y}" r="${i === coords.length - 1 ? 4 : 3}"></circle>`).join('');
  const labels = coords.map((c, i) => {
    const anchor = c.x < CHART_PAD_X + 20 ? 'start' : c.x > CHART_W - CHART_PAD_X - 20 ? 'end' : 'middle';
    return `<text x="${c.x}" y="${Math.max(11, c.y - 9)}" text-anchor="${anchor}"${i === coords.length - 1 ? ' class="is-latest"' : ''}>${escapeHtml(formatMetricValue(c.value, metric.kind))}</text>`;
  }).join('');
  return `<svg class="fund-chart-svg" viewBox="0 0 ${CHART_W} ${CHART_H}" role="img" aria-label="${escapeHtml(metric.label)}历年走势">
    <line class="fund-chart-zero" x1="${CHART_PAD_X - 6}" x2="${CHART_W - CHART_PAD_X + 6}" y1="${zeroY}" y2="${zeroY}"></line>
    <g class="fund-chart-series"><polyline points="${polyline}"></polyline>${circles}</g>
    <g class="fund-chart-labels">${labels}</g>
  </svg>`;
}

function getLatestPair(rows, key) {
  const values = rows
    .map((row) => ({ year: row.year, value: row[key] }))
    .filter((item) => isFiniteValue(item.value));
  return {
    latest: values.length ? values[values.length - 1] : null,
    previous: values.length > 1 ? values[values.length - 2] : null
  };
}

function buildMetricCard(rows, metric) {
  const { latest, previous } = getLatestPair(rows, metric.key);
  if (!latest) {
    return `<section class="fund-card is-empty">
      <header class="fund-card-head"><span class="fund-card-label">${escapeHtml(metric.label)}</span></header>
      <p class="fund-card-empty">暂无数据</p>
    </section>`;
  }
  let trendHtml = '';
  if (previous && Number(previous.value) !== 0) {
    const delta = (Number(latest.value) - Number(previous.value)) / Math.abs(Number(previous.value));
    const up = delta > 0;
    // 负债率上升不是好事，用中性色；其余指标涨=红、跌=绿（A 股习惯）。
    const toneClass = metric.neutralTrend ? 'is-flat' : (up ? 'is-gain' : (delta < 0 ? 'is-loss' : 'is-flat'));
    trendHtml = `<span class="fund-card-trend ${toneClass}">${up ? '+' : ''}${(delta * 100).toFixed(1)}% <small>同比</small></span>`;
  }
  const chart = buildMetricChartSvg(rows, metric);
  return `<section class="fund-card">
    <header class="fund-card-head">
      <span class="fund-card-label">${escapeHtml(metric.label)}${metric.unit ? ` <small>${escapeHtml(metric.unit)}</small>` : ''}</span>
      <span class="fund-card-latest"><strong>${escapeHtml(formatMetricValue(latest.value, metric.kind))}</strong><small>${latest.year}</small></span>
      ${trendHtml}
    </header>
    ${chart || '<p class="fund-card-empty">数据点不足，暂不画线</p>'}
    <div class="fund-chart-years">${rows.map((row) => `<span>${String(row.year).slice(2)}</span>`).join('')}</div>
  </section>`;
}

function buildCompanyMetrics(company) {
  const currentYear = new Date().getFullYear();
  const allRows = (Array.isArray(company.years) ? company.years : [])
    .filter((row) => row && safeNumber(row.year, 0) > 0)
    .slice()
    .sort((a, b) => a.year - b.year);
  // 当前年份的股息只是「至今」累计，进线图会误导趋势判断，只在表格里展示。
  const rows = allRows.filter((row) => row.year < currentYear);
  const metrics = [
    { key: 'dividendPerShare', label: '每股股息', unit: company.currency, kind: 'money' },
    { key: 'payoutRatio', label: '分红率', unit: '股息 / 当期净利', kind: 'percent' },
    { key: 'debtRatio', label: '负债率', unit: '总负债 / 总资产', kind: 'percent', neutralTrend: true },
    { key: 'eps', label: 'EPS', unit: company.statementCurrency || company.currency, kind: 'money' }
  ];
  return { rows, allRows, metrics, currentYear };
}

function buildCompanySummary(company, rows) {
  const parts = [];
  const dpsStreak = getGrowthStreak(rows, 'dividendPerShare');
  if (dpsStreak >= 1) parts.push(`股息连续 ${dpsStreak} 年提升`);
  const { latest: payout } = getLatestPair(rows, 'payoutRatio');
  if (payout) parts.push(`最新分红率 ${formatMetricValue(payout.value, 'percent')}`);
  const { latest: debt } = getLatestPair(rows, 'debtRatio');
  if (debt) parts.push(`负债率 ${formatMetricValue(debt.value, 'percent')}`);
  return parts.join(' · ');
}

function buildCompanyTable(allRows, metrics, currentYear) {
  if (!allRows.length) return '';
  const head = `<div class="fund-table-row fund-table-head" role="row">
    <div>年份</div>${metrics.map((metric) => `<div>${escapeHtml(metric.label)}</div>`).join('')}
  </div>`;
  const body = allRows.slice().reverse().map((row) => `<div class="fund-table-row" role="row">
    <div class="is-year">${row.year}${row.year === currentYear ? '<small>至今</small>' : ''}</div>
    ${metrics.map((metric) => `<div>${escapeHtml(formatMetricValue(row[metric.key], metric.kind))}</div>`).join('')}
  </div>`).join('');
  return `<section class="fund-table" role="table" aria-label="历年基本面数据">${head}${body}</section>`;
}

function getEmptyStateMarkup() {
  if (_loading) {
    return '<div class="empty-state empty-state--compact"><p class="empty-state-title">正在加载基本面数据…</p></div>';
  }
  return `<div class="empty-state empty-state--compact">
    <p class="empty-state-title">暂无基本面数据</p>
    <p class="empty-state-note">运行 scripts/update_fundamentals.py（或等待每周定时任务）生成 data/fundamentals.json 后，这里会展示历年股息、分红率、负债率与 EPS。${_loadError ? `<br>${escapeHtml(_loadError)}` : ''}</p>
  </div>`;
}

// 选中公司的下一场财报（有收录才显示）。
function buildNextReportLine(symbol) {
  const event = getNextReportEvent(symbol);
  if (!event) return '';
  const statusText = event.dateStatus === 'confirmed' ? '已确认' : event.dateStatus === 'scheduled' ? '预约' : '预计';
  const date = `${Number(event.reportDate.slice(5, 7))}月${Number(event.reportDate.slice(8, 10))}日`;
  return `<p class="fund-company-report">下场财报 <strong>${date}</strong> · ${escapeHtml(event.reportType)} · ${statusText}</p>`;
}

export function renderFundamentalsPage() {
  if (!refs.fundamentalsContent) return;
  // 首次进入时懒加载；失败后不自动重试，避免循环。
  if (!_data && !_loading && !_attempted && state.activePage === 'fundamentals') { void loadFundamentals(); return; }

  const { holdings, others } = getGroupedCompanies();
  const allCompanies = holdings.concat(others);
  if (!allCompanies.length) {
    refs.fundamentalsContent.innerHTML = getEmptyStateMarkup();
    if (refs.fundamentalsNote) refs.fundamentalsNote.textContent = '';
    return;
  }

  if (!_selectedSymbol || !allCompanies.some((company) => company.symbol === _selectedSymbol)) {
    _selectedSymbol = (holdings[0] || allCompanies[0]).symbol;
  }
  const company = allCompanies.find((item) => item.symbol === _selectedSymbol);

  const { rows, allRows, metrics, currentYear } = buildCompanyMetrics(company);
  const summary = buildCompanySummary(company, rows);
  refs.fundamentalsContent.innerHTML = `
    <section class="panel fund-head-panel">
      <div class="fund-company-head">
        <div>
          <button class="fund-company-trigger" type="button" data-fund-picker-open aria-haspopup="dialog" aria-label="切换公司">
            <h3 class="fund-company-name">${escapeHtml(getCompanyDisplayName(company))}</h3>
            <svg class="fund-company-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 9.5 12 15l5.5-5.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></path></svg>
            ${allCompanies.length > 1 ? `<span class="fund-company-count">${allCompanies.length} 家</span>` : ''}
          </button>
          <p class="fund-company-code">${escapeHtml(company.symbol)} · 股息按 ${escapeHtml(company.currency)}/股 · 财报币种 ${escapeHtml(company.statementCurrency || company.currency)}</p>
        </div>
      </div>
      ${summary ? `<p class="fund-company-summary">${escapeHtml(summary)}</p>` : ''}
      ${buildNextReportLine(company.symbol)}
    </section>
    <div class="fund-card-grid">
      ${metrics.map((metric) => buildMetricCard(rows, metric)).join('')}
    </div>
    <details class="fund-fold">
      <summary><span>年度数据明细</span><small>${allRows.length} 年</small></summary>
      ${buildCompanyTable(allRows, metrics, currentYear)}
    </details>
  `;
  if (refs.fundamentalsNote) {
    const updated = _data && _data.updatedAt ? formatDateLabel(_data.updatedAt) : '';
    refs.fundamentalsNote.textContent = updated ? `年报口径 · 数据更新 ${updated}` : '年报口径';
  }
}
