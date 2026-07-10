import { state } from './state.js';
import { computeHoldings, computeIncomeSummary, inferQuote } from './compute.js';
import {
  buildDividendSourceId, formatDateLabel, normalizeQuoteDividendEvent,
  parsePercentOverride, resolveEffectivePayDate, resolveFxRate, resolveQuoteCurrency, safeNumber,
  sanitizeDailySnapshotEntry, sanitizeDividendLedgerEntry, sanitizeYearlyArchiveEntry,
  sanitizeYearlyHoldingsEntry
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
  if (!sourceId) return null;

  const context = getFrozenDividendContext(event.symbol || symbol, event.exDate, event.currency);
  if (!context || context.shares <= 0) return null;

  const grossCny = roundMoney(event.amountPerShare * context.shares * context.fxRate);
  const netCny = roundMoney(grossCny * (1 - context.taxRate));
  const now = new Date().toISOString();
  const idSuffix = sourceId.replace(/[^A-Z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
  // 以有效到账日判断已到账/在途：真实 payDate 优先，缺失时按市场滞后估算（A股≈当天，港股≈数周）。
  const effectivePay = resolveEffectivePayDate(event.exDate, event.payDate, event.symbol || symbol);
  const receiptStatus = isDateOnOrBefore(effectivePay.date || event.exDate, today) ? 'due' : 'pending';

  return sanitizeDividendLedgerEntry({
    id: `div_${idSuffix || Date.now()}`,
    sourceId,
    symbol: event.symbol || symbol,
    exDate: event.exDate,
    payDate: event.payDate || '',
    eventSource: event.source || '',
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

/* 行情后来补出真实派付日时回写同一 sourceId 的自动账本。
   用户手工字段与实际到账信息保持不动；已确认条目只补原本为空的官方 payDate。 */
function updateExistingLedgerEntry(symbol, dividend, today) {
  const event = normalizeQuoteDividendEvent(dividend, symbol);
  if (!event || !isDateOnOrBefore(event.exDate, today) || event.amountPerShare <= 0) return false;
  const sourceId = buildDividendSourceId(event);
  const index = state.dividendLedger.findIndex((entry) => entry && entry.sourceId === sourceId);
  if (index < 0) return false;
  const existing = state.dividendLedger[index];
  const nextPayDate = event.payDate || existing.payDate || '';
  const isUserOwned = existing.confidence === 'manual';
  const effectivePay = resolveEffectivePayDate(existing.exDate, nextPayDate, existing.symbol);
  const nextReceiptStatus = existing.confirmed === true
    ? 'received'
    : (isDateOnOrBefore(effectivePay.date || existing.exDate, today) ? 'due' : 'pending');
  const next = sanitizeDividendLedgerEntry({
    ...existing,
    payDate: isUserOwned ? existing.payDate : nextPayDate,
    eventSource: isUserOwned ? existing.eventSource : (event.source || existing.eventSource || ''),
    receiptStatus: isUserOwned ? existing.receiptStatus : nextReceiptStatus,
    updatedAt: existing.updatedAt
  });
  if (!next) return false;
  const changed = next.payDate !== existing.payDate
    || next.eventSource !== existing.eventSource
    || next.receiptStatus !== existing.receiptStatus;
  if (!changed) return false;
  next.updatedAt = new Date().toISOString();
  state.dividendLedger[index] = next;
  return true;
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
  let updated = 0;
  relevantSymbols.forEach((symbol) => {
    const quote = state.quotes[symbol];
    const dividends = Array.isArray(quote && quote.dividends) ? quote.dividends : [];
    dividends.forEach((dividend) => {
      const event = normalizeQuoteDividendEvent(dividend, symbol);
      const sourceId = event && buildDividendSourceId(event);
      if (sourceId && state.dividendLedger.some((entry) => entry && entry.sourceId === sourceId)) {
        if (updateExistingLedgerEntry(symbol, dividend, today)) updated += 1;
        return;
      }
      const entry = buildLedgerEntry(symbol, dividend, today);
      if (!entry) return;
      state.dividendLedger.push(entry);
      additions.push(entry);
    });
  });
  if (!additions.length && !removed && !updated) return 0;
  state.dividendLedger = state.dividendLedger
    .map(sanitizeDividendLedgerEntry)
    .filter(Boolean)
    .sort((a, b) => `${a.exDate}|${a.symbol}`.localeCompare(`${b.exDate}|${b.symbol}`));
  return additions.length + removed + updated;
}

/* 年度归档与用户覆盖分开保存：归档只冻结自动口径，用户清空覆盖后仍能回到自动结果。 */
function archiveCompletedYears(today) {
  const currentYear = Math.floor(safeNumber(String(today).slice(0, 4), 0));
  if (!currentYear) return false;
  const archivedYears = new Set(state.yearlyArchives.map((entry) => entry.year));
  const additions = [];
  computeIncomeSummary(today, { filterKey: 'all', ignoreManual: true }).trendRows.forEach((row) => {
    if (row.year >= currentYear || archivedYears.has(row.year)) return;
    const hasData = row.dividendCny > 0 || safeNumber(row.yearEndNetCny, 0) > 0 || row.netInflowCny !== 0;
    if (!hasData) return;
    additions.push(sanitizeYearlyArchiveEntry({
      year: row.year,
      dividendCny: row.dividendCny,
      dividendYieldRate: row.dividendYieldRate,
      yearEndNetCny: safeNumber(row.yearEndNetCny, 0),
      netInflowCny: row.netInflowCny,
      capitalReturnCny: row.capitalReturnCny,
      capitalReturnRate: row.capitalReturnRate,
      source: 'auto',
      archivedAt: new Date().toISOString()
    }));
  });
  const validAdditions = additions.filter(Boolean);
  if (!validAdditions.length) return false;
  state.yearlyArchives = state.yearlyArchives.concat(validAdditions).sort((a, b) => b.year - a.year);
  return true;
}

/* 年度持仓快照：当年条目随每次结算覆盖，跨年后即冻结为该年最后一次结算时的持仓。 */
function upsertCurrentYearHoldingsSnapshot(today) {
  const year = Math.floor(safeNumber(String(today).slice(0, 4), 0));
  if (!year) return false;
  const summary = computeHoldings();
  const next = sanitizeYearlyHoldingsEntry({
    year,
    date: today,
    source: 'auto',
    totalMarketValueCny: roundMoney(summary.totalMarketValueCny),
    holdings: summary.holdings
      .filter((item) => safeNumber(item.quantity, 0) > 0)
      .map((item) => ({
        symbol: item.symbol,
        name: item.name,
        shares: safeNumber(item.quantity, 0),
        bucket: item.bucket,
        currency: item.currency,
        price: safeNumber(item.price, 0),
        marketValueCny: roundMoney(item.marketValueCny)
      }))
  });
  if (!next) return false;
  const previous = state.yearlyHoldings.find((entry) => entry && entry.year === year);
  if (previous && JSON.stringify(previous) === JSON.stringify(next)) return false;
  state.yearlyHoldings = state.yearlyHoldings
    .filter((entry) => entry && entry.year !== year)
    .concat(next)
    .sort((a, b) => b.year - a.year);
  return true;
}

/* 功能上线前已结束的年份：用该年最后一天的日快照补出股数；价格按当前行情估算，仅供结构参考。 */
function backfillYearlyHoldingsFromDailySnapshots(currentYear) {
  const existingYears = new Set(state.yearlyHoldings.map((entry) => entry.year));
  const lastByYear = new Map();
  state.dailySnapshots.forEach((snapshot) => {
    const date = formatDateLabel(snapshot && snapshot.date);
    const year = Math.floor(safeNumber(date.slice(0, 4), 0));
    if (!year || year >= currentYear || existingYears.has(year)) return;
    const previous = lastByYear.get(year);
    if (!previous || formatDateLabel(previous.date) < date) lastByYear.set(year, snapshot);
  });
  let changed = false;
  lastByYear.forEach((snapshot, year) => {
    const rates = snapshot.rates && typeof snapshot.rates === 'object' ? snapshot.rates : state.rates;
    const holdings = (Array.isArray(snapshot.holdings) ? snapshot.holdings : [])
      .filter((holding) => holding && safeNumber(holding.shares, 0) > 0)
      .map((holding) => {
        const quote = inferQuote(holding.symbol);
        const currency = resolveQuoteCurrency(quote, holding.symbol);
        const price = safeNumber(quote.price, 0);
        const shares = safeNumber(holding.shares, 0);
        return {
          symbol: holding.symbol,
          name: quote.name || holding.symbol,
          shares,
          bucket: holding.bucket,
          currency,
          price,
          marketValueCny: roundMoney(price * shares * resolveFxRate(currency, rates))
        };
      });
    const entry = sanitizeYearlyHoldingsEntry({
      year,
      date: formatDateLabel(snapshot.date),
      source: 'backfill',
      totalMarketValueCny: roundMoney(holdings.reduce((sum, item) => sum + item.marketValueCny, 0)),
      holdings
    });
    if (!entry) return;
    state.yearlyHoldings = state.yearlyHoldings.concat(entry);
    changed = true;
  });
  if (changed) state.yearlyHoldings = state.yearlyHoldings.slice().sort((a, b) => b.year - a.year);
  return changed;
}

export function settleRevenueData(date = new Date()) {
  const today = formatLocalDate(date);
  const snapshotAdded = ensureTodaySnapshot(today);
  const ledgerAddedCount = generateDividendLedgerEntries(today);
  const yearsArchived = archiveCompletedYears(today);
  const currentYear = Math.floor(safeNumber(today.slice(0, 4), 0));
  const holdingsBackfilled = backfillYearlyHoldingsFromDailySnapshots(currentYear);
  const holdingsSnapshotUpdated = upsertCurrentYearHoldingsSnapshot(today);
  return {
    changed: snapshotAdded || ledgerAddedCount > 0 || yearsArchived || holdingsBackfilled || holdingsSnapshotUpdated,
    snapshotAdded,
    ledgerAddedCount,
    yearsArchived
  };
}
