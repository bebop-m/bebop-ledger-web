import { state } from './state.js';
import {
  computeHoldings, computeIncomeSummary, getEffectiveHoldingQuantityAtDate, inferQuote,
  getLedgerCalendarDate, isCashModelActive, normalizeEconomicDividendEntries
} from './compute.js';
import {
  addDaysToDateLabel, buildDividendSourceId, canonicalDividendSourceId, dividendIgnoreKey, formatDateLabel, normalizeQuoteDividendEvent,
  parsePercentOverride, resolveEffectivePayDate, resolveFxRate, roundMoney, safeNumber,
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
    cashCny: isCashModelActive() ? summary.cashBalanceCny : null,
    cashModelActive: isCashModelActive(),
    holdings: summary.holdings.map((holding) => ({
      symbol: holding.symbol,
      shares: Math.max(0, safeNumber(holding.quantity, 0)),
      bucket: holding.bucket === 'income' ? 'income' : 'core',
      taxRate: getHoldingTaxRate(holding)
    }))
  });
}

function ensureTodaySnapshot(today = formatLocalDate()) {
  const snapshot = buildTodaySnapshot(today);
  if (!snapshot || !snapshot.date) return false;
  const previous = state.dailySnapshots.find((entry) => formatDateLabel(entry && entry.date) === today);
  if (previous && JSON.stringify(previous) === JSON.stringify(snapshot)) return false;
  state.dailySnapshots = state.dailySnapshots
    .filter((entry) => formatDateLabel(entry && entry.date) !== today)
    .concat(snapshot)
    .sort((a, b) => formatDateLabel(a.date).localeCompare(formatDateLabel(b.date)));
  return true;
}

function findSnapshotBefore(date) {
  const target = formatDateLabel(date);
  if (!target) return null;
  return state.dailySnapshots
    .filter((snapshot) => snapshot && formatDateLabel(snapshot.date) < target)
    .sort((a, b) => formatDateLabel(b.date).localeCompare(formatDateLabel(a.date)))[0] || null;
}

function findCurrentHolding(symbol) {
  return state.holdings.find((holding) => holding.symbol === symbol) || null;
}

function getFrozenDividendContext(symbol, exDate, currency) {
  // 除息权利在除息日前一交易日收盘冻结；除息日当天的买卖不改变本次股息股数。
  const snapshot = findSnapshotBefore(exDate);
  if (snapshot) {
    const holding = Array.isArray(snapshot.holdings)
      ? snapshot.holdings.find((item) => item && item.symbol === symbol)
      : null;
    let shares = holding ? Math.max(0, safeNumber(holding.shares, 0)) : 0;
    state.trades.forEach((trade) => {
      const tradeDate = formatDateLabel(trade && trade.date);
      if (!trade || trade.symbol !== symbol || tradeDate <= formatDateLabel(snapshot.date) || tradeDate >= exDate) return;
      const delta = Math.max(0, safeNumber(trade.shares, 0));
      shares += trade.side === 'sell' ? -delta : delta;
    });
    return {
      shares: Math.max(0, shares),
      sharesSource: 'snapshotReplay',
      fxRate: resolveFxRate(currency, snapshot.rates),
      taxRate: holding ? Math.min(1, Math.max(0, safeNumber(holding.taxRate, 0))) : 0,
      bucket: holding && holding.bucket === 'income' ? 'income' : 'core',
      confidence: addDaysToDateLabel(snapshot.date, 1) === formatDateLabel(exDate) ? 'snapshot' : 'replayed'
    };
  }

  const currentHolding = findCurrentHolding(symbol);
  const openingDate = formatDateLabel(state.positionOpeningDate);
  if (!currentHolding || !openingDate || exDate < openingDate) return null;
  return {
    shares: getEffectiveHoldingQuantityAtDate(symbol, addDaysToDateLabel(exDate, -1)),
    sharesSource: 'positionLedger',
    fxRate: resolveFxRate(currency, state.rates),
    taxRate: getHoldingTaxRate(currentHolding),
    bucket: currentHolding.bucket === 'income' ? 'income' : 'core',
    confidence: 'replayed'
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
  const canonicalId = canonicalDividendSourceId(buildDividendSourceId(event));
  const index = state.dividendLedger.findIndex((entry) => entry && canonicalDividendSourceId(entry.sourceId) === canonicalId);
  if (index < 0) return false;
  const existing = state.dividendLedger[index];
  const nextPayDate = event.payDate || existing.payDate || '';
  const isUserOwned = existing.confidence === 'manual' || existing.payDateSource === 'manual';
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
      ids.add(canonicalDividendSourceId(event.sourceId));
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
    if (valid.ids.has(canonicalDividendSourceId(entry.sourceId))) return true; // 与当前派息事件匹配 → 保留
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
  const ignored = new Set((Array.isArray(state.dividendLedgerIgnored) ? state.dividendLedgerIgnored : [])
    .map(dividendIgnoreKey));
  const removed = reconcileDividendLedger();
  const additions = [];
  let updated = 0;
  relevantSymbols.forEach((symbol) => {
    const quote = state.quotes[symbol];
    const dividends = Array.isArray(quote && quote.dividends) ? quote.dividends : [];
    const candidates = [];
    dividends.forEach((dividend) => {
      const event = normalizeQuoteDividendEvent(dividend, symbol);
      const sourceId = event && buildDividendSourceId(event);
      // 用户手动删除过的派息事件不再重建。
      if (sourceId && ignored.has(dividendIgnoreKey(sourceId))) return;
      /* 比对一律走 canonical：台账里可能混有结算脚本写的 "1.0" 和前端写的 "1"，
         按原字符串比会认不出同一笔派息，于是再追加一条，造成重复计账。 */
      const canonicalId = sourceId ? canonicalDividendSourceId(sourceId) : '';
      if (canonicalId && state.dividendLedger.some((entry) => entry && canonicalDividendSourceId(entry.sourceId) === canonicalId)) {
        if (updateExistingLedgerEntry(symbol, dividend, today)) updated += 1;
        return;
      }
      const entry = buildLedgerEntry(symbol, dividend, today);
      if (!entry) return;
      candidates.push(entry);
    });
    normalizeEconomicDividendEntries(candidates).forEach((entry) => {
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
export function archiveCompletedYears(today) {
  const currentYear = Math.floor(safeNumber(String(today).slice(0, 4), 0));
  if (!currentYear) return false;
  const archivedAt = new Date().toISOString();
  const existingByYear = new Map(state.yearlyArchives.map((entry) => [entry.year, entry]));
  const rowByYear = new Map(computeIncomeSummary(today, {
    filterKey: 'all', ignoreManual: true, ignoreArchive: true
  }).trendRows.map((row) => [row.year, row]));
  const ledgerYears = new Set(normalizeEconomicDividendEntries(state.dividendLedger)
    .map((entry) => Math.floor(safeNumber(getLedgerCalendarDate(entry).date.slice(0, 4), 0))).filter(Boolean));
  const tombstonedSources = new Set(state.dividendLedgerTombstones.map((item) => String(item && item.sourceId || '')));
  const ignoredYears = new Set([
    ...state.dividendLedgerTombstones
      .map((item) => Math.floor(safeNumber(formatDateLabel(item && item.incomeDate).slice(0, 4), 0))).filter(Boolean),
    ...state.dividendLedgerIgnored
      .filter((sourceId) => !tombstonedSources.has(String(sourceId || '')))
      .map((sourceId) => Math.floor(safeNumber(String(sourceId || '').split('|')[1]?.slice(0, 4), 0))).filter(Boolean)
  ]);
  const cashFlowYears = new Set(state.cashFlows
    .map((entry) => Math.floor(safeNumber(formatDateLabel(entry && entry.date).slice(0, 4), 0))).filter(Boolean));
  const snapshotYears = new Set(state.dailySnapshots
    .map((entry) => Math.floor(safeNumber(formatDateLabel(entry && entry.date).slice(0, 4), 0))).filter(Boolean));
  const years = new Set([...existingByYear.keys(), ...rowByYear.keys()]);
  const rebuilt = [];
  years.forEach((year) => {
    if (year >= currentYear) return;
    const row = rowByYear.get(year) || null;
    const previous = existingByYear.get(year) || null;
    const dividendHasSource = ledgerYears.has(year) || ignoredYears.has(year);
    const dividendCny = dividendHasSource ? safeNumber(row && row.dividendCny, 0)
      : (previous && previous.dividendCny !== null ? previous.dividendCny : safeNumber(row && row.dividendCny, 0));
    const yearEndNetCny = snapshotYears.has(year) ? row && row.yearEndNetCny
      : (previous && previous.yearEndNetCny !== null ? previous.yearEndNetCny : row && row.yearEndNetCny);
    const netInflowCny = cashFlowYears.has(year) ? safeNumber(row && row.netInflowCny, 0)
      : (previous && previous.netInflowCny !== null ? previous.netInflowCny : safeNumber(row && row.netInflowCny, 0));
    const capitalHasSource = row && row.fieldSources && row.fieldSources.capitalReturnCny === 'netValueChain';
    const capitalReturnCny = capitalHasSource ? row.capitalReturnCny
      : (previous && previous.capitalReturnCny !== null ? previous.capitalReturnCny : row && row.capitalReturnCny);
    const capitalReturnRate = capitalHasSource ? row.capitalReturnRate
      : (previous && previous.capitalReturnRate !== null ? previous.capitalReturnRate : row && row.capitalReturnRate);
    const dividendYieldRate = dividendHasSource && row ? row.dividendYieldRate
      : (previous && previous.dividendYieldRate !== null ? previous.dividendYieldRate : row && row.dividendYieldRate);
    const hasData = dividendCny > 0 || yearEndNetCny !== null && yearEndNetCny !== undefined || netInflowCny !== 0;
    if (!hasData) return;
    const candidate = sanitizeYearlyArchiveEntry({
      year,
      dividendCny,
      dividendYieldRate,
      yearEndNetCny,
      netInflowCny,
      capitalReturnCny,
      capitalReturnRate,
      source: 'auto',
      archivedAt: previous && previous.archivedAt || archivedAt
    });
    if (candidate) rebuilt.push(candidate);
  });
  const next = rebuilt.filter(Boolean).sort((a, b) => b.year - a.year);
  if (JSON.stringify(next) === JSON.stringify(state.yearlyArchives)) return false;
  state.yearlyArchives = next;
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

/* 旧版曾用“今天的价格 × 历史股数”伪造历史年末持仓市值；这会随当前行情改写过去。
   无历史价格时不生成金额快照，并清除这种旧的 backfill 条目。 */
function removeUnsafeYearlyHoldingsBackfills() {
  const next = state.yearlyHoldings.filter((entry) => entry && entry.source !== 'backfill');
  if (next.length === state.yearlyHoldings.length) return false;
  state.yearlyHoldings = next;
  return true;
}

export function settleRevenueData(date = new Date()) {
  const today = formatLocalDate(date);
  const snapshotAdded = ensureTodaySnapshot(today);
  const ledgerAddedCount = generateDividendLedgerEntries(today);
  const yearsArchived = archiveCompletedYears(today);
  const holdingsBackfilled = removeUnsafeYearlyHoldingsBackfills();
  const holdingsSnapshotUpdated = upsertCurrentYearHoldingsSnapshot(today);
  return {
    changed: snapshotAdded || ledgerAddedCount > 0 || yearsArchived || holdingsBackfilled || holdingsSnapshotUpdated,
    snapshotAdded,
    ledgerAddedCount,
    yearsArchived
  };
}
