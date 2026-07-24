/* ── 公司基本面：历年每股股息 / 分红率 / 负债率 / EPS ──
   数据来自 data/fundamentals.json（scripts/update_fundamentals.py 每日复核年报口径数据）。
   本模块自持 DOM 容器，懒加载 + localStorage 离线缓存。 */
import { state, refs } from './state.js';
import { safeNumber, escapeHtml, formatDateLabel, resolveFxRate, resolveQuoteCurrency } from './utils.js';
import { computeHoldings, inferQuote } from './compute.js';
import { FUNDAMENTALS_ENDPOINT } from './constants.js';
import { getUpcomingReportEvents } from './report-calendar.js';

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
  const metrics = [
    { key: 'dividendPerShare', label: '每股股息', kind: 'money' },
    { key: 'dividendYield', label: '股息率', kind: 'percent' },
    { key: 'eps', label: 'EPS', kind: 'money' },
    { key: 'payoutRatio', label: '分红率', kind: 'percent' },
    { key: 'debtRatio', label: '负债率', kind: 'percent' }
  ];
  return { allRows, metrics, currentYear };
}

function buildCompanyTable(allRows, metrics, currentYear) {
  if (!allRows.length) return '';
  const head = `<div class="fu-table-row is-head" role="row">
    <div>年份</div>${metrics.map((metric) => `<div>${escapeHtml(metric.label)}</div>`).join('')}
  </div>`;
  const body = allRows.slice().reverse().map((row) => `<div class="fu-table-row" role="row">
    <div class="is-year">${row.year}${row.year === currentYear ? '<small>至今</small>' : ''}</div>
    ${metrics.map((metric) => `<div>${escapeHtml(formatMetricValue(row[metric.key], metric.kind))}</div>`).join('')}
  </div>`).join('');
  return `<div class="fu-table" role="table" aria-label="历年基本面数据">${head}${body}</div>`;
}

/* ══════════════════════════════════════════════════════════════════
   17-公司基本面 · 按 designs/禅意UI/17-公司基本面/定稿图.html 重排
   速览置顶 → 公司名 → 公式块 → 估值节 → 两张线图 → 折叠明细 → 财报日历。
   ══════════════════════════════════════════════════════════════════ */

/* 速览横滑条：所有能算出历史经营回报的公司，按回报降序。
   同时给公式块的「N 家中第 M」当排名底稿。 */
export function getFundamentalsRankModel() {
  const { holdings, others } = getGroupedCompanies();
  return holdings.concat(others)
    .map((company) => {
      const model = getCompanyReturnModel(company.symbol);
      return model && model.historicalReturn !== null
        ? { symbol: company.symbol, name: getCompanyDisplayName(company), historicalReturn: model.historicalReturn }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.historicalReturn - a.historicalReturn);
}

/* 市盈率与历史分位：现价 ÷ 最新完整年度 EPS。
   股价与财报常不同币种（如港股报价 HKD、财报 CNY），两端各自折成人民币后再相除；
   历史序列用「当年均价 ÷ 当年 EPS」同一折算因子，分位可比。
   少于 5 个完整年度就只显值不画尺（口径与股息率分位一致）。 */
export function getPeValuation(symbol) {
  const company = _data && _data.companies ? _data.companies[symbol] : null;
  if (!company || !Array.isArray(company.years)) return null;
  const quote = inferQuote(symbol);
  const price = safeNumber(quote.price, 0);
  const priceFx = resolveFxRate(company.currency || resolveQuoteCurrency(quote, symbol), state.rates);
  const epsFx = resolveFxRate(company.statementCurrency || company.currency, state.rates);
  if (price <= 0 || priceFx <= 0 || epsFx <= 0) return null;
  const currentYear = new Date().getFullYear();
  const rows = company.years
    .filter((row) => row && safeNumber(row.year, 0) > 0 && row.year < currentYear)
    .slice()
    .sort((a, b) => a.year - b.year);
  const epsRows = rows.filter((row) => safeNumber(row.eps, 0) > 0);
  if (!epsRows.length) return null;
  const latestEps = safeNumber(epsRows[epsRows.length - 1].eps, 0);
  const pe = (price * priceFx) / (latestEps * epsFx);
  if (!Number.isFinite(pe) || pe <= 0) return null;
  const series = epsRows
    .filter((row) => safeNumber(row.avgPrice, 0) > 0)
    .map((row) => (safeNumber(row.avgPrice, 0) * priceFx) / (safeNumber(row.eps, 0) * epsFx))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (series.length < 5) return { symbol, pe, percentile: null, years: series.length };
  const below = series.filter((value) => value < pe).length;
  return { symbol, pe, percentile: below / series.length, years: series.length };
}

function formatPercentValue(value, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return `${(Number(value) * 100).toFixed(digits)}%`;
}

function formatSignedPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

/* ── 顶部：速览横滑条 + 公司名 ── */
function buildRankTrack(rank, symbol) {
  if (rank.length < 2) return '';
  return `<div class="fu-rank">${rank.map((item) => `<button class="fu-rank-item${item.symbol === symbol ? ' is-active' : ''}" type="button" data-fund-symbol="${escapeHtml(item.symbol)}">
      <span>${escapeHtml(item.name)}</span>
      <strong>${escapeHtml(formatPercentValue(item.historicalReturn))}</strong>
      <i class="fu-rank-dot" aria-hidden="true"></i>
    </button>`).join('')}</div>`;
}

function buildCompanyHead(company, totalCount) {
  return `<div class="fu-co">
      <button class="fu-co-name" type="button" data-fund-picker-open aria-haspopup="dialog">${escapeHtml(getCompanyDisplayName(company))}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 9.5 12 15l5.5-5.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></path></svg></button>
      <p class="fu-co-sub">${escapeHtml(company.symbol)} · 股息按 ${escapeHtml(company.currency)}/股 · 财报币种 ${escapeHtml(company.statementCurrency || company.currency)} · 全部 ${totalCount} 家</p>
    </div>`;
}

/* ── 公式块：股息 + 增长（+ 净回购）── */
function buildFormulaSection(company, rank) {
  const model = getCompanyReturnModel(company.symbol);
  if (!model) return '';
  const parts = [
    { key: 'divi', label: '股息率', value: model.dividendYield },
    { key: 'growth', label: model.mode === 'profitBridge' ? '净利润增长' : 'EPS 增长', value: model.growthRate }
  ];
  if (model.mode === 'profitBridge') parts.push({ key: 'buyback', label: '净回购', value: model.netBuybackYield });
  const denominator = parts.reduce((sum, item) => sum + Math.abs(safeNumber(item.value, 0)), 0) || 1;
  const confidenceLabel = model.confidence === 'high' ? '高' : model.confidence === 'medium' ? '中' : '低';
  const dividendNote = model.dividendYear
    ? `股息按 ${model.dividendYear} 年常规派息 ÷ 现价${model.specialExcluded ? '，已剔除特别股息' : ''}`
    : '近两年无派息，股息按 0 计';
  const growthNote = model.mode === 'profitBridge'
    ? `净利润 ${model.growthSpan} 年年化 · 股本 ${model.buybackSpan} 年变化 · 置信度 ${confidenceLabel}`
    : `EPS ${model.growthSpan} 年年化，已含回购 · 置信度 ${confidenceLabel}`;
  const portfolioRate = getPortfolioReturnSummary().all;
  const index = rank.findIndex((item) => item.symbol === company.symbol);
  const anchorParts = [];
  if (portfolioRate !== null) anchorParts.push(`组合加权 <strong>${escapeHtml(formatPercentValue(portfolioRate))}/年</strong>`);
  if (index >= 0 && rank.length > 1) anchorParts.push(`本公司列 ${rank.length} 家中第 ${index + 1}`);
  return `<section class="fu-formula">
      <span class="fu-f-label">历史经营回报参考</span>
      <strong class="fu-f-value">${model.historicalReturn === null ? '—' : `≈ ${escapeHtml(formatSignedPercent(model.historicalReturn))}`}<em>/年</em></strong>
      <p class="fu-f-note">股息 + 增长${model.mode === 'profitBridge' ? ' + 净回购' : ''} · 历史参考，并非未来预测</p>
      <div class="fu-f-stack">${parts.map((item) => `<i class="is-${item.key}" style="width:${(Math.abs(safeNumber(item.value, 0)) / denominator * 100).toFixed(2)}%"></i>`).join('')}</div>
      <div class="fu-f-rows">${parts.map((item) => `<div><b class="is-${item.key}"></b><span>${escapeHtml(item.label)}</span><small></small><strong>${item.value === null ? '—' : escapeHtml(formatSignedPercent(item.value))}</strong></div>`).join('')}</div>
      <p class="fu-f-method">${escapeHtml(dividendNote)}<br>${escapeHtml(growthNote)}</p>
      ${anchorParts.length ? `<p class="fu-f-anchor">${anchorParts.join(' · ')}</p>` : ''}
    </section>`;
}

/* ── 估值节：两根「贵 ⇄ 便宜」标尺 ──
   两个指标方向已统一为「点越靠右越便宜」：股息率高＝便宜，市盈率低＝便宜，
   所以 PE 的点位取 100 − 分位。端点半径占 3.5px，落位夹在 [3%, 97%] 免得压出边界。 */
function buildScaleRow(label, valueText, model) {
  const scale = model.percentile === null ? '' : `<div class="fu-val-scale"><i style="left:${model.position.toFixed(1)}%"></i></div>
      <div class="fu-val-ends"><span>贵</span><span>便宜</span></div>`;
  const aside = model.percentile === null
    ? `<span class="fu-val-p">${escapeHtml(model.emptyNote)}</span>`
    : `<span class="fu-val-p">${Math.round(model.percentile * 100)}% 分位 · <strong class="${model.cheap ? 'is-cheap' : ''}">${escapeHtml(model.word)}</strong></span>`;
  return `<div class="fu-val-row">
      <div class="fu-val-main"><span>${escapeHtml(label)} <span class="fu-val-v">${escapeHtml(valueText)}</span></span>${aside}</div>
      ${scale}
    </div>`;
}

function buildValuationSection(company) {
  const rows = [];
  const pe = getPeValuation(company.symbol);
  if (pe) {
    const percentile = pe.percentile;
    rows.push(buildScaleRow('市盈率', `${pe.pe.toFixed(1)} 倍`, {
      percentile,
      position: percentile === null ? 50 : Math.min(97, Math.max(3, (1 - percentile) * 100)),
      cheap: percentile !== null && percentile <= 0.3,
      word: percentile === null ? '' : percentile <= 0.3 ? '偏低' : percentile >= 0.7 ? '偏高' : '居中',
      emptyNote: '历史价序列不足，暂不排分位'
    }));
  }
  const yieldRank = getDividendYieldPercentile(company.symbol);
  if (yieldRank) {
    const percentile = yieldRank.percentile;
    rows.push(buildScaleRow('股息率', formatPercentValue(yieldRank.currentYield), {
      percentile,
      position: Math.min(97, Math.max(3, percentile * 100)),
      cheap: percentile >= 0.7,
      word: percentile >= 0.7 ? '偏便宜' : percentile <= 0.3 ? '偏贵' : '居中',
      emptyNote: ''
    }));
  }
  if (!rows.length) return '';
  const years = Math.max(pe ? pe.years : 0, yieldRank ? yieldRank.years : 0);
  return `<section class="fu-val">
      <div class="fu-sec-head"><span class="fu-sec-label">估值</span><span class="fu-sec-aside">近 ${years} 年分位 · 点越靠右越便宜</span></div>
      <div class="fu-val-rows">${rows.join('')}</div>
    </section>`;
}

/* ── 两张线图：min–max 自适应量程（非零基线），逐点标值，当年点加大加深 ── */
const LINE_W = 338;
const LINE_TOP = 16;
const LINE_BOTTOM = 66;
const LINE_PAD_X = 44;

function roundSvg(value) { return Math.round(value * 100) / 100; }

function buildZenLineSvg(points, tone, ariaLabel) {
  if (points.length < 2) return '';
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max === min ? 1 : max - min;
  const inner = LINE_W - LINE_PAD_X * 2;
  const toX = (index) => roundSvg(LINE_PAD_X + (inner * index) / (points.length - 1));
  const toY = (value) => roundSvg(max === min
    ? (LINE_TOP + LINE_BOTTOM) / 2
    : LINE_TOP + ((max - value) / span) * (LINE_BOTTOM - LINE_TOP));
  const coords = points.map((point, index) => ({ ...point, x: toX(index), y: toY(point.value) }));
  const last = coords.length - 1;
  return `<div class="fu-line is-${tone}">
      <svg viewBox="0 0 ${LINE_W} 92" role="img" aria-label="${escapeHtml(ariaLabel)}">
        <polyline points="${coords.map((c) => `${c.x},${c.y}`).join(' ')}"></polyline>
        ${coords.map((c, i) => `<circle cx="${c.x}" cy="${c.y}" r="${i === last ? 3.2 : 2.4}"></circle>`).join('')}
        ${coords.map((c, i) => `<text x="${c.x}" y="${roundSvg(c.y - (i === last ? 7 : 8))}" text-anchor="middle"${i === last ? ' class="is-current"' : ''}>${escapeHtml(c.text)}</text>`).join('')}
        ${coords.map((c, i) => `<text x="${c.x}" y="88" text-anchor="middle" class="yr${i === last ? ' is-current' : ''}">${c.year}</text>`).join('')}
      </svg>
    </div>`;
}

function buildDividendLine(company, visible) {
  const points = visible
    .filter((row) => isFiniteValue(row.dividendPerShare))
    .map((row) => ({ year: row.year, value: Number(row.dividendPerShare), text: formatMetricValue(row.dividendPerShare, 'money') }));
  if (!points.length) return '';
  const latest = visible.filter((row) => isFiniteValue(row.dividendPerShare)).slice(-1)[0];
  const streak = getGrowthStreak(visible, 'dividendPerShare');
  return `<section class="fu-bars">
      <div class="fu-sec-head"><span class="fu-sec-label">每股分红</span><span class="fu-latest">${escapeHtml(formatMetricValue(latest.dividendPerShare, 'money'))} ${escapeHtml(company.currency)}<small>股息率 ${escapeHtml(formatMetricValue(latest.dividendYield, 'percent'))}</small></span></div>
      ${buildZenLineSvg(points, 'gold', '每股分红历年走势')}
      <p class="fu-bar-stats"><span>特别股息 <strong>${escapeHtml(formatMetricValue(latest.specialDividendPerShare, 'money'))}</strong></span><span>连续增长 <strong>${streak > 0 ? `${streak} 年` : '—'}</strong></span></p>
    </section>`;
}

function buildEpsLine(company, visible) {
  const available = visible.filter((row) => isFiniteValue(row.eps));
  if (!available.length) return '';
  const points = available.map((row) => ({ year: row.year, value: Number(row.eps), text: formatMetricValue(row.eps, 'money') }));
  const latest = available[available.length - 1];
  const previous = available.length > 1 ? available[available.length - 2] : null;
  const growth = previous && safeNumber(previous.eps, 0) !== 0
    ? (safeNumber(latest.eps, 0) - safeNumber(previous.eps, 0)) / Math.abs(safeNumber(previous.eps, 0))
    : null;
  // 红涨绿跌覆盖到这一行的百分比：EPS 涨用 up、跌用 down，与全局同一套语义。
  const tone = growth === null ? '' : growth > 0 ? ' is-up' : growth < 0 ? ' is-down' : '';
  const growthText = growth === null ? '—' : `${growth > 0 ? '+' : growth < 0 ? '−' : ''}${Math.abs(growth * 100).toFixed(1)}%`;
  return `<section class="fu-bars">
      <div class="fu-sec-head"><span class="fu-sec-label">EPS 每股收益</span><span class="fu-latest${tone}">${escapeHtml(growthText)}<small>EPS ${escapeHtml(formatMetricValue(latest.eps, 'money'))} ${escapeHtml(company.statementCurrency || company.currency)}</small></span></div>
      ${buildZenLineSvg(points, 'ink', 'EPS 历年走势')}
      <p class="fu-bar-stats"><span>分红率 <strong>${escapeHtml(formatMetricValue(latest.payoutRatio, 'percent'))}</strong></span><span>负债率 <strong>${escapeHtml(formatMetricValue(latest.debtRatio, 'percent'))}</strong></span></p>
    </section>`;
}

/* ── 财报日历：未来 90 天的持仓财报，当前公司整行金色，点其他行切公司 ── */
function buildCalendarSection(symbol) {
  const events = getUpcomingReportEvents({ withinDays: 90 }).slice(0, 6);
  const body = events.length
    ? `<div class="fu-cal-rows">${events.map((event) => `<button class="fu-cal-row${event.symbol === symbol ? ' is-self' : ''}" type="button" data-report-symbol="${escapeHtml(event.symbol)}">
        <span>${String(Number(event.reportDate.slice(5, 7))).padStart(2, '0')}/${String(Number(event.reportDate.slice(8, 10))).padStart(2, '0')} <strong>${escapeHtml(event.name)}</strong></span>
        <span class="fu-cal-type">${escapeHtml(event.reportType)}</span>
      </button>`).join('')}</div>`
    : '<p class="fu-cal-empty">未来 90 天暂未收录持仓财报日期</p>';
  return `<section class="fu-cal">
      <div class="fu-sec-head"><span class="fu-sec-label">财报日历</span><span class="fu-sec-aside">点公司切换</span></div>
      ${body}
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
  const rank = getFundamentalsRankModel();
  const { allRows, metrics, currentYear } = buildCompanyMetrics(company);
  const visible = allRows.filter((row) => row.year < currentYear).slice(-4);

  refs.fundamentalsContent.innerHTML = `
    ${buildRankTrack(rank, company.symbol)}
    ${buildCompanyHead(company, allCompanies.length)}
    ${buildFormulaSection(company, rank)}
    ${buildValuationSection(company)}
    ${buildDividendLine(company, visible)}
    ${buildEpsLine(company, visible)}
    <details class="fu-fold">
      <summary><span class="fu-sec-label">年度数据明细</span><span class="fu-fold-arr">${allRows.length} 年 ›</span></summary>
      ${buildCompanyTable(allRows, metrics, currentYear)}
    </details>
    ${buildCalendarSection(company.symbol)}
  `;
  // 速览条按回报排序，当前公司常落在屏外；横向滚到居中，让金点看得见（只动这条轨道，不动页面）
  const activeRank = refs.fundamentalsContent.querySelector('.fu-rank-item.is-active');
  if (activeRank && activeRank.parentElement) {
    const track = activeRank.parentElement;
    track.scrollLeft = Math.max(0, activeRank.offsetLeft - (track.clientWidth - activeRank.offsetWidth) / 2);
  }
  if (refs.fundamentalsNote) {
    const updated = _data && _data.updatedAt ? formatDateLabel(_data.updatedAt).slice(5) : '';
    refs.fundamentalsNote.textContent = updated
      ? `年报口径 · 数据更新 ${updated} · 按经营回报排序`
      : '年报口径 · 按经营回报排序';
  }
}