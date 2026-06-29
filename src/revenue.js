import { state } from './state.js';
import { computeHoldings } from './compute.js';
import {
  buildDividendSourceId, formatDateLabel, normalizeQuoteDividendEvent,
  parsePercentOverride, resolveFxRate, safeNumber,
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
  const receiptStatus = event.payDate && isDateOnOrBefore(event.payDate, today) ? 'received' : 'pending';

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

function generateDividendLedgerEntries(today = formatLocalDate()) {
  const currentSymbols = new Set(state.holdings.map((holding) => holding.symbol).filter(Boolean));
  const additions = [];
  currentSymbols.forEach((symbol) => {
    const quote = state.quotes[symbol];
    const dividends = Array.isArray(quote && quote.dividends) ? quote.dividends : [];
    dividends.forEach((dividend) => {
      const entry = buildLedgerEntry(symbol, dividend, today);
      if (!entry) return;
      state.dividendLedger.push(entry);
      additions.push(entry);
    });
  });
  if (!additions.length) return 0;
  state.dividendLedger = state.dividendLedger
    .map(sanitizeDividendLedgerEntry)
    .filter(Boolean)
    .sort((a, b) => `${a.exDate}|${a.symbol}`.localeCompare(`${b.exDate}|${b.symbol}`));
  return additions.length;
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
