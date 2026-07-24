import { state, refs, mutable, saveState, isDemoMode } from './state.js';
import {
  computeHoldings, getCompanySegments, getBucketSegments, getBucketSummaryItems,
  computeDividendCalendar, computeIncomeSummary,
  computeCashFlowRecords, computeDividendRecords, computeTradeSummary, isCashModelActive, getAnnualDividendOverview
} from './compute.js';
import { renderFundamentalsPage, getFundamentalsCompanyCount, getPortfolioReturnSummary } from './fundamentals.js';
import { computeYearAnnals } from './annals.js';
import { getPortfolioDiagnostics } from './diagnostics.js';
import { renderReportCalendarPanel } from './report-calendar.js';
import {
  safeNumber, escapeHtml, formatMoney, formatPlainPrice, formatPercent, formatDailyPnl,
  formatTimestamp, normalizeDividendStatus, getDividendStatusLabel,
  buildDividendTooltipLines, buildDividendTooltipHtml, createElementFromHtml
} from './utils.js';
import {
  MASK_AMOUNT, MASK_PRICE, LABELS, UI_TEXT,
  LEGEND_COLLAPSED_COUNT, LEGEND_TOGGLE_ANIMATION_MS, LEGEND_ENTER_STAGGER_MS,
  HOLDING_ENTER_STAGGER_MS, HOLDING_ENTER_STAGGER_MAX_MS, TOOLTIP_FALLBACK_WIDTH,
  TOOLTIP_GAP, HOLDING_REMOVAL_FALLBACK_MS,
  HOLDING_SWIPE_DELETE_WIDTH, HOLDING_SWIPE_OPEN_THRESHOLD
} from './constants.js';

/* ── Format helpers that depend on state ── */
export function formatDisplayMoney(value, currency = 'CNY') {
  return state.showAmounts ? formatMoney(value, currency) : MASK_AMOUNT;
}

function getHoldingTitleDivider() { return '\u00b7'; }

function formatLedgerMoney(value, currency = 'CNY', fractionClass = '') {
  if (!state.showAmounts) return `<span>${MASK_AMOUNT}</span>`;
  const formatted = formatMoney(value, currency);
  const match = formatted.match(/^(.*?)([.,]\d{2})$/);
  if (!match) return `<span>${escapeHtml(formatted)}</span>`;
  return `<span>${escapeHtml(match[1])}</span><small${fractionClass ? ` class="${fractionClass}"` : ''}>${escapeHtml(match[2])}</small>`;
}

/* ── Tooltip helpers ── */
export function updateDividendTooltipSide(button) {
  if (!button) return;
  if (button.classList.contains('dividend-status-button--value')) { button.dataset.tooltipSide = 'left'; return; }
  const tooltip = button.querySelector('.dividend-status-tooltip');
  if (!tooltip) return;
  const vw = document.documentElement.clientWidth || window.innerWidth || 0;
  const fw = safeNumber(tooltip.offsetWidth, TOOLTIP_FALLBACK_WIDTH) || TOOLTIP_FALLBACK_WIDTH;
  const rect = button.getBoundingClientRect();
  button.dataset.tooltipSide = (vw - rect.right >= fw + TOOLTIP_GAP || vw - rect.right >= rect.left) ? 'right' : 'left';
}

export function closeActiveDividendTooltip(force = false) {
  if (!mutable.activeDividendTooltipButton) return;
  if (!force && document.activeElement === mutable.activeDividendTooltipButton) return;
  mutable.activeDividendTooltipButton.classList.remove('is-tooltip-open');
  mutable.activeDividendTooltipButton.setAttribute('aria-expanded', 'false');
  mutable.activeDividendTooltipButton.blur();
  mutable.activeDividendTooltipButton = null;
}

export function toggleDividendTooltip(button) {
  if (!button || !button.classList.contains('dividend-status-button--value')) return;
  if (mutable.activeDividendTooltipButton === button) { closeActiveDividendTooltip(true); return; }
  closeActiveDividendTooltip(true);
  updateDividendTooltipSide(button);
  button.classList.add('is-tooltip-open');
  button.setAttribute('aria-expanded', 'true');
  mutable.activeDividendTooltipButton = button;
}

/* ── Home Dashboard ── */
export function renderHomePage(summary) {
  const calendarModel = computeDividendCalendar();
  const incomeModel = computeIncomeSummary();
  const bucketItems = getBucketSummaryItems(summary.holdings);
  const totalMv = bucketItems.reduce((sum, item) => sum + safeNumber(item.marketValueCny, 0), 0) || 1;
  renderHomeHero(summary);
  renderHomeMetrics(calendarModel, summary);
  renderHomeNavSummaries(summary, calendarModel, bucketItems, totalMv, incomeModel);
}

/* 今年收益 = 当前净值 − 年初净值 − 净注入（净值链口径，已含股息与汇率）。
   作为「收益明细」入口的 HUD 摘要展示；正负号已携带方向，导航列表保持纯灰度，
   色彩只留给 hero 与 focus card 的实时状态。 */
function getIncomeNavSummaryHtml(incomeModel) {
  const row = incomeModel && incomeModel.current;
  const available = Boolean(row && row.capitalReturnAvailable && row.capitalReturnCny !== null);
  if (!available) return '\u5f85\u56de\u586b\u5e74\u521d\u51c0\u503c';
  const value = row.capitalReturnCny;
  const rate = row.capitalReturnRate;
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  const amountText = state.showAmounts ? `${sign}\u00a5${Math.round(Math.abs(value)).toLocaleString('en-US')}` : MASK_AMOUNT;
  const rateText = rate === null || rate === undefined
    ? '' : ` (${rate > 0 ? '+' : rate < 0 ? '-' : ''}${formatPercent(Math.abs(rate))})`;
  const tone = value > 0 ? 'is-market-up' : value < 0 ? 'is-market-down' : '';
  return `<span class="${tone}">${escapeHtml(amountText)}${escapeHtml(rateText)}</span>`;
}

function renderHomeHero(summary) {
  const pnl = safeNumber(summary.totalDailyPnlCny, 0);
  const hasPnl = summary.holdings.some((h) => safeNumber(h.previousClose, 0) > 0);
  const pnlText = hasPnl && state.showAmounts ? formatDailyPnl(pnl, summary.dailyPnlBaseCny) : '';
  const pnlArrow = pnl > 0 ? '\u25b2' : pnl < 0 ? '\u25bc' : '';
  const pnlClass = pnl > 0 ? 'is-market-up' : pnl < 0 ? 'is-market-down' : 'is-flat';
  const fxText = `USD ${safeNumber(state.rates.USD, 0).toFixed(2)} \u00b7 HKD ${safeNumber(state.rates.HKD, 0).toFixed(4)}`;
  refs.homeHero.innerHTML = `
    <button class="home-hero-label" type="button" data-summary-action="liability" aria-label="\u7f16\u8f91\u8d1f\u503a">\u51c0\u8d44\u4ea7</button>
    <strong class="home-hero-value">${formatLedgerMoney(summary.netMarketValueCny, 'CNY', 'home-hero-fraction')}</strong>
    <p class="home-hero-meta">${pnlText ? `<strong class="${pnlClass}">${pnlArrow} ${escapeHtml(pnlText)}</strong> \u00b7 ` : ''}${escapeHtml(fxText)}</p>`;
}

function getHomeMonthWindow(months, currentMonth) {
  const start = Math.min(Math.max(currentMonth - 2, 1), 7);
  return months.slice(start - 1, start + 5);
}

function getNextHomeDividend(calendarModel) {
  return calendarModel.allDetails
    .filter((entry) => {
      const date = entry.payDate || entry.exDate || '';
      return entry.status !== 'received' && entry.status !== 'due' && date >= calendarModel.today;
    })
    .sort((a, b) => `${a.payDate || a.exDate}|${a.symbol}`.localeCompare(`${b.payDate || b.exDate}|${b.symbol}`))[0] || null;
}

function getHomeDividendDateParts(entry) {
  if (!entry) return { day: '\u2014', month: '' };
  const value = entry.payDate || entry.exDate || '';
  const parts = value.split('-');
  const month = Math.max(1, Math.min(12, Number(parts[1]) || entry.month || 1));
  return {
    day: parts[2] ? String(Number(parts[2])).padStart(2, '0') : '\u2014',
    month: `${month}月`
  };
}

/* 本年股息区：金线进度 + 六月点 + 两行待办，构图见 designs/禅意UI/01-首页/定稿图.html。 */
function renderHomeMetrics(calendarModel, summary) {
  const annual = getAnnualDividendOverview(calendarModel, summary);
  const annualProjected = annual.projectedCny;
  const annualRatio = annual.receivedRatio;
  const ratioPct = Math.round(Math.max(0, Math.min(1, annualRatio)) * 100);
  const monthWindow = getHomeMonthWindow(calendarModel.months, calendarModel.currentMonth);
  const monthButtons = monthWindow.map((item) => {
    const hasPay = safeNumber(item.totalCny, 0) > 0;
    const isCurrent = item.month === calendarModel.currentMonth;
    return `
    <button class="home-month${hasPay ? ' has-pay' : ''}${isCurrent ? ' is-current' : ''}" type="button" data-home-dividend-month="${item.month}" aria-label="\u67e5\u770b ${item.month} \u6708\u80a1\u606f">
      <span>${String(item.month).padStart(2, '0')}</span>
      <i aria-hidden="true"></i>
    </button>`;
  }).join('');

  // \u4e24\u884c\u5f85\u529e\uff1a\u4e0b\u4e00\u7b14\u5728\u9014\u80a1\u606f\u3001\u5f85\u786e\u8ba4\u7b14\u6570\uff08\u5747\u4e3a\u5df2\u6709\u53e3\u5f84\uff09
  const nextDividend = getNextHomeDividend(calendarModel);
  const nextDate = getHomeDividendDateParts(nextDividend);
  const nextName = nextDividend ? (nextDividend.name || nextDividend.symbol) : '';
  const nextLine = nextDividend
    ? `${nextDate.month}${nextDate.day}\u65e5 ${escapeHtml(nextName)} <strong>${escapeHtml(formatDisplayMoney(nextDividend.netCny, 'CNY'))}</strong> \u5230\u8d26`
    : '\u8fd1\u671f\u6682\u65e0\u5728\u9014\u80a1\u606f';
  const dueEntries = calendarModel.allDetails.filter((entry) => entry.status === 'due');
  const dueCny = dueEntries.reduce((sum, entry) => sum + safeNumber(entry.netCny, 0), 0);
  const dueLine = dueEntries.length
    ? `\u5f85\u786e\u8ba4 <strong>${dueEntries.length} \u7b14 \u00b7 ${escapeHtml(formatHudAmount(dueCny))}</strong>`
    : '\u6682\u65e0\u5f85\u786e\u8ba4\u5230\u8d26';

  refs.homeFocusCard.innerHTML = `
    <button class="home-divi" type="button" data-page-nav="dividends" aria-label="\u6253\u5f00\u672c\u5e74\u80a1\u606f">
      <span class="home-divi-label">\u672c\u5e74\u80a1\u606f \u00b7 ${ratioPct}%</span>
      <strong class="home-divi-value">${escapeHtml(formatHudAmount(annualProjected))}</strong>
      <span class="home-divi-thread" aria-label="\u672c\u5e74\u80a1\u606f\u5230\u8d26\u8fdb\u5ea6 ${ratioPct}%">
        <i style="width:${Math.max(annualRatio * 100, annualProjected > 0 ? 0.6 : 0).toFixed(1)}%"></i>
      </span>
    </button>
    <div class="home-month-track">${monthButtons}</div>
    <div class="home-todo" aria-label="\u8fd1\u671f\u80a1\u606f\u5f85\u529e">
      <p>${nextLine}</p>
      <p>${dueLine}</p>
    </div>`;
}

/* 入口 HUD 的金额统一取整，保持单行长度可控。 */
function formatHudAmount(value) {
  if (!state.showAmounts) return MASK_AMOUNT;
  return `¥${Math.round(Math.abs(safeNumber(value, 0))).toLocaleString('en-US')}`;
}

function formatHudDate(label) {
  const parts = String(label || '').split('-');
  return parts.length >= 3 ? `${Number(parts[1])}月${Number(parts[2])}日` : '';
}

/* 股息日历入口：优先呈现行动项（到账日已过但未勾确认的 due 条目），
   没有待确认时退回展示下一笔在途派息。 */
function getDividendNavSummary(calendarModel) {
  const dueEntries = calendarModel.allDetails.filter((entry) => entry.status === 'due');
  if (dueEntries.length) {
    const dueCny = dueEntries.reduce((sum, entry) => sum + safeNumber(entry.netCny, 0), 0);
    return `待确认 ${dueEntries.length} 笔 · ${escapeHtml(formatHudAmount(dueCny))}`;
  }
  const next = getNextHomeDividend(calendarModel);
  if (!next) return '暂无在途股息';
  return `下一笔 ${formatHudDate(next.payDate || next.exDate)} ${escapeHtml(next.symbol)}`;
}

/* 基本面入口：公式仪表盘的核心结论——组合加权经营回报（仅中高置信度公司）。 */
function getFundamentalsNavSummary() {
  if (getFundamentalsCompanyCount() === 0) return '股息 / EPS · 年报口径';
  const model = getPortfolioReturnSummary();
  if (model.all === null) return `${getFundamentalsCompanyCount()} 家 · 股息 / EPS`;
  return `经营回报 ${(model.all * 100).toFixed(1)}%/年 · 覆盖 ${Math.round(model.coverage * 100)}%`;
}

/* 资金与交易入口：三类流水（出入金 / 交易 / 已确认股息）里最近的一笔。 */
function getRecordsNavSummary(cash, dividends, trades) {
  const cashEntry = cash.records[0] || null;
  const tradeEntry = trades.records[0] || null;
  const dividendEntry = dividends.records[0] || null;
  const candidates = [
    cashEntry && { date: String(cashEntry.date || ''), text: `${cashEntry.isWithdrawal ? '出金' : '入金'} ${escapeHtml(formatHudAmount(cashEntry.signedCny))}` },
    tradeEntry && { date: String(tradeEntry.date || ''), text: `${tradeEntry.side === 'sell' ? '卖出' : '买入'} ${escapeHtml(tradeEntry.symbol)}` },
    dividendEntry && { date: String(dividendEntry.date || ''), text: `股息 ${escapeHtml(dividendEntry.symbol)}` }
  ].filter(Boolean).sort((a, b) => b.date.localeCompare(a.date));
  if (!candidates.length) return '暂无记录';
  return `${formatHudDate(candidates[0].date)} ${candidates[0].text}`;
}

function renderHomeNavSummaries(summary, calendarModel, bucketItems, totalMv, incomeModel) {
  const cash = computeCashFlowRecords();
  const dividends = computeDividendRecords();
  const trades = computeTradeSummary();
  const coreItem = bucketItems.find((item) => item.key === 'core');
  const summaries = {
    holdings: `${summary.holdings.length} \u9879${coreItem ? ` \u00b7 ${LABELS.core} ${((coreItem.marketValueCny / totalMv) * 100).toFixed(1)}%` : ''}`,
    dividends: getDividendNavSummary(calendarModel),
    income: getIncomeNavSummaryHtml(incomeModel),
    fundamentals: getFundamentalsNavSummary(),
    records: getRecordsNavSummary(cash, dividends, trades)
  };
  // 摘要统一为纯灰度文本；所有动态片段均已转义或由格式化函数生成。
  refs.homeNavList.querySelectorAll('[data-nav-summary]').forEach((el) => {
    el.innerHTML = summaries[el.dataset.navSummary] || '';
  });
}

/* ── Legend ── */
function getLegendSegmentKey(seg, i) {
  if (seg && seg.key != null) return String(seg.key);
  if (seg && seg.label) return String(seg.label);
  return `legend-${i}`;
}

function getLegendViewModel(segments) {
  const total = segments.reduce((s, i) => s + i.value, 0) || 1;
  const cc = Math.min(segments.length, LEGEND_COLLAPSED_COUNT);
  return { total, collapsedCount: cc, canToggleLegend: cc < segments.length };
}

function getLegendRowMarkup(seg, pct, index, opts = {}) {
  const { animate = true } = opts;
  return `<div class="legend-row${animate ? ' is-entering' : ''}" data-legend-key="${escapeHtml(getLegendSegmentKey(seg, index))}" style="animation-delay:${index * LEGEND_ENTER_STAGGER_MS}ms">
    <div class="legend-row-shell"><div class="legend-main"><span class="legend-bar" aria-hidden="true"><i style="width:${Math.max(3, pct * 100).toFixed(1)}%"></i></span><span class="legend-label">${escapeHtml(seg.label)}</span></div>
    <span class="legend-value">${(pct * 100).toFixed(1)}%</span></div></div>`;
}

function syncLegendRow(row, seg, pct, index, opts = {}) {
  const bar = row.querySelector('.legend-bar i'), label = row.querySelector('.legend-label'), value = row.querySelector('.legend-value');
  if (!bar || !label || !value) return false;
  row.dataset.legendKey = getLegendSegmentKey(seg, index);
  row.className = `legend-row${opts.animate ? ' is-entering' : ''}`;
  row.style.animationDelay = `${index * LEGEND_ENTER_STAGGER_MS}ms`;
  bar.style.width = `${Math.max(3, pct * 100).toFixed(1)}%`; label.textContent = seg.label; value.textContent = `${(pct * 100).toFixed(1)}%`;
  return true;
}

function keepLegendToggleStable(prevTop) {
  if (!Number.isFinite(prevTop)) return;
  const adjust = () => { const d = refs.legendToggle.getBoundingClientRect().top - prevTop; if (Math.abs(d) > 1) window.scrollBy(0, d); };
  requestAnimationFrame(() => { adjust(); window.setTimeout(adjust, LEGEND_TOGGLE_ANIMATION_MS + 40); });
}

export function applyLegendExpandState(opts = {}) {
  const { preserveScroll = false, toggleTop = 0 } = opts;
  const holdings = computeHoldings().holdings;
  renderHoldingsView(holdings, { animate: false });
  if (preserveScroll) keepLegendToggleStable(toggleTop);
}

export function renderLegendView(segments, opts = {}) {
  const count = computeHoldings().holdings.length;
  refs.companyLegend.innerHTML = '';
  refs.companyLegend.hidden = true;
  refs.legendToggle.hidden = count <= LEGEND_COLLAPSED_COUNT;
  refs.legendToggle.textContent = state.legendExpanded ? '收起' : `展开全部 ${count} 项`;
}

export function patchLegendView(segments) {
  renderLegendView(segments, { animate: false });
}

/* ── 02-持仓页 · 按 designs/禅意UI/02-持仓页/定稿图.html 重排 ── */

/* 结构行与逐股行用整数金额 + 一位小数百分比：定稿图写的就是 ¥286,400 / 7.9%。
   带两位小数会把 sub 行顶到换行，而验收要求 sub 行一行放得下。 */
function formatZenMoney(value) {
  if (!state.showAmounts) return MASK_AMOUNT;
  const amount = safeNumber(value, 0);
  return `${amount < 0 ? '-' : ''}¥${Math.round(Math.abs(amount)).toLocaleString('en-US')}`;
}

function formatZenPercent(value) {
  return `${(safeNumber(value, 0) * 100).toFixed(1)}%`;
}

/* 居中 hero：股票市值 + 今日涨跌。涨跌额与其后的百分比同属一段、同色。 */
export function renderHoldingsHero(summary) {
  if (!refs.holdingsHero) return;
  const pnl = safeNumber(summary.totalDailyPnlCny, 0);
  const hasPnl = summary.holdings.some((item) => safeNumber(item.previousClose, 0) > 0);
  const pnlText = hasPnl && state.showAmounts ? formatDailyPnl(pnl, summary.dailyPnlBaseCny) : '';
  const arrow = pnl > 0 ? '▲' : pnl < 0 ? '▼' : '';
  const tone = pnl > 0 ? 'is-market-up' : pnl < 0 ? 'is-market-down' : 'is-flat';
  /* 三种空要分开：掩码遮住的数字不是「行情没更新」，直接落到待更新文案会被读成数据故障。
     掩码态用中性色的掩码串，连涨跌方向一起遮住。 */
  const meta = pnlText
    ? `今日 <strong class="${tone}">${arrow} ${escapeHtml(pnlText)}</strong>`
    : hasPnl ? `今日 <strong class="is-flat">${MASK_AMOUNT}</strong>` : '今日行情待更新';
  refs.holdingsHero.innerHTML = `
    <span class="holdings-hero-label">股票市值</span>
    <strong class="holdings-hero-value">${formatLedgerMoney(summary.totalMarketValueCny, 'CNY', 'holdings-hero-fraction')}</strong>
    <p class="holdings-hero-meta">${meta}</p>`;
}

/* ── 仓位结构 ──
   两段线（墨=核心 / 金=打工）→ 两个可切换仓位 → 选中仓明细行 → 组合行。
   旧版的三列 return-bar 与左右色块图例都收敛到这四行里，市值不重复（已在 hero）。 */
export function renderBucketsView(segments, holdings, summary, opts = {}) {
  if (!refs.bucketTrack) return;
  const items = getBucketSummaryItems(holdings);
  const total = items.reduce((sum, item) => sum + safeNumber(item.marketValueCny, 0), 0);
  // 两个仓位是「切换」不是「开关」：始终有一个选中，明细行跟着走，默认核心仓
  if (!items.some((item) => item.key === state.activeBucketKey)) {
    state.activeBucketKey = items.length ? items[0].key : null;
  }
  const find = (key) => items.find((item) => item.key === key) || null;
  const share = (item) => (total > 0 && item ? item.marketValueCny / total : 0);
  const active = find(state.activeBucketKey);
  const hasUnknownTax = holdings.some((item) => !item.taxRateKnown && safeNumber(item.quantity, 0) > 0);
  const dividendLabel = hasUnknownTax ? '年化股息' : '税后年化';
  const bar = ['core', 'income'].map((key) => {
    const item = find(key);
    return item ? `<i class="seg-${key}" style="width:${(share(item) * 100).toFixed(2)}%"></i>` : '';
  }).join('');
  const buttons = ['core', 'income'].map((key) => {
    const item = find(key);
    if (!item) return '';
    const isActive = state.activeBucketKey === key;
    // 金点用真元素而不是 ::after：机检把带背景的伪元素一律当旧层装饰报出来，
    // 而这颗点是设计要求的选中记号，得让它能和残留区分开
    return `<button class="bucket${isActive ? ' is-active' : ''}" type="button" data-bucket-toggle="${key}" aria-pressed="${isActive}">${escapeHtml(item.label)}<strong>${formatZenPercent(share(item))}</strong><i class="bucket-dot" aria-hidden="true"></i></button>`;
  }).join('');
  const detail = active
    ? `<p class="bucket-detail">${escapeHtml(active.label)} <strong>${escapeHtml(formatZenMoney(active.marketValueCny))}</strong> · ${dividendLabel} <strong>${escapeHtml(formatZenMoney(active.totalDividendCny))}</strong> · 股息率 <strong>${formatZenPercent(active.averageYield)}</strong></p>`
    : '';
  refs.bucketTrack.innerHTML = `
    <div class="structure-bar" aria-hidden="true">${bar}</div>
    <div class="bucket-row">${buttons}</div>
    ${detail}
    <p class="portfolio-line">组合${dividendLabel} <b>${escapeHtml(formatZenMoney(summary.totalDividendCny))}</b> · 组合股息率 <strong>${formatZenPercent(total > 0 ? summary.totalDividendCny / total : 0)}</strong></p>`;
}

export function patchBucketsView(segments, holdings, summary) {
  renderBucketsView(segments, holdings, summary, { animateDetail: false });
}

/* 页头右槽：「诊断 N」，N>0 时计数用涨色提醒 */
export function renderDiagnosticsButton() {
  if (!refs.diagnosticsButton) return;
  const count = getPortfolioDiagnostics().actionableCount;
  refs.diagnosticsButton.hidden = false;
  refs.diagnosticsButton.innerHTML = count > 0 ? `诊断 <b>${count}</b>` : '诊断';
  refs.diagnosticsButton.classList.toggle('has-issues', count > 0);
  refs.diagnosticsButton.setAttribute('aria-label', count > 0 ? `持仓诊断，${count} 项需要关注` : '持仓诊断，无需处理');
}

/* ── 排序：定稿图只留一个文字按钮 ── */
export const HOLDING_SORT_FIELDS = ['marketValueCny', 'effectiveYield', 'netAnnualDividendCny'];

export function getSortFieldLabel(field) {
  if (field === 'effectiveYield') return LABELS.sortDividendYield;
  if (field === 'netAnnualDividendCny') return LABELS.sortDividendAmount;
  return LABELS.sortMarketValue;
}

/* 按钮上的短名：定稿图写的是「按市值 ↓」，不是完整字段名 */
function getSortActionLabel(field) {
  if (field === 'effectiveYield') return '股息率';
  if (field === 'netAnnualDividendCny') return '年股息';
  return '市值';
}

export function renderSortChips() {
  // 旧的圆钮 + 三 chip 仍留在 DOM 里（持仓操作抽屉会程序性点它们），一律不出现在版面上
  if (refs.sortGroup) refs.sortGroup.hidden = true;
  if (mutable.sortToggleButton) mutable.sortToggleButton.hidden = true;
  refs.sortChips.forEach((chip) => {
    chip.hidden = true;
    chip.textContent = getSortFieldLabel(chip.dataset.sortField);
    chip.classList.toggle('is-active', chip.dataset.sortField === state.sortField);
  });
  if (refs.holdingsSortLabel) {
    refs.holdingsSortLabel.textContent = `按${getSortActionLabel(state.sortField)} ${state.sortDirection === 'desc' ? '↓' : '↑'}`;
    refs.holdingsSortLabel.title = `${UI_TEXT.sort} · ${getSortFieldLabel(state.sortField)}`;
  }
}

export function renderTimestamp() {
  if (!refs.marketTimestamp) return;
  const count = computeHoldings().holdings.length;
  // formatTimestamp 给的是「行情更新 07-24 09:32」，定稿图这行只写「行情 07-24 09:32」
  const stamp = formatTimestamp(state.lastUpdatedAt);
  const short = stamp.startsWith(LABELS.marketUpdated) ? `行情${stamp.slice(LABELS.marketUpdated.length)}` : stamp;
  refs.marketTimestamp.textContent = `${short} · ${count} 项 · 点此打开诊断`;
  refs.marketTimestamp.setAttribute('aria-label', `打开持仓诊断，当前 ${count} 项持仓`);
}

export function renderPrivacyButton() {
  refs.privacyButton.classList.toggle('is-hidden', !state.showAmounts);
  document.body.classList.toggle('privacy-hidden', !state.showAmounts);
  refs.privacyButton.setAttribute('aria-pressed', state.showAmounts ? 'false' : 'true');
  refs.privacyButton.title = state.showAmounts ? '\u9690\u85cf\u91d1\u989d' : '\u663e\u793a\u91d1\u989d';
}

/* ── Page Chrome ── */
function getActivePage() {
  return ['home', 'holdings', 'dividends', 'income', 'records', 'fundamentals', 'annual'].includes(state.activePage) ? state.activePage : 'home';
}

export function renderPageChrome() {
  const activePage = getActivePage();
  refs.pageViews.forEach((view) => {
    view.hidden = view.dataset.pageView !== activePage;
  });
  // CSS 钩子：记一笔胶囊只在首页出现，子页样式也按此区分。
  document.body.dataset.activePage = activePage;
  document.body.classList.toggle('demo-mode', isDemoMode());
}

/* ── Dividend Calendar ── */
function getDividendFilterLabel(filterKey) {
  if (filterKey === 'core') return UI_TEXT.dividendFilterCore;
  if (filterKey === 'income') return UI_TEXT.dividendFilterIncome;
  return UI_TEXT.dividendFilterAll;
}

function formatYoyBadge(yoy) {
  if (yoy === null || yoy === undefined || !Number.isFinite(Number(yoy))) {
    return `<span class="dividend-yoy-text">${escapeHtml(LABELS.dividendNoCompare)}</span>`;
  }
  const up = yoy >= 0;
  const pct = `${up ? '+' : '-'}${formatPercent(Math.abs(yoy))}`;
  return `<span class="dividend-yoy-text"><span class="dividend-yoy-number is-${up ? 'up' : 'down'}">${escapeHtml(pct)}</span> · ${escapeHtml(LABELS.dividendVsLastYear)}</span>`;
}

function getDividendPercentSub(value, total, tone) {
  const ratio = safeNumber(total, 0) > 0 ? safeNumber(value, 0) / safeNumber(total, 0) : 0;
  return `<span class="dividend-metric-percent is-${tone}">${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%</span>`;
}

function getDividendProgressPercent(value, total) {
  if (safeNumber(total, 0) <= 0) return '0.0';
  const ratio = Math.min(1, Math.max(0, safeNumber(value, 0) / safeNumber(total, 0)));
  return (ratio * 100).toFixed(1);
}

// 股息页先给全年预计一个明确结论，再把已到账/待到账作为进度口径下沉。
function getDividendMetricColumn(label, value, sub = '', tone = '') {
  return `<div class="dm-col">
    <span class="dm-label">${escapeHtml(label)}</span>
    <strong class="dm-value${tone ? ` is-${tone}` : ''}">${escapeHtml(formatDisplayMoney(value, 'CNY'))}</strong>
    <span class="dm-sub">${sub}</span>
  </div>`;
}

function renderDividendMetricGrid(model) {
  const m = model.metrics;
  const receivedProgress = getDividendProgressPercent(m.receivedCny, m.projectedCny);
  const maxMonth = Math.max(1, ...model.months.map((item) => safeNumber(item.totalCny, 0)));
  const monthBars = model.months.map((item) => {
    const height = Math.max(item.totalCny > 0 ? 3 : 1, safeNumber(item.totalCny, 0) / maxMonth * 54);
    const tone = item.month === model.currentMonth ? ' is-current' : item.phase === 'past' ? ' is-past' : '';
    return `<span class="${tone.trim()}" title="${item.month} 月 ${escapeHtml(formatDisplayMoney(item.totalCny, 'CNY'))}"><i style="height:${height.toFixed(1)}px"></i><small>${item.month}</small></span>`;
  }).join('');
  /* 三个互斥的桶，相加恒等于「预计全年」：
     已到账（钱已入账）→ 在途（已公告/待核对，等着到账）→ 预估（按往年节奏推算）。
     旧版「已确认 ⊂ 已承诺」是包含关系，读者要做减法才知道还差多少，改为互斥分段。 */
  const pipelineCny = Math.max(0, m.committedCny - m.receivedCny);
  const stackWidth = (value) => (m.projectedCny > 0 ? Math.max(0, safeNumber(value, 0) / m.projectedCny * 100) : 0).toFixed(2);
  refs.dividendMetricGrid.innerHTML = `
    <div class="dividend-ledger-hero">
      <span class="dm-label">预计全年${m.projectedYoy !== null && Number.isFinite(Number(m.projectedYoy)) ? `<em class="dm-yoy">${formatYoyBadge(m.projectedYoy)}</em>` : ''}</span>
      <strong class="dm-value is-projected">${escapeHtml(formatDisplayMoney(m.projectedCny, 'CNY'))}</strong>
      <div class="dividend-ledger-stack" role="img" aria-label="构成：已到账 ${receivedProgress}%，在途与预估待入账">
        <i class="is-received" style="width:${stackWidth(m.receivedCny)}%"></i><i class="is-pipeline" style="width:${stackWidth(pipelineCny)}%"></i><i class="is-forecast" style="width:${stackWidth(m.forecastCny)}%"></i>
      </div>
      <div class="dividend-ledger-legend">
        <div class="dll-row"><span class="dll-key"><i class="dll-dot is-received"></i>已到账</span><small>钱已入账</small><b>${escapeHtml(formatDisplayMoney(m.receivedCny, 'CNY'))}</b></div>
        <div class="dll-row"><span class="dll-key"><i class="dll-dot is-pipeline"></i>在途</span><small>已公告 · 等待到账</small><b>${escapeHtml(formatDisplayMoney(pipelineCny, 'CNY'))}</b></div>
        <div class="dll-row"><span class="dll-key"><i class="dll-dot is-forecast"></i>预估</span><small>按往年节奏推算</small><b>${escapeHtml(formatDisplayMoney(m.forecastCny, 'CNY'))}</b></div>
      </div>
      ${model.excludedHistoricalEstimateCount > 0 ? `<small class="dm-sub">另有 ${model.excludedHistoricalEstimateCount} 笔早年股息缺少当年持仓记录，仅存档、不计入统计</small>` : ''}
    </div>
    <div class="dividend-year-chart" role="img" aria-label="全年各月股息柱状图">
      <div class="dividend-year-chart-head"><span>月度股息</span><small>1—12 月</small></div>
      <div class="dividend-year-bars">${monthBars}</div>
    </div>`;
}

// 月份状态摘要：只列非零项，空月显示破折号，压低视觉噪音。
function getDividendMonthStatusText(item) {
  const parts = [];
  if (item.receivedCny > 0) parts.push(`${LABELS.dividendReceivedStatus} ${formatDisplayMoney(item.receivedCny, 'CNY')}`);
  if (item.dueCny > 0) parts.push(`待核对 ${formatDisplayMoney(item.dueCny, 'CNY')}`);
  if (item.phase !== 'past' && item.upcomingCny > 0) parts.push(`在途 ${formatDisplayMoney(item.upcomingCny, 'CNY')}`);
  if (item.phase === 'past' && item.pendingCny > 0) parts.push(`${LABELS.dividendPending} ${formatDisplayMoney(item.pendingCny, 'CNY')}`);
  return parts.length ? parts.join(' · ') : '—';
}

let dividendPastExpanded = false;

export function toggleDividendPastMonths() {
  dividendPastExpanded = !dividendPastExpanded;
  renderDividendCalendarPage();
}

function renderDividendMonths(model) {
  const populated = model.months.filter((item) => item.totalCny > 0);
  const past = populated.filter((item) => item.phase === 'past');
  const visible = populated.filter((item) => item.phase !== 'past' || dividendPastExpanded);
  const rowSummary = (item) => {
    const entries = model.allDetails.filter((entry) => entry.month === item.month);
    const names = Array.from(new Set(entries.map((entry) => entry.name || entry.symbol))).slice(0, 2).join(' · ');
    let status = '节奏预估';
    if (item.receivedCny > 0 && item.receivedCny >= item.totalCny) status = '已到账';
    else if (item.dueCny > 0) status = `${entries.length} 笔待核对`;
    else if (entries.some((entry) => entry.status === 'announced')) status = '已公告';
    else if (entries.some((entry) => entry.status === 'pending')) status = `${entries.length} 笔在途`;
    return `${names}${names ? ' · ' : ''}${status}`;
  };
  const tone = (item) => {
    if (item.phase === 'current') return 'current';
    if (item.receivedCny > 0 && item.receivedCny >= item.totalCny) return 'received';
    if (item.dueCny > 0) return 'due';
    if (model.allDetails.some((entry) => entry.month === item.month && entry.status === 'announced')) return 'announced';
    if (model.allDetails.some((entry) => entry.month === item.month && entry.status === 'pending')) return 'pending';
    return 'forecast';
  };
  const rows = visible.length ? visible.map((item) => {
    const key = tone(item);
    const progress = item.totalCny > 0 ? Math.min(100, Math.max(0, item.receivedCny / item.totalCny * 100)) : 0;
    return `<button class="dividend-month-row is-${item.phase} is-${key}" type="button" data-dividend-month="${item.month}"${item.phase === 'current' ? ` style="--dmr-progress:${progress.toFixed(1)}%" aria-label="${item.month} 月，到账进度 ${Math.round(progress)}%"` : ''}>
      <span class="dmr-label">${String(item.month).padStart(2, '0')}</span>
      <span class="dmr-status"><i aria-hidden="true"></i><span>${escapeHtml(rowSummary(item))}</span></span>
      <strong class="dmr-total">${escapeHtml(formatDisplayMoney(item.totalCny, 'CNY'))}</strong>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 5.5 16 12l-6.5 6.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>
      ${item.phase === 'current' ? '<span class="dmr-progress" aria-hidden="true"><i></i></span>' : ''}
    </button>`;
  }).join('') : '<div class="month-detail-empty">当前筛选暂无股息记录</div>';
  const pastToggle = past.length ? `<button class="dividend-past-toggle" type="button" data-dividend-past-toggle aria-expanded="${dividendPastExpanded}">${dividendPastExpanded ? '收起已过月份' : `展开已过月份 · ${past.length}`}</button>` : '';
  refs.dividendMonthGrid.innerHTML = `${pastToggle}${rows}<p class="dividend-month-note">黄＝待核对 · 紫＝在途／当月 · 灰＝节奏预估。点按某月查看逐笔并确认到账。</p>`;
}

function getShortMonthDay(value) {
  const date = value || '';
  const mmdd = date.length >= 10 ? date.slice(5) : date;
  return mmdd;
}

function getMonthDetailDateShort(entry) {
  if (entry.isAnnounced || entry.status === 'announced') {
    const ex = getShortMonthDay(entry.exDate);
    const pay = getShortMonthDay(entry.payDate || entry.exDate);
    return `${LABELS.dividendExDateLabel} ${ex} \u00b7 ${LABELS.dividendPayDateActual} ${pay}`;
  }
  if (entry.receivedDate) return `${getShortMonthDay(entry.receivedDate)}(实收)`;
  const mmdd = getShortMonthDay(entry.payDate || entry.exDate || '');
  if (entry.status === 'due') return `${mmdd}(待核对)`;
  return entry.payDateEstimated ? `${mmdd}(${LABELS.dividendPayDateEstimated})` : mmdd;
}

// 供月份弹窗使用：返回某月紧凑明细的标题、小结与行 HTML。
export function buildDividendMonthDetail(month) {
  const model = computeDividendCalendar();
  const item = model.months[month - 1] || null;
  const entries = model.allDetails
    .filter((entry) => entry.month === month)
    .sort((a, b) => `${a.payDate}|${a.symbol}`.localeCompare(`${b.payDate}|${b.symbol}`));
  const summaryParts = [];
  if (item) {
    summaryParts.push(`${LABELS.dividendReceivedStatus} ${formatDisplayMoney(item.receivedCny, 'CNY')}`);
    if (item.dueCny > 0) summaryParts.push(`待核对 ${formatDisplayMoney(item.dueCny, 'CNY')}`);
    /* upcomingCny 已含 dueCny，这里必须减掉，否则同一笔钱在「待核对」和「即将到账」里各出现一次。
       三项互不重叠且相加等于当月合计。 */
    const restUpcomingCny = Math.max(0, item.upcomingCny - item.dueCny);
    if (item.phase !== 'past') {
      if (restUpcomingCny > 0) summaryParts.push(`${LABELS.dividendUpcoming} ${formatDisplayMoney(restUpcomingCny, 'CNY')}`);
    } else if (item.pendingCny > 0) summaryParts.push(`${LABELS.dividendPending} ${formatDisplayMoney(item.pendingCny, 'CNY')}`);
  }
  const body = entries.length
    ? entries.map((entry) => {
        // 灰=节奏预估(不可确认)；蓝=已公告未除息；绿=已确认到账；黄=自动入账但未确认。
        const dotState = entry.isForecast
          ? 'is-forecast'
          : (entry.isAnnounced || entry.status === 'announced') ? 'is-announced'
            : entry.status === 'due' ? 'is-due'
            : (entry.confirmed ? 'is-confirmed' : 'is-unconfirmed');
        const clickable = !entry.isForecast && !(entry.isAnnounced || entry.status === 'announced') && entry.sourceId;
        const tag = clickable ? 'button' : 'div';
        const attrs = clickable
          ? `type="button" data-modal-action="edit-dividend-ledger" data-source-id="${escapeHtml(entry.sourceId)}" aria-label="编辑 ${escapeHtml(entry.name)} 股息"`
          : '';
        const statusLabel = entry.isForecast ? '预估' : (entry.isAnnounced || entry.status === 'announced') ? '已公告' : entry.status === 'due' ? '待核对' : entry.confirmed ? '已到账' : '在途';
        return `<${tag} class="month-detail-row ${dotState}${clickable ? ' is-clickable' : ''}" ${attrs}>
          <span class="mdr-copy"><span class="mdr-company"><span class="mdr-name">${escapeHtml(entry.name)}</span><small>${escapeHtml(entry.symbol)}</small></span><span class="mdr-date">${escapeHtml(getMonthDetailDateShort(entry))}</span></span>
          <span class="mdr-side"><span class="mdr-amount">${escapeHtml(formatDisplayMoney(entry.netCny, 'CNY'))}</span><span class="mdr-tag">${statusLabel}</span></span>
        </${tag}>`;
      }).join('')
    : `<div class="month-detail-empty">${escapeHtml(LABELS.dividendEmptyTitle)}</div>`;
  return {
    title: `${month}${LABELS.dividendMonthSuffix}`,
    phase: item ? item.phase : 'future',
    total: item ? formatDisplayMoney(item.totalCny, 'CNY') : formatDisplayMoney(0, 'CNY'),
    summary: summaryParts.join(' · '),
    stats: item ? [
      { label: LABELS.dividendReceivedStatus, value: formatDisplayMoney(item.receivedCny, 'CNY') },
      { label: item.dueCny > 0 ? '待核对' : LABELS.dividendUpcoming, value: formatDisplayMoney(item.dueCny > 0 ? item.dueCny : item.upcomingCny, 'CNY') }
    ] : [],
    hasConfirmable: entries.some((entry) => !entry.isForecast && !(entry.isAnnounced || entry.status === 'announced') && entry.sourceId),
    body
  };
}

export function renderDividendCalendarPage() {
  const model = computeDividendCalendar();
  refs.dividendCalendarYear.textContent = '';
  refs.dividendFilterButtons.forEach((button) => {
    const isActive = button.dataset.dividendFilter === model.filterKey;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
  refs.dividendCalendarListView.hidden = false;
  refs.dividendMonthDetailView.hidden = true;
  refs.dividendMonthDetailView.innerHTML = '';
  renderDividendMetricGrid(model);
  renderDividendMonths(model);
}

/* ── Income Summary ── */
function isIncomeValueMissing(value) {
  return value === null || value === undefined || !Number.isFinite(Number(value));
}

function formatIncomeMoney(value) {
  return isIncomeValueMissing(value) ? '待回填' : formatDisplayMoney(value, 'CNY');
}

function formatIncomeSignedMoney(value) {
  if (isIncomeValueMissing(value)) return '待回填';
  if (!state.showAmounts) return MASK_AMOUNT;
  const amount = safeNumber(value, 0);
  return `${amount > 0 ? '+' : ''}${formatMoney(amount, 'CNY')}`;
}

function formatIncomeRate(value) {
  if (isIncomeValueMissing(value)) return '待回填';
  if (!state.showAmounts) return MASK_AMOUNT;
  const numeric = safeNumber(value, 0);
  const sign = numeric > 0 ? '+' : numeric < 0 ? '-' : '';
  return `${sign}${formatPercent(Math.abs(numeric))}`;
}

// 主窗口只显示一个结论（当年资金收益）和一个比较值（收益率）。
// 年初净值、净注入和现金余额属于计算口径，折叠下沉，避免首屏同时争夺注意力。
function renderIncomeOverview(model) {
  const row = model.current;
  const holdingSummary = computeHoldings();
  const cashActive = isCashModelActive();
  const cashText = cashActive ? formatDisplayMoney(holdingSummary.cashBalanceCny, 'CNY') : '未设置';
  const cashMarkup = `<button class="income-cash-context" type="button" data-income-cash-settings aria-label="${cashActive ? '编辑当前现金余额' : '设置当前现金余额'}"><small>现金余额</small><strong class="income-amount ${cashActive ? getSignedTone(holdingSummary.cashBalanceCny) : 'is-flat'}">${escapeHtml(cashText)}</strong><em>${cashActive ? '当前余额' : '点击设置'}</em></button>`;
  if (!row || !row.capitalReturnAvailable) {
    refs.incomeOverviewGrid.innerHTML = `<div class="empty-state empty-state--compact"><p class="empty-state-title">暂无资金收益数据</p><p class="empty-state-note">回填或生成 ${model.currentYear - 1} 年末净值后，这里会展示今年至今的资金收益。</p></div><div class="income-cash-standalone">${cashMarkup}</div>`;
    return;
  }
  refs.incomeOverviewGrid.innerHTML = `
    <article class="income-hero">
      <div class="income-hero-head">
        <span class="income-hero-label">${model.currentYear} 资金收益</span>
        <strong class="income-hero-rate">${escapeHtml(formatIncomeRate(row.capitalReturnRate))}</strong>
      </div>
      <strong class="income-hero-value income-amount ${getReturnTone(row.capitalReturnCny)}">${escapeHtml(formatIncomeSignedMoney(row.capitalReturnCny))}</strong>
      <div class="income-hero-context">
        <span><small>当前净值</small><strong class="income-amount">${escapeHtml(formatIncomeMoney(row.yearEndNetCny))}</strong></span>
        <span><small>年初净值</small><strong class="income-amount">${escapeHtml(formatIncomeMoney(row.yearStartNetCny))}</strong></span>
        <span><small>净注入</small><strong class="income-amount">${escapeHtml(formatIncomeSignedMoney(row.netInflowCny))}</strong></span>
        ${cashMarkup}
      </div>
    </article>`;
}

function getTrendValue(row, key) {
  const value = row && row[key];
  return isIncomeValueMissing(value) ? null : safeNumber(value, 0);
}

function getTrendPoint(row, index, total, key, minValue, maxValue) {
  const value = getTrendValue(row, key);
  if (value === null) return null;
  const width = 720;
  const height = 170;
  const padX = 34;
  const padTop = 30;
  const padBottom = 14;
  const innerWidth = width - padX * 2;
  const innerHeight = height - padTop - padBottom;
  const x = total <= 1 ? width / 2 : padX + (innerWidth * index) / (total - 1);
  const range = maxValue === minValue ? 1 : maxValue - minValue;
  const y = padTop + ((maxValue - value) / range) * innerHeight;
  return { x: roundSvgNumber(x), y: roundSvgNumber(y), value };
}

function roundSvgNumber(value) {
  return Math.round(value * 100) / 100;
}

function getTrendSeriesMarkup(rows, key, className, minValue, maxValue) {
  const points = rows
    .map((row, index) => getTrendPoint(row, index, rows.length, key, minValue, maxValue))
    .filter(Boolean);
  if (!points.length) return '';
  const pointText = points.map((point) => `${point.x},${point.y}`).join(' ');
  const circles = points.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="3.4"></circle>`).join('');
  const labels = points.map((point, index) => `<text x="${point.x}" y="${Math.max(12, point.y - 10)}" text-anchor="middle"${index === points.length - 1 ? ' class="is-latest"' : ''}>${escapeHtml(formatIncomeRate(point.value))}</text>`).join('');
  return `<g class="income-trend-series ${className}">
    <polyline points="${pointText}"></polyline>
    ${circles}
    <g class="income-trend-labels">${labels}</g>
  </g>`;
}

function buildIncomeTrendCard(rows, item, currentYear) {
  const values = rows.map((row) => getTrendValue(row, item.key)).filter((value) => value !== null);
  if (!values.length) return `<section class="fund-card income-trend-card is-empty"><header class="fund-card-head"><span class="fund-card-label">${item.label}</span></header><p class="fund-card-empty">暂无数据</p></section>`;
  const minValue = Math.min(0, ...values);
  const maxValue = Math.max(0, ...values);
  const zeroPoint = getTrendPoint({ rate: 0 }, 0, 1, 'rate', minValue, maxValue);
  const available = rows.map((row) => ({ row, value: getTrendValue(row, item.key) })).filter((entry) => entry.value !== null);
  const latest = available[available.length - 1];
  const previous = available.length > 1 ? available[available.length - 2] : null;
  const yoy = previous && previous.value !== 0 ? (latest.value - previous.value) / Math.abs(previous.value) : null;
  return `<section class="fund-card income-trend-card">
    <header class="fund-card-head">
      <span class="fund-card-label">${item.label}</span>
      <span class="fund-card-latest"><strong>${escapeHtml(formatIncomeRate(latest.value))}</strong><small>${latest.row.year === currentYear ? '至今' : latest.row.year}</small></span>
      ${yoy === null ? '' : `<span class="fund-card-trend ${yoy > 0 ? 'is-gain' : yoy < 0 ? 'is-loss' : 'is-flat'}">${yoy > 0 ? '+' : ''}${(yoy * 100).toFixed(1)}% <small>同比</small></span>`}
    </header>
    <svg class="income-trend-svg" viewBox="0 0 720 170" role="img" aria-label="${item.label}历年走势">
      <line class="income-trend-zero" x1="28" x2="692" y1="${zeroPoint.y}" y2="${zeroPoint.y}"></line>
      ${getTrendSeriesMarkup(rows, item.key, item.className, minValue, maxValue)}
    </svg>
    <div class="fund-chart-years income-trend-years">${rows.map((row) => `<span>${row.year === currentYear ? `${String(row.year).slice(2)}至今` : String(row.year).slice(2)}</span>`).join('')}</div>
  </section>`;
}

// 与公司基本面一致：两项收益率各用一张带点值、最新值和同比的线图。
function renderIncomeTrend(model) {
  const rows = model.trendRows;
  const values = ['capitalReturnRate', 'dividendYieldRate'].flatMap((key) => rows.map((row) => getTrendValue(row, key)).filter((value) => value !== null));
  if (!values.length) {
    refs.incomeTrend.innerHTML = `<div class="empty-state empty-state--compact"><p class="empty-state-title">暂无趋势数据</p><p class="empty-state-note">有历年净值或历史回填后会展示收益率趋势。</p></div>`;
    return;
  }
  const pointCounts = ['capitalReturnRate', 'dividendYieldRate']
    .map((key) => rows.filter((row) => getTrendValue(row, key) !== null).length);
  if (!pointCounts.some((count) => count >= 2)) {
    refs.incomeTrend.innerHTML = `<div class="empty-state empty-state--compact"><p class="empty-state-title">历史数据不足</p><p class="empty-state-note">至少两个年度有收益率后，才会绘制可比较的趋势。</p></div>`;
    return;
  }
  const minValue = Math.min(0, ...values);
  const maxValue = Math.max(0, ...values);
  const zeroPoint = getTrendPoint({ rate: 0 }, 0, 1, 'rate', minValue, maxValue);
  refs.incomeTrend.innerHTML = `<div class="income-trend-combined">
    <svg class="income-trend-svg" viewBox="0 0 720 170" role="img" aria-label="历年资金收益率与股息收益率">
      <line class="income-trend-zero" x1="28" x2="692" y1="${zeroPoint.y}" y2="${zeroPoint.y}"></line>
      ${getTrendSeriesMarkup(rows, 'capitalReturnRate', 'is-capital', minValue, maxValue)}
      ${getTrendSeriesMarkup(rows, 'dividendYieldRate', 'is-dividend', minValue, maxValue)}
    </svg>
    <div class="income-trend-years">${rows.map((row) => `<span>${row.year}</span>`).join('')}</div>
    <div class="income-trend-legend"><span class="is-capital"><i></i>资金收益率</span><span class="is-dividend"><i></i>股息收益率</span></div>
  </div>`;
}

function getIncomeYearCell(label, value, extraClass = '') {
  return `<div class="income-year-cell${extraClass ? ` ${extraClass}` : ''}" data-label="${escapeHtml(label)}">${escapeHtml(value)}</div>`;
}

// 年份格：该年有持仓快照时可点，弹出当年持仓明细。
function getIncomeYearTitleCell(row) {
  const hasSnapshot = state.yearlyHoldings.some((entry) => entry && entry.year === row.year);
  if (!hasSnapshot) return getIncomeYearCell('年份', String(row.year), 'is-year');
  return `<div class="income-year-cell is-year" data-label="年份">
    <button class="income-year-link" type="button" data-year-holdings="${row.year}" title="查看 ${row.year} 年持仓" aria-label="查看 ${row.year} 年持仓">${row.year}</button>
  </div>`;
}

function getIncomeYearActionCell(row) {
  const label = row.hasManualBackfill ? '修正年度数据' : '填写年度数据';
  return `<div class="income-year-action-cell" data-label="操作">
    <button class="income-year-action-button" type="button" data-year-annals="${row.year}" aria-label="查看 ${row.year} 年鉴" title="查看 ${row.year} 年鉴">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 4.5h9.5A2.5 2.5 0 0 1 18 7v12.5H8A2 2 0 0 1 6 17.5V4.5Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"></path>
        <path d="M6 17.5A2 2 0 0 1 8 15.5h10M9.5 8.5h5M9.5 11.5h5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"></path>
      </svg>
    </button>
    <button class="income-year-action-button${row.hasManualBackfill ? ' is-filled' : ''}" type="button" data-income-manual-year="${row.year}" aria-label="${label} ${row.year}" title="${label}">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 19h4.2L18.4 9.8a2 2 0 0 0 0-2.8L17 5.6a2 2 0 0 0-2.8 0L5 14.8V19Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"></path>
        <path d="M13.2 6.6l4.2 4.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"></path>
      </svg>
    </button>
  </div>`;
}

function renderIncomeYearList(model) {
  if (!model.rows.length) {
    refs.incomeYearList.innerHTML = `<div class="empty-state empty-state--compact"><p class="empty-state-title">暂无年度数据</p><p class="empty-state-note">导入历史回填后会显示年度列表。</p></div>`;
    return;
  }
  const rows = model.rows.map((row) => `<div class="income-year-row" role="row" data-annual-year="${row.year}" tabindex="0" aria-label="查看 ${row.year} 年度回顾">
      <div class="income-year-primary">
        <strong class="income-year-year">${row.year}</strong>
        <small>${row.hasManualBackfill ? '含手工回填' : '自动统计'}</small>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 5.5 16 12l-6.5 6.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>
      </div>
      <div class="income-year-metrics">
        <span><small>股息</small><b>${escapeHtml(formatIncomeMoney(row.dividendCny))}</b></span>
        <span><small>股息率</small><b>${escapeHtml(formatIncomeRate(row.dividendYieldRate))}</b></span>
        <span><small>资金收益</small><b class="${getReturnTone(row.capitalReturnCny)}">${escapeHtml(formatIncomeSignedMoney(row.capitalReturnCny))}</b></span>
        <span><small>收益率</small><b class="${getReturnTone(row.capitalReturnRate)}">${escapeHtml(formatIncomeRate(row.capitalReturnRate))}</b></span>
        <span><small>年末净值</small><b>${escapeHtml(formatIncomeMoney(row.yearEndNetCny))}</b></span>
        <span><small>净注入</small><b>${escapeHtml(formatIncomeSignedMoney(row.netInflowCny))}</b></span>
      </div>
      <div class="income-year-secondary">
        <button type="button" data-year-holdings="${row.year}">持仓快照</button>
        <button type="button" data-year-annals="${row.year}">查看年鉴</button>
        <button type="button" data-income-manual-year="${row.year}">${row.hasManualBackfill ? '编辑回填' : '回填数据'}</button>
      </div>
    </div>`).join('');
  refs.incomeYearList.innerHTML = `<div class="income-year-table" role="table" aria-label="年度收益列表">
    ${rows}
  </div>`;
}

function formatRecordQuantity(value) {
  return safeNumber(value, 0).toLocaleString('en-US', { maximumFractionDigits: 6 });
}

function getSignedTone(value) {
  const numeric = safeNumber(value, 0);
  if (numeric > 0) return 'is-positive';
  if (numeric < 0) return 'is-negative';
  return 'is-flat';
}

// 盈亏配色按 A 股习惯：赚钱=红，亏钱=绿。用于收益/盈亏类数字。
function getReturnTone(value) {
  const numeric = safeNumber(value, 0);
  if (numeric > 0) return 'is-gain';
  if (numeric < 0) return 'is-loss';
  return 'is-flat';
}

function getCashFlowTypeLabel(entry) {
  return entry && entry.isWithdrawal ? '出金' : '入金';
}

function getTradeSideLabel(side) {
  return side === 'sell' ? '卖出' : '买入';
}

function getRecordEmptyMarkup(title, note) {
  return `<div class="income-record-empty"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(note)}</span></div>`;
}

function renderCashFlowRows(records) {
  if (!records.length) return getRecordEmptyMarkup('暂无出入金', '新增记录后会自动进入年度净注入口径。');
  return records.map((entry) => `
    <button class="income-record-row" type="button" data-cash-flow-id="${escapeHtml(entry.id)}">
      <span class="record-main">
        <strong>${escapeHtml(getCashFlowTypeLabel(entry))}</strong>
        <small>${escapeHtml(entry.date)}${entry.note ? ` · ${escapeHtml(entry.note)}` : ''}</small>
      </span>
      <span class="record-amount income-amount ${getSignedTone(entry.signedCny)}">${escapeHtml(formatIncomeSignedMoney(entry.signedCny))}</span>
    </button>
  `).join('');
}

function renderTradeRows(records) {
  if (!records.length) return getRecordEmptyMarkup('暂无交易', '新增买入或卖出后，会在这里按时间保留明细。');
  return records.map((entry) => `
    <button class="income-record-row income-record-row--trade" type="button" data-trade-id="${escapeHtml(entry.id)}">
      <span class="record-main">
        <strong>${escapeHtml(getTradeSideLabel(entry.side))} ${escapeHtml(entry.name || entry.symbol)}</strong>
        <small>${escapeHtml(entry.date)} · ${escapeHtml(formatRecordQuantity(entry.shares))} 股 @ ${escapeHtml(String(entry.price))} ${escapeHtml(entry.currency || '')}</small>
      </span>
      <span class="record-amount income-amount ${getReturnTone(entry.cashImpactCny)}">${escapeHtml(formatIncomeSignedMoney(entry.cashImpactCny))}</span>
    </button>
  `).join('');
}

function renderDividendRecordRows(records) {
  if (!records.length) return getRecordEmptyMarkup('暂无股息入账', '在股息日历中确认实收入账后，会在这里保留记录。');
  return records.map((entry) => `
    <button class="income-record-row" type="button" data-dividend-source-id="${escapeHtml(entry.sourceId)}">
      <span class="record-main">
        <strong>股息 · ${escapeHtml(entry.name || entry.symbol)}</strong>
        <small>${escapeHtml(entry.date)}${entry.note ? ` · ${escapeHtml(entry.note)}` : ''}</small>
      </span>
      <span class="record-amount income-amount ${getSignedTone(entry.amountCny)}">${escapeHtml(formatIncomeSignedMoney(entry.amountCny))}</span>
    </button>
  `).join('');
}

export function renderIncomeRecords() {
  if (!refs.incomeRecordsList) return;
  const recordsYear = new Date().getFullYear();
  const cash = computeCashFlowRecords(recordsYear);
  const dividends = computeDividendRecords(recordsYear);
  const trades = computeTradeSummary(recordsYear);
  const buyCount = trades.records.filter((entry) => entry.side === 'buy').length;
  const sellCount = trades.records.filter((entry) => entry.side === 'sell').length;
  refs.incomeRecordsList.innerHTML = `
    <section class="record-focus">
      <span class="ledger-eyebrow">${recordsYear} · 净注入</span>
      <strong class="income-amount ${getSignedTone(cash.netInflowCny)}">${escapeHtml(formatIncomeSignedMoney(cash.netInflowCny))}</strong>
      <p>累计入金减去出金 · ${cash.count} 笔资金记录</p>
    </section>
    <div class="income-record-overview ledger-record-stats">
      <article><span>买入</span><strong>${buyCount} 笔</strong></article>
      <article><span>卖出</span><strong>${sellCount} 笔</strong></article>
      <article><span>出入金</span><strong>${cash.count} 笔</strong></article>
      <article><span>股息</span><strong>${dividends.count} 笔</strong></article>
    </div>
    <section class="income-record-block ledger-record-block">
      <div class="income-record-head"><h3>买卖流水</h3><span>${trades.count} 笔</span></div>
      <div class="income-record-list">${renderTradeRows(trades.records)}</div>
    </section>
    <section class="income-record-block ledger-record-block">
      <div class="income-record-head"><h3>出入金流水</h3><span>${cash.count} 笔</span></div>
      <div class="income-record-list">${renderCashFlowRows(cash.records)}</div>
    </section>
    <section class="income-record-block ledger-record-block">
      <div class="income-record-head"><h3>股息入账</h3><span>${dividends.count} 笔 · ${escapeHtml(formatIncomeMoney(dividends.totalCny))}</span></div>
      <div class="income-record-list">${renderDividendRecordRows(dividends.records)}</div>
    </section>`;
}

export function renderIncomeSummaryPage() {
  const model = computeIncomeSummary();
  // 已设置当前现金后，收益页隐藏重复入口（CSS 按此类名区分）。
  if (refs.incomeSummaryPage) refs.incomeSummaryPage.classList.toggle('is-cash-active', isCashModelActive());
  renderIncomeOverview(model);
  renderIncomeTrend(model);
  renderIncomeYearList(model);
}

function formatAnnualRate(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const numeric = Number(value);
  return `${numeric > 0 ? '+' : numeric < 0 ? '−' : ''}${Math.abs(numeric * 100).toFixed(1)}%`;
}

function formatAnnualSignedMoney(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const numeric = Number(value);
  return `${numeric > 0 ? '+' : numeric < 0 ? '−' : ''}${formatDisplayMoney(Math.abs(numeric), 'CNY')}`;
}

export function renderAnnualReviewPage() {
  if (!refs.annualReviewContent) return;
  const summary = computeIncomeSummary();
  const years = summary.rows.map((row) => row.year);
  if (!years.length) {
    refs.annualReviewContent.innerHTML = '<div class="empty-state"><strong>暂无年度数据</strong><span>完成年度净值或回填后，这里会生成复盘。</span></div>';
    return;
  }
  if (!years.includes(state.activeAnnualYear)) state.activeAnnualYear = years[0];
  const annals = computeYearAnnals(state.activeAnnualYear);
  if (!annals) {
    refs.annualReviewContent.innerHTML = '<div class="empty-state"><strong>该年暂无数据</strong></div>';
    return;
  }
  const row = annals.row;
  const attribution = annals.attribution || { available: false };
  const attrRows = attribution.available ? [
    { label: '股息收入', value: attribution.dividendCny, tone: 'iris' },
    { label: 'EPS 增长', value: attribution.epsCny, tone: 'iris' },
    { label: '估值变动', value: attribution.valuationCny, tone: 'iris-soft' },
    { label: '汇率变动', value: attribution.fxCny, tone: 'ink' }
  ] : [
    { label: '股息收入', value: attribution.dividendCny, tone: 'iris' }
  ];
  const attrTotal = attrRows.reduce((sum, item) => sum + Math.abs(safeNumber(item.value, 0)), 0) || 1;
  const attrBar = attrRows.map((item) => `<i class="is-${item.tone}" style="width:${(Math.abs(safeNumber(item.value, 0)) / attrTotal * 100).toFixed(2)}%"></i>`).join('');
  const maxDividend = Math.max(1, ...annals.dividendMonths.map((value) => safeNumber(value, 0)));
  const currentMonth = annals.isCurrentYear ? new Date().getMonth() : -1;
  const monthLabels = ['J','F','M','A','M','J','J','A','S','O','N','D'];
  const annualBuyCount = annals.trades.filter((trade) => trade.side === 'buy').length;
  const annualSellCount = annals.trades.filter((trade) => trade.side === 'sell').length;
  const trades = annals.trades.length ? annals.trades.map((trade) => `<div class="annual-trade-row">
    <span><strong>${trade.side === 'sell' ? '卖出' : '买入'} ${escapeHtml(trade.name)}</strong><small>${escapeHtml(trade.date.slice(5).replace('-', '/'))} · ${escapeHtml(String(trade.shares))} 股 @ ${escapeHtml(String(trade.price))}</small></span>
    <span><b>${escapeHtml(formatAnnualSignedMoney(trade.cashImpactCny))}</b></span>
  </div>`).join('') : '<div class="month-detail-empty">该年暂无交易记录</div>';

  refs.annualReviewContent.innerHTML = `
    <div class="annual-year-switch" role="group" aria-label="选择年度">${years.map((year) => `<button type="button" data-annual-select="${year}" class="${year === state.activeAnnualYear ? 'is-active' : ''}">${year}</button>`).join('')}<span>← 翻阅历年</span></div>
    <section class="annual-focus">
      <span class="ledger-eyebrow">XIRR · 资金加权年化</span>
      <strong>${escapeHtml(formatAnnualRate(annals.xirr))}</strong>
      <p>${annals.isCurrentYear ? `截至 ${summary.today.slice(0, 7).replace('-', '/')}` : '完整年度'} · 年初净值 ${escapeHtml(formatIncomeMoney(row.yearStartNetCny))} → ${annals.isCurrentYear ? '当前' : '年末'} ${escapeHtml(formatIncomeMoney(row.yearEndNetCny))}</p>
    </section>
    <section class="annual-section">
      <p class="ledger-eyebrow">收益归因</p>
      <div class="annual-attribution-bar">${attrBar}</div>
      <div class="annual-attribution-rows">${attrRows.map((item) => `<div><span><i class="is-${item.tone}"></i>${item.label}</span><strong class="${getReturnTone(item.value)}">${escapeHtml(formatAnnualSignedMoney(item.value))}</strong></div>`).join('')}</div>
      <p class="annual-note">${attribution.available ? `覆盖 ${Math.round(safeNumber(attribution.epsSplitCoverage, 0) * 100)}% 持仓 · 归因为辅助复盘，非会计级精确拆分。` : '缺少年初持仓或年界汇率，当前仅展示可核对部分。'}</p>
    </section>
    <section class="annual-section">
      <p class="ledger-eyebrow">当年股息现金流</p>
      <div class="annual-dividend-bars">${annals.dividendMonths.map((value, index) => `<span><i class="${index === currentMonth ? 'is-current' : ''}" style="height:${Math.max(value > 0 ? 3 : 1, safeNumber(value, 0) / maxDividend * 58).toFixed(1)}px"></i><small>${monthLabels[index]}</small></span>`).join('')}</div>
      <div class="annual-total-row"><span>${annals.isCurrentYear ? '本年已确认股息' : '全年确认股息'}</span><strong>${escapeHtml(formatIncomeMoney(row.dividendCny))}</strong></div>
    </section>
    <section class="annual-section">
      <p class="ledger-eyebrow">交易复盘</p>
      <div class="annual-trades">${trades}</div>
      <p class="annual-trade-summary">全年 <strong>${annals.trades.length}</strong> 笔 · 买入 <strong>${annualBuyCount}</strong> · 卖出 <strong>${annualSellCount}</strong></p>
    </section>`;
}

/* ── Holdings ── */

/* 名称后的 4px 金点 = 这只股票有在途 / 已公告但还没确认到账的股息事件。
   forecast 只是节奏预估、received 已经落袋，都不点亮。
   导出供 tests/core.test.mjs 钉规则：真实数据常年只有 forecast，UI 上造不出正向用例。 */
export function getPendingDividendSymbols() {
  const live = new Set(['pending', 'due', 'announced']);
  const symbols = new Set();
  computeDividendCalendar().allDetails.forEach((entry) => {
    if (entry && live.has(entry.status)) symbols.add(entry.symbol);
  });
  return symbols;
}

function getHoldingViewModel(item, index = 0, opts = {}) {
  const tooltipLines = buildDividendTooltipLines(item);
  const statusKey = normalizeDividendStatus(item.dividendStatus, 'missing');
  return {
    priceText: state.showAmounts ? formatPlainPrice(item.price) : MASK_PRICE,
    marketValueText: formatZenMoney(item.marketValueCny),
    annualDividendText: formatZenMoney(item.netAnnualDividendCny),
    quantityText: state.showAmounts ? String(item.quantity) : MASK_AMOUNT,
    weightText: formatZenPercent(item.holdingWeight),
    yieldText: formatZenPercent(item.effectiveYield),
    statusKey, statusLabel: getDividendStatusLabel(statusKey), tooltipLines,
    tooltipHtml: buildDividendTooltipHtml(tooltipLines),
    // 未设税率时年化是按 0% 估的，用中性的「年化股息」，别声称是税后
    annualDividendLabel: item.taxRateKnown ? '税后年化' : '年化股息',
    hasDividendEvent: Boolean(opts.pendingDividends && opts.pendingDividends.has(item.symbol)),
    staggerDelay: Math.min(index * HOLDING_ENTER_STAGGER_MS, HOLDING_ENTER_STAGGER_MAX_MS)
  };
}

/* 两层行：名称+代码（+金点）｜市值 · 右；现价·年化·率 ｜ 权重右。
   四个可点域保留：名称→详情，年化→税率，率→每股股息，市值→数量（现金模式开交易）。 */
function getHoldingMarkup(item, index, opts = {}) {
  const { animate = true } = opts, v = getHoldingViewModel(item, index, opts);
  return `<div class="holding-swipe${animate ? ' is-entering' : ''}" data-id="${item.localId}" style="--holding-swipe-offset:0px;animation-delay:${v.staggerDelay}ms;">
    <article class="holding-card stock" data-id="${item.localId}" data-dividend-status="${escapeHtml(item.dividendStatus || 'missing')}">
      <div class="stock-main">
        <span class="stock-name"><button class="stock-name-button" type="button" data-action="view-holding" aria-label="查看 ${escapeHtml(item.name)} 持仓详情">${escapeHtml(item.name)}</button><span class="code">${escapeHtml(item.symbol)}</span>${v.hasDividendEvent ? '<i class="divi-dot" title="有在途或已公告股息"></i>' : ''}</span>
        <button class="stock-mv" type="button" data-action="edit-quantity" data-holding-field="marketValue" aria-label="编辑 ${escapeHtml(item.name)} 持股数量">${escapeHtml(v.marketValueText)}</button>
      </div>
      <div class="stock-sub">
        <span class="stock-sub-main">现价 <span data-holding-field="price">${escapeHtml(v.priceText)}</span> · ${escapeHtml(v.annualDividendLabel)} <button type="button" data-action="edit-tax" data-holding-field="annualDividend" aria-label="设置股息税率">${escapeHtml(v.annualDividendText)}</button> · <button type="button" data-action="edit-dividend" data-holding-field="effectiveYieldValue" aria-label="覆写每股股息">${escapeHtml(v.yieldText)}</button></span>
        <span class="weight" data-holding-field="weight">${escapeHtml(v.weightText)}</span>
      </div>
    </article></div>`;
}

export function renderHoldingsView(holdings, opts = {}) {
  mutable.activeDividendTooltipButton = null;
  if (!holdings.length) { refs.stockList.innerHTML = ''; refs.legendToggle.hidden = true; return; }
  const pendingDividends = getPendingDividendSymbols();
  const visible = state.legendExpanded ? holdings : holdings.slice(0, LEGEND_COLLAPSED_COUNT);
  refs.stockList.innerHTML = visible.map((item, i) => getHoldingMarkup(item, i, { ...opts, pendingDividends })).join('');
  refs.legendToggle.hidden = holdings.length <= LEGEND_COLLAPSED_COUNT;
  refs.legendToggle.textContent = state.legendExpanded ? '收起' : `展开全部 ${holdings.length} 项`;
}

export function syncRenderedHoldingsView(holdings, opts = {}) {
  renderHoldingsView(holdings, { animate: false });
}

/* ── Reflow Animation ── */
export function captureHoldingPositions(excludedId = 0) {
  const pos = new Map();
  refs.stockList.querySelectorAll('.holding-swipe[data-id]').forEach((w) => { const id = safeNumber(w.dataset.id, 0); if (id && id !== excludedId) pos.set(id, w.getBoundingClientRect().top); });
  return pos;
}

export function animateHoldingReflow(prev) {
  if (!(prev instanceof Map) || !prev.size) return;
  const moved = [];
  Array.from(refs.stockList.querySelectorAll('.holding-swipe[data-id]')).forEach((w) => {
    const id = safeNumber(w.dataset.id, 0), pt = prev.get(id);
    if (typeof pt !== 'number') return;
    const dy = pt - w.getBoundingClientRect().top;
    if (Math.abs(dy) < 1) return;
    w.style.transition = 'none'; w.style.transform = `translateY(${dy}px)`; moved.push(w);
  });
  if (!moved.length) return;
  refs.stockList.getBoundingClientRect();
  moved.forEach((w) => { w.style.transition = ''; w.style.transform = ''; });
}

export function animateHoldingRemoval(wrapper, onComplete) {
  if (!wrapper) { onComplete(); return; }
  if (mutable.activeHoldingSwipe && mutable.activeHoldingSwipe.wrapper === wrapper) mutable.activeHoldingSwipe = null;
  const card = wrapper.querySelector('.holding-card');
  if (!card) { onComplete(); return; }
  let settled = false;
  const finish = () => { if (settled) return; settled = true; card.removeEventListener('transitionend', onTe); window.clearTimeout(fb); onComplete(); };
  const onTe = (e) => { if (e.target === card && e.propertyName === 'opacity') finish(); };
  const fb = window.setTimeout(finish, HOLDING_REMOVAL_FALLBACK_MS);
  wrapper.classList.add('is-deleting'); card.addEventListener('transitionend', onTe);
}

/* ── Dashboard Orchestration ── */
function renderDashboardIncrementally(summary, cs, bs, opts = {}) {
  renderHomePage(summary); patchLegendView(cs);
  renderHoldingsHero(summary);
  patchBucketsView(bs, summary.holdings, summary);
  renderDiagnosticsButton();
  renderSortChips(); renderTimestamp(); renderPrivacyButton();
  renderIncomeSummaryPage();
  renderAnnualReviewPage();
  renderIncomeRecords();
  renderDividendCalendarPage();
  renderReportCalendarPanel();
  renderFundamentalsPage();
  syncRenderedHoldingsView(summary.holdings, { animateReflow: opts.animateHoldingReflow });
}

export function renderSavedStateQuietly(opts = {}) {
  renderApp({ incremental: true, animateHoldingReflow: opts.animateHoldingReflow !== false });
}

export function renderApp(opts = {}) {
  const { animateLegend = true, animateBucketDetail = true, animateHoldings = true, renderHoldingsList = true, incremental = false, animateHoldingReflow = false } = opts;
  const summary = computeHoldings();
  const cs = getCompanySegments(summary.holdings);
  const bs = getBucketSegments(summary.holdings);
  renderPageChrome();
  if (incremental) { renderDashboardIncrementally(summary, cs, bs, { animateHoldingReflow }); return; }
  renderHomePage(summary); renderLegendView(cs, { animate: animateLegend });
  renderHoldingsHero(summary);
  renderBucketsView(bs, summary.holdings, summary, { animateDetail: animateBucketDetail });
  renderDiagnosticsButton();
  renderSortChips(); renderTimestamp(); renderPrivacyButton();
  renderIncomeSummaryPage();
  renderAnnualReviewPage();
  renderIncomeRecords();
  renderDividendCalendarPage();
  renderFundamentalsPage();
  if (renderHoldingsList) renderHoldingsView(summary.holdings, { animate: animateHoldings });
  else syncRenderedHoldingsView(summary.holdings, { animateReflow: false });
}

/* 定稿图的单文字排序键：一次点击换一个字段，三个字段轮完再翻方向 —— 6 态循环，
   「点击轮换三字段、再点切升降」用一个按钮就能走完，不需要长按。 */
export function cycleHoldingSortSelection() {
  const index = HOLDING_SORT_FIELDS.indexOf(state.sortField);
  const next = index < 0 ? 0 : (index + 1) % HOLDING_SORT_FIELDS.length;
  if (index >= 0 && next === 0) state.sortDirection = state.sortDirection === 'desc' ? 'asc' : 'desc';
  closeActiveDividendTooltip(true);
  const opened = refs.stockList.querySelector('.holding-swipe.is-swipe-open');
  if (opened) closeHoldingSwipe(opened);
  state.sortField = HOLDING_SORT_FIELDS[next];
  saveState(); renderSortChips();
  syncRenderedHoldingsView(computeHoldings().holdings, { animateReflow: true });
}

/* ── Swipe helpers (exported for main.js) ── */
export function isHoldingSwipeEnabled() { return false; }
export function getHoldingSwipeOffset(w) { return safeNumber(w.style.getPropertyValue('--holding-swipe-offset').replace('px', ''), 0); }
export function setHoldingSwipeOffset(w, offset) {
  const c = Math.max(0, Math.min(HOLDING_SWIPE_DELETE_WIDTH, offset));
  w.style.setProperty('--holding-swipe-offset', `${c}px`);
  w.style.setProperty('--swipe-fade-opacity', c / HOLDING_SWIPE_DELETE_WIDTH);
}
export function closeHoldingSwipe(w) {
  if (!w) return; w.classList.remove('is-swipe-open'); setHoldingSwipeOffset(w, 0);
  if (mutable.activeHoldingSwipe && mutable.activeHoldingSwipe.wrapper === w) mutable.activeHoldingSwipe = null;
}
export function openHoldingSwipe(w) {
  if (!w) return;
  const opened = refs.stockList.querySelector('.holding-swipe.is-swipe-open');
  if (opened && opened !== w) closeHoldingSwipe(opened);
  w.classList.add('is-swipe-open'); setHoldingSwipeOffset(w, HOLDING_SWIPE_DELETE_WIDTH);
}
