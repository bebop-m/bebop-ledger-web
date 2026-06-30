import { state } from './state.js';
import { computeHoldings } from './compute.js';
import {
  buildDividendSourceId, formatDateLabel, normalizeQuoteDividendEvent,
  parsePercentOverride, resolveEffectivePayDate, resolveFxRate, safeNumber,
  sanitizeDailySnapshotEntry, sanitizeDividendLedgerEntry
} from './utils.js';

function formatLocalDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function isDateOnOrBefore(value, limit) {
  const date = formatDateLabel(value);
  return Boolean(date && limit && date <= limit);
}

function roundMoney(value) {
  return Math.round((safeNumber(value, 0) + Number.EPSILON) * 100) / 100;
}

function getHoldingTaxRate(holding) {
  const taxOverridePercent = parsePercentOverride(holding && holding.taxRateOverride);
  return taxOverridePercent === null ? 0 : taxOverridePercent / 100;
}

function buildTodaySnapshot(today = formatLocalDate()) {
  const summary = computeHoldings();
  return sanitizeDailySnapshotEntry({
    date: today,
    rates: { CNY: 1, USD: state.rates.USD, HKD: state.rates.HKD },
    netCny: summary.netMarketValueCny,
    totalMarketValueCny: summary.totalMarketValueCny,
    liabilityCny: state.liabilityCny,
    holdings: state.holdings.map((holding) => ({
      symbol: holding.symbol,
      shares: Math.max(0, safeNumber(holding.quantity, 0)),
      bucket: holding.bucket === 'income' ? 'income' : 'core',
      taxRate: getHoldingTaxRate(holding)
    }))
  });
}

function ensureTodaySnapshot(today = formatLocalDate()) {
  if (state.dailySnapshots.some((snapshot) => formatDateLabel(snapshot && snapshot.date) === today)) {
    return false;
  }
  const snapshot = buildTodaySnapshot(today);
  if (!snapshot || !snapshot.date) return false;
  state.dailySnapshots = [...state.dailySnapshots, snapshot]
    .sort((a, b) => formatDateLabel(a.date).localeCompare(formatDateLabel(b.date)));
  return true;
}

function findSnapshotOnOrBefore(date) {
  const target = formatDateLabel(date);
  if (!target) return null;
  return state.dailySnapshots
    .filter((snapshot) => snapshot && formatDateLabel(snapshot.date) <= target)
    .sort((a, b) => formatDateLabel(b.date).localeCompare(formatDateLabel(a.date)))[0] || null;
}

function findCurrentHolding(symbol) {
  return state.holdings.find((holding) => holding.symbol === symbol) || null;
}

function getFrozenDividendContext(symbol, exDate, currency) {
  const snapshot = findSnapshotOnOrBefore(exDate);
  if (snapshot) {
    const holding = Array.isArray(snapshot.holdings)
      ? snapshot.holdings.find((item) => item && item.symbol === symbol)
      : null;
    return {
      shares: holding ? Math.max(0, safeNumber(holding.shares, 0)) : 0,
      sharesSource: 'snapshot',
      fxRate: resolveFxRate(currency, snapshot.rates),
      taxRate: holding ? Math.max(0, safeNumber(holding.taxRate, 0)) : 0,
      bucket: holding && holding.bucket === 'income' ? 'income' : 'core',
      confidence: formatDateLabel(snapshot.date) === formatDateLabel(exDate) ? 'snapshot' : 'carryForward'
    };
  }

  const currentHolding = findCurrentHolding(symbol);
  if (!currentHolding) return null;
  return {
    shares: Math.max(0, safeNumber(currentHolding.quantity, 0)),
    sharesSource: 'current',
    fxRate: resolveFxRate(currency, state.rates),
    taxRate: getHoldingTaxRate(currentHolding),
    bucket: currentHolding.bucket === 'income' ? 'income' : 'core',
    confidence: 'estimated'
  };
}

function buildLedgerEntry(symbol, dividend, today) {
  const event = normalizeQuoteDividendEvent(dividend, symbol);
  if (!event || !isDateOnOrBefore(event.exDate, today) || event.amountPerShare <= 0) return null;

  const sourceId = buildDividendSourceId(event);
  if (!sourceId || state.dividendLedger.some((entry) => entry && entry.sourceId === sourceId)) return null;

  const context = getFrozenDividendContext(event.symbol || symbol, event.exDate, event.currency);
  if (!context || context.shares <= 0) return null;

  const grossCny = roundMoney(event.amountPerShare * context.shares * context.fxRate);
  const netCny = roundMoney(grossCny * (1 - context.taxRate));
  const now = new Date().toISOString();
  const idSuffix = sourceId.replace(/[^A-Z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
  // 以有效到账日判断已到账/在途：真实 payDate 优先，缺失时按市场滞后估算（A股≈当天，港股≈数周）。
  const effectivePay = resolveEffectivePayDate(event.exDate, event.payDate, event.symbol || symbol);
  const receiptStatus = isDateOnOrBefore(effectivePay.date || event.exDate, today) ? 'received' : 'pending';

  return sanitizeDividendLedgerEntry({
    id: `div_${idSuffix || Date.now()}`,
    sourceId,
    symbol: event.symbol || symbol,
    exDate: event.exDate,
    payDate: event.payDate || '',
    amountPerShare: event.amountPerShare,
    currency: event.currency,
    shares: context.shares,
    sharesSource: context.sharesSource,
    fxRate: context.fxRate,
    taxRate: context.taxRate,
    grossCny,
    netCny,
    bucket: context.bucket,
    receiptStatus,
    confidence: context.confidence,
    confirmed: false,
    note: '',
    createdAt: now,
    updatedAt: now
  });
}

// 对账：清理已不匹配当前行情派息事件的「自动」条目。
// yfinance 偶尔修订同一笔派息（除息日漂移、金额精度变化），会产生新 sourceId 的新条目，
// 旧条目若不清理就会在同一月留下重复。用户确认/手动条目、以及早于行情覆盖区间的历史条目永不清理。
function reconcileDividendLedger() {
  const validBySymbol = new Map();
  Object.entries(state.quotes).forEach(([symbol, quote]) => {
    const dividends = Array.isArray(quote && quote.dividends) ? quote.dividends : [];
    if (!dividends.length) return;
    const ids = new Set();
    let minExDate = '';
    dividends.forEach((dividend) => {
      const event = normalizeQuoteDividendEvent(dividend, symbol);
      if (!event || !event.sourceId) return;
      ids.add(event.sourceId);
      if (event.exDate && (!minExDate || event.exDate < minExDate)) minExDate = event.exDate;
    });
    if (ids.size) validBySymbol.set(symbol, { ids, minExDate });
  });

  const before = state.dividendLedger.length;
  state.dividendLedger = state.dividendLedger.filter((entry) => {
    if (!entry) return false;
    if (entry.confirmed === true || entry.sharesSource === 'manual' || entry.confidence === 'manual') return true;
    const valid = validBySymbol.get(entry.symbol);
    if (!valid) return true;                          // 该 symbol 当前无行情派息数据（可能已离开行情）→ 保留
    if (valid.ids.has(entry.sourceId)) return true;   // 与当前派息事件匹配 → 保留
    if (entry.exDate && valid.minExDate && entry.exDate < valid.minExDate) return true; // 早于覆盖区间，无法核对 → 保留
    return false;                                     // 在覆盖区间内却无匹配 → 旧的被修订数据，清理
  });
  return before - state.dividendLedger.length;
}

function generateDividendLedgerEntries(today = formatLocalDate()) {
  // 包含当前持仓 + 历史快照中曾经持有过的 symbol，避免已清仓持仓的派息被漏记（打工仓常见）。
  const relevantSymbols = new Set(state.holdings.map((holding) => holding.symbol).filter(Boolean));
  state.dailySnapshots.forEach((snapshot) => {
    const holdings = Array.isArray(snapshot && snapshot.holdings) ? snapshot.holdings : [];
    holdings.forEach((holding) => {
      if (holding && holding.symbol && safeNumber(holding.shares, 0) > 0) relevantSymbols.add(holding.symbol);
    });
  });
  const removed = reconcileDividendLedger();
  const additions = [];
  relevantSymbols.forEach((symbol) => {
    const quote = state.quotes[symbol];
    const dividends = Array.isArray(quote && quote.dividends) ? quote.dividends : [];
    dividends.forEach((dividend) => {
      const entry = buildLedgerEntry(symbol, dividend, today);
      if (!entry) return;
      state.dividendLedger.push(entry);
      additions.push(entry);
    });
  });
  if (!additions.length && !removed) return 0;
  state.dividendLedger = state.dividendLedger
    .map(sanitizeDividendLedgerEntry)
    .filter(Boolean)
    .sort((a, b) => `${a.exDate}|${a.symbol}`.localeCompare(`${b.exDate}|${b.symbol}`));
  return additions.length + removed;
}

export function settleRevenueData(date = new Date()) {
  const today = formatLocalDate(date);
  const snapshotAdded = ensureTodaySnapshot(today);
  const ledgerAddedCount = generateDividendLedgerEntries(today);
  return {
    changed: snapshotAdded || ledgerAddedCount > 0,
    snapshotAdded,
    ledgerAddedCount
  };
}
