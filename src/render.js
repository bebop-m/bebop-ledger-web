import { state, refs, mutable, saveState, isDemoMode } from './state.js';
import {
  computeHoldings, getBucketSegments, getBucketSummaryItems, getNetAssetShare,
  computeDividendCalendar, computeIncomeSummary,
  computeCashFlowRecords, computeDividendRecords, computeTradeSummary, isCashModelActive, computeCashBalance, getAnnualDividendOverview,
  computeIpoRounds, computeIpoRecords
} from './compute.js';
import { renderFundamentalsPage, getFundamentalsCompanyCount, getPortfolioReturnSummary } from './fundamentals.js';
import { computeYearAnnals } from './annals.js';
import { getDividendChangeReview } from './diagnostics.js';
import { getUpcomingReportEvents } from './report-calendar.js';
import {
  safeNumber, escapeHtml, formatMoney, formatPlainPrice, formatPercent, formatDailyPnl,
  formatTimestamp, normalizeDividendStatus, getDividendStatusLabel, signPrefix, SIGN_MINUS,
  buildDividendTooltipLines, buildDividendTooltipHtml, createElementFromHtml, getStaleDays
} from './utils.js';
import {
  MASK_AMOUNT, LABELS, UI_TEXT,
  LEGEND_COLLAPSED_COUNT, LEGEND_TOGGLE_ANIMATION_MS,
  HOLDING_ENTER_STAGGER_MS, HOLDING_ENTER_STAGGER_MAX_MS, TOOLTIP_FALLBACK_WIDTH,
  TOOLTIP_GAP, HOLDING_REMOVAL_FALLBACK_MS,
  HOLDING_SWIPE_DELETE_WIDTH, HOLDING_SWIPE_OPEN_THRESHOLD
} from './constants.js';

/* ── Format helpers that depend on state ── */
export function formatDisplayMoney(value, currency = 'CNY', decimals = 0) {
  return state.showAmounts ? formatMoney(value, currency, decimals) : MASK_AMOUNT;
}

function getHoldingTitleDivider() { return '\u00b7'; }

function formatLedgerMoney(value, currency = 'CNY', fractionClass = '') {
  if (!state.showAmounts) return `<span>${MASK_AMOUNT}</span>`;
  const formatted = formatMoney(value, currency, 2); // 首页 hero 的小数尾巴是定稿形态，不随全局去角分
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
  // 首页口径恒为全部：日历页的仓位筛选不外溢（真机反馈 2026-08-06，筛选曾把首页本年股息带成打工仓值）
  const calendarModel = computeDividendCalendar(new Date(), 'all');
  const incomeModel = computeIncomeSummary();
  const bucketItems = getBucketSummaryItems(summary.holdings);
  renderHomeHero(summary);
  renderHomeMetrics(calendarModel, summary);
  renderHomeNavSummaries(summary, calendarModel, bucketItems, incomeModel);
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
  const amountText = state.showAmounts ? `${signPrefix(value)}\u00a5${Math.round(Math.abs(value)).toLocaleString('en-US')}` : MASK_AMOUNT;
  const rateText = rate === null || rate === undefined
    ? '' : ` \u00b7 ${signPrefix(rate)}${formatPercent(Math.abs(rate))}`;
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
  const annual = getAnnualDividendOverview(calendarModel);
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
  /* \u8282\u594f\u9884\u4f30\u53ea\u662f\u6309\u5f80\u5e74\u63a8\u7b97\uff0c\u4e0d\u80fd\u548c\u5df2\u516c\u544a/\u5728\u9014\u4e00\u6837\u9648\u8ff0\u6210\u300c\u5230\u8d26\u300d\u3002
     \u91d1\u989d\u524d\u7f00\u300c\u7ea6\u300d\u4e0e\u53e5\u5c3e\u300c\u9884\u8ba1\u5230\u8d26\u300d\u4e00\u8d77\uff0c\u628a\u4e0d\u786e\u5b9a\u6027\u8bf4\u6e05\u695a\u3002 */
  const nextIsEstimate = Boolean(nextDividend && nextDividend.isForecast);
  const nextAmountText = nextDividend ? formatDisplayMoney(nextDividend.netCny, 'CNY') : '';
  const nextMonth = nextDividend ? Math.floor(safeNumber(String(nextDividend.payDate || nextDividend.exDate || '').slice(5, 7), 0)) : 0;
  /* 这行自禅意首版起一直是纯文本；真机反馈 2026-08-06 接上点击——走月点同一条路由 */
  const nextLine = nextDividend && nextMonth >= 1 && nextMonth <= 12
    ? `<button class="home-todo-line" type="button" data-home-dividend-month="${nextMonth}" aria-label="查看 ${nextMonth} 月股息明细">${nextDate.month}${nextDate.day}日 ${escapeHtml(nextName)} <strong>${escapeHtml(nextIsEstimate ? `约${nextAmountText}` : nextAmountText)}</strong> ${nextIsEstimate ? '预计到账' : '到账'}</button>`
    : (nextDividend ? `${nextDate.month}${nextDate.day}日 ${escapeHtml(nextName)} <strong>${escapeHtml(nextAmountText)}</strong> 到账` : '近期暂无在途股息');
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
  // 同上：预估条目不冒充确定的「下一笔」
  return `${next.isForecast ? '预计' : '下一笔'} ${formatHudDate(next.payDate || next.exDate)} ${escapeHtml(next.symbol)}`;
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

function renderHomeNavSummaries(summary, calendarModel, bucketItems, incomeModel) {
  const cash = computeCashFlowRecords();
  const dividends = computeDividendRecords();
  const trades = computeTradeSummary();
  const coreItem = bucketItems.find((item) => item.key === 'core');
  // \u8ba1\u6570\u4e0e\u6301\u4ed3\u9875\u5217\u8868\u540c\u53e3\u5f84\uff1a\u6e05\u4ed3\u80a1\uff08\u6709\u6548\u80a1\u6570 0\uff09\u4e0d\u7b97\u300c\u9879\u300d
  const heldCount = summary.holdings.filter((item) => safeNumber(item.quantity, 0) > 0).length;
  const summaries = {
    holdings: `${heldCount} \u9879${coreItem ? ` \u00b7 ${LABELS.core} ${(getNetAssetShare(coreItem.marketValueCny, summary) * 100).toFixed(1)}%` : ''}`,
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

/* ── 02-持仓页 · 按 designs/禅意UI/02-持仓页/定稿图.html 重排 ── */

/* 结构行与逐股行用整数金额 + 一位小数百分比：定稿图写的就是 ¥286,400 / 7.9%。
   带两位小数会把 sub 行顶到换行，而验收要求 sub 行一行放得下。 */
function formatZenMoney(value) {
  if (!state.showAmounts) return MASK_AMOUNT;
  const amount = safeNumber(value, 0);
  return `${amount < 0 ? SIGN_MINUS : ''}¥${Math.round(Math.abs(amount)).toLocaleString('en-US')}`;
}

function formatZenPercent(value) {
  return `${(safeNumber(value, 0) * 100).toFixed(1)}%`;
}

/* hero 让位给仓位结构：市值大数的户口在首页（净资产），本页只留节标。
   市值与今日涨跌降为 renderBucketsView 里的一行随注（02-v3 裁决）。 */
export function renderHoldingsHero() {
  if (!refs.holdingsHero) return;
  refs.holdingsHero.innerHTML = ''; // 双仓百分比自己当 hero，不再立「仓位结构」节标（真机反馈 2026-08-06）
}

/* ── 仓位结构 ──
   两个仓位百分比（大字）+ 两段线。就这两样，是本页的一句话职责：钱分两种、各占多少。
   2026-08 裁决：切换态退役——它此前只换一行明细文字、不过滤不分组列表，
   结构宣言与内容排布脱节；现在由列表自己分段承担，明细与市值随注行一并撤销
   （今日涨跌与首页 hero 同值）。点仓位滚到对应段。
   百分比按自有资金计（与逐股行同口径），融资时两数之和会超 100%；
   两段线仍是内部构成比例——线段画不了杠杆，画的是钱怎么分。 */
export function renderBucketsView(segments, holdings, summary, opts = {}) {
  if (!refs.bucketTrack) return;
  const items = getBucketSummaryItems(holdings);
  const total = items.reduce((sum, item) => sum + safeNumber(item.marketValueCny, 0), 0);
  const find = (key) => items.find((item) => item.key === key) || null;
  const barShare = (item) => (total > 0 && item ? item.marketValueCny / total : 0);
  const bar = ['core', 'income'].map((key) => {
    const item = find(key);
    return item ? `<i class="seg-${key}" style="width:${(barShare(item) * 100).toFixed(2)}%"></i>` : '';
  }).join('');
  const buttons = ['core', 'income'].map((key) => {
    const item = find(key);
    if (!item) return '';
    return `<button class="bucket" type="button" data-bucket-scroll="${key}" aria-label="滚动到${escapeHtml(item.label)}"><span class="bucket-label">${escapeHtml(item.label)}</span><strong>${formatZenPercent(getNetAssetShare(item.marketValueCny, summary))}</strong></button>`;
  }).join('');
  refs.bucketTrack.innerHTML = `
    <div class="bucket-row bucket-row--hero">${buttons}</div>
    <div class="structure-bar" aria-hidden="true">${bar}</div>`;
}

export function patchBucketsView(segments, holdings, summary) {
  renderBucketsView(segments, holdings, summary, { animateDetail: false });
}

/* 页头右槽：角标只报减派数，用涨色提醒——增派是好消息，不值得一个常挂的数字，
   只增无减时留一颗小点表示「有变化可看，不急」。细则全部在抽屉里。 */
export function renderDiagnosticsButton() {
  if (!refs.diagnosticsButton) return;
  const model = getDividendChangeReview();
  const cuts = model.cuts.length;
  const raises = model.raises.length;
  refs.diagnosticsButton.hidden = false;
  refs.diagnosticsButton.innerHTML = cuts > 0
    ? `诊断 <b>${cuts}</b>`
    : (raises > 0 ? '诊断 <i class="diag-dot" aria-hidden="true"></i>' : '诊断');
  refs.diagnosticsButton.classList.toggle('has-issues', cuts > 0);
  refs.diagnosticsButton.classList.toggle('has-attention', cuts === 0 && raises > 0);
  const label = cuts > 0
    ? `股息诊断，${cuts} 只减派${raises > 0 ? `、${raises} 只增派` : ''}`
    : (raises > 0 ? `股息诊断，${raises} 只增派` : '股息诊断，派息无变动');
  refs.diagnosticsButton.setAttribute('aria-label', label);
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
  if (field === 'netAnnualDividendCny') return 'TTM';
  return '市值';
}

export function renderSortControl() {
  if (!refs.holdingsSortLabel) return;
  refs.holdingsSortLabel.textContent = `按${getSortActionLabel(state.sortField)} ${state.sortDirection === 'desc' ? '↓' : '↑'}`;
  refs.holdingsSortLabel.title = `${UI_TEXT.sort} · ${getSortFieldLabel(state.sortField)}`;
}

/* 行情整体停更天数：超过配置阈值（config.json 的 staleDays）才返回天数，否则 0。
   定时任务挂掉时时间戳长得和平时一模一样，没有这个提示就只能靠心算日期。
   逐只股息的新鲜度另有 isDividendDataStale，两者共用同一个阈值。 */
function getMarketStaleDays() {
  const updated = new Date(state.lastUpdatedAt);
  if (Number.isNaN(updated.getTime())) return 0;
  const days = Math.floor((Date.now() - updated.getTime()) / 86400000);
  return days > getStaleDays() ? days : 0;
}

export function renderTimestamp() {
  if (!refs.marketTimestamp) return;
  // formatTimestamp 给的是「行情更新 07-24 09:32」，定稿图这行只写「行情 07-24 09:32」
  const stamp = formatTimestamp(state.lastUpdatedAt);
  const short = stamp.startsWith(LABELS.marketUpdated) ? `行情${stamp.slice(LABELS.marketUpdated.length)}` : stamp;
  const staleDays = getMarketStaleDays();
  // 「点此打开诊断」删去：右上角已有「诊断 N」按钮，可点性不靠这行字教
  const parts = staleDays > 0 ? [short, `停更 ${staleDays} 天`] : [short];
  refs.marketTimestamp.textContent = parts.join(' · ');
  refs.marketTimestamp.classList.toggle('is-stale', staleDays > 0);
  refs.marketTimestamp.setAttribute('aria-label', staleDays > 0
    ? `行情已停更 ${staleDays} 天，打开股息诊断`
    : '打开股息诊断');
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
    return ''; // 无数据的句子整句消失（信息收敛：空态不立牌）
  }
  const up = yoy >= 0;
  return `<strong class="is-${up ? 'up' : 'down'}">${escapeHtml(`${up ? '+' : SIGN_MINUS}${formatPercent(Math.abs(yoy))}`)}</strong> · ${escapeHtml(LABELS.dividendVsLastYear)}`;
}


function formatDividendRowDate(entry) {
  const value = entry.receivedDate || entry.payDate || entry.exDate || '';
  const parts = String(value).split('-');
  return parts.length >= 3 ? `${Number(parts[1])}月${Number(parts[2])}日` : '';
}

/* 持有整年 TTM ¥ = TTM 每股股息 × 现持股数（税后）合计，跟随仓位筛选。
   全 app 此口径只在股息日历出现（信息收敛 2026-08 裁决）。 */
function getTtmDividendCny(filterKey) {
  const computed = computeHoldings();
  if (filterKey !== 'core' && filterKey !== 'income') return safeNumber(computed.totalDividendCny, 0);
  const hit = getBucketSummaryItems(computed.holdings).find((item) => item.key === filterKey);
  return hit ? safeNumber(hit.totalDividendCny, 0) : 0;
}

/* 股息日历的回看模式：从年度回顾点进来的历史年份。当年（或未设置）一律走实时模式，
   所以「回看」只会出现在已经走完的年份上，预估/在途这些未来时态自然缺席。 */
export function getDividendViewYear() {
  const year = mutable.dividendViewYear;
  return year && year !== new Date().getFullYear() ? year : null;
}

function getActiveDividendCalendarModel() {
  const viewYear = getDividendViewYear();
  return viewYear
    ? computeDividendCalendar(`${viewYear}-12-31`, null, { closedYear: true })
    : computeDividendCalendar();
}

function renderDividendMetricGrid(model, viewYear = null) {
  const m = model.metrics;
  /* 三个互斥的桶，相加恒等于「预计全年」：
     已到账（钱已入账）→ 在途（已公告/待核对，等着到账）→ 预估（按往年节奏推算）。
     词条自明，灰色小字说明退场；零值行不上屏（在途大多数时候为 0）。 */
  const pipelineCny = Math.max(0, m.committedCny - m.receivedCny);
  const width = (value) => (m.projectedCny > 0 ? Math.max(0, safeNumber(value, 0) / m.projectedCny * 100) : 0).toFixed(2);
  const receivedPct = Math.round(m.projectedCny > 0 ? Math.min(1, Math.max(0, m.receivedCny / m.projectedCny)) * 100 : 0);
  const legendRow = (tone, name, value) => (safeNumber(value, 0) > 0 ? `<div class="divi-legend-row${tone === 'pipeline' ? ' is-live' : ''}">
      <b class="is-${tone}" aria-hidden="true"></b><span>${escapeHtml(name)}</span><strong>${escapeHtml(formatDisplayMoney(value, 'CNY'))}</strong>
    </div>` : '');
  /* 回看模式的股息率分母是「当前」市值，对历史年份口径错配，连同 TTM 一起退场；
     同比（该年 vs 前一年）口径不受影响，保留。 */
  const ttmCny = viewYear ? 0 : getTtmDividendCny(model.filterKey);
  /* 随注：上年无数据时同比子句整句消失，只留股息率（与 hero 同口径） */
  const yoyLine = buildDividendYoyLine(m.projectedYoy);
  const metaParts = [];
  if (yoyLine) metaParts.push(yoyLine);
  if (!viewYear && m.projectedYieldRate !== null && m.projectedYieldRate !== undefined) metaParts.push(`股息率 ${escapeHtml(`${(m.projectedYieldRate * 100).toFixed(1)}%`)}`);
  refs.dividendMetricGrid.innerHTML = `
    <div class="divi-hero">
      <span class="divi-hero-label">${viewYear ? '全年股息' : '预计全年'}${model.filterKey === 'core' ? ' · 核心仓' : model.filterKey === 'income' ? ' · 打工仓' : ''}</span>
      <strong class="divi-hero-value">${escapeHtml(formatDisplayMoney(m.projectedCny, 'CNY'))}</strong>
      ${metaParts.length ? `<p class="divi-yoy">${metaParts.join(' · ')}</p>` : ''}
    </div>
    <div class="divi-stack" role="img" aria-label="构成：已到账 ${receivedPct}%，其余在途与预估">
      <i class="is-received" style="width:${width(m.receivedCny)}%"></i><i class="is-pipeline" style="width:${width(pipelineCny)}%"></i><i class="is-forecast" style="width:${width(m.forecastCny)}%"></i>
    </div>
    <div class="divi-legend">
      ${legendRow('received', '已到账', m.receivedCny)}
      ${legendRow('pipeline', '在途', pipelineCny)}
      ${legendRow('forecast', '预估', m.forecastCny)}
      ${ttmCny > 0 ? `<div class="divi-legend-row divi-legend-row--ttm">
      <b class="is-ttm" aria-hidden="true"></b><span>TTM</span><strong>${escapeHtml(formatZenMoney(ttmCny))}</strong>
    </div>` : ''}
    </div>`;
}

/* 近期列表的状态词与色：金=已到账，hint=在途/已公告/预估，涨红只留给待确认（置顶那段）。 */
function getDividendRowStatus(entry) {
  if (entry.isForecast) return { text: '预估', tone: 'transit' };
  if (entry.isAnnounced || entry.status === 'announced') return { text: '已公告', tone: 'transit' };
  if (entry.status === 'due') return { text: '待确认', tone: 'due' };
  if (entry.status === 'received') return { text: '已到账', tone: 'paid' };
  return { text: '在途', tone: 'transit' };
}

/* 公告行的减派标记：每股派息低于去年同期那笔（compute 侧按除息日季节对齐）时
   用涨色提醒，涨或持平静默——非默认态才标记。报表宣布减派当天即可见，
   不用等财年数据（旧诊断规则要滞后近一年）。 */
function getDividendCutTag(entry, className) {
  const change = entry && entry.yoyPerShareChange;
  if (!(entry && (entry.isAnnounced || entry.status === 'announced')) || !(change < 0)) return '';
  const pct = Math.abs(change * 100);
  return `<span class="${className}">减派 ${pct >= 9.95 ? pct.toFixed(0) : pct.toFixed(1)}%</span>`;
}

/* 特别息标注：单独一行的特别息标「特别息」；除息后被合并成一笔的（分量里含特别息）标「含特别息」。
   一次性的钱要看得出来是一次性的，否则会被当成常态收入。 */
function getDividendKindTag(entry, className) {
  if (!entry) return '';
  if (String(entry.kind || '').toLowerCase() === 'special') return `<span class="${className}">特别息</span>`;
  const components = Array.isArray(entry.components) ? entry.components : [];
  return components.some((item) => String(item && item.kind || '').toLowerCase() === 'special')
    ? `<span class="${className}">含特别息</span>` : '';
}

/* 真实台账条目直接点行进 08-股息到账，可点判定与月明细同一规则；
   预估/已公告背后没有可编辑的台账条目，保持纯展示。 */
function buildDividendRow(entry) {
  const status = getDividendRowStatus(entry);
  const clickable = !entry.isForecast && !(entry.isAnnounced || entry.status === 'announced') && entry.sourceId;
  const tag = clickable ? 'button' : 'div';
  const attrs = clickable
    ? ` type="button" data-modal-action="edit-dividend-ledger" data-source-id="${escapeHtml(entry.sourceId)}" aria-label="编辑 ${escapeHtml(entry.name || entry.symbol)} 股息"`
    : '';
  return `<${tag} class="divi-row${clickable ? ' is-clickable' : ''}"${attrs}>
    <span>${escapeHtml(formatDividendRowDate(entry))} <strong>${escapeHtml(entry.name || entry.symbol)}</strong></span>
    <span><strong>${escapeHtml(formatDisplayMoney(entry.netCny, 'CNY'))}</strong>${[getDividendKindTag(entry, 'divi-st is-transit'), getDividendCutTag(entry, 'divi-st is-due')].filter(Boolean).map((tag) => ` ${tag}`).join('')}${status.tone === 'paid' ? '' : ` <span class="divi-st is-${status.tone}">${escapeHtml(status.text)}</span>`}</span>
  </${tag}>`;
}

const DIVIDEND_LIST_LIMIT = 6;
const DIVIDEND_DUE_LIMIT = 3;

function renderDividendMonths(model, viewYear = null) {
  /* 月度节奏条：线高=当月金额（√ 标尺），实金=已发生月，浅金=未来月，
     无派息月只留 2px 底座；12 个金额数字退场，点月进月明细看数。 */
  const maxMonthCny = Math.max(0, ...model.months.map((item) => safeNumber(item.totalCny, 0)));
  const cells = model.months.map((item) => {
    const amount = safeNumber(item.totalCny, 0);
    const hasPay = amount > 0;
    const height = hasPay && maxMonthCny > 0 ? Math.max(3, Math.round(Math.sqrt(amount / maxMonthCny) * 46)) : 2;
    /* 实金只画已到账的部分：8 月一笔没到就该是整根浅金（真机反馈 2026-08-06）。
       无派息月只留 2px 底座。 */
    const receivedShare = hasPay ? Math.min(1, Math.max(0, safeNumber(item.receivedCny, 0) / amount)) : 0;
    const classes = ['divi-ym'];
    if (item.phase === 'past') classes.push('is-past');
    if (item.phase === 'current') classes.push('is-current');
    if (hasPay) classes.push('has-pay');
    return `<button class="${classes.join(' ')}" type="button" data-dividend-month="${item.month}" aria-label="查看 ${item.month} 月逐笔股息">
      <i class="divi-tick${hasPay ? '' : ' is-zero'}" style="height:${height}px" aria-hidden="true">${receivedShare > 0 ? `<b class="divi-tick-fill" style="height:${(receivedShare * 100).toFixed(1)}%"></b>` : ''}</i><span>${String(item.month).padStart(2, '0')}</span><b aria-hidden="true"></b>
    </button>`;
  }).join('');

  /* 两段列表合起来最多 DIVIDEND_LIST_LIMIT 行——本页要一屏放得下，
     而待确认在真实账本里能堆到二十几笔（把整页顶到 1610px 滚动过）。
     节标上的「N 笔 · 总额」是全量口径，截断的只是行；列出的行可以直接点开处理，
     被截断的走月点阵进月明细，那里的列表自己滚。 */
  const due = model.allDetails
    .filter((entry) => entry.status === 'due')
    .sort((a, b) => `${b.payDate}|${b.symbol}`.localeCompare(`${a.payDate}|${a.symbol}`));
  const dueCny = due.reduce((sum, entry) => sum + safeNumber(entry.netCny, 0), 0);
  const dueShown = due.slice(0, DIVIDEND_DUE_LIMIT);
  const dueSection = due.length ? `
    <div class="sec-head"><span class="sec-label">待确认 · ${due.length} 笔</span><span class="sec-aside">${escapeHtml(formatDisplayMoney(dueCny, 'CNY'))}</span></div>
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
    <div class="sec-head${due.length ? ' is-later' : ''}"><span class="sec-label">近期</span><span class="sec-aside">${settled.length ? `<button class="divi-all-link" type="button" data-divi-all-records>全部 ${computeDividendRecords(viewYear || new Date().getFullYear()).count} 笔 →</button>` : '按往年节奏推算'}</span></div>
    <div class="divi-rows">${recent.map(buildDividendRow).join('')}</div>` : '';

  refs.dividendMonthGrid.innerHTML = `
    <div class="divi-year">${cells}</div>
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
  const viewYear = getDividendViewYear();
  const model = getActiveDividendCalendarModel();
  const item = model.months[month - 1] || null;
  const entries = model.allDetails
    .filter((entry) => entry.month === month)
    .sort((a, b) => `${a.payDate}|${a.symbol}`.localeCompare(`${b.payDate}|${b.symbol}`));
  const summaryParts = [];
  if (item) {
    if (item.receivedCny > 0) summaryParts.push(`${LABELS.dividendReceivedStatus} ${formatDisplayMoney(item.receivedCny, 'CNY')}`);
    if (item.dueCny > 0) summaryParts.push(`待核对 ${formatDisplayMoney(item.dueCny, 'CNY')}`);
    /* upcomingCny 已含 dueCny，这里必须减掉，否则同一笔钱在「待核对」和「在途」里各出现一次。
       三项互不重叠且相加等于当月合计。 */
    /* upcomingCny 含 due 与 forecast；此前小结把预估并进「在途」统称，与页面词表冲突，拆开各报各的 */
    const forecastCny = entries.reduce((sum, entry) => sum + (entry.isForecast ? safeNumber(entry.netCny, 0) : 0), 0);
    const transitCny = Math.max(0, item.upcomingCny - item.dueCny - forecastCny);
    if (transitCny > 0) summaryParts.push(`在途 ${formatDisplayMoney(transitCny, 'CNY')}`);
    if (forecastCny > 0) summaryParts.push(`预估 ${formatDisplayMoney(forecastCny, 'CNY')}`);
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
          <span class="zen-md-co"><strong>${escapeHtml(entry.name)}</strong><span>${escapeHtml(getMonthDetailDateShort(entry))}</span></span>
          <span class="zen-md-side"><strong>${escapeHtml(formatDisplayMoney(entry.netCny, 'CNY'))}</strong>${getDividendKindTag(entry, 'is-transit')}${getDividendCutTag(entry, 'is-due')}${status.tone === 'paid' ? '' : `<span class="is-${status.tone}">${escapeHtml(status.text)}</span>`}</span>
        </${tag}>`;
      }).join('')
    : `<p class="zen-md-empty">${escapeHtml(LABELS.dividendEmptyTitle)}</p>`;
  const receivedRatio = item && item.totalCny > 0
    ? Math.min(1, Math.max(0, item.receivedCny / item.totalCny)) : 0;
  return {
    title: `${viewYear ? `${viewYear} · ` : ''}${month}${LABELS.dividendMonthSuffix}`,
    phase: item ? item.phase : 'future',
    total: item ? formatDisplayMoney(item.totalCny, 'CNY') : formatDisplayMoney(0, 'CNY'),
    summary: item && item.totalCny > 0 && item.receivedCny >= item.totalCny ? '' : summaryParts.join(' · '),
    receivedRatio,
    receivedPercentText: `${Math.round(receivedRatio * 100)}%`,
    hasConfirmable: entries.some((entry) => !entry.isForecast && !(entry.isAnnounced || entry.status === 'announced') && entry.sourceId),
    body
  };
}

export function renderDividendCalendarPage() {
  const viewYear = getDividendViewYear();
  const model = getActiveDividendCalendarModel();
  // 回看模式把年份写进页名，回到实时模式还原
  const pageName = document.querySelector('#dividendCalendarPage .page-name');
  if (pageName) pageName.textContent = viewYear ? `${viewYear} 股息日历` : '股息日历';
  refs.dividendFilterButtons.forEach((button) => {
    const isActive = button.dataset.dividendFilter === model.filterKey;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
  refs.dividendCalendarListView.hidden = false;
  refs.dividendMonthDetailView.hidden = true;
  refs.dividendMonthDetailView.innerHTML = '';
  renderDividendMetricGrid(model, viewYear);
  renderDividendMonths(model, viewYear);
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

// 定稿图上的收益率一律一位小数（+5.7% / −8.1%），本页统一按此形
function formatIncomeRate(value) {
  if (isIncomeValueMissing(value)) return '待回填';
  if (!state.showAmounts) return MASK_AMOUNT;
  return `${signPrefix(value)}${Math.abs(safeNumber(value, 0) * 100).toFixed(1)}%`;
}

// 趋势线上的点值与累计年化行：一位小数、带符号，与定稿图的 +4.2 / −8.1 同形
function formatTrendSigned(value) {
  if (isIncomeValueMissing(value)) return '—';
  if (!state.showAmounts) return MASK_AMOUNT;
  return `${signPrefix(value)}${Math.abs(Number(value) * 100).toFixed(1)}`;
}

function getIncomeSecHead(label, aside = '') {
  return `<div class="sec-head"><span class="sec-label">${escapeHtml(label)}</span><span class="sec-aside">${aside}</span></div>`;
}

/* hero 只留一个结论（当年资金收益）+ 一个比较值（收益率），
   口径退成两行 hint；现金入口已移到「资金与交易」，本页不再有。 */
function renderIncomeOverview(model) {
  const row = model.current;
  if (!row || !row.capitalReturnAvailable) {
    /* 空态=邀请：不解释机制，直接给动作，点了进上年的回填抽屉 */
    refs.incomeOverviewGrid.innerHTML = `<section class="inc-hero">
      <span class="inc-hero-label">${model.currentYear} · 资金收益</span>
      <strong class="inc-hero-value">待回填</strong>
      <button class="inc-hero-action" type="button" data-income-manual-year="${model.currentYear - 1}">回填 ${model.currentYear - 1} 年末净值 →</button>
    </section>`;
    return;
  }
  const tone = getReturnTone(row.capitalReturnCny);
  /* 口径句（净值链/含股息汇率/记账分界）收进点按：点节标弹 methodInfo */
  refs.incomeOverviewGrid.innerHTML = `<section class="inc-hero">
      <button class="inc-hero-label" type="button" data-income-action="method">${model.currentYear} · 资金收益</button>
      <strong class="inc-hero-value ${tone}">${escapeHtml(formatIncomeSignedMoney(row.capitalReturnCny))}</strong>
      <p class="inc-hero-meta"><strong class="${getReturnTone(row.capitalReturnRate)}">${escapeHtml(formatIncomeRate(row.capitalReturnRate))}</strong></p>
    </section>
    <p class="inc-ctx">年初 ${escapeHtml(formatIncomeMoney(row.yearStartNetCny))} → 当前 ${escapeHtml(formatIncomeMoney(row.yearEndNetCny))} · 净注入 <b>${escapeHtml(formatIncomeSignedMoney(row.netInflowCny))}</b></p>`;
}

function getTrendValue(row, key) {
  const value = row && row[key];
  return isIncomeValueMissing(value) ? null : safeNumber(value, 0);
}

/* 已完结年度的资金收益率序列（升序），进行中的年份不计入。
   09 页趋势的累计年化与 11 分享卡共用这一口径，两处必须同源。 */
function getCompletedCapitalRates(rows, currentYear) {
  return rows
    .filter((row) => row.year !== currentYear)
    .map((row) => ({ year: row.year, rate: getTrendValue(row, 'capitalReturnRate') }))
    .filter((entry) => entry.rate !== null);
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
    refs.incomeTrend.innerHTML = ''; // 段落只在有话说时存在：不足两个年度整段消失
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

  /* 累计年化 = 各年资金收益率复利后折年（几何均值）。只用已完结年度：
     进行中的年份才过了几个月，按整年参与复利会把结果拉歪（半年 -9.6% 会被
     当成一整年的 -9.6%）。不足两个完整年度时「累计」无从谈起，整行不出。 */
  const capRates = getCompletedCapitalRates(rows, model.currentYear);
  let cagrLine = '';
  if (capRates.length >= 2) {
    const worst = Math.min(...capRates.map((entry) => entry.rate));
    const product = capRates.reduce((acc, entry) => acc * (1 + entry.rate), 1);
    const cumulative = product > 0 ? Math.pow(product, 1 / capRates.length) - 1 : null;
    cagrLine = `<p class="inc-trend-cagr">${capRates[0].year}–${capRates[capRates.length - 1].year} 累计年化 <strong class="${getReturnTone(cumulative)}">${escapeHtml(formatTrendSigned(cumulative))}%</strong> · 最深一年 <strong class="${getReturnTone(worst)}">${escapeHtml(formatTrendSigned(worst))}%</strong></p>`;
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


function renderIncomeYearList(model) {
  if (!model.rows.length) {
    refs.incomeYearList.innerHTML = '';
    return;
  }
  const rows = model.rows.map((row) => {
    const isCurrent = row.year === model.currentYear;
    const tag = isCurrent ? '进行中' : (row.hasManualBackfill ? '手工基准' : '自动统计');
    const pending = isCurrent && !row.capitalReturnAvailable;
    const sub = isCurrent
      ? `股息 ${formatIncomeMoney(row.dividendCny)} · 净注入 ${formatIncomeSignedMoney(row.netInflowCny)}`
      : `股息 ${formatIncomeMoney(row.dividendCny)} · 年末 ${formatIncomeMoney(row.yearEndNetCny)}`;
    /* 「待回填 待回填」双写收敛成一个动作词；进行中且已有收益时右侧不放动作 */
    const act = isCurrent
      ? (pending ? `<button class="inc-year-acts" type="button" data-income-manual-year="${row.year - 1}" aria-label="回填 ${row.year - 1} 年末净值">回填</button>` : '<span class="inc-year-acts"></span>')
      : `<button class="inc-year-acts" type="button" data-income-manual-year="${row.year}" aria-label="回填 ${row.year} 年度数据">回填</button>`;
    const yv = pending
      ? '<span class="inc-year-yv">待回填</span>'
      : `<span class="inc-year-yv ${getReturnTone(row.capitalReturnCny)}">${escapeHtml(formatIncomeSignedMoney(row.capitalReturnCny))}<em>${escapeHtml(formatIncomeRate(row.capitalReturnRate))}</em></span>`;
    return `<div class="inc-year" role="button" tabindex="0" data-annual-year="${row.year}" aria-label="查看 ${row.year} 年度回顾">
      <span class="inc-year-main">
        <span class="inc-year-yy">${row.year}<small>${tag}</small></span>
        ${yv}
      </span>
      <span class="inc-year-sub">
        <span>${escapeHtml(sub)}</span>${act}
      </span>
    </div>`;
  }).join('');
  refs.incomeYearList.innerHTML = `${getIncomeSecHead('年度明细')}
    <div class="inc-year-rows">${rows}</div>`;
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
    : `${MASK_AMOUNT} 股 @ ${MASK_AMOUNT} ${entry.currency || ''}`.trim();
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

/* 打新流水：缴款一行、每笔卖出一行，卖出行带这笔的收益。点行进对应抽屉。 */
function renderIpoFlowRow(entry) {
  const isSell = entry.kind === 'sell';
  const detail = state.showAmounts
    ? `${formatRecordQuantity(entry.shares)} 股 @ ${safeNumber(entry.price, 0)}`
    : `${MASK_AMOUNT} 股 @ ${MASK_AMOUNT}`;
  const pnl = isSell && entry.realizedPnlCny !== null
    ? ` <b class="rec-row-pnl ${getReturnTone(entry.realizedPnlCny)}">${escapeHtml(formatIncomeSignedMoney(entry.realizedPnlCny))}</b>`
    : '';
  return `<button class="rec-row" type="button" data-ipo-record="${escapeHtml(entry.roundId)}" data-ipo-sell-id="${escapeHtml(isSell ? entry.id : '')}">
      <span class="rec-row-main">${escapeHtml(getRecordDayLabel(entry.date))} <em class="${isSell ? 'is-sell' : 'is-buy'}">${isSell ? '卖出' : '缴款'}</em> <strong>${escapeHtml(entry.name)}</strong>${getRecordDetailMarkup(detail)}</span>
      <span class="rec-row-amt">${escapeHtml(formatIncomeSignedMoney(entry.cashImpactCny))}${pnl}</span>
    </button>`;
}

function renderDividendFlowRow(entry) {
  return `<button class="rec-row" type="button" data-dividend-source-id="${escapeHtml(entry.sourceId)}">
      <span class="rec-row-main">${escapeHtml(getRecordDayLabel(entry.date))} <strong>${escapeHtml(entry.name || entry.symbol)}</strong>${getRecordDetailMarkup(entry.note)}</span>
      <span class="rec-row-amt">${escapeHtml(formatIncomeSignedMoney(entry.amountCny))}</span>
    </button>`;
}

/* 一段流水：节标 + 右笔数 + 默认 3 行 + 展开键。
   折叠只是渲染层状态（mutable），不写进快照，也不参与云同步。 */
function renderRecordFlow(key, label, aside, records, emptyText, rowMarkup) {
  if (!records.length) return ''; // 段落随数据出生：0 笔时整段不存在
  const expanded = mutable.recordsExpanded[key] === true;
  const shown = expanded ? records : records.slice(0, RECORD_FOLD_LIMIT);
  const body = `<div class="rec-rows">${shown.map(rowMarkup).join('')}</div>`;
  const more = records.length > RECORD_FOLD_LIMIT
    ? `<button class="rec-more" type="button" data-records-expand="${key}">${expanded ? '收 起' : `展开全部 ${records.length} 笔`}</button>`
    : '';
  return `<section class="rec-flow rec-flow--${key}">
      <div class="sec-head"><span class="sec-label">${escapeHtml(label)}</span><span class="sec-aside">${aside}</span></div>
      ${body}${more}
    </section>`;
}

// 现金余额：hero 下降为一行随注，点击开 openingCash 校准；未设置时只留一个金色动作
function renderRecordsCash() {
  const active = isCashModelActive();
  if (!active) {
    return `<button class="rec-cash rec-cash--setup" type="button" data-records-action="calibrate-cash">校准现金余额 →</button>`;
  }
  const asOf = String(state.currentCashAsOfDate || '');
  const asOfPart = asOf.length >= 10 ? ` · 基准日 ${escapeHtml(`${asOf.slice(5, 7)}-${asOf.slice(8, 10)}`)}` : '';
  return `<button class="rec-cash" type="button" data-records-action="calibrate-cash">现金 <strong>${escapeHtml(formatDisplayMoney(computeCashBalance(), 'CNY'))}</strong>${asOfPart} · <b>校准 ›</b></button>`;
}

export function renderIncomeRecords() {
  if (!refs.incomeRecordsList) return;
  const year = new Date().getFullYear();
  const cash = computeCashFlowRecords(year);
  const dividends = computeDividendRecords(year);
  const trades = computeTradeSummary(year);
  const ipo = computeIpoRecords(year);
  /* 零值子句不上屏：hero 已写净注入，随注只挑有话说的部分 */
  const metaParts = [];
  if (cash.depositCny > 0) metaParts.push(`入金 ${escapeHtml(formatDisplayMoney(cash.depositCny, 'CNY'))}`);
  if (cash.withdrawalCny > 0) metaParts.push(`出金 ${escapeHtml(formatDisplayMoney(cash.withdrawalCny, 'CNY'))}`);
  if (cash.count > 0) metaParts.push(`${cash.count} 笔`);
  refs.incomeRecordsList.innerHTML = `<section class="rec-hero">
      <span class="rec-hero-label">${year} · 净注入</span>
      <strong class="rec-hero-value">${escapeHtml(formatIncomeSignedMoney(cash.netInflowCny))}</strong>
      ${metaParts.length ? `<p class="rec-hero-meta">${metaParts.join(' · ')}</p>` : ''}
    </section>
    ${renderRecordsCash()}
    ${renderRecordFlow('trade', '买卖流水', `${trades.count} 笔`, trades.records, '', renderTradeFlowRow)}
    ${renderRecordFlow('ipo', '打新', `${ipo.count} 笔 · ${escapeHtml(formatIncomeSignedMoney(ipo.realizedPnlCny))}`, ipo.records, '', renderIpoFlowRow)}
    ${renderRecordFlow('cash', '出入金流水', `${cash.count} 笔 · ${escapeHtml(formatIncomeSignedMoney(cash.netInflowCny))}`, cash.records, '', renderCashFlowRow)}
    ${renderRecordFlow('dividend', '股息入账', `${dividends.count} 笔 · ${escapeHtml(formatDisplayMoney(dividends.totalCny, 'CNY'))}`, dividends.records, '', renderDividendFlowRow)}`;
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
  if (!state.showAmounts) return MASK_AMOUNT; // 与收益明细同规：掩码盖到收益率
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return `${signPrefix(value)}${Math.abs(Number(value) * 100).toFixed(1)}%`;
}

function formatAnnualSignedMoney(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  if (!state.showAmounts) return MASK_AMOUNT;
  return `${signPrefix(value)}${formatMoney(Math.abs(Number(value)), 'CNY')}`;
}

function formatAnnualShares(value) {
  return safeNumber(value, 0).toLocaleString('en-US', { maximumFractionDigits: 6 });
}

function getAnnualSecHead(label, aside = '') {
  return `<div class="sec-head"><span class="sec-label">${escapeHtml(label)}</span><span class="sec-aside">${aside}</span></div>`;
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

/* 只留对读数有影响的事实（对比哪一年、清了哪些仓）。
   「当年快照随行情更新，跨年自动冻结」是实现细节，读者不需要知道。 */
function getAnnualHoldingsNote(holdings) {
  const head = [];
  if (holdings.previousYear) head.push(`增减仓对比 ${holdings.previousYear} 年`);
  if (holdings.removed.length) {
    head.push(`已清仓：${holdings.removed.map((item) => `${item.name} ${formatAnnualShares(item.shares)} 股`).join(' · ')}`);
  }
  return head.length ? `<p class="ann-hold-note">${escapeHtml(head.join(' · '))}</p>` : '';
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
  // 有逐笔台账数据的年份才做成入口（2026 记账起点之前只有年度手工基准，点进去是空的）
  const dividendsLinkable = annals.dividendMonths.some((value) => safeNumber(value, 0) > 0);
  // 打新收益：只聚合标了「打新」的卖出；该年没有打新卖出时显示「—」而不是 +¥0。
  const annualIpoPnl = annals.hasIpoSells ? annals.ipoRealizedPnlCny : null;
  // 卖出行在成交额后亮已实现盈亏；成本不完整（含期初基准股）时不显示，维持成交额单值。
  const tradeRows = annals.trades.length
    ? annals.trades.slice().reverse().map((trade) => {
        const showPnl = trade.side === 'sell' && trade.realizedPnlComplete && trade.realizedPnlCny !== null;
        const pnlHtml = showPnl ? ` <b class="ann-trade-pnl ${getReturnTone(trade.realizedPnlCny)}">${escapeHtml(formatAnnualSignedMoney(trade.realizedPnlCny))}</b>` : '';
        return `<div class="ann-trade-row">
        <span>${escapeHtml(trade.date.slice(5).replace('-', '/'))} <em class="${trade.side === 'sell' ? 'is-sell' : 'is-buy'}">${trade.side === 'sell' ? '卖出' : '买入'}</em> <strong>${escapeHtml(trade.name)}</strong></span>
        <span>${escapeHtml(formatDisplayMoney(trade.valueCny, 'CNY'))}${pnlHtml}</span>
      </div>`;
      }).join('')
    : '<p class="ann-empty-line">该年暂无交易记录</p>';
  const scopeText = annals.isCurrentYear
    ? `截至 ${annals.today.slice(0, 7).replace('-', '/')}`
    : '完整年度';

  refs.annualReviewContent.innerHTML = `
    <nav class="ann-years" aria-label="选择年度">${years.map((year) => `<button type="button" data-annual-select="${year}" class="${year === state.activeAnnualYear ? 'is-active' : ''}" aria-pressed="${year === state.activeAnnualYear}">${year}<i aria-hidden="true"></i></button>`).join('')}</nav>
    <section class="ann-hero">
      <span class="ann-hero-label">本年收益率</span>
      <strong class="ann-hero-value ${getReturnTone(annals.returnRate)}">${escapeHtml(formatAnnualRate(annals.returnRate))}</strong>
      <p class="ann-hero-sub ${getReturnTone(row.capitalReturnCny)}">${escapeHtml(formatAnnualSignedMoney(row.capitalReturnCny))}</p>
      <p class="ann-hero-meta">${escapeHtml(scopeText)} · 年初 ${escapeHtml(formatIncomeMoney(row.yearStartNetCny))} → ${annals.isCurrentYear ? '当前' : '年末'} ${escapeHtml(formatIncomeMoney(row.yearEndNetCny))}</p>
    </section>
    <div class="ann-metrics">
      <span>股息收入<strong>${escapeHtml(formatIncomeMoney(row.dividendCny))}</strong></span>
      <span>净注入<strong>${escapeHtml(formatAnnualSignedMoney(row.netInflowCny))}</strong></span>
      <span>当年交易<strong>${annals.trades.length} 笔</strong></span>
      <span>打新收益<strong class="${getReturnTone(annualIpoPnl)}">${escapeHtml(formatAnnualSignedMoney(annualIpoPnl))}</strong></span>
    </div>
    ${attrItems ? `
    <section class="ann-block">
      ${getAnnualSecHead('收益归因', attrItems ? `合计 ${escapeHtml(formatAnnualRate(annals.returnRate))} · ${escapeHtml(formatAnnualSignedMoney(row.capitalReturnCny))}` : '')}
      <div class="ann-attr-bar">${attrBar}</div><div class="ann-attr-rows">${attrRows}</div>${coverageNote}
    </section>` : ''}
    <section class="ann-block">
      ${getAnnualSecHead('年度持仓', annals.holdings.hasData ? `${annals.holdings.count} 项 · ${escapeHtml(formatDisplayMoney(annals.holdings.total, 'CNY'))}` : '')}
      ${annals.holdings.hasData
        ? `${getAnnualDonutMarkup(annals.holdings)}${getAnnualHoldingsNote(annals.holdings)}`
        : '<p class="ann-empty-line">该年暂无持仓快照</p>'}
    </section>
    <section class="ann-block${dividendsLinkable ? ' ann-block--link' : ''}"${dividendsLinkable ? ` data-annual-dividends="${annals.year}" role="button" tabindex="0" aria-label="查看 ${annals.year} 年股息日历"` : ''}>
      ${getAnnualSecHead('当年股息现金流', `${annals.isCurrentYear ? '已确认' : '全年确认'} ${escapeHtml(formatIncomeMoney(row.dividendCny))}${dividendsLinkable ? ' →' : ''}`)}
      <div class="ann-months">${annals.dividendMonths.map((value, index) => `<span class="${index === currentMonth ? 'is-current' : ''}"><i style="--v:${Math.max(2, safeNumber(value, 0) / maxDividend * 100).toFixed(1)}%"></i><small>${ANNUAL_MONTH_LABELS[index]}</small></span>`).join('')}</div>
    </section>
    <section class="ann-block">
      ${getAnnualSecHead('交易复盘', annals.trades.length ? `${annals.trades.length} 笔` : '')}
      <div class="ann-trades">${tradeRows}</div>
    </section>`;
}

/* ── 11-分享卡 · 按 designs/禅意UI/11-分享卡/定稿图.html ──
   硬约束：全卡只有比例与收益率，禁止出现 ¥ 与任何绝对金额；
   固定素禅日间配色导出，不随夜间模式变色。 */
const SHARE_DONUT_COLORS = ['#c9a558', '#dcc492', '#b3a68c', '#cfc4ad', '#e2d9c4', '#efe9da'];

function formatSharePercent(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return `${signPrefix(value)}${Math.abs(Number(value) * 100).toFixed(1)}%`;
}

function formatSharePlainPercent(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return `${(Number(value) * 100).toFixed(1)}%`;
}

/* 累计年化：与 09 页趋势同一口径（已完结年度的资金收益率复利折年）。
   进行中的年份不参与，不足两个完整年度时不给这个数。 */
function getCumulativeAnnualized(model) {
  const entries = getCompletedCapitalRates(model.trendRows, model.currentYear);
  if (entries.length < 2) return { rate: null, startYear: null, endYear: null };
  const product = entries.reduce((acc, entry) => acc * (1 + entry.rate), 1);
  return {
    rate: product > 0 ? Math.pow(product, 1 / entries.length) - 1 : null,
    startYear: entries[0].year,
    endYear: entries[entries.length - 1].year
  };
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
    : '';
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
    : ` · ${share.cumulative.startYear}–${share.cumulative.endYear} 累计年化 ${formatSharePercent(share.cumulative.rate)}`;
  return `<div class="zen-share-card">
      <span class="sc-brand">Bebop Ledger · ${share.year}</span>
      <span class="sc-label">本年收益率</span>
      <strong class="sc-value ${getReturnTone(share.returnRate)}">${escapeHtml(formatSharePercent(share.returnRate))}</strong>
      <p class="sc-meta">股息收益率 ${escapeHtml(formatSharePlainPercent(share.dividendYieldRate))}${escapeHtml(cumulativeText)}</p>
      ${share.attrItems.length ? `<div class="sc-bar">${bar}</div>` : ''}
      ${splitText ? `<p class="sc-attr">${escapeHtml(splitText)}</p>` : ''}
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
    : ` · ${share.cumulative.startYear}–${share.cumulative.endYear} 累计年化 ${formatSharePercent(share.cumulative.rate)}`;
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
  computeDividendCalendar(new Date(), 'all').allDetails.forEach((entry) => {
    if (entry && live.has(entry.status)) symbols.add(entry.symbol);
  });
  return symbols;
}

/* 行随排序换装：右列主数 = 当前排序键的值，金色（金=选中记号的既有语义） */
function getSortKeyText(item) {
  if (state.sortField === 'effectiveYield') return formatZenPercent(item.effectiveYield);
  if (state.sortField === 'netAnnualDividendCny') return formatZenMoney(item.netAnnualDividendCny);
  return formatZenMoney(item.marketValueCny);
}

function getHoldingViewModel(item, index = 0, opts = {}) {
  const tooltipLines = buildDividendTooltipLines(item);
  const statusKey = normalizeDividendStatus(item.dividendStatus, 'missing');
  return {
    priceText: state.showAmounts ? formatPlainPrice(item.price) : MASK_AMOUNT,
    marketValueText: formatZenMoney(item.marketValueCny),
    sortKeyText: getSortKeyText(item),
    annualDividendText: formatZenMoney(item.netAnnualDividendCny),
    quantityText: state.showAmounts ? String(item.quantity) : MASK_AMOUNT,
    // 占比按自有资金（净资产）计，融资时合计会超 100%——超出即杠杆
    weightText: formatZenPercent(item.netAssetWeight !== null ? item.netAssetWeight : item.holdingWeight),
    yieldText: formatZenPercent(item.effectiveYield),
    statusKey, statusLabel: getDividendStatusLabel(statusKey), tooltipLines,
    tooltipHtml: buildDividendTooltipHtml(tooltipLines),
    /* 逐股行统一用中性的「年化」：短，且未设税率时不会声称税后。
       税后与否是页级信息，由分仓小结行的「税后年化/年化股息」披露。 */
    annualDividendLabel: '年化',
    hasDividendEvent: Boolean(opts.pendingDividends && opts.pendingDividends.has(item.symbol)),
    staggerDelay: Math.min(index * HOLDING_ENTER_STAGGER_MS, HOLDING_ENTER_STAGGER_MAX_MS)
  };
}

/* 单行逐股：名称（+金点）｜排序键值（金）+ 占比。代码与现价/年化/股息率
   的编辑入口都在持仓详情抽屉（点名称）——03 裁决：行从 5 个数据点减到 2 个。 */
function getHoldingMarkup(item, index, opts = {}) {
  const { animate = true } = opts, v = getHoldingViewModel(item, index, opts);
  return `<div class="holding-swipe${animate ? ' is-entering' : ''}" data-id="${item.localId}" style="--holding-swipe-offset:0px;animation-delay:${v.staggerDelay}ms;">
    <article class="holding-card stock" data-id="${item.localId}" data-dividend-status="${escapeHtml(item.dividendStatus || 'missing')}">
      <div class="stock-main">
        <span class="stock-name"><button class="stock-name-button" type="button" data-action="view-holding" aria-label="查看 ${escapeHtml(item.name)} 持仓详情">${escapeHtml(item.name)}</button>${v.hasDividendEvent ? '<i class="divi-dot" title="有在途或已公告股息"></i>' : ''}<span class="stock-price">现价 ${escapeHtml(v.priceText)}</span></span>
        <span class="stock-side"><b class="stock-mv stock-side-key">${escapeHtml(v.sortKeyText)}</b><span class="weight">${escapeHtml(v.weightText)}</span></span>
      </div>
    </article></div>`;
}

/* 打新在途：钱已经出去、还没变成持仓，按成本挂在列表末尾。
   没有在途轮时整段不存在（非默认态才标记）。 */
function getIpoInTransitMarkup() {
  const model = computeIpoRounds();
  if (!model.openRounds.length) return '';
  /* 股数 × 成本能把右列已掩码的金额反推出来，掩码开启时这一行要一起掩上
     （与买卖流水行、持仓详情「当前持股」同一套口径） */
  const rows = model.openRounds.map((round) => `<button class="holding-card stock ipo-card" type="button" data-ipo-open="${escapeHtml(round.id)}">
      <div class="stock-main">
        <span class="stock-name">${escapeHtml(round.name)}<span class="stock-price">${state.showAmounts
          ? `${escapeHtml(String(round.remainingShares))} 股 · 成本 ${escapeHtml(formatPlainPrice(round.costPerShare))}`
          : `${MASK_AMOUNT} 股 · 成本 ${MASK_AMOUNT}`}</span></span>
        <span class="stock-side"><b class="stock-mv stock-side-key">${escapeHtml(formatZenMoney(round.remainingCostCny))}</b><span class="weight">在途</span></span>
      </div>
    </button>`).join('');
  return `<div class="sec-head is-later"><span class="sec-label">打新在途</span><span class="sec-aside">${escapeHtml(formatZenMoney(model.inTransitCostCny))} · ${model.openRounds.length} 轮</span></div>${rows}`;
}

/* 列表按仓分段：hero 宣告「钱分两种」，列表就得长成那个样子（2026-08 裁决）。
   折叠仍按总数截断（首屏要短），节标报的是该段全部项数与市值，不受折叠影响。 */
export function renderHoldingsView(holdings, opts = {}) {
  mutable.activeDividendTooltipButton = null;
  const ipoMarkup = getIpoInTransitMarkup();
  /* 只列还持有的：清仓股的行留在 state 里锚交易与股息历史（启动清扫刻意不收），
     但不再占版面，与财报日历/收益结算/基本面的 quantity > 0 口径一致。 */
  const held = holdings.filter((item) => safeNumber(item.quantity, 0) > 0);
  if (!held.length) {
    refs.stockList.innerHTML = ipoMarkup;
    refs.legendToggle.hidden = true;
    return;
  }
  const pendingDividends = getPendingDividendSymbols();
  const visible = state.legendExpanded ? held : held.slice(0, LEGEND_COLLAPSED_COUNT);
  const bucketOf = (item) => (item.bucket === 'income' ? 'income' : 'core');
  let index = 0;
  const sections = [{ key: 'core', label: LABELS.core }, { key: 'income', label: LABELS.income }]
    .map((group, groupIndex) => {
      const all = held.filter((item) => bucketOf(item) === group.key);
      if (!all.length) return '';
      const shown = visible.filter((item) => bucketOf(item) === group.key);
      const totalCny = all.reduce((sum, item) => sum + safeNumber(item.marketValueCny, 0), 0);
      const head = `<div class="sec-head${groupIndex > 0 ? ' is-later' : ''}" data-bucket-head="${group.key}"><span class="sec-label">${escapeHtml(group.label)}</span><span class="sec-aside">${escapeHtml(formatZenMoney(totalCny))} · ${all.length} 项</span></div>`;
      const rows = shown.map((item) => getHoldingMarkup(item, index++, { ...opts, pendingDividends })).join('');
      return head + rows;
    }).join('');
  refs.stockList.innerHTML = sections + ipoMarkup;
  refs.legendToggle.hidden = held.length <= LEGEND_COLLAPSED_COUNT;
  refs.legendToggle.textContent = state.legendExpanded ? '收起' : `展开全部 ${held.length} 项`;
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
function renderDashboardIncrementally(summary, bs, opts = {}) {
  renderHomePage(summary);
  renderHoldingsHero(summary);
  patchBucketsView(bs, summary.holdings, summary);
  renderDiagnosticsButton();
  renderSortControl(); renderTimestamp(); renderPrivacyButton();
  renderIncomeSummaryPage();
  renderAnnualReviewPage();
  renderIncomeRecords();
  renderDividendCalendarPage();
  renderFundamentalsPage();
  syncRenderedHoldingsView(summary.holdings, { animateReflow: opts.animateHoldingReflow });
}

export function renderSavedStateQuietly(opts = {}) {
  renderApp({ incremental: true, animateHoldingReflow: opts.animateHoldingReflow !== false });
}

export function renderApp(opts = {}) {
  const { animateBucketDetail = true, animateHoldings = true, renderHoldingsList = true, incremental = false, animateHoldingReflow = false } = opts;
  const summary = computeHoldings();
  const bs = getBucketSegments(summary.holdings);
  renderPageChrome();
  if (incremental) { renderDashboardIncrementally(summary, bs, { animateHoldingReflow }); return; }
  renderHomePage(summary);
  renderHoldingsHero(summary);
  renderBucketsView(bs, summary.holdings, summary, { animateDetail: animateBucketDetail });
  renderDiagnosticsButton();
  renderSortControl(); renderTimestamp(); renderPrivacyButton();
  renderIncomeSummaryPage();
  renderAnnualReviewPage();
  renderIncomeRecords();
  renderDividendCalendarPage();
  renderFundamentalsPage();
  if (renderHoldingsList) renderHoldingsView(summary.holdings, { animate: animateHoldings });
  else syncRenderedHoldingsView(summary.holdings, { animateReflow: false });
}

/* 排序抽屉的落点：点当前字段翻转升降，点其他字段按该字段降序重排。
   旧版单按钮 6 态循环已废——从「按市值 ↓」走到「按年股息 ↑」要点五次。 */
export function applyHoldingSortSelection(field) {
  if (!HOLDING_SORT_FIELDS.includes(field)) return;
  if (state.sortField === field) {
    state.sortDirection = state.sortDirection === 'desc' ? 'asc' : 'desc';
  } else {
    state.sortField = field;
    state.sortDirection = 'desc';
  }
  closeActiveDividendTooltip(true);
  const opened = refs.stockList.querySelector('.holding-swipe.is-swipe-open');
  if (opened) closeHoldingSwipe(opened);
  saveState(); renderSortControl();
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
