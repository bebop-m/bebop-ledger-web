import {
  DEFAULT_STALE_DAYS, VALID_DIVIDEND_SOURCES, VALID_DIVIDEND_STATUSES,
  VALID_RECEIPT_STATUSES, VALID_DIVIDEND_CONFIDENCES, LABELS, DEFAULT_RATES,
  PAYDATE_LAG_DAYS
} from './constants.js';

/* ── Stale-days config (set from network module on config load) ── */
let _staleDays = DEFAULT_STALE_DAYS;
export function setStaleDays(value) { _staleDays = normalizeStaleDays(value); }
export function getStaleDays() { return _staleDays; }

/* ── Core Utilities ── */
export function roundTo(value, digits = 6) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(digits)) : 0;
}

export function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function clone(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

const _HTML_ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const _HTML_ESCAPE_RE = /[&<>"']/g;
export function escapeHtml(value) {
  return String(value ?? '').replace(_HTML_ESCAPE_RE, (ch) => _HTML_ESCAPE_MAP[ch]);
}

export function createElementFromHtml(markup) {
  const template = document.createElement('template');
  template.innerHTML = String(markup || '').trim();
  return template.content.firstElementChild;
}

/* ── Formatting ── */
export function formatMoney(value, currency) {
  const amount = safeNumber(value, 0);
  const sign = amount < 0 ? '-' : '';
  const absolute = Math.abs(amount);
  const symbols = { CNY: '\u00a5', USD: '$', HKD: 'HK$' };
  return `${sign}${symbols[currency] || ''}${absolute.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatPlainPrice(value) {
  return safeNumber(value, 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatPercent(value) {
  return `${(safeNumber(value, 0) * 100).toFixed(2)}%`;
}

export function formatDailyPnl(pnlCny, totalMarketValueCny) {
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

export function formatTimestamp(isoString) {
  if (!isoString) return LABELS.waitingForUpdate;
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return LABELS.waitingForUpdate;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${LABELS.marketUpdated} ${month}-${day} ${hour}:${minute}`;
}

export function formatDateLabel(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/* ── Dividend Logic ── */
export function normalizeDividendSource(value, fallback = 'cache') {
  const source = String(value || '').trim().toLowerCase();
  return VALID_DIVIDEND_SOURCES.has(source) ? source : fallback;
}

export function normalizeDividendStatus(value, fallback = 'missing') {
  const status = String(value || '').trim().toLowerCase();
  return VALID_DIVIDEND_STATUSES.has(status) ? status : fallback;
}

export function normalizeReceiptStatus(value, fallback = 'pending') {
  const status = String(value || '').trim().toLowerCase();
  if (VALID_RECEIPT_STATUSES.has(status)) return status;
  if (status === 'confirmed' || status === 'paid' || status === 'settled') return 'received';
  return VALID_RECEIPT_STATUSES.has(fallback) ? fallback : 'pending';
}

export function normalizeDividendConfidence(value, fallback = 'estimated') {
  const confidence = String(value || '').trim();
  return VALID_DIVIDEND_CONFIDENCES.has(confidence)
    ? confidence
    : (VALID_DIVIDEND_CONFIDENCES.has(fallback) ? fallback : 'estimated');
}

// Legacy migration helper: converts dividend yield from either ratio (0.052) or
// percentage (5.2) format into a ratio. Assumes values > 1 are percentages.
export function normalizeYieldRatio(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, numeric > 1 ? numeric / 100 : numeric);
}

export function parsePerShareOverride(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return (!Number.isFinite(parsed) || parsed < 0) ? null : roundTo(parsed);
}

export function sanitizePerShareOverrideInput(value) {
  const parsed = parsePerShareOverride(value);
  return parsed === null ? '' : String(parsed);
}

export function normalizeStaleDays(value, fallback = DEFAULT_STALE_DAYS) {
  const numeric = Math.floor(Number(value));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

export function parseIsoDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isDividendDataStale(updatedAt, staleDays) {
  if (staleDays === undefined) staleDays = _staleDays;
  const updatedDate = parseIsoDate(updatedAt);
  if (!updatedDate) return true;
  return Date.now() - updatedDate.getTime() > normalizeStaleDays(staleDays) * 86400000;
}

export function buildDividendFields(rawQuote = {}, fallbackQuote = {}) {
  const nextPrice = safeNumber(rawQuote.price, safeNumber(fallbackQuote.price, 0));
  const rawDps = Number(rawQuote.dividendPerShareTtm);
  const fallbackDps = safeNumber(fallbackQuote.dividendPerShareTtm, 0);
  const legacyYieldRatio = normalizeYieldRatio(rawQuote.dividendYield);
  const derivedDps = legacyYieldRatio === null || nextPrice <= 0 ? fallbackDps : nextPrice * legacyYieldRatio;
  const dividendPerShareTtm = Number.isFinite(rawDps) ? Math.max(0, rawDps) : Math.max(0, derivedDps);
  const fallbackSource = normalizeDividendSource(fallbackQuote.dividendSource, 'cache');
  const dividendSource = normalizeDividendSource(rawQuote.dividendSource, fallbackSource);
  const fallbackUpdatedAt = typeof fallbackQuote.dividendUpdatedAt === 'string' ? fallbackQuote.dividendUpdatedAt : '';
  const fallbackLastExDate = typeof fallbackQuote.lastExDate === 'string' ? fallbackQuote.lastExDate : '';
  const hasRawFetchError = Object.prototype.hasOwnProperty.call(rawQuote, 'dividendFetchError');
  const rawFetchError = hasRawFetchError && typeof rawQuote.dividendFetchError === 'string' ? rawQuote.dividendFetchError.trim() : null;
  const fallbackFetchError = typeof fallbackQuote.dividendFetchError === 'string' ? fallbackQuote.dividendFetchError.trim() : '';
  const dividendUpdatedAt = typeof rawQuote.dividendUpdatedAt === 'string' ? rawQuote.dividendUpdatedAt : fallbackUpdatedAt;
  const lastExDate = typeof rawQuote.lastExDate === 'string' ? rawQuote.lastExDate : fallbackLastExDate;
  const rawDividendEvents = Array.isArray(rawQuote.dividends) ? rawQuote.dividends : fallbackQuote.dividends;
  const dividends = normalizeQuoteDividends(rawDividendEvents, rawQuote.symbol || fallbackQuote.symbol || '');
  const dividendStatus = dividendSource === 'manual' ? 'manual'
    : dividendPerShareTtm <= 0 ? 'missing'
    : (dividendSource === 'cache' || isDividendDataStale(dividendUpdatedAt) ? 'stale' : 'fresh');
  const result = {
    dividendPerShareTtm: roundTo(dividendPerShareTtm),
    dividendSource,
    dividendUpdatedAt,
    lastExDate,
    dividendFetchError: rawFetchError === null ? fallbackFetchError : rawFetchError,
    dividendStatus
  };
  if (dividends.length || Array.isArray(rawQuote.dividends) || Array.isArray(fallbackQuote.dividends)) {
    result.dividends = dividends;
  }
  return result;
}

export function normalizeSeedQuoteMap(seedMap) {
  const normalized = {};
  Object.entries(seedMap || {}).forEach(([symbol, quote]) => {
    normalized[symbol] = { symbol, ...quote, ...buildDividendFields({ symbol, ...quote }, {}) };
  });
  return normalized;
}

export function getDividendSourceLabel(source) {
  const key = String(source || '').trim().toLowerCase();
  if (key === 'yfinance') return 'YFinance';
  if (key === 'yahoo') return 'Yahoo';
  if (key === 'manual') return '手动';
  if (key === 'eodhd') return 'EODHD';
  if (key === 'cache') return '沿用缓存';
  return 'YFinance';
}

export function getDividendStatusLabel(status) {
  const key = normalizeDividendStatus(status, 'missing');
  if (key === 'manual') return LABELS.dividendStatusManual;
  if (key === 'fresh') return LABELS.dividendStatusFresh;
  if (key === 'stale') return LABELS.dividendStatusStale;
  return LABELS.dividendStatusMissing;
}

export function buildDividendTooltipLines(item) {
  const lines = [`${LABELS.dividendSource}：${getDividendSourceLabel(item.dividendSource)}`];
  const updatedAt = formatDateLabel(item.dividendUpdatedAt);
  if (updatedAt) lines.push(`${LABELS.dividendUpdatedAt}：${updatedAt}`);
  const lastExDate = formatDateLabel(item.lastExDate);
  if (lastExDate) lines.push(`${LABELS.lastExDate}：${lastExDate}`);
  const fetchError = typeof item.dividendFetchError === 'string' ? item.dividendFetchError.trim() : '';
  if (fetchError) {
    const errorText = fetchError.length > 160 ? `${fetchError.slice(0, 157)}...` : fetchError;
    lines.push(`${LABELS.dividendFetchError}：${errorText}`);
  }
  return lines;
}

export function buildDividendTooltipHtml(lines) {
  return lines.map((line) => {
    const text = String(line || '').trim();
    const match = text.match(/^([^:：]+[:：])\s*(.*)$/);
    const isWrap = text.startsWith(LABELS.dividendFetchError);
    if (!match) {
      return `<span class="dividend-tooltip-line${isWrap ? ' is-wrap' : ''}"><span class="dividend-tooltip-value">${escapeHtml(text)}</span></span>`;
    }
    return `<span class="dividend-tooltip-line${isWrap ? ' is-wrap' : ''}"><span class="dividend-tooltip-label">${escapeHtml(match[1])}</span><span class="dividend-tooltip-value">${escapeHtml(match[2])}</span></span>`;
  }).join('');
}

/* ── Symbol & Quote Helpers ── */
export function normalizeSymbol(rawSymbol) {
  const value = String(rawSymbol || '').trim().toUpperCase();
  if (!value) return '';
  const normalizeCnSuffix = (digits) => (/^[569]/.test(digits) ? `${digits}.SH` : `${digits}.SZ`);
  if (/^\d{6}\.SS$/.test(value)) return value.replace('.SS', '.SH');
  if (/^\d{5}\.HK$/.test(value)) return value;
  if (/^\d{6}\.(SH|SZ)$/.test(value)) return normalizeCnSuffix(value.slice(0, 6));
  if (/^[A-Z][A-Z0-9.-]*$/.test(value)) return value;
  if (/^\d{5}$/.test(value)) return `${value}.HK`;
  if (/^\d{6}$/.test(value)) return normalizeCnSuffix(value);
  return value;
}

export function chunkSymbols(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export function toTencentSymbol(symbol) {
  const normalized = normalizeSymbol(symbol);
  if (!normalized) return '';
  if (normalized.endsWith('.HK')) return 'hk' + normalized.slice(0, -3).padStart(5, '0');
  if (normalized.endsWith('.SH')) return 'sh' + normalized.slice(0, -3);
  if (normalized.endsWith('.SZ')) return 'sz' + normalized.slice(0, -3);
  return 'us' + normalized;
}

export function inferQuoteFromMap(symbol, quoteMap = {}, defaultQuotes = {}) {
  if (quoteMap[symbol]) return { ...quoteMap[symbol], symbol };
  if (defaultQuotes[symbol]) return { ...defaultQuotes[symbol], symbol };
  const stub = { symbol, price: 0, dividendPerShareTtm: 0, dividendSource: 'cache', dividendUpdatedAt: '', lastExDate: '', dividendFetchError: '', dividendStatus: 'missing' };
  if (/\.HK$/.test(symbol)) return { ...stub, name: LABELS.unknownHK, market: 'HK', currency: 'HKD' };
  if (/\.(SH|SZ)$/.test(symbol)) return { ...stub, name: LABELS.unknownCN, market: 'CN', currency: 'CNY' };
  return { ...stub, name: LABELS.unknownUS, market: 'US', currency: 'USD' };
}

export function mergeQuotes(baseMap, nextMap) {
  const merged = { ...baseMap };
  Object.entries(nextMap || {}).forEach(([rawSymbol, rawQuote]) => {
    const symbol = normalizeSymbol(rawSymbol);
    if (!symbol || !rawQuote) return;
    const fallback = merged[symbol] || inferQuoteFromMap(symbol, merged);
    const dividendFields = buildDividendFields({ symbol, ...rawQuote }, fallback);
    merged[symbol] = {
      symbol,
      name: rawQuote.name || fallback.name,
      market: rawQuote.market || fallback.market,
      currency: rawQuote.currency || fallback.currency,
      price: safeNumber(rawQuote.price, fallback.price),
      previousClose: safeNumber(rawQuote.previousClose, safeNumber(fallback.previousClose, 0)),
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

function normalizeCurrencyCode(value, fallback = 'CNY') {
  const currency = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : fallback;
}

export function buildDividendSourceId(input = {}) {
  const symbol = normalizeSymbol(input.symbol);
  const exDate = formatDateLabel(input.exDate);
  const amountPerShare = roundTo(safeNumber(input.amountPerShare, 0));
  const currency = normalizeCurrencyCode(input.currency, '');
  return [symbol, exDate, amountPerShare, currency].join('|');
}

export function normalizeQuoteDividendEvent(item, symbolFallback = '') {
  if (!item || typeof item !== 'object') return null;
  const symbol = normalizeSymbol(item.symbol || symbolFallback);
  const exDate = formatDateLabel(item.exDate);
  const amountPerShare = Math.max(0, roundTo(safeNumber(item.amountPerShare, 0)));
  const currency = normalizeCurrencyCode(item.currency, resolveQuoteCurrency({}, symbol));
  if (!exDate) return null;
  const sourceId = typeof item.sourceId === 'string' && item.sourceId.trim()
    ? item.sourceId.trim()
    : buildDividendSourceId({ symbol, exDate, amountPerShare, currency });
  return {
    ...item,
    ...(symbol ? { symbol } : {}),
    sourceId,
    exDate,
    payDate: formatDateLabel(item.payDate),
    amountPerShare,
    currency,
    source: typeof item.source === 'string' && item.source.trim() ? item.source.trim() : 'unknown'
  };
}

export function normalizeQuoteDividends(value, symbolFallback = '') {
  return Array.isArray(value)
    ? value.map((item) => normalizeQuoteDividendEvent(item, symbolFallback)).filter(Boolean)
    : [];
}

export function marketFromSymbol(symbol) {
  const value = String(symbol || '').trim().toUpperCase();
  if (value.endsWith('.HK')) return 'HK';
  if (value.endsWith('.SH') || value.endsWith('.SZ')) return 'CN';
  return 'US';
}

export function addDaysToDateLabel(dateLabel, days) {
  const label = formatDateLabel(dateLabel);
  if (!label) return '';
  const date = new Date(`${label}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return '';
  date.setUTCDate(date.getUTCDate() + Math.round(safeNumber(days, 0)));
  return formatDateLabel(date.toISOString());
}

/* 有效到账日：真实 payDate（数据或用户确认）优先，缺失时按市场滞后估算，最后退回除息日。
   返回 { date, source: 'data' | 'estimated' | 'exDate', estimated } */
export function resolveEffectivePayDate(exDate, payDate, symbol) {
  const realPay = formatDateLabel(payDate);
  if (realPay) return { date: realPay, source: 'data', estimated: false };
  const ex = formatDateLabel(exDate);
  if (!ex) return { date: '', source: 'exDate', estimated: false };
  const lag = safeNumber(PAYDATE_LAG_DAYS[marketFromSymbol(symbol)], 0);
  if (lag <= 0) return { date: ex, source: 'exDate', estimated: false };
  return { date: addDaysToDateLabel(ex, lag) || ex, source: 'estimated', estimated: true };
}

export function sanitizeDividendLedgerEntry(item, index = 0) {
  if (!item || typeof item !== 'object') return null;
  const symbol = normalizeSymbol(item.symbol);
  const exDate = formatDateLabel(item.exDate);
  const amountPerShare = Math.max(0, roundTo(safeNumber(item.amountPerShare, 0)));
  const currency = normalizeCurrencyCode(item.currency, resolveQuoteCurrency({}, symbol));
  if (!symbol || !exDate || amountPerShare <= 0) return null;
  const sourceId = typeof item.sourceId === 'string' && item.sourceId.trim()
    ? item.sourceId.trim()
    : buildDividendSourceId({ symbol, exDate, amountPerShare, currency });
  const userConfirmed = item.confirmed === true;
  const receiptStatus = userConfirmed ? 'received' : normalizeReceiptStatus(item.receiptStatus || item.status, 'pending');
  const confidence = normalizeDividendConfidence(item.confidence, userConfirmed ? 'confirmed' : 'estimated');
  const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `div_${sourceId || index + 1}`;
  return {
    ...item,
    id,
    sourceId,
    symbol: symbol || String(item.symbol || '').trim(),
    exDate,
    payDate: formatDateLabel(item.payDate),
    amountPerShare,
    currency,
    shares: Math.max(0, safeNumber(item.shares, 0)),
    sharesSource: typeof item.sharesSource === 'string' && item.sharesSource.trim() ? item.sharesSource.trim() : 'manual',
    fxRate: Math.max(0, safeNumber(item.fxRate, 1)),
    taxRate: Math.max(0, safeNumber(item.taxRate, 0)),
    grossCny: safeNumber(item.grossCny, 0),
    netCny: safeNumber(item.netCny, 0),
    bucket: item.bucket === 'income' ? 'income' : 'core',
    receiptStatus,
    confidence,
    confirmed: userConfirmed,
    note: typeof item.note === 'string' ? item.note : '',
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : ''
  };
}

export function sanitizeDailySnapshotEntry(item) {
  if (!item || typeof item !== 'object') return null;
  const date = formatDateLabel(item.date);
  if (!date) return null;
  const rates = item.rates && typeof item.rates === 'object' ? item.rates : {};
  const holdings = Array.isArray(item.holdings)
    ? item.holdings.map((holding) => {
        if (!holding || typeof holding !== 'object') return null;
        const symbol = normalizeSymbol(holding.symbol);
        return {
          ...holding,
          symbol: symbol || String(holding.symbol || '').trim(),
          shares: Math.max(0, safeNumber(holding.shares != null ? holding.shares : holding.quantity, 0)),
          bucket: holding.bucket === 'income' ? 'income' : 'core',
          taxRate: Math.max(0, safeNumber(holding.taxRate, 0))
        };
      }).filter(Boolean)
    : [];
  return {
    ...item,
    date,
    rates: {
      CNY: 1,
      USD: safeNumber(rates.USD, DEFAULT_RATES.USD),
      HKD: safeNumber(rates.HKD, DEFAULT_RATES.HKD)
    },
    netCny: safeNumber(item.netCny, 0),
    totalMarketValueCny: safeNumber(item.totalMarketValueCny, 0),
    liabilityCny: Math.max(0, safeNumber(item.liabilityCny, 0)),
    holdings
  };
}

export function sanitizeCashFlowEntry(item, index = 0) {
  if (!item || typeof item !== 'object') return null;
  const date = formatDateLabel(item.date);
  if (!date) return null;
  const rawAmountCny = safeNumber(item.amountCny, 0);
  const rawType = String(item.type || '').trim().toLowerCase();
  const type = ['withdraw', 'withdrawal', 'out', 'outflow'].includes(rawType)
    ? 'withdrawal'
    : ['deposit', 'in', 'inflow'].includes(rawType)
      ? 'deposit'
      : (rawAmountCny < 0 ? 'withdrawal' : 'deposit');
  return {
    ...item,
    id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `cf_${index + 1}`,
    date,
    amountCny: Math.abs(rawAmountCny),
    type,
    note: typeof item.note === 'string' ? item.note : ''
  };
}

export function sanitizeTradeEntry(item, index = 0) {
  if (!item || typeof item !== 'object') return null;
  const date = formatDateLabel(item.date);
  const symbol = normalizeSymbol(item.symbol);
  if (!date || !symbol) return null;
  const rawSide = String(item.side || '').trim().toLowerCase();
  const side = rawSide === 'sell' ? 'sell' : 'buy';
  const shares = Math.max(0, roundTo(safeNumber(item.shares, item.quantity), 6));
  const price = Math.max(0, roundTo(safeNumber(item.price, 0), 6));
  if (shares <= 0 || price <= 0) return null;
  return {
    ...item,
    id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `tr_${index + 1}`,
    date,
    symbol,
    side,
    shares,
    price,
    currency: normalizeCurrencyCode(item.currency, resolveQuoteCurrency({}, symbol)),
    fxRate: Math.max(0, roundTo(safeNumber(item.fxRate, 1), 6)),
    feeCny: Math.max(0, roundTo(safeNumber(item.feeCny, 0), 2)),
    bucket: item.bucket === 'income' ? 'income' : 'core',
    note: typeof item.note === 'string' ? item.note : ''
  };
}

export function sanitizeYearlyManualEntry(item) {
  if (!item || typeof item !== 'object') return null;
  const year = Math.floor(safeNumber(item.year, 0));
  if (year <= 0) return null;
  return {
    ...item,
    year,
    dividendCny: safeNumber(item.dividendCny, 0),
    yearEndNetCny: safeNumber(item.yearEndNetCny, 0),
    netInflowCny: safeNumber(item.netInflowCny, 0),
    // 可选的直接回填值：null 表示未填，由净值链自动推算。
    capitalReturnCny: item.capitalReturnCny === null || item.capitalReturnCny === undefined || item.capitalReturnCny === '' ? null : safeNumber(item.capitalReturnCny, 0),
    capitalReturnRate: item.capitalReturnRate === null || item.capitalReturnRate === undefined || item.capitalReturnRate === '' ? null : safeNumber(item.capitalReturnRate, 0)
  };
}

export function sanitizeHolding(item, index, quoteMap = {}) {
  const symbol = normalizeSymbol(item && item.symbol);
  if (!symbol) return null;
  const quote = inferQuoteFromMap(symbol, quoteMap);
  const hasExplicit = item && item.dividendPerShareTtmOverrideTouched === true;
  const rawOverride = item && item.dividendPerShareTtmOverride != null ? item.dividendPerShareTtmOverride : null;
  const nextOverride = sanitizePerShareOverrideInput(
    rawOverride != null
      ? (String(rawOverride).trim() === '0' && !hasExplicit ? '' : rawOverride)
      : (() => {
          const legacyYieldRatio = normalizeYieldRatio(item && item.dividendYieldOverride);
          if (legacyYieldRatio === null) return '';
          const price = safeNumber(quote.price, 0);
          return price > 0 ? price * legacyYieldRatio : '';
        })()
  );
  return {
    localId: Math.max(1, Math.floor(safeNumber(item && item.localId, index + 1))),
    symbol,
    quantity: Math.max(0, safeNumber(item && item.quantity != null ? item.quantity : item && item.shares, 0)),
    bucket: item && item.bucket === 'income' ? 'income' : 'core',
    taxRateOverride: item && item.taxRateOverride != null ? String(item.taxRateOverride) : item && item.taxRate != null ? String(item.taxRate) : '',
    dividendPerShareTtmOverride: nextOverride,
    dividendPerShareTtmOverrideTouched: nextOverride !== ''
  };
}

export function parsePercentOverride(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
}

export function resolveManualDividendPerShareOverride(value, isExplicit = false) {
  if (value === '' || value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || (trimmed === '0' && !isExplicit)) return null;
    return parsePerShareOverride(trimmed);
  }
  if (value === 0 && !isExplicit) return null;
  return parsePerShareOverride(value);
}

export function resolveQuoteCurrency(quote = {}, symbol = '') {
  const c = String(quote.currency || '').trim().toUpperCase();
  if (c === 'CNY' || c === 'USD' || c === 'HKD') return c;
  const m = String(quote.market || '').trim().toUpperCase();
  if (m === 'HK' || /\.HK$/.test(symbol)) return 'HKD';
  if (m === 'US') return 'USD';
  return 'CNY';
}

export function resolveFxRate(currency, rates) {
  const r = rates && typeof rates === 'object' ? rates : DEFAULT_RATES;
  const c = String(currency || '').trim().toUpperCase();
  if (c === 'HKD') return safeNumber(r.HKD, DEFAULT_RATES.HKD);
  if (c === 'USD') return safeNumber(r.USD, DEFAULT_RATES.USD);
  return 1;
}
