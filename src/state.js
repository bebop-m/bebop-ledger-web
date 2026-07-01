import {
  DEFAULT_RATES, DEFAULT_HOLDINGS, SEED_QUOTES, STORAGE_KEY,
  LABELS, TOAST_DEFAULT_DURATION_MS, CONFIRM_CLOSE_DELAY_MS,
  PORTFOLIO_SNAPSHOT_VERSION, PAGE_KEYS, DIVIDEND_FILTER_KEYS
} from './constants.js';
import {
  safeNumber, clone, escapeHtml, normalizeSeedQuoteMap, mergeQuotes,
  sanitizeHolding, sanitizePerShareOverrideInput, normalizeSymbol,
  sanitizeDividendLedgerEntry, sanitizeDailySnapshotEntry,
  sanitizeCashFlowEntry, sanitizeYearlyManualEntry, sanitizeTradeEntry
} from './utils.js';

/* ── Default Quotes (normalized from seed data) ── */
export const DEFAULT_QUOTES = normalizeSeedQuoteMap(SEED_QUOTES);

/* ── Application State ── */
export const state = {
  holdings: [],
  quotes: {},
  rates: { ...DEFAULT_RATES },
  nextId: 1,
  showAmounts: true,
  activePage: 'assets',
  dividendCalendarBucket: 'all',
  activeDividendMonth: null,
  sortField: 'marketValueCny',
  sortDirection: 'desc',
  legendExpanded: false,
  liabilityCny: 0,
  openingCashCny: 0,
  openingDate: '',
  dividendLedger: [],
  dailySnapshots: [],
  cashFlows: [],
  trades: [],
  yearlyManual: [],
  lastUpdatedAt: '',
  modal: null,
  modalPayload: null,
  syncing: false,
  cloudSyncing: false,
  activeBucketKey: null,
  sortMenuOpen: false
};

/* ── Shared mutable state across modules ── */
export const mutable = {
  activeHoldingSwipe: null,
  activeDividendTooltipButton: null,
  suppressHoldingClickUntil: 0,
  cloudSyncSuccessTimer: 0,
  sortToggleButton: null
};

/* ── Compute Cache ── */
let _computeGeneration = 0;
let _computeCache = null;
let _computeCacheGeneration = -1;

export function invalidateComputeCache() { _computeGeneration += 1; }
export function getComputeCache() {
  return _computeCacheGeneration === _computeGeneration ? _computeCache : null;
}
export function setComputeCache(result) {
  _computeCache = result;
  _computeCacheGeneration = _computeGeneration;
}

/* ── DOM Refs ── */
export const refs = {
  privacyButton: document.getElementById('privacyButton'),
  pageViews: Array.from(document.querySelectorAll('[data-page-view]')),
  bottomNav: document.getElementById('bottomNav'),
  bottomNavButtons: Array.from(document.querySelectorAll('[data-page-nav]')),
  dividendCalendarYear: document.getElementById('dividendCalendarYear'),
  dividendFilterGroup: document.getElementById('dividendFilterGroup'),
  dividendFilterButtons: Array.from(document.querySelectorAll('[data-dividend-filter]')),
  incomeSummaryPage: document.getElementById('incomeSummaryPage'),
  incomeManualButton: document.getElementById('incomeManualButton'),
  incomeCashFlowButton: document.getElementById('incomeCashFlowButton'),
  incomeOpeningCashButton: document.getElementById('incomeOpeningCashButton'),
  incomeOpeningCashButtonFold: document.getElementById('incomeOpeningCashButtonFold'),
  incomeOverviewGrid: document.getElementById('incomeOverviewGrid'),
  incomeTrend: document.getElementById('incomeTrend'),
  incomeYearList: document.getElementById('incomeYearList'),
  incomeRecordsList: document.getElementById('incomeRecordsList'),
  dividendMetricGrid: document.getElementById('dividendMetricGrid'),
  dividendMonthGrid: document.getElementById('dividendMonthGrid'),
  exportButton: document.getElementById('exportButton'),
  importButton: document.getElementById('importButton'),
  importFileInput: document.getElementById('importFileInput'),
  appKicker: document.querySelector('.app-kicker'),
  summaryActions: document.querySelector('.panel-bar--spread .text-actions'),
  summaryGrid: document.getElementById('summaryGrid'),
  companyLegend: document.getElementById('companyLegend'),
  legendToggle: document.getElementById('legendToggle'),
  bucketTrack: document.getElementById('bucketTrack'),
  chartLayout: document.querySelector('.chart-layout'),
  marketTimestamp: document.getElementById('marketTimestamp'),
  refreshButton: document.getElementById('refreshButton'),
  addButton: document.getElementById('addButton'),
  iconActions: document.querySelector('.icon-actions'),
  stockList: document.getElementById('stockList'),
  modalRoot: document.getElementById('modalRoot'),
  confirmRoot: document.getElementById('confirmRoot'),
  toastContainer: document.getElementById('toastContainer'),
  sortGroup: document.querySelector('.sort-group'),
  sortChips: Array.from(document.querySelectorAll('.sort-chip'))
};

/* ── Toast & Confirm ── */
export function showToast(message, options = {}) {
  const { type = 'info', duration = TOAST_DEFAULT_DURATION_MS } = options;
  const el = document.createElement('div');
  el.className = `toast${type === 'error' ? ' is-error' : type === 'success' ? ' is-success' : ''}`;
  el.textContent = message;
  refs.toastContainer.appendChild(el);
  setTimeout(() => {
    el.classList.add('is-leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, duration);
}

export function showConfirm(message, options = {}) {
  const { sub = '', okLabel, cancelLabel, danger = false } = options;
  return new Promise((resolve) => {
    const okText = okLabel || LABELS.save || '\u786e\u8ba4';
    const cancelText = cancelLabel || LABELS.cancel || '\u53d6\u6d88';
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    refs.confirmRoot.innerHTML = `
      <div class="confirm-mask"></div>
      <section class="confirm-sheet${danger ? ' is-danger' : ''}" role="alertdialog" aria-modal="true" aria-labelledby="confirmMessage" aria-describedby="${sub ? 'confirmSub' : 'confirmMessage'}">
        <p class="confirm-message" id="confirmMessage">${escapeHtml(message)}</p>
        ${sub ? `<p class="confirm-sub" id="confirmSub">${escapeHtml(sub)}</p>` : ''}
        <div class="confirm-actions">
          <button class="confirm-button confirm-button--cancel" type="button" data-confirm="cancel">${escapeHtml(cancelText)}</button>
          <button class="confirm-button ${danger ? 'confirm-button--danger' : 'confirm-button--ok'}" type="button" data-confirm="ok">${escapeHtml(okText)}</button>
        </div>
      </section>
    `;
    document.body.classList.add('modal-open');
    let settled = false;
    function cleanup(result) {
      if (settled) return;
      settled = true;
      refs.confirmRoot.removeEventListener('click', handleClick);
      document.removeEventListener('keydown', handleKeydown, true);
      const mask = refs.confirmRoot.querySelector('.confirm-mask');
      const sheet = refs.confirmRoot.querySelector('.confirm-sheet');
      if (mask && sheet) {
        refs.confirmRoot.querySelectorAll('.confirm-button').forEach((b) => { b.disabled = true; });
        sheet.classList.add(result ? 'is-confirmed' : 'is-cancelled');
        window.setTimeout(() => { mask.classList.add('is-closing'); sheet.classList.add('is-closing'); }, CONFIRM_CLOSE_DELAY_MS);
        sheet.addEventListener('animationend', () => {
          refs.confirmRoot.innerHTML = '';
          document.body.classList.remove('modal-open');
          previousFocus && previousFocus.focus({ preventScroll: true });
          resolve(result);
        }, { once: true });
      } else {
        refs.confirmRoot.innerHTML = '';
        document.body.classList.remove('modal-open');
        previousFocus && previousFocus.focus({ preventScroll: true });
        resolve(result);
      }
    }
    function handleClick(event) {
      if (event.target.closest('.confirm-mask')) { cleanup(false); return; }
      const btn = event.target.closest('[data-confirm]');
      if (btn) cleanup(btn.dataset.confirm === 'ok');
    }
    function handleKeydown(event) {
      if (event.key === 'Escape') { event.preventDefault(); cleanup(false); }
    }
    refs.confirmRoot.addEventListener('click', handleClick);
    document.addEventListener('keydown', handleKeydown, true);
    requestAnimationFrame(() => {
      const target = refs.confirmRoot.querySelector('[data-confirm="cancel"]') || refs.confirmRoot.querySelector('[data-confirm="ok"]');
      target && target.focus({ preventScroll: true });
    });
  });
}

/* ── Snapshot & Persistence ── */
export function createDefaultSnapshot() {
  return {
    type: 'portfolio-snapshot',
    version: PORTFOLIO_SNAPSHOT_VERSION,
    holdings: clone(DEFAULT_HOLDINGS),
    quotes: clone(DEFAULT_QUOTES),
    rates: { ...DEFAULT_RATES },
    nextId: DEFAULT_HOLDINGS.length + 1,
    showAmounts: true,
    activePage: 'assets',
    dividendCalendarBucket: 'all',
    activeDividendMonth: null,
    sortField: 'marketValueCny',
    sortDirection: 'desc',
    legendExpanded: false,
    liabilityCny: 0,
    openingCashCny: 0,
    openingDate: '',
    dividendLedger: [],
    dailySnapshots: [],
    cashFlows: [],
    trades: [],
    yearlyManual: [],
    lastUpdatedAt: ''
  };
}

export function applySnapshot(snapshot) {
  invalidateComputeCache();
  const defaults = createDefaultSnapshot();
  const mergedQuotes = mergeQuotes(clone(defaults.quotes), snapshot && snapshot.quotes);
  const sanitizedHoldings = Array.isArray(snapshot && snapshot.holdings)
    ? snapshot.holdings.map((item, index) => sanitizeHolding(item, index, mergedQuotes)).filter(Boolean)
    : defaults.holdings;
  const maxLocalId = sanitizedHoldings.reduce((max, item) => Math.max(max, item.localId), 0);
  state.holdings = sanitizedHoldings.length ? sanitizedHoldings : clone(defaults.holdings);
  state.quotes = mergedQuotes;
  state.rates = { ...DEFAULT_RATES, ...((snapshot && snapshot.rates) || {}) };
  state.nextId = Math.max(maxLocalId + 1, Math.floor(safeNumber(snapshot && snapshot.nextId, defaults.nextId)));
  state.showAmounts = snapshot && snapshot.showAmounts === false ? false : true;
  state.activePage = PAGE_KEYS.has(snapshot && snapshot.activePage) ? snapshot.activePage : 'assets';
  state.dividendCalendarBucket = DIVIDEND_FILTER_KEYS.has(snapshot && snapshot.dividendCalendarBucket) ? snapshot.dividendCalendarBucket : 'all';
  const activeDividendMonth = Math.floor(safeNumber(snapshot && snapshot.activeDividendMonth, 0));
  state.activeDividendMonth = activeDividendMonth >= 1 && activeDividendMonth <= 12 ? activeDividendMonth : null;
  state.sortField = snapshot && ['effectiveYield', 'netAnnualDividendCny'].includes(snapshot.sortField) ? snapshot.sortField : 'marketValueCny';
  state.sortDirection = snapshot && snapshot.sortDirection === 'asc' ? 'asc' : 'desc';
  state.legendExpanded = Boolean(snapshot && snapshot.legendExpanded);
  state.liabilityCny = Math.max(0, safeNumber(snapshot && snapshot.liabilityCny, 0));
  state.openingCashCny = safeNumber(snapshot && snapshot.openingCashCny, 0);
  state.openingDate = typeof (snapshot && snapshot.openingDate) === 'string' ? snapshot.openingDate : '';
  state.dividendLedger = Array.isArray(snapshot && snapshot.dividendLedger)
    ? snapshot.dividendLedger.map(sanitizeDividendLedgerEntry).filter(Boolean)
    : [];
  state.dailySnapshots = Array.isArray(snapshot && snapshot.dailySnapshots)
    ? snapshot.dailySnapshots.map(sanitizeDailySnapshotEntry).filter(Boolean)
    : [];
  state.cashFlows = Array.isArray(snapshot && snapshot.cashFlows)
    ? snapshot.cashFlows.map(sanitizeCashFlowEntry).filter(Boolean)
    : [];
  state.trades = Array.isArray(snapshot && snapshot.trades)
    ? snapshot.trades.map(sanitizeTradeEntry).filter(Boolean)
    : [];
  state.yearlyManual = Array.isArray(snapshot && snapshot.yearlyManual)
    ? snapshot.yearlyManual.map(sanitizeYearlyManualEntry).filter(Boolean)
    : [];
  state.lastUpdatedAt = typeof (snapshot && snapshot.lastUpdatedAt) === 'string' ? snapshot.lastUpdatedAt : '';
}

export function getPersistedSnapshot() {
  return {
    type: 'portfolio-snapshot', version: PORTFOLIO_SNAPSHOT_VERSION,
    holdings: state.holdings, quotes: state.quotes, rates: state.rates,
    nextId: state.nextId, showAmounts: state.showAmounts, activePage: state.activePage,
    dividendCalendarBucket: state.dividendCalendarBucket, activeDividendMonth: state.activeDividendMonth, sortField: state.sortField,
    sortDirection: state.sortDirection, legendExpanded: state.legendExpanded,
    liabilityCny: state.liabilityCny, openingCashCny: state.openingCashCny, openingDate: state.openingDate,
    dividendLedger: state.dividendLedger,
    dailySnapshots: state.dailySnapshots, cashFlows: state.cashFlows,
    trades: state.trades, yearlyManual: state.yearlyManual,
    lastUpdatedAt: state.lastUpdatedAt
  };
}

export function saveState() {
  invalidateComputeCache();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(getPersistedSnapshot()));
}

export function restoreState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!saved || typeof saved !== 'object') throw new Error('invalid state');
    applySnapshot(saved);
    saveState();
    return true;
  } catch (_error) {
    applySnapshot(createDefaultSnapshot());
    return false;
  }
}

export function buildPortfolioSnapshotHolding(holding) {
  const quantity = Math.max(0, safeNumber(holding && holding.quantity != null ? holding.quantity : holding && holding.shares, 0));
  const dpsOverride = sanitizePerShareOverrideInput(holding && holding.dividendPerShareTtmOverride);
  return {
    localId: Math.max(1, Math.floor(safeNumber(holding && holding.localId, 1))),
    symbol: normalizeSymbol(holding && holding.symbol),
    quantity, shares: quantity,
    accountType: holding && typeof holding.accountType === 'string' && holding.accountType.trim() ? holding.accountType.trim() : 'default',
    bucket: holding && holding.bucket === 'income' ? 'income' : 'core',
    taxRateOverride: holding && holding.taxRateOverride != null ? String(holding.taxRateOverride) : '',
    dividendPerShareTtmOverride: dpsOverride,
    dividendPerShareTtmOverrideTouched: holding && holding.dividendPerShareTtmOverrideTouched === true && dpsOverride !== ''
  };
}

export function buildPortfolioSnapshot() {
  const persisted = getPersistedSnapshot();
  const holdings = Array.isArray(persisted.holdings)
    ? persisted.holdings.map(buildPortfolioSnapshotHolding).filter((item) => item.symbol)
    : [];
  return {
    type: 'portfolio-snapshot',
    version: PORTFOLIO_SNAPSHOT_VERSION,
    updatedAt: new Date().toISOString(),
    holdings,
    dividendLedger: Array.isArray(persisted.dividendLedger)
      ? persisted.dividendLedger.map(sanitizeDividendLedgerEntry).filter(Boolean)
      : [],
    dailySnapshots: Array.isArray(persisted.dailySnapshots)
      ? persisted.dailySnapshots.map(sanitizeDailySnapshotEntry).filter(Boolean)
      : [],
    cashFlows: Array.isArray(persisted.cashFlows)
      ? persisted.cashFlows.map(sanitizeCashFlowEntry).filter(Boolean)
      : [],
    trades: Array.isArray(persisted.trades)
      ? persisted.trades.map(sanitizeTradeEntry).filter(Boolean)
      : [],
    yearlyManual: Array.isArray(persisted.yearlyManual)
      ? persisted.yearlyManual.map(sanitizeYearlyManualEntry).filter(Boolean)
      : [],
    nextId: Math.max(holdings.reduce((max, item) => Math.max(max, item.localId), 0) + 1, Math.floor(safeNumber(persisted.nextId, 1))),
    showAmounts: persisted.showAmounts !== false,
    sortField: ['effectiveYield', 'netAnnualDividendCny'].includes(persisted.sortField) ? persisted.sortField : 'marketValueCny',
    sortDirection: persisted.sortDirection === 'asc' ? 'asc' : 'desc',
    legendExpanded: Boolean(persisted.legendExpanded),
    liabilityCny: Math.max(0, safeNumber(persisted.liabilityCny, 0)),
    openingCashCny: safeNumber(persisted.openingCashCny, 0),
    openingDate: typeof persisted.openingDate === 'string' ? persisted.openingDate : '',
    lastUpdatedAt: typeof persisted.lastUpdatedAt === 'string' ? persisted.lastUpdatedAt : ''
  };
}
