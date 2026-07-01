/* ── BOPUP LEDGER — Entry Point ── */
import { state, refs, mutable, saveState, createDefaultSnapshot, applySnapshot, restoreState, showConfirm } from './state.js';
import { safeNumber } from './utils.js';
import {
  UI_TEXT, LABELS, HOLDING_SWIPE_DELETE_WIDTH, HOLDING_SWIPE_OPEN_THRESHOLD,
  SWIPE_SUPPRESS_CLICK_MS, PAGE_KEYS, DIVIDEND_FILTER_KEYS
} from './constants.js';
import { computeHoldings, getBucketSegments, isCashModelActive } from './compute.js';
import {
  renderApp, renderSavedStateQuietly, renderSortChips, renderBucketsView,
  applyLegendExpandState, applyHoldingSortSelection, updateDividendTooltipSide,
  closeActiveDividendTooltip, toggleDividendTooltip, captureHoldingPositions,
  animateHoldingReflow, animateHoldingRemoval, closeHoldingSwipe, openHoldingSwipe,
  isHoldingSwipeEnabled, getHoldingSwipeOffset, setHoldingSwipeOffset
} from './render.js';
import {
  openModal, closeModal, handleModalSave, handleModalDelete,
  setModalBucketSelection, setModalCashFlowTypeSelection,
  setModalTradeSideSelection, toggleDividendConfirm, updateTradeQuoteInfo
} from './modal.js';
import { refreshMarketData, cleanupLegacyCaches } from './network.js';
import { syncPortfolioToCloud, handleImportFile } from './sync.js';

/* ── Sort Toggle Button ── */
function ensureSortToggleButton() {
  if (mutable.sortToggleButton || !refs.iconActions) return mutable.sortToggleButton;
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'circle-button sort-toggle-button';
  btn.setAttribute('aria-label', UI_TEXT.sort); btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6.2v11.6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"></path><path d="M8.6 9.6L12 6.2l3.4 3.4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"></path><path d="M8.6 14.4L12 17.8l3.4-3.4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
  refs.iconActions.insertBefore(btn, refs.refreshButton);
  btn.addEventListener('click', (e) => { e.stopPropagation(); state.sortMenuOpen = !state.sortMenuOpen; renderSortChips(); });
  mutable.sortToggleButton = btn;
  return btn;
}

/* ── UI Chrome ── */
function configureUiChrome() {
  if (refs.appKicker) { refs.appKicker.textContent = 'BEBOP'; if (refs.appKicker.parentElement) refs.appKicker.parentElement.classList.add('app-brand'); }
  if (refs.summaryActions) { refs.summaryActions.classList.add('summary-actions-cluster'); refs.summaryActions.append(refs.exportButton, refs.privacyButton); }
  refs.privacyButton.classList.remove('circle-button'); refs.privacyButton.classList.add('summary-action-button');
  refs.exportButton.className = 'summary-action-button summary-action-button--cloud';
  refs.exportButton.setAttribute('aria-label', '\u540c\u6b65\u5230\u4e91\u7aef'); refs.exportButton.title = '\u540c\u6b65\u5230\u4e91\u7aef';
  refs.exportButton.innerHTML = '<span class="cloud-sync-icon" aria-hidden="true"><svg class="cloud-sync-base" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 17a3.5 3.5 0 0 0-1.6-6.4h-.5A6.2 6.2 0 0 0 6 9.6 4.4 4.4 0 0 0 6.5 18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path></svg><span class="cloud-sync-badge"></span><svg class="cloud-sync-check" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.2 6.4 4.9 9 9.8 3.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg></span>';
  refs.importButton.hidden = true; refs.importButton.setAttribute('aria-hidden', 'true'); refs.importButton.tabIndex = -1;
  const btn = ensureSortToggleButton(); if (btn) btn.hidden = false;
  if (refs.sortGroup && refs.iconActions) {
    refs.sortGroup.classList.remove('sort-group--popover');
    if (refs.sortGroup.parentElement !== refs.iconActions) refs.iconActions.insertBefore(refs.sortGroup, refs.refreshButton);
    else if (refs.refreshButton && refs.sortGroup.nextElementSibling !== refs.refreshButton) refs.iconActions.insertBefore(refs.sortGroup, refs.refreshButton);
  }
}

/* ── Init Chrome ── */
configureUiChrome();

/* ── Event Bindings ── */
refs.privacyButton.addEventListener('click', () => { state.showAmounts = !state.showAmounts; saveState(); renderSavedStateQuietly({ animateHoldingReflow: false }); });
refs.exportButton.addEventListener('click', syncPortfolioToCloud);
refs.importButton.addEventListener('click', () => refs.importFileInput.click());
refs.importFileInput.addEventListener('change', handleImportFile);
refs.legendToggle.addEventListener('click', () => { const t = refs.legendToggle.getBoundingClientRect().top; state.legendExpanded = !state.legendExpanded; saveState(); applyLegendExpandState({ preserveScroll: true, toggleTop: t }); });
refs.refreshButton.addEventListener('click', () => { refreshMarketData({ silent: false }); });
// 现金模式下，首页「+」直接开一笔买入交易（替代旧的新增持仓）；未启用时仍是新增持仓。
refs.addButton.addEventListener('click', () => { openModal(isCashModelActive() ? 'trade' : 'add'); });
refs.incomeManualButton.addEventListener('click', () => { openModal('yearlyManual'); });
if (refs.incomeCashFlowButton) refs.incomeCashFlowButton.addEventListener('click', () => { openModal('cashFlow'); });
if (refs.incomeOpeningCashButton) refs.incomeOpeningCashButton.addEventListener('click', () => { openModal('openingCash'); });
if (refs.incomeOpeningCashButtonFold) refs.incomeOpeningCashButtonFold.addEventListener('click', () => { openModal('openingCash'); });

refs.bottomNav.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-page-nav]');
  if (!btn || !PAGE_KEYS.has(btn.dataset.pageNav)) return;
  if (state.activePage === btn.dataset.pageNav) return;
  closeActiveDividendTooltip(true);
  state.activePage = btn.dataset.pageNav;
  state.sortMenuOpen = false;
  saveState();
  renderApp({ incremental: true, animateHoldingReflow: false });
  window.scrollTo({ top: 0, behavior: 'smooth' });
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
  const btn = event.target.closest('[data-dividend-month]');
  if (!btn) return;
  const month = Math.floor(safeNumber(btn.dataset.dividendMonth, 0));
  if (month < 1 || month > 12) return;
  openModal('monthDetail', { month });
});

refs.incomeYearList.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-income-manual-year]');
  if (!btn) return;
  const year = Math.floor(safeNumber(btn.dataset.incomeManualYear, 0));
  if (!year) return;
  const existing = state.yearlyManual.find((entry) => entry.year === year);
  openModal('yearlyManual', {
    year,
    dividendCny: existing ? existing.dividendCny : '',
    yearEndNetCny: existing ? existing.yearEndNetCny : '',
    netInflowCny: existing ? existing.netInflowCny : '',
    existing: Boolean(existing)
  });
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
  }
});

refs.sortChips.forEach((chip) => {
  chip.addEventListener('click', () => { const f = chip.dataset.sortField; if (!f || !state.sortMenuOpen) return; state.sortMenuOpen = false; applyHoldingSortSelection(f); });
});

document.addEventListener('click', (event) => {
  if (state.sortMenuOpen && !event.target.closest('.sort-group') && !event.target.closest('.sort-toggle-button')) { state.sortMenuOpen = false; renderSortChips(); }
  if (mutable.activeDividendTooltipButton && event.target.closest('.dividend-status-button--value') !== mutable.activeDividendTooltipButton) closeActiveDividendTooltip(true);
});

refs.bucketTrack.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-bucket-toggle]'); if (!btn) return;
  const key = btn.dataset.bucketToggle;
  state.activeBucketKey = state.activeBucketKey === key ? null : key;
  const summary = computeHoldings();
  renderBucketsView(getBucketSegments(summary.holdings), summary.holdings, summary, { animateDetail: true });
});

refs.stockList.addEventListener('mouseover', (e) => { const b = e.target.closest('.dividend-status-button'); if (b) updateDividendTooltipSide(b); });
refs.stockList.addEventListener('focusin', (e) => { const b = e.target.closest('.dividend-status-button'); if (b) updateDividendTooltipSide(b); });
refs.summaryGrid.addEventListener('click', (e) => { if (e.target.closest('[data-summary-action="liability"]')) openModal('liability', { value: state.liabilityCny > 0 ? String(state.liabilityCny) : '' }); });

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
  if (action === 'delete') {
    const name = computed ? computed.name : holding.symbol;
    showConfirm(LABELS.deleteConfirm, { sub: name, okLabel: '\u5220\u9664', danger: true, cancelLabel: LABELS.cancel }).then((confirmed) => {
      if (!confirmed) return;
      const w = refs.stockList.querySelector(`.holding-swipe[data-id="${localId}"]`);
      if (w) {
        const prev = captureHoldingPositions(localId);
        animateHoldingRemoval(w, () => {
          if (mutable.activeDividendTooltipButton && w.contains(mutable.activeDividendTooltipButton)) mutable.activeDividendTooltipButton = null;
          w.remove(); state.holdings = state.holdings.filter((i) => i.localId !== localId); saveState();
          renderApp({ animateLegend: false, animateBucketDetail: false, animateHoldings: false, renderHoldingsList: false }); animateHoldingReflow(prev);
        });
      } else { state.holdings = state.holdings.filter((i) => i.localId !== localId); saveState(); renderApp({ animateLegend: false, animateBucketDetail: false, animateHoldings: false, renderHoldingsList: false }); }
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
  const a = event.target.closest('[data-modal-action]'); if (!a) return;
  const t = a.dataset.modalAction;
  if (t === 'confirm-dividend') { toggleDividendConfirm(a.dataset.sourceId); return; }
  if (t === 'edit-dividend-ledger') { openModal('dividendLedger', { sourceId: a.dataset.sourceId }); return; }
  if (t === 'close' || t === 'cancel') { closeModal(); return; }
  if (t === 'delete-yearly-manual') { handleModalDelete(); return; }
  if (t === 'delete-record') { handleModalDelete(); return; }
  if (t === 'save') handleModalSave();
});

refs.modalRoot.addEventListener('input', (event) => {
  if (event.target && event.target.id === 'modalTradeSymbolInput') updateTradeQuoteInfo();
});

/* ── Boot ── */
async function boot() {
  try { applySnapshot(createDefaultSnapshot()); restoreState(); renderApp(); }
  catch (error) { console.error('boot render failed, resetting to defaults:', error); applySnapshot(createDefaultSnapshot()); saveState(); renderApp(); }
  await cleanupLegacyCaches();
  await refreshMarketData({ silent: true });
}

boot();
