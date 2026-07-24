import { state, refs, mutable, saveState, isDemoMode } from './state.js';
import {
  computeHoldings, getCompanySegments, getBucketSegments, getBucketSummaryItems,
  computeDividendCalendar, computeIncomeSummary,
  computeCashFlowRecords, computeDividendRecords, computeTradeSummary, isCashModelActive, computeCashBalance, getAnnualDividendOverview
} from './compute.js';
import { renderFundamentalsPage, getFundamentalsCompanyCount, getPortfolioReturnSummary } from './fundamentals.js';
import { computeYearAnnals } from './annals.js';
import { getPortfolioDiagnostics } from './diagnostics.js';
import { getUpcomingReportEvents, renderReportCalendarPanel } from './report-calendar.js';
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
    ? '' : ` \u00b7 ${rate > 0 ? '+' : rate < 0 ? '-' : ''}${formatPercent(Math.abs(rate))}`;
  return escapeHtml(amountText + rateText);
}

function renderHomeHero(summary) {
  const pnl = safeNumber(summary.totalDailyPnlCny, 0);
  const hasPnl = summary.holdings.some((h) => safeNumber(h.previousClose, 0) > 0);
  const pnlText = hasPnl && state.showAmounts ? formatDailyPnl(pnl, summary.dailyPnlBaseCny) : '';
  const pnlArrow = pnl > 0 ? '\u25b2' : pnl < 0 ? '\u25bc' : '';
  const pnlClass = pnl > 0 ? 'is-market-up' : pnl < 0 ? 'is-market-down' : 'is-flat';
  const fxText = `USD ${safeNumber(state.rates.USD, 0).toFixed(2)}`;
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

function getHomeEventDateParts(value) {
  const parts = String(value || '').split('-');
  const month = Math.max(1, Math.min(12, Number(parts[1]) || 1));
  return {
    day: parts[2] ? String(Number(parts[2])).padStart(2, '0') : '\u2014',
    month: parts[1] ? `${month}\u6708` : ''
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
  // \u7b2c\u4e8c\u884c\uff1a\u4e0b\u4e00\u573a\u8d22\u62a5\uff08\u5f85\u786e\u8ba4\u7b14\u6570\u5df2\u5728\u80a1\u606f\u65e5\u5386\u5165\u53e3\u6458\u8981\u91cc\uff09
  const nextReport = getUpcomingReportEvents()[0] || null;
  const reportDate = getHomeEventDateParts(nextReport && nextReport.reportDate);
  const reportLine = nextReport
    ? `${reportDate.month}${reportDate.day}\u65e5 ${escapeHtml(nextReport.name || nextReport.symbol)} <strong>${escapeHtml(nextReport.reportType || '')}</strong>`
    : '\u8fd1\u671f\u6682\u65e0\u8d22\u62a5';

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
      <p>${reportLine}</p>
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
/* 06-股息日历 · 按 designs/禅意UI/06-股息日历/定稿图.html 重排
   居中 hero（预计全年＋同比）→ 三段互斥构成线与图例 → 12 月点阵 → 待确认/近期两列表。
   月点阵是月明细的唯一入口；比例一律取自实时计算链，不写死定稿图上的示意值。 */

// 同比行：百分比随涨跌着色，其余为叙述色（全局纪律「红涨绿跌覆盖到百分比」）。
function buildDividendYoyLine(yoy) {
  if (yoy === null || yoy === undefined || !Number.isFinite(Number(yoy))) {
    return escapeHtml(LABELS.dividendNoCompare);
  }
  const up = yoy >= 0;
  return `<strong class="is-${up ? 'up' : 'down'}">${escapeHtml(`${up ? '+' : '-'}${formatPercent(Math.abs(yoy))}`)}</strong> · ${escapeHtml(LABELS.dividendVsLastYear)}`;
}

// 月点阵格子里的金额：无派息写破折号，掩码态收成短点串，免得 6 列被撑破。
function formatMonthCellAmount(value) {
  if (!state.showAmounts) return '••••';
  const amount = safeNumber(value, 0);
  return amount > 0 ? Math.round(amount).toLocaleString('en-US') : '—';
}

function formatDividendRowDate(entry) {
  const value = entry.receivedDate || entry.payDate || entry.exDate || '';
  const parts = String(value).split('-');
  return parts.length >= 3 ? `${Number(parts[1])}月${Number(parts[2])}日` : '';
}

function renderDividendMetricGrid(model) {
  const m = model.metrics;
  /* 三个互斥的桶，相加恒等于「预计全年」：
     已到账（钱已入账）→ 在途（已公告/待核对，等着到账）→ 预估（按往年节奏推算）。 */
  const pipelineCny = Math.max(0, m.committedCny - m.receivedCny);
  const width = (value) => (m.projectedCny > 0 ? Math.max(0, safeNumber(value, 0) / m.projectedCny * 100) : 0).toFixed(2);
  const receivedPct = Math.round(m.projectedCny > 0 ? Math.min(1, Math.max(0, m.receivedCny / m.projectedCny)) * 100 : 0);
  const legendRow = (tone, name, note, value) => `<div class="divi-legend-row">
      <b class="is-${tone}" aria-hidden="true"></b><span>${escapeHtml(name)}</span><small>${escapeHtml(note)}</small><strong>${escapeHtml(formatDisplayMoney(value, 'CNY'))}</strong>
    </div>`;
  refs.dividendMetricGrid.innerHTML = `
    <div class="divi-hero">
      <span class="divi-hero-label">预计全年</span>
      <strong class="divi-hero-value">${escapeHtml(formatDisplayMoney(m.projectedCny, 'CNY'))}</strong>
      <p class="divi-yoy">${buildDividendYoyLine(m.projectedYoy)}</p>
    </div>
    <div class="divi-stack" role="img" aria-label="构成：已到账 ${receivedPct}%，其余在途与预估">
      <i class="is-received" style="width:${width(m.receivedCny)}%"></i><i class="is-pipeline" style="width:${width(pipelineCny)}%"></i><i class="is-forecast" style="width:${width(m.forecastCny)}%"></i>
    </div>
    <div class="divi-legend">
      ${legendRow('received', '已到账', '钱已入账', m.receivedCny)}
      ${legendRow('pipeline', '在途', '已公告 · 等待到账', pipelineCny)}
      ${legendRow('forecast', '预估', '按往年节奏推算', m.forecastCny)}
    </div>
    ${model.excludedHistoricalEstimateCount > 0 ? `<p class="divi-legend-note">另有 ${model.excludedHistoricalEstimateCount} 笔早年股息缺少当年持仓记录，仅存档、不计入统计</p>` : ''}`;
}

/* 近期列表的状态词与色：金=已到账，hint=在途/已公告/预估，涨红只留给待确认（置顶那段）。 */
function getDividendRowStatus(entry) {
  if (entry.isForecast) return { text: '预估', tone: 'transit' };
  if (entry.isAnnounced || entry.status === 'announced') return { text: '已公告', tone: 'transit' };
  if (entry.status === 'due') return { text: '待确认', tone: 'due' };
  if (entry.status === 'received') return { text: '已到账', tone: 'paid' };
  return { text: '在途', tone: 'transit' };
}

function buildDividendRow(entry) {
  const status = getDividendRowStatus(entry);
  return `<div class="divi-row">
    <span>${escapeHtml(formatDividendRowDate(entry))} <strong>${escapeHtml(entry.name || entry.symbol)}</strong></span>
    <span><strong>${escapeHtml(formatDisplayMoney(entry.netCny, 'CNY'))}</strong> <span class="divi-st is-${status.tone}">${escapeHtml(status.text)}</span></span>
  </div>`;
}

const DIVIDEND_LIST_LIMIT = 6;
const DIVIDEND_DUE_LIMIT = 3;

function renderDividendMonths(model) {
  const cells = model.months.map((item) => {
    const hasPay = safeNumber(item.totalCny, 0) > 0;
    const classes = ['divi-ym'];
    if (item.phase === 'past') classes.push('is-past');
    if (item.phase === 'current') classes.push('is-current');
    if (hasPay) classes.push('has-pay');
    return `<button class="${classes.join(' ')}" type="button" data-dividend-month="${item.month}" aria-label="查看 ${item.month} 月逐笔股息">
      <span>${String(item.month).padStart(2, '0')}</span><i>${escapeHtml(formatMonthCellAmount(item.totalCny))}</i><b aria-hidden="true"></b>
    </button>`;
  }).join('');

  /* 两段列表合起来最多 DIVIDEND_LIST_LIMIT 行——本页要一屏放得下，
     而待确认在真实账本里能堆到二十几笔（把整页顶到 1610px 滚动过）。
     节标上的「N 笔 · 总额」是全量口径，截断的只是行；要逐笔处理走月点阵进月明细，
     那里的列表自己滚。 */
  const due = model.allDetails
    .filter((entry) => entry.status === 'due')
    .sort((a, b) => `${b.payDate}|${b.symbol}`.localeCompare(`${a.payDate}|${a.symbol}`));
  const dueCny = due.reduce((sum, entry) => sum + safeNumber(entry.netCny, 0), 0);
  const dueShown = due.slice(0, DIVIDEND_DUE_LIMIT);
  const dueSection = due.length ? `
    <div class="divi-sec-head"><span class="divi-sec-label">待确认 · ${due.length} 笔</span><span class="divi-sec-aside">${escapeHtml(formatDisplayMoney(dueCny, 'CNY'))}</span></div>
    <div class="divi-rows">${dueShown.map(buildDividendRow).join('')}</div>` : '';
  const recentLimit = Math.max(2, DIVIDEND_LIST_LIMIT - dueShown.length);

  /* 「近期」＝已经发生或已公告的事件，按日期倒序；节奏预估不进这段（它已经由
     月点阵和构成线里的「预估」表达）。账本刚起步、一条真实事件都还没有时才退化为
     列出最近的几笔预估，并在节标右侧标明口径，避免整块留白。 */
  const settled = model.allDetails
    .filter((entry) => !entry.isForecast && entry.status !== 'due')
    .sort((a, b) => `${b.payDate}|${b.symbol}`.localeCompare(`${a.payDate}|${a.symbol}`))
    .slice(0, recentLimit);
  const fallback = settled.length ? [] : model.allDetails
    .filter((entry) => entry.isForecast && entry.payDate >= model.today)
    .sort((a, b) => `${a.payDate}|${a.symbol}`.localeCompare(`${b.payDate}|${b.symbol}`))
    .slice(0, recentLimit);
  const recent = settled.length ? settled : fallback;
  const recentSection = recent.length ? `
    <div class="divi-sec-head${due.length ? ' is-later' : ''}"><span class="divi-sec-label">近期</span><span class="divi-sec-aside">${settled.length ? '' : '按往年节奏推算'}</span></div>
    <div class="divi-rows">${recent.map(buildDividendRow).join('')}</div>` : '';

  refs.dividendMonthGrid.innerHTML = `
    <div class="divi-year">${cells}</div>
    <p class="divi-grid-hint">点按月份查看当月逐笔并确认到账</p>
    <div class="divi-list">${dueSection}${recentSection}${due.length || recent.length ? '' : `<p class="divi-list-empty">${escapeHtml(LABELS.dividendEmptyTitle)}</p>`}</div>`;
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

/* 07-月明细抽屉 · 按 designs/禅意UI/07-月明细/定稿图.html
   抬头（月份＋当月合计）→ 小结行 → 收款进度金线 → 逐笔行（五态状态词）。
   可点行（非预估、非已公告）进 08-股息到账。 */
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
    /* upcomingCny 已含 dueCny，这里必须减掉，否则同一笔钱在「待核对」和「在途」里各出现一次。
       三项互不重叠且相加等于当月合计。 */
    const restUpcomingCny = Math.max(0, item.upcomingCny - item.dueCny);
    if (restUpcomingCny > 0) summaryParts.push(`在途 ${formatDisplayMoney(restUpcomingCny, 'CNY')}`);
  }
  const statusOf = (entry) => {
    if (entry.isForecast) return { text: '预估', tone: 'forecast' };
    if (entry.isAnnounced || entry.status === 'announced') return { text: '已公告', tone: 'announced' };
    if (entry.status === 'due') return { text: '待核对', tone: 'due' };
    if (entry.status === 'received') return { text: LABELS.dividendReceivedStatus, tone: 'paid' };
    return { text: '在途', tone: 'transit' };
  };
  const body = entries.length
    ? entries.map((entry) => {
        const status = statusOf(entry);
        const clickable = !entry.isForecast && !(entry.isAnnounced || entry.status === 'announced') && entry.sourceId;
        const tag = clickable ? 'button' : 'div';
        const attrs = clickable
          ? ` type="button" data-modal-action="edit-dividend-ledger" data-source-id="${escapeHtml(entry.sourceId)}" aria-label="编辑 ${escapeHtml(entry.name)} 股息"`
          : '';
        return `<${tag} class="zen-md-row${clickable ? ' is-clickable' : ''}"${attrs}>
          <span class="zen-md-co"><strong>${escapeHtml(entry.name)}<small>${escapeHtml(entry.symbol)}</small></strong><span>${escapeHtml(getMonthDetailDateShort(entry))}</span></span>
          <span class="zen-md-side"><strong>${escapeHtml(formatDisplayMoney(entry.netCny, 'CNY'))}</strong><span class="is-${status.tone}">${escapeHtml(status.text)}</span></span>
        </${tag}>`;
      }).join('')
    : `<p class="zen-md-empty">${escapeHtml(LABELS.dividendEmptyTitle)}</p>`;
  const receivedRatio = item && item.totalCny > 0
    ? Math.min(1, Math.max(0, item.receivedCny / item.totalCny)) : 0;
  return {
    title: `${month}${LABELS.dividendMonthSuffix}`,
    phase: item ? item.phase : 'future',
    total: item ? formatDisplayMoney(item.totalCny, 'CNY') : formatDisplayMoney(0, 'CNY'),
    summary: summaryParts.join(' · '),
    receivedRatio,
    receivedPercentText: `${Math.round(receivedRatio * 100)}%`,
    hasConfirmable: entries.some((entry) => !entry.isForecast && !(entry.isAnnounced || entry.status === 'announced') && entry.sourceId),
    body
  };
}

export function renderDividendCalendarPage() {
  const model = computeDividendCalendar();
  if (refs.dividendCalendarYear) refs.dividendCalendarYear.textContent = '';
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


/* ── 09-收益明细 · 按 designs/禅意UI/09-收益明细/定稿图.html ── */
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

// 定稿图上的收益率一律一位小数（+5.7% / -8.1%），本页统一按此形
function formatIncomeRate(value) {
  if (isIncomeValueMissing(value)) return '待回填';
  if (!state.showAmounts) return MASK_AMOUNT;
  const numeric = safeNumber(value, 0) * 100;
  const sign = numeric > 0 ? '+' : numeric < 0 ? '-' : '';
  return `${sign}${Math.abs(numeric).toFixed(1)}%`;
}

// 趋势线上的点值与累计年化行：一位小数、带符号，与定稿图的 +4.2 / -8.1 同形
function formatTrendSigned(value) {
  if (isIncomeValueMissing(value)) return '—';
  if (!state.showAmounts) return MASK_AMOUNT;
  const numeric = Number(value) * 100;
  return `${numeric > 0 ? '+' : numeric < 0 ? '-' : ''}${Math.abs(numeric).toFixed(1)}`;
}

function getIncomeSecHead(label, aside = '') {
  return `<div class="inc-sec-head"><span class="inc-sec-label">${escapeHtml(label)}</span><span class="inc-sec-aside">${aside}</span></div>`;
}

/* hero 只留一个结论（当年资金收益）+ 一个比较值（收益率），
   口径退成两行 hint；现金入口已移到「资金与交易」，本页不再有。 */
function renderIncomeOverview(model) {
  const row = model.current;
  if (!row || !row.capitalReturnAvailable) {
    refs.incomeOverviewGrid.innerHTML = `<section class="inc-hero">
      <span class="inc-hero-label">${model.currentYear} · 资金收益</span>
      <strong class="inc-hero-value">待回填</strong>
      <p class="inc-hero-meta">回填 ${model.currentYear - 1} 年末净值后，这里显示今年至今的资金收益</p>
    </section>`;
    return;
  }
  const tone = getReturnTone(row.capitalReturnCny);
  // 「已含股息」只在现金进了净值链时才成立，否则股息不在净值内，如实少说一句
  const scopeText = row.capitalReturnIncludesDividend ? '净值链口径 · 已含股息与汇率' : '净值链口径 · 已含汇率';
  refs.incomeOverviewGrid.innerHTML = `<section class="inc-hero">
      <span class="inc-hero-label">${model.currentYear} · 资金收益</span>
      <strong class="inc-hero-value ${tone}">${escapeHtml(formatIncomeSignedMoney(row.capitalReturnCny))}</strong>
      <p class="inc-hero-meta"><strong class="${getReturnTone(row.capitalReturnRate)}">${escapeHtml(formatIncomeRate(row.capitalReturnRate))}</strong> · ${escapeHtml(scopeText)}</p>
    </section>
    <p class="inc-ctx">年初 ${escapeHtml(formatIncomeMoney(row.yearStartNetCny))} → 当前 ${escapeHtml(formatIncomeMoney(row.yearEndNetCny))} · 净注入 <b>${escapeHtml(formatIncomeSignedMoney(row.netInflowCny))}</b><br>净值与注入明细见年度回顾 · 现金余额移至资金与交易</p>`;
}

function getTrendValue(row, key) {
  const value = row && row[key];
  return isIncomeValueMissing(value) ? null : safeNumber(value, 0);
}

function roundSvgNumber(value) {
  return Math.round(value * 100) / 100;
}

/* 双线图几何（定稿图 viewBox 338×118）：
   x 自 24 起、末点 314；点带 y 落在 18–96，负值点的标值改挂到点下方，
   零轴按数据范围插值——全正年份时零轴自然沉到 96。 */
const TREND_GEO = { width: 338, xStart: 24, xEnd: 314, yTop: 18, yBottom: 96 };

function getTrendX(index, total) {
  if (total <= 1) return TREND_GEO.width / 2;
  return TREND_GEO.xStart + ((TREND_GEO.xEnd - TREND_GEO.xStart) * index) / (total - 1);
}

function getTrendY(value, minValue, maxValue) {
  const range = maxValue === minValue ? 1 : maxValue - minValue;
  return TREND_GEO.yTop + ((maxValue - value) / range) * (TREND_GEO.yBottom - TREND_GEO.yTop);
}

function getTrendPoints(rows, key, minValue, maxValue) {
  return rows
    .map((row, index) => {
      const value = getTrendValue(row, key);
      if (value === null) return null;
      return {
        x: roundSvgNumber(getTrendX(index, rows.length)),
        y: roundSvgNumber(getTrendY(value, minValue, maxValue)),
        value,
        isLast: index === rows.length - 1
      };
    })
    .filter(Boolean);
}

// 历年趋势：墨线＝资金收益率（逐点标带符号数值、负年下探零轴），金线＝股息收益率
function renderIncomeTrend(model) {
  const rows = model.trendRows;
  const keys = ['capitalReturnRate', 'dividendYieldRate'];
  const values = keys.flatMap((key) => rows.map((row) => getTrendValue(row, key)).filter((value) => value !== null));
  const pointCounts = keys.map((key) => rows.filter((row) => getTrendValue(row, key) !== null).length);
  if (!values.length || !pointCounts.some((count) => count >= 2)) {
    refs.incomeTrend.innerHTML = `${getIncomeSecHead('历年趋势')}
      <p class="inc-trend-empty">至少两个年度有收益率后，才会绘制可比较的趋势</p>`;
    return;
  }
  const minValue = Math.min(0, ...values);
  const maxValue = Math.max(0, ...values);
  const zeroY = roundSvgNumber(getTrendY(0, minValue, maxValue));
  const capPoints = getTrendPoints(rows, 'capitalReturnRate', minValue, maxValue);
  const divPoints = getTrendPoints(rows, 'dividendYieldRate', minValue, maxValue);
  const line = (points, className) => (points.length < 2
    ? ''
    : `<polyline class="${className}" points="${points.map((point) => `${point.x},${point.y}`).join(' ')}"></polyline>`);
  const dots = (points, className, r) => points
    .map((point) => `<circle class="${className}" cx="${point.x}" cy="${point.y}" r="${r}"></circle>`).join('');
  // 负年的标值挂到点下方，让「下探零轴」一眼读得出
  const labels = capPoints.map((point) => {
    const below = point.value < 0;
    const y = roundSvgNumber(below ? point.y + 13 : point.y - 8.5);
    const cls = `${point.value < 0 ? 'is-loss' : 'is-gain'}${point.isLast ? ' is-latest' : ''}`;
    return `<text class="${cls}" x="${point.x}" y="${y}" text-anchor="middle">${escapeHtml(formatTrendSigned(point.value))}</text>`;
  }).join('');
  const yearLabels = rows.map((row, index) => {
    const x = roundSvgNumber(getTrendX(index, rows.length));
    const isCurrent = row.year === model.currentYear;
    return `<text class="inc-yr${isCurrent ? ' is-current' : ''}" x="${x}" y="10" text-anchor="middle">${String(row.year).slice(2)}${isCurrent ? '至今' : ''}</text>`;
  }).join('');

  // 累计年化 = 各年资金收益率复利后折年（几何均值）；最深一年取区间最低
  const capRates = rows.map((row) => ({ year: row.year, rate: getTrendValue(row, 'capitalReturnRate') }))
    .filter((entry) => entry.rate !== null);
  let cagrLine = '';
  if (capRates.length) {
    const worst = Math.min(...capRates.map((entry) => entry.rate));
    const product = capRates.reduce((acc, entry) => acc * (1 + entry.rate), 1);
    const cumulative = product > 0 ? Math.pow(product, 1 / capRates.length) - 1 : null;
    cagrLine = `<p class="inc-trend-cagr">自 ${capRates[0].year} 累计年化 <strong class="${getReturnTone(cumulative)}">${escapeHtml(formatTrendSigned(cumulative))}%</strong> · 最深一年 <strong class="${getReturnTone(worst)}">${escapeHtml(formatTrendSigned(worst))}%</strong></p>`;
  }

  refs.incomeTrend.innerHTML = `${getIncomeSecHead('历年趋势', '收益率')}
    <div class="inc-trend-chart">
      <svg class="inc-trend-svg" viewBox="0 0 338 118" role="img" aria-label="历年资金收益率与股息收益率">
        <line class="inc-zero" x1="14" x2="324" y1="${zeroY}" y2="${zeroY}"></line>
        ${line(divPoints, 'inc-div-line')}
        ${line(capPoints, 'inc-cap-line')}
        ${dots(divPoints, 'inc-div-dot', 2)}
        ${dots(capPoints, 'inc-cap-dot', 2.6)}
        ${labels}
      </svg>
      <svg class="inc-trend-years" viewBox="0 0 338 14" aria-hidden="true">${yearLabels}</svg>
    </div>
    <p class="inc-trend-legend"><i></i>资金收益率<b></b>股息收益率</p>
    ${cagrLine}`;
}

/* 年份行脚注：手工基准区间与逐笔记账起点都从实时数据里取，不写死年份 */
function getIncomeYearFoot(model) {
  const manualYears = model.rows.filter((row) => row.hasManualBackfill).map((row) => row.year);
  const ledgerYears = model.trendRows
    .filter((row) => row.fieldSources && row.fieldSources.dividendCny === 'ledger')
    .map((row) => row.year);
  const parts = [];
  if (manualYears.length) {
    const min = Math.min(...manualYears);
    const max = Math.max(...manualYears);
    parts.push(`${min === max ? min : `${min}–${max}`} 为年度手工基准`);
  }
  if (ledgerYears.length) parts.push(`逐笔记账自 ${Math.min(...ledgerYears)} 起`);
  const first = parts.length ? `${parts.join(' · ')}<br>` : '';
  return `<p class="inc-year-foot">${first}点年份行查看年度回顾（含当年持仓 · 归因 · 交易）</p>`;
}

function renderIncomeYearList(model) {
  if (!model.rows.length) {
    refs.incomeYearList.innerHTML = `${getIncomeSecHead('年度明细')}
      <p class="inc-trend-empty">回填历史年度后会显示年度列表</p>`;
    return;
  }
  const rows = model.rows.map((row) => {
    const isCurrent = row.year === model.currentYear;
    const tag = isCurrent ? '进行中' : (row.hasManualBackfill ? '手工基准' : '自动统计');
    const sub = isCurrent
      ? `股息 ${formatIncomeMoney(row.dividendCny)} · 净注入 ${formatIncomeSignedMoney(row.netInflowCny)}`
      : `股息 ${formatIncomeMoney(row.dividendCny)} · 年末 ${formatIncomeMoney(row.yearEndNetCny)}`;
    const act = isCurrent
      ? '<span class="inc-year-acts"></span>'
      : `<button class="inc-year-acts" type="button" data-income-manual-year="${row.year}" aria-label="回填 ${row.year} 年度数据">回填</button>`;
    return `<div class="inc-year" role="button" tabindex="0" data-annual-year="${row.year}" aria-label="查看 ${row.year} 年度回顾">
      <span class="inc-year-main">
        <span class="inc-year-yy">${row.year}<small>${tag}</small></span>
        <span class="inc-year-yv ${getReturnTone(row.capitalReturnCny)}">${escapeHtml(formatIncomeSignedMoney(row.capitalReturnCny))}<em>${escapeHtml(formatIncomeRate(row.capitalReturnRate))}</em></span>
      </span>
      <span class="inc-year-sub">
        <span>${escapeHtml(sub)}</span>${act}
      </span>
    </div>`;
  }).join('');
  refs.incomeYearList.innerHTML = `${getIncomeSecHead('年度明细')}
    <div class="inc-year-rows">${rows}</div>
    ${getIncomeYearFoot(model)}`;
}


function formatRecordQuantity(value) {
  return safeNumber(value, 0).toLocaleString('en-US', { maximumFractionDigits: 6 });
}

// 盈亏配色按 A 股习惯：赚钱=红，亏钱=绿。用于收益/盈亏类数字。
function getReturnTone(value) {
  const numeric = safeNumber(value, 0);
  if (numeric > 0) return 'is-gain';
  if (numeric < 0) return 'is-loss';
  return 'is-flat';
}

/* ── 13-资金与交易 · 按 designs/禅意UI/13-资金与交易/定稿图.html ──
   居中 hero（本年净注入）→ 现金余额次级焦点（可点校准）→ 四类计数一行
   → 三段流水。金额一律墨色带符号，只有买/卖两个类型词着色。 */
const RECORD_FOLD_LIMIT = 3;

// 07/18 这样的短日期：三段流水都限在当年内，年份没有信息量
function getRecordDayLabel(date) {
  const label = String(date || '');
  return label.length >= 10 ? `${label.slice(5, 7)}/${label.slice(8, 10)}` : label;
}

function getRecordDetailMarkup(text) {
  return text ? `<span class="rec-row-detail">${escapeHtml(text)}</span>` : '';
}

function renderTradeFlowRow(entry) {
  const isSell = entry.side === 'sell';
  /* 股数×成交价能把上面已掩码的金额反推出来，所以掩码开启时这一行也要一起掩上
     （与 03-持仓详情里「当前持股」掩码同一套口径）。 */
  const detail = state.showAmounts
    ? `${formatRecordQuantity(entry.shares)} 股 @ ${safeNumber(entry.price, 0)} ${entry.currency || ''}`.trim()
    : `${MASK_PRICE} 股 @ ${MASK_PRICE} ${entry.currency || ''}`.trim();
  return `<button class="rec-row" type="button" data-trade-id="${escapeHtml(entry.id)}">
      <span class="rec-row-main">${escapeHtml(getRecordDayLabel(entry.date))} <em class="${isSell ? 'is-sell' : 'is-buy'}">${isSell ? '卖出' : '买入'}</em> <strong>${escapeHtml(entry.name || entry.symbol)}</strong>${getRecordDetailMarkup(detail)}</span>
      <span class="rec-row-amt">${escapeHtml(formatIncomeSignedMoney(entry.cashImpactCny))}</span>
    </button>`;
}

function renderCashFlowRow(entry) {
  return `<button class="rec-row" type="button" data-cash-flow-id="${escapeHtml(entry.id)}">
      <span class="rec-row-main">${escapeHtml(getRecordDayLabel(entry.date))} <strong>${entry.isWithdrawal ? '出金' : '入金'}</strong>${getRecordDetailMarkup(entry.note)}</span>
      <span class="rec-row-amt">${escapeHtml(formatIncomeSignedMoney(entry.signedCny))}</span>
    </button>`;
}

function renderDividendFlowRow(entry) {
  return `<button class="rec-row" type="button" data-dividend-source-id="${escapeHtml(entry.sourceId)}">
      <span class="rec-row-main">${escapeHtml(getRecordDayLabel(entry.date))} 股息 · <strong>${escapeHtml(entry.name || entry.symbol)}</strong>${getRecordDetailMarkup(entry.note)}</span>
      <span class="rec-row-amt">${escapeHtml(formatIncomeSignedMoney(entry.amountCny))}</span>
    </button>`;
}

/* 一段流水：节标 + 右笔数 + 默认 3 行 + 展开键。
   折叠只是渲染层状态（mutable），不写进快照，也不参与云同步。 */
function renderRecordFlow(key, label, aside, records, emptyText, rowMarkup) {
  const expanded = mutable.recordsExpanded[key] === true;
  const shown = expanded ? records : records.slice(0, RECORD_FOLD_LIMIT);
  const body = records.length
    ? `<div class="rec-rows">${shown.map(rowMarkup).join('')}</div>`
    : `<p class="rec-empty">${escapeHtml(emptyText)}</p>`;
  const more = records.length > RECORD_FOLD_LIMIT
    ? `<button class="rec-more" type="button" data-records-expand="${key}">${expanded ? '收 起' : `展开全部 ${records.length} 笔`}</button>`
    : '';
  return `<section class="rec-flow rec-flow--${key}">
      <div class="rec-sec-head"><span class="rec-sec-label">${escapeHtml(label)}</span><span class="rec-sec-aside">${aside}</span></div>
      ${body}${more}
    </section>`;
}

// 现金余额：从收益明细迁到本页作次级焦点，点击开 openingCash 校准
function renderRecordsCash() {
  const active = isCashModelActive();
  const asOf = String(state.currentCashAsOfDate || '');
  const sub = active && asOf.length >= 10
    ? `基准日 ${escapeHtml(`${asOf.slice(5, 7)}-${asOf.slice(8, 10)}`)} · <b>点击校准</b>`
    : '<b>点击校准</b>';
  return `<button class="rec-cash" type="button" data-records-action="calibrate-cash">
      <span class="rec-cash-label">现金余额</span>
      <strong class="rec-cash-value">${escapeHtml(active ? formatDisplayMoney(computeCashBalance(), 'CNY') : '未设置')}</strong>
      <span class="rec-cash-sub">${sub}</span>
    </button>`;
}

export function renderIncomeRecords() {
  if (!refs.incomeRecordsList) return;
  const year = new Date().getFullYear();
  const cash = computeCashFlowRecords(year);
  const dividends = computeDividendRecords(year);
  const trades = computeTradeSummary(year);
  const buyCount = trades.records.filter((entry) => entry.side !== 'sell').length;
  const sellCount = trades.records.length - buyCount;
  refs.incomeRecordsList.innerHTML = `<section class="rec-hero">
      <span class="rec-hero-label">${year} · 净注入</span>
      <strong class="rec-hero-value">${escapeHtml(formatIncomeSignedMoney(cash.netInflowCny))}</strong>
      <p class="rec-hero-meta">入金 ${escapeHtml(formatDisplayMoney(cash.depositCny, 'CNY'))} · 出金 ${escapeHtml(formatDisplayMoney(cash.withdrawalCny, 'CNY'))} · ${cash.count} 笔</p>
    </section>
    ${renderRecordsCash()}
    <p class="rec-counts"><span>买入 <strong>${buyCount}</strong></span><span>卖出 <strong>${sellCount}</strong></span><span>出入金 <strong>${cash.count}</strong></span><span>股息 <strong>${dividends.count}</strong></span></p>
    ${renderRecordFlow('trade', '买卖流水', `${trades.count} 笔`, trades.records, '本年还没有买卖记录', renderTradeFlowRow)}
    ${renderRecordFlow('cash', '出入金流水', `${cash.count} 笔`, cash.records, '本年还没有出入金', renderCashFlowRow)}
    ${renderRecordFlow('dividend', '股息入账', `${dividends.count} 笔 · ${escapeHtml(formatDisplayMoney(dividends.totalCny, 'CNY'))}`, dividends.records, '本年还没有确认到账的股息', renderDividendFlowRow)}`;
}

export function renderIncomeSummaryPage() {
  const model = computeIncomeSummary();
  renderIncomeOverview(model);
  renderIncomeTrend(model);
  renderIncomeYearList(model);
}

/* ── 10-年度回顾 · 按 designs/禅意UI/10-年度回顾/定稿图.html ──
   原「持仓快照」「年鉴」两个弹窗已并入本页，XIRR 口径已删除。 */
const ANNUAL_DONUT_R = 52;
const ANNUAL_DONUT_C = 2 * Math.PI * ANNUAL_DONUT_R;
const ANNUAL_MONTH_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

function formatAnnualRate(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const numeric = Number(value);
  return `${numeric > 0 ? '+' : numeric < 0 ? '−' : ''}${Math.abs(numeric * 100).toFixed(1)}%`;
}

function formatAnnualSignedMoney(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  if (!state.showAmounts) return MASK_AMOUNT;
  const numeric = Number(value);
  return `${numeric > 0 ? '+' : numeric < 0 ? '−' : ''}${formatMoney(Math.abs(numeric), 'CNY')}`;
}

function formatAnnualShares(value) {
  return safeNumber(value, 0).toLocaleString('en-US', { maximumFractionDigits: 6 });
}

function getAnnualSecHead(label, aside = '') {
  return `<div class="ann-sec-head"><span class="ann-sec-label">${escapeHtml(label)}</span><span class="ann-sec-aside">${aside}</span></div>`;
}

/* pp 拆分：四项金额相加恒等于资金收益（＝本年收益率的分子）。
   现金未进净值链时资金收益本就不含股息，派出去的股息压低了净值，
   残差项（估值变动）自然把它净掉——四项仍然相加等于 hero，口径自洽。 */
function getAnnualAttributionItems(annals) {
  const attribution = annals.attribution || { available: false };
  const startNet = safeNumber(annals.yearStartNetCny, 0);
  if (!attribution.available || startNet <= 0) return null;
  const cap = safeNumber(annals.row.capitalReturnCny, 0);
  const dividendCny = safeNumber(attribution.dividendCny, 0);
  const fxCny = safeNumber(attribution.fxCny, 0);
  const epsCny = safeNumber(attribution.epsCny, 0);
  const valuationCny = cap - dividendCny - fxCny - epsCny;
  return [
    { key: 'divi', label: '股息收入', amount: dividendCny },
    { key: 'eps', label: 'EPS 增长', amount: epsCny },
    { key: 'val', label: '估值变动', amount: valuationCny },
    { key: 'fx', label: '汇率变动', amount: fxCny }
  ].map((item) => ({ ...item, rate: item.amount / startNet }));
}

function getAnnualDonutMarkup(holdings) {
  const top = holdings.items.slice(0, 5);
  const restPct = holdings.items.slice(5).reduce((sum, item) => sum + item.pct, 0);
  const segs = top.map((item, index) => ({ pct: item.pct, tone: index + 1 }));
  if (restPct > 0.0001) segs.push({ pct: restPct, tone: 6 });
  let offset = 0;
  const arcs = segs.map((seg) => {
    const length = seg.pct * ANNUAL_DONUT_C;
    const arc = `<circle class="ann-arc is-t${seg.tone}" cx="64" cy="64" r="${ANNUAL_DONUT_R}" fill="none" stroke-width="11" stroke-dasharray="${length.toFixed(1)} ${(ANNUAL_DONUT_C - length).toFixed(1)}" stroke-dashoffset="${(-offset).toFixed(1)}"></circle>`;
    offset += length;
    return arc;
  }).join('');
  // 前五各占一阶色；第六阶是那段「其余」弧，展开后尾部各项都归它
  const holdingRow = (item, tone) => `<div class="ann-hold-row">
      <b class="is-t${tone}"></b>
      <span class="ann-hold-co">${escapeHtml(item.name)}</span>
      <span class="ann-hold-pc">${(item.pct * 100).toFixed(1)}%</span>
      <span class="ann-hold-chg">${escapeHtml(item.change || '')}</span>
    </div>`;
  const legend = top.map((item, index) => holdingRow(item, index + 1)).join('');
  const rest = holdings.items.slice(5);
  let restRow = '';
  if (restPct > 0.0001 && rest.length) {
    restRow = mutable.annualHoldingsExpanded
      ? rest.map((item) => holdingRow(item, 6)).join('')
        + `<button class="ann-hold-row is-toggle" type="button" data-annual-holdings-toggle aria-expanded="true">
            <b class="is-t6"></b><span class="ann-hold-co">收起其余 ${rest.length} 项</span>
            <span class="ann-hold-pc">${(restPct * 100).toFixed(1)}%</span><span class="ann-hold-chg"></span>
          </button>`
      : `<button class="ann-hold-row is-toggle" type="button" data-annual-holdings-toggle aria-expanded="false">
          <b class="is-t6"></b><span class="ann-hold-co">其余 ${rest.length} 项</span>
          <span class="ann-hold-pc">${(restPct * 100).toFixed(1)}%</span><span class="ann-hold-chg"></span>
        </button>`;
  }
  return `<div class="ann-hold${mutable.annualHoldingsExpanded ? ' is-expanded' : ''}">
      <div class="ann-donut">
        <svg viewBox="0 0 128 128" width="128" height="128" role="img" aria-label="年度持仓构成">
          <circle class="ann-arc-base" cx="64" cy="64" r="${ANNUAL_DONUT_R}" fill="none" stroke-width="11"></circle>
          ${arcs}
        </svg>
        <div class="ann-donut-center"><small>${holdings.year}</small><strong>${holdings.count} 项</strong></div>
      </div>
      <div class="ann-hold-legend">${legend}${restRow}</div>
    </div>`;
}

function getAnnualHoldingsNote(holdings) {
  const lines = [];
  const head = [];
  if (holdings.previousYear) head.push(`增减仓对比 ${holdings.previousYear} 年`);
  if (holdings.removed.length) {
    head.push(`已清仓：${holdings.removed.map((item) => `${item.name} ${formatAnnualShares(item.shares)} 股`).join(' · ')}`);
  }
  if (head.length) lines.push(escapeHtml(head.join(' · ')));
  lines.push('当年快照随行情更新，跨年自动冻结');
  return `<p class="ann-hold-note">${lines.join('<br>')}</p>`;
}

export function renderAnnualReviewPage() {
  if (!refs.annualReviewContent) return;
  const summary = computeIncomeSummary();
  const years = summary.rows.map((row) => row.year);
  if (!years.length) {
    refs.annualReviewContent.innerHTML = '<p class="ann-empty">完成年度净值或回填后，这里会生成年度回顾</p>';
    return;
  }
  if (!years.includes(state.activeAnnualYear)) state.activeAnnualYear = years[0];
  const annals = computeYearAnnals(state.activeAnnualYear);
  if (!annals) {
    refs.annualReviewContent.innerHTML = '<p class="ann-empty">该年暂无数据</p>';
    return;
  }
  const row = annals.row;
  const attrItems = getAnnualAttributionItems(annals);
  const attrTotalAbs = attrItems ? (attrItems.reduce((sum, item) => sum + Math.abs(item.amount), 0) || 1) : 1;
  const attrBar = attrItems
    ? attrItems.map((item) => `<i class="is-${item.key}" style="width:${(Math.abs(item.amount) / attrTotalAbs * 100).toFixed(2)}%"></i>`).join('')
    : '';
  const attrRows = attrItems
    ? attrItems.map((item) => `<div class="ann-attr-row">
        <b class="is-${item.key}"></b>
        <span>${escapeHtml(item.label)}</span>
        <small class="${getReturnTone(item.rate)}">${escapeHtml(formatAnnualRate(item.rate))}</small>
        <strong class="${getReturnTone(item.amount)}">${escapeHtml(formatAnnualSignedMoney(item.amount))}</strong>
      </div>`).join('')
    : '';
  const coverage = safeNumber(annals.attribution && annals.attribution.epsSplitCoverage, 0);
  const coverageNote = attrItems && coverage < 0.5
    ? `<p class="ann-attr-note">EPS 拆分覆盖年初市值 ${Math.round(coverage * 100)}%，未覆盖部分并入估值变动</p>`
    : '';
  const maxDividend = Math.max(1, ...annals.dividendMonths.map((value) => safeNumber(value, 0)));
  const currentMonth = annals.isCurrentYear ? new Date().getMonth() : -1;
  const buyCount = annals.trades.filter((trade) => trade.side === 'buy').length;
  const sellCount = annals.trades.filter((trade) => trade.side === 'sell').length;
  const tradeRows = annals.trades.length
    ? annals.trades.slice().reverse().map((trade) => `<div class="ann-trade-row">
        <span>${escapeHtml(trade.date.slice(5).replace('-', '/'))} <em class="${trade.side === 'sell' ? 'is-sell' : 'is-buy'}">${trade.side === 'sell' ? '卖出' : '买入'}</em> <strong>${escapeHtml(trade.name)}</strong></span>
        <span>${escapeHtml(formatDisplayMoney(trade.valueCny, 'CNY'))}</span>
      </div>`).join('')
    : '<p class="ann-empty-line">该年暂无交易记录</p>';
  const scopeText = annals.isCurrentYear
    ? `截至 ${annals.today.slice(0, 7).replace('-', '/')}`
    : '完整年度';

  refs.annualReviewContent.innerHTML = `
    <nav class="ann-years" aria-label="选择年度">${years.map((year) => `<button type="button" data-annual-select="${year}" class="${year === state.activeAnnualYear ? 'is-active' : ''}" aria-pressed="${year === state.activeAnnualYear}">${year}<i aria-hidden="true"></i></button>`).join('')}</nav>
    <section class="ann-hero">
      <span class="ann-hero-label">本年收益率</span>
      <strong class="ann-hero-value ${getReturnTone(annals.returnRate)}">${escapeHtml(formatAnnualRate(annals.returnRate))}</strong>
      <p class="ann-hero-meta">${escapeHtml(scopeText)} · 年初 ${escapeHtml(formatIncomeMoney(row.yearStartNetCny))} → ${annals.isCurrentYear ? '当前' : '年末'} ${escapeHtml(formatIncomeMoney(row.yearEndNetCny))}</p>
    </section>
    <div class="ann-metrics">
      <span>股息收入<strong>${escapeHtml(formatIncomeMoney(row.dividendCny))}</strong></span>
      <span>资金收益<strong class="${getReturnTone(row.capitalReturnCny)}">${escapeHtml(formatAnnualSignedMoney(row.capitalReturnCny))}</strong></span>
      <span>净注入<strong>${escapeHtml(formatAnnualSignedMoney(row.netInflowCny))}</strong></span>
      <span>当年交易<strong>${annals.trades.length} 笔</strong></span>
    </div>
    <section class="ann-block">
      ${getAnnualSecHead('收益归因', attrItems ? `合计 ${escapeHtml(formatAnnualRate(annals.returnRate))} · ${escapeHtml(formatAnnualSignedMoney(row.capitalReturnCny))}` : '')}
      ${attrItems
        ? `<div class="ann-attr-bar">${attrBar}</div><div class="ann-attr-rows">${attrRows}</div>${coverageNote}`
        : '<p class="ann-empty-line">缺少年初持仓快照或年界汇率，本年暂时拆不出归因</p>'}
    </section>
    <section class="ann-block">
      ${getAnnualSecHead('年度持仓', annals.holdings.hasData ? `${annals.holdings.count} 项 · ${escapeHtml(formatDisplayMoney(annals.holdings.total, 'CNY'))}` : '')}
      ${annals.holdings.hasData
        ? `${getAnnualDonutMarkup(annals.holdings)}${getAnnualHoldingsNote(annals.holdings)}`
        : '<p class="ann-empty-line">该年暂无持仓快照</p>'}
    </section>
    <section class="ann-block">
      ${getAnnualSecHead('当年股息现金流')}
      <div class="ann-months">${annals.dividendMonths.map((value, index) => `<span class="${index === currentMonth ? 'is-current' : ''}"><i style="--v:${Math.max(2, safeNumber(value, 0) / maxDividend * 100).toFixed(1)}%"></i><small>${ANNUAL_MONTH_LABELS[index]}</small></span>`).join('')}</div>
      <p class="ann-months-total"><span>${annals.isCurrentYear ? '本年已确认股息' : '全年确认股息'}</span><strong>${escapeHtml(formatIncomeMoney(row.dividendCny))}</strong></p>
    </section>
    <section class="ann-block">
      ${getAnnualSecHead('交易复盘', annals.trades.length ? `${annals.trades.length} 笔` : '')}
      <div class="ann-trades">${tradeRows}</div>
      ${annals.trades.length ? `<p class="ann-trade-sum">全年 ${annals.trades.length} 笔 · 买入 ${buyCount} · 卖出 ${sellCount}</p>` : ''}
    </section>`;
}

/* ── 11-分享卡 · 按 designs/禅意UI/11-分享卡/定稿图.html ──
   硬约束：全卡只有比例与收益率，禁止出现 ¥ 与任何绝对金额；
   固定素禅日间配色导出，不随夜间模式变色。 */
const SHARE_DONUT_COLORS = ['#c9a558', '#dcc492', '#b3a68c', '#cfc4ad', '#e2d9c4', '#efe9da'];

function formatSharePercent(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const numeric = Number(value) * 100;
  return `${numeric > 0 ? '+' : numeric < 0 ? '−' : ''}${Math.abs(numeric).toFixed(1)}%`;
}

function formatSharePlainPercent(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return `${(Number(value) * 100).toFixed(1)}%`;
}

/* 累计年化：与 09 页趋势同一口径（各年资金收益率复利折年） */
function getCumulativeAnnualized(model) {
  const rates = model.trendRows
    .map((row) => getTrendValue(row, 'capitalReturnRate'))
    .filter((value) => value !== null);
  if (!rates.length) return { rate: null, startYear: null };
  const product = rates.reduce((acc, value) => acc * (1 + value), 1);
  const startYear = model.trendRows.find((row) => getTrendValue(row, 'capitalReturnRate') !== null).year;
  return { rate: product > 0 ? Math.pow(product, 1 / rates.length) - 1 : null, startYear };
}

export function buildAnnualShareModel(year) {
  const annals = computeYearAnnals(year);
  if (!annals) return null;
  const model = computeIncomeSummary();
  const attrItems = getAnnualAttributionItems(annals) || [];
  // 分享卡默认把持仓全展开：前五各占一阶色，尾部并入第六阶（也就是环上那段「其余」）
  const holdings = annals.holdings.hasData ? annals.holdings.items : [];
  const top = holdings.slice(0, 5);
  const restPct = holdings.slice(5).reduce((sum, item) => sum + item.pct, 0);
  return {
    year,
    returnRate: annals.returnRate,
    dividendYieldRate: annals.row.dividendYieldRate,
    cumulative: getCumulativeAnnualized(model),
    attrItems,
    holdings,
    top,
    restPct
  };
}

function getShareCardMarkup(share) {
  const totalAbs = share.attrItems.reduce((sum, item) => sum + Math.abs(item.amount), 0) || 1;
  const bar = share.attrItems
    .map((item) => `<i class="is-${item.key}" style="width:${(Math.abs(item.amount) / totalAbs * 100).toFixed(2)}%"></i>`).join('');
  const splitText = share.attrItems.length
    ? `收益率拆分：${share.attrItems.map((item) => `${item.label.replace('收入', '').replace('增长', '').replace('变动', '').trim()} ${formatSharePercent(item.rate).replace('%', '')}`).join(' · ')}（合计 ${formatSharePercent(share.returnRate)}）`
    : '归因数据不足，本卡只展示收益率与持仓占比';
  const segs = share.top.map((item, index) => ({ pct: item.pct, color: SHARE_DONUT_COLORS[index] }));
  if (share.restPct > 0.0001) segs.push({ pct: share.restPct, color: SHARE_DONUT_COLORS[5] });
  const circumference = 2 * Math.PI * 38;
  let offset = 0;
  const arcs = segs.map((seg) => {
    const length = seg.pct * circumference;
    const arc = `<circle cx="48" cy="48" r="38" fill="none" stroke="${seg.color}" stroke-width="9" stroke-dasharray="${length.toFixed(1)} ${(circumference - length).toFixed(1)}" stroke-dashoffset="${(-offset).toFixed(1)}"></circle>`;
    offset += length;
    return arc;
  }).join('');
  // 逐项列全（无「其余 N 项」折叠），前五取对应阶色，尾部统一走第六阶
  const legend = share.holdings.map((item, index) => `<div><b style="background:${SHARE_DONUT_COLORS[Math.min(index, 5)]}"></b><span class="co">${escapeHtml(item.name)}</span><span class="pc">${(item.pct * 100).toFixed(1)}%</span></div>`).join('');
  const cumulativeText = share.cumulative.rate === null
    ? ''
    : ` · 自 ${share.cumulative.startYear} 累计年化 ${formatSharePercent(share.cumulative.rate)}`;
  return `<div class="zen-share-card">
      <span class="sc-brand">Bebop Ledger · ${share.year}</span>
      <span class="sc-label">本年收益率</span>
      <strong class="sc-value ${getReturnTone(share.returnRate)}">${escapeHtml(formatSharePercent(share.returnRate))}</strong>
      <p class="sc-meta">股息收益率 ${escapeHtml(formatSharePlainPercent(share.dividendYieldRate))}${escapeHtml(cumulativeText)}</p>
      ${share.attrItems.length ? `<div class="sc-bar">${bar}</div>` : ''}
      <p class="sc-attr">${escapeHtml(splitText)}</p>
      ${segs.length ? `<div class="sc-hold">
        <svg viewBox="0 0 96 96" width="96" height="96" role="img" aria-label="持仓占比">${arcs}</svg>
      </div>
      <div class="sc-hold-legend">${legend}</div>` : ''}
      <p class="sc-foot">波普账本 · 比例已脱敏 · 无金额</p>
    </div>`;
}

/* 分享卡导出：canvas 重绘同一份内容为 PNG。固定素禅日间配色，与夜间无关。 */
export function generateAnnualShareCard() {
  const share = buildAnnualShareModel(state.activeAnnualYear);
  if (!share) return;
  const C = { card: '#fffdf8', ink: '#3b362e', gold: '#c19a45', up: '#bf5a42', down: '#6a8b74', muted: '#a89d86', hint: '#c2b9a6', label: '#b0a78f', track: '#eae4d4' };
  const W = 750;
  // 持仓两列排开，行数决定画布高度——24 家和 4 家不该出一样高的图
  const listTop = 736;
  const rowH = 34;
  const listRows = Math.ceil(share.holdings.length / 2);
  const H = listTop + listRows * rowH + 100;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const font = (size, weight = 600) => `${weight} ${size}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
  const tone = (value) => (safeNumber(value, 0) > 0 ? C.up : safeNumber(value, 0) < 0 ? C.down : C.ink);
  ctx.fillStyle = C.card;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'center';

  ctx.fillStyle = C.hint; ctx.font = font(20, 600);
  ctx.fillText(`BEBOP LEDGER · ${share.year}`, W / 2, 120);
  ctx.fillStyle = C.label; ctx.font = font(22, 600);
  ctx.fillText('本年收益率', W / 2, 200);
  ctx.fillStyle = tone(share.returnRate); ctx.font = font(96, 600);
  ctx.fillText(formatSharePercent(share.returnRate), W / 2, 300);
  ctx.fillStyle = C.muted; ctx.font = font(24, 600);
  const cumulativeText = share.cumulative.rate === null ? ''
    : ` · 自 ${share.cumulative.startYear} 累计年化 ${formatSharePercent(share.cumulative.rate)}`;
  ctx.fillText(`股息收益率 ${formatSharePlainPercent(share.dividendYieldRate)}${cumulativeText}`, W / 2, 350);

  // 归因四段线（宽 440，高 4）+ 一行拆分文字
  const barW = 440;
  const barX = (W - barW) / 2;
  const totalAbs = share.attrItems.reduce((sum, item) => sum + Math.abs(item.amount), 0) || 1;
  const barColors = { divi: C.gold, eps: C.ink, val: C.muted, fx: C.track };
  let bx = barX;
  share.attrItems.forEach((item) => {
    const w = Math.abs(item.amount) / totalAbs * barW;
    ctx.fillStyle = barColors[item.key] || C.track;
    ctx.fillRect(bx, 400, w, 4);
    bx += w;
  });
  ctx.fillStyle = C.muted; ctx.font = font(21, 600);
  if (share.attrItems.length) {
    const split = share.attrItems
      .map((item) => `${item.label.replace('收入', '').replace('增长', '').replace('变动', '').trim()} ${formatSharePercent(item.rate).replace('%', '')}`)
      .join(' · ');
    ctx.fillText(split, W / 2, 452);
    ctx.fillText(`合计 ${formatSharePercent(share.returnRate)}`, W / 2, 486);
  }

  // 持仓占比：mini 环居中，下面把持仓逐项列全（两列），与卡片预览一致
  const cx = W / 2;
  const cy = 610;
  const rOuter = 84;
  const rInner = 53;
  const segs = share.top.map((item, index) => ({ pct: item.pct, color: SHARE_DONUT_COLORS[index] }));
  if (share.restPct > 0.0001) segs.push({ pct: share.restPct, color: SHARE_DONUT_COLORS[5] });
  let start = -Math.PI / 2;
  segs.forEach((seg) => {
    const end = start + seg.pct * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, rOuter, start, end);
    ctx.closePath();
    ctx.fillStyle = seg.color;
    ctx.fill();
    start = end;
  });
  ctx.beginPath();
  ctx.arc(cx, cy, rInner, 0, Math.PI * 2);
  ctx.fillStyle = C.card;
  ctx.fill();

  const colX = [64, 400];
  const colW = 286;
  share.holdings.forEach((item, index) => {
    const x = colX[index % 2];
    const ty = listTop + Math.floor(index / 2) * rowH;
    ctx.fillStyle = SHARE_DONUT_COLORS[Math.min(index, 5)];
    ctx.beginPath();
    ctx.arc(x + 5, ty - 6, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.fillStyle = C.muted; ctx.font = font(19, 600);
    ctx.fillText(item.name.length > 7 ? `${item.name.slice(0, 7)}…` : item.name, x + 20, ty);
    ctx.textAlign = 'right';
    ctx.fillStyle = C.ink; ctx.font = font(19, 700);
    ctx.fillText(`${(item.pct * 100).toFixed(1)}%`, x + colW, ty);
  });

  // 水印永远贴在最后一行下面
  const footY = listTop + listRows * rowH + 54;
  ctx.fillStyle = C.hint; ctx.font = font(19, 600); ctx.textAlign = 'center';
  ctx.fillText('波普账本 · 比例已脱敏 · 无金额', W / 2, footY);

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `波普账本-${share.year}-年度回顾.png`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 'image/png');
}

export function getAnnualShareCardMarkup(year) {
  const share = buildAnnualShareModel(year);
  if (!share) return '<p class="ann-empty-line">该年暂无可分享的数据</p>';
  return getShareCardMarkup(share);
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
