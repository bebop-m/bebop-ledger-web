const STORAGE_KEY = 'bopup-ledger-web-state';
const MARKET_ENDPOINT = './data/market.json';
const GITHUB_MARKET_CONTENTS_API = 'https://api.github.com/repos/bebop-m/bopup-ledger-web/contents/data/market.json';
const LEGEND_COLLAPSED_COUNT = 8;
const MASK_AMOUNT = '******';
const MASK_PRICE = '***.**';

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
  yieldTitle: '\u80a1\u606f\u7387\u8bbe\u7f6e',
  liabilityTitle: '\u8d1f\u503a\u8bbe\u7f6e',
  quantityPlaceholder: '\u8f93\u5165\u6301\u80a1\u6570\u91cf',
  taxPlaceholder: '\u8f93\u5165\u7a0e\u7387\uff0c\u4f8b\u5982 10',
  yieldPlaceholder: '\u8f93\u5165\u80a1\u606f\u7387\uff0c\u4f8b\u5982 5.2',
  liabilityPlaceholder: '\u8f93\u5165\u8d1f\u503a\u91d1\u989d',
  symbolPlaceholder: '\u4f8b\u5982 00700.HK \u6216 600519',
  missingSymbol: '\u8bf7\u8f93\u5165\u80a1\u7968\u4ee3\u7801',
  duplicateHolding: '\u5df2\u5728\u6301\u4ed3\u4e2d',
  deleteConfirm: '\u786e\u8ba4\u5220\u9664',
  refreshFailed: '\u884c\u60c5\u5237\u65b0\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002',
  marketValue: '\u6301\u4ed3\u5e02\u503c\uff1a',
  quantity: '\u6570\u91cf\uff1a',
  annualDividend: '\u7a0e\u540e\u80a1\u606f\uff1a',
  dividendYield: '\u80a1\u606f\u7387\uff1a',
  expandLegend: '\u5c55\u5f00\u5168\u90e8',
  collapseLegend: '\u6536\u8d77',
  itemsUnit: '\u9879',
  unknownHK: '\u672a\u8bc6\u522b\u6e2f\u80a1',
  unknownCN: '\u672a\u8bc6\u522bA\u80a1',
  unknownUS: '\u672a\u8bc6\u522b\u7f8e\u80a1'
};

const DEFAULT_QUOTES = {
  AAPL: { name: 'Apple', market: 'US', currency: 'USD', price: 213.4, dividendYield: 0 },
  MSFT: { name: 'Microsoft', market: 'US', currency: 'USD', price: 419.15, dividendYield: 0.0069 },
  KO: { name: 'Coca-Cola', market: 'US', currency: 'USD', price: 68.22, dividendYield: 0.031 },
  JNJ: { name: 'Johnson & Johnson', market: 'US', currency: 'USD', price: 162.35, dividendYield: 0.0294 },
  PG: { name: 'P&G', market: 'US', currency: 'USD', price: 171.28, dividendYield: 0.0241 },
  PEP: { name: 'PepsiCo', market: 'US', currency: 'USD', price: 174.06, dividendYield: 0.0291 },
  MCD: { name: "McDonald's", market: 'US', currency: 'USD', price: 301.42, dividendYield: 0.0223 },
  O: { name: 'Realty Income', market: 'US', currency: 'USD', price: 54.1, dividendYield: 0.0564 },
  VZ: { name: 'Verizon', market: 'US', currency: 'USD', price: 41.26, dividendYield: 0.0648 },
  XOM: { name: 'Exxon Mobil', market: 'US', currency: 'USD', price: 109.74, dividendYield: 0.0341 },
  CVX: { name: 'Chevron', market: 'US', currency: 'USD', price: 154.32, dividendYield: 0.0392 },
  '00700.HK': { name: '\u817e\u8baf\u63a7\u80a1', market: 'HK', currency: 'HKD', price: 389.6, dividendYield: 0.0092 },
  '00941.HK': { name: '\u4e2d\u56fd\u79fb\u52a8', market: 'HK', currency: 'HKD', price: 77.15, dividendYield: 0.072 },
  '01398.HK': { name: '\u5de5\u5546\u94f6\u884c', market: 'HK', currency: 'HKD', price: 4.33, dividendYield: 0.081 },
  '00883.HK': { name: '\u4e2d\u56fd\u6d77\u6d0b\u77f3\u6cb9', market: 'HK', currency: 'HKD', price: 18.42, dividendYield: 0.078 },
  '00005.HK': { name: '\u6c47\u4e30\u63a7\u80a1', market: 'HK', currency: 'HKD', price: 68.35, dividendYield: 0.068 },
  '00388.HK': { name: '\u9999\u6e2f\u4ea4\u6613\u6240', market: 'HK', currency: 'HKD', price: 256.2, dividendYield: 0.028 },
  '600519.SH': { name: '\u8d35\u5dde\u8305\u53f0', market: 'CN', currency: 'CNY', price: 1688, dividendYield: 0.0175 },
  '601318.SH': { name: '\u4e2d\u56fd\u5e73\u5b89', market: 'CN', currency: 'CNY', price: 46.22, dividendYield: 0.051 },
  '600036.SH': { name: '\u62db\u5546\u94f6\u884c', market: 'CN', currency: 'CNY', price: 34.58, dividendYield: 0.049 },
  '600900.SH': { name: '\u957f\u6c5f\u7535\u529b', market: 'CN', currency: 'CNY', price: 28.41, dividendYield: 0.035 },
  '000651.SZ': { name: '\u683c\u529b\u7535\u5668', market: 'CN', currency: 'CNY', price: 41.86, dividendYield: 0.062 },
  '300750.SZ': { name: '\u5b81\u5fb7\u65f6\u4ee3', market: 'CN', currency: 'CNY', price: 192.65, dividendYield: 0.012 }
};

const DEFAULT_HOLDINGS = [
  { localId: 1, symbol: 'AAPL', quantity: 20, bucket: 'core', taxRateOverride: '', dividendYieldOverride: '' },
  { localId: 2, symbol: 'MSFT', quantity: 10, bucket: 'core', taxRateOverride: '', dividendYieldOverride: '' },
  { localId: 3, symbol: 'KO', quantity: 120, bucket: 'income', taxRateOverride: '', dividendYieldOverride: '' },
  { localId: 4, symbol: 'JNJ', quantity: 40, bucket: 'core', taxRateOverride: '', dividendYieldOverride: '' },
  { localId: 5, symbol: 'PG', quantity: 35, bucket: 'core', taxRateOverride: '', dividendYieldOverride: '' },
  { localId: 6, symbol: 'PEP', quantity: 28, bucket: 'income', taxRateOverride: '', dividendYieldOverride: '' },
  { localId: 7, symbol: 'MCD', quantity: 16, bucket: 'income', taxRateOverride: '', dividendYieldOverride: '' },
  { localId: 8, symbol: 'O', quantity: 200, bucket: 'income', taxRateOverride: '', dividendYieldOverride: '' },
  { localId: 9, symbol: 'VZ', quantity: 160, bucket: 'income', taxRateOverride: '', dividendYieldOverride: '' },
  { localId: 10, symbol: 'XOM', quantity: 55, bucket: 'core', taxRateOverride: '', dividendYieldOverride: '' },
  { localId: 11, symbol: 'CVX', quantity: 32, bucket: 'core', taxRateOverride: '', dividendYieldOverride: '' },
  { localId: 12, symbol: '00700.HK', quantity: 100, bucket: 'core', taxRateOverride: '', dividendYieldOverride: '' },
  { localId: 13, symbol: '00941.HK', quantity: 2000, bucket: 'income', taxRateOverride: '', dividendYieldOverride: '' },
  { localId: 14, symbol: '01398.HK', quantity: 8000, bucket: 'income', taxRateOverride: '', dividendYieldOverride: '' },
  { localId: 15, symbol: '00883.HK', quantity: 2200, bucket: 'income', taxRateOverride: '', dividendYieldOverride: '' },
  { localId: 16, symbol: '00005.HK', quantity: 600, bucket: 'core', taxRateOverride: '', dividendYieldOverride: '' },
  { localId: 17, symbol: '00388.HK', quantity: 150, bucket: 'core', taxRateOverride: '', dividendYieldOverride: '' },
  { localId: 18, symbol: '600519.SH', quantity: 8, bucket: 'core', taxRateOverride: '', dividendYieldOverride: '' },
  { localId: 19, symbol: '601318.SH', quantity: 1000, bucket: 'income', taxRateOverride: '', dividendYieldOverride: '' },
  { localId: 20, symbol: '600036.SH', quantity: 1200, bucket: 'income', taxRateOverride: '', dividendYieldOverride: '' }
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
  syncing: false
};

const refs = {
  privacyButton: document.getElementById('privacyButton'),
  summaryGrid: document.getElementById('summaryGrid'),
  companyDonut: document.getElementById('companyDonut'),
  companyLegend: document.getElementById('companyLegend'),
  legendToggle: document.getElementById('legendToggle'),
  bucketTrack: document.getElementById('bucketTrack'),
  marketTimestamp: document.getElementById('marketTimestamp'),
  refreshButton: document.getElementById('refreshButton'),
  addButton: document.getElementById('addButton'),
  stockList: document.getElementById('stockList'),
  modalRoot: document.getElementById('modalRoot'),
  sortChips: Array.from(document.querySelectorAll('.sort-chip'))
};

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
  if (/^\d{6}\.SS$/.test(value)) {
    return value.replace('.SS', '.SH');
  }
  if (/^\d{5}\.HK$/.test(value) || /^\d{6}\.(SH|SZ)$/.test(value)) {
    return value;
  }
  if (/^[A-Z][A-Z0-9.-]*$/.test(value)) {
    return value;
  }
  if (/^\d{5}$/.test(value)) {
    return `${value}.HK`;
  }
  if (/^\d{6}$/.test(value)) {
    return /^[689]/.test(value) ? `${value}.SH` : `${value}.SZ`;
  }
  return value;
}

function inferQuote(symbol) {
  if (state.quotes[symbol]) {
    return { ...state.quotes[symbol], symbol };
  }
  if (DEFAULT_QUOTES[symbol]) {
    return { ...DEFAULT_QUOTES[symbol], symbol };
  }
  if (/\.HK$/.test(symbol)) {
    return { symbol, name: LABELS.unknownHK, market: 'HK', currency: 'HKD', price: 0, dividendYield: 0 };
  }
  if (/\.(SH|SZ)$/.test(symbol)) {
    return { symbol, name: LABELS.unknownCN, market: 'CN', currency: 'CNY', price: 0, dividendYield: 0 };
  }
  return { symbol, name: LABELS.unknownUS, market: 'US', currency: 'USD', price: 0, dividendYield: 0 };
}

function mergeQuotes(baseMap, nextMap) {
  const merged = { ...baseMap };
  Object.entries(nextMap || {}).forEach(([rawSymbol, rawQuote]) => {
    const symbol = normalizeSymbol(rawSymbol);
    if (!symbol || !rawQuote) {
      return;
    }
    const fallback = inferQuote(symbol);
    let nextDividendYield = rawQuote.dividendYield;
    if (Number.isFinite(Number(nextDividendYield)) && Number(nextDividendYield) > 1) {
      nextDividendYield = Number(nextDividendYield) / 100;
    }
    merged[symbol] = {
      symbol,
      name: rawQuote.name || fallback.name,
      market: rawQuote.market || fallback.market,
      currency: rawQuote.currency || fallback.currency,
      price: safeNumber(rawQuote.price, fallback.price),
      dividendYield: safeNumber(nextDividendYield, fallback.dividendYield)
    };
  });
  return merged;
}

function sanitizeHolding(item, index) {
  const symbol = normalizeSymbol(item && item.symbol);
  if (!symbol) {
    return null;
  }
  return {
    localId: Math.max(1, Math.floor(safeNumber(item && item.localId, index + 1))),
    symbol,
    quantity: Math.max(0, safeNumber(item && item.quantity, 0)),
    bucket: item && item.bucket === 'income' ? 'income' : 'core',
    taxRateOverride: item && item.taxRateOverride != null ? String(item.taxRateOverride) : '',
    dividendYieldOverride: item && item.dividendYieldOverride != null ? String(item.dividendYieldOverride) : ''
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
  const sanitizedHoldings = Array.isArray(snapshot && snapshot.holdings)
    ? snapshot.holdings.map((item, index) => sanitizeHolding(item, index)).filter(Boolean)
    : defaults.holdings;
  const maxLocalId = sanitizedHoldings.reduce((maxValue, item) => Math.max(maxValue, item.localId), 0);

  state.holdings = sanitizedHoldings.length ? sanitizedHoldings : clone(defaults.holdings);
  state.quotes = mergeQuotes(clone(defaults.quotes), snapshot && snapshot.quotes);
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
  } catch (_error) {
    applySnapshot(createDefaultSnapshot());
  }
}

function computeHoldings() {
  const holdings = state.holdings.map((holding) => {
    const quote = inferQuote(holding.symbol);
    const quantity = Math.max(0, safeNumber(holding.quantity, 0));
    const price = safeNumber(quote.price, 0);
    const fxRate = safeNumber(state.rates[quote.currency], 1);
    const taxOverridePercent = parsePercentOverride(holding.taxRateOverride);
    const yieldOverridePercent = parsePercentOverride(holding.dividendYieldOverride);
    const effectiveYield = yieldOverridePercent === null
      ? safeNumber(quote.dividendYield, 0)
      : yieldOverridePercent / 100;
    const effectiveTax = taxOverridePercent === null ? 0 : taxOverridePercent / 100;
    const marketValueCny = price * quantity * fxRate;
    const annualDividendCny = price * quantity * effectiveYield * (1 - effectiveTax) * fxRate;

    return {
      ...holding,
      ...quote,
      quantity,
      effectiveYield,
      marketValueCny,
      annualDividendCny
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
  const totalDividendCny = holdings.reduce((sum, item) => sum + safeNumber(item.annualDividendCny, 0), 0);
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

function renderSummary(summary) {
  const totalLabel = state.showAmounts ? formatMoney(summary.netMarketValueCny, 'CNY') : MASK_AMOUNT;
  const dividendLabel = state.showAmounts ? formatMoney(summary.totalDividendCny, 'CNY') : MASK_AMOUNT;
  const liabilityLabel = state.showAmounts ? formatMoney(state.liabilityCny, 'CNY') : MASK_AMOUNT;

  refs.summaryGrid.innerHTML = `
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
    </article>
    <article class="summary-card">
      <div class="summary-label">${LABELS.usdRate}</div>
      <p class="summary-note">1 USD = ${safeNumber(state.rates.USD, 0).toFixed(2)} CNY</p>
    </article>
    <article class="summary-card">
      <div class="summary-label">${LABELS.hkdRate}</div>
      <p class="summary-note">1 HKD = ${safeNumber(state.rates.HKD, 0).toFixed(2)} CNY</p>
    </article>
  `;
}

function renderDonut(segments) {
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
  const visible = state.legendExpanded ? segments : segments.slice(0, LEGEND_COLLAPSED_COUNT);

  refs.companyLegend.innerHTML = visible.map((segment) => `
    <div class="legend-row">
      <div class="legend-main">
        <span class="legend-dot" style="background:${segment.color}"></span>
        <span class="legend-label">${escapeHtml(segment.label)}</span>
      </div>
      <span class="legend-value">${((segment.value / total) * 100).toFixed(1)}%</span>
    </div>
  `).join('');

  if (segments.length > LEGEND_COLLAPSED_COUNT) {
    refs.legendToggle.hidden = false;
    refs.legendToggle.textContent = state.legendExpanded
      ? LABELS.collapseLegend
      : `${LABELS.expandLegend} ${segments.length} ${LABELS.itemsUnit}`;
  } else {
    refs.legendToggle.hidden = true;
  }
}

function renderBuckets(segments) {
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
  refs.sortChips.forEach((chip) => {
    const field = chip.dataset.sortField;
    const isActive = field === state.sortField;
    const label = field === 'effectiveYield' ? LABELS.sortDividendYield : LABELS.sortMarketValue;
    const arrow = isActive ? (state.sortDirection === 'desc' ? '\u2193' : '\u2191') : '';
    chip.classList.toggle('is-active', isActive);
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
  if (!holdings.length) {
    refs.stockList.innerHTML = '<article class="holding-card empty-card"></article>';
    return;
  }

  refs.stockList.innerHTML = holdings.map((item) => {
    const priceText = state.showAmounts ? formatPlainPrice(item.price) : MASK_PRICE;
    const marketValueText = state.showAmounts ? formatMoney(item.marketValueCny, 'CNY') : MASK_AMOUNT;
    const annualDividendText = state.showAmounts ? formatMoney(item.annualDividendCny, 'CNY') : MASK_AMOUNT;
    const weightText = `${(item.holdingWeight * 100).toFixed(1)}%`;

    return `
      <article class="holding-card" data-id="${item.localId}">
        <header class="holding-head">
          <div>
            <div class="holding-name-row">
              <h3 class="holding-name">${escapeHtml(item.name)}</h3>
              <span class="holding-divider">/</span>
              <span class="holding-price">${priceText}</span>
            </div>
            <div class="holding-code">${escapeHtml(item.symbol)}</div>
          </div>
          <div class="holding-side">
            <span class="weight-pill">${weightText}</span>
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
          <button class="metric-button metric-right" type="button" data-action="edit-yield">
            <div class="metric-row metric-right">
              <span class="metric-label">${LABELS.dividendYield}</span>
              <span class="metric-value">${formatPercent(item.effectiveYield)}</span>
            </div>
          </button>
        </div>
      </article>
    `;
  }).join('');
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

  if (state.modal === 'yield') {
    title = LABELS.yieldTitle;
    note = state.modalPayload.name || '';
    fields = `<input id="modalYieldInput" class="modal-input" type="number" inputmode="decimal" value="${escapeHtml(String(state.modalPayload.value ?? ''))}" placeholder="${LABELS.yieldPlaceholder}">`;
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
      <select id="modalBucketSelect" class="modal-select">
        <option value="core">${LABELS.core}</option>
        <option value="income">${LABELS.income}</option>
      </select>
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

  if (state.modal === 'yield') {
    const value = document.getElementById('modalYieldInput').value.trim();
    state.holdings = state.holdings.map((item) => (
      item.localId === state.modalPayload.localId ? { ...item, dividendYieldOverride: value } : item
    ));
  }

  if (state.modal === 'liability') {
    state.liabilityCny = Math.max(0, safeNumber(document.getElementById('modalLiabilityInput').value, 0));
  }

  if (state.modal === 'add') {
    const symbol = normalizeSymbol(document.getElementById('modalSymbolInput').value);
    const quantity = Math.max(0, safeNumber(document.getElementById('modalQuantityInput').value, 0));
    const bucket = document.getElementById('modalBucketSelect').value === 'income' ? 'income' : 'core';

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
      dividendYieldOverride: ''
    });
    state.quotes = mergeQuotes(state.quotes, { [symbol]: inferQuote(symbol) });
    state.nextId += 1;
  }

  saveState();
  closeModal();
  renderApp();
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

async function refreshMarketData(options = {}) {
  const { silent = false } = options;
  if (state.syncing) {
    return;
  }
  state.syncing = true;
  refs.refreshButton.disabled = true;

  try {
    const payload = await loadLatestMarketSnapshot();
    if (!payload || payload.ok === false) {
      throw new Error(payload && payload.error ? payload.error : 'invalid market payload');
    }
    applyMarketPayload(payload);
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

async function loadLatestMarketSnapshot() {
  const errors = [];

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

  try {
    const response = await fetch(MARKET_ENDPOINT + '?t=' + Date.now(), { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('site market request failed: ' + response.status);
    }
    return await response.json();
  } catch (error) {
    errors.push(error);
  }

  throw errors[0] || new Error('failed to load market snapshot');
}

function decodeBase64Utf8(value) {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
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

  renderSummary(summary);
  renderDonut(companySegments);
  renderLegend(companySegments);
  renderBuckets(bucketSegments);
  renderSortChips();
  renderTimestamp();
  renderPrivacyButton();
  renderHoldings(summary.holdings);
}

refs.privacyButton.addEventListener('click', () => {
  state.showAmounts = !state.showAmounts;
  saveState();
  renderApp();
});

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
  const button = event.target.closest('[data-action]');
  const card = event.target.closest('.holding-card');
  if (!button || !card) {
    return;
  }
  const localId = safeNumber(card.dataset.id, 0);
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

  if (action === 'edit-yield') {
    openModal('yield', {
      localId,
      name: computedHolding ? computedHolding.name : holding.symbol,
      value: holding.dividendYieldOverride
    });
  }
});

refs.modalRoot.addEventListener('click', (event) => {
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
