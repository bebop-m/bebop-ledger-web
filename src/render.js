import { state, refs, mutable, saveState } from './state.js';
import { computeHoldings, getCompanySegments, getBucketSegments, getBucketSummaryItems } from './compute.js';
import {
  safeNumber, escapeHtml, formatMoney, formatPlainPrice, formatPercent, formatDailyPnl,
  formatTimestamp, normalizeDividendStatus, getDividendStatusLabel,
  buildDividendTooltipLines, buildDividendTooltipHtml, createElementFromHtml
} from './utils.js';
import {
  MASK_AMOUNT, MASK_PRICE, LABELS, UI_TEXT, ALLOCATION_LEGEND_MIN_WEIGHT,
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

/* ── Summary ── */
function getSummaryViewModel(summary) {
  const y = summary.totalMarketValueCny > 0 ? summary.totalDividendCny / summary.totalMarketValueCny : 0;
  const pnl = safeNumber(summary.totalDailyPnlCny, 0);
  const hasPnl = summary.holdings.some((h) => safeNumber(h.previousClose, 0) > 0);
  return {
    totalLabel: formatDisplayMoney(summary.netMarketValueCny, 'CNY'),
    dividendLabel: formatDisplayMoney(summary.totalDividendCny, 'CNY'),
    dailyPnlText: hasPnl && state.showAmounts ? formatDailyPnl(pnl, summary.totalMarketValueCny) : '',
    overallYieldText: `${UI_TEXT.overallYieldCompact} ${formatPercent(y)}`,
    usdRateCompactText: `USD/CNY ${safeNumber(state.rates.USD, 0).toFixed(2)}`,
    hkdRateCompactText: `HKD/CNY ${safeNumber(state.rates.HKD, 0).toFixed(4)}`,
    usdRateText: `1 USD = ${safeNumber(state.rates.USD, 0).toFixed(2)} CNY`,
    hkdRateText: `1 HKD = ${safeNumber(state.rates.HKD, 0).toFixed(4)} CNY`
  };
}

function getSummaryMainCardsMarkup(v) {
  return `
    <article class="summary-card">
      <div class="summary-top">
        <span class="summary-label">${LABELS.totalMarketValue}</span>
        <button class="ghost-minus" type="button" data-summary-action="liability" aria-label="${LABELS.liability}">-</button>
      </div>
      <div class="summary-value" data-summary-field="totalValue">${escapeHtml(v.totalLabel)}</div>
      <p class="summary-note" data-summary-field="dailyPnl"${v.dailyPnlText ? '' : ' hidden'}>${escapeHtml(v.dailyPnlText)}</p>
    </article>
    <article class="summary-card">
      <div class="summary-label">${LABELS.totalDividend}</div>
      <div class="summary-value is-income" data-summary-field="dividendValue">${escapeHtml(v.dividendLabel)}</div>
      <p class="summary-note summary-note--yield" data-summary-field="overallYield">${escapeHtml(v.overallYieldText)}</p>
    </article>`;
}

export function renderSummaryView(summary) {
  const v = getSummaryViewModel(summary);
  refs.summaryGrid.classList.add('summary-grid--compact-fx');
  refs.summaryGrid.innerHTML = `<div class="summary-grid-main">${getSummaryMainCardsMarkup(v)}</div>
    <div class="summary-fx-strip" aria-label="${LABELS.usdRate} / ${LABELS.hkdRate}">
      <span class="summary-fx-item" data-summary-field="usdRate">${escapeHtml(v.usdRateCompactText)}</span>
      <span class="summary-fx-divider">\u00b7</span>
      <span class="summary-fx-item" data-summary-field="hkdRate">${escapeHtml(v.hkdRateCompactText)}</span>
    </div>`;
}

export function patchSummaryView(summary) {
  const isCompact = refs.summaryGrid.classList.contains('summary-grid--compact-fx');
  if (!refs.summaryGrid.children.length || !isCompact) { renderSummaryView(summary); return; }
  const tv = refs.summaryGrid.querySelector('[data-summary-field="totalValue"]');
  const dp = refs.summaryGrid.querySelector('[data-summary-field="dailyPnl"]');
  const dv = refs.summaryGrid.querySelector('[data-summary-field="dividendValue"]');
  const ur = refs.summaryGrid.querySelector('[data-summary-field="usdRate"]');
  const hr = refs.summaryGrid.querySelector('[data-summary-field="hkdRate"]');
  const oy = refs.summaryGrid.querySelector('[data-summary-field="overallYield"]');
  if (!tv || !dp || !dv || !ur || !hr || !oy) { renderSummaryView(summary); return; }
  const v = getSummaryViewModel(summary);
  tv.textContent = v.totalLabel; dp.textContent = v.dailyPnlText; dp.hidden = !v.dailyPnlText;
  dv.textContent = v.dividendLabel; ur.textContent = v.usdRateCompactText;
  hr.textContent = v.hkdRateCompactText; oy.textContent = v.overallYieldText;
}

/* ── Legend ── */
function getLegendSegmentKey(seg, i) {
  if (seg && seg.key != null) return String(seg.key);
  if (seg && seg.label) return String(seg.label);
  return `legend-${i}`;
}

function getLegendViewModel(segments) {
  const total = segments.reduce((s, i) => s + i.value, 0) || 1;
  const vis = segments.filter((s) => s.value / total >= ALLOCATION_LEGEND_MIN_WEIGHT);
  const cc = (vis.length ? vis : segments.slice(0, LEGEND_COLLAPSED_COUNT)).length;
  return { total, collapsedCount: cc, canToggleLegend: cc < segments.length };
}

function getLegendRowMarkup(seg, pct, index, cc, opts = {}) {
  const { animate = true } = opts;
  return `<div class="legend-row${animate ? ' is-entering' : ''}${index >= cc ? ' legend-row--collapsible' : ''}" data-legend-key="${escapeHtml(getLegendSegmentKey(seg, index))}" style="animation-delay:${index * LEGEND_ENTER_STAGGER_MS}ms">
    <div class="legend-row-shell"><div class="legend-main"><span class="legend-dot" style="background:${seg.color}"></span><span class="legend-label">${escapeHtml(seg.label)}</span></div>
    <span class="legend-value">${(pct * 100).toFixed(1)}%</span></div></div>`;
}

function syncLegendRow(row, seg, pct, index, cc, opts = {}) {
  const dot = row.querySelector('.legend-dot'), label = row.querySelector('.legend-label'), value = row.querySelector('.legend-value');
  if (!dot || !label || !value) return false;
  row.dataset.legendKey = getLegendSegmentKey(seg, index);
  row.className = `legend-row${opts.animate ? ' is-entering' : ''}${index >= cc ? ' legend-row--collapsible' : ''}`;
  row.style.animationDelay = `${index * LEGEND_ENTER_STAGGER_MS}ms`;
  dot.style.background = seg.color; label.textContent = seg.label; value.textContent = `${(pct * 100).toFixed(1)}%`;
  return true;
}

function keepLegendToggleStable(prevTop) {
  if (!Number.isFinite(prevTop)) return;
  const adjust = () => { const d = refs.legendToggle.getBoundingClientRect().top - prevTop; if (Math.abs(d) > 1) window.scrollBy(0, d); };
  requestAnimationFrame(() => { adjust(); window.setTimeout(adjust, LEGEND_TOGGLE_ANIMATION_MS + 40); });
}

export function applyLegendExpandState(opts = {}) {
  const { preserveScroll = false, toggleTop = 0 } = opts;
  Array.from(refs.companyLegend.querySelectorAll('.legend-row--collapsible')).forEach((row) => {
    const shell = row.querySelector('.legend-row-shell');
    const h = shell ? Math.max(Math.ceil(shell.getBoundingClientRect().height), 18) : Math.max(row.scrollHeight, 18);
    row.style.setProperty('--legend-row-shell-height', `${h}px`);
    row.classList.toggle('is-collapsed', !state.legendExpanded);
    row.setAttribute('aria-hidden', state.legendExpanded ? 'false' : 'true');
  });
  refs.legendToggle.textContent = state.legendExpanded ? LABELS.collapseLegend
    : `${LABELS.expandLegend} ${refs.companyLegend.querySelectorAll('.legend-row').length} ${LABELS.itemsUnit}`;
  if (preserveScroll) keepLegendToggleStable(toggleTop);
}

export function renderLegendView(segments, opts = {}) {
  const { animate = true } = opts;
  const v = getLegendViewModel(segments);
  refs.companyLegend.innerHTML = segments.map((s, i) => getLegendRowMarkup(s, s.value / v.total, i, v.collapsedCount, { animate })).join('');
  applyLegendExpandState();
  refs.legendToggle.hidden = !v.canToggleLegend;
  if (v.canToggleLegend) refs.legendToggle.textContent = state.legendExpanded ? LABELS.collapseLegend : `${LABELS.expandLegend} ${segments.length} ${LABELS.itemsUnit}`;
}

export function patchLegendView(segments) {
  if (!segments.length) { refs.companyLegend.innerHTML = ''; refs.legendToggle.hidden = true; return; }
  const rows = Array.from(refs.companyLegend.querySelectorAll('.legend-row'));
  const keyedRows = new Map(rows.filter((r) => r.dataset.legendKey).map((r) => [r.dataset.legendKey, r]));
  if (rows.length && keyedRows.size !== rows.length) { renderLegendView(segments, { animate: false }); return; }
  const v = getLegendViewModel(segments);
  const nextKeys = segments.map((s, i) => getLegendSegmentKey(s, i));
  const reorder = rows.length !== nextKeys.length || rows.some((r, i) => r.dataset.legendKey !== nextKeys[i]);
  let fallback = false;
  segments.forEach((seg, i) => {
    if (fallback) return;
    let row = keyedRows.get(nextKeys[i]);
    if (!row) row = createElementFromHtml(getLegendRowMarkup(seg, seg.value / v.total, i, v.collapsedCount, { animate: false }));
    if (!row || !syncLegendRow(row, seg, seg.value / v.total, i, v.collapsedCount)) { fallback = true; return; }
    if (reorder || !row.isConnected) refs.companyLegend.appendChild(row);
  });
  if (fallback) { renderLegendView(segments, { animate: false }); return; }
  keyedRows.forEach((row, key) => { if (!nextKeys.includes(key)) row.remove(); });
  applyLegendExpandState();
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
    <button class="holding-swipe-delete" type="button" data-action="delete" aria-label="${LABELS.deleteConfirm} ${escapeHtml(item.name)}"><span>\u5220\u9664</span></button>
    <article class="holding-card" data-id="${item.localId}" data-dividend-status="${escapeHtml(item.dividendStatus || 'missing')}">
    <header class="holding-head"><div class="holding-main"><h3 class="holding-name">${escapeHtml(item.name)}</h3>
    <div class="holding-meta-row"><span class="holding-price" data-holding-field="price">${escapeHtml(v.priceText)}</span><span class="holding-divider">${getHoldingTitleDivider()}</span><span class="holding-code">${escapeHtml(item.symbol)}</span></div></div>
    <div class="holding-side"><span class="weight-pill is-${v.bucketTone}" data-holding-field="weight">${escapeHtml(v.weightText)}</span>
    <button class="ghost-minus" type="button" data-action="delete" aria-label="${LABELS.deleteConfirm} ${escapeHtml(item.name)}">-</button></div></header>
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
  patchSummaryView(summary); patchLegendView(cs);
  patchBucketsView(bs, summary.holdings, summary);
  renderSortChips(); renderTimestamp(); renderPrivacyButton();
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
  const chartShell = refs.chartLayout && refs.chartLayout.parentElement;
  if (chartShell) chartShell.insertBefore(refs.bucketTrack, refs.chartLayout);
  document.body.classList.add('ui-refined-accent');
  if (incremental) { renderDashboardIncrementally(summary, cs, bs, { animateHoldingReflow }); return; }
  renderSummaryView(summary); renderLegendView(cs, { animate: animateLegend });
  renderBucketsView(bs, summary.holdings, summary, { animateDetail: animateBucketDetail });
  renderSortChips(); renderTimestamp(); renderPrivacyButton();
  if (renderHoldingsList) renderHoldingsView(summary.holdings, { animate: animateHoldings });
  else syncRenderedHoldingsView(summary.holdings, { animateReflow: false });
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
export function isHoldingSwipeEnabled() { return window.matchMedia('(max-width: 560px)').matches; }
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
