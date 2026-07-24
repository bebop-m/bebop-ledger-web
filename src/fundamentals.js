/* ── 公司基本面：历年每股股息 / 分红率 / 负债率 / EPS ──
   数据来自 data/fundamentals.json（scripts/update_fundamentals.py 每日复核年报口径数据）。
   本模块自持 DOM 容器，懒加载 + localStorage 离线缓存。 */
import { state, refs } from './state.js';
import { safeNumber, escapeHtml, formatDateLabel, resolveFxRate } from './utils.js';
import { computeHoldings, inferQuote } from './compute.js';
import { FUNDAMENTALS_ENDPOINT } from './constants.js';

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
    _data = {
      updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : '',
      provider: typeof payload.provider === 'string' ? payload.provider : '',
      companies: payload.companies
    };
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

// 当前选中的基本面公司 symbol，供财报日历高亮「自家」。
export function getSelectedFundamentalsSymbol() {
  return _selectedSymbol;
}

export function getFundamentalsCompanyCount() {
  return _data ? Object.keys(_data.companies).length : 0;
}

export function getFundamentalsMeta() {
  return {
    updatedAt: _data && typeof _data.updatedAt === 'string' ? _data.updatedAt : '',
    provider: _data && typeof _data.provider === 'string' ? _data.provider : '',
    loading: _loading,
    error: _loadError
  };
}

/* 只读访问单家公司的基本面原始数据（纪律检查等跨页功能使用）。 */
export function getCompanyFundamentals(symbol) {
  return (_data && _data.companies && _data.companies[symbol]) || null;
}

/* 公司分组：当前持仓按市值降序在前；观察/已清仓标的默认折叠在「更多」里。 */
function getGroupedCompanies() {
  if (!_data) return { holdings: [], others: [] };
  const companies = _data.companies;
  const holdings = [];
  const seen = new Set();
  computeHoldings().holdings
    .slice()
    .sort((a, b) => safeNumber(b.marketValueCny, 0) - safeNumber(a.marketValueCny, 0))
    .forEach((holding) => {
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

function getCagrModel(rows, key) {
  const available = rows.filter((row) => isFiniteValue(row[key]) && Number(row[key]) > 0).slice(-6);
  if (available.length < 3) return null;
  const latest = available[available.length - 1];
  const candidates = available.filter((row) => latest.year - row.year >= 2 && latest.year - row.year <= 5);
  if (!candidates.length) return null;
  const first = candidates[0];
  const span = latest.year - first.year;
  const cagr = Math.pow(Number(latest[key]) / Number(first[key]), 1 / span) - 1;
  const previous = available[available.length - 2];
  const latestChange = previous && Number(previous[key]) > 0 ? Number(latest[key]) / Number(previous[key]) - 1 : null;
  return { cagr, span, firstYear: first.year, lastYear: latest.year, latestChange };
}

function getShareCountModel(rows) {
  const model = getCagrModel(rows, 'sharesOutstanding');
  if (!model) return null;
  // 极端跳变通常是拆股或口径变化，不能当成真实回购/稀释。
  if (!Number.isFinite(model.cagr) || Math.abs(model.cagr) > 0.5) return null;
  return { ...model, netBuybackYield: -model.cagr };
}

function getModelConfidence(growth) {
  if (!growth) return { level: 'low', reason: '增长历史不足三个完整年度' };
  if (growth.span >= 5 && (growth.latestChange === null || growth.latestChange >= 0)) {
    return { level: 'high', reason: '覆盖至少五年，最近一年未反转' };
  }
  if (growth.span >= 3 && (growth.latestChange === null || growth.latestChange > -0.10)) {
    return { level: 'medium', reason: growth.latestChange < 0 ? '最近一年小幅回落' : '覆盖三个以上完整年度' };
  }
  if (growth.latestChange !== null && growth.latestChange <= -0.10) {
    return { level: 'low', reason: `最近一年同比下降 ${Math.abs(growth.latestChange * 100).toFixed(1)}%` };
  }
  return { level: 'low', reason: '历史周期不足五年' };
}

/* ── 历史经营回报参考 ──
   首选「股息率 + 净利润增长 + 实际股本减少率」，避免 EPS 已含回购影响后再加回购的重复计算。
   净利润或股本缺失时退回「股息率 + EPS 增速」，此时不再单独加回购。
   这是基于历史事实的自动参考，不包装成未来预测。 */
export function getCompanyReturnModel(symbol) {
  const company = _data && _data.companies ? _data.companies[symbol] : null;
  if (!company || !Array.isArray(company.years)) return null;
  const currentYear = new Date().getFullYear();
  const rows = company.years
    .filter((row) => row && safeNumber(row.year, 0) > 0 && row.year < currentYear)
    .slice()
    .sort((a, b) => a.year - b.year);
  const hasFinancials = rows.some((row) => isFiniteValue(row.netIncome) || isFiniteValue(row.eps));
  if (!rows.length || !hasFinancials) return null;
  const price = safeNumber(inferQuote(symbol).price, 0);
  if (price <= 0) return null;

  let dividendYield = 0;
  let dividendYear = null;
  let specialExcluded = false;
  const divRows = rows.filter((row) => safeNumber(row.dividendPerShare, 0) > 0);
  if (divRows.length) {
    const divRow = divRows[divRows.length - 1];
    // 最近两个完整年度内有派息才视为持续派息，否则按 0 处理。
    if (divRow.year >= currentYear - 2) {
      const special = safeNumber(divRow.specialDividendPerShare, 0);
      dividendYield = Math.max(0, safeNumber(divRow.dividendPerShare, 0) - special) / price;
      dividendYear = divRow.year;
      specialExcluded = special > 0;
    }
  }

  const profitGrowth = getCagrModel(rows, 'netIncome');
  const epsGrowth = getCagrModel(rows, 'eps');
  const shareModel = getShareCountModel(rows);
  const canUseProfitBridge = Boolean(profitGrowth && shareModel);
  const mode = canUseProfitBridge ? 'profitBridge' : 'epsDirect';
  const growth = canUseProfitBridge ? profitGrowth : epsGrowth;
  const netBuybackYield = canUseProfitBridge ? shareModel.netBuybackYield : null;
  const confidence = getModelConfidence(growth);
  const historicalReturn = growth
    ? dividendYield + growth.cagr + (netBuybackYield === null ? 0 : netBuybackYield)
    : null;
  return {
    symbol,
    dividendYield,
    dividendYear,
    specialExcluded,
    mode,
    growthRate: growth ? growth.cagr : null,
    growthSpan: growth ? growth.span : 0,
    latestGrowth: growth ? growth.latestChange : null,
    netBuybackYield,
    buybackSpan: shareModel ? shareModel.span : 0,
    confidence: confidence.level,
    confidenceReason: confidence.reason,
    historicalReturn,
    // 兼容组合汇总调用；语义已经从「预期」改为历史经营回报参考。
    expectedReturn: historicalReturn
  };
}

/* ── 股息率历史分位：打工仓估值回归信号 ──
   历年股息率 = 当年常规派息 ÷ 当年均价（同为交易币种、同为拆股修正口径）；
   当前股息率与历史序列比较，分位越高 = 现价越便宜。至少 5 个完整年度才计算。 */
export function getDividendYieldPercentile(symbol) {
  const company = _data && _data.companies ? _data.companies[symbol] : null;
  if (!company || !Array.isArray(company.years)) return null;
  const currentYear = new Date().getFullYear();
  const series = company.years
    .filter((row) => row && row.year < currentYear
      && safeNumber(row.dividendPerShare, 0) > 0 && safeNumber(row.avgPrice, 0) > 0)
    .map((row) => Math.max(0, safeNumber(row.dividendPerShare, 0) - safeNumber(row.specialDividendPerShare, 0))
      / safeNumber(row.avgPrice, 0))
    .filter((value) => value > 0);
  if (series.length < 5) return null;
  const model = getCompanyReturnModel(symbol);
  if (!model || !(model.dividendYield > 0)) return null;
  const current = model.dividendYield;
  const below = series.filter((value) => value < current).length;
  const sorted = series.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return {
    symbol,
    currentYield: current,
    percentile: below / series.length,
    medianYield: median,
    years: series.length
  };
}

/* 组合加权历史经营回报：只纳入中/高置信度公司，coverage 标注覆盖比例。 */
export function getPortfolioReturnSummary() {
  const groups = {
    all: { value: 0, covered: 0, weighted: 0 },
    core: { value: 0, covered: 0, weighted: 0 },
    income: { value: 0, covered: 0, weighted: 0 }
  };
  computeHoldings().holdings.forEach((holding) => {
    const value = safeNumber(holding.marketValueCny, 0);
    if (value <= 0) return;
    const bucket = holding.bucket === 'income' ? 'income' : 'core';
    groups.all.value += value;
    groups[bucket].value += value;
    const model = getCompanyReturnModel(holding.symbol);
    // 低置信度历史增长不进入组合结论，避免短周期高增速支配整体结果。
    if (!model || model.historicalReturn === null || model.confidence === 'low') return;
    [groups.all, groups[bucket]].forEach((group) => {
      group.covered += value;
      group.weighted += model.historicalReturn * value;
    });
  });
  const rate = (group) => (group.covered > 0 ? group.weighted / group.covered : null);
  return {
    all: rate(groups.all),
    core: rate(groups.core),
    income: rate(groups.income),
    coverage: groups.all.value > 0 ? groups.all.covered / groups.all.value : 0
  };
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

/* 分红 / EPS 线图：y 轴 min–max 自适应量程（非零基线，每点标值不构成误导，
   与收益率趋势的零轴规则不同，勿混用）。 */
function buildMinMaxChartSvg(rows, key, kind, label) {
  const points = [];
  rows.forEach((row, index) => { if (isFiniteValue(row[key])) points.push({ index, value: Number(row[key]) }); });
  if (points.length < 2) return '';
  const values = points.map((point) => point.value);
  let minValue = Math.min(...values);
  let maxValue = Math.max(...values);
  if (minValue === maxValue) { const bump = Math.abs(minValue) * 0.1 || 1; minValue -= bump; maxValue += bump; }
  const pad = (maxValue - minValue) * 0.16;
  minValue -= pad; maxValue += pad;
  const range = maxValue - minValue || 1;
  const innerW = CHART_W - CHART_PAD_X * 2;
  const innerH = CHART_H - CHART_PAD_TOP - CHART_PAD_BOTTOM;
  const total = rows.length;
  const toX = (index) => (total <= 1 ? CHART_W / 2 : CHART_PAD_X + (innerW * index) / (total - 1));
  const toY = (value) => CHART_PAD_TOP + ((maxValue - value) / range) * innerH;
  const coords = points.map((point) => ({ x: roundSvg(toX(point.index)), y: roundSvg(toY(point.value)), value: point.value }));
  const polyline = coords.map((coord) => `${coord.x},${coord.y}`).join(' ');
  const circles = coords.map((coord, i) => `<circle cx="${coord.x}" cy="${coord.y}" r="${i === coords.length - 1 ? 4 : 3}"></circle>`).join('');
  const labels = coords.map((coord, i) => {
    const anchor = coord.x < CHART_PAD_X + 20 ? 'start' : coord.x > CHART_W - CHART_PAD_X - 20 ? 'end' : 'middle';
    return `<text x="${coord.x}" y="${Math.max(11, coord.y - 9)}" text-anchor="${anchor}"${i === coords.length - 1 ? ' class="is-latest"' : ''}>${escapeHtml(formatMetricValue(coord.value, kind))}</text>`;
  }).join('');
  return `<svg class="fund-chart-svg fund-line-svg" viewBox="0 0 ${CHART_W} ${CHART_H}" role="img" aria-label="${escapeHtml(label)}历年走势">
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
  if (previous && !metric.noTrend) {
    // 百分比类指标看百分点差（pp）；金额类看相对变化。
    const isPercent = metric.kind === 'percent';
    const delta = isPercent
      ? Number(latest.value) - Number(previous.value)
      : (Number(previous.value) !== 0
        ? (Number(latest.value) - Number(previous.value)) / Math.abs(Number(previous.value))
        : null);
    if (delta !== null && Number.isFinite(delta)) {
      const up = delta > 0;
      // 负债率上升不是好事，用中性色；其余指标涨=红、跌=绿（A 股习惯）。
      const toneClass = metric.neutralTrend ? 'is-flat' : (up ? 'is-gain' : (delta < 0 ? 'is-loss' : 'is-flat'));
      trendHtml = `<span class="fund-card-trend ${toneClass}">${up ? '+' : ''}${(delta * 100).toFixed(1)}${isPercent ? 'pp' : '%'} <small>同比</small></span>`;
    }
  }
  let companionHtml = '';
  if (metric.companion) {
    const { latest: companionLatest } = getLatestPair(rows, metric.companion.key);
    if (companionLatest) {
      companionHtml = `<div class="fund-card-companion">
        <span>${escapeHtml(metric.companion.label)}${metric.companion.hint ? ` <small>${escapeHtml(metric.companion.hint)}</small>` : ''}</span>
        <strong>${escapeHtml(formatMetricValue(companionLatest.value, metric.companion.kind))}${companionLatest.year !== latest.year ? ` <small>${companionLatest.year}</small>` : ''}</strong>
      </div>`;
    }
  }
  const chart = buildMetricChartSvg(rows, metric);
  return `<section class="fund-card">
    <header class="fund-card-head">
      <span class="fund-card-label">${escapeHtml(metric.label)}${metric.unit ? ` <small>${escapeHtml(metric.unit)}</small>` : ''}</span>
      <span class="fund-card-latest"><strong>${escapeHtml(formatMetricValue(latest.value, metric.kind))}</strong><small>${latest.year}</small></span>
      ${trendHtml}
    </header>
    ${companionHtml}
    ${chart || '<p class="fund-card-empty">数据点不足，暂不画线</p>'}
    <div class="fund-chart-years">${rows.map((row) => `<span>${String(row.year).slice(2)}</span>`).join('')}</div>
  </section>`;
}

/* 派生指标：股息率 = 当年常规派息 ÷ 当年均价（同币种，剔除股价单点噪声）；
   EPS增速 = 同比。当前年派息只是「至今」，股息率会误导，置空。 */
function enrichYearRows(allRows, currentYear) {
  const byYear = new Map(allRows.map((row) => [row.year, row]));
  return allRows.map((row) => {
    const regular = Math.max(0, safeNumber(row.dividendPerShare, 0) - safeNumber(row.specialDividendPerShare, 0));
    const avgPrice = safeNumber(row.avgPrice, 0);
    const previous = byYear.get(row.year - 1);
    const epsNow = Number(row.eps);
    const epsPrev = previous ? Number(previous.eps) : NaN;
    return {
      ...row,
      dividendYield: row.year < currentYear && regular > 0 && avgPrice > 0 ? regular / avgPrice : null,
      epsGrowth: Number.isFinite(epsNow) && Number.isFinite(epsPrev) && epsPrev > 0 ? epsNow / epsPrev - 1 : null
    };
  });
}

function buildCompanyMetrics(company) {
  const currentYear = new Date().getFullYear();
  const allRows = enrichYearRows((Array.isArray(company.years) ? company.years : [])
    .filter((row) => row && safeNumber(row.year, 0) > 0)
    .slice()
    .sort((a, b) => a.year - b.year), currentYear);
  // 当前年份的股息只是「至今」累计，进线图会误导趋势判断，只在表格里展示。
  const rows = allRows.filter((row) => row.year < currentYear);
  // companion：主指标之外的同框架附属读数（如每股股息旁边的股息率）。
  const metrics = [
    { key: 'dividendPerShare', label: '每股股息', unit: company.currency, kind: 'money',
      companion: { key: 'dividendYield', label: '股息率', hint: '常规派息 ÷ 当年均价', kind: 'percent' } },
    { key: 'payoutRatio', label: '分红率', unit: '股息 / 当期净利', kind: 'percent' },
    { key: 'debtRatio', label: '负债率', unit: '总负债 / 总资产', kind: 'percent', neutralTrend: true },
    // 增速本身就是同比，再叠一个「同比的同比」没有意义，关掉趋势角标。
    { key: 'epsGrowth', label: 'EPS增速', unit: '同比', kind: 'percent', noTrend: true,
      companion: { key: 'eps', label: 'EPS', hint: company.statementCurrency || company.currency, kind: 'money' } }
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
  const yieldRank = getDividendYieldPercentile(company.symbol);
  if (yieldRank) parts.push(`现价股息率高于过去 ${yieldRank.years} 年中 ${Math.round(yieldRank.percentile * 100)}% 的年份`);
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

function formatSignedPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

/* 公式结论行：自动选择净利润桥或 EPS 直接法，避免重复计算回购。 */
function buildFormulaBlock(company) {
  const model = getCompanyReturnModel(company.symbol);
  if (!model) return '';
  const notes = [];
  if (model.dividendYear) {
    notes.push(`股息按 ${model.dividendYear} 年常规派息 ÷ 现价${model.specialExcluded ? '，已剔除特别股息' : ''}`);
  } else {
    notes.push('近两年无派息，股息按 0 计');
  }
  if (model.mode === 'profitBridge') {
    notes.push(`净利润 ${model.growthSpan} 年年化`);
    notes.push(`净回购按总股本 ${model.buybackSpan} 年变化`);
  } else {
    notes.push(model.growthRate === null ? 'EPS 增速暂不可算' : `EPS ${model.growthSpan} 年年化，已包含回购影响`);
  }
  const confidenceLabel = model.confidence === 'high' ? '高' : model.confidence === 'medium' ? '中' : '低';
  notes.push(`置信度 ${confidenceLabel}：${model.confidenceReason}`);
  notes.push('历史参考，不是未来预测');
  const parts = [
    { label: '股息率', value: model.dividendYield, tone: 'iris' },
    { label: model.mode === 'profitBridge' ? '净利润增长' : 'EPS 增长', value: model.growthRate, tone: 'iris-soft' }
  ];
  if (model.mode === 'profitBridge') parts.push({ label: '净回购', value: model.netBuybackYield, tone: 'ink' });
  const denominator = parts.reduce((sum, item) => sum + Math.abs(safeNumber(item.value, 0)), 0) || 1;
  return `<div class="fund-formula ledger-fund-focus">
    <span class="ledger-eyebrow">历史经营回报参考</span>
    <strong class="fund-formula-total${model.historicalReturn === null ? ' is-empty' : ''}">${model.historicalReturn === null ? '—' : `≈ ${formatSignedPercent(model.historicalReturn)}`}</strong>
    <p class="fund-formula-note">股息 + 增长${model.mode === 'profitBridge' ? ' + 净回购' : ''} · 历史参考，并非未来预测</p>
    <div class="fund-return-stack">${parts.map((item) => `<i class="is-${item.tone}" style="width:${(Math.abs(safeNumber(item.value, 0)) / denominator * 100).toFixed(2)}%"></i>`).join('')}</div>
    <div class="fund-return-rows">${parts.map((item) => `<div><span><i class="is-${item.tone}"></i>${item.label}</span><strong>${item.value === null ? '—' : formatSignedPercent(item.value)}</strong></div>`).join('')}</div>
    <p class="fund-method-note">${escapeHtml(notes.join(' · '))}</p>
  </div>`;
}

function buildDividendBars(company, visible) {
  const available = visible.filter((row) => row.dividendPerShare !== null && row.dividendPerShare !== undefined);
  if (!available.length) return '';
  const max = Math.max(1, ...available.map((row) => Math.abs(safeNumber(row.dividendPerShare, 0))));
  const latest = available[available.length - 1];
  const growthStreak = getGrowthStreak(visible, 'dividendPerShare');
  return `<section class="fund-eps-section fund-dividend-section">
    <div class="fund-eps-head"><p class="ledger-eyebrow">每股分红</p><strong class="fund-bar-latest">${escapeHtml(formatMetricValue(latest.dividendPerShare, 'money'))} ${escapeHtml(company.currency)}<small>股息率 ${escapeHtml(formatMetricValue(latest.dividendYield, 'percent'))}</small></strong></div>
    ${buildMinMaxChartSvg(visible, 'dividendPerShare', 'money', '每股分红')}
    <div class="fund-chart-years">${visible.map((row) => `<span>${row.year}</span>`).join('')}</div>
    <div class="fund-eps-stats fund-eps-stats--dividend">
      <div><span>特别股息</span><strong>${escapeHtml(formatMetricValue(latest.specialDividendPerShare, 'money'))}</strong></div>
      <div><span>连续增长</span><strong>${growthStreak > 0 ? `${growthStreak} 年` : '—'}</strong></div>
    </div>
  </section>`;
}

function buildEpsLedger(company, visible) {
  const available = visible.filter((row) => row.eps !== null && row.eps !== undefined);
  if (!available.length) return '';
  const max = Math.max(1, ...available.map((row) => Math.abs(safeNumber(row.eps, 0))));
  const latest = available[available.length - 1];
  const previous = available.length > 1 ? available[available.length - 2] : null;
  const latestGrowth = previous && safeNumber(previous.eps, 0) !== 0
    ? (safeNumber(latest.eps, 0) - safeNumber(previous.eps, 0)) / Math.abs(safeNumber(previous.eps, 0))
    : null;
  const growthTone = latestGrowth === null ? 'is-flat' : latestGrowth > 0 ? 'is-gain' : latestGrowth < 0 ? 'is-loss' : 'is-flat';
  const growthText = latestGrowth === null ? '' : `${latestGrowth > 0 ? '+' : latestGrowth < 0 ? '−' : ''}${Math.abs(latestGrowth * 100).toFixed(1)}%`;
  return `<section class="fund-eps-section">
    <div class="fund-eps-head"><p class="ledger-eyebrow">EPS 每股收益</p><strong class="fund-bar-latest ${growthTone}">${growthText ? escapeHtml(growthText) : '—'}<small>EPS ${escapeHtml(formatMetricValue(latest.eps, 'money'))} ${escapeHtml(company.statementCurrency || company.currency)}</small></strong></div>
    ${buildMinMaxChartSvg(visible, 'eps', 'money', 'EPS')}
    <div class="fund-chart-years">${visible.map((row) => `<span>${row.year}</span>`).join('')}</div>
    <div class="fund-eps-stats">
      <div><span>分红率</span><strong>${escapeHtml(formatMetricValue(latest.payoutRatio, 'percent'))}</strong></div>
      <div><span>负债率</span><strong>${escapeHtml(formatMetricValue(latest.debtRatio, 'percent'))}</strong></div>
    </div>
  </section>`;
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

// 九家速览横滑条：按历史经营回报降序，名+%，当前金点，点击切换公司。
function buildFundamentalsRail(allCompanies) {
  const items = allCompanies
    .map((company) => {
      const model = getCompanyReturnModel(company.symbol);
      return { symbol: company.symbol, name: getCompanyDisplayName(company), rate: model ? model.historicalReturn : null };
    })
    .filter((item) => item.rate !== null && item.rate !== undefined)
    .sort((a, b) => b.rate - a.rate);
  if (items.length < 2) return '';
  return `<div class="fund-rail" role="tablist" aria-label="按经营回报速览切换公司">
    ${items.map((item) => `<button class="fund-rail-item${item.symbol === _selectedSymbol ? ' is-current' : ''}" type="button" role="tab" aria-selected="${item.symbol === _selectedSymbol}" data-fund-select="${escapeHtml(item.symbol)}">
      <span class="fund-rail-name">${escapeHtml(item.name)}</span>
      <span class="fund-rail-rate num">${formatSignedPercent(item.rate)}</span>
    </button>`).join('')}
  </div>`;
}

// 组合锚：组合加权历史经营回报 + 本公司在全部有回报公司中的名次。
function buildPortfolioAnchor(company, allCompanies) {
  const portfolio = getPortfolioReturnSummary();
  if (portfolio.all === null) return '';
  const ranked = allCompanies
    .map((item) => ({ symbol: item.symbol, rate: (getCompanyReturnModel(item.symbol) || {}).historicalReturn }))
    .filter((item) => item.rate !== null && item.rate !== undefined)
    .sort((a, b) => b.rate - a.rate);
  const idx = ranked.findIndex((item) => item.symbol === company.symbol);
  const rankText = idx >= 0 ? ` · 本公司列 ${ranked.length} 家中第 ${idx + 1}` : '';
  return `<p class="fund-portfolio-anchor">组合加权 <strong>${formatSignedPercent(portfolio.all)}/年</strong>${rankText}</p>`;
}

// 估值节：市盈率（现价÷最新EPS，币种折算）+ 股息率分位「贵⇄便宜」标尺。
function buildValuationSection(company, rows) {
  const priceLocal = safeNumber(inferQuote(company.symbol).price, 0);
  const epsRows = rows.filter((row) => row.eps !== null && row.eps !== undefined);
  const eps = epsRows.length ? safeNumber(epsRows[epsRows.length - 1].eps, 0) : 0;
  const priceCny = priceLocal * resolveFxRate(company.currency, state.rates);
  const epsCny = eps * resolveFxRate(company.statementCurrency || company.currency, state.rates);
  const pe = epsCny > 0 && priceCny > 0 ? priceCny / epsCny : null;
  const yieldRank = getDividendYieldPercentile(company.symbol);
  // PE 历史分位需要历史年末价格序列，数据不足则该行只显示当前 PE 值、不画标尺。
  const peRow = `<div class="fund-val-row">
    <div class="fund-val-head"><span>市盈率 PE</span><strong class="num">${pe === null ? '—' : pe.toFixed(1)}</strong></div>
    <p class="fund-val-note">现价 ÷ 最新 EPS（币种已折算）· 缺历史年末价，暂不评估分位</p>
  </div>`;
  let yieldRow;
  if (yieldRank) {
    const cheap = yieldRank.percentile >= 0.5;
    const dotPct = Math.min(98, Math.max(2, yieldRank.percentile * 100));
    yieldRow = `<div class="fund-val-row">
      <div class="fund-val-head"><span>股息率</span><strong class="num">${(yieldRank.currentYield * 100).toFixed(2)}%</strong><em class="fund-val-verdict ${cheap ? 'is-cheap' : 'is-rich'}">${cheap ? '偏便宜' : '偏贵'}</em></div>
      <div class="fund-val-ruler" role="img" aria-label="股息率分位 ${Math.round(yieldRank.percentile * 100)}%，越右越便宜"><span class="fund-val-ruler-end">贵</span><span class="fund-val-ruler-track"><i style="left:${dotPct.toFixed(1)}%"></i></span><span class="fund-val-ruler-end">便宜</span></div>
      <p class="fund-val-note">现价股息率高于过去 ${yieldRank.years} 年中 ${Math.round(yieldRank.percentile * 100)}% 的年份</p>
    </div>`;
  } else {
    yieldRow = `<div class="fund-val-row">
      <div class="fund-val-head"><span>股息率</span><strong class="num">—</strong></div>
      <p class="fund-val-note">完整年度不足 5 年，暂不评估股息率分位</p>
    </div>`;
  }
  return `<section class="fund-valuation">
    <p class="ledger-eyebrow">估值</p>
    ${peRow}
    ${yieldRow}
  </section>`;
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
  const chartRows = rows.slice(-4);
  const summary = buildCompanySummary(company, rows);
  refs.fundamentalsContent.innerHTML = `
    ${buildFundamentalsRail(allCompanies)}
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
      ${buildFormulaBlock(company)}
      ${buildPortfolioAnchor(company, allCompanies)}
      ${summary ? `<p class="fund-company-summary">${escapeHtml(summary)}</p>` : ''}
    </section>
    ${buildValuationSection(company, allRows)}
    ${buildDividendBars(company, chartRows)}
    ${buildEpsLedger(company, chartRows)}
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
