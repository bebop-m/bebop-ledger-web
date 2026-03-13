const STORAGE_KEY = 'bopup-ledger-web-state';
const LEGEND_COLLAPSED_COUNT = 8;
const MARKET_ENDPOINT = '/api/market';
const COMPANY_COLORS = [
  '#14274a', '#f28c28', '#cfd6e1', '#8e9aae', '#e7d7c7',
  '#6d7b90', '#f5b36b', '#2a4168', '#d9e0e8', '#a2acba',
  '#f3c58f', '#1e3357', '#bcc6d2', '#7f8ca0', '#eadfce',
  '#5d6d86', '#f0a04b', '#314b72', '#d4dae3', '#95a1b3'
];
const BUCKET_COLORS = {
  core: '#14274a',
  income: '#f28c28'
};
const COPY = {
  heroTitle: '\u8d44\u4ea7\u603b\u89c8',
  heroSubtitle: '\u4ef7\u683c\u3001\u80a1\u606f\u7387\u3001\u6c47\u7387\u6362\u7b97\u4e0e\u5e74\u5ea6\u80a1\u606f',
  chartTitle: '\u6301\u4ed3\u7ed3\u6784',
  chartCaption: '\u516c\u53f8\u5360\u6bd4\u4e0e\u6838\u5fc3\u4ed3 / \u6253\u5de5\u4ed3\u5206\u5e03',
  stockListTitle: '\u6301\u4ed3\u5217\u8868',
  sortMarketValue: '\u6301\u4ed3\u5e02\u503c',
  sortDividendYield: '\u80a1\u606f\u7387',
  totalMarketValue: '\u6301\u4ed3\u603b\u91d1\u989d',
  totalDividend: '\u5e74\u5ea6\u80a1\u606f\u603b\u91d1\u989d',
  usdRate: '\u7f8e\u5143\u6c47\u7387',
  hkdRate: '\u6e2f\u5e01\u6c47\u7387',
  marketValue: '\u6301\u4ed3\u5e02\u503c\uff1a',
  quantity: '\u6570\u91cf\uff1a',
  annualDividend: '\u7a0e\u540e\u80a1\u606f\uff1a',
  dividendYield: '\u80a1\u606f\u7387\uff1a',
  quantityModalTitle: '\u6570\u91cf\u8bbe\u7f6e',
  taxModalTitle: '\u7a0e\u7387\u8bbe\u7f6e',
  addModalTitle: '\u65b0\u589e\u6301\u4ed3',
  addModalSubtitle: '\u8f93\u5165\u80a1\u7968\u4ee3\u7801\u3001\u6570\u91cf\u5e76\u9009\u62e9\u4ed3\u4f4d\u7c7b\u578b',
  quantityPlaceholder: '\u8f93\u5165\u6301\u80a1\u6570\u91cf',
  taxPlaceholder: '\u8f93\u5165\u7a0e\u7387\uff0c\u4f8b\u5982 10',
  symbolPlaceholder: '\u4f8b\u5982 AAPL \u6216 00700.HK',
  missingSymbol: '\u8bf7\u8f93\u5165\u80a1\u7968\u4ee3\u7801',
  stockExists: '\u5df2\u5728\u6301\u4ed3\u4e2d',
  confirmDeleteTitle: '\u5220\u9664\u786e\u8ba4',
  confirmDelete: '\u786e\u5b9a\u5220\u9664',
  core: '\u6838\u5fc3\u4ed3',
  income: '\u6253\u5de5\u4ed3',
  expandLegend: '\u5c55\u5f00\u5168\u90e8',
  collapseLegend: '\u6536\u8d77',
  cancel: '\u53d6\u6d88',
  save: '\u4fdd\u5b58'
};
const DEFAULT_QUOTES = {
  AAPL: { name: 'Apple', market: 'US', currency: 'USD', price: 213.4, dividendYield: 0.0048 },
  MSFT: { name: 'Microsoft', market: 'US', currency: 'USD', price: 419.15, dividendYield: 0.0069 },
  KO: { name: 'Coca-Cola', market: 'US', currency: 'USD', price: 68.22, dividendYield: 0.031 },
  JNJ: { name: 'Johnson & Johnson', market: 'US', currency: 'USD', price: 162.35, dividendYield: 0.0294 },
  PG: { name: 'P&G', market: 'US', currency: 'USD', price: 171.28, dividendYield: 0.0241 },
  PEP: { name: 'PepsiCo', market: 'US', currency: 'USD', price: 174.06, dividendYield: 0.0291 },
  MCD: { name: 'McDonald\'s', market: 'US', currency: 'USD', price: 301.42, dividendYield: 0.0223 },
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

function createInitialHoldings() {
  return [
    { localId: 1, symbol: 'AAPL', quantity: 20, bucket: 'core', taxRateOverride: '' },
    { localId: 2, symbol: 'MSFT', quantity: 10, bucket: 'core', taxRateOverride: '' },
    { localId: 3, symbol: 'KO', quantity: 120, bucket: 'income', taxRateOverride: '' },
    { localId: 4, symbol: 'JNJ', quantity: 40, bucket: 'core', taxRateOverride: '' },
    { localId: 5, symbol: 'PG', quantity: 35, bucket: 'core', taxRateOverride: '' },
    { localId: 6, symbol: 'PEP', quantity: 28, bucket: 'income', taxRateOverride: '' },
    { localId: 7, symbol: 'MCD', quantity: 16, bucket: 'income', taxRateOverride: '' },
    { localId: 8, symbol: 'O', quantity: 200, bucket: 'income', taxRateOverride: '' },
    { localId: 9, symbol: 'VZ', quantity: 160, bucket: 'income', taxRateOverride: '' },
    { localId: 10, symbol: 'XOM', quantity: 55, bucket: 'core', taxRateOverride: '' },
    { localId: 11, symbol: 'CVX', quantity: 32, bucket: 'core', taxRateOverride: '' },
    { localId: 12, symbol: '00700.HK', quantity: 100, bucket: 'core', taxRateOverride: '' },
    { localId: 13, symbol: '00941.HK', quantity: 2000, bucket: 'income', taxRateOverride: '' },
    { localId: 14, symbol: '01398.HK', quantity: 8000, bucket: 'income', taxRateOverride: '' },
    { localId: 15, symbol: '00883.HK', quantity: 2200, bucket: 'income', taxRateOverride: '' },
    { localId: 16, symbol: '00005.HK', quantity: 600, bucket: 'core', taxRateOverride: '' },
    { localId: 17, symbol: '00388.HK', quantity: 150, bucket: 'core', taxRateOverride: '' },
    { localId: 18, symbol: '600519.SH', quantity: 8, bucket: 'core', taxRateOverride: '' },
    { localId: 19, symbol: '601318.SH', quantity: 1000, bucket: 'income', taxRateOverride: '' },
    { localId: 20, symbol: '600036.SH', quantity: 1200, bucket: 'income', taxRateOverride: '' }
  ];
}

const state = {
  holdings: [],
  nextId: 21,
  showAmounts: true,
  sortField: 'marketValueCny',
  sortDirection: 'desc',
  legendExpanded: false,
  rates: {
    USD: 7.22,
    HKD: 0.92,
    CNY: 1
  },
  quotes: structuredClone(DEFAULT_QUOTES),
  modal: null,
  modalPayload: null,
  lastMarketSource: 'mock',
  syncing: false
};

const refs = {
  summaryGrid: document.getElementById('summaryGrid'),
  companyDonut: document.getElementById('companyDonut'),
  companyLegend: document.getElementById('companyLegend'),
  legendToggle: document.getElementById('legendToggle'),
  bucketTrack: document.getElementById('bucketTrack'),
  stockList: document.getElementById('stockList'),
  stockCardTemplate: document.getElementById('stockCardTemplate'),
  privacyToggle: document.getElementById('privacyToggle'),
  refreshButton: document.getElementById('refreshButton'),
  addButton: document.getElementById('addButton'),
  modalRoot: document.getElementById('modalRoot'),
  sortChips: Array.from(document.querySelectorAll('.sort-chip'))
};

function applyStaticCopy() {
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    const key = node.getAttribute('data-i18n');
    node.textContent = COPY[key] || '';
  });
  const marketValueChip = document.querySelector('.sort-chip[data-sort-field="marketValueCny"]');
  const dividendYieldChip = document.querySelector('.sort-chip[data-sort-field="dividendYield"]');
  if (marketValueChip) marketValueChip.textContent = COPY.sortMarketValue;
  if (dividendYieldChip) dividendYieldChip.textContent = COPY.sortDividendYield;
}

function normalizeSymbol(symbol) {
  const code = String(symbol || '').trim().toUpperCase();
  if (!code) return '';
  if (/^\d{5}\.HK$/.test(code) || /^\d{6}\.(SH|SZ)$/.test(code) || /^[A-Z][A-Z0-9.-]*$/.test(code)) return code;
  if (/^\d{5}$/.test(code)) return `${code}.HK`;
  if (/^\d{6}$/.test(code)) {
    if (/^[69]/.test(code)) return `${code}.SH`;
    if (/^[023]/.test(code)) return `${code}.SZ`;
  }
  return code;
}

function detectMarketFromSymbol(symbol) {
  if (/^\d{5}\.HK$/.test(symbol)) return { market: 'HK', currency: 'HKD' };
  if (/^\d{6}\.(SH|SZ)$/.test(symbol)) return { market: 'CN', currency: 'CNY' };
  if (/^[A-Z][A-Z0-9.-]*$/.test(symbol)) return { market: 'US', currency: 'USD' };
  return { market: 'OTHER', currency: 'USD' };
}

function resolveQuote(symbol) {
  const normalized = normalizeSymbol(symbol);
  const existing = state.quotes[normalized];
  if (existing) return { symbol: normalized, ...existing };
  return {
    symbol: normalized,
    name: '\u672a\u8bc6\u522b\u80a1\u7968',
    ...detectMarketFromSymbol(normalized),
    price: 0,
    dividendYield: 0
  };
}

function normalizeTaxOverride(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, parsed);
}

function formatMoney(value, currency) {
  const symbolMap = { CNY: '\u00a5', USD: '$', HKD: 'HK$' };
  return `${symbolMap[currency] || ''}${Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function formatPlainPrice(value) {
  return Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatPercent(value) {
  return `${(Number(value || 0) * 100).toFixed(2)}%`;
}

function maskMoney(label) {
  return label ? '******' : '--';
}

function maskPrice(label) {
  return label ? '***.**' : '--';
}

function compareByMetric(left, right, field, direction) {
  const leftValue = Number(left[field] || 0);
  const rightValue = Number(right[field] || 0);
  if (leftValue === rightValue) {
    return Number(right.marketValueCny || 0) - Number(left.marketValueCny || 0);
  }
  return (leftValue - rightValue) * direction;
}

function jitter(value, amplitude) {
  const delta = value * amplitude * (Math.random() - 0.5) * 2;
  return Number((value + delta).toFixed(2));
}

function refreshMockMarket() {
  Object.keys(state.quotes).forEach((key) => {
    const current = state.quotes[key];
    state.quotes[key] = {
      ...current,
      price: Math.max(0.01, jitter(current.price, 0.015)),
      dividendYield: Math.max(0, Number((current.dividendYield * (1 + (Math.random() - 0.5) * 0.02)).toFixed(4)))
    };
  });
  state.rates = {
    USD: Math.max(6.5, jitter(state.rates.USD, 0.004)),
    HKD: Math.max(0.7, jitter(state.rates.HKD, 0.004)),
    CNY: 1
  };
  state.lastMarketSource = 'mock';
}

function collectSymbols() {
  return Array.from(new Set(state.holdings.map((item) => normalizeSymbol(item.symbol)).filter(Boolean)));
}

function applyLivePayload(payload) {
  if (payload?.rates) {
    state.rates = {
      USD: Number(payload.rates.USD || state.rates.USD),
      HKD: Number(payload.rates.HKD || state.rates.HKD),
      CNY: 1
    };
  }
  if (payload?.quotes) {
    Object.entries(payload.quotes).forEach(([symbol, quote]) => {
      const normalized = normalizeSymbol(symbol);
      const previous = resolveQuote(normalized);
      state.quotes[normalized] = {
        ...previous,
        name: quote.name || previous.name,
        price: Number(quote.price ?? previous.price ?? 0),
        dividendYield: Number(previous.dividendYield ?? 0)
      };
    });
  }
  state.lastMarketSource = 'live';
}

async function fetchLiveMarketData() {
  const symbols = collectSymbols();
  if (!symbols.length) return false;
  const response = await fetch(`${MARKET_ENDPOINT}?symbols=${encodeURIComponent(symbols.join(','))}`, {
    cache: 'no-store'
  });
  if (!response.ok) {
    throw new Error(`market request failed: ${response.status}`);
  }
  const payload = await response.json();
  if (!payload.ok) {
    throw new Error(payload.error || 'market request failed');
  }
  applyLivePayload(payload);
  return true;
}

function calculateHolding(holding) {
  const quote = resolveQuote(holding.symbol);
  const quantity = Number(holding.quantity || 0);
  const fxRate = state.rates[quote.currency] || 1;
  const taxOverridePercent = normalizeTaxOverride(holding.taxRateOverride);
  const taxRate = taxOverridePercent === null ? 0 : taxOverridePercent / 100;
  const marketValue = Number((quote.price * quantity).toFixed(2));
  const marketValueCny = Number((marketValue * fxRate).toFixed(2));
  const annualDividend = Number((marketValue * quote.dividendYield).toFixed(2));
  const annualDividendAfterTax = Number((annualDividend * (1 - taxRate)).toFixed(2));
  const annualDividendCny = Number((annualDividendAfterTax * fxRate).toFixed(2));
  return {
    ...holding,
    ...quote,
    stockName: quote.name,
    quantity,
    taxOverridePercent,
    marketValueCny,
    annualDividendCny,
    plainPriceLabel: formatPlainPrice(quote.price),
    dividendYieldLabel: formatPercent(quote.dividendYield),
    marketValueCnyLabel: formatMoney(marketValueCny, 'CNY'),
    annualDividendCnyLabel: formatMoney(annualDividendCny, 'CNY')
  };
}

function getComputedHoldings() {
  const direction = state.sortDirection === 'asc' ? 1 : -1;
  const computed = state.holdings.map(calculateHolding);
  computed.sort((left, right) => compareByMetric(left, right, state.sortField, direction));
  const total = computed.reduce((sum, item) => sum + item.marketValueCny, 0) || 1;
  return computed.map((item) => ({
    ...item,
    holdingPercentLabel: `${((item.marketValueCny / total) * 100).toFixed(1)}%`,
    displayPriceLabel: state.showAmounts ? item.plainPriceLabel : maskPrice(item.plainPriceLabel),
    displayMarketValueLabel: state.showAmounts ? item.marketValueCnyLabel : maskMoney(item.marketValueCnyLabel),
    displayAnnualDividendLabel: state.showAmounts ? item.annualDividendCnyLabel : maskMoney(item.annualDividendCnyLabel)
  }));
}

function getSummary(computed) {
  const totalMarketValueCny = computed.reduce((sum, item) => sum + item.marketValueCny, 0);
  const totalDividendCny = computed.reduce((sum, item) => sum + item.annualDividendCny, 0);
  return {
    totalMarketValueCnyLabel: formatMoney(totalMarketValueCny, 'CNY'),
    totalDividendCnyLabel: formatMoney(totalDividendCny, 'CNY')
  };
}

function getCompanySegments(computed) {
  return computed.filter((item) => item.marketValueCny > 0).map((item, index) => ({
    label: item.stockName,
    value: item.marketValueCny,
    color: COMPANY_COLORS[index % COMPANY_COLORS.length]
  }));
}

function getBucketSegments(computed) {
  const totals = { core: 0, income: 0 };
  computed.forEach((item) => {
    totals[item.bucket] += item.marketValueCny;
  });
  const grand = totals.core + totals.income || 1;
  return [
    { label: COPY.core, value: totals.core, percent: `${((totals.core / grand) * 100).toFixed(1)}%`, color: BUCKET_COLORS.core },
    { label: COPY.income, value: totals.income, percent: `${((totals.income / grand) * 100).toFixed(1)}%`, color: BUCKET_COLORS.income }
  ].filter((item) => item.value > 0);
}

function persistState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    holdings: state.holdings,
    nextId: state.nextId,
    showAmounts: state.showAmounts,
    sortField: state.sortField,
    sortDirection: state.sortDirection,
    legendExpanded: state.legendExpanded,
    rates: state.rates,
    quotes: state.quotes,
    lastMarketSource: state.lastMarketSource
  }));
}

function restoreState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!saved || !Array.isArray(saved.holdings)) throw new Error('empty');
    state.holdings = saved.holdings;
    state.nextId = Number(saved.nextId || 21);
    state.showAmounts = saved.showAmounts !== false;
    state.sortField = saved.sortField || 'marketValueCny';
    state.sortDirection = saved.sortDirection || 'desc';
    state.legendExpanded = Boolean(saved.legendExpanded);
    state.rates = saved.rates || state.rates;
    state.quotes = saved.quotes || structuredClone(DEFAULT_QUOTES);
    state.lastMarketSource = saved.lastMarketSource || 'mock';
  } catch (error) {
    state.holdings = createInitialHoldings();
    state.nextId = 21;
    state.showAmounts = true;
    state.sortField = 'marketValueCny';
    state.sortDirection = 'desc';
    state.legendExpanded = false;
    state.rates = { USD: 7.22, HKD: 0.92, CNY: 1 };
    state.quotes = structuredClone(DEFAULT_QUOTES);
    state.lastMarketSource = 'mock';
  }
}

function setSortUI() {
  refs.sortChips.forEach((chip) => {
    const isActive = chip.dataset.sortField === state.sortField;
    chip.classList.toggle('is-active', isActive);
    chip.dataset.direction = isActive ? (state.sortDirection === 'desc' ? '↓' : '↑') : '';
  });
}

function renderSummary(summary) {
  const totalMarketValue = state.showAmounts ? summary.totalMarketValueCnyLabel : maskMoney(summary.totalMarketValueCnyLabel);
  const totalDividend = state.showAmounts ? summary.totalDividendCnyLabel : maskMoney(summary.totalDividendCnyLabel);
  refs.summaryGrid.innerHTML = [
    { label: COPY.totalMarketValue, value: totalMarketValue, className: '' },
    { label: COPY.totalDividend, value: totalDividend, className: 'income' },
    { label: COPY.usdRate, mini: `1 USD = ${state.rates.USD.toFixed(2)} CNY` },
    { label: COPY.hkdRate, mini: `1 HKD = ${state.rates.HKD.toFixed(2)} CNY` }
  ].map((item) => `
    <div class="summary-item">
      <div class="summary-label">${item.label}</div>
      ${item.value ? `<div class="summary-value ${item.className}">${item.value}</div>` : ''}
      ${item.mini ? `<div class="summary-mini">${item.mini}</div>` : ''}
    </div>
  `).join('');
}

function renderDonut(companySegments) {
  const total = companySegments.reduce((sum, item) => sum + item.value, 0);
  if (!companySegments.length || total <= 0) {
    refs.companyDonut.style.background = 'conic-gradient(#dfe5ee 0deg, #dfe5ee 360deg)';
    return;
  }
  let angle = 0;
  const stops = companySegments.map((item) => {
    const nextAngle = angle + (item.value / total) * 360;
    const stop = `${item.color} ${angle.toFixed(1)}deg ${nextAngle.toFixed(1)}deg`;
    angle = nextAngle;
    return stop;
  });
  refs.companyDonut.style.background = `conic-gradient(${stops.join(', ')})`;
}

function renderLegend(companySegments) {
  const total = companySegments.reduce((sum, item) => sum + item.value, 0) || 1;
  const visible = state.legendExpanded ? companySegments : companySegments.slice(0, LEGEND_COLLAPSED_COUNT);
  refs.companyLegend.innerHTML = visible.map((item) => `
    <div class="legend-item">
      <div class="legend-main">
        <span class="legend-dot" style="background:${item.color}"></span>
        <span class="legend-label">${item.label}</span>
      </div>
      <span class="legend-value">${((item.value / total) * 100).toFixed(1)}%</span>
    </div>
  `).join('');
  if (companySegments.length > LEGEND_COLLAPSED_COUNT) {
    refs.legendToggle.hidden = false;
    refs.legendToggle.textContent = state.legendExpanded ? COPY.collapseLegend : `${COPY.expandLegend} ${companySegments.length} \u9879`;
  } else {
    refs.legendToggle.hidden = true;
  }
}

function renderBuckets(bucketSegments) {
  refs.bucketTrack.innerHTML = bucketSegments.map((item) => `
    <div class="bucket-segment" style="width:${item.percent};background:${item.color}">
      <span class="bucket-text">${item.label} ${item.percent}</span>
    </div>
  `).join('');
}

function renderHoldings(computed) {
  refs.stockList.innerHTML = '';
  computed.forEach((item) => {
    const fragment = refs.stockCardTemplate.content.cloneNode(true);
    fragment.querySelector('.stock-name').textContent = item.stockName;
    fragment.querySelector('.stock-price').textContent = item.displayPriceLabel;
    fragment.querySelector('.holding-badge').textContent = item.holdingPercentLabel;
    fragment.querySelector('.stock-code').textContent = item.symbol;
    fragment.querySelector('.market-label').textContent = COPY.marketValue;
    fragment.querySelector('.quantity-label').textContent = COPY.quantity;
    fragment.querySelector('.annual-label').textContent = COPY.annualDividend;
    fragment.querySelector('.yield-label').textContent = COPY.dividendYield;
    fragment.querySelector('.market-value').textContent = item.displayMarketValueLabel;
    fragment.querySelector('.quantity-value').textContent = String(item.quantity);
    fragment.querySelector('.annual-value').textContent = item.displayAnnualDividendLabel;
    fragment.querySelector('.yield-value').textContent = item.dividendYieldLabel;
    fragment.querySelector('.stock-delete').addEventListener('click', () => {
      if (!window.confirm(`${COPY.confirmDeleteTitle}\n${COPY.confirmDelete} ${item.stockName} ?`)) return;
      state.holdings = state.holdings.filter((holding) => holding.localId !== item.localId);
      persistState();
      renderApp();
    });
    fragment.querySelector('.quantity-trigger').addEventListener('click', () => {
      openModal('quantity', { localId: item.localId, stockName: item.stockName, value: item.quantity });
    });
    fragment.querySelector('.annual-trigger').addEventListener('click', () => {
      openModal('tax', { localId: item.localId, stockName: item.stockName, value: item.taxOverridePercent ?? '' });
    });
    refs.stockList.appendChild(fragment);
  });
}

function renderPrivacyButton() {
  refs.privacyToggle.classList.toggle('is-hidden', !state.showAmounts);
}

function closeModal() {
  state.modal = null;
  state.modalPayload = null;
  refs.modalRoot.innerHTML = '';
}

function openModal(type, payload) {
  state.modal = type;
  state.modalPayload = payload || null;
  renderModal();
}

function renderModal() {
  if (!state.modal) {
    refs.modalRoot.innerHTML = '';
    return;
  }
  const mask = document.createElement('div');
  mask.className = 'modal-mask is-visible';
  mask.addEventListener('click', closeModal);
  const sheet = document.createElement('section');
  sheet.className = 'modal-sheet is-visible';

  if (state.modal === 'quantity') {
    sheet.innerHTML = `
      <h3 class="modal-title">${COPY.quantityModalTitle}</h3>
      <p class="modal-subtitle">${state.modalPayload.stockName || ''}</p>
      <input class="modal-input" id="quantityInput" type="number" inputmode="decimal" value="${state.modalPayload.value ?? ''}" placeholder="${COPY.quantityPlaceholder}">
      <div class="modal-actions">
        <button class="modal-button secondary-button" type="button" data-action="cancel">${COPY.cancel}</button>
        <button class="modal-button primary-button" type="button" data-action="save">${COPY.save}</button>
      </div>
    `;
  }
  if (state.modal === 'tax') {
    sheet.innerHTML = `
      <h3 class="modal-title">${COPY.taxModalTitle}</h3>
      <p class="modal-subtitle">${state.modalPayload.stockName || ''}</p>
      <input class="modal-input" id="taxInput" type="number" inputmode="decimal" value="${state.modalPayload.value ?? ''}" placeholder="${COPY.taxPlaceholder}">
      <div class="modal-actions">
        <button class="modal-button secondary-button" type="button" data-action="cancel">${COPY.cancel}</button>
        <button class="modal-button primary-button" type="button" data-action="save">${COPY.save}</button>
      </div>
    `;
  }
  if (state.modal === 'add') {
    sheet.innerHTML = `
      <h3 class="modal-title">${COPY.addModalTitle}</h3>
      <p class="modal-subtitle">${COPY.addModalSubtitle}</p>
      <input class="modal-input" id="addSymbolInput" type="text" placeholder="${COPY.symbolPlaceholder}">
      <input class="modal-input" id="addQuantityInput" type="number" inputmode="decimal" placeholder="${COPY.quantityPlaceholder}">
      <select class="modal-select" id="addBucketSelect">
        <option value="core">${COPY.core}</option>
        <option value="income">${COPY.income}</option>
      </select>
      <div class="modal-actions">
        <button class="modal-button secondary-button" type="button" data-action="cancel">${COPY.cancel}</button>
        <button class="modal-button primary-button" type="button" data-action="save">${COPY.save}</button>
      </div>
    `;
  }

  const cancelButton = sheet.querySelector('[data-action="cancel"]');
  const saveButton = sheet.querySelector('[data-action="save"]');
  if (cancelButton) cancelButton.addEventListener('click', closeModal);
  if (saveButton) saveButton.addEventListener('click', handleModalSave);
  refs.modalRoot.innerHTML = '';
  refs.modalRoot.append(mask, sheet);
}

function handleModalSave() {
  if (state.modal === 'quantity') {
    const value = Number(document.getElementById('quantityInput').value || 0);
    state.holdings = state.holdings.map((item) => item.localId === state.modalPayload.localId ? { ...item, quantity: value } : item);
  }
  if (state.modal === 'tax') {
    const value = document.getElementById('taxInput').value.trim();
    state.holdings = state.holdings.map((item) => item.localId === state.modalPayload.localId ? { ...item, taxRateOverride: value } : item);
  }
  if (state.modal === 'add') {
    const symbol = normalizeSymbol(document.getElementById('addSymbolInput').value);
    const quantity = Number(document.getElementById('addQuantityInput').value || 0);
    const bucket = document.getElementById('addBucketSelect').value;
    if (!symbol) {
      window.alert(COPY.missingSymbol);
      return;
    }
    if (state.holdings.some((item) => item.symbol === symbol)) {
      window.alert(`${symbol} ${COPY.stockExists}`);
      return;
    }
    state.holdings = state.holdings.concat({ localId: state.nextId, symbol, quantity, bucket, taxRateOverride: '' });
    state.nextId += 1;
  }
  persistState();
  closeModal();
  renderApp();
}

function renderApp() {
  const computed = getComputedHoldings();
  const summary = getSummary(computed);
  const companySegments = getCompanySegments(computed);
  const bucketSegments = getBucketSegments(computed);
  setSortUI();
  renderSummary(summary);
  renderDonut(companySegments);
  renderLegend(companySegments);
  renderBuckets(bucketSegments);
  renderHoldings(computed);
  renderPrivacyButton();
}

async function disableLegacyServiceWorkers() {
  if ('serviceWorker' in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    } catch (error) {
      console.warn('service worker cleanup failed', error);
    }
  }
  if ('caches' in window) {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith('bopup-ledger')).map((key) => caches.delete(key)));
    } catch (error) {
      console.warn('cache cleanup failed', error);
    }
  }
}

async function refreshMarketData(options = {}) {
  const { silent = false, fallbackToMock = true } = options;
  if (state.syncing) return;
  state.syncing = true;
  refs.refreshButton.disabled = true;
  try {
    const loaded = await fetchLiveMarketData();
    if (!loaded && fallbackToMock) {
      refreshMockMarket();
    }
  } catch (error) {
    console.warn('live market fetch failed', error);
    if (fallbackToMock) {
      refreshMockMarket();
    }
  } finally {
    state.syncing = false;
    refs.refreshButton.disabled = false;
    persistState();
    renderApp();
    if (!silent) {
      console.info(`market source: ${state.lastMarketSource}`);
    }
  }
}

refs.legendToggle.addEventListener('click', () => {
  state.legendExpanded = !state.legendExpanded;
  persistState();
  renderApp();
});

refs.refreshButton.addEventListener('click', async () => {
  await refreshMarketData({ silent: false, fallbackToMock: true });
});

refs.addButton.addEventListener('click', () => {
  openModal('add');
});

refs.privacyToggle.addEventListener('click', () => {
  state.showAmounts = !state.showAmounts;
  persistState();
  renderApp();
});

refs.sortChips.forEach((chip) => {
  chip.addEventListener('click', () => {
    const field = chip.dataset.sortField;
    if (!field) return;
    if (state.sortField === field) {
      state.sortDirection = state.sortDirection === 'desc' ? 'asc' : 'desc';
    } else {
      state.sortField = field;
      state.sortDirection = 'desc';
    }
    persistState();
    renderApp();
  });
});

async function boot() {
  applyStaticCopy();
  restoreState();
  renderApp();
  await disableLegacyServiceWorkers();
  await refreshMarketData({ silent: true, fallbackToMock: false });
}

boot();