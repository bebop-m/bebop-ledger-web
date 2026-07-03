import { state, refs, mutable, saveState } from './state.js';
import {
  computeHoldings, getCompanySegments, getBucketSegments, getBucketSummaryItems,
  computeDividendCalendar, computeIncomeSummary,
  computeCashFlowRecords, computeTradeSummary, isCashModelActive
} from './compute.js';
import {
  safeNumber, escapeHtml, formatMoney, formatPlainPrice, formatPercent, formatDailyPnl,
  formatTimestamp, normalizeDividendStatus, getDividendStatusLabel,
  buildDividendTooltipLines, buildDividendTooltipHtml, createElementFromHtml,
  markCurrencyAmountElements
} from './utils.js';
import {
  MASK_AMOUNT, MASK_PRICE, LABELS, UI_TEXT,
  LEGEND_COLLAPSED_COUNT, LEGEND_TOGGLE_ANIMATION_MS, LEGEND_ENTER_STAGGER_MS,
  HOLDING_ENTER_STAGGER_MS, HOLDING_ENTER_STAGGER_MAX_MS, TOOLTIP_FALLBACK_WIDTH,
  TOOLTIP_GAP, BUCKET_CHIP_COMPACT_THRESHOLD, HOLDING_REMOVAL_FALLBACK_MS,
  HOLDING_SWIPE_DELETE_WIDTH, HOLDING_SWIPE_OPEN_THRESHOLD
} from './constants.js';

/* ── Format helpers that depend on state ── */
export function formatDisplayMoney(value, currency = 'CNY') {
  return state.showAmounts ? formatMoney(value, currency) : MASK_AMOUNT;
}

function getHoldingTitleDivider() { return '\u00b7'; }

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
  renderHomeMetrics(calendarModel, incomeModel);
  renderHomeNavSummaries(summary, calendarModel, incomeModel, bucketItems, totalMv);
}

function renderHomeHero(summary) {
  const pnl = safeNumber(summary.totalDailyPnlCny, 0);
  const hasPnl = summary.holdings.some((h) => safeNumber(h.previousClose, 0) > 0);
  const pnlText = hasPnl && state.showAmounts ? formatDailyPnl(pnl, summary.totalMarketValueCny) : '';
  const pnlArrow = pnl > 0 ? '\u25b2' : pnl < 0 ? '\u25bc' : '';
  refs.homeHero.innerHTML = `
    <div class="home-hero-label-row">
      <span class="home-hero-label">总资产</span>
      <button class="ghost-minus" type="button" data-summary-action="liability" aria-label="${LABELS.liability}">-</button>
    </div>
    <strong class="home-hero-value">${escapeHtml(formatDisplayMoney(summary.netMarketValueCny, 'CNY'))}</strong>
    ${pnlText ? `<span class="home-hero-pnl"><strong class="${getReturnTone(pnl)}">${pnlArrow} ${escapeHtml(pnlText)}</strong> <span>\u4eca\u65e5</span></span>` : ''}
    <span class="home-hero-fx">USD/CNY ${safeNumber(state.rates.USD, 0).toFixed(2)} \u00b7 HKD/CNY ${safeNumber(state.rates.HKD, 0).toFixed(4)}</span>`;
}

// \u9996\u9875\u53cc\u6307\u6807\uff1a\u4e24\u683c\u5171\u7528\u540c\u4e00 4 \u884c\u7f51\u683c\u9aa8\u67b6\uff08\u6807\u7b7e/\u6570\u5b57/\u8fdb\u5ea6/\u526f\u884c\uff09\uff0c\u4fdd\u8bc1\u5de6\u53f3\u57fa\u7ebf\u4e25\u683c\u5e73\u884c\u3002
function renderHomeMetrics(calendarModel, incomeModel) {
  const m = calendarModel.metrics;
  const received = safeNumber(m.receivedCny, 0);
  const projected = safeNumber(m.projectedCny, 0);
  const ratio = projected > 0 ? Math.min(1, Math.max(0, received / projected)) : 0;
  const cur = incomeModel.current;
  const hasCapital = Boolean(cur && cur.capitalReturnAvailable);
  const capitalCell = hasCapital
    ? `<div class="home-metric">
        <span class="hm-label">\u4eca\u5e74\u8d44\u91d1\u6536\u76ca</span>
        <strong class="hm-value income-amount ${getReturnTone(cur.capitalReturnCny)}">${escapeHtml(formatIncomeSignedMoney(cur.capitalReturnCny))}</strong>
        <span class="hm-bar is-blank"></span>
        <span class="hm-sub">\u6536\u76ca\u7387 <strong class="${getReturnTone(cur.capitalReturnRate)}">${escapeHtml(formatIncomeRate(cur.capitalReturnRate))}</strong></span>
      </div>`
    : `<div class="home-metric">
        <span class="hm-label">\u4eca\u5e74\u8d44\u91d1\u6536\u76ca</span>
        <strong class="hm-value is-empty">\u5f85\u56de\u586b</strong>
        <span class="hm-bar is-blank"></span>
        <span class="hm-sub">\u7f3a ${incomeModel.currentYear - 1} \u5e74\u672b\u51c0\u503c</span>
      </div>`;
  refs.homeFocusCard.innerHTML = `
    ${capitalCell}
    <div class="home-metric-divider" aria-hidden="true"></div>
    <div class="home-metric">
      <span class="hm-label">\u80a1\u606f \u00b7 \u5df2\u5230\u8d26 ${Math.round(ratio * 100)}%</span>
      <strong class="hm-value">${escapeHtml(formatDisplayMoney(received, 'CNY'))}</strong>
      <span class="hm-bar"><i style="width:${(ratio * 100).toFixed(1)}%"></i></span>
      <span class="hm-sub">\u9884\u8ba1\u5168\u5e74 ${escapeHtml(formatDisplayMoney(projected, 'CNY'))}</span>
    </div>`;
}

function renderHomeNavSummaries(summary, calendarModel, incomeModel, bucketItems, totalMv) {
  const cash = computeCashFlowRecords();
  const trades = computeTradeSummary();
  const monthItem = calendarModel.months[new Date().getMonth()] || null;
  const coreItem = bucketItems.find((item) => item.key === 'core');
  const cur = incomeModel.current;
  const summaries = {
    holdings: `${summary.holdings.length} \u9879${coreItem ? ` \u00b7 ${LABELS.core} ${((coreItem.marketValueCny / totalMv) * 100).toFixed(1)}%` : ''}`,
    dividends: monthItem ? `${monthItem.label}\u5728\u9014 ${formatDisplayMoney(monthItem.upcomingCny, 'CNY')}` : '',
    income: cur && cur.capitalReturnAvailable ? `\u5f53\u5e74 ${formatIncomeSignedMoney(cur.capitalReturnCny)}` : '\u5386\u5e74\u8d8b\u52bf \u00b7 \u5e74\u5ea6\u8868',
    records: `${cash.count} \u51fa\u5165\u91d1 \u00b7 ${trades.count} \u4ea4\u6613`
  };
  refs.homeNavList.querySelectorAll('[data-nav-summary]').forEach((el) => {
    el.textContent = summaries[el.dataset.navSummary] || '';
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
  const segments = getCompanySegments(computeHoldings().holdings);
  const v = getLegendViewModel(segments);
  const visible = state.legendExpanded ? segments : segments.slice(0, v.collapsedCount);
  refs.companyLegend.innerHTML = visible.map((s, i) => getLegendRowMarkup(s, s.value / v.total, i, { animate: false })).join('');
  refs.legendToggle.hidden = !v.canToggleLegend;
  refs.legendToggle.textContent = state.legendExpanded ? LABELS.collapseLegend
    : `${LABELS.expandLegend} ${segments.length} ${LABELS.itemsUnit}`;
  if (preserveScroll) keepLegendToggleStable(toggleTop);
}

export function renderLegendView(segments, opts = {}) {
  const { animate = true } = opts;
  const v = getLegendViewModel(segments);
  const visible = state.legendExpanded ? segments : segments.slice(0, v.collapsedCount);
  refs.companyLegend.innerHTML = visible.map((s, i) => getLegendRowMarkup(s, s.value / v.total, i, { animate })).join('');
  refs.legendToggle.hidden = !v.canToggleLegend;
  if (v.canToggleLegend) refs.legendToggle.textContent = state.legendExpanded ? LABELS.collapseLegend : `${LABELS.expandLegend} ${segments.length} ${LABELS.itemsUnit}`;
}

export function patchLegendView(segments) {
  if (!segments.length) { refs.companyLegend.innerHTML = ''; refs.legendToggle.hidden = true; return; }
  const v = getLegendViewModel(segments);
  const visible = state.legendExpanded ? segments : segments.slice(0, v.collapsedCount);
  const rows = Array.from(refs.companyLegend.querySelectorAll('.legend-row'));
  const keyedRows = new Map(rows.filter((r) => r.dataset.legendKey).map((r) => [r.dataset.legendKey, r]));
  if (rows.length && keyedRows.size !== rows.length) { renderLegendView(segments, { animate: false }); return; }
  const nextKeys = visible.map((s, i) => getLegendSegmentKey(s, i));
  const reorder = rows.length !== nextKeys.length || rows.some((r, i) => r.dataset.legendKey !== nextKeys[i]);
  let fallback = false;
  visible.forEach((seg, i) => {
    if (fallback) return;
    let row = keyedRows.get(nextKeys[i]);
    if (!row) row = createElementFromHtml(getLegendRowMarkup(seg, seg.value / v.total, i, { animate: false }));
    if (!row || !syncLegendRow(row, seg, seg.value / v.total, i)) { fallback = true; return; }
    if (reorder || !row.isConnected) refs.companyLegend.appendChild(row);
  });
  if (fallback) { renderLegendView(segments, { animate: false }); return; }
  keyedRows.forEach((row, key) => { if (!nextKeys.includes(key)) row.remove(); });
  refs.legendToggle.hidden = !v.canToggleLegend;
}

/* ── Buckets ── */
function getBucketLabelText(l) { return String(l || '').replace(/[：:]\s*$/, ''); }

function getBucketViewModel(segments, holdings, summary) {
  const total = segments.reduce((s, i) => s + safeNumber(i.value, 0), 0);
  const items = getBucketSummaryItems(holdings);
  if (state.activeBucketKey && !items.some((i) => i.key === state.activeBucketKey)) state.activeBucketKey = null;
  return { totalMarketValue: total, bucketItems: items, activeItem: items.find((i) => i.key === state.activeBucketKey) || null, overallNetYield: total > 0 ? summary.totalDividendCny / total : 0 };
}

function getBucketChipMarkup(item, total) {
  const share = item.marketValueCny / (total || 1);
  const isActive = state.activeBucketKey === item.key;
  return `<button class="bucket-chip is-${item.key}${isActive ? ' is-active' : ''}${share < BUCKET_CHIP_COMPACT_THRESHOLD ? ' is-compact' : ''}" type="button" data-bucket-toggle="${item.key}" style="--bucket-share:${share.toFixed(4)};" aria-expanded="${isActive}"><span class="bucket-chip-label">${escapeHtml(item.label)}</span><span class="bucket-chip-value">${(share * 100).toFixed(1)}%</span></button>`;
}

function syncBucketChip(btn, item, total) {
  const l = btn.querySelector('.bucket-chip-label'), v = btn.querySelector('.bucket-chip-value');
  if (!l || !v) return false;
  const share = item.marketValueCny / (total || 1);
  const isActive = state.activeBucketKey === item.key;
  btn.className = `bucket-chip is-${item.key}${isActive ? ' is-active' : ''}${share < BUCKET_CHIP_COMPACT_THRESHOLD ? ' is-compact' : ''}`;
  btn.dataset.bucketToggle = item.key; btn.style.setProperty('--bucket-share', share.toFixed(4));
  btn.setAttribute('aria-expanded', isActive ? 'true' : 'false'); l.textContent = item.label; v.textContent = `${(share * 100).toFixed(1)}%`;
  return true;
}

function getBucketDetailMarkup(activeItem, opts = {}) {
  if (!activeItem) return '';
  const { animateDetail = true } = opts;
  return `<div class="bucket-detail-card${animateDetail ? ' is-entering' : ''}">
    <div class="bucket-detail-row"><span class="bucket-detail-label">${getBucketLabelText(LABELS.marketValue)}</span><span class="bucket-detail-value" data-bucket-field="marketValue">${formatDisplayMoney(activeItem.marketValueCny, 'CNY')}</span></div>
    <div class="bucket-detail-row"><span class="bucket-detail-label">${getBucketLabelText(LABELS.annualDividend)}</span><span class="bucket-detail-value is-income" data-bucket-field="annualDividend">${formatDisplayMoney(activeItem.totalDividendCny, 'CNY')}</span></div>
    <div class="bucket-detail-row"><span class="bucket-detail-label">${getBucketLabelText(LABELS.dividendYield)}</span><span class="bucket-detail-value" data-bucket-field="averageYield">${formatPercent(activeItem.averageYield)}</span></div></div>`;
}

function syncBucketDetail(card, item) {
  const mv = card.querySelector('[data-bucket-field="marketValue"]'), ad = card.querySelector('[data-bucket-field="annualDividend"]'), ay = card.querySelector('[data-bucket-field="averageYield"]');
  if (!mv || !ad || !ay) return false;
  card.className = 'bucket-detail-card'; mv.textContent = formatDisplayMoney(item.marketValueCny, 'CNY');
  ad.textContent = formatDisplayMoney(item.totalDividendCny, 'CNY'); ay.textContent = formatPercent(item.averageYield);
  return true;
}

export function renderBucketsView(segments, holdings, summary, opts = {}) {
  refs.bucketTrack.classList.add('bucket-track--summary-v2');
  const v = getBucketViewModel(segments, holdings, summary);
  refs.bucketTrack.innerHTML = `<div class="bucket-summary-v2"><div class="bucket-chip-row">${v.bucketItems.map((i) => getBucketChipMarkup(i, v.totalMarketValue)).join('')}</div>${getBucketDetailMarkup(v.activeItem, opts)}</div>`;
}

export function patchBucketsView(segments, holdings, summary) {
  refs.bucketTrack.classList.add('bucket-track--summary-v2');
  const root = refs.bucketTrack.querySelector('.bucket-summary-v2'), chipRow = refs.bucketTrack.querySelector('.bucket-chip-row');
  if (!root || !chipRow) { renderBucketsView(segments, holdings, summary, { animateDetail: false }); return; }
  const v = getBucketViewModel(segments, holdings, summary);
  const btns = new Map(Array.from(chipRow.querySelectorAll('.bucket-chip[data-bucket-toggle]')).map((b) => [b.dataset.bucketToggle, b]));
  let fb = false;
  v.bucketItems.forEach((item) => { if (fb) return; let b = btns.get(item.key); if (!b) b = createElementFromHtml(getBucketChipMarkup(item, v.totalMarketValue)); if (!b || !syncBucketChip(b, item, v.totalMarketValue)) { fb = true; return; } chipRow.appendChild(b); });
  if (fb) { renderBucketsView(segments, holdings, summary, { animateDetail: false }); return; }
  btns.forEach((b, k) => { if (!v.bucketItems.some((i) => i.key === k)) b.remove(); });
  let dc = root.querySelector('.bucket-detail-card');
  const oy = root.querySelector('[data-bucket-field="overallYield"]'); if (oy) oy.remove();
  if (!v.activeItem) { if (dc) dc.remove(); return; }
  if (!dc) dc = createElementFromHtml(getBucketDetailMarkup(v.activeItem, { animateDetail: false }));
  if (!dc || !syncBucketDetail(dc, v.activeItem)) { renderBucketsView(segments, holdings, summary, { animateDetail: false }); return; }
  root.appendChild(dc);
}

/* ── Sort Chips ── */
export function getSortFieldLabel(field) {
  if (field === 'effectiveYield') return LABELS.sortDividendYield;
  if (field === 'netAnnualDividendCny') return LABELS.sortDividendAmount;
  return LABELS.sortMarketValue;
}

export function renderSortChips() {
  const lh = refs.sortGroup ? refs.sortGroup.closest('.panel-bar--list') : null;
  if (refs.sortGroup) { refs.sortGroup.classList.add('sort-group--subtle'); refs.sortGroup.dataset.open = state.sortMenuOpen ? 'true' : 'false'; refs.sortGroup.hidden = false; refs.sortGroup.classList.toggle('is-collapsed', !state.sortMenuOpen); }
  if (lh) lh.classList.toggle('is-sort-open', state.sortMenuOpen);
  if (mutable.sortToggleButton) {
    mutable.sortToggleButton.hidden = false;
    mutable.sortToggleButton.classList.toggle('is-hidden-animated', state.sortMenuOpen);
    mutable.sortToggleButton.classList.toggle('is-active', state.sortMenuOpen);
    mutable.sortToggleButton.setAttribute('aria-expanded', state.sortMenuOpen ? 'true' : 'false');
    mutable.sortToggleButton.title = `${UI_TEXT.sort} \u00b7 ${getSortFieldLabel(state.sortField)}`;
    mutable.sortToggleButton.innerHTML = state.sortDirection === 'asc'
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 18V6.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"></path><path d="M8.8 9.7L12 6.5l3.2 3.2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"></path></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v11.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"></path><path d="M8.8 14.3L12 17.5l3.2-3.2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
  }
  refs.sortChips.forEach((chip) => { const f = chip.dataset.sortField, a = f === state.sortField, l = getSortFieldLabel(f), arrow = a ? (state.sortDirection === 'desc' ? '\u2193' : '\u2191') : ''; chip.classList.toggle('is-active', a); chip.hidden = false; chip.classList.toggle('is-subtle-primary', false); chip.textContent = arrow ? `${l} ${arrow}` : l; });
}

export function renderTimestamp() { refs.marketTimestamp.textContent = formatTimestamp(state.lastUpdatedAt); }

export function renderPrivacyButton() {
  refs.privacyButton.classList.toggle('is-hidden', !state.showAmounts);
  document.body.classList.toggle('privacy-hidden', !state.showAmounts);
  refs.privacyButton.setAttribute('aria-pressed', state.showAmounts ? 'false' : 'true');
  refs.privacyButton.title = state.showAmounts ? '\u9690\u85cf\u91d1\u989d' : '\u663e\u793a\u91d1\u989d';
}

/* ── Page Chrome ── */
function getActivePage() {
  return ['home', 'holdings', 'dividends', 'income', 'records'].includes(state.activePage) ? state.activePage : 'home';
}

export function renderPageChrome() {
  const activePage = getActivePage();
  refs.pageViews.forEach((view) => {
    view.hidden = view.dataset.pageView !== activePage;
  });
  // CSS 钩子：记一笔胶囊只在首页出现，子页样式也按此区分。
  document.body.dataset.activePage = activePage;
}

/* ── Dividend Calendar ── */
function getDividendFilterLabel(filterKey) {
  if (filterKey === 'core') return UI_TEXT.dividendFilterCore;
  if (filterKey === 'income') return UI_TEXT.dividendFilterIncome;
  return UI_TEXT.dividendFilterAll;
}

function formatYoyBadge(yoy) {
  if (yoy === null || yoy === undefined || !Number.isFinite(Number(yoy))) {
    return `<span class="dividend-metric-badge is-flat">${escapeHtml(LABELS.dividendNoCompare)}</span>`;
  }
  const up = yoy >= 0;
  const pct = `${up ? '+' : '-'}${formatPercent(Math.abs(yoy))}`;
  return `<span class="dividend-metric-badge is-${up ? 'up' : 'down'}">${escapeHtml(pct)} · ${escapeHtml(LABELS.dividendVsLastYear)}</span>`;
}

// 三栏排版式指标：竖发丝线分隔，无卡片框。
function getDividendMetricColumn(label, value, sub = '') {
  return `<div class="dm-col">
    <span class="dm-label">${escapeHtml(label)}</span>
    <strong class="dm-value">${escapeHtml(formatDisplayMoney(value, 'CNY'))}</strong>
    <span class="dm-sub">${sub}</span>
  </div>`;
}

function renderDividendMetricGrid(model) {
  const m = model.metrics;
  refs.dividendMetricGrid.innerHTML = [
    getDividendMetricColumn(LABELS.dividendReceived, m.receivedCny),
    '<div class="dm-divider" aria-hidden="true"></div>',
    getDividendMetricColumn(LABELS.dividendUpcoming, m.upcomingCny),
    '<div class="dm-divider" aria-hidden="true"></div>',
    getDividendMetricColumn(LABELS.dividendProjected, m.projectedCny, formatYoyBadge(m.projectedYoy))
  ].join('');
}

// 月份状态摘要：只列非零项，空月显示破折号，压低视觉噪音。
function getDividendMonthStatusText(item) {
  const parts = [];
  if (item.receivedCny > 0) parts.push(`${LABELS.dividendReceivedStatus} ${formatDisplayMoney(item.receivedCny, 'CNY')}`);
  if (item.phase !== 'past' && item.upcomingCny > 0) parts.push(`在途 ${formatDisplayMoney(item.upcomingCny, 'CNY')}`);
  if (item.phase === 'past' && item.pendingCny > 0) parts.push(`${LABELS.dividendPending} ${formatDisplayMoney(item.pendingCny, 'CNY')}`);
  return parts.length ? parts.join(' · ') : '—';
}

function getDividendMonthProgress(item) {
  const total = safeNumber(item && item.totalCny, 0);
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, safeNumber(item.receivedCny, 0) / total));
}

function renderDividendMonths(model) {
  refs.dividendMonthGrid.innerHTML = model.months.map((item) => `
    <button class="dividend-month-row is-${item.phase}${item.totalCny > 0 ? '' : ' is-empty'}" type="button" data-dividend-month="${item.month}" style="--month-progress:${(getDividendMonthProgress(item) * 100).toFixed(1)}%">
      <span class="dmr-label">${escapeHtml(item.label)}</span>
      <span class="dmr-main"><span class="dmr-status">${escapeHtml(getDividendMonthStatusText(item))}</span><span class="dmr-progress"><i aria-hidden="true"></i></span></span>
      <strong class="dmr-total">${escapeHtml(formatDisplayMoney(item.totalCny, 'CNY'))}</strong>
    </button>
  `).join('');
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
  const mmdd = getShortMonthDay(entry.payDate || entry.exDate || '');
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
    if (item.phase !== 'past') summaryParts.push(`${LABELS.dividendUpcoming} ${formatDisplayMoney(item.upcomingCny, 'CNY')}`);
    else if (item.pendingCny > 0) summaryParts.push(`${LABELS.dividendPending} ${formatDisplayMoney(item.pendingCny, 'CNY')}`);
  }
  const body = entries.length
    ? entries.map((entry) => {
        // 灰=节奏预估(不可确认)；蓝=已公告未除息；绿=已确认到账；黄=自动入账但未确认。
        const dotState = entry.isForecast
          ? 'is-forecast'
          : (entry.isAnnounced || entry.status === 'announced') ? 'is-announced'
            : (entry.confirmed ? 'is-confirmed' : 'is-unconfirmed');
        const clickable = !entry.isForecast && !(entry.isAnnounced || entry.status === 'announced') && entry.sourceId;
        const tag = clickable ? 'button' : 'div';
        const attrs = clickable
          ? `type="button" data-modal-action="edit-dividend-ledger" data-source-id="${escapeHtml(entry.sourceId)}" aria-label="编辑 ${escapeHtml(entry.name)} 股息"`
          : '';
        return `<${tag} class="month-detail-row ${dotState}${clickable ? ' is-clickable' : ''}" ${attrs}>
          <span class="mdr-dot" aria-hidden="true"></span>
          <span class="mdr-name">${escapeHtml(entry.name)}</span>
          <span class="mdr-date">${escapeHtml(getMonthDetailDateShort(entry))}</span>
          <span class="mdr-amount">${escapeHtml(formatDisplayMoney(entry.netCny, 'CNY'))}</span>
        </${tag}>`;
      }).join('')
    : `<div class="month-detail-empty">${escapeHtml(LABELS.dividendEmptyTitle)}</div>`;
  return {
    title: `${month}${LABELS.dividendMonthSuffix}`,
    phase: item ? item.phase : 'future',
    total: item ? formatDisplayMoney(item.totalCny, 'CNY') : formatDisplayMoney(0, 'CNY'),
    summary: summaryParts.join(' · '),
    hasConfirmable: entries.some((entry) => !entry.isForecast && !(entry.isAnnounced || entry.status === 'announced') && entry.sourceId),
    body
  };
}

export function renderDividendCalendarPage() {
  const model = computeDividendCalendar();
  refs.dividendCalendarYear.textContent = `${model.year} ${LABELS.dividendCalendarYear} · ${getDividendFilterLabel(model.filterKey)}`;
  refs.dividendFilterButtons.forEach((button) => {
    const isActive = button.dataset.dividendFilter === model.filterKey;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
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

// 主窗口：今年至今的绝对资金收益 + 收益率，附年初净值 / 当前净值 / 今年净注入口径。
function renderIncomeOverview(model) {
  const row = model.current;
  if (!row || !row.capitalReturnAvailable) {
    refs.incomeOverviewGrid.innerHTML = `<div class="empty-state empty-state--compact"><p class="empty-state-title">暂无资金收益数据</p><p class="empty-state-note">回填或生成 ${model.currentYear - 1} 年末净值后，这里会展示今年至今的资金收益。</p></div>`;
    return;
  }
  const valueTone = getReturnTone(row.capitalReturnCny);
  const rateTone = getReturnTone(row.capitalReturnRate);
  const cashActive = isCashModelActive();
  const cashCell = cashActive
    ? `<span><small>现金余额</small><strong class="income-amount">${escapeHtml(formatIncomeMoney(computeHoldings().cashBalanceCny))}</strong></span>`
    : '';
  refs.incomeOverviewGrid.innerHTML = `
    <article class="income-hero">
      <div class="income-hero-head">
        <span class="income-hero-label">当年收益</span>
        <span class="income-hero-rate income-amount ${rateTone}">${escapeHtml(formatIncomeRate(row.capitalReturnRate))}</span>
      </div>
      <strong class="income-hero-value income-amount ${valueTone}">${escapeHtml(formatIncomeSignedMoney(row.capitalReturnCny))}</strong>
      <div class="income-hero-context">
        <span><small>年初净值</small><strong class="income-amount">${escapeHtml(formatIncomeMoney(row.yearStartNetCny))}</strong></span>
        <span><small>当前净值</small><strong class="income-amount">${escapeHtml(formatIncomeMoney(row.yearEndNetCny))}</strong></span>
        <span><small>今年净注入</small><strong class="income-amount">${escapeHtml(formatIncomeSignedMoney(row.netInflowCny))}</strong></span>
        ${cashCell}
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
  const height = 220;
  const padX = 28;
  const padTop = 18;
  const padBottom = 34;
  const innerWidth = width - padX * 2;
  const innerHeight = height - padTop - padBottom;
  const x = total <= 1 ? width / 2 : padX + (innerWidth * index) / (total - 1);
  const range = maxValue === minValue ? 1 : maxValue - minValue;
  const y = padTop + ((maxValue - value) / range) * innerHeight;
  return { x: roundSvgNumber(x), y: roundSvgNumber(y) };
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
  return `<g class="income-trend-series ${className}">
    <polyline points="${pointText}"></polyline>
    ${circles}
  </g>`;
}

// 历年趋势：资金收益率 + 股息收益率两条百分比线，共用同一坐标系。
function renderIncomeTrend(model) {
  const rows = model.trendRows;
  const series = [
    { key: 'capitalReturnRate', className: 'is-capital', label: '资金收益率' },
    { key: 'dividendYieldRate', className: 'is-dividend', label: '股息收益率' }
  ];
  const values = series.flatMap((item) => rows.map((row) => getTrendValue(row, item.key)).filter((value) => value !== null));
  if (!values.length) {
    refs.incomeTrend.innerHTML = `<div class="empty-state empty-state--compact"><p class="empty-state-title">暂无趋势数据</p><p class="empty-state-note">有历年净值或历史回填后会展示收益率趋势。</p></div>`;
    return;
  }
  const minValue = Math.min(0, ...values);
  const maxValue = Math.max(0, ...values);
  const zeroPoint = getTrendPoint({ rate: 0 }, 0, 1, 'rate', minValue, maxValue);
  refs.incomeTrend.innerHTML = `
    <div class="income-trend-chart">
      <svg class="income-trend-svg" viewBox="0 0 720 220" role="img" aria-label="历年资金收益率与股息收益率趋势">
        <line class="income-trend-zero" x1="28" x2="692" y1="${zeroPoint.y}" y2="${zeroPoint.y}"></line>
        ${series.map((item) => getTrendSeriesMarkup(rows, item.key, item.className, minValue, maxValue)).join('')}
      </svg>
      <div class="income-trend-years">${rows.map((row) => `<span>${row.year}</span>`).join('')}</div>
      <div class="income-trend-legend">${series.map((item) => `<span><i class="${item.className}"></i>${item.label}</span>`).join('')}</div>
    </div>`;
}

function getIncomeYearCell(label, value, extraClass = '') {
  return `<div class="income-year-cell${extraClass ? ` ${extraClass}` : ''}" data-label="${escapeHtml(label)}">${escapeHtml(value)}</div>`;
}

function getIncomeYearActionCell(row) {
  const label = row.hasManualBackfill ? '修改历史回填' : '填写历史回填';
  return `<div class="income-year-action-cell" data-label="操作">
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
  const rows = model.rows.map((row) => {
    return `<div class="income-year-row" role="row">
      ${getIncomeYearCell('年份', String(row.year), 'is-year')}
      ${getIncomeYearCell('股息', formatIncomeMoney(row.dividendCny), 'income-amount')}
      ${getIncomeYearCell('股息率', formatIncomeRate(row.dividendYieldRate), 'is-compare')}
      ${getIncomeYearCell('资金收益', formatIncomeSignedMoney(row.capitalReturnCny), `income-amount ${getReturnTone(row.capitalReturnCny)}`)}
      ${getIncomeYearCell('收益率', formatIncomeRate(row.capitalReturnRate), `is-compare ${getReturnTone(row.capitalReturnRate)}`)}
      ${getIncomeYearCell('年末净值', formatIncomeMoney(row.yearEndNetCny), 'income-amount')}
      ${getIncomeYearActionCell(row)}
    </div>`;
  }).join('');
  refs.incomeYearList.innerHTML = `<div class="income-year-table" role="table" aria-label="年度收益列表">
    <div class="income-year-row income-year-head" role="row">
      <div>年份</div><div>股息</div><div>股息率</div><div>资金收益</div><div>收益率</div><div>年末净值</div><div>操作</div>
    </div>
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
  if (!records.length) return getRecordEmptyMarkup('暂无交易', '记录买卖后会生成成本、已实现盈亏和 Yield on Cost。');
  return records.map((entry) => `
    <button class="income-record-row income-record-row--trade" type="button" data-trade-id="${escapeHtml(entry.id)}">
      <span class="record-main">
        <strong>${escapeHtml(entry.name || entry.symbol)}</strong>
        <small>${escapeHtml(entry.date)} · ${escapeHtml(getTradeSideLabel(entry.side))} ${escapeHtml(formatRecordQuantity(entry.shares))} · ${escapeHtml(entry.symbol)}</small>
      </span>
      <span class="record-amount income-amount ${getSignedTone(entry.cashImpactCny)}">${escapeHtml(formatIncomeSignedMoney(entry.cashImpactCny))}</span>
    </button>
  `).join('');
}

function renderTradePositionRows(rows) {
  if (!rows.length) return getRecordEmptyMarkup('暂无成本视图', '录入交易后，这里会按股票汇总剩余股数和成本。');
  return rows.map((row) => {
    const mismatch = row.currentHoldingShares !== null && Math.abs(row.currentHoldingShares - row.shares) > 0.000001;
    return `<div class="income-position-row">
      <div class="position-title">
        <strong>${escapeHtml(row.name)}</strong>
        <small>${escapeHtml(row.symbol)}${mismatch ? ` · 当前持仓 ${escapeHtml(formatRecordQuantity(row.currentHoldingShares))}` : ''}</small>
      </div>
      <div class="position-grid">
        <span><small>股数</small><strong>${escapeHtml(formatRecordQuantity(row.shares))}</strong></span>
        <span><small>成本</small><strong class="income-amount">${escapeHtml(formatIncomeMoney(row.costCny))}</strong></span>
        <span><small>浮盈</small><strong class="income-amount ${getReturnTone(row.unrealizedPnlCny)}">${escapeHtml(formatIncomeSignedMoney(row.unrealizedPnlCny))}</strong></span>
        <span><small>YOC</small><strong>${row.yieldOnCost === null ? '待计算' : escapeHtml(formatPercent(row.yieldOnCost))}</strong></span>
      </div>
    </div>`;
  }).join('');
}

export function renderIncomeRecords() {
  if (!refs.incomeRecordsList) return;
  const cash = computeCashFlowRecords();
  const trades = computeTradeSummary();
  refs.incomeRecordsList.innerHTML = `
    <div class="income-record-overview">
      <article><span>净注入</span><strong class="income-amount ${getSignedTone(cash.netInflowCny)}">${escapeHtml(formatIncomeSignedMoney(cash.netInflowCny))}</strong></article>
      <article><span>已实现盈亏</span><strong class="income-amount ${getReturnTone(trades.totalRealizedPnlCny)}">${escapeHtml(formatIncomeSignedMoney(trades.totalRealizedPnlCny))}</strong></article>
      <article><span>持仓成本</span><strong class="income-amount">${escapeHtml(formatIncomeMoney(trades.totalCostCny))}</strong></article>
      <article><span>成本股息率</span><strong>${trades.totalCostCny > 0 ? escapeHtml(formatPercent(trades.totalAnnualDividendCny / trades.totalCostCny)) : '待计算'}</strong></article>
    </div>
    <div class="income-record-columns">
      <section class="income-record-block">
        <div class="income-record-head"><h3>出入金记录</h3><span>${cash.count} 笔</span></div>
        <div class="income-record-list">${renderCashFlowRows(cash.records)}</div>
      </section>
      <section class="income-record-block">
        <div class="income-record-head"><h3>交易流水</h3><span>${trades.count} 笔</span></div>
        <div class="income-record-list">${renderTradeRows(trades.records)}</div>
      </section>
    </div>
    <section class="income-record-block income-record-block--wide">
      <div class="income-record-head"><h3>持仓成本</h3><span>${trades.positions.length} 项</span></div>
      <div class="income-position-list">${renderTradePositionRows(trades.positions)}</div>
    </section>`;
}

export function renderIncomeSummaryPage() {
  const model = computeIncomeSummary();
  // 现金模式启用后，收益页隐藏「期初现金」重复入口（CSS 按此类名区分）。
  if (refs.incomeSummaryPage) refs.incomeSummaryPage.classList.toggle('is-cash-active', isCashModelActive());
  renderIncomeOverview(model);
  renderIncomeTrend(model);
  renderIncomeYearList(model);
}

/* ── Holdings ── */
function getHoldingViewModel(item, index = 0) {
  const tl = buildDividendTooltipLines(item), sk = normalizeDividendStatus(item.dividendStatus, 'missing');
  return {
    priceText: state.showAmounts ? formatPlainPrice(item.price) : MASK_PRICE,
    marketValueText: state.showAmounts ? formatMoney(item.marketValueCny, 'CNY') : MASK_AMOUNT,
    annualDividendText: state.showAmounts ? formatMoney(item.netAnnualDividendCny, 'CNY') : MASK_AMOUNT,
    quantityText: state.showAmounts ? String(item.quantity) : MASK_AMOUNT,
    weightText: `${(item.holdingWeight * 100).toFixed(1)}%`,
    statusKey: sk, statusLabel: getDividendStatusLabel(sk), tooltipLines: tl,
    tooltipHtml: buildDividendTooltipHtml(tl), yieldText: formatPercent(item.effectiveYield),
    bucketTone: item.bucket === 'income' ? 'income' : 'core',
    staggerDelay: Math.min(index * HOLDING_ENTER_STAGGER_MS, HOLDING_ENTER_STAGGER_MAX_MS)
  };
}

function getHoldingMarkup(item, index, opts = {}) {
  const { animate = true } = opts, v = getHoldingViewModel(item, index);
  return `<div class="holding-swipe${animate ? ' is-entering' : ''}" data-id="${item.localId}" style="--holding-swipe-offset:0px;animation-delay:${v.staggerDelay}ms;">
    <article class="holding-card" data-id="${item.localId}" data-dividend-status="${escapeHtml(item.dividendStatus || 'missing')}">
    <header class="holding-head"><div class="holding-main"><h3 class="holding-name">${escapeHtml(item.name)}</h3>
    <div class="holding-meta-row"><span class="holding-price" data-holding-field="price">${escapeHtml(v.priceText)}</span><span class="holding-divider">${getHoldingTitleDivider()}</span><span class="holding-code">${escapeHtml(item.symbol)}</span></div></div>
    <div class="holding-side"><span class="weight-pill is-${v.bucketTone}" data-holding-field="weight">${escapeHtml(v.weightText)}</span></div></header>
    <div class="holding-grid">
    <div class="metric-static"><div class="metric-row"><span class="metric-label">${LABELS.marketValue}</span><span class="metric-value" data-holding-field="marketValue">${escapeHtml(v.marketValueText)}</span></div></div>
    <button class="metric-button metric-right" type="button" data-action="edit-quantity"><div class="metric-row metric-right"><span class="metric-label">${LABELS.quantity}</span><span class="metric-value" data-holding-field="quantity">${escapeHtml(v.quantityText)}</span></div></button>
    <button class="metric-button" type="button" data-action="edit-tax"><div class="metric-row"><span class="metric-label">${LABELS.annualDividend}</span><span class="metric-value is-income" data-holding-field="annualDividend">${escapeHtml(v.annualDividendText)}</span></div></button>
    <div class="metric-static metric-right metric-static--yield"><div class="metric-row metric-right metric-row--yield">
    <button class="metric-label-button" type="button" data-action="edit-dividend">${LABELS.dividendYield}</button>
    <button class="dividend-status-button dividend-status-button--value is-${v.statusKey}" type="button" aria-label="${escapeHtml(v.statusLabel)}" aria-expanded="false" data-tooltip-side="left" data-holding-field="effectiveYield">
    <span class="dividend-status-value" data-holding-field="effectiveYieldValue">${escapeHtml(v.yieldText)}</span>
    <span class="dividend-status-tooltip" data-holding-field="dividendTooltip">${v.tooltipHtml}</span></button></div></div></div></article></div>`;
}

export function renderHoldingsView(holdings, opts = {}) {
  mutable.activeDividendTooltipButton = null;
  if (!holdings.length) { refs.stockList.innerHTML = '<article class="holding-card empty-card"></article>'; return; }
  refs.stockList.innerHTML = holdings.map((item, i) => getHoldingMarkup(item, i, opts)).join('');
  markCurrencyAmountElements(refs.stockList);
}

function syncHoldingRow(wrapper, item) {
  const card = wrapper.querySelector('.holding-card'), price = wrapper.querySelector('[data-holding-field="price"]');
  const weight = wrapper.querySelector('[data-holding-field="weight"]'), mv = wrapper.querySelector('[data-holding-field="marketValue"]');
  const qty = wrapper.querySelector('[data-holding-field="quantity"]'), ad = wrapper.querySelector('[data-holding-field="annualDividend"]');
  const ey = wrapper.querySelector('[data-holding-field="effectiveYield"]'), eyv = wrapper.querySelector('[data-holding-field="effectiveYieldValue"]');
  const tt = wrapper.querySelector('[data-holding-field="dividendTooltip"]'), name = wrapper.querySelector('.holding-name');
  const code = wrapper.querySelector('.holding-code'), divider = wrapper.querySelector('.holding-divider');
  if (!card || !price || !weight || !mv || !qty || !ad || !ey || !eyv || !tt || !name || !code || !divider) return false;
  const v = getHoldingViewModel(item);
  wrapper.dataset.id = String(item.localId); wrapper.classList.remove('is-entering'); wrapper.style.animationDelay = '0ms';
  card.dataset.id = String(item.localId); card.dataset.dividendStatus = item.dividendStatus || 'missing';
  name.textContent = item.name; code.textContent = item.symbol; divider.textContent = getHoldingTitleDivider();
  price.textContent = v.priceText; weight.textContent = v.weightText;
  weight.classList.remove('is-core', 'is-income'); weight.classList.add(`is-${v.bucketTone}`);
  mv.textContent = v.marketValueText; qty.textContent = v.quantityText; ad.textContent = v.annualDividendText;
  const keepOpen = ey.classList.contains('is-tooltip-open');
  ey.className = `dividend-status-button dividend-status-button--value is-${v.statusKey}${keepOpen ? ' is-tooltip-open' : ''}`;
  ey.setAttribute('aria-label', v.statusLabel); ey.setAttribute('aria-expanded', keepOpen ? 'true' : 'false');
  ey.removeAttribute('title'); ey.dataset.tooltipSide = 'left'; eyv.textContent = v.yieldText; tt.innerHTML = v.tooltipHtml;
  wrapper.querySelectorAll('[data-action="delete"]').forEach((b) => { b.setAttribute('aria-label', `${LABELS.deleteConfirm} ${item.name}`); });
  return true;
}

export function syncRenderedHoldingsView(holdings, opts = {}) {
  const { animateReflow = false } = opts;
  if (!holdings.length) { refs.stockList.innerHTML = '<article class="holding-card empty-card"></article>'; mutable.activeDividendTooltipButton = null; return; }
  const wrappers = Array.from(refs.stockList.querySelectorAll('.holding-swipe[data-id]'));
  if (!wrappers.length) { renderHoldingsView(holdings, { animate: false }); return; }
  const currentIds = wrappers.map((w) => safeNumber(w.dataset.id, 0));
  const nextIds = holdings.map((i) => i.localId);
  const reorder = currentIds.length !== nextIds.length || currentIds.some((id, i) => id !== nextIds[i]);
  const prevPos = animateReflow && reorder ? captureHoldingPositions() : null;
  const keyed = new Map(wrappers.map((w) => [safeNumber(w.dataset.id, 0), w]));
  let fb = false;
  holdings.forEach((item, i) => {
    if (fb) return;
    let w = keyed.get(item.localId);
    if (!w) w = createElementFromHtml(getHoldingMarkup(item, i, { animate: false }));
    if (!w || (keyed.has(item.localId) && !syncHoldingRow(w, item))) { fb = true; return; }
    if (reorder || !w.isConnected) refs.stockList.appendChild(w);
  });
  if (fb) { renderHoldingsView(holdings, { animate: false }); return; }
  keyed.forEach((w, id) => {
    if (!nextIds.includes(id)) {
      if (mutable.activeHoldingSwipe && mutable.activeHoldingSwipe.wrapper === w) mutable.activeHoldingSwipe = null;
      if (mutable.activeDividendTooltipButton && w.contains(mutable.activeDividendTooltipButton)) mutable.activeDividendTooltipButton = null;
      w.remove();
    }
  });
  if (mutable.activeDividendTooltipButton && !refs.stockList.contains(mutable.activeDividendTooltipButton)) mutable.activeDividendTooltipButton = null;
  markCurrencyAmountElements(refs.stockList);
  if (prevPos) animateHoldingReflow(prevPos);
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
  patchBucketsView(bs, summary.holdings, summary);
  renderSortChips(); renderTimestamp(); renderPrivacyButton();
  renderIncomeSummaryPage();
  renderIncomeRecords();
  renderDividendCalendarPage();
  syncRenderedHoldingsView(summary.holdings, { animateReflow: opts.animateHoldingReflow });
  markCurrencyAmountElements();
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
  renderBucketsView(bs, summary.holdings, summary, { animateDetail: animateBucketDetail });
  renderSortChips(); renderTimestamp(); renderPrivacyButton();
  renderIncomeSummaryPage();
  renderIncomeRecords();
  renderDividendCalendarPage();
  if (renderHoldingsList) renderHoldingsView(summary.holdings, { animate: animateHoldings });
  else syncRenderedHoldingsView(summary.holdings, { animateReflow: false });
  markCurrencyAmountElements();
}

export function applyHoldingSortSelection(nextField) {
  if (!nextField) return;
  closeActiveDividendTooltip(true);
  const opened = refs.stockList.querySelector('.holding-swipe.is-swipe-open');
  if (opened) closeHoldingSwipe(opened);
  if (state.sortField === nextField) state.sortDirection = state.sortDirection === 'desc' ? 'asc' : 'desc';
  else { state.sortField = nextField; state.sortDirection = 'desc'; }
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
