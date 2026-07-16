import {
  DEFAULT_RATES, DEFAULT_HOLDINGS, SEED_QUOTES, STORAGE_KEY,
  LABELS, TOAST_DEFAULT_DURATION_MS, CONFIRM_CLOSE_DELAY_MS,
  PORTFOLIO_SNAPSHOT_VERSION, PAGE_KEYS, LEGACY_PAGE_MAP, DIVIDEND_FILTER_KEYS
} from './constants.js';
import {
  safeNumber, clone, escapeHtml, normalizeSeedQuoteMap, mergeQuotes,
  sanitizeHolding, sanitizePerShareOverrideInput, normalizeSymbol,
  sanitizeDividendLedgerEntry, sanitizeDailySnapshotEntry,
  sanitizeCashFlowEntry, sanitizeYearlyManualEntry, sanitizeTradeEntry,
  sanitizeYearlyHoldingsEntry, sanitizeYearlyArchiveEntry
} from './utils.js';

/* ── Default Quotes (normalized from seed data) ── */
export const DEFAULT_QUOTES = normalizeSeedQuoteMap(SEED_QUOTES);

const DEMO_STORAGE_KEY = `${STORAGE_KEY}:demo-v1`;

export function isDemoMode() {
  return typeof window !== 'undefined' && /(?:^|[?&])demo=1(?:&|$)/.test(window.location.search);
}

function getActiveStorageKey() {
  return isDemoMode() ? DEMO_STORAGE_KEY : STORAGE_KEY;
}

/* ── Application State ── */
export const state = {
  holdings: [],
  quotes: {},
  rates: { ...DEFAULT_RATES },
  nextId: 1,
  showAmounts: true,
  activePage: 'home',
  dividendCalendarBucket: 'all',
  activeDividendMonth: null,
  activeAnnualYear: new Date().getFullYear(),
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
  yearlyArchives: [],
  yearlyHoldings: [],
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
  homeHero: document.getElementById('homeHero'),
  homeFocusCard: document.getElementById('homeFocusCard'),
  homeNavList: document.getElementById('homeNavList'),
  pageBackButtons: Array.from(document.querySelectorAll('[data-page-back]')),
  quickAddButton: document.getElementById('quickAddButton'),
  dividendCalendarYear: document.getElementById('dividendCalendarYear'),
  dividendFilterGroup: document.getElementById('dividendFilterGroup'),
  dividendFilterButtons: Array.from(document.querySelectorAll('[data-dividend-filter]')),
  incomeSummaryPage: document.getElementById('incomeSummaryPage'),
  incomeManualButton: document.getElementById('incomeManualButton'),
  incomeCashFlowButton: document.getElementById('incomeCashFlowButton'),
  incomeOpeningCashButton: document.getElementById('incomeOpeningCashButton'),
  incomeOverviewGrid: document.getElementById('incomeOverviewGrid'),
  incomeTrend: document.getElementById('incomeTrend'),
  incomeYearList: document.getElementById('incomeYearList'),
  annualReviewContent: document.getElementById('annualReviewContent'),
  incomeRecordsList: document.getElementById('incomeRecordsList'),
  fundamentalsNote: document.getElementById('fundamentalsNote'),
  reportCalendarPanel: document.getElementById('reportCalendarPanel'),
  fundamentalsContent: document.getElementById('fundamentalsContent'),
  dividendMetricGrid: document.getElementById('dividendMetricGrid'),
  dividendMonthGrid: document.getElementById('dividendMonthGrid'),
  dividendCalendarListView: document.getElementById('dividendCalendarListView'),
  dividendMonthDetailView: document.getElementById('dividendMonthDetailView'),
  exportButton: document.getElementById('exportButton'),
  importButton: document.getElementById('importButton'),
  importFileInput: document.getElementById('importFileInput'),
  companyLegend: document.getElementById('companyLegend'),
  legendToggle: document.getElementById('legendToggle'),
  bucketTrack: document.getElementById('bucketTrack'),
  holdingsReturnBar: document.getElementById('holdingsReturnBar'),
  diagnosticsButton: document.getElementById('diagnosticsButton'),
  marketTimestamp: document.getElementById('marketTimestamp'),
  refreshButton: document.getElementById('refreshButton'),
  homePullIndicator: document.getElementById('homePullIndicator'),
  addButton: document.getElementById('addButton'),
  stockList: document.getElementById('stockList'),
  modalRoot: document.getElementById('modalRoot'),
  confirmRoot: document.getElementById('confirmRoot'),
  toastContainer: document.getElementById('toastContainer'),
  sortGroup: document.querySelector('.sort-group'),
  sortChips: Array.from(document.querySelectorAll('.sort-chip')),
  holdingsSortLabel: document.getElementById('holdingsSortLabel')
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
    activePage: 'home',
    dividendCalendarBucket: 'all',
    activeDividendMonth: null,
    activeAnnualYear: new Date().getFullYear(),
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
    yearlyArchives: [],
    yearlyHoldings: [],
    lastUpdatedAt: ''
  };
}

export function createDemoSnapshot() {
  const snapshot = createDefaultSnapshot();
  const year = new Date().getFullYear();
  const previousYear = year - 1;
  const openingYear = year - 2;
  return {
    ...snapshot,
    openingCashCny: 160000,
    openingDate: `${openingYear}-01-01`,
    cashFlows: [
      { id: 'demo_cf_1', date: `${previousYear}-01-10`, amountCny: 60000, type: 'deposit', note: '年度追加资金' },
      { id: 'demo_cf_2', date: `${previousYear}-08-05`, amountCny: 12000, type: 'withdrawal', note: '提取备用金' },
      { id: 'demo_cf_3', date: `${year}-02-15`, amountCny: 30000, type: 'deposit', note: '新增投资资金' },
      { id: 'demo_cf_4', date: `${year}-06-18`, amountCny: 8000, type: 'withdrawal', note: '阶段性取用' }
    ],
    trades: [
      { id: 'demo_tr_1', date: `${previousYear}-01-15`, symbol: '00700.HK', side: 'buy', shares: 400, price: 380, currency: 'HKD', fxRate: 0.92, feeCny: 28, bucket: 'core', note: '建立腾讯底仓' },
      { id: 'demo_tr_2', date: `${previousYear}-02-10`, symbol: '600519.SH', side: 'buy', shares: 20, price: 1480, currency: 'CNY', fxRate: 1, feeCny: 12, bucket: 'core', note: '分批买入' },
      { id: 'demo_tr_3', date: `${previousYear}-08-18`, symbol: '00700.HK', side: 'sell', shares: 100, price: 450, currency: 'HKD', fxRate: 0.92, feeCny: 24, bucket: 'core', note: '阶段止盈' },
      { id: 'demo_tr_4', date: `${year}-03-08`, symbol: 'PDD', side: 'buy', shares: 120, price: 105, currency: 'USD', fxRate: 7.22, feeCny: 36, bucket: 'income', note: '新增观察仓' },
      { id: 'demo_tr_5', date: `${year}-05-22`, symbol: 'PDD', side: 'sell', shares: 40, price: 125, currency: 'USD', fxRate: 7.22, feeCny: 24, bucket: 'income', note: '减仓锁定收益' },
      { id: 'demo_tr_6', date: `${year}-07-16`, symbol: '00700.HK', side: 'sell', shares: 100, price: 489, currency: 'HKD', fxRate: 0.92, feeCny: 20, bucket: 'core', note: '腾讯减仓' }
    ],
    yearlyManual: [
      { year: openingYear, dividendCny: 5800, yearEndNetCny: 205000, netInflowCny: 0, capitalReturnCny: 11000, capitalReturnRate: 0.0567 },
      { year: previousYear, dividendCny: 7395.28, yearEndNetCny: 267200, netInflowCny: 48000, capitalReturnCny: 14200, capitalReturnRate: 0.069268 },
      { year, dividendCny: 4200, yearEndNetCny: 308300, netInflowCny: 22000, capitalReturnCny: 19100, capitalReturnRate: 0.071482 }
    ]
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
  // 旧快照的 activePage 键（如 'assets'）映射到新信息架构。
  const rawPage = snapshot && snapshot.activePage;
  const mappedPage = LEGACY_PAGE_MAP[rawPage] || rawPage;
  state.activePage = PAGE_KEYS.has(mappedPage) ? mappedPage : 'home';
  state.dividendCalendarBucket = DIVIDEND_FILTER_KEYS.has(snapshot && snapshot.dividendCalendarBucket) ? snapshot.dividendCalendarBucket : 'all';
  const activeDividendMonth = Math.floor(safeNumber(snapshot && snapshot.activeDividendMonth, 0));
  state.activeDividendMonth = activeDividendMonth >= 1 && activeDividendMonth <= 12 ? activeDividendMonth : null;
  const activeAnnualYear = Math.floor(safeNumber(snapshot && snapshot.activeAnnualYear, new Date().getFullYear()));
  state.activeAnnualYear = activeAnnualYear >= 1900 && activeAnnualYear <= 2200 ? activeAnnualYear : new Date().getFullYear();
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
  const legacyYearly = Array.isArray(snapshot && snapshot.yearlyManual) ? snapshot.yearlyManual : [];
  const explicitArchives = Array.isArray(snapshot && snapshot.yearlyArchives) ? snapshot.yearlyArchives : [];
  state.yearlyManual = legacyYearly
    .filter((item) => !item || item.source !== 'auto')
    .map(sanitizeYearlyManualEntry)
    .filter(Boolean);
  state.yearlyArchives = explicitArchives
    .concat(legacyYearly.filter((item) => item && item.source === 'auto'))
    .map(sanitizeYearlyArchiveEntry)
    .filter(Boolean)
    .filter((entry, index, rows) => rows.findIndex((item) => item.year === entry.year) === index);
  state.yearlyHoldings = Array.isArray(snapshot && snapshot.yearlyHoldings)
    ? snapshot.yearlyHoldings.map(sanitizeYearlyHoldingsEntry).filter(Boolean)
    : [];
  state.lastUpdatedAt = typeof (snapshot && snapshot.lastUpdatedAt) === 'string' ? snapshot.lastUpdatedAt : '';
}

export function getPersistedSnapshot() {
  return {
    type: 'portfolio-snapshot', version: PORTFOLIO_SNAPSHOT_VERSION,
    holdings: state.holdings, quotes: state.quotes, rates: state.rates,
    nextId: state.nextId, showAmounts: state.showAmounts, activePage: state.activePage,
    dividendCalendarBucket: state.dividendCalendarBucket, activeDividendMonth: state.activeDividendMonth,
    activeAnnualYear: state.activeAnnualYear, sortField: state.sortField,
    sortDirection: state.sortDirection, legendExpanded: state.legendExpanded,
    liabilityCny: state.liabilityCny, openingCashCny: state.openingCashCny, openingDate: state.openingDate,
    dividendLedger: state.dividendLedger,
    dailySnapshots: state.dailySnapshots, cashFlows: state.cashFlows,
    trades: state.trades, yearlyManual: state.yearlyManual, yearlyArchives: state.yearlyArchives,
    yearlyHoldings: state.yearlyHoldings,
    lastUpdatedAt: state.lastUpdatedAt
  };
}

export function saveState() {
  invalidateComputeCache();
  localStorage.setItem(getActiveStorageKey(), JSON.stringify(getPersistedSnapshot()));
}

export function restoreState() {
  try {
    const saved = JSON.parse(localStorage.getItem(getActiveStorageKey()) || 'null');
    if ((!saved || typeof saved !== 'object') && isDemoMode()) {
      applySnapshot(createDemoSnapshot());
      saveState();
      return true;
    }
    if (!saved || typeof saved !== 'object') throw new Error('invalid state');
    applySnapshot(saved);
    saveState();
    return true;
  } catch (_error) {
    applySnapshot(isDemoMode() ? createDemoSnapshot() : createDefaultSnapshot());
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
    yearlyArchives: Array.isArray(persisted.yearlyArchives)
      ? persisted.yearlyArchives.map(sanitizeYearlyArchiveEntry).filter(Boolean)
      : [],
    yearlyHoldings: Array.isArray(persisted.yearlyHoldings)
      ? persisted.yearlyHoldings.map(sanitizeYearlyHoldingsEntry).filter(Boolean)
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
