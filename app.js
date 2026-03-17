/* ============================================================================
 *  BOPUP LEDGER — 波普账本
 *  Single-file architecture · Section index:
 *
 *  [1] CONSTANTS & CONFIGURATION
 *  [2] UI FLAGS, LABELS & THEME
 *  [3] DEFAULT DATA (quotes, holdings, rates)
 *  [4] APPLICATION STATE & DOM REFS
 *  [5] UTILITY FUNCTIONS
 *  [6] DIVIDEND LOGIC
 *  [7] SYMBOL & QUOTE HELPERS
 *  [8] SNAPSHOT & PERSISTENCE
 *  [9] COMPUTED DATA
 *  [10] RENDER — Summary, Charts, Holdings, Modals
 *  [11] SWIPE & INTERACTION HELPERS
 *  [12] MODAL SYSTEM
 *  [13] IMPORT / EXPORT
 *  [14] NETWORK — Market data, Tencent realtime, Config
 *  [15] BOOT & EVENT BINDINGS
 * ============================================================================ */

/* ----------------------------------------------------------------------------
 *  [1] CONSTANTS & CONFIGURATION
 * -------------------------------------------------------------------------- */
const STORAGE_KEY = 'bopup-ledger-web-state';
const MARKET_ENDPOINT = './data/market.json';
const OVERRIDE_ENDPOINT = './data/override.json';
const CONFIG_ENDPOINT = './config.json';
const PORTFOLIO_SNAPSHOT_FILENAME = 'portfolio_snapshot.json';
const GITHUB_PUBLIC_REPO = 'bebop-m/bebop-ledger-web';
const GITHUB_PRIVATE_REPO = 'bebop-m/bebop-ledger-private';
const GITHUB_MARKET_CONTENTS_API = `https://api.github.com/repos/${GITHUB_PUBLIC_REPO}/contents/data/market.json`;
const GITHUB_PRIVATE_PORTFOLIO_CONTENTS_API = `https://api.github.com/repos/${GITHUB_PRIVATE_REPO}/contents/data/portfolio.json`;
const GITHUB_WATCHLIST_CONTENTS_API = `https://api.github.com/repos/${GITHUB_PUBLIC_REPO}/contents/data/watchlist.json`;
const GITHUB_MARKET_WORKFLOW_DISPATCH_API = `https://api.github.com/repos/${GITHUB_PUBLIC_REPO}/actions/workflows/update-market-data.yml/dispatches`;
const GITHUB_TOKEN_STORAGE_KEY = 'bebop-ledger-github-token-v2';
const TENCENT_REALTIME_ENDPOINT = 'https://qt.gtimg.cn/q=';
const TENCENT_BATCH_SIZE = 60;
const LEGEND_COLLAPSED_COUNT = 8;
const MASK_AMOUNT = '******';
const MASK_PRICE = '***.**';
const DEFAULT_STALE_DAYS = 7;
const MARKET_DEPLOY_WAIT_TIMEOUT_MS = 90000;
const MARKET_DEPLOY_WAIT_INTERVAL_MS = 3000;
const VALID_DIVIDEND_SOURCES = new Set(['yfinance', 'yahoo', 'eodhd', 'manual', 'cache']);
const VALID_DIVIDEND_STATUSES = new Set(['manual', 'fresh', 'stale', 'missing']);
let currentDividendStaleDays = DEFAULT_STALE_DAYS;
let activeHoldingSwipe = null;
let activeDividendTooltipButton = null;
let suppressHoldingClickUntil = 0;

/* ----------------------------------------------------------------------------
 *  [2] UI FLAGS, LABELS & THEME
 * -------------------------------------------------------------------------- */
// Each UI refinement block stays behind its own flag for quick rollback.
const UI_FLAGS = {
  titleDotSeparator: true,
  compactFxSummary: true,
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

/* ----------------------------------------------------------------------------
 *  [3] DEFAULT DATA (quotes, holdings, rates)
 * -------------------------------------------------------------------------- */
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
  sortDividendAmount: '\u80a1\u606f\u91d1\u989d',
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
  syncSuccess: '\u79c1\u6709\u6301\u4ed3\u5df2\u540c\u6b65',
  syncFailed: '\u79c1\u6709\u6301\u4ed3\u540c\u6b65\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5 Token \u6216\u4ed3\u5e93\u6743\u9650\u3002',
  syncTokenPrompt: '\u8bf7\u8f93\u5165 GitHub Personal Access Token\uff08\u53ea\u9700\u8f93\u5165\u4e00\u6b21\uff09\uff1a',
  syncTokenInvalid: 'Token \u4e0d\u80fd\u4e3a\u7a7a',
  cloudRestored: '\u5df2\u4ece\u79c1\u6709\u4ed3\u5e93\u6062\u590d\u771f\u5b9e\u6301\u4ed3',
  syncNoPrivateSnapshot: '\u672a\u53d1\u73b0\u79c1\u6709\u6301\u4ed3\uff0c\u8bf7\u5148\u65b0\u589e\u6216\u7f16\u8f91\u6301\u4ed3\u540e\u518d\u540c\u6b65\u3002',
  marketValue: '\u6301\u4ed3\u5e02\u503c\uff1a',
  quantity: '\u6570\u91cf\uff1a',
  annualDividend: '\u7a0e\u540e\u80a1\u606f\uff1a',
  dividendYield: '\u80a1\u606f\u7387\uff1a',
  dividendSource: '\u6570\u636e\u6765\u6e90',
  dividendUpdatedAt: '\u6700\u8fd1\u66f4\u65b0',
  lastExDate: '\u6700\u8fd1\u9664\u606f\u65e5',
  dividendFetchError: '\u6293\u53d6\u9519\u8bef',
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
  '00700.HK': { name: '腾讯控股', market: 'HK', currency: 'HKD', price: 0, dividendPerShareTtm: 0 },
  '600519.SH': { name: '贵州茅台', market: 'CN', currency: 'CNY', price: 0, dividendPerShareTtm: 0 },
  '000651.SZ': { name: '格力电器', market: 'CN', currency: 'CNY', price: 0, dividendPerShareTtm: 0 },
  '00883.HK': { name: '中国海洋石油', market: 'HK', currency: 'HKD', price: 0, dividendPerShareTtm: 0 },
  '06049.HK': { name: '保利物业', market: 'HK', currency: 'HKD', price: 0, dividendPerShareTtm: 0 },
  '000333.SZ': { name: '美的集团', market: 'CN', currency: 'CNY', price: 0, dividendPerShareTtm: 0 },
  '02669.HK': { name: '中海物业', market: 'HK', currency: 'HKD', price: 0, dividendPerShareTtm: 0 },
  PDD: { name: '拼多多', market: 'US', currency: 'USD', price: 0, dividendPerShareTtm: 0 },
  '01571.HK': { name: '信邦控股', market: 'HK', currency: 'HKD', price: 0, dividendPerShareTtm: 0 },
  '00270.HK': { name: '粤海投资', market: 'HK', currency: 'HKD', price: 0, dividendPerShareTtm: 0 },
  '09618.HK': { name: '京东集团', market: 'HK', currency: 'HKD', price: 0, dividendPerShareTtm: 0 },
  '00728.HK': { name: '中国电信', market: 'HK', currency: 'HKD', price: 0, dividendPerShareTtm: 0 },
  '02333.HK': { name: '长城汽车', market: 'HK', currency: 'HKD', price: 0, dividendPerShareTtm: 0 },
  '600177.SH': { name: '雅戈尔', market: 'CN', currency: 'CNY', price: 0, dividendPerShareTtm: 0 },
  '03900.HK': { name: '绿城中国', market: 'HK', currency: 'HKD', price: 0, dividendPerShareTtm: 0 },
  '01995.HK': { name: '永升服务', market: 'HK', currency: 'HKD', price: 0, dividendPerShareTtm: 0 },
  '03316.HK': { name: '滨江服务', market: 'HK', currency: 'HKD', price: 0, dividendPerShareTtm: 0 },
  '00816.HK': { name: '金茂服务', market: 'HK', currency: 'HKD', price: 0, dividendPerShareTtm: 0 },
  '513530.SH': { name: '港股通红利ETF', market: 'CN', currency: 'CNY', price: 0, dividendPerShareTtm: 0 },
  '00823.HK': { name: '领展房产基金', market: 'HK', currency: 'HKD', price: 0, dividendPerShareTtm: 0 },
  '02156.HK': { name: '通力环球', market: 'HK', currency: 'HKD', price: 0, dividendPerShareTtm: 0 }
});

const DEFAULT_HOLDINGS = [
  { localId: 1, symbol: '00700.HK', quantity: 100, bucket: 'core', taxRateOverride: '', dividendPerShareTtmOverride: '' },
  { localId: 2, symbol: '600519.SH', quantity: 100, bucket: 'core', taxRateOverride: '', dividendPerShareTtmOverride: '' },
  { localId: 3, symbol: '000651.SZ', quantity: 100, bucket: 'income', taxRateOverride: '', dividendPerShareTtmOverride: '' },
  { localId: 4, symbol: '00883.HK', quantity: 100, bucket: 'income', taxRateOverride: '', dividendPerShareTtmOverride: '' },
  { localId: 5, symbol: '06049.HK', quantity: 100, bucket: 'income', taxRateOverride: '', dividendPerShareTtmOverride: '' },
  { localId: 6, symbol: '000333.SZ', quantity: 100, bucket: 'income', taxRateOverride: '', dividendPerShareTtmOverride: '' },
  { localId: 7, symbol: '02669.HK', quantity: 100, bucket: 'income', taxRateOverride: '', dividendPerShareTtmOverride: '' },
  { localId: 8, symbol: 'PDD', quantity: 100, bucket: 'income', taxRateOverride: '', dividendPerShareTtmOverride: '' },
  { localId: 9, symbol: '01571.HK', quantity: 100, bucket: 'income', taxRateOverride: '', dividendPerShareTtmOverride: '' },
  { localId: 10, symbol: '00270.HK', quantity: 100, bucket: 'income', taxRateOverride: '', dividendPerShareTtmOverride: '' },
  { localId: 11, symbol: '09618.HK', quantity: 100, bucket: 'income', taxRateOverride: '', dividendPerShareTtmOverride: '' },
  { localId: 12, symbol: '00728.HK', quantity: 100, bucket: 'income', taxRateOverride: '', dividendPerShareTtmOverride: '' },
  { localId: 13, symbol: '02333.HK', quantity: 100, bucket: 'income', taxRateOverride: '', dividendPerShareTtmOverride: '' },
  { localId: 14, symbol: '600177.SH', quantity: 100, bucket: 'income', taxRateOverride: '', dividendPerShareTtmOverride: '' },
  { localId: 15, symbol: '03900.HK', quantity: 100, bucket: 'income', taxRateOverride: '', dividendPerShareTtmOverride: '' },
  { localId: 16, symbol: '01995.HK', quantity: 100, bucket: 'income', taxRateOverride: '', dividendPerShareTtmOverride: '' },
  { localId: 17, symbol: '03316.HK', quantity: 100, bucket: 'income', taxRateOverride: '', dividendPerShareTtmOverride: '' },
  { localId: 18, symbol: '00816.HK', quantity: 100, bucket: 'income', taxRateOverride: '', dividendPerShareTtmOverride: '' },
  { localId: 19, symbol: '513530.SH', quantity: 100, bucket: 'income', taxRateOverride: '', dividendPerShareTtmOverride: '' },
  { localId: 20, symbol: '00823.HK', quantity: 100, bucket: 'income', taxRateOverride: '', dividendPerShareTtmOverride: '' },
  { localId: 21, symbol: '02156.HK', quantity: 100, bucket: 'income', taxRateOverride: '', dividendPerShareTtmOverride: '' }
];

/* ----------------------------------------------------------------------------
 *  [4] APPLICATION STATE & DOM REFS
 * -------------------------------------------------------------------------- */
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
  cloudSyncing: false,
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

function showToast(message, options = {}) {
  const { type = 'info', duration = 2200 } = options;
  const el = document.createElement('div');
  el.className = `toast${type === 'error' ? ' is-error' : type === 'success' ? ' is-success' : ''}`;
  el.textContent = message;
  refs.toastContainer.appendChild(el);
  setTimeout(() => {
    el.classList.add('is-leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, duration);
}

function showConfirm(message, options = {}) {
  const { sub = '', okLabel, cancelLabel, danger = false } = options;
  return new Promise((resolve) => {
    const okText = okLabel || LABELS.save || '\u786e\u8ba4';
    const cancelText = cancelLabel || LABELS.cancel || '\u53d6\u6d88';
    refs.confirmRoot.innerHTML = `
      <div class="confirm-mask"></div>
      <section class="confirm-sheet" role="alertdialog" aria-modal="true">
        <p class="confirm-message">${escapeHtml(message)}</p>
        ${sub ? `<p class="confirm-sub">${escapeHtml(sub)}</p>` : ''}
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
      const mask = refs.confirmRoot.querySelector('.confirm-mask');
      const sheet = refs.confirmRoot.querySelector('.confirm-sheet');
      if (mask && sheet) {
        mask.classList.add('is-closing');
        sheet.classList.add('is-closing');
        sheet.addEventListener('animationend', () => {
          refs.confirmRoot.innerHTML = '';
          document.body.classList.remove('modal-open');
          resolve(result);
        }, { once: true });
      } else {
        refs.confirmRoot.innerHTML = '';
        document.body.classList.remove('modal-open');
        resolve(result);
      }
    }
    function handleClick(event) {
      const mask = event.target.closest('.confirm-mask');
      if (mask) { cleanup(false); return; }
      const btn = event.target.closest('[data-confirm]');
      if (!btn) return;
      cleanup(btn.dataset.confirm === 'ok');
    }
    refs.confirmRoot.addEventListener('click', handleClick);
  });
}

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
  refs.exportButton.setAttribute('aria-label', '\u540c\u6b65\u5230\u4e91\u7aef');
  refs.exportButton.title = '\u540c\u6b65\u5230\u4e91\u7aef';
  refs.exportButton.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 17a3.5 3.5 0 0 0-1.6-6.4h-.5A6.2 6.2 0 0 0 6 9.6 4.4 4.4 0 0 0 6.5 18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path>
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

/* ----------------------------------------------------------------------------
 *  [5] UTILITY FUNCTIONS
 * -------------------------------------------------------------------------- */
function roundTo(value, digits = 6) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Number(numeric.toFixed(digits));
}

/* ----------------------------------------------------------------------------
 *  [6] DIVIDEND LOGIC
 * -------------------------------------------------------------------------- */
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

function formatDailyPnl(pnlCny, totalMarketValueCny) {
  const pnl = safeNumber(pnlCny, 0);
  const sign = pnl > 0 ? '+' : pnl < 0 ? '-' : '';
  const absolute = Math.abs(pnl);
  const amountStr = `${sign}\u00a5${Math.round(absolute).toLocaleString('en-US')}`;
  const pctBase = safeNumber(totalMarketValueCny, 0) - pnl;
  const pct = pctBase > 0 ? pnl / pctBase : 0;
  const pctSign = pct > 0 ? '+' : pct < 0 ? '-' : '';
  const pctStr = `(${pctSign}${Math.abs(pct * 100).toFixed(2)}%)`;
  return `${amountStr} ${pctStr}`;
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
  const fetchError = typeof item.dividendFetchError === 'string'
    ? item.dividendFetchError.trim()
    : '';
  if (fetchError) {
    const errorText = fetchError.length > 160
      ? `${fetchError.slice(0, 157)}...`
      : fetchError;
    lines.push(`${LABELS.dividendFetchError}：${errorText}`);
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

/* ----------------------------------------------------------------------------
 *  [7] SYMBOL & QUOTE HELPERS
 * -------------------------------------------------------------------------- */
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
  return chunkSymbols(items, size);
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
      previousClose: safeNumber(rawQuote.previousClose, fallback.previousClose || 0) || undefined,
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

/* ----------------------------------------------------------------------------
 *  [8] SNAPSHOT & PERSISTENCE
 * -------------------------------------------------------------------------- */
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
  state.sortField = snapshot && ['effectiveYield', 'netAnnualDividendCny'].includes(snapshot.sortField) ? snapshot.sortField : 'marketValueCny';
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
    sortField: ['effectiveYield', 'netAnnualDividendCny'].includes(persisted.sortField) ? persisted.sortField : 'marketValueCny',
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
    return true;
  } catch (_error) {
    applySnapshot(createDefaultSnapshot());
    return false;
  }
}

/* ----------------------------------------------------------------------------
 *  [9] COMPUTED DATA
 * -------------------------------------------------------------------------- */
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

    const previousClose = safeNumber(quote.previousClose, 0);
    const dailyPnlCny = previousClose > 0 ? (price - previousClose) * quantity * fxRate : 0;

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
      annualDividendCny: netAnnualDividendCny,
      dailyPnlCny
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
  const totalDailyPnlCny = holdings.reduce((sum, item) => sum + safeNumber(item.dailyPnlCny, 0), 0);
  const divisor = totalMarketValueCny || 1;

  return {
    holdings: holdings.map((item) => ({
      ...item,
      holdingWeight: safeNumber(item.marketValueCny, 0) / divisor
    })),
    totalMarketValueCny,
    totalDividendCny,
    totalDailyPnlCny,
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

/* ----------------------------------------------------------------------------
 *  [10] RENDER — Summary, Charts, Holdings
 * -------------------------------------------------------------------------- */
function renderSummary(summary) {
  const totalLabel = formatDisplayMoney(summary.netMarketValueCny, 'CNY');
  const dividendLabel = formatDisplayMoney(summary.totalDividendCny, 'CNY');
  const overallAverageNetYield = summary.totalMarketValueCny > 0
    ? summary.totalDividendCny / summary.totalMarketValueCny
    : 0;
  const dailyPnl = safeNumber(summary.totalDailyPnlCny, 0);
  const hasPnlData = summary.holdings && summary.holdings.some((h) => safeNumber(h.previousClose, 0) > 0);
  const dailyPnlText = hasPnlData && state.showAmounts
    ? formatDailyPnl(dailyPnl, summary.totalMarketValueCny)
    : '';
  const mainCards = `
    <article class="summary-card">
      <div class="summary-top">
        <span class="summary-label">${LABELS.totalMarketValue}</span>
        <button class="ghost-minus" type="button" data-summary-action="liability" aria-label="${LABELS.liability}">-</button>
      </div>
      <div class="summary-value">${totalLabel}</div>
      ${dailyPnlText ? `<p class="summary-note">${dailyPnlText}</p>` : ''}
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

function renderLegend(segments, options = {}) {
  const { animate = true } = options;
  const total = segments.reduce((sum, item) => sum + item.value, 0) || 1;
  const defaultVisible = UI_FLAGS.allocationLegendThresholdEnabled
    ? segments.filter((segment) => segment.value / total >= ALLOCATION_LEGEND_MIN_WEIGHT)
    : segments.slice(0, LEGEND_COLLAPSED_COUNT);
  const collapsedCount = (defaultVisible.length ? defaultVisible : segments.slice(0, LEGEND_COLLAPSED_COUNT)).length;
  const canToggleLegend = collapsedCount < segments.length;

  refs.companyLegend.innerHTML = segments.map((segment, index) => `
    <div class="legend-row${animate ? ' is-entering' : ''}${index >= collapsedCount ? ' legend-row--collapsible' : ''}" style="animation-delay:${index * 30}ms">
      <div class="legend-main">
        <span class="legend-dot" style="background:${segment.color}"></span>
        <span class="legend-label">${escapeHtml(segment.label)}</span>
      </div>
      <span class="legend-value">${((segment.value / total) * 100).toFixed(1)}%</span>
    </div>
  `).join('');

  applyLegendExpandState();

  if (canToggleLegend) {
    refs.legendToggle.hidden = false;
    refs.legendToggle.textContent = state.legendExpanded
      ? LABELS.collapseLegend
      : `${LABELS.expandLegend} ${segments.length} ${LABELS.itemsUnit}`;
  } else {
    refs.legendToggle.hidden = true;
  }
}

function applyLegendExpandState() {
  const rows = refs.companyLegend.querySelectorAll('.legend-row--collapsible');
  rows.forEach((row) => {
    row.classList.toggle('is-collapsed', !state.legendExpanded);
  });
  refs.legendToggle.textContent = state.legendExpanded
    ? LABELS.collapseLegend
    : `${LABELS.expandLegend} ${refs.companyLegend.querySelectorAll('.legend-row').length} ${LABELS.itemsUnit}`;
}

function renderBuckets(segments, holdings, summary, options = {}) {
  const { animateDetail = true } = options;
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
          <div class="bucket-detail-card${animateDetail ? ' is-entering' : ''}">
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

function getSortFieldLabel(field) {
  if (field === 'effectiveYield') return LABELS.sortDividendYield;
  if (field === 'netAnnualDividendCny') return LABELS.sortDividendAmount;
  return LABELS.sortMarketValue;
}

function renderSortChips() {
  if (refs.sortGroup) {
    refs.sortGroup.classList.toggle('sort-group--subtle', UI_FLAGS.subtleSortControls);
    refs.sortGroup.dataset.open = state.sortMenuOpen ? 'true' : 'false';
    if (UI_FLAGS.subtleSortControls) {
      refs.sortGroup.hidden = false;
      refs.sortGroup.classList.toggle('is-collapsed', !state.sortMenuOpen);
    } else {
      refs.sortGroup.hidden = false;
      refs.sortGroup.classList.remove('is-collapsed');
    }
  }
  if (sortToggleButton) {
    sortToggleButton.hidden = false;
    if (!UI_FLAGS.subtleSortControls) {
      sortToggleButton.classList.add('is-hidden-animated');
    } else {
      sortToggleButton.classList.toggle('is-hidden-animated', state.sortMenuOpen);
    }
    sortToggleButton.classList.toggle('is-active', state.sortMenuOpen);
    sortToggleButton.setAttribute('aria-expanded', state.sortMenuOpen ? 'true' : 'false');
    sortToggleButton.title = `${UI_TEXT.sort} \u00b7 ${getSortFieldLabel(state.sortField)}`;
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
    const label = getSortFieldLabel(field);
    const arrow = isActive ? (state.sortDirection === 'desc' ? '\u2193' : '\u2191') : '';
    chip.classList.toggle('is-active', isActive);
    chip.hidden = false;
    chip.classList.toggle('is-subtle-primary', false);
    chip.textContent = arrow ? `${label} ${arrow}` : label;
  });
}

function renderTimestamp() {
  refs.marketTimestamp.textContent = formatTimestamp(state.lastUpdatedAt);
}

function renderPrivacyButton() {
  refs.privacyButton.classList.toggle('is-hidden', !state.showAmounts);
  document.body.classList.toggle('privacy-hidden', !state.showAmounts);
}

function renderHoldings(holdings, options = {}) {
  const { animate = true } = options;
  activeDividendTooltipButton = null;
  if (!holdings.length) {
    refs.stockList.innerHTML = '<article class="holding-card empty-card"></article>';
    return;
  }

  refs.stockList.innerHTML = holdings.map((item, index) => {
    const priceText = state.showAmounts ? formatPlainPrice(item.price) : MASK_PRICE;
    const marketValueText = state.showAmounts ? formatMoney(item.marketValueCny, 'CNY') : MASK_AMOUNT;
    const annualDividendText = state.showAmounts ? formatMoney(item.netAnnualDividendCny, 'CNY') : MASK_AMOUNT;
    const weightText = `${(item.holdingWeight * 100).toFixed(1)}%`;
    const statusKey = normalizeDividendStatus(item.dividendStatus, 'missing');
    const tooltipLines = buildDividendTooltipLines(item);
    const tooltipHtml = tooltipLines.map((line) => `<span>${escapeHtml(line)}</span>`).join('');
    const statusLabel = getDividendStatusLabel(statusKey);
    const staggerDelay = Math.min(index * 25, 400);
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
      <div class="holding-swipe${animate ? ' is-entering' : ''}" data-id="${item.localId}" style="--holding-swipe-offset:0px;animation-delay:${staggerDelay}ms;">
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
              <span class="metric-value">${state.showAmounts ? escapeHtml(String(item.quantity)) : MASK_AMOUNT}</span>
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

function syncRenderedHoldings(holdings) {
  if (!holdings.length) {
    refs.stockList.innerHTML = '<article class="holding-card empty-card"></article>';
    activeDividendTooltipButton = null;
    return;
  }

  const wrappers = Array.from(refs.stockList.querySelectorAll('.holding-swipe[data-id]'));
  const currentIds = wrappers.map((wrapper) => safeNumber(wrapper.dataset.id, 0));
  const nextIds = holdings.map((item) => item.localId);
  const needsFullRender = currentIds.length !== nextIds.length
    || currentIds.some((id, index) => id !== nextIds[index]);

  if (needsFullRender) {
    renderHoldings(holdings, { animate: false });
    return;
  }

  holdings.forEach((item, index) => {
    const wrapper = wrappers[index];
    if (!wrapper) {
      return;
    }
    const weightPill = wrapper.querySelector('.weight-pill');
    if (weightPill) {
      weightPill.textContent = `${(item.holdingWeight * 100).toFixed(1)}%`;
    }
  });
}

function captureHoldingPositions(excludedId = 0) {
  const positions = new Map();
  refs.stockList.querySelectorAll('.holding-swipe[data-id]').forEach((wrapper) => {
    const id = safeNumber(wrapper.dataset.id, 0);
    if (!id || id === excludedId) {
      return;
    }
    positions.set(id, wrapper.getBoundingClientRect().top);
  });
  return positions;
}

function animateHoldingReflow(previousPositions) {
  if (!(previousPositions instanceof Map) || previousPositions.size === 0) {
    return;
  }

  const wrappers = Array.from(refs.stockList.querySelectorAll('.holding-swipe[data-id]'));
  const moved = [];

  wrappers.forEach((wrapper) => {
    const id = safeNumber(wrapper.dataset.id, 0);
    const previousTop = previousPositions.get(id);
    if (typeof previousTop !== 'number') {
      return;
    }
    const currentTop = wrapper.getBoundingClientRect().top;
    const deltaY = previousTop - currentTop;
    if (Math.abs(deltaY) < 1) {
      return;
    }
    wrapper.style.transition = 'none';
    wrapper.style.transform = `translateY(${deltaY}px)`;
    moved.push(wrapper);
  });

  if (!moved.length) {
    return;
  }

  refs.stockList.getBoundingClientRect();
  moved.forEach((wrapper) => {
    wrapper.style.transition = '';
    wrapper.style.transform = '';
  });
}

/* ----------------------------------------------------------------------------
 *  [11] SWIPE & INTERACTION HELPERS
 * -------------------------------------------------------------------------- */
function isHoldingSwipeEnabled() {
  return window.matchMedia('(max-width: 560px)').matches;
}

function getHoldingSwipeOffset(wrapper) {
  return safeNumber(wrapper.style.getPropertyValue('--holding-swipe-offset').replace('px', ''), 0);
}

function setHoldingSwipeOffset(wrapper, offset) {
  const clamped = Math.max(0, Math.min(HOLDING_SWIPE_DELETE_WIDTH, offset));
  wrapper.style.setProperty('--holding-swipe-offset', `${clamped}px`);
  const progress = clamped / HOLDING_SWIPE_DELETE_WIDTH;
  wrapper.style.setProperty('--swipe-fade-opacity', progress);
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

function animateHoldingRemoval(wrapper, onComplete) {
  if (!wrapper) {
    onComplete();
    return;
  }

  if (activeHoldingSwipe && activeHoldingSwipe.wrapper === wrapper) {
    activeHoldingSwipe = null;
  }
  const card = wrapper.querySelector('.holding-card');
  if (!card) {
    onComplete();
    return;
  }

  let settled = false;
  const finish = () => {
    if (settled) {
      return;
    }
    settled = true;
    card.removeEventListener('transitionend', handleTransitionEnd);
    window.clearTimeout(fallbackId);
    onComplete();
  };
  const handleTransitionEnd = (event) => {
    if (event.target !== card || event.propertyName !== 'opacity') {
      return;
    }
    finish();
  };
  const fallbackId = window.setTimeout(finish, 260);

  wrapper.classList.add('is-deleting');
  card.addEventListener('transitionend', handleTransitionEnd);
}

/* ----------------------------------------------------------------------------
 *  [12] MODAL SYSTEM
 * -------------------------------------------------------------------------- */
function openModal(type, payload = {}) {
  state.modal = type;
  state.modalPayload = payload;
  document.body.classList.add('modal-open');
  renderModal();
}

function closeModal() {
  const mask = refs.modalRoot.querySelector('.modal-mask');
  const sheet = refs.modalRoot.querySelector('.modal-sheet');
  if (mask && sheet) {
    mask.classList.add('is-closing');
    sheet.classList.add('is-closing');
    sheet.addEventListener('animationend', () => {
      state.modal = null;
      state.modalPayload = null;
      document.body.classList.remove('modal-open');
      refs.modalRoot.innerHTML = '';
    }, { once: true });
  } else {
    state.modal = null;
    state.modalPayload = null;
    document.body.classList.remove('modal-open');
    refs.modalRoot.innerHTML = '';
  }
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
      showToast(LABELS.missingSymbol, { type: 'error' });
      return;
    }

    if (state.holdings.some((item) => normalizeSymbol(item.symbol) === symbol)) {
      showToast(`${symbol} ${LABELS.duplicateHolding}`, { type: 'error' });
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

/* ----------------------------------------------------------------------------
 *  [13] CLOUD SYNC & IMPORT / EXPORT
 * -------------------------------------------------------------------------- */
function getGithubToken() {
  return (localStorage.getItem(GITHUB_TOKEN_STORAGE_KEY) || '').trim();
}

function saveGithubToken(token) {
  localStorage.setItem(GITHUB_TOKEN_STORAGE_KEY, token.trim());
}

function promptGithubToken() {
  const token = window.prompt(LABELS.syncTokenPrompt);
  if (!token || !token.trim()) {
    return null;
  }
  saveGithubToken(token);
  return token.trim();
}

function createGithubHeaders(token, extraHeaders = {}) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    ...extraHeaders
  };
}

function encodeBase64Utf8(value) {
  return btoa(unescape(encodeURIComponent(String(value ?? ''))));
}

async function fetchGithubContentsEntry(apiUrl, token, options = {}) {
  const { allowMissing = false } = options;
  const response = await fetch(apiUrl, {
    headers: createGithubHeaders(token)
  });
  if (!response.ok) {
    if (allowMissing && response.status === 404) {
      return null;
    }
    throw new Error(`github contents request failed: ${response.status}`);
  }
  return await response.json();
}

async function loadGithubJsonFile(apiUrl, token, options = {}) {
  const entry = await fetchGithubContentsEntry(apiUrl, token, options);
  if (!entry) {
    return null;
  }
  if (typeof entry.content !== 'string') {
    throw new Error('github contents payload missing content');
  }
  const decoded = decodeBase64Utf8(entry.content.replace(/\n/g, ''));
  return {
    sha: typeof entry.sha === 'string' ? entry.sha : null,
    payload: JSON.parse(decoded)
  };
}

async function saveGithubJsonFile(apiUrl, token, payload, message) {
  const existing = await fetchGithubContentsEntry(apiUrl, token, { allowMissing: true });
  const body = {
    message,
    content: encodeBase64Utf8(JSON.stringify(payload, null, 2))
  };
  if (existing && typeof existing.sha === 'string' && existing.sha) {
    body.sha = existing.sha;
  }
  const response = await fetch(apiUrl, {
    method: 'PUT',
    headers: createGithubHeaders(token, {
      'Content-Type': 'application/json'
    }),
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `HTTP ${response.status}`);
  }
  return await response.json().catch(() => null);
}

function normalizeImportedSnapshotSource(payload) {
  const source = payload && payload.state ? payload.state : payload;
  if (source && Array.isArray(source.holdings)) {
    return source;
  }
  if (source && Array.isArray(source.positions)) {
    return { ...source, holdings: source.positions };
  }
  return null;
}

function isLocalPortfolioTemplateState() {
  const localHasData = state.holdings.length > 0;
  return localHasData && state.holdings.every(
    (holding, index) => DEFAULT_HOLDINGS[index]
      && holding.symbol === DEFAULT_HOLDINGS[index].symbol
      && holding.quantity === DEFAULT_HOLDINGS[index].quantity
  ) && state.holdings.length === DEFAULT_HOLDINGS.length;
}

function getSyncEligibleSymbols(holdings = state.holdings) {
  return Array.from(new Set(
    (holdings || [])
      .filter((item) => Math.max(0, safeNumber(
        item && item.quantity != null ? item.quantity : item && item.shares,
        0
      )) > 0)
      .map((item) => normalizeSymbol(item && item.symbol))
      .filter(Boolean)
  ));
}

function buildSyncSuccessMessage(options = {}) {
  const {
    restored = false,
    addedCount = 0,
    workflowTriggered = false,
    watchlistUpdateFailed = false
  } = options;
  let message = restored ? LABELS.cloudRestored : LABELS.syncSuccess;
  if (watchlistUpdateFailed) {
    return `${message}\uff0c\u4f46\u516c\u5f00\u89c2\u5bdf\u540d\u5355\u66f4\u65b0\u5931\u8d25\u3002`;
  }
  if (addedCount > 0) {
    message += `\uff0c${addedCount} \u53ea\u65b0\u80a1\u7968\u5df2\u52a0\u5165\u516c\u5f00\u89c2\u5bdf\u540d\u5355`;
    message += workflowTriggered
      ? '\uff0c\u884c\u60c5\u66f4\u65b0\u5df2\u89e6\u53d1\u3002'
      : '\uff0c\u884c\u60c5\u5c06\u5728\u5b9a\u65f6\u4efb\u52a1\u4e2d\u8865\u9f50\u3002';
  }
  return message;
}

function setCloudSyncButtonBusy(isBusy) {
  state.cloudSyncing = isBusy;
  refs.exportButton.disabled = isBusy;
  refs.exportButton.classList.toggle('is-syncing', isBusy);
  refs.exportButton.setAttribute('aria-busy', isBusy ? 'true' : 'false');
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function loadSiteMarketSnapshot() {
  const response = await fetch(MARKET_ENDPOINT + '?t=' + Date.now(), { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('site market request failed: ' + response.status);
  }
  return await response.json();
}

function hasRequiredMarketUpdate(payload, baselineUpdatedAt = '', requiredSymbols = []) {
  const nextUpdatedAt = payload && typeof payload.updatedAt === 'string'
    ? payload.updatedAt
    : '';
  if (!nextUpdatedAt || nextUpdatedAt === baselineUpdatedAt) {
    return false;
  }

  const quotes = payload && payload.quotes && typeof payload.quotes === 'object'
    ? payload.quotes
    : {};
  return requiredSymbols.every((symbol) => quotes && quotes[symbol]);
}

async function waitForDeployedMarketSnapshot(waitContext = {}) {
  const {
    baselineUpdatedAt = '',
    requiredSymbols = []
  } = waitContext;
  const deadline = Date.now() + MARKET_DEPLOY_WAIT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await delay(MARKET_DEPLOY_WAIT_INTERVAL_MS);
    try {
      const payload = await loadSiteMarketSnapshot();
      if (hasRequiredMarketUpdate(payload, baselineUpdatedAt, requiredSymbols)) {
        return payload;
      }
    } catch (error) {
      console.warn('waiting for deployed market snapshot failed', error);
    }
  }

  return null;
}

async function runBackgroundMarketRefreshWait(waitContext = {}) {
  try {
    const deployedSnapshot = await waitForDeployedMarketSnapshot(waitContext);
    if (!deployedSnapshot) {
      return false;
    }

    let attempts = 0;
    while (state.syncing && attempts < 20) {
      attempts += 1;
      await delay(300);
    }

    await refreshMarketData({ silent: true });
    renderApp();
    return true;
  } catch (error) {
    console.warn('background market refresh wait failed', error);
    return false;
  } finally {
    setCloudSyncButtonBusy(false);
  }
}

async function uploadPrivatePortfolioSnapshot(token) {
  await saveGithubJsonFile(
    GITHUB_PRIVATE_PORTFOLIO_CONTENTS_API,
    token,
    buildPortfolioSnapshot(),
    'sync: update private portfolio snapshot'
  );
}

async function dispatchMarketUpdateWorkflow(token) {
  const response = await fetch(GITHUB_MARKET_WORKFLOW_DISPATCH_API, {
    method: 'POST',
    headers: createGithubHeaders(token, {
      'Content-Type': 'application/json'
    }),
    body: JSON.stringify({ ref: 'main' })
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `HTTP ${response.status}`);
  }
}

async function syncPublicWatchlistFromPortfolio(token) {
  const file = await loadGithubJsonFile(GITHUB_WATCHLIST_CONTENTS_API, token);
  const payload = file && file.payload && typeof file.payload === 'object'
    ? file.payload
    : { symbols: [] };
  const existingSymbols = Array.isArray(payload.symbols)
    ? payload.symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean)
    : [];
  const portfolioSymbols = getSyncEligibleSymbols();
  const addedSymbols = portfolioSymbols.filter((symbol) => !existingSymbols.includes(symbol));

  if (!addedSymbols.length) {
    return {
      addedSymbols: [],
      workflowTriggered: false
    };
  }

  await saveGithubJsonFile(
    GITHUB_WATCHLIST_CONTENTS_API,
    token,
    {
      ...payload,
      symbols: existingSymbols.concat(addedSymbols)
    },
    'sync: append symbols to public watchlist'
  );

  let workflowTriggered = false;
  try {
    await dispatchMarketUpdateWorkflow(token);
    workflowTriggered = true;
  } catch (error) {
    console.warn('market update workflow dispatch failed', error);
  }

  return {
    addedSymbols,
    workflowTriggered
  };
}

async function restoreFromCloud(token) {
  try {
    const file = await loadGithubJsonFile(
      GITHUB_PRIVATE_PORTFOLIO_CONTENTS_API,
      token,
      { allowMissing: true }
    );
    if (!file) {
      return { restored: false, reason: 'missing' };
    }
    const normalizedSource = normalizeImportedSnapshotSource(file.payload);
    if (!normalizedSource || !Array.isArray(normalizedSource.holdings) || !normalizedSource.holdings.length) {
      return { restored: false, reason: 'missing' };
    }
    importSnapshot(normalizedSource);
    console.log('restored portfolio from private repo');
    return { restored: true };
  } catch (error) {
    console.warn('private portfolio restore failed', error);
    return { restored: false, reason: 'error', error };
  }
}

async function syncPortfolioToCloud() {
  if (state.cloudSyncing) {
    return;
  }

  setCloudSyncButtonBusy(true);
  let token = getGithubToken();
  if (!token) {
    token = promptGithubToken();
    if (!token) {
      setCloudSyncButtonBusy(false);
      showToast(LABELS.syncTokenInvalid, { type: 'error' });
      return;
    }
  }

  const localIsTemplate = isLocalPortfolioTemplateState();
  let restored = false;
  let keepButtonBusyInBackground = false;

  try {
    if (localIsTemplate) {
      const restoreResult = await restoreFromCloud(token);
      if (restoreResult.reason === 'error') {
        showToast(LABELS.syncFailed, { type: 'error' });
        return;
      }
      if (!restoreResult.restored) {
        showToast(LABELS.syncNoPrivateSnapshot, { type: 'error' });
        return;
      }
      restored = true;
    } else {
      await uploadPrivatePortfolioSnapshot(token);
    }

    const marketWaitBaselineUpdatedAt = state.lastUpdatedAt;
    let watchlistResult = {
      addedSymbols: [],
      workflowTriggered: false
    };
    let watchlistUpdateFailed = false;
    try {
      watchlistResult = await syncPublicWatchlistFromPortfolio(token);
    } catch (error) {
      watchlistUpdateFailed = true;
      console.warn('public watchlist sync failed', error);
    }

    await refreshMarketData({ silent: true });
    renderApp();

    showToast(buildSyncSuccessMessage({
      restored,
      addedCount: watchlistResult.addedSymbols.length,
      workflowTriggered: watchlistResult.workflowTriggered,
      watchlistUpdateFailed
    }), { type: watchlistUpdateFailed ? 'error' : 'success' });

    if (watchlistResult.workflowTriggered && watchlistResult.addedSymbols.length) {
      keepButtonBusyInBackground = true;
      void runBackgroundMarketRefreshWait({
        baselineUpdatedAt: marketWaitBaselineUpdatedAt,
        requiredSymbols: watchlistResult.addedSymbols.slice()
      });
    }
  } catch (error) {
    console.warn('cloud sync failed', error);
    showToast(LABELS.syncFailed, { type: 'error' });
  } finally {
    if (!keepButtonBusyInBackground) {
      setCloudSyncButtonBusy(false);
    }
  }
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
    showToast(LABELS.exportFailed, { type: 'error' });
  }
}

function importSnapshot(payload) {
  const normalizedSource = normalizeImportedSnapshotSource(payload);
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
    const confirmed = await showConfirm(LABELS.importConfirm, { okLabel: '\u786e\u8ba4\u5bfc\u5165', cancelLabel: LABELS.cancel });
    if (!confirmed) {
      return;
    }
    const text = await file.text();
    const payload = JSON.parse(text);
    importSnapshot(payload);
    await refreshMarketData({ silent: true });
  } catch (error) {
    console.warn('import failed', error);
    showToast(LABELS.importFailed, { type: 'error' });
  } finally {
    refs.importFileInput.value = '';
  }
}

/* ----------------------------------------------------------------------------
 *  [14] NETWORK — Market data, Tencent realtime, Config
 * -------------------------------------------------------------------------- */
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
  refs.refreshButton.classList.add('is-syncing');

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
    refs.summaryGrid.classList.add('is-updating');
    setTimeout(() => {
      renderApp();
      requestAnimationFrame(() => {
        refs.summaryGrid.classList.remove('is-updating');
      });
    }, 180);
  } catch (error) {
    console.warn('refresh failed', error);
    if (!silent) {
      showToast(LABELS.refreshFailed, { type: 'error' });
    }
  } finally {
    state.syncing = false;
    refs.refreshButton.disabled = false;
    refs.refreshButton.classList.remove('is-syncing');
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

    const previousClose = safeNumber(fields[4], 0);
    quotes[symbol] = {
      symbol,
      name: String(fields[1] || fallback.name || symbol).trim() || fallback.name || symbol,
      market: fallback.market,
      currency: fallback.currency,
      price,
      previousClose: previousClose > 0 ? previousClose : undefined
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

/* ----------------------------------------------------------------------------
 *  [15] BOOT & EVENT BINDINGS
 * -------------------------------------------------------------------------- */
function renderApp(options = {}) {
  const {
    animateLegend = true,
    animateBucketDetail = true,
    animateHoldings = true,
    renderHoldingsList = true
  } = options;
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
  renderLegend(companySegments, { animate: animateLegend });
  renderBuckets(bucketSegments, summary.holdings, summary, { animateDetail: animateBucketDetail });
  renderSortChips();
  renderTimestamp();
  renderPrivacyButton();
  if (renderHoldingsList) {
    renderHoldings(summary.holdings, { animate: animateHoldings });
  } else {
    syncRenderedHoldings(summary.holdings);
  }
}

configureUiChrome();

refs.privacyButton.addEventListener('click', () => {
  state.showAmounts = !state.showAmounts;
  saveState();
  document.body.classList.toggle('privacy-hidden', !state.showAmounts);
  refs.privacyButton.classList.toggle('is-hidden', !state.showAmounts);
});

refs.exportButton.addEventListener('click', syncPortfolioToCloud);
refs.importButton.addEventListener('click', () => refs.importFileInput.click());
refs.importFileInput.addEventListener('change', handleImportFile);

refs.legendToggle.addEventListener('click', () => {
  state.legendExpanded = !state.legendExpanded;
  saveState();
  applyLegendExpandState();
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
      refs.stockList.classList.add('is-resorting');
      setTimeout(() => {
        renderApp();
        requestAnimationFrame(() => {
          refs.stockList.classList.remove('is-resorting');
        });
      }, 150);
      return;
    }
    if (state.sortField === nextField) {
      state.sortDirection = state.sortDirection === 'desc' ? 'asc' : 'desc';
    } else {
      state.sortField = nextField;
      state.sortDirection = 'desc';
    }
    saveState();
    refs.stockList.classList.add('is-resorting');
    setTimeout(() => {
      renderApp();
      requestAnimationFrame(() => {
        refs.stockList.classList.remove('is-resorting');
      });
    }, 150);
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
  const summary = computeHoldings();
  const bucketSegments = getBucketSegments(summary.holdings);
  renderBuckets(bucketSegments, summary.holdings, summary, { animateDetail: true });
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
    const holdingName = computedHolding ? computedHolding.name : holding.symbol;
    showConfirm(LABELS.deleteConfirm, { sub: holdingName, okLabel: '\u5220\u9664', danger: true, cancelLabel: LABELS.cancel }).then((confirmed) => {
      if (!confirmed) return;
      const wrapper = refs.stockList.querySelector(`.holding-swipe[data-id="${localId}"]`);
      if (wrapper) {
        const previousPositions = captureHoldingPositions(localId);
        animateHoldingRemoval(wrapper, () => {
          if (activeDividendTooltipButton && wrapper.contains(activeDividendTooltipButton)) {
            activeDividendTooltipButton = null;
          }
          wrapper.remove();
          state.holdings = state.holdings.filter((item) => item.localId !== localId);
          saveState();
          renderApp({
            animateLegend: false,
            animateBucketDetail: false,
            animateHoldings: false,
            renderHoldingsList: false
          });
          animateHoldingReflow(previousPositions);
        });
      } else {
        state.holdings = state.holdings.filter((item) => item.localId !== localId);
        saveState();
        renderApp({
          animateLegend: false,
          animateBucketDetail: false,
          animateHoldings: false,
          renderHoldingsList: false
        });
      }
    });
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
