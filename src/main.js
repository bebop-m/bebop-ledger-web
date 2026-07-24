/* ── BOPUP LEDGER — Entry Point ── */
import { state, refs, mutable, saveState, createDefaultSnapshot, applySnapshot, restoreState, showConfirm, addRecordTombstone } from './state.js';
import { safeNumber } from './utils.js';
import {
  UI_TEXT, LABELS, HOLDING_SWIPE_DELETE_WIDTH, HOLDING_SWIPE_OPEN_THRESHOLD,
  SWIPE_SUPPRESS_CLICK_MS, PAGE_KEYS, DIVIDEND_FILTER_KEYS
} from './constants.js';
import { computeHoldings, getBucketSegments, isCashModelActive } from './compute.js';
import {
  renderApp, renderSavedStateQuietly, renderSortChips, renderBucketsView,
  renderReturnBar,
  applyLegendExpandState, applyHoldingSortSelection, updateDividendTooltipSide,
  closeActiveDividendTooltip, toggleDividendTooltip, captureHoldingPositions,
  animateHoldingReflow, animateHoldingRemoval, closeHoldingSwipe, openHoldingSwipe,
  isHoldingSwipeEnabled, getHoldingSwipeOffset, setHoldingSwipeOffset, toggleDividendPastMonths,
  generateAnnualShareCard
} from './render.js';
import {
  openModal, closeModal, handleModalSave, handleModalDelete,
  setModalBucketSelection, setModalCashFlowTypeSelection,
  setModalTradeSideSelection, toggleDividendConfirm, updateTradeQuoteInfo,
  setModalReceiptCurrency, updateReceiptConversion
} from './modal.js';
import { refreshMarketData, cleanupLegacyCaches } from './network.js';
import { syncPortfolioToCloud, handleImportFile } from './sync.js';
import { loadFundamentals, selectFundamentalsSymbol } from './fundamentals.js';
import { loadReportCalendar } from './report-calendar.js';

/* ── Sort Toggle Button（静态节点，只补事件与无障碍标签，图标由 renderSortChips 填充）── */
mutable.sortToggleButton = document.getElementById('sortToggleButton');
if (mutable.sortToggleButton) {
  mutable.sortToggleButton.setAttribute('aria-label', UI_TEXT.sort);
  mutable.sortToggleButton.addEventListener('click', (e) => { e.stopPropagation(); state.sortMenuOpen = !state.sortMenuOpen; renderSortChips(); });
}

/* ── Page Navigation ── */
const pageHistory = [];

function navigateTo(page, options = {}) {
  if (!PAGE_KEYS.has(page) || state.activePage === page) return;
  if (options.recordHistory !== false && state.activePage) pageHistory.push(state.activePage);
  closeActiveDividendTooltip(true);
  state.activePage = page;
  state.sortMenuOpen = false;
  saveState();
  renderApp({ incremental: true, animateHoldingReflow: false });
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function navigateBack() {
  const fallback = state.activePage === 'annual' ? 'income' : 'home';
  const previous = pageHistory.pop() || fallback;
  navigateTo(previous, { recordHistory: false });
}

/* ── Event Bindings ── */
refs.privacyButton.addEventListener('click', () => { state.showAmounts = !state.showAmounts; saveState(); renderSavedStateQuietly({ animateHoldingReflow: false }); });
refs.exportButton.addEventListener('click', syncPortfolioToCloud);
refs.importButton.addEventListener('click', () => refs.importFileInput.click());
refs.importFileInput.addEventListener('change', handleImportFile);
refs.legendToggle.addEventListener('click', () => { const t = refs.legendToggle.getBoundingClientRect().top; state.legendExpanded = !state.legendExpanded; saveState(); applyLegendExpandState({ preserveScroll: true, toggleTop: t }); });
refs.refreshButton.addEventListener('click', () => { refreshMarketData({ silent: false }); });
if (refs.diagnosticsButton) refs.diagnosticsButton.addEventListener('click', () => { openModal('diagnostics'); });
// 现金模式下，首页「+」直接开一笔买入交易（替代旧的新增持仓）；未启用时仍是新增持仓。
refs.addButton.addEventListener('click', () => { openModal(isCashModelActive() ? 'trade' : 'add'); });

refs.homeNavList.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-page-nav]');
  if (btn) navigateTo(btn.dataset.pageNav);
});

refs.homeFocusCard.addEventListener('click', (event) => {
  if (event.target.closest('[data-home-action="quick-add"]')) { openModal('quickAdd'); return; }
  const btn = event.target.closest('[data-home-dividend-month]');
  if (btn) {
    const month = Math.floor(safeNumber(btn.dataset.homeDividendMonth, 0));
    if (month >= 1 && month <= 12) {
      navigateTo('dividends');
      openModal('monthDetail', { month });
    }
    return;
  }
  const pageButton = event.target.closest('[data-page-nav]');
  if (pageButton) navigateTo(pageButton.dataset.pageNav);
});

refs.pageBackButtons.forEach((button) => {
  button.addEventListener('click', navigateBack);
});

// 首页主行动始终先选择交易或出入金，避免现金模式下把「记一笔」误解为固定买入。
if (refs.quickAddButton) refs.quickAddButton.addEventListener('click', () => { openModal('quickAdd'); });

if (refs.fundamentalsContent) refs.fundamentalsContent.addEventListener('click', (event) => {
  const symbolButton = event.target.closest('[data-fund-symbol]');
  if (symbolButton) {
    selectFundamentalsSymbol(symbolButton.dataset.fundSymbol);
    return;
  }
  if (event.target.closest('[data-fund-picker-open]')) openModal('fundPicker');
});
// 页尾日历点公司：切到该公司并滚回页顶，让上方的切换结果可见。
if (refs.reportCalendarPanel) refs.reportCalendarPanel.addEventListener('click', (event) => {
  const row = event.target.closest('[data-report-symbol]');
  if (row) {
    selectFundamentalsSymbol(row.dataset.reportSymbol);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});

refs.dividendFilterGroup.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-dividend-filter]');
  if (!btn || !DIVIDEND_FILTER_KEYS.has(btn.dataset.dividendFilter)) return;
  if (state.dividendCalendarBucket === btn.dataset.dividendFilter) return;
  state.dividendCalendarBucket = btn.dataset.dividendFilter;
  saveState();
  renderApp({ incremental: true, animateHoldingReflow: false });
});

refs.dividendMonthGrid.addEventListener('click', (event) => {
  if (event.target.closest('[data-dividend-past-toggle]')) { toggleDividendPastMonths(); return; }
  const btn = event.target.closest('[data-dividend-month]');
  if (!btn) return;
  const month = Math.floor(safeNumber(btn.dataset.dividendMonth, 0));
  if (month < 1 || month > 12) return;
  openModal('monthDetail', { month });
});

if (refs.dividendMonthDetailView) refs.dividendMonthDetailView.addEventListener('click', (event) => {
  if (event.target.closest('[data-dividend-detail-back]')) {
    state.activeDividendMonth = null;
    saveState();
    renderApp({ incremental: true, animateHoldingReflow: false });
    return;
  }
  const entry = event.target.closest('[data-modal-action="edit-dividend-ledger"]');
  if (entry) openModal('dividendLedger', { sourceId: entry.dataset.sourceId });
});

if (refs.holdingsSortLabel) refs.holdingsSortLabel.addEventListener('click', (event) => {
  event.stopPropagation();
  applyHoldingSortSelection(state.sortField);
});

if (refs.marketTimestamp) refs.marketTimestamp.addEventListener('click', () => openModal('diagnostics'));

if (refs.incomeOverviewGrid) refs.incomeOverviewGrid.addEventListener('click', (event) => {
  if (event.target.closest('[data-income-cash-settings]')) openModal('openingCash');
});

refs.incomeYearList.addEventListener('click', (event) => {
  const annualTarget = event.target.closest('[data-annual-year]');
  if (annualTarget && !event.target.closest('[data-income-manual-year]')) {
    const year = Math.floor(safeNumber(annualTarget.dataset.annualYear, 0));
    if (year) {
      state.activeAnnualYear = year;
      navigateTo('annual');
    }
    return;
  }
  const btn = event.target.closest('[data-income-manual-year]');
  if (!btn) return;
  const year = Math.floor(safeNumber(btn.dataset.incomeManualYear, 0));
  if (!year) return;
  const existing = state.yearlyManual.find((entry) => entry.year === year);
  openModal('yearlyManual', {
    year,
    dividendCny: existing ? existing.dividendCny : '',
    dividendYieldRatePercent: existing && existing.dividendYieldRate !== null && existing.dividendYieldRate !== undefined ? Math.round(existing.dividendYieldRate * 10000) / 100 : '',
    yearEndNetCny: existing ? existing.yearEndNetCny : '',
    netInflowCny: existing ? existing.netInflowCny : '',
    capitalReturnCny: existing && existing.capitalReturnCny !== null && existing.capitalReturnCny !== undefined ? existing.capitalReturnCny : '',
    capitalReturnRatePercent: existing && existing.capitalReturnRate !== null && existing.capitalReturnRate !== undefined ? Math.round(existing.capitalReturnRate * 10000) / 100 : '',
    existing: Boolean(existing)
  });
});

const annualShareButton = document.getElementById('annualShareButton');
if (annualShareButton) annualShareButton.addEventListener('click', () => generateAnnualShareCard());

if (refs.annualReviewContent) refs.annualReviewContent.addEventListener('click', (event) => {
  const button = event.target.closest('[data-annual-select]');
  if (!button) return;
  const year = Math.floor(safeNumber(button.dataset.annualSelect, 0));
  if (!year || year === state.activeAnnualYear) return;
  state.activeAnnualYear = year;
  saveState();
  renderApp({ incremental: true, animateHoldingReflow: false });
});

if (refs.incomeRecordsList) refs.incomeRecordsList.addEventListener('click', (event) => {
  const cashButton = event.target.closest('[data-cash-flow-id]');
  if (cashButton) {
    const entry = state.cashFlows.find((item) => item && item.id === cashButton.dataset.cashFlowId);
    if (entry) openModal('cashFlow', { ...entry });
    return;
  }
  const tradeButton = event.target.closest('[data-trade-id]');
  if (tradeButton) {
    const entry = state.trades.find((item) => item && item.id === tradeButton.dataset.tradeId);
    if (entry) openModal('trade', { ...entry });
    return;
  }
  const dividendButton = event.target.closest('[data-dividend-source-id]');
  if (dividendButton) openModal('dividendLedger', { sourceId: dividendButton.dataset.dividendSourceId });
});

refs.sortChips.forEach((chip) => {
  chip.addEventListener('click', () => { const f = chip.dataset.sortField; if (!f) return; state.sortMenuOpen = false; applyHoldingSortSelection(f); });
});

document.addEventListener('click', (event) => {
  if (state.sortMenuOpen && !event.target.closest('.sort-group') && !event.target.closest('.sort-toggle-button') && !event.target.closest('#holdingsSortLabel')) { state.sortMenuOpen = false; renderSortChips(); }
  if (mutable.activeDividendTooltipButton && event.target.closest('.dividend-status-button--value') !== mutable.activeDividendTooltipButton) closeActiveDividendTooltip(true);
});

refs.bucketTrack.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-bucket-toggle]'); if (!btn) return;
  const key = btn.dataset.bucketToggle;
  state.activeBucketKey = state.activeBucketKey === key ? null : key;
  const summary = computeHoldings();
  renderBucketsView(getBucketSegments(summary.holdings), summary.holdings, summary, { animateDetail: true });
  renderReturnBar();
});

refs.stockList.addEventListener('mouseover', (e) => { const b = e.target.closest('.dividend-status-button'); if (b) updateDividendTooltipSide(b); });
refs.stockList.addEventListener('focusin', (e) => { const b = e.target.closest('.dividend-status-button'); if (b) updateDividendTooltipSide(b); });
refs.homeHero.addEventListener('click', (e) => { if (e.target.closest('[data-summary-action="liability"]')) openModal('liability', { value: state.liabilityCny > 0 ? String(state.liabilityCny) : '' }); });

refs.stockList.addEventListener('click', (event) => {
  if (Date.now() < mutable.suppressHoldingClickUntil) { event.preventDefault(); event.stopPropagation(); return; }
  const tb = event.target.closest('.dividend-status-button');
  if (tb) { if (tb.classList.contains('dividend-status-button--value')) { event.preventDefault(); event.stopPropagation(); toggleDividendTooltip(tb); return; } updateDividendTooltipSide(tb); }
  const button = event.target.closest('[data-action]'), targetItem = event.target.closest('.holding-card') || event.target.closest('.holding-swipe');
  if (!button || !targetItem) return;
  const localId = safeNumber(targetItem.dataset.id, 0);
  const holding = state.holdings.find((i) => i.localId === localId); if (!holding) return;
  const computed = computeHoldings().holdings.find((i) => i.localId === localId);
  const action = button.dataset.action;
  if (action === 'view-holding') { openModal('holdingDetail', { localId }); return; }
  if (action === 'delete') {
    const name = computed ? computed.name : holding.symbol;
    showConfirm(LABELS.deleteConfirm, { sub: name, okLabel: '\u5220\u9664', danger: true, cancelLabel: LABELS.cancel }).then((confirmed) => {
      if (!confirmed) return;
      const w = refs.stockList.querySelector(`.holding-swipe[data-id="${localId}"]`);
      if (w) {
        const prev = captureHoldingPositions(localId);
        animateHoldingRemoval(w, () => {
          if (mutable.activeDividendTooltipButton && w.contains(mutable.activeDividendTooltipButton)) mutable.activeDividendTooltipButton = null;
          w.remove(); state.holdings = state.holdings.filter((i) => i.localId !== localId); addRecordTombstone('holding', holding.symbol); saveState();
          renderApp({ animateLegend: false, animateBucketDetail: false, animateHoldings: false, renderHoldingsList: false }); animateHoldingReflow(prev);
        });
      } else { state.holdings = state.holdings.filter((i) => i.localId !== localId); addRecordTombstone('holding', holding.symbol); saveState(); renderApp({ animateLegend: false, animateBucketDetail: false, animateHoldings: false, renderHoldingsList: false }); }
    });
    return;
  }
  if (action === 'edit-quantity') {
    // 现金模式下持仓只能通过交易调整，点数量直接开一笔预填该股票的交易。
    if (isCashModelActive()) { openModal('trade', { symbol: holding.symbol }); return; }
    openModal('quantity', { localId, name: computed ? computed.name : holding.symbol, value: holding.quantity }); return;
  }
  if (action === 'edit-tax') { openModal('tax', { localId, name: computed ? computed.name : holding.symbol, value: holding.taxRateOverride }); return; }
  if (action === 'edit-dividend') { openModal('dividend', { localId, name: computed ? computed.name : holding.symbol, currency: computed ? computed.currency : 'HKD', value: holding.dividendPerShareTtmOverride }); }
});

/* ── 二级页左缘右滑返回 ──
   只从屏幕左缘起手；横向意图明确后 1:1 跟手，并结合距离和释放速度决定返回。 */
const EDGE_BACK_START_PX = 28;
const EDGE_BACK_INTENT_PX = 10;
const EDGE_BACK_MIN_DISTANCE_PX = 72;
const EDGE_BACK_MIN_VELOCITY = 520;
let activeEdgeBack = null;

function getActivePageElement() {
  return refs.pageViews.find((view) => !view.hidden) || null;
}

function clearEdgeBackStyles(page) {
  if (!page) return;
  page.style.transform = '';
  page.style.opacity = '';
  page.style.willChange = '';
}

function settleEdgeBack(commit) {
  if (!activeEdgeBack) return;
  const gesture = activeEdgeBack;
  activeEdgeBack = null;
  const page = gesture.page;
  if (!gesture.dragging) { clearEdgeBackStyles(page); return; }
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const startX = Math.max(0, gesture.lastX - gesture.startX);
  const endX = commit ? window.innerWidth : 0;
  const animation = page.animate([
    { transform: reducedMotion ? 'none' : `translate3d(${startX}px, 0, 0)`, opacity: String(Math.max(0.72, 1 - startX / window.innerWidth * 0.24)) },
    { transform: reducedMotion ? 'none' : `translate3d(${endX}px, 0, 0)`, opacity: commit ? '0.76' : '1' }
  ], { duration: reducedMotion ? 1 : (commit ? 190 : 220), easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' });
  animation.finished.then(() => {
    animation.cancel();
    clearEdgeBackStyles(page);
    if (commit) navigateBack();
  }).catch(() => clearEdgeBackStyles(page));
}

document.addEventListener('touchstart', (event) => {
  if (state.activePage === 'home' || state.modal || event.touches.length !== 1) return;
  const touch = event.touches[0];
  if (touch.clientX > EDGE_BACK_START_PX) return;
  const page = getActivePageElement();
  if (!page) return;
  page.getAnimations().forEach((animation) => animation.cancel());
  activeEdgeBack = {
    page,
    startX: touch.clientX,
    startY: touch.clientY,
    lastX: touch.clientX,
    lastTime: performance.now(),
    velocityX: 0,
    dragging: false
  };
}, { passive: true, capture: true });

document.addEventListener('touchmove', (event) => {
  if (!activeEdgeBack || event.touches.length !== 1) return;
  const touch = event.touches[0];
  const dx = touch.clientX - activeEdgeBack.startX;
  const dy = touch.clientY - activeEdgeBack.startY;
  if (!activeEdgeBack.dragging) {
    if (Math.abs(dx) < EDGE_BACK_INTENT_PX && Math.abs(dy) < EDGE_BACK_INTENT_PX) return;
    if (dx <= 0 || Math.abs(dy) >= Math.abs(dx)) { activeEdgeBack = null; return; }
    activeEdgeBack.dragging = true;
    activePagePull = null;
    mutable.activeHoldingSwipe = null;
    activeEdgeBack.page.style.willChange = 'transform, opacity';
  }
  if (event.cancelable) event.preventDefault();
  const now = performance.now();
  const elapsed = Math.max(1, now - activeEdgeBack.lastTime);
  activeEdgeBack.velocityX = (touch.clientX - activeEdgeBack.lastX) / elapsed * 1000;
  activeEdgeBack.lastX = touch.clientX;
  activeEdgeBack.lastTime = now;
  const distance = Math.max(0, dx);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  activeEdgeBack.page.style.transform = reducedMotion ? 'none' : `translate3d(${distance}px, 0, 0)`;
  activeEdgeBack.page.style.opacity = String(Math.max(0.72, 1 - distance / window.innerWidth * 0.24));
}, { passive: false, capture: true });

document.addEventListener('touchend', () => {
  if (!activeEdgeBack) return;
  const distance = Math.max(0, activeEdgeBack.lastX - activeEdgeBack.startX);
  settleEdgeBack(distance >= Math.min(EDGE_BACK_MIN_DISTANCE_PX, window.innerWidth * 0.23)
    || (distance >= 36 && activeEdgeBack.velocityX >= EDGE_BACK_MIN_VELOCITY));
}, { passive: true, capture: true });

document.addEventListener('touchcancel', () => settleEdgeBack(false), { passive: true, capture: true });

/* ── 首页 / 持仓页下拉刷新 ──
   顶部下拉超过阈值松手即刷新；指示器随拉动渐显并旋转，刷新中持续转圈。
   仅支持页面在顶部、无弹窗、非刷新中时接管纵向手势。 */
const PULL_TRIGGER_PX = 56;
const PULL_MAX_PX = 88;
const PULL_HOLD_PX = 44;
const PULL_RESISTANCE = 0.45;
let activePagePull = null;

function getPullIndicator(page) {
  return page === 'holdings' ? refs.holdingsPullIndicator : refs.homePullIndicator;
}

function setPagePullDistance(page, distance, opts = {}) {
  const el = getPullIndicator(page);
  if (!el) return;
  el.classList.toggle('is-dragging', opts.dragging === true);
  el.classList.toggle('is-armed', distance >= PULL_TRIGGER_PX);
  el.style.height = `${Math.max(0, distance)}px`;
  el.style.setProperty('--pull-progress', Math.min(1, distance / PULL_TRIGGER_PX).toFixed(3));
}

document.addEventListener('touchstart', (event) => {
  if (!['home', 'holdings'].includes(state.activePage) || state.modal || state.syncing) return;
  if (window.scrollY > 0 || event.touches.length !== 1) return;
  activePagePull = { page: state.activePage, startY: event.touches[0].clientY, distance: 0, pulling: false };
}, { passive: true });

document.addEventListener('touchmove', (event) => {
  if (!activePagePull) return;
  const dy = event.touches[0].clientY - activePagePull.startY;
  if (!activePagePull.pulling) {
    if (dy < -8 || window.scrollY > 0) { activePagePull = null; return; }
    if (dy < 8) return;
    activePagePull.pulling = true;
  }
  if (event.cancelable) event.preventDefault();
  activePagePull.distance = Math.min(PULL_MAX_PX, Math.max(0, dy) * PULL_RESISTANCE);
  setPagePullDistance(activePagePull.page, activePagePull.distance, { dragging: true });
}, { passive: false });

async function settlePagePull() {
  if (!activePagePull) return;
  const pull = activePagePull;
  const triggered = pull.pulling && pull.distance >= PULL_TRIGGER_PX;
  const wasPulling = pull.pulling;
  activePagePull = null;
  if (!wasPulling) return;
  if (!triggered) { setPagePullDistance(pull.page, 0); return; }
  const el = getPullIndicator(pull.page);
  if (el) el.classList.add('is-refreshing');
  setPagePullDistance(pull.page, PULL_HOLD_PX);
  try { await refreshMarketData({ silent: false }); }
  finally {
    if (el) el.classList.remove('is-refreshing');
    setPagePullDistance(pull.page, 0);
  }
}

document.addEventListener('touchend', () => { void settlePagePull(); }, { passive: true });
document.addEventListener('touchcancel', () => { void settlePagePull(); }, { passive: true });

/* ── Touch / Swipe ── */
refs.stockList.addEventListener('touchstart', (event) => {
  if (!isHoldingSwipeEnabled() || event.touches.length !== 1) return;
  const w = event.target.closest('.holding-swipe'), c = event.target.closest('.holding-card');
  if (!w || !c) return;
  const opened = refs.stockList.querySelector('.holding-swipe.is-swipe-open');
  if (opened && opened !== w) closeHoldingSwipe(opened);
  const t = event.touches[0];
  mutable.activeHoldingSwipe = { wrapper: w, startX: t.clientX, startY: t.clientY, startOffset: getHoldingSwipeOffset(w), dragging: false, didSwipe: false };
}, { passive: true });

refs.stockList.addEventListener('touchmove', (event) => {
  if (!mutable.activeHoldingSwipe || !isHoldingSwipeEnabled()) return;
  const t = event.touches[0], dx = t.clientX - mutable.activeHoldingSwipe.startX, dy = t.clientY - mutable.activeHoldingSwipe.startY;
  if (!mutable.activeHoldingSwipe.dragging) { if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return; if (Math.abs(dy) > Math.abs(dx)) { mutable.activeHoldingSwipe = null; return; } mutable.activeHoldingSwipe.dragging = true; mutable.activeHoldingSwipe.didSwipe = true; }
  event.preventDefault(); setHoldingSwipeOffset(mutable.activeHoldingSwipe.wrapper, mutable.activeHoldingSwipe.startOffset - dx);
}, { passive: false });

function settleHoldingSwipe() {
  if (!mutable.activeHoldingSwipe) return;
  const w = mutable.activeHoldingSwipe.wrapper;
  if (mutable.activeHoldingSwipe.didSwipe) mutable.suppressHoldingClickUntil = Date.now() + SWIPE_SUPPRESS_CLICK_MS;
  if (mutable.activeHoldingSwipe.dragging && getHoldingSwipeOffset(w) >= HOLDING_SWIPE_OPEN_THRESHOLD) openHoldingSwipe(w); else closeHoldingSwipe(w);
  mutable.activeHoldingSwipe = null;
}
refs.stockList.addEventListener('touchend', settleHoldingSwipe, { passive: true });
refs.stockList.addEventListener('touchcancel', settleHoldingSwipe, { passive: true });

/* ── Modal click delegation ── */
refs.modalRoot.addEventListener('click', (event) => {
  const bb = event.target.closest('[data-bucket-option]'); if (bb) { setModalBucketSelection(bb.dataset.bucketOption); return; }
  const cf = event.target.closest('[data-cash-flow-type]'); if (cf) { setModalCashFlowTypeSelection(cf.dataset.cashFlowType); return; }
  const ts = event.target.closest('[data-trade-side]'); if (ts) { setModalTradeSideSelection(ts.dataset.tradeSide); return; }
  const rc = event.target.closest('[data-receipt-currency]'); if (rc) { setModalReceiptCurrency(rc.dataset.receiptCurrency); return; }
  const a = event.target.closest('[data-modal-action]'); if (!a) return;
  const t = a.dataset.modalAction;
  if (t === 'confirm-dividend') { toggleDividendConfirm(a.dataset.sourceId); return; }
  if (t === 'pick-fund-symbol') { selectFundamentalsSymbol(a.dataset.symbol); closeModal(); return; }
  if (t === 'edit-dividend-ledger') {
    const returnMonth = state.modal === 'monthDetail'
      ? Math.floor(safeNumber(state.modalPayload && state.modalPayload.month, 0)) : 0;
    openModal('dividendLedger', { sourceId: a.dataset.sourceId, returnMonth });
    return;
  }
  if (t === 'open-trade') { openModal('trade'); return; }
  if (t === 'open-cash-flow') { openModal('cashFlow'); return; }
  if (t === 'open-current-cash') { openModal('openingCash'); return; }
  if (t === 'holding-diagnostics') { closeModal(); refs.diagnosticsButton.click(); return; }
  if (t === 'holding-refresh') { closeModal(); refs.refreshButton.click(); return; }
  if (t === 'holding-add') { closeModal(); refs.addButton.click(); return; }
  if (t === 'close' || t === 'cancel') { closeModal(); return; }
  if (t === 'delete-yearly-manual') { handleModalDelete(); return; }
  if (t === 'delete-record') { handleModalDelete(); return; }
  if (t === 'delete-dividend-ledger') { handleModalDelete(); return; }
  if (t === 'save') handleModalSave();
});

refs.modalRoot.addEventListener('input', (event) => {
  if (event.target && event.target.id === 'modalTradeSymbolInput') updateTradeQuoteInfo();
  if (event.target && event.target.id === 'modalDividendNetInput') updateReceiptConversion();
});

/* ── Boot ── */
async function boot() {
  try { applySnapshot(createDefaultSnapshot()); restoreState(); renderApp(); }
  catch (error) { console.error('boot render failed, resetting to defaults:', error); applySnapshot(createDefaultSnapshot()); saveState(); renderApp(); }
  await cleanupLegacyCaches();
  void Promise.all([loadFundamentals(), loadReportCalendar()])
    .then(() => renderApp({ animateLegend: false, animateBucketDetail: false, animateHoldings: false }));
  await refreshMarketData({ silent: true });
}

boot();
