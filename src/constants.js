/* ── Constants & Configuration ── */
export const STORAGE_KEY = 'bopup-ledger-web-state';
export const MARKET_ENDPOINT = './data/market.json';
export const OVERRIDE_ENDPOINT = './data/override.json';
export const CONFIG_ENDPOINT = './config.json';
export const PORTFOLIO_SNAPSHOT_FILENAME = 'portfolio_snapshot.json';
export const GITHUB_PUBLIC_REPO = 'bebop-m/bebop-ledger-web';
export const GITHUB_PRIVATE_REPO = 'bebop-m/bebop-ledger-private';
export const GITHUB_MARKET_CONTENTS_API = `https://api.github.com/repos/${GITHUB_PUBLIC_REPO}/contents/data/market.json`;
export const GITHUB_PRIVATE_PORTFOLIO_CONTENTS_API = `https://api.github.com/repos/${GITHUB_PRIVATE_REPO}/contents/data/portfolio.json`;
export const GITHUB_WATCHLIST_CONTENTS_API = `https://api.github.com/repos/${GITHUB_PUBLIC_REPO}/contents/data/watchlist.json`;
export const GITHUB_MARKET_WORKFLOW_DISPATCH_API = `https://api.github.com/repos/${GITHUB_PUBLIC_REPO}/actions/workflows/update-market-data.yml/dispatches`;
export const GITHUB_TOKEN_STORAGE_KEY = 'bebop-ledger-github-token-v2';
export const TENCENT_REALTIME_ENDPOINT = 'https://qt.gtimg.cn/q=';
export const TENCENT_BATCH_SIZE = 60;
export const LEGEND_COLLAPSED_COUNT = 8;
export const LEGEND_TOGGLE_ANIMATION_MS = 220;
export const MASK_AMOUNT = '******';
export const MASK_PRICE = '***.**';
export const DEFAULT_STALE_DAYS = 7;
export const MARKET_DEPLOY_WAIT_TIMEOUT_MS = 90000;
export const MARKET_DEPLOY_WAIT_INTERVAL_MS = 3000;
export const VALID_DIVIDEND_SOURCES = new Set(['yfinance', 'yahoo', 'eodhd', 'manual', 'cache']);
export const VALID_DIVIDEND_STATUSES = new Set(['manual', 'fresh', 'stale', 'missing']);
export const TENCENT_REQUEST_TIMEOUT_MS = 8000;
export const HOLDING_ENTER_STAGGER_MS = 25;
export const HOLDING_ENTER_STAGGER_MAX_MS = 400;
export const LEGEND_ENTER_STAGGER_MS = 30;
export const TOAST_DEFAULT_DURATION_MS = 2200;
export const HOLDING_REMOVAL_FALLBACK_MS = 260;
export const SWIPE_SUPPRESS_CLICK_MS = 280;
export const CLOUD_SUCCESS_FLASH_MS = 1200;
export const TOOLTIP_FALLBACK_WIDTH = 168;
export const TOOLTIP_GAP = 16;
export const SYNC_WAIT_POLL_INTERVAL_MS = 300;
export const SYNC_WAIT_MAX_ATTEMPTS = 20;
export const CONFIRM_CLOSE_DELAY_MS = 40;

export const UI_TEXT = {
  sort: '\u6392\u5e8f',
  overallAverageNetYield: '\u6574\u4f53\u5e73\u5747\u7a0e\u540e\u80a1\u606f\u7387',
  overallYieldCompact: '\u80a1\u606f\u7387'
};
export const ALLOCATION_LEGEND_MIN_WEIGHT = 0.05;
export const BUCKET_CHIP_COMPACT_THRESHOLD = 0.16;
export const HOLDING_SWIPE_DELETE_WIDTH = 72;
export const HOLDING_SWIPE_OPEN_THRESHOLD = 34;

export const DEFAULT_RATES = { CNY: 1, USD: 7.22, HKD: 0.92 };

export const COMPANY_COLORS = [
  '#152849', '#f28c28', '#cfd6e1', '#8e9aae', '#e7d7c7',
  '#6d7b90', '#f5b36b', '#2a4168', '#d9e0e8', '#a2acba',
  '#f3c58f', '#1e3357', '#bcc6d2', '#7f8ca0', '#eadfce',
  '#5d6d86', '#f0a04b', '#314b72', '#d4dae3', '#95a1b3'
];

export const BUCKET_COLORS = { core: '#152849', income: '#f28c28' };

export const LABELS = {
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

/* Raw seed quote map — normalized at boot via initDefaultQuotes() in state.js */
export const SEED_QUOTES = {
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
};

export const DEFAULT_HOLDINGS = [
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
