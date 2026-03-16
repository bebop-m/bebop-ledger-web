const STORAGE_KEY = 'bopup-ledger-web-state';
const MARKET_ENDPOINT = './data/market.json';
const OVERRIDE_ENDPOINT = './data/override.json';
const CONFIG_ENDPOINT = './config.json';
const PORTFOLIO_SNAPSHOT_FILENAME = 'portfolio_snapshot.json';
const GITHUB_MARKET_CONTENTS_API = 'https://api.github.com/repos/bebop-m/bopup-ledger-web/contents/data/market.json';
const TENCENT_REALTIME_ENDPOINT = 'https://qt.gtimg.cn/q=';
const TENCENT_BATCH_SIZE = 60;
const LEGEND_COLLAPSED_COUNT = 8;
const MASK_AMOUNT = '******';
const MASK_PRICE = '***.**';
const DEFAULT_STALE_DAYS = 7;
const VALID_DIVIDEND_SOURCES = new Set(['yfinance', 'yahoo', 'eodhd', 'manual', 'cache']);
const VALID_DIVIDEND_STATUSES = new Set(['manual', 'fresh', 'stale', 'missing']);
let currentDividendStaleDays = DEFAULT_STALE_DAYS;
let activeHoldingSwipe = null;
let activeDividendTooltipButton = null;
let suppressHoldingClickUntil = 0;

// Each UI refinement block stays behind its own flag for quick rollback.
const UI_FLAGS = {
  titleDotSeparator: true,
  compactFxSummary: true,
  hideAllocationPie: true,
  bucketSummaryV2: true,
  subtleSortControls: true,
  refinedAccentColors: true,
  allocationLegendThresholdEnabled: true,
  summaryOverallYieldNote: true,
  hideSnapshotImportEntry: true,
  summaryActionCluster: true,
  tooltipPreferRight: true
};

const UI_TEXT = {
  sort: '\u6392\u5e8f',
  overallAverageNetYield: '\u6574\u4f53\u5e73\u5747\u7a0e\u540e\u80a1\u606f\u7387',
  overallYieldCompact: '\u80a1\u606f\u7387'
};
const ALLOCATION_LEGEND_MIN_WEIGHT = 0.05;
const BUCKET_CHIP_COMPACT_THRESHOLD = 0.16;
const HOLDING_SWIPE_DELETE_WIDTH = 72;
const HOLDING_SWIPE_OPEN_THRESHOLD = 34;

const DEFAULT_RATES = {
  CNY: 1,
  USD: 7.22,
  HKD: 0.92
};

const COMPANY_COLORS = [
  '#152849', '#f28c28', '#cfd6e1', '#8e9aae', '#e7d7c7',
  '#6d7b90', '#f5b36b', '#2a4168', '#d9e0e8', '#a2acba',
  '#f3c58f', '#1e3357', '#bcc6d2', '#7f8ca0', '#eadfce',
  '#5d6d86', '#f0a04b', '#314b72', '#d4dae3', '#95a1b3'
];

const BUCKET_COLORS = {
  core: '#152849',
  income: '#f28c28'
};

const LABELS = {
  totalMarketValue: '\u6301\u4ed3\u603b\u91d1\u989d',
  totalDividend: '\u5e74\u5ea6\u80a1\u606f\u603b\u91d1\u989d',
  usdRate: '\u7f8e\u5143\u6c47\u7387',
  hkdRate: '\u6e2f\u5e01\u6c47\u7387',
  liability: '\u8d1f\u503a',
  marketUpdated: '\u884c\u60c5\u66f4\u65b0',
  waitingForUpdate: '\u7b49\u5f85\u884c\u60c5\u66f4\u65b0',
  sortMarketValue: '\u6301\u4ed3\u5e02\u503c',
  sortDividendYield: '\u80a1\u606f\u7387',
  core: '\u6838\u5fc3\u4ed3',
  income: '\u6253\u5de5\u4ed3',
  cancel: '\u53d6\u6d88',
  save: '\u4fdd\u5b58',
  addTitle: '\u65b0\u589e\u6301\u4ed3',
  addNote: '\u8f93\u5165\u80a1\u7968\u4ee3\u7801\u3001\u6570\u91cf\u5e76\u9009\u62e9\u4ed3\u4f4d\u7c7b\u578b',
  quantityTitle: '\u6570\u91cf\u8bbe\u7f6e',
  taxTitle: '\u7a0e\u7387\u8bbe\u7f6e',
  dividendPerShareTitle: '\u6bcf\u80a1 TTM \u80a1\u606f\u8bbe\u7f6e',
  dividendPerShareHint: '\u6309\u80a1\u7968\u539f\u5e01\u8f93\u5165\u6bcf\u80a1 TTM \u80a1\u606f\u91d1\u989d',
  liabilityTitle: '\u8d1f\u503a\u8bbe\u7f6e',
  quantityPlaceholder: '\u8f93\u5165\u6301\u80a1\u6570\u91cf',
  taxPlaceholder: '\u8f93\u5165\u7a0e\u7387\uff0c\u4f8b\u5982 10',
  dividendPerSharePlaceholder: '\u8f93\u5165\u6bcf\u80a1 TTM \u80a1\u606f\uff0c\u4f8b\u5982 5.4',
  liabilityPlaceholder: '\u8f93\u5165\u8d1f\u503a\u91d1\u989d',
  symbolPlaceholder: '\u4f8b\u5982 00700.HK \u6216 600519',
  missingSymbol: '\u8bf7\u8f93\u5165\u80a1\u7968\u4ee3\u7801',
  duplicateHolding: '\u5df2\u5728\u6301\u4ed3\u4e2d',
  deleteConfirm: '\u786e\u8ba4\u5220\u9664',
  refreshFailed: '\u884c\u60c5\u5237\u65b0\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002',
  importConfirm: '\u5bfc\u5165\u540e\u4f1a\u8986\u76d6\u5f53\u524d\u672c\u5730\u6570\u636e\uff0c\u786e\u8ba4\u7ee7\u7eed\u5417\uff1f',
  importFailed: '\u5bfc\u5165\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u5907\u4efd\u6587\u4ef6\u3002',
  exportFailed: '\u5bfc\u51fa\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002',
  marketValue: '\u6301\u4ed3\u5e02\u503c\uff1a',
  quantity: '\u6570\u91cf\uff1a',
  annualDividend: '\u7a0e\u540e\u80a1\u606f\uff1a',
  dividendYield: '\u80a1\u606f\u7387\uff1a',
  dividendSource: '\u6570\u636e\u6765\u6e90',
  dividendUpdatedAt: '\u6700\u8fd1\u66f4\u65b0',
  lastExDate: '\u6700\u8fd1\u9664\u606f\u65e5',
  dividendStatusManual: '\u624b\u52a8\u8986\u76d6',
  dividendStatusFresh: '\u5df2\u66f4\u65b0',
  dividendStatusStale: '\u7f13\u5b58',
  dividendStatusMissing: '\u7f3a\u5931',
  expandLegend: '\u5c55\u5f00\u5168\u90e8',
  collapseLegend: '\u6536\u8d77',
  itemsUnit: '\u9879',
  unknownHK: '\u672a\u8bc6\u522b\u6e2f\u80a1',
  unknownCN: '\u672a\u8bc6\u522bA\u80a1',
  unknownUS: '\u672a\u8bc6\u522b\u7f8e\u80a1'
};

const DEFAULT_QUOTES = normalizeSeedQuoteMap({
  AAPL: { name: 'Apple', market: 'US', currency: 'USD', price: 213.4, dividendPerShareTtm: 0 },
  MSFT: { name: 'Microsoft', market: 'US', currency: 'USD', price: 419.15, dividendPerShareTtm: 2.892135 },
  KO: { name: 'Coca-Cola', market: 'US', currency: 'USD', price: 68.22, dividendPerShareTtm: 2.11482 },
  JNJ: { name: 'Johnson & Johnson', market: 'US', currency: 'USD', price: 162.35, dividendPerShareTtm: 4.77309 },
  PG: { name: 'P&G', market: 'US', currency: 'USD', price: 171.28, dividendPerShareTtm: 4.127848 },
  PEP: { name: 'PepsiCo', market: 'US', currency: 'USD', price: 174.06, dividendPerShareTtm: 5.065146 },
  MCD: { name: "McDonald's", market: 'US', currency: 'USD', price: 301.42, dividendPerShareTtm: 6.721666 },
  O: { name: 'Realty Income', market: 'US', currency: 'USD', price: 54.1, dividendPerShareTtm: 3.05124 },
  VZ: { name: 'Verizon', market: 'US', currency: 'USD', price: 41.26, dividendPerShareTtm: 2.673648 },
  XOM: { name: 'Exxon Mobil', market: 'US', currency: 'USD', price: 109.74, dividendPerShareTtm: 3.742134 },
  CVX: { name: 'Chevron', market: 'US', currency: 'USD', price: 154.32, dividendPerShareTtm: 6.049344 },
  '00700.HK': { name: '\u817e\u8baf\u63a7\u80a1', market: 'HK', currency: 'HKD', price: 389.6, dividendPerShareTtm: 3.58432 },
  '00941.HK': { name: '\u4e2d\u56fd\u79fb\u52a8', market: 'HK', currency: 'HKD', price: 77.15, dividendPerShareTtm: 5.5548 },
  '01398.HK': { name: '\u5de5\u5546\u94f6\u884c', market: 'HK', currency: 'HKD', price: 4.33, dividendPerShareTtm: 0.35073 },
  '00883.HK': { name: '\u4e2d\u56fd\u6d77\u6d0b\u77f3\u6cb9', market: 'HK', currency: 'HKD', price: 18.42, dividendPerShareTtm: 1.43676 },
  '00005.HK': { name: '\u6c47\u4e30\u63a7\u80a1', market: 'HK', currency: 'HKD', price: 68.35, dividendPerShareTtm: 4.6478 },
  '00388.HK': { name: '\u9999\u6e2f\u4ea4\u6613\u6240', market: 'HK', currency: 'HKD', price: 256.2, dividendPerShareTtm: 7.1736 },
  '600519.SH': { name: '\u8d35\u5dde\u8305\u53f0', market: 'CN', currency: 'CNY', price: 1688, dividendPerShareTtm: 29.54 },
  '601318.SH': { name: '\u4e2d\u56fd\u5e73\u5b89', market: 'CN', currency: 'CNY', price: 46.22, dividendPerShareTtm: 2.35722 },
  '600036.SH': { name: '\u62db\u5546\u94f6\u884c', market: 'CN', currency: 'CNY', price: 34.58, dividendPerShareTtm: 1.69442 },
  '600900.SH': { name: '\u957f\u6c5f\u7535\u529b', market: 'CN', currency: 'CNY', price: 28.41, dividendPerShareTtm: 0.99435 },
  '000651.SZ': { name: '\u683c\u529b\u7535\u5668', market: 'CN', currency: 'CNY', price: 41.86, dividendPerShareTtm: 2.59532 },
  '300750.SZ': { name: '\u5b81\u5fb7\u65f6\u4ee3', market: 'CN', currency: 'CNY', price: 192.65, dividendPerShareTtm: 2.3118 }
});

const DEFAULT_HOLDINGS = [
  { localId: 1, symbol: 'AAPL', quantity: 20, bucket: 'core', taxRateOverride: '', dividendPerShareTtmOverride: '' },
  { localId: 2, symbol: 'MSFT', quantity: 10, bucket: 'core', taxRateOverride: '', dividendPerShareTtmOverride: '' },
  { localId: 3, symbol: 'KO', quantity: 120, bucket: 'income', taxRateOverride: '', dividendPerShareTtmOverride: '' },
  { localId: 4, symbol: 'JNJ', quantity: 40, bucket: 'core', taxRateOverride: '', dividendPerShareTtmOverride: '' },
  { localId: 5, symbol: 'PG', quantity: 35, bucket: 'core', taxRateOverride: '', dividendPerShareTtmOverride: '' },
  { localId: 6, symbol: 'PEP', quantity: 28, bucket: 'income', taxRateOverride: '', dividendPerShareTtmOverride: '' },
  { localId: 7, symbol: 'MCD', quantity: 16, bucket: 'income', taxRateOverride: '', dividendPerShareTtmOverride: '' },
  { localId: 8, symbol: 'O', quantity: 200, bucket: 'income', taxRateOverride: '', dividendPerShareTtmOverride: '' },
  { localId: 9, symbol: 'VZ', quantity: 160, bucket: 'income', taxRateOverride: '', dividendPerShareTtmOverride: '' },
  { localId: 10, symbol: 'XOM', quantity: 55, bucket: 'core', taxRateOverride: '', dividendPerShareTtmOverride: '' },
  { localId: 11, symbol: 'CVX', quantity: 32, bucket: 'core', taxRateOverride: '', dividendPerShareTtmOverride: '' },
  { localId: 12, symbol: '00700.HK', quantity: 100, bucket: 'core', taxRateOverride: '', dividendPerShareTtmOverride: '' },
  { localId: 13, symbol: '00941.HK', quantity: 2000, bucket: 'income', taxRateOverride: '', dividendPerShareTtmOverride: '' },
  { localId: 14, symbol: '01398.HK', quantity: 8000, bucket: 'income', taxRateOverride: '', dividendPerShareTtmOverride: '' },
  { localId: 15, symbol: '00883.HK', quantity: 2200, bucket: 'income', taxRateOverride: '', dividendPerShareTtmOverride: '' },
  { localId: 16, symbol: '00005.HK', quantity: 600, bucket: 'core', taxRateOverride: '', dividendPerShareTtmOverride: '' },
  { localId: 17, symbol: '00388.HK', quantity: 150, bucket: 'core', taxRateOverride: '', dividendPerShareTtmOverride: '' },
  { localId: 18, symbol: '600519.SH', quantity: 8, bucket: 'core', taxRateOverride: '', dividendPerShareTtmOverride: '' },
  { localId: 19, symbol: '601318.SH', quantity: 1000, bucket: 'income', taxRateOverride: '', dividendPerShareTtmOverride: '' },
  { localId: 20, symbol: '600036.SH', quantity: 1200, bucket: 'income', taxRateOverride: '', dividendPerShareTtmOverride: '' }
];

const state = {
  holdings: [],
  quotes: {},
  rates: { ...DEFAULT_RATES },
  nextId: 1,
  showAmounts: true,
  sortField: 'marketValueCny',
  sortDirection: 'desc',
  legendExpanded: false,
  liabilityCny: 0,
  lastUpdatedAt: '',
  modal: null,
  modalPayload: null,
  syncing: false,
  activeBucketKey: null,
  sortMenuOpen: false
};

const refs = {
  privacyButton: document.getElementById('privacyButton'),
  exportButton: document.getElementById('exportButton'),
  importButton: document.getElementById('importButton'),
  importFileInput: document.getElementById('importFileInput'),
  appKicker: document.querySelector('.app-kicker'),
  summaryActions: document.querySelector('.panel-bar--spread .text-actions'),
  summaryGrid: document.getElementById('summaryGrid'),
  companyDonut: document.getElementById('companyDonut'),
  companyLegend: document.getElementById('companyLegend'),
  legendToggle: document.getElementById('legendToggle'),
  bucketTrack: document.getElementById('bucketTrack'),
  chartLayout: document.querySelector('.chart-layout'),
  donutWrap: document.querySelector('.donut-wrap'),
  marketTimestamp: document.getElementById('marketTimestamp'),
  refreshButton: document.getElementById('refreshButton'),
  addButton: document.getElementById('addButton'),
  iconActions: document.querySelector('.icon-actions'),
  stockList: document.getElementById('stockList'),
  modalRoot: document.getElementById('modalRoot'),
  sortGroup: document.querySelector('.sort-group'),
  sortChips: Array.from(document.querySelectorAll('.sort-chip'))
};

let sortToggleButton = null;

function ensureSortToggleButton() {
  if (sortToggleButton || !refs.iconActions) {
    return sortToggleButton;
  }
  sortToggleButton = document.createElement('button');
  sortToggleButton.type = 'button';
  sortToggleButton.className = 'circle-button sort-toggle-button';
  sortToggleButton.setAttribute('aria-label', UI_TEXT.sort);
  sortToggleButton.setAttribute('aria-expanded', 'false');
  sortToggleButton.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 6.2v11.6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"></path>
      <path d="M8.6 9.6L12 6.2l3.4 3.4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"></path>
      <path d="M8.6 14.4L12 17.8l3.4-3.4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>
  `;
  refs.iconActions.insertBefore(sortToggleButton, refs.refreshButton);
  sortToggleButton.addEventListener('click', (event) => {
    if (!UI_FLAGS.subtleSortControls) {
      return;
    }
    event.stopPropagation();
    state.sortMenuOpen = !state.sortMenuOpen;
    renderSortChips();
  });
  return sortToggleButton;
}

function configureUiChrome() {
  if (refs.appKicker) {
    refs.appKicker.textContent = 'BEBOP';
    if (refs.appKicker.parentElement) {
      refs.appKicker.parentElement.classList.add('app-brand');
    }
  }

  if (UI_FLAGS.summaryActionCluster && refs.summaryActions) {
    refs.summaryActions.classList.add('summary-actions-cluster');
    refs.summaryActions.append(refs.exportButton, refs.privacyButton);
  }

  refs.exportButton.className = 'summary-action-button';
  refs.exportButton.setAttribute('aria-label', '\u5bfc\u51fa\u5feb\u7167');
  refs.exportButton.title = '\u5bfc\u51fa\u5feb\u7167';
  refs.exportButton.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5.5v9.2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"></path>
      <path d="M8.6 11.4L12 14.8l3.4-3.4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"></path>
      <path d="M5.8 18h12.4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"></path>
    </svg>
  `;
  refs.privacyButton.classList.remove('circle-button');
  refs.privacyButton.classList.add('summary-action-button');

  if (UI_FLAGS.hideSnapshotImportEntry) {
    refs.importButton.hidden = true;
    refs.importButton.setAttribute('aria-hidden', 'true');
    refs.importButton.tabIndex = -1;
  }

  if (UI_FLAGS.subtleSortControls) {
    const button = ensureSortToggleButton();
    if (button) {
      button.hidden = false;
    }
    if (refs.sortGroup && refs.iconActions) {
      refs.sortGroup.classList.remove('sort-group--popover');
      if (refs.sortGroup.parentElement !== refs.iconActions) {
        refs.iconActions.insertBefore(refs.sortGroup, refs.refreshButton);
      } else if (refs.refreshButton && refs.sortGroup.nextElementSibling !== refs.refreshButton) {
        refs.iconActions.insertBefore(refs.sortGroup, refs.refreshButton);
      }
    }
  }
}

function roundTo(value, digits = 6) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Number(numeric.toFixed(digits));
}

function normalizeDividendSource(value, fallback = 'cache') {
  const source = String(value || '').trim().toLowerCase();
  return VALID_DIVIDEND_SOURCES.has(source) ? source : fallback;
}

function normalizeDividendStatus(value, fallback = 'missing') {
  const status = String(value || '').trim().toLowerCase();
  return VALID_DIVIDEND_STATUSES.has(status) ? status : fallback;
}

function normalizeYieldRatio(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.max(0, numeric > 1 ? numeric / 100 : numeric);
}

function parsePerShareOverride(value) {
  if (value === '' || value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return roundTo(parsed);
}

function sanitizePerShareOverrideInput(value) {
  const parsed = parsePerShareOverride(value);
  return parsed === null ? '' : String(parsed);
}

function normalizeStaleDays(value, fallback = DEFAULT_STALE_DAYS) {
  const numeric = Math.floor(Number(value));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function chunkSymbols(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function toTencentSymbol(symbol) {
  const normalized = normalizeSymbol(symbol);
  if (!normalized) {
    return '';
  }
  if (normalized.endsWith('.HK')) {
    return 'hk' + normalized.slice(0, -3).padStart(5, '0');
  }
  if (normalized.endsWith('.SH')) {
    return 'sh' + normalized.slice(0, -3);
  }
  if (normalized.endsWith('.SZ')) {
    return 'sz' + normalized.slice(0, -3);
  }
  return 'us' + normalized;
}

function getRealtimeSymbols() {
  return Array.from(new Set(
    state.holdings
      .map((item) => normalizeSymbol(item.symbol))
      .filter(Boolean)
  ));
}

function parseIsoDate(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return null;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isDividendDataStale(updatedAt, staleDays = currentDividendStaleDays) {
  const updatedDate = parseIsoDate(updatedAt);
  if (!updatedDate) {
    return true;
  }
  const ageMs = Date.now() - updatedDate.getTime();
  return ageMs > normalizeStaleDays(staleDays) * 24 * 60 * 60 * 1000;
}

function buildDividendFields(rawQuote = {}, fallbackQuote = {}) {
  const nextPrice = safeNumber(rawQuote.price, safeNumber(fallbackQuote.price, 0));
  const rawDividendPerShareTtm = Number(rawQuote.dividendPerShareTtm);
  const fallbackDividendPerShareTtm = safeNumber(fallbackQuote.dividendPerShareTtm, 0);
  const legacyYieldRatio = normalizeYieldRatio(rawQuote.dividendYield);
  const derivedDividendPerShareTtm = legacyYieldRatio === null || nextPrice <= 0
    ? fallbackDividendPerShareTtm
    : nextPrice * legacyYieldRatio;
  const dividendPerShareTtm = Number.isFinite(rawDividendPerShareTtm)
    ? Math.max(0, rawDividendPerShareTtm)
    : Math.max(0, derivedDividendPerShareTtm);
  const fallbackSource = normalizeDividendSource(
    fallbackQuote.dividendSource,
    fallbackDividendPerShareTtm > 0 ? 'cache' : 'cache'
  );
  const dividendSource = normalizeDividendSource(rawQuote.dividendSource, fallbackSource);
  const fallbackUpdatedAt = typeof fallbackQuote.dividendUpdatedAt === 'string' ? fallbackQuote.dividendUpdatedAt : '';
  const fallbackLastExDate = typeof fallbackQuote.lastExDate === 'string' ? fallbackQuote.lastExDate : '';
  const hasRawFetchError = Object.prototype.hasOwnProperty.call(rawQuote, 'dividendFetchError');
  const rawFetchError = hasRawFetchError && typeof rawQuote.dividendFetchError === 'string'
    ? rawQuote.dividendFetchError.trim()
    : null;
  const fallbackFetchError = typeof fallbackQuote.dividendFetchError === 'string' ? fallbackQuote.dividendFetchError.trim() : '';
  const dividendUpdatedAt = typeof rawQuote.dividendUpdatedAt === 'string' ? rawQuote.dividendUpdatedAt : fallbackUpdatedAt;
  const lastExDate = typeof rawQuote.lastExDate === 'string' ? rawQuote.lastExDate : fallbackLastExDate;
  const dividendStatus = dividendSource === 'manual'
    ? 'manual'
    : dividendPerShareTtm <= 0
      ? 'missing'
      : (dividendSource === 'cache' || isDividendDataStale(dividendUpdatedAt) ? 'stale' : 'fresh');

  return {
    dividendPerShareTtm: roundTo(dividendPerShareTtm),
    dividendSource,
    dividendUpdatedAt,
    lastExDate,
    dividendFetchError: rawFetchError === null ? fallbackFetchError : rawFetchError,
    dividendStatus
  };
}

function normalizeSeedQuoteMap(seedMap) {
  const normalized = {};
  Object.entries(seedMap || {}).forEach(([symbol, quote]) => {
    normalized[symbol] = {
      symbol,
      ...quote,
      ...buildDividendFields(quote, {})
    };
  });
  return normalized;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatMoney(value, currency) {
  const amount = safeNumber(value, 0);
  const sign = amount < 0 ? '-' : '';
  const absolute = Math.abs(amount);
  const symbols = { CNY: '\u00a5', USD: '$', HKD: 'HK$' };
  return `${sign}${symbols[currency] || ''}${absolute.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function formatPlainPrice(value) {
  return safeNumber(value, 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatPercent(value) {
  return `${(safeNumber(value, 0) * 100).toFixed(2)}%`;
}

function formatTimestamp(isoString) {
  if (!isoString) {
    return LABELS.waitingForUpdate;
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return LABELS.waitingForUpdate;
  }
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${LABELS.marketUpdated} ${month}-${day} ${hour}:${minute}`;
}

function formatDateLabel(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return raw;
  }
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getDividendSourceLabel(source) {
  const key = String(source || '').trim().toLowerCase();
  if (key === 'yfinance') {
    return 'YFinance';
  }
  if (key === 'yahoo') {
    return 'Yahoo';
  }
  if (key === 'manual') {
    return '手动';
  }
  if (key === 'eodhd') {
    return 'EODHD';
  }
  if (key === 'cache') {
    return '沿用缓存';
  }
  return 'YFinance';
}

function getDividendStatusLabel(status) {
  const key = normalizeDividendStatus(status, 'missing');
  if (key === 'manual') {
    return LABELS.dividendStatusManual;
  }
  if (key === 'fresh') {
    return LABELS.dividendStatusFresh;
  }
  if (key === 'stale') {
    return LABELS.dividendStatusStale;
  }
  return LABELS.dividendStatusMissing;
}

function buildDividendTooltipLines(item) {
  const lines = [
    `${LABELS.dividendSource}：${getDividendSourceLabel(item.dividendSource)}`
  ];
  const updatedAt = formatDateLabel(item.dividendUpdatedAt);
  if (updatedAt) {
    lines.push(`${LABELS.dividendUpdatedAt}：${updatedAt}`);
  }
  const lastExDate = formatDateLabel(item.lastExDate);
  if (lastExDate) {
    lines.push(`${LABELS.lastExDate}：${lastExDate}`);
  }
  return lines;
}

function updateDividendTooltipSide(button) {
  if (!button) {
    return;
  }
  if (button.classList.contains('dividend-status-button--value')) {
    button.dataset.tooltipSide = 'left';
    return;
  }
  if (!UI_FLAGS.tooltipPreferRight) {
    return;
  }
  const tooltip = button.querySelector('.dividend-status-tooltip');
  if (!tooltip) {
    return;
  }
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth || 0;
  const fallbackWidth = safeNumber(tooltip.offsetWidth, 168) || 168;
  const rect = button.getBoundingClientRect();
  const rightSpace = viewportWidth - rect.right;
  const leftSpace = rect.left;
  const side = rightSpace >= fallbackWidth + 16 || rightSpace >= leftSpace ? 'right' : 'left';
  button.dataset.tooltipSide = side;
}

function closeActiveDividendTooltip(force = false) {
  if (!activeDividendTooltipButton) {
    return;
  }
  if (!force && document.activeElement === activeDividendTooltipButton) {
    return;
  }
  activeDividendTooltipButton.classList.remove('is-tooltip-open');
  activeDividendTooltipButton.setAttribute('aria-expanded', 'false');
  activeDividendTooltipButton.blur();
  activeDividendTooltipButton = null;
}

function toggleDividendTooltip(button) {
  if (!button || !button.classList.contains('dividend-status-button--value')) {
    return;
  }
  if (activeDividendTooltipButton === button) {
    closeActiveDividendTooltip(true);
    return;
  }
  closeActiveDividendTooltip(true);
  updateDividendTooltipSide(button);
  button.classList.add('is-tooltip-open');
  button.setAttribute('aria-expanded', 'true');
  activeDividendTooltipButton = button;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeSymbol(rawSymbol) {
  const value = String(rawSymbol || '').trim().toUpperCase();
  if (!value) {
    return '';
  }
  const normalizeCnSuffix = (digits) => (/^[569]/.test(digits) ? `${digits}.SH` : `${digits}.SZ`);
  if (/^\d{6}\.SS$/.test(value)) {
    return value.replace('.SS', '.SH');
  }
  if (/^\d{5}\.HK$/.test(value)) {
    return value;
  }
  if (/^\d{6}\.(SH|SZ)$/.test(value)) {
    return normalizeCnSuffix(value.slice(0, 6));
  }
  if (/^[A-Z][A-Z0-9.-]*$/.test(value)) {
    return value;
  }
  if (/^\d{5}$/.test(value)) {
    return `${value}.HK`;
  }
  if (/^\d{6}$/.test(value)) {
    return normalizeCnSuffix(value);
  }
  return value;
}

function chunkItems(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function inferQuoteFromMap(symbol, quoteMap = {}) {
  if (quoteMap[symbol]) {
    return { ...quoteMap[symbol], symbol };
  }
  if (DEFAULT_QUOTES[symbol]) {
    return { ...DEFAULT_QUOTES[symbol], symbol };
  }
  if (/\.HK$/.test(symbol)) {
    return {
      symbol,
      name: LABELS.unknownHK,
      market: 'HK',
      currency: 'HKD',
      price: 0,
      dividendPerShareTtm: 0,
      dividendSource: 'cache',
      dividendUpdatedAt: '',
      lastExDate: '',
      dividendFetchError: '',
      dividendStatus: 'missing'
    };
  }
  if (/\.(SH|SZ)$/.test(symbol)) {
    return {
      symbol,
      name: LABELS.unknownCN,
      market: 'CN',
      currency: 'CNY',
      price: 0,
      dividendPerShareTtm: 0,
      dividendSource: 'cache',
      dividendUpdatedAt: '',
      lastExDate: '',
      dividendFetchError: '',
      dividendStatus: 'missing'
    };
  }
  return {
    symbol,
    name: LABELS.unknownUS,
    market: 'US',
    currency: 'USD',
    price: 0,
    dividendPerShareTtm: 0,
    dividendSource: 'cache',
    dividendUpdatedAt: '',
    lastExDate: '',
    dividendFetchError: '',
    dividendStatus: 'missing'
  };
}

function inferQuote(symbol) {
  return inferQuoteFromMap(symbol, state.quotes);
}

function mergeQuotes(baseMap, nextMap) {
  const merged = { ...baseMap };
  Object.entries(nextMap || {}).forEach(([rawSymbol, rawQuote]) => {
    const symbol = normalizeSymbol(rawSymbol);
    if (!symbol || !rawQuote) {
      return;
    }
    const fallback = inferQuoteFromMap(symbol, merged);
    const dividendFields = buildDividendFields(rawQuote, fallback);
    merged[symbol] = {
      symbol,
      name: rawQuote.name || fallback.name,
      market: rawQuote.market || fallback.market,
      currency: rawQuote.currency || fallback.currency,
      price: safeNumber(rawQuote.price, fallback.price),
      ...dividendFields
    };
    if (typeof rawQuote.reason === 'string' && rawQuote.reason.trim()) {
      merged[symbol].dividendReason = rawQuote.reason.trim();
    } else if (typeof fallback.dividendReason === 'string' && fallback.dividendReason.trim()) {
      merged[symbol].dividendReason = fallback.dividendReason.trim();
    }
  });
  return merged;
}

function sanitizeHolding(item, index, quoteMap = {}) {
  const symbol = normalizeSymbol(item && item.symbol);
  if (!symbol) {
    return null;
  }
  const quote = inferQuoteFromMap(symbol, quoteMap);
  const hasExplicitDividendOverride = item && item.dividendPerShareTtmOverrideTouched === true;
  const rawManualDividendOverride = item && item.dividendPerShareTtmOverride != null
    ? item.dividendPerShareTtmOverride
    : null;
  const nextDividendPerShareOverride = sanitizePerShareOverrideInput(
    rawManualDividendOverride != null
      ? (
          String(rawManualDividendOverride).trim() === '0' && !hasExplicitDividendOverride
            ? ''
            : rawManualDividendOverride
        )
      : (() => {
          // One-time compatibility read from older browser snapshots that stored dividend yield percentages.
          const legacyYieldRatio = normalizeYieldRatio(item && item.dividendYieldOverride);
          if (legacyYieldRatio === null) {
            return '';
          }
          const price = safeNumber(quote.price, 0);
          return price > 0 ? price * legacyYieldRatio : '';
        })()
  );
  return {
    localId: Math.max(1, Math.floor(safeNumber(item && item.localId, index + 1))),
    symbol,
    quantity: Math.max(0, safeNumber(item && item.quantity != null ? item.quantity : item && item.shares, 0)),
    bucket: item && item.bucket === 'income' ? 'income' : 'core',
    taxRateOverride: item && item.taxRateOverride != null
      ? String(item.taxRateOverride)
      : item && item.taxRate != null
        ? String(item.taxRate)
        : '',
    dividendPerShareTtmOverride: nextDividendPerShareOverride,
    dividendPerShareTtmOverrideTouched: nextDividendPerShareOverride !== ''
  };
}

function parsePercentOverride(value) {
  if (value === '' || value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.max(0, parsed);
}

function resolveManualDividendPerShareOverride(value, isExplicit = false) {
  if (value === '' || value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || (trimmed === '0' && !isExplicit)) {
      return null;
    }
    return parsePerShareOverride(trimmed);
  }
  // Earlier migration bugs could leave a numeric 0 in local snapshots.
  // Treat that legacy residue as "no override" unless the user explicitly set it.
  if (value === 0 && !isExplicit) {
    return null;
  }
  return parsePerShareOverride(value);
}

function resolveQuoteCurrency(quote = {}, symbol = '') {
  const normalizedCurrency = String(quote.currency || '').trim().toUpperCase();
  if (normalizedCurrency === 'CNY' || normalizedCurrency === 'USD' || normalizedCurrency === 'HKD') {
    return normalizedCurrency;
  }

  const normalizedMarket = String(quote.market || '').trim().toUpperCase();
  if (normalizedMarket === 'HK' || /\.HK$/.test(symbol)) {
    return 'HKD';
  }
  if (normalizedMarket === 'US') {
    return 'USD';
  }
  return 'CNY';
}

function resolveFxRateForCurrency(currency) {
  const rates = state.rates && typeof state.rates === 'object' ? state.rates : DEFAULT_RATES;
  const normalizedCurrency = String(currency || '').trim().toUpperCase();
  if (normalizedCurrency === 'HKD') {
    return safeNumber(rates.HKD, DEFAULT_RATES.HKD);
  }
  if (normalizedCurrency === 'USD') {
    return safeNumber(rates.USD, DEFAULT_RATES.USD);
  }
  return 1;
}

function createDefaultSnapshot() {
  return {
    holdings: clone(DEFAULT_HOLDINGS),
    quotes: clone(DEFAULT_QUOTES),
    rates: { ...DEFAULT_RATES },
    nextId: DEFAULT_HOLDINGS.length + 1,
    showAmounts: true,
    sortField: 'marketValueCny',
    sortDirection: 'desc',
    legendExpanded: false,
    liabilityCny: 0,
    lastUpdatedAt: ''
  };
}

function applySnapshot(snapshot) {
  const defaults = createDefaultSnapshot();
  const mergedQuotes = mergeQuotes(clone(defaults.quotes), snapshot && snapshot.quotes);
  const sanitizedHoldings = Array.isArray(snapshot && snapshot.holdings)
    ? snapshot.holdings.map((item, index) => sanitizeHolding(item, index, mergedQuotes)).filter(Boolean)
    : defaults.holdings;
  const maxLocalId = sanitizedHoldings.reduce((maxValue, item) => Math.max(maxValue, item.localId), 0);

  state.holdings = sanitizedHoldings.length ? sanitizedHoldings : clone(defaults.holdings);
  state.quotes = mergedQuotes;
  state.rates = { ...DEFAULT_RATES, ...((snapshot && snapshot.rates) || {}) };
  state.nextId = Math.max(maxLocalId + 1, Math.floor(safeNumber(snapshot && snapshot.nextId, defaults.nextId)));
  state.showAmounts = snapshot && snapshot.showAmounts === false ? false : true;
  state.sortField = snapshot && snapshot.sortField === 'effectiveYield' ? 'effectiveYield' : 'marketValueCny';
  state.sortDirection = snapshot && snapshot.sortDirection === 'asc' ? 'asc' : 'desc';
  state.legendExpanded = Boolean(snapshot && snapshot.legendExpanded);
  state.liabilityCny = Math.max(0, safeNumber(snapshot && snapshot.liabilityCny, 0));
  state.lastUpdatedAt = typeof (snapshot && snapshot.lastUpdatedAt) === 'string' ? snapshot.lastUpdatedAt : '';
}

function getPersistedSnapshot() {
  return {
    holdings: state.holdings,
    quotes: state.quotes,
    rates: state.rates,
    nextId: state.nextId,
    showAmounts: state.showAmounts,
    sortField: state.sortField,
    sortDirection: state.sortDirection,
    legendExpanded: state.legendExpanded,
    liabilityCny: state.liabilityCny,
    lastUpdatedAt: state.lastUpdatedAt
  };
}

function buildPortfolioSnapshotHolding(holding) {
  const quantity = Math.max(0, safeNumber(
    holding && holding.quantity != null ? holding.quantity : holding && holding.shares,
    0
  ));
  const dividendPerShareTtmOverride = sanitizePerShareOverrideInput(
    holding && holding.dividendPerShareTtmOverride
  );

  return {
    localId: Math.max(1, Math.floor(safeNumber(holding && holding.localId, 1))),
    symbol: normalizeSymbol(holding && holding.symbol),
    quantity,
    shares: quantity,
    accountType: holding && typeof holding.accountType === 'string' && holding.accountType.trim()
      ? holding.accountType.trim()
      : 'default',
    bucket: holding && holding.bucket === 'income' ? 'income' : 'core',
    taxRateOverride: holding && holding.taxRateOverride != null ? String(holding.taxRateOverride) : '',
    dividendPerShareTtmOverride,
    dividendPerShareTtmOverrideTouched: holding && holding.dividendPerShareTtmOverrideTouched === true && dividendPerShareTtmOverride !== ''
  };
}

function buildPortfolioSnapshot() {
  const persisted = getPersistedSnapshot();
  const holdings = Array.isArray(persisted.holdings)
    ? persisted.holdings.map(buildPortfolioSnapshotHolding).filter((item) => item.symbol)
    : [];

  return {
    type: 'portfolio-snapshot',
    version: 1,
    updatedAt: new Date().toISOString(),
    holdings,
    nextId: Math.max(
      holdings.reduce((maxValue, item) => Math.max(maxValue, item.localId), 0) + 1,
      Math.floor(safeNumber(persisted.nextId, 1))
    ),
    showAmounts: persisted.showAmounts !== false,
    sortField: persisted.sortField === 'effectiveYield' ? 'effectiveYield' : 'marketValueCny',
    sortDirection: persisted.sortDirection === 'asc' ? 'asc' : 'desc',
    legendExpanded: Boolean(persisted.legendExpanded),
    liabilityCny: Math.max(0, safeNumber(persisted.liabilityCny, 0)),
    lastUpdatedAt: typeof persisted.lastUpdatedAt === 'string' ? persisted.lastUpdatedAt : ''
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(getPersistedSnapshot()));
}

function restoreState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!saved || typeof saved !== 'object') {
      throw new Error('invalid state');
    }
    applySnapshot(saved);
    saveState();
  } catch (_error) {
    applySnapshot(createDefaultSnapshot());
  }
}

function computeHoldings() {
  const holdings = state.holdings.map((holding) => {
    const quote = inferQuote(holding.symbol);
    const quantity = Math.max(0, safeNumber(holding.quantity, 0));
    const price = safeNumber(quote.price, 0);
    const currency = resolveQuoteCurrency(quote, holding.symbol);
    const fxRate = resolveFxRateForCurrency(currency);
    const taxOverridePercent = parsePercentOverride(holding.taxRateOverride);
    const dividendPerShareOverride = resolveManualDividendPerShareOverride(
      holding.dividendPerShareTtmOverride,
      holding.dividendPerShareTtmOverrideTouched === true
    );
    const effectiveTax = taxOverridePercent === null ? 0 : taxOverridePercent / 100;
    const baseDividendPerShareTtm = Math.max(0, safeNumber(quote.dividendPerShareTtm, 0));
    const effectiveDividendPerShareTtm = dividendPerShareOverride === null
      ? baseDividendPerShareTtm
      : dividendPerShareOverride;
    const currentYield = price > 0 ? effectiveDividendPerShareTtm / price : 0;
    const marketValueCny = price * quantity * fxRate;
    const grossAnnualDividendCny = effectiveDividendPerShareTtm * quantity * fxRate;
    const netAnnualDividendCny = grossAnnualDividendCny * (1 - effectiveTax);
    const dividendSource = dividendPerShareOverride === null
      ? normalizeDividendSource(quote.dividendSource, effectiveDividendPerShareTtm > 0 ? 'cache' : 'cache')
      : 'manual';
    const dividendStatus = dividendPerShareOverride === null
      ? normalizeDividendStatus(
          quote.dividendStatus,
          effectiveDividendPerShareTtm > 0 ? (dividendSource === 'cache' ? 'stale' : 'fresh') : 'missing'
        )
      : 'manual';

    return {
      ...holding,
      ...quote,
      currency,
      quantity,
      fxRate,
      dividendSource,
      dividendStatus,
      effectiveDividendPerShareTtm,
      currentYield,
      effectiveYield: currentYield,
      marketValueCny,
      grossAnnualDividendCny,
      netAnnualDividendCny,
      annualDividendCny: netAnnualDividendCny
    };
  });

  holdings.sort((left, right) => {
    const leftValue = safeNumber(left[state.sortField], 0);
    const rightValue = safeNumber(right[state.sortField], 0);
    if (leftValue === rightValue) {
      return safeNumber(right.marketValueCny, 0) - safeNumber(left.marketValueCny, 0);
    }
    return state.sortDirection === 'asc' ? leftValue - rightValue : rightValue - leftValue;
  });

  const totalMarketValueCny = holdings.reduce((sum, item) => sum + safeNumber(item.marketValueCny, 0), 0);
  const totalDividendCny = holdings.reduce((sum, item) => sum + safeNumber(item.netAnnualDividendCny, 0), 0);
  const divisor = totalMarketValueCny || 1;

  return {
    holdings: holdings.map((item) => ({
      ...item,
      holdingWeight: safeNumber(item.marketValueCny, 0) / divisor
    })),
    totalMarketValueCny,
    totalDividendCny,
    netMarketValueCny: totalMarketValueCny - state.liabilityCny
  };
}

function getCompanySegments(holdings) {
  return holdings
    .filter((item) => safeNumber(item.marketValueCny, 0) > 0)
    .sort((left, right) => safeNumber(right.marketValueCny, 0) - safeNumber(left.marketValueCny, 0))
    .map((item, index) => ({
      label: item.name,
      value: safeNumber(item.marketValueCny, 0),
      color: COMPANY_COLORS[index % COMPANY_COLORS.length]
    }));
}

function getBucketSegments(holdings) {
  const totals = { core: 0, income: 0 };
  holdings.forEach((item) => {
    totals[item.bucket] += safeNumber(item.marketValueCny, 0);
  });
  const sum = totals.core + totals.income || 1;
  return [
    {
      key: 'core',
      label: LABELS.core,
      value: totals.core,
      percent: totals.core / sum,
      color: BUCKET_COLORS.core
    },
    {
      key: 'income',
      label: LABELS.income,
      value: totals.income,
      percent: totals.income / sum,
      color: BUCKET_COLORS.income
    }
  ].filter((item) => item.value > 0);
}

function formatDisplayMoney(value, currency = 'CNY') {
  return state.showAmounts ? formatMoney(value, currency) : MASK_AMOUNT;
}

function getHoldingTitleDivider() {
  return UI_FLAGS.titleDotSeparator ? '\u00b7' : '/';
}

function getBucketSummaryItems(holdings) {
  const groups = {
    core: { key: 'core', label: LABELS.core, color: BUCKET_COLORS.core, marketValueCny: 0, totalDividendCny: 0 },
    income: { key: 'income', label: LABELS.income, color: BUCKET_COLORS.income, marketValueCny: 0, totalDividendCny: 0 }
  };

  holdings.forEach((item) => {
    const bucketKey = item.bucket === 'income' ? 'income' : 'core';
    groups[bucketKey].marketValueCny += safeNumber(item.marketValueCny, 0);
    groups[bucketKey].totalDividendCny += safeNumber(item.netAnnualDividendCny, 0);
  });

  return Object.values(groups)
    .map((item) => ({
      ...item,
      averageYield: item.marketValueCny > 0 ? item.totalDividendCny / item.marketValueCny : 0
    }))
    .filter((item) => item.marketValueCny > 0);
}

function renderSummary(summary) {
  const totalLabel = formatDisplayMoney(summary.netMarketValueCny, 'CNY');
  const dividendLabel = formatDisplayMoney(summary.totalDividendCny, 'CNY');
  const liabilityLabel = formatDisplayMoney(state.liabilityCny, 'CNY');
  const overallAverageNetYield = summary.totalMarketValueCny > 0
    ? summary.totalDividendCny / summary.totalMarketValueCny
    : 0;
  const mainCards = `
    <article class="summary-card">
      <div class="summary-top">
        <span class="summary-label">${LABELS.totalMarketValue}</span>
        <button class="ghost-minus" type="button" data-summary-action="liability" aria-label="${LABELS.liability}">-</button>
      </div>
      <div class="summary-value">${totalLabel}</div>
      ${state.liabilityCny > 0 ? `<p class="summary-note">${LABELS.liability} ${liabilityLabel}</p>` : ''}
    </article>
    <article class="summary-card">
      <div class="summary-label">${LABELS.totalDividend}</div>
      <div class="summary-value is-income">${dividendLabel}</div>
      ${UI_FLAGS.summaryOverallYieldNote ? `<p class="summary-note summary-note--yield">${UI_TEXT.overallYieldCompact} ${formatPercent(overallAverageNetYield)}</p>` : ''}
    </article>
  `;

  refs.summaryGrid.classList.toggle('summary-grid--compact-fx', UI_FLAGS.compactFxSummary);
  refs.summaryGrid.innerHTML = UI_FLAGS.compactFxSummary
    ? `
      <div class="summary-grid-main">
        ${mainCards}
      </div>
      <div class="summary-fx-strip" aria-label="${LABELS.usdRate} / ${LABELS.hkdRate}">
        <span class="summary-fx-item">USD/CNY ${safeNumber(state.rates.USD, 0).toFixed(2)}</span>
        <span class="summary-fx-divider">\u00b7</span>
        <span class="summary-fx-item">HKD/CNY ${safeNumber(state.rates.HKD, 0).toFixed(4)}</span>
      </div>
    `
    : `
      ${mainCards}
      <article class="summary-card">
        <div class="summary-label">${LABELS.usdRate}</div>
        <p class="summary-note">1 USD = ${safeNumber(state.rates.USD, 0).toFixed(2)} CNY</p>
      </article>
      <article class="summary-card">
        <div class="summary-label">${LABELS.hkdRate}</div>
        <p class="summary-note">1 HKD = ${safeNumber(state.rates.HKD, 0).toFixed(4)} CNY</p>
      </article>
    `;
}

function renderDonut(segments) {
  if (refs.donutWrap && refs.chartLayout) {
    refs.donutWrap.hidden = UI_FLAGS.hideAllocationPie;
    refs.chartLayout.classList.toggle('is-legend-only', UI_FLAGS.hideAllocationPie);
  }
  if (UI_FLAGS.hideAllocationPie) {
    return;
  }
  const total = segments.reduce((sum, item) => sum + item.value, 0);
  if (!segments.length || total <= 0) {
    refs.companyDonut.style.background = 'conic-gradient(#dfe5ee 0deg, #dfe5ee 360deg)';
    return;
  }
  let start = 0;
  const stops = segments.map((segment) => {
    const end = start + (segment.value / total) * 360;
    const piece = `${segment.color} ${start.toFixed(1)}deg ${end.toFixed(1)}deg`;
    start = end;
    return piece;
  });
  refs.companyDonut.style.background = `conic-gradient(${stops.join(', ')})`;
}

function renderLegend(segments) {
  const total = segments.reduce((sum, item) => sum + item.value, 0) || 1;
  const defaultVisible = UI_FLAGS.allocationLegendThresholdEnabled
    ? segments.filter((segment) => segment.value / total >= ALLOCATION_LEGEND_MIN_WEIGHT)
    : segments.slice(0, LEGEND_COLLAPSED_COUNT);
  const collapsedVisible = defaultVisible.length ? defaultVisible : segments.slice(0, LEGEND_COLLAPSED_COUNT);
  const visible = state.legendExpanded
    ? segments
    : collapsedVisible;
  const canToggleLegend = collapsedVisible.length < segments.length;

  refs.companyLegend.innerHTML = visible.map((segment) => `
    <div class="legend-row">
      <div class="legend-main">
        <span class="legend-dot" style="background:${segment.color}"></span>
        <span class="legend-label">${escapeHtml(segment.label)}</span>
      </div>
      <span class="legend-value">${((segment.value / total) * 100).toFixed(1)}%</span>
    </div>
  `).join('');

  if (canToggleLegend) {
    refs.legendToggle.hidden = false;
    refs.legendToggle.textContent = state.legendExpanded
      ? LABELS.collapseLegend
      : `${LABELS.expandLegend} ${segments.length} ${LABELS.itemsUnit}`;
  } else {
    refs.legendToggle.hidden = true;
  }
}

function renderBuckets(segments, holdings, summary) {
  if (UI_FLAGS.bucketSummaryV2) {
    refs.bucketTrack.classList.add('bucket-track--summary-v2');
    const totalMarketValue = segments.reduce((sum, item) => sum + safeNumber(item.value, 0), 0);
    const bucketItems = getBucketSummaryItems(holdings);
    if (state.activeBucketKey && !bucketItems.some((item) => item.key === state.activeBucketKey)) {
      state.activeBucketKey = null;
    }
    const activeItem = bucketItems.find((item) => item.key === state.activeBucketKey) || null;
    const overallNetYield = totalMarketValue > 0
      ? summary.totalDividendCny / totalMarketValue
      : 0;

    refs.bucketTrack.innerHTML = `
      <div class="bucket-summary-v2">
        <div class="bucket-chip-row">
          ${bucketItems.map((item) => {
            const bucketShare = item.marketValueCny / (totalMarketValue || 1);
            const isCompact = bucketShare < BUCKET_CHIP_COMPACT_THRESHOLD;
            return `
              <button
                class="bucket-chip is-${item.key}${state.activeBucketKey === item.key ? ' is-active' : ''}${isCompact ? ' is-compact' : ''}"
                type="button"
                data-bucket-toggle="${item.key}"
                style="--bucket-share:${bucketShare.toFixed(4)};"
                aria-expanded="${state.activeBucketKey === item.key ? 'true' : 'false'}"
              >
                <span class="bucket-chip-label">${item.label}</span>
                <span class="bucket-chip-value">${(bucketShare * 100).toFixed(1)}%</span>
              </button>
            `;
          }).join('')}
        </div>
        ${UI_FLAGS.summaryOverallYieldNote ? '' : `<div class="bucket-overall-yield">${UI_TEXT.overallAverageNetYield} ${formatPercent(overallNetYield)}</div>`}
        ${activeItem ? `
          <div class="bucket-detail-card">
            <div class="bucket-detail-row">
              <span class="bucket-detail-label">${LABELS.marketValue.replace('：', '')}</span>
              <span class="bucket-detail-value">${formatDisplayMoney(activeItem.marketValueCny, 'CNY')}</span>
            </div>
            <div class="bucket-detail-row">
              <span class="bucket-detail-label">${LABELS.annualDividend.replace('：', '')}</span>
              <span class="bucket-detail-value is-income">${formatDisplayMoney(activeItem.totalDividendCny, 'CNY')}</span>
            </div>
            <div class="bucket-detail-row">
              <span class="bucket-detail-label">${LABELS.dividendYield.replace('：', '')}</span>
              <span class="bucket-detail-value">${formatPercent(activeItem.averageYield)}</span>
            </div>
          </div>
        ` : ''}
      </div>
    `;
    return;
  }

  refs.bucketTrack.classList.remove('bucket-track--summary-v2');
  if (!segments.length) {
    refs.bucketTrack.innerHTML = '';
    return;
  }
  refs.bucketTrack.innerHTML = segments.map((segment) => `
    <div class="bucket-segment" style="width:${(segment.percent * 100).toFixed(2)}%;background:${segment.color}">
      <span>${segment.label} ${(segment.percent * 100).toFixed(1)}%</span>
    </div>
  `).join('');
}

function renderSortChips() {
  if (refs.sortGroup) {
    refs.sortGroup.classList.toggle('sort-group--subtle', UI_FLAGS.subtleSortControls);
    refs.sortGroup.dataset.open = state.sortMenuOpen ? 'true' : 'false';
    refs.sortGroup.hidden = UI_FLAGS.subtleSortControls ? !state.sortMenuOpen : false;
  }
  if (sortToggleButton) {
    sortToggleButton.hidden = !UI_FLAGS.subtleSortControls || state.sortMenuOpen;
    sortToggleButton.classList.toggle('is-active', state.sortMenuOpen);
    sortToggleButton.setAttribute('aria-expanded', state.sortMenuOpen ? 'true' : 'false');
    sortToggleButton.title = `${UI_TEXT.sort} \u00b7 ${state.sortField === 'effectiveYield' ? LABELS.sortDividendYield : LABELS.sortMarketValue}`;
    sortToggleButton.innerHTML = state.sortDirection === 'asc'
      ? `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 18V6.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"></path>
          <path d="M8.8 9.7L12 6.5l3.2 3.2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
      `
      : `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 6v11.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"></path>
          <path d="M8.8 14.3L12 17.5l3.2-3.2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
      `;
  }
  refs.sortChips.forEach((chip) => {
    const field = chip.dataset.sortField;
    const isActive = field === state.sortField;
    const label = field === 'effectiveYield' ? LABELS.sortDividendYield : LABELS.sortMarketValue;
    const arrow = isActive ? (state.sortDirection === 'desc' ? '\u2193' : '\u2191') : '';
    chip.classList.toggle('is-active', isActive);
    chip.hidden = UI_FLAGS.subtleSortControls ? !state.sortMenuOpen : false;
    chip.classList.toggle('is-subtle-primary', false);
    chip.textContent = arrow ? `${label} ${arrow}` : label;
  });
}

function renderTimestamp() {
  refs.marketTimestamp.textContent = formatTimestamp(state.lastUpdatedAt);
}

function renderPrivacyButton() {
  refs.privacyButton.classList.toggle('is-hidden', !state.showAmounts);
}

function renderHoldings(holdings) {
  activeDividendTooltipButton = null;
  if (!holdings.length) {
    refs.stockList.innerHTML = '<article class="holding-card empty-card"></article>';
    return;
  }

  refs.stockList.innerHTML = holdings.map((item) => {
    const priceText = state.showAmounts ? formatPlainPrice(item.price) : MASK_PRICE;
    const marketValueText = state.showAmounts ? formatMoney(item.marketValueCny, 'CNY') : MASK_AMOUNT;
    const annualDividendText = state.showAmounts ? formatMoney(item.netAnnualDividendCny, 'CNY') : MASK_AMOUNT;
    const weightText = `${(item.holdingWeight * 100).toFixed(1)}%`;
    const statusKey = normalizeDividendStatus(item.dividendStatus, 'missing');
    const tooltipLines = buildDividendTooltipLines(item);
    const tooltipHtml = tooltipLines.map((line) => `<span>${escapeHtml(line)}</span>`).join('');
    const statusLabel = getDividendStatusLabel(statusKey);
    const dividendValueButtonHtml = `
      <button
        class="dividend-status-button dividend-status-button--value is-${statusKey}"
        type="button"
        aria-label="${escapeHtml(statusLabel)}"
        aria-expanded="false"
        title="${escapeHtml(tooltipLines.join('\n'))}"
        data-tooltip-side="left"
      >
        ${formatPercent(item.effectiveYield)}
        <span class="dividend-status-tooltip">${tooltipHtml}</span>
      </button>
    `;

    return `
      <div class="holding-swipe" data-id="${item.localId}" style="--holding-swipe-offset:0px;">
        <button class="holding-swipe-delete" type="button" data-action="delete" aria-label="${LABELS.deleteConfirm} ${escapeHtml(item.name)}">
          <span>删除</span>
        </button>
        <article class="holding-card" data-id="${item.localId}" data-dividend-status="${escapeHtml(item.dividendStatus || 'missing')}">
        <header class="holding-head">
          <div class="holding-main">
            <h3 class="holding-name">${escapeHtml(item.name)}</h3>
            <div class="holding-meta-row">
              <span class="holding-price">${priceText}</span>
              <span class="holding-divider">${getHoldingTitleDivider()}</span>
              <span class="holding-code">${escapeHtml(item.symbol)}</span>
            </div>
          </div>
          <div class="holding-side">
            <span class="weight-pill is-${item.bucket === 'income' ? 'income' : 'core'}">${weightText}</span>
            <button class="ghost-minus" type="button" data-action="delete" aria-label="${LABELS.deleteConfirm} ${escapeHtml(item.name)}">-</button>
          </div>
        </header>
        <div class="holding-grid">
          <div class="metric-static">
            <div class="metric-row">
              <span class="metric-label">${LABELS.marketValue}</span>
              <span class="metric-value">${marketValueText}</span>
            </div>
          </div>
          <button class="metric-button metric-right" type="button" data-action="edit-quantity">
            <div class="metric-row metric-right">
              <span class="metric-label">${LABELS.quantity}</span>
              <span class="metric-value">${escapeHtml(String(item.quantity))}</span>
            </div>
          </button>
          <button class="metric-button" type="button" data-action="edit-tax">
            <div class="metric-row">
              <span class="metric-label">${LABELS.annualDividend}</span>
              <span class="metric-value is-income">${annualDividendText}</span>
            </div>
          </button>
          <div class="metric-static metric-right metric-static--yield">
            <div class="metric-row metric-right metric-row--yield">
              <button class="metric-label-button" type="button" data-action="edit-dividend">${LABELS.dividendYield}</button>
              ${dividendValueButtonHtml}
            </div>
          </div>
        </div>
        </article>
      </div>
    `;
  }).join('');
}

function isHoldingSwipeEnabled() {
  return window.matchMedia('(max-width: 560px)').matches;
}

function getHoldingSwipeOffset(wrapper) {
  return safeNumber(wrapper.style.getPropertyValue('--holding-swipe-offset').replace('px', ''), 0);
}

function setHoldingSwipeOffset(wrapper, offset) {
  wrapper.style.setProperty('--holding-swipe-offset', `${Math.max(0, Math.min(HOLDING_SWIPE_DELETE_WIDTH, offset))}px`);
}

function closeHoldingSwipe(wrapper) {
  if (!wrapper) {
    return;
  }
  wrapper.classList.remove('is-swipe-open');
  setHoldingSwipeOffset(wrapper, 0);
  if (activeHoldingSwipe && activeHoldingSwipe.wrapper === wrapper) {
    activeHoldingSwipe = null;
  }
}

function openHoldingSwipe(wrapper) {
  if (!wrapper) {
    return;
  }
  const opened = refs.stockList.querySelector('.holding-swipe.is-swipe-open');
  if (opened && opened !== wrapper) {
    closeHoldingSwipe(opened);
  }
  wrapper.classList.add('is-swipe-open');
  setHoldingSwipeOffset(wrapper, HOLDING_SWIPE_DELETE_WIDTH);
}

function openModal(type, payload = {}) {
  state.modal = type;
  state.modalPayload = payload;
  document.body.classList.add('modal-open');
  renderModal();
}

function closeModal() {
  state.modal = null;
  state.modalPayload = null;
  document.body.classList.remove('modal-open');
  refs.modalRoot.innerHTML = '';
}

function setModalBucketSelection(nextBucket) {
  const bucket = nextBucket === 'income' ? 'income' : 'core';
  const input = document.getElementById('modalBucketInput');
  if (input) {
    input.value = bucket;
  }
  Array.from(document.querySelectorAll('[data-bucket-option]')).forEach((button) => {
    const isActive = button.dataset.bucketOption === bucket;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

function renderModal() {
  if (!state.modal) {
    refs.modalRoot.innerHTML = '';
    return;
  }

  let title = '';
  let note = '';
  let fields = '';

  if (state.modal === 'quantity') {
    title = LABELS.quantityTitle;
    note = state.modalPayload.name || '';
    fields = `<input id="modalQuantityInput" class="modal-input" type="number" inputmode="decimal" value="${escapeHtml(String(state.modalPayload.value ?? ''))}" placeholder="${LABELS.quantityPlaceholder}">`;
  }

  if (state.modal === 'tax') {
    title = LABELS.taxTitle;
    note = state.modalPayload.name || '';
    fields = `<input id="modalTaxInput" class="modal-input" type="number" inputmode="decimal" value="${escapeHtml(String(state.modalPayload.value ?? ''))}" placeholder="${LABELS.taxPlaceholder}">`;
  }

  if (state.modal === 'dividend') {
    title = LABELS.dividendPerShareTitle;
    note = [
      state.modalPayload.name || '',
      state.modalPayload.currency ? `${LABELS.dividendPerShareHint} (${state.modalPayload.currency})` : LABELS.dividendPerShareHint
    ].filter(Boolean).join(' - ');
    fields = `<input id="modalDividendInput" class="modal-input" type="number" inputmode="decimal" value="${escapeHtml(String(state.modalPayload.value ?? ''))}" placeholder="${LABELS.dividendPerSharePlaceholder}">`;
  }

  if (state.modal === 'liability') {
    title = LABELS.liabilityTitle;
    note = LABELS.totalMarketValue;
    fields = `<input id="modalLiabilityInput" class="modal-input" type="number" inputmode="decimal" value="${escapeHtml(String(state.modalPayload.value ?? ''))}" placeholder="${LABELS.liabilityPlaceholder}">`;
  }

  if (state.modal === 'add') {
    title = LABELS.addTitle;
    note = LABELS.addNote;
    fields = `
      <input id="modalSymbolInput" class="modal-input" type="text" placeholder="${LABELS.symbolPlaceholder}">
      <input id="modalQuantityInput" class="modal-input" type="number" inputmode="decimal" placeholder="${LABELS.quantityPlaceholder}">
      <div class="modal-bucket-group" role="group" aria-label="${LABELS.core} / ${LABELS.income}">
        <button class="modal-bucket-button is-core is-active" type="button" data-bucket-option="core" aria-pressed="true">${LABELS.core}</button>
        <button class="modal-bucket-button is-income" type="button" data-bucket-option="income" aria-pressed="false">${LABELS.income}</button>
      </div>
      <input id="modalBucketInput" type="hidden" value="core">
    `;
  }

  refs.modalRoot.innerHTML = `
    <div class="modal-mask" data-modal-action="close"></div>
    <section class="modal-sheet" role="dialog" aria-modal="true">
      <h3 class="modal-title">${title}</h3>
      ${note ? `<p class="modal-note">${escapeHtml(note)}</p>` : ''}
      ${fields}
      <div class="modal-actions">
        <button class="modal-button modal-button--secondary" type="button" data-modal-action="cancel">${LABELS.cancel}</button>
        <button class="modal-button modal-button--primary" type="button" data-modal-action="save">${LABELS.save}</button>
      </div>
    </section>
  `;
}

function handleModalSave() {
  if (state.modal === 'quantity') {
    const value = Math.max(0, safeNumber(document.getElementById('modalQuantityInput').value, 0));
    state.holdings = state.holdings.map((item) => (
      item.localId === state.modalPayload.localId ? { ...item, quantity: value } : item
    ));
  }

  if (state.modal === 'tax') {
    const value = document.getElementById('modalTaxInput').value.trim();
    state.holdings = state.holdings.map((item) => (
      item.localId === state.modalPayload.localId ? { ...item, taxRateOverride: value } : item
    ));
  }

  if (state.modal === 'dividend') {
    const value = sanitizePerShareOverrideInput(document.getElementById('modalDividendInput').value.trim());
    state.holdings = state.holdings.map((item) => (
      item.localId === state.modalPayload.localId
        ? {
            ...item,
            dividendPerShareTtmOverride: value,
            dividendPerShareTtmOverrideTouched: value !== ''
          }
        : item
    ));
  }

  if (state.modal === 'liability') {
    state.liabilityCny = Math.max(0, safeNumber(document.getElementById('modalLiabilityInput').value, 0));
  }

  if (state.modal === 'add') {
    const symbol = normalizeSymbol(document.getElementById('modalSymbolInput').value);
    const quantity = Math.max(0, safeNumber(document.getElementById('modalQuantityInput').value, 0));
    const bucket = document.getElementById('modalBucketInput').value === 'income' ? 'income' : 'core';

    if (!symbol) {
      window.alert(LABELS.missingSymbol);
      return;
    }

    if (state.holdings.some((item) => normalizeSymbol(item.symbol) === symbol)) {
      window.alert(`${symbol} ${LABELS.duplicateHolding}`);
      return;
    }

    state.holdings = state.holdings.concat({
      localId: state.nextId,
      symbol,
      quantity,
      bucket,
      taxRateOverride: '',
      dividendPerShareTtmOverride: '',
      dividendPerShareTtmOverrideTouched: false
    });
    state.quotes = mergeQuotes(state.quotes, { [symbol]: inferQuote(symbol) });
    state.nextId += 1;
  }

  saveState();
  closeModal();
  renderApp();
}

function exportPortfolioSnapshot() {
  try {
    const payload = buildPortfolioSnapshot();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = PORTFOLIO_SNAPSHOT_FILENAME;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.warn('export failed', error);
    window.alert(LABELS.exportFailed);
  }
}

function importSnapshot(payload) {
  const source = payload && payload.state ? payload.state : payload;
  const normalizedSource = source && Array.isArray(source.holdings)
    ? source
    : source && Array.isArray(source.positions)
      ? { ...source, holdings: source.positions }
      : source;
  if (!normalizedSource || !Array.isArray(normalizedSource.holdings)) {
    throw new Error('invalid backup payload');
  }
  applySnapshot(normalizedSource);
  saveState();
  renderApp();
}

async function handleImportFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) {
    return;
  }

  try {
    if (!window.confirm(LABELS.importConfirm)) {
      return;
    }
    const text = await file.text();
    const payload = JSON.parse(text);
    importSnapshot(payload);
    await refreshMarketData({ silent: true });
  } catch (error) {
    console.warn('import failed', error);
    window.alert(LABELS.importFailed);
  } finally {
    refs.importFileInput.value = '';
  }
}

function applyMarketPayload(payload) {
  if (payload && payload.rates) {
    state.rates = {
      CNY: 1,
      USD: safeNumber(payload.rates.USD, state.rates.USD),
      HKD: safeNumber(payload.rates.HKD, state.rates.HKD)
    };
  }
  if (payload && payload.quotes) {
    state.quotes = mergeQuotes(state.quotes, payload.quotes);
  }
  if (payload && typeof payload.updatedAt === 'string') {
    state.lastUpdatedAt = payload.updatedAt;
  }
}

function applyDividendOverridePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return 0;
  }

  const overrides = {};
  Object.entries(payload).forEach(([rawSymbol, rawOverride]) => {
    const symbol = normalizeSymbol(rawSymbol);
    if (!symbol || !rawOverride || typeof rawOverride !== 'object') {
      return;
    }

    overrides[symbol] = {
      symbol,
      dividendPerShareTtm: safeNumber(rawOverride.dividendPerShareTtm, 0),
      dividendSource: 'manual',
      dividendUpdatedAt: typeof rawOverride.updatedAt === 'string' ? rawOverride.updatedAt : '',
      lastExDate: typeof rawOverride.lastExDate === 'string' ? rawOverride.lastExDate : '',
      dividendFetchError: '',
      dividendStatus: 'manual',
      reason: typeof rawOverride.reason === 'string' ? rawOverride.reason : ''
    };
  });

  if (Object.keys(overrides).length) {
    state.quotes = mergeQuotes(state.quotes, overrides);
  }
  return Object.keys(overrides).length;
}

async function refreshMarketData(options = {}) {
  const { silent = false } = options;
  if (state.syncing) {
    return;
  }
  state.syncing = true;
  refs.refreshButton.disabled = true;

  let hasUpdates = false;
  let lastError = null;

  try {
    try {
      const configPayload = await loadClientConfigSnapshot();
      applyClientConfigPayload(configPayload);
    } catch (error) {
      lastError = lastError || error;
      console.warn('config refresh failed', error);
    }

    try {
      const payload = await loadLatestMarketSnapshot();
      if (!payload || payload.ok === false) {
        throw new Error(payload && payload.error ? payload.error : 'invalid market payload');
      }
      applyMarketPayload(payload);
      hasUpdates = true;
    } catch (error) {
      lastError = error;
      console.warn('snapshot refresh failed', error);
    }

    try {
      const overrides = await loadDividendOverrideSnapshot();
      hasUpdates = applyDividendOverridePayload(overrides) > 0 || hasUpdates;
    } catch (error) {
      lastError = lastError || error;
      console.warn('dividend override refresh failed', error);
    }

    try {
      const realtimeQuotes = await loadRealtimeQuoteSnapshot();
      if (Object.keys(realtimeQuotes).length) {
        state.quotes = mergeQuotes(state.quotes, realtimeQuotes);
        hasUpdates = true;
      }
    } catch (error) {
      lastError = lastError || error;
      console.warn('realtime quote refresh failed', error);
    }

    if (!hasUpdates) {
      throw lastError || new Error('invalid market payload');
    }

    saveState();
    renderApp();
  } catch (error) {
    console.warn('refresh failed', error);
    if (!silent) {
      window.alert(LABELS.refreshFailed);
    }
  } finally {
    state.syncing = false;
    refs.refreshButton.disabled = false;
  }
}

function applyClientConfigPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return;
  }
  currentDividendStaleDays = normalizeStaleDays(payload.staleDays, DEFAULT_STALE_DAYS);
}

async function loadClientConfigSnapshot() {
  const response = await fetch(CONFIG_ENDPOINT + '?t=' + Date.now(), { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('config request failed: ' + response.status);
  }
  return await response.json();
}

async function loadLatestMarketSnapshot() {
  const errors = [];

  try {
    const response = await fetch(MARKET_ENDPOINT + '?t=' + Date.now(), { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('site market request failed: ' + response.status);
    }
    return await response.json();
  } catch (error) {
    errors.push(error);
  }

  try {
    const response = await fetch(GITHUB_MARKET_CONTENTS_API + '?t=' + Date.now(), {
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json'
      }
    });
    if (!response.ok) {
      throw new Error('github contents request failed: ' + response.status);
    }
    const payload = await response.json();
    if (payload && typeof payload.content === 'string') {
      const decoded = decodeBase64Utf8(payload.content.replace(/\\n/g, ''));
      return JSON.parse(decoded);
    }
    throw new Error('github contents payload missing content');
  } catch (error) {
    errors.push(error);
  }

  throw errors[0] || new Error('failed to load market snapshot');
}

async function loadDividendOverrideSnapshot() {
  try {
    const response = await fetch(OVERRIDE_ENDPOINT + '?t=' + Date.now(), { cache: 'no-store' });
    if (response.status === 404) {
      return {};
    }
    if (!response.ok) {
      throw new Error('override request failed: ' + response.status);
    }
    return await response.json();
  } catch (error) {
    throw error;
  }
}

function decodeBase64Utf8(value) {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

async function loadTencentQuoteBatch(symbols) {
  const codes = [];
  const codeMap = new Map();

  symbols.forEach((symbol) => {
    const code = toTencentSymbol(symbol);
    if (!code) {
      return;
    }
    codeMap.set(code, symbol);
    codes.push(code);
  });

  if (!codes.length) {
    return {};
  }

  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timeoutId = window.setTimeout(() => {
      script.remove();
      reject(new Error('tencent realtime request timeout'));
    }, 8000);

    script.async = true;
    script.src = `${TENCENT_REALTIME_ENDPOINT}${codes.join(',')}&_=${Date.now()}`;
    script.onload = () => {
      window.clearTimeout(timeoutId);
      script.remove();
      resolve();
    };
    script.onerror = () => {
      window.clearTimeout(timeoutId);
      script.remove();
      reject(new Error('tencent realtime request failed'));
    };
    document.head.appendChild(script);
  });

  const quotes = {};
  codes.forEach((code) => {
    const key = `v_${code}`;
    const payload = window[key];
    try {
      delete window[key];
    } catch (error) {
      window[key] = undefined;
    }

    if (typeof payload !== 'string') {
      return;
    }

    const fields = payload.split('~');
    if (fields.length < 5) {
      return;
    }

    const symbol = codeMap.get(code);
    if (!symbol) {
      return;
    }

    const fallback = inferQuoteFromMap(symbol, state.quotes);
    const price = safeNumber(fields[3], safeNumber(fields[4], 0));
    if (price <= 0) {
      return;
    }

    quotes[symbol] = {
      symbol,
      name: String(fields[1] || fallback.name || symbol).trim() || fallback.name || symbol,
      market: fallback.market,
      currency: fallback.currency,
      price
    };
  });

  return quotes;
}

async function loadRealtimeQuoteSnapshot() {
  const symbols = getRealtimeSymbols();
  const quotes = {};

  for (const batch of chunkSymbols(symbols, TENCENT_BATCH_SIZE)) {
    Object.assign(quotes, await loadTencentQuoteBatch(batch));
  }

  return quotes;
}

async function cleanupLegacyCaches() {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('bopup-ledger'))
          .map((key) => caches.delete(key))
      );
    }
  } catch (error) {
    console.warn('legacy cache cleanup failed', error);
  }
}

function renderApp() {
  const summary = computeHoldings();
  const companySegments = getCompanySegments(summary.holdings);
  const bucketSegments = getBucketSegments(summary.holdings);
  const chartShell = refs.chartLayout && refs.chartLayout.parentElement;

  if (chartShell && UI_FLAGS.bucketSummaryV2) {
    chartShell.insertBefore(refs.bucketTrack, refs.chartLayout);
  } else if (chartShell && refs.bucketTrack !== chartShell.lastElementChild) {
    chartShell.appendChild(refs.bucketTrack);
  }

  document.body.classList.toggle('ui-refined-accent', UI_FLAGS.refinedAccentColors);
  renderSummary(summary);
  renderDonut(companySegments);
  renderLegend(companySegments);
  renderBuckets(bucketSegments, summary.holdings, summary);
  renderSortChips();
  renderTimestamp();
  renderPrivacyButton();
  renderHoldings(summary.holdings);
}

configureUiChrome();

refs.privacyButton.addEventListener('click', () => {
  state.showAmounts = !state.showAmounts;
  saveState();
  renderApp();
});

refs.exportButton.addEventListener('click', exportPortfolioSnapshot);
refs.importButton.addEventListener('click', () => refs.importFileInput.click());
refs.importFileInput.addEventListener('change', handleImportFile);

refs.legendToggle.addEventListener('click', () => {
  state.legendExpanded = !state.legendExpanded;
  saveState();
  renderApp();
});

refs.refreshButton.addEventListener('click', () => {
  refreshMarketData({ silent: false });
});

refs.addButton.addEventListener('click', () => {
  openModal('add');
});

refs.sortChips.forEach((chip) => {
  chip.addEventListener('click', () => {
    const nextField = chip.dataset.sortField;
    if (!nextField) {
      return;
    }
    if (UI_FLAGS.subtleSortControls) {
      if (!state.sortMenuOpen) {
        return;
      }
      const isActive = state.sortField === nextField;
      if (isActive) {
        state.sortDirection = state.sortDirection === 'desc' ? 'asc' : 'desc';
      } else {
        state.sortField = nextField;
        state.sortDirection = 'desc';
      }
      state.sortMenuOpen = false;
      saveState();
      renderApp();
      return;
    }
    if (state.sortField === nextField) {
      state.sortDirection = state.sortDirection === 'desc' ? 'asc' : 'desc';
    } else {
      state.sortField = nextField;
      state.sortDirection = 'desc';
    }
    saveState();
    renderApp();
  });
});

document.addEventListener('click', (event) => {
  if (!UI_FLAGS.subtleSortControls || !state.sortMenuOpen) {
    return;
  }
  if (event.target.closest('.sort-group') || event.target.closest('.sort-toggle-button')) {
    return;
  }
  state.sortMenuOpen = false;
  renderSortChips();
});

document.addEventListener('click', (event) => {
  if (!activeDividendTooltipButton) {
    return;
  }
  if (event.target.closest('.dividend-status-button--value') === activeDividendTooltipButton) {
    return;
  }
  closeActiveDividendTooltip(true);
});

refs.bucketTrack.addEventListener('click', (event) => {
  if (!UI_FLAGS.bucketSummaryV2) {
    return;
  }
  const button = event.target.closest('[data-bucket-toggle]');
  if (!button) {
    return;
  }
  const nextKey = button.dataset.bucketToggle;
  state.activeBucketKey = state.activeBucketKey === nextKey ? null : nextKey;
  renderApp();
});

refs.stockList.addEventListener('mouseover', (event) => {
  const button = event.target.closest('.dividend-status-button');
  if (!button) {
    return;
  }
  updateDividendTooltipSide(button);
});

refs.stockList.addEventListener('focusin', (event) => {
  const button = event.target.closest('.dividend-status-button');
  if (!button) {
    return;
  }
  updateDividendTooltipSide(button);
});

refs.summaryGrid.addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-summary-action="liability"]');
  if (!trigger) {
    return;
  }
  openModal('liability', {
    value: state.liabilityCny > 0 ? String(state.liabilityCny) : ''
  });
});

refs.stockList.addEventListener('click', (event) => {
  if (Date.now() < suppressHoldingClickUntil) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  const tooltipButton = event.target.closest('.dividend-status-button');
  if (tooltipButton) {
    if (tooltipButton.classList.contains('dividend-status-button--value')) {
      event.preventDefault();
      event.stopPropagation();
      toggleDividendTooltip(tooltipButton);
      return;
    }
    updateDividendTooltipSide(tooltipButton);
  }
  const button = event.target.closest('[data-action]');
  const card = event.target.closest('.holding-card');
  const swipeItem = event.target.closest('.holding-swipe');
  const targetItem = card || swipeItem;
  if (!button || !targetItem) {
    return;
  }
  const localId = safeNumber(targetItem.dataset.id, 0);
  const holding = state.holdings.find((item) => item.localId === localId);
  if (!holding) {
    return;
  }
  const computedHolding = computeHoldings().holdings.find((item) => item.localId === localId);
  const action = button.dataset.action;

  if (action === 'delete') {
    if (!window.confirm(`${LABELS.deleteConfirm}\n${holding.symbol}`)) {
      return;
    }
    state.holdings = state.holdings.filter((item) => item.localId !== localId);
    saveState();
    renderApp();
    return;
  }

  if (action === 'edit-quantity') {
    openModal('quantity', {
      localId,
      name: computedHolding ? computedHolding.name : holding.symbol,
      value: holding.quantity
    });
    return;
  }

  if (action === 'edit-tax') {
    openModal('tax', {
      localId,
      name: computedHolding ? computedHolding.name : holding.symbol,
      value: holding.taxRateOverride
    });
    return;
  }

  if (action === 'edit-dividend') {
    openModal('dividend', {
      localId,
      name: computedHolding ? computedHolding.name : holding.symbol,
      currency: computedHolding ? computedHolding.currency : inferQuote(holding.symbol).currency,
      value: holding.dividendPerShareTtmOverride
    });
  }
});

refs.stockList.addEventListener('touchstart', (event) => {
  if (!isHoldingSwipeEnabled() || event.touches.length !== 1) {
    return;
  }
  const wrapper = event.target.closest('.holding-swipe');
  const card = event.target.closest('.holding-card');
  if (!wrapper || !card) {
    return;
  }
  const opened = refs.stockList.querySelector('.holding-swipe.is-swipe-open');
  if (opened && opened !== wrapper) {
    closeHoldingSwipe(opened);
  }
  const touch = event.touches[0];
  activeHoldingSwipe = {
    wrapper,
    startX: touch.clientX,
    startY: touch.clientY,
    startOffset: getHoldingSwipeOffset(wrapper),
    dragging: false,
    didSwipe: false
  };
}, { passive: true });

refs.stockList.addEventListener('touchmove', (event) => {
  if (!activeHoldingSwipe || !isHoldingSwipeEnabled()) {
    return;
  }
  const touch = event.touches[0];
  const dx = touch.clientX - activeHoldingSwipe.startX;
  const dy = touch.clientY - activeHoldingSwipe.startY;

  if (!activeHoldingSwipe.dragging) {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) {
      return;
    }
    if (Math.abs(dy) > Math.abs(dx)) {
      activeHoldingSwipe = null;
      return;
    }
    activeHoldingSwipe.dragging = true;
    activeHoldingSwipe.didSwipe = true;
  }

  event.preventDefault();
  setHoldingSwipeOffset(activeHoldingSwipe.wrapper, activeHoldingSwipe.startOffset - dx);
}, { passive: false });

function settleHoldingSwipe() {
  if (!activeHoldingSwipe) {
    return;
  }
  const wrapper = activeHoldingSwipe.wrapper;
  if (activeHoldingSwipe.didSwipe) {
    suppressHoldingClickUntil = Date.now() + 280;
  }
  const shouldOpen = activeHoldingSwipe.dragging && getHoldingSwipeOffset(wrapper) >= HOLDING_SWIPE_OPEN_THRESHOLD;
  if (shouldOpen) {
    openHoldingSwipe(wrapper);
  } else {
    closeHoldingSwipe(wrapper);
  }
  activeHoldingSwipe = null;
}

refs.stockList.addEventListener('touchend', settleHoldingSwipe, { passive: true });
refs.stockList.addEventListener('touchcancel', settleHoldingSwipe, { passive: true });

refs.modalRoot.addEventListener('click', (event) => {
  const bucketButton = event.target.closest('[data-bucket-option]');
  if (bucketButton) {
    setModalBucketSelection(bucketButton.dataset.bucketOption);
    return;
  }
  const action = event.target.closest('[data-modal-action]');
  if (!action) {
    return;
  }
  const type = action.dataset.modalAction;
  if (type === 'close' || type === 'cancel') {
    closeModal();
    return;
  }
  if (type === 'save') {
    handleModalSave();
  }
});

async function boot() {
  applySnapshot(createDefaultSnapshot());
  restoreState();
  renderApp();
  await cleanupLegacyCaches();
  await refreshMarketData({ silent: true });
}

boot();

