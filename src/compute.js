import { state, DEFAULT_QUOTES, invalidateComputeCache, getComputeCache, setComputeCache } from './state.js';
import {
  safeNumber, inferQuoteFromMap, resolveQuoteCurrency, resolveFxRate,
  parsePercentOverride, resolveManualDividendPerShareOverride,
  normalizeDividendSource, normalizeDividendStatus, formatDateLabel,
  buildDividendSourceId, resolveEffectivePayDate
} from './utils.js';
import { COMPANY_COLORS, BUCKET_COLORS, LABELS, DIVIDEND_FILTER_KEYS, INCOME_START_YEAR } from './constants.js';

export function inferQuote(symbol) {
  return inferQuoteFromMap(symbol, state.quotes, DEFAULT_QUOTES);
}

// 现金余额模式是否启用：填过期初日期即启用；否则完全按旧行为（无现金、数量可直接改）。
export function isCashModelActive() {
  return Boolean(state.openingDate);
}

// 期初日之后的事件才计入现金/持仓推算（期初日之前的已经包含在期初值里）。
function isOnOrAfterOpening(dateValue) {
  if (!state.openingDate) return true;
  const label = formatDateLabel(dateValue);
  return label ? label >= state.openingDate : false;
}

// 每只股票在期初日之后的买卖净股数（买 +、卖 −）。
function getNetTradeSharesBySymbol() {
  const map = new Map();
  if (!isCashModelActive()) return map;
  state.trades.forEach((trade) => {
    if (!trade || !isOnOrAfterOpening(trade.date)) return;
    const shares = Math.max(0, safeNumber(trade.shares, 0));
    const delta = trade.side === 'sell' ? -shares : shares;
    map.set(trade.symbol, safeNumber(map.get(trade.symbol), 0) + delta);
  });
  return map;
}

/* 现金余额 = 期初现金 + 入金 − 出金 + 卖出所得 − 买入花费 + 已到账股息。
   全部按期初日之后的记录推算，未启用现金模式时恒为 0。 */
export function computeCashBalance() {
  if (!isCashModelActive()) return 0;
  let cash = safeNumber(state.openingCashCny, 0);
  state.cashFlows.forEach((entry) => {
    if (entry && isOnOrAfterOpening(entry.date)) cash += getCashFlowNetAmount(entry);
  });
  state.trades.forEach((trade) => {
    if (!trade || !isOnOrAfterOpening(trade.date)) return;
    const value = getTradeValueCny(trade);
    const fee = Math.max(0, safeNumber(trade.feeCny, 0));
    cash += trade.side === 'sell' ? (value - fee) : -(value + fee);
  });
  state.dividendLedger.forEach((entry) => {
    const received = entry && (entry.confirmed === true || entry.confidence === 'manual');
    if (!received) return;
    const payDate = getLedgerCalendarDate(entry).date || (entry && entry.exDate);
    if (isOnOrAfterOpening(payDate)) cash += getLedgerNetCny(entry);
  });
  return roundMoney(cash);
}

export function computeHoldings() {
  const cached = getComputeCache();
  if (cached) return cached;

  const netTradeShares = getNetTradeSharesBySymbol();
  const holdings = state.holdings.map((holding) => {
    const quote = inferQuote(holding.symbol);
    // 现金模式下有效股数 = 期初股数 + 期初日之后的买卖净额；否则就是持仓数量本身。
    const quantity = Math.max(0, safeNumber(holding.quantity, 0) + safeNumber(netTradeShares.get(holding.symbol), 0));
    const price = safeNumber(quote.price, 0);
    const currency = resolveQuoteCurrency(quote, holding.symbol);
    const fxRate = resolveFxRate(currency, state.rates);
    const taxOverridePercent = parsePercentOverride(holding.taxRateOverride);
    const dividendPerShareOverride = resolveManualDividendPerShareOverride(
      holding.dividendPerShareTtmOverride, holding.dividendPerShareTtmOverrideTouched === true
    );
    const effectiveTax = taxOverridePercent === null ? 0 : taxOverridePercent / 100;
    const baseDps = Math.max(0, safeNumber(quote.dividendPerShareTtm, 0));
    const effectiveDps = dividendPerShareOverride === null ? baseDps : dividendPerShareOverride;
    const currentYield = price > 0 ? effectiveDps / price : 0;
    const marketValueCny = price * quantity * fxRate;
    const grossDividendCny = effectiveDps * quantity * fxRate;
    const netAnnualDividendCny = grossDividendCny * (1 - effectiveTax);
    const dividendSource = dividendPerShareOverride === null
      ? normalizeDividendSource(quote.dividendSource, 'cache') : 'manual';
    const dividendStatus = dividendPerShareOverride === null
      ? normalizeDividendStatus(quote.dividendStatus, effectiveDps > 0 ? (dividendSource === 'cache' ? 'stale' : 'fresh') : 'missing')
      : 'manual';
    const previousClose = safeNumber(quote.previousClose, 0);
    const dailyPnlCny = previousClose > 0 ? (price - previousClose) * quantity * fxRate : 0;
    return {
      ...holding, ...quote, currency, quantity, fxRate, dividendSource, dividendStatus,
      effectiveDividendPerShareTtm: effectiveDps, currentYield, effectiveYield: currentYield,
      marketValueCny, grossAnnualDividendCny: grossDividendCny, netAnnualDividendCny,
      annualDividendCny: netAnnualDividendCny, dailyPnlCny
    };
  });

  holdings.sort((a, b) => {
    const av = safeNumber(a[state.sortField], 0);
    const bv = safeNumber(b[state.sortField], 0);
    if (av === bv) return safeNumber(b.marketValueCny, 0) - safeNumber(a.marketValueCny, 0);
    return state.sortDirection === 'asc' ? av - bv : bv - av;
  });

  const totalMarketValueCny = holdings.reduce((s, i) => s + safeNumber(i.marketValueCny, 0), 0);
  const totalDividendCny = holdings.reduce((s, i) => s + safeNumber(i.netAnnualDividendCny, 0), 0);
  const totalDailyPnlCny = holdings.reduce((s, i) => s + safeNumber(i.dailyPnlCny, 0), 0);
  const divisor = totalMarketValueCny || 1;
  const cashBalanceCny = computeCashBalance();
  const result = {
    holdings: holdings.map((i) => ({ ...i, holdingWeight: safeNumber(i.marketValueCny, 0) / divisor })),
    totalMarketValueCny, totalDividendCny, totalDailyPnlCny,
    cashBalanceCny,
    totalAssetCny: totalMarketValueCny + cashBalanceCny,
    netMarketValueCny: totalMarketValueCny + cashBalanceCny - state.liabilityCny
  };
  setComputeCache(result);
  return result;
}

export function getCompanySegments(holdings) {
  return holdings.filter((i) => safeNumber(i.marketValueCny, 0) > 0)
    .sort((a, b) => safeNumber(b.marketValueCny, 0) - safeNumber(a.marketValueCny, 0))
    .map((item, index) => ({
      key: String(item.localId), label: item.name,
      value: safeNumber(item.marketValueCny, 0),
      color: COMPANY_COLORS[index % COMPANY_COLORS.length]
    }));
}

export function getBucketSegments(holdings) {
  const totals = { core: 0, income: 0 };
  holdings.forEach((i) => { totals[i.bucket] += safeNumber(i.marketValueCny, 0); });
  const sum = totals.core + totals.income || 1;
  return [
    { key: 'core', label: LABELS.core, value: totals.core, percent: totals.core / sum, color: BUCKET_COLORS.core },
    { key: 'income', label: LABELS.income, value: totals.income, percent: totals.income / sum, color: BUCKET_COLORS.income }
  ].filter((i) => i.value > 0);
}

export function getBucketSummaryItems(holdings) {
  const groups = {
    core: { key: 'core', label: LABELS.core, color: BUCKET_COLORS.core, marketValueCny: 0, totalDividendCny: 0 },
    income: { key: 'income', label: LABELS.income, color: BUCKET_COLORS.income, marketValueCny: 0, totalDividendCny: 0 }
  };
  holdings.forEach((i) => {
    const k = i.bucket === 'income' ? 'income' : 'core';
    groups[k].marketValueCny += safeNumber(i.marketValueCny, 0);
    groups[k].totalDividendCny += safeNumber(i.netAnnualDividendCny, 0);
  });
  return Object.values(groups)
    .map((i) => ({ ...i, averageYield: i.marketValueCny > 0 ? i.totalDividendCny / i.marketValueCny : 0 }))
    .filter((i) => i.marketValueCny > 0);
}

function formatLocalDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getDateParts(value) {
  const label = formatDateLabel(value);
  const match = label.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return {
    label,
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
}

function formatDateParts(year, month, day) {
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function roundMoney(value) {
  return Math.round((safeNumber(value, 0) + Number.EPSILON) * 100) / 100;
}

function roundQuantity(value) {
  return Math.round((safeNumber(value, 0) + Number.EPSILON) * 1000000) / 1000000;
}

function getDividendFilterKey() {
  return DIVIDEND_FILTER_KEYS.has(state.dividendCalendarBucket) ? state.dividendCalendarBucket : 'all';
}

function matchesDividendFilter(item, filterKey) {
  return filterKey === 'all' || item.bucket === filterKey;
}

function getLedgerNetCny(entry) {
  const net = safeNumber(entry && entry.netCny, 0);
  if (net > 0) return net;
  const gross = safeNumber(entry && entry.grossCny, 0)
    || safeNumber(entry && entry.amountPerShare, 0) * safeNumber(entry && entry.shares, 0) * safeNumber(entry && entry.fxRate, 1);
  return roundMoney(gross * (1 - Math.max(0, safeNumber(entry && entry.taxRate, 0))));
}

function getHoldingTaxRate(holding) {
  const taxOverridePercent = parsePercentOverride(holding && holding.taxRateOverride);
  return taxOverridePercent === null ? 0 : taxOverridePercent / 100;
}

/* 账本条目的有效到账日（真实 payDate 优先，否则按市场估算）。所有归月/归年/到账判断统一以此为准。 */
function getLedgerEffectivePayDate(entry) {
  return resolveEffectivePayDate(entry && entry.exDate, entry && entry.payDate, entry && entry.symbol);
}

function getLedgerCalendarDate(entry) {
  const receivedDate = formatDateLabel(entry && entry.receivedDate);
  if (receivedDate) return { date: receivedDate, source: 'received', estimated: false };
  return getLedgerEffectivePayDate(entry);
}

function buildLedgerDividendEntry(entry, year, todayLabel) {
  const exParts = getDateParts(entry && entry.exDate);
  if (!exParts) return null;
  const effectivePay = getLedgerCalendarDate(entry);
  const payParts = getDateParts(effectivePay.date) || exParts;
  if (payParts.year !== year) return null;
  const quote = inferQuote(entry.symbol);
  // 「已到账」只认用户明确处理过的条目：标记已到账(confirmed) 或 修改过实收金额(confidence==='manual')。
  // 仅仅预计到账日已过、但用户没确认也没改金额的，不算已到账，归为待确认(due)。
  const isReceived = entry.confirmed === true || entry.confidence === 'manual';
  const isDue = !isReceived && payParts.label <= todayLabel;
  const netCny = getLedgerNetCny(entry);
  return {
    id: entry.id || entry.sourceId || buildDividendSourceId(entry),
    sourceId: entry.sourceId || buildDividendSourceId(entry),
    symbol: entry.symbol,
    name: quote.name || entry.symbol,
    exDate: exParts.label,
    payDate: payParts.label,
    officialPayDate: formatDateLabel(entry.payDate),
    receivedDate: formatDateLabel(entry.receivedDate),
    payDateEstimated: effectivePay.estimated,
    month: payParts.month,
    amountPerShare: safeNumber(entry.amountPerShare, 0),
    currency: entry.currency || resolveQuoteCurrency(quote, entry.symbol),
    shares: safeNumber(entry.shares, 0),
    sharesSource: entry.sharesSource || 'manual',
    netCny,
    bucket: entry.bucket === 'income' ? 'income' : 'core',
    status: isReceived ? 'received' : (isDue ? 'due' : 'pending'),
    receiptStatus: isReceived ? 'received' : (isDue ? 'due' : 'pending'),
    confidence: entry.confidence || (isReceived ? 'confirmed' : 'estimated'),
    confirmed: entry.confirmed === true,
    isDue,
    note: typeof entry.note === 'string' ? entry.note : '',
    isForecast: false
  };
}

// 返回 todayLabel 往前约 13 个月的日期串，作为节奏预估的历史窗口。
function getForecastCutoffLabel(todayLabel) {
  const p = getDateParts(todayLabel);
  if (!p) return '';
  const d = new Date(p.year, p.month - 1, p.day);
  d.setMonth(d.getMonth() - 13);
  return formatDateParts(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function isAnnouncedDividendEvent(dividend) {
  return String(dividend && dividend.status || '').trim().toLowerCase() === 'announced';
}

function buildAnnouncedDividendEntries(summary, year, todayLabel) {
  const candidates = new Map();

  summary.holdings.forEach((holding) => {
    const quote = state.quotes[holding.symbol] || {};
    const dividends = Array.isArray(quote.dividends) ? quote.dividends : [];
    dividends.forEach((dividend) => {
      if (!isAnnouncedDividendEvent(dividend)) return;
      const exParts = getDateParts(dividend && dividend.exDate);
      const amountPerShare = safeNumber(dividend && dividend.amountPerShare, 0);
      const shares = safeNumber(holding.quantity, 0);
      if (!exParts || exParts.label <= todayLabel || amountPerShare <= 0 || shares <= 0) return;

      const currency = dividend.currency || resolveQuoteCurrency(quote, holding.symbol);
      const effectivePay = resolveEffectivePayDate(exParts.label, dividend.payDate, holding.symbol);
      const payDate = effectivePay.date || exParts.label;
      if (payDate <= todayLabel) return;
      const payParts = getDateParts(payDate);
      if (!payParts || payParts.year !== year) return;

      const key = `${holding.symbol}|${payParts.month}|${exParts.label}|${amountPerShare}|${currency}`;
      if (candidates.has(key)) return;
      candidates.set(key, {
        holding, quote, dividend, exDate: exParts.label, payDate,
        month: payParts.month, payDateEstimated: effectivePay.estimated,
        amountPerShare, currency,
        sourceId: dividend.sourceId || buildDividendSourceId({
          symbol: holding.symbol, exDate: exParts.label, amountPerShare, currency
        })
      });
    });
  });

  return Array.from(candidates.values())
    .map((item) => {
      const fxRate = resolveFxRate(item.currency, state.rates);
      const shares = safeNumber(item.holding.quantity, 0);
      const taxRate = getHoldingTaxRate(item.holding);
      const grossCny = roundMoney(item.amountPerShare * shares * fxRate);
      const netCny = roundMoney(grossCny * (1 - taxRate));
      return {
        id: `announced_${item.sourceId.replace(/[^A-Z0-9]+/gi, '_')}`,
        sourceId: item.sourceId,
        symbol: item.holding.symbol,
        name: item.holding.name || item.quote.name || item.holding.symbol,
        exDate: item.exDate,
        payDate: item.payDate,
        payDateEstimated: item.payDateEstimated,
        month: item.month,
        amountPerShare: item.amountPerShare,
        currency: item.currency,
        shares,
        sharesSource: 'current',
        netCny,
        bucket: item.holding.bucket === 'income' ? 'income' : 'core',
        status: 'announced',
        receiptStatus: 'announced',
        confidence: item.dividend.tentative ? 'estimated' : 'snapshot',
        confirmed: false,
        isAnnounced: true,
        isForecast: false,
        announceDate: item.dividend.announceDate || '',
        tentative: item.dividend.tentative === true
      };
    })
    .filter((entry) => entry.month >= 1 && entry.month <= 12 && entry.netCny > 0)
    .sort((a, b) => `${a.payDate}|${a.symbol}`.localeCompare(`${b.payDate}|${b.symbol}`));
}

function buildForecastDividendEntries(summary, year, todayLabel, blockingEntries) {
  // 同一 (symbol, 到账月) 已有真实账本或已公告条目时跳过预估，避免重复计数。
  const blockedMonthKeys = new Set(blockingEntries.map((entry) => `${entry.symbol}|${entry.month}`));
  // 只用最近 ~13 个月的历史做基准：否则多年历史会把同一笔年度股息（除息日逐年漂移）投影成多条重复。
  const cutoff = getForecastCutoffLabel(todayLabel);
  // 每个 (symbol, 到账月) 只保留一条预估，取最近一次历史派息。
  const candidates = new Map();

  summary.holdings.forEach((holding) => {
    const quote = state.quotes[holding.symbol] || {};
    const dividends = Array.isArray(quote.dividends) ? quote.dividends : [];
    dividends.forEach((dividend) => {
      const parts = getDateParts(dividend && dividend.exDate);
      if (!parts || parts.year >= year) return;
      if (cutoff && parts.label < cutoff) return;
      const amountPerShare = safeNumber(dividend.amountPerShare, 0);
      if (amountPerShare <= 0 || safeNumber(holding.quantity, 0) <= 0) return;
      const forecastExDate = formatDateParts(year, parts.month, parts.day);
      if (!forecastExDate) return;
      const currency = dividend.currency || resolveQuoteCurrency(quote, holding.symbol);
      const forecastPay = resolveEffectivePayDate(forecastExDate, '', holding.symbol);
      const forecastPayDate = forecastPay.date || forecastExDate;
      if (forecastPayDate <= todayLabel) return;
      const payParts = getDateParts(forecastPayDate);
      if (!payParts || payParts.year !== year) return;
      if (blockedMonthKeys.has(`${holding.symbol}|${payParts.month}`)) return;
      const key = `${holding.symbol}|${payParts.month}`;
      const prev = candidates.get(key);
      if (prev && prev.historyDate >= parts.label) return;
      candidates.set(key, {
        holding, quote, forecastExDate, forecastPayDate,
        forecastPayMonth: payParts.month, payDateEstimated: forecastPay.estimated,
        amountPerShare, currency, historyDate: parts.label,
        sourceId: buildDividendSourceId({ symbol: holding.symbol, exDate: forecastExDate, amountPerShare, currency })
      });
    });
  });

  return Array.from(candidates.values())
    .map((item) => {
      const fxRate = resolveFxRate(item.currency, state.rates);
      const shares = safeNumber(item.holding.quantity, 0);
      const taxRate = getHoldingTaxRate(item.holding);
      const grossCny = roundMoney(item.amountPerShare * shares * fxRate);
      const netCny = roundMoney(grossCny * (1 - taxRate));
      return {
        id: `forecast_${item.sourceId.replace(/[^A-Z0-9]+/gi, '_')}`,
        sourceId: item.sourceId,
        symbol: item.holding.symbol,
        name: item.holding.name || item.quote.name || item.holding.symbol,
        exDate: item.forecastExDate,
        payDate: item.forecastPayDate,
        payDateEstimated: item.payDateEstimated,
        month: item.forecastPayMonth,
        amountPerShare: item.amountPerShare,
        currency: item.currency,
        shares,
        sharesSource: 'current',
        netCny,
        bucket: item.holding.bucket === 'income' ? 'income' : 'core',
        status: 'forecast',
        receiptStatus: 'forecast',
        confidence: 'estimated',
        isForecast: true
      };
    })
    .filter((entry) => entry.month >= 1 && entry.month <= 12 && entry.netCny > 0)
    .sort((a, b) => `${a.exDate}|${a.symbol}`.localeCompare(`${b.exDate}|${b.symbol}`));
}

function buildDividendMonthItems(entries, currentMonth) {
  const months = Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    label: `${index + 1}\u6708`,
    receivedCny: 0,
    pendingCny: 0,
    dueCny: 0,
    announcedCny: 0,
    forecastCny: 0,
    totalCny: 0
  }));
  entries.forEach((entry) => {
    const item = months[entry.month - 1];
    if (!item) return;
    if (entry.status === 'received') item.receivedCny += entry.netCny;
    else if (entry.status === 'pending') item.pendingCny += entry.netCny;
    else if (entry.status === 'due') item.dueCny += entry.netCny;
    else if (entry.status === 'announced') item.announcedCny += entry.netCny;
    else item.forecastCny += entry.netCny;
    item.totalCny += entry.netCny;
  });
  return months.map((item) => ({
    ...item,
    receivedCny: roundMoney(item.receivedCny),
    pendingCny: roundMoney(item.pendingCny),
    dueCny: roundMoney(item.dueCny),
    announcedCny: roundMoney(item.announcedCny),
    forecastCny: roundMoney(item.forecastCny),
    upcomingCny: roundMoney(item.pendingCny + item.announcedCny + item.forecastCny),
    totalCny: roundMoney(item.totalCny),
    phase: item.month < currentMonth ? 'past' : item.month === currentMonth ? 'current' : 'future'
  }));
}

// 同一笔派息的优先级：已确认 > 已到账 > 已公告 > 在途/待确认 > 节奏预估。去重时保留优先级最高的一条。
function dividendEntryPriority(entry) {
  if (entry.confirmed === true) return 5;
  if (entry.status === 'received') return 4;
  if (entry.status === 'announced' || entry.isAnnounced) return 3;
  if (entry.status === 'pending' || entry.status === 'due') return 2;
  return 1;
}

// 以（标的 + 除息日）作为一笔派息的经济身份，折叠账本/公告/预估之间以及账本内部的重复条目，
// 避免同一只股票在同一月份重复计数（例如 5 月重复出现的京东集团）。
function dedupeDividendEntries(entries) {
  const byKey = new Map();
  entries.forEach((entry) => {
    const key = `${entry.symbol}|${entry.exDate}`;
    const prev = byKey.get(key);
    if (!prev || dividendEntryPriority(entry) > dividendEntryPriority(prev)) {
      byKey.set(key, entry);
    }
  });
  return Array.from(byKey.values());
}

export function computeDividendCalendar(today = new Date(), filterKeyOverride = null) {
  const todayLabel = typeof today === 'string' ? formatDateLabel(today) : formatLocalDate(today);
  const todayParts = getDateParts(todayLabel) || getDateParts(formatLocalDate());
  const year = todayParts ? todayParts.year : new Date().getFullYear();
  const filterKey = DIVIDEND_FILTER_KEYS.has(filterKeyOverride) ? filterKeyOverride : getDividendFilterKey();
  const summary = computeHoldings();
  const ledgerEntries = state.dividendLedger
    .map((entry) => buildLedgerDividendEntry(entry, year, todayLabel))
    .filter(Boolean);
  const announcedEntries = buildAnnouncedDividendEntries(summary, year, todayLabel);
  const forecastEntries = buildForecastDividendEntries(summary, year, todayLabel, [...ledgerEntries, ...announcedEntries]);
  const entries = dedupeDividendEntries([...ledgerEntries, ...announcedEntries, ...forecastEntries])
    .filter((entry) => matchesDividendFilter(entry, filterKey))
    .sort((a, b) => `${a.payDate}|${a.status}|${a.symbol}`.localeCompare(`${b.payDate}|${b.status}|${b.symbol}`));
  const receivedCny = entries
    .filter((entry) => entry.status === 'received')
    .reduce((sum, entry) => sum + entry.netCny, 0);
  const pendingCny = entries
    .filter((entry) => entry.status === 'pending')
    .reduce((sum, entry) => sum + entry.netCny, 0);
  const dueCny = entries
    .filter((entry) => entry.status === 'due')
    .reduce((sum, entry) => sum + entry.netCny, 0);
  const announcedCny = entries
    .filter((entry) => entry.status === 'announced')
    .reduce((sum, entry) => sum + entry.netCny, 0);
  const forecastCny = entries
    .filter((entry) => entry.status === 'forecast')
    .reduce((sum, entry) => sum + entry.netCny, 0);
  // 即将到账 = 在途待到账(pending) + 已公告未除息(announced) + 节奏预估(forecast)。
  const upcomingCny = pendingCny + announcedCny + forecastCny;
  const projectedCny = receivedCny + dueCny + upcomingCny;
  // 同比：今年「预计全年」对比上一年实际到账总额（同口径筛选）。
  const lastYear = year - 1;
  const lastYearTotalCny = roundMoney(state.dividendLedger.reduce((sum, entry) => {
    const payYear = getIncomeYear(getLedgerCalendarDate(entry).date || (entry && entry.exDate));
    if (payYear !== lastYear) return sum;
    if (!matchesDividendFilter({ bucket: entry.bucket === 'income' ? 'income' : 'core' }, filterKey)) return sum;
    return sum + getLedgerNetCny(entry);
  }, 0));
  const projectedYoy = lastYearTotalCny > 0 ? (projectedCny - lastYearTotalCny) / lastYearTotalCny : null;
  const currentMonth = todayParts ? todayParts.month : new Date().getMonth() + 1;
  return {
    year,
    filterKey,
    today: todayLabel,
    currentMonth,
    metrics: {
      receivedCny: roundMoney(receivedCny),
      pendingCny: roundMoney(pendingCny),
      dueCny: roundMoney(dueCny),
      announcedCny: roundMoney(announcedCny),
      forecastCny: roundMoney(forecastCny),
      upcomingCny: roundMoney(upcomingCny),
      projectedCny: roundMoney(projectedCny),
      lastYearTotalCny,
      projectedYoy
    },
    months: buildDividendMonthItems(entries, currentMonth),
    allDetails: entries
  };
}

/* 首页用：当前自然年「预计全年」股息（全部仓位，不受日历筛选影响）。
   = 已到账 + 在途 + 已公告 + 节奏预估，按每笔派息除息日当天真实持股计算。 */
export function computeCurrentYearDividendCny() {
  return computeDividendCalendar(new Date(), 'all').metrics.projectedCny;
}

function getIncomeYear(value) {
  const parts = getDateParts(value);
  return parts ? parts.year : 0;
}

function getManualByYear() {
  return new Map(state.yearlyManual.map((entry) => [entry.year, entry]));
}

function getArchiveByYear() {
  return new Map(state.yearlyArchives.map((entry) => [entry.year, entry]));
}

function getDividendEntriesByYear() {
  const map = new Map();
  state.dividendLedger.forEach((entry) => {
    const year = getIncomeYear(getLedgerCalendarDate(entry).date || (entry && entry.exDate));
    if (!year) return;
    if (!map.has(year)) map.set(year, []);
    map.get(year).push({
      ...entry,
      netCny: getLedgerNetCny(entry),
      bucket: entry.bucket === 'income' ? 'income' : 'core'
    });
  });
  return map;
}

function getSnapshotsByYear() {
  const map = new Map();
  state.dailySnapshots.forEach((snapshot) => {
    const year = getIncomeYear(snapshot && snapshot.date);
    const date = formatDateLabel(snapshot && snapshot.date);
    const netCny = safeNumber(snapshot && snapshot.netCny, 0);
    if (!year || netCny <= 0) return;
    const previous = map.get(year);
    if (!previous || formatDateLabel(previous.date) < date) {
      map.set(year, { date, netCny: roundMoney(netCny), source: 'snapshot' });
    }
  });
  return map;
}

function getCashFlowNetAmount(entry) {
  const amount = safeNumber(entry && entry.amountCny, 0);
  const type = String(entry && entry.type || '').trim().toLowerCase();
  if (['withdraw', 'withdrawal', 'out', 'outflow'].includes(type)) return -Math.abs(amount);
  if (['deposit', 'in', 'inflow'].includes(type)) return Math.abs(amount);
  return amount;
}

export function computeCashFlowRecords() {
  const records = state.cashFlows
    .map((entry) => {
      const signedCny = roundMoney(getCashFlowNetAmount(entry));
      return {
        ...entry,
        amountCny: Math.abs(safeNumber(entry && entry.amountCny, 0)),
        signedCny,
        isWithdrawal: signedCny < 0
      };
    })
    .sort((a, b) => `${b.date}|${b.id}`.localeCompare(`${a.date}|${a.id}`));
  return {
    records,
    depositCny: roundMoney(records.filter((entry) => !entry.isWithdrawal).reduce((sum, entry) => sum + entry.amountCny, 0)),
    withdrawalCny: roundMoney(records.filter((entry) => entry.isWithdrawal).reduce((sum, entry) => sum + entry.amountCny, 0)),
    netInflowCny: roundMoney(records.reduce((sum, entry) => sum + entry.signedCny, 0)),
    count: records.length
  };
}

function getTradeSortKey(entry) {
  return `${entry && entry.date || ''}|${entry && entry.id || ''}`;
}

function getTradeValueCny(entry) {
  return roundMoney(safeNumber(entry && entry.shares, 0) * safeNumber(entry && entry.price, 0) * safeNumber(entry && entry.fxRate, 1));
}

function getTradeHolding(symbol) {
  return state.holdings.find((holding) => holding && holding.symbol === symbol) || null;
}

function buildTradePosition(symbol, raw) {
  const quote = inferQuote(symbol);
  const shares = Math.max(0, safeNumber(raw.shares, 0));
  const costCny = Math.max(0, roundMoney(raw.costCny));
  const quoteCurrency = resolveQuoteCurrency(quote, symbol);
  const quoteFxRate = resolveFxRate(quoteCurrency, state.rates);
  const currentValueCny = roundMoney(safeNumber(quote.price, 0) * shares * quoteFxRate);
  const holding = getTradeHolding(symbol);
  const taxRate = getHoldingTaxRate(holding);
  const annualDividendCny = roundMoney(safeNumber(quote.dividendPerShareTtm, 0) * shares * quoteFxRate * (1 - taxRate));
  return {
    symbol,
    name: quote.name || symbol,
    bucket: raw.bucket === 'income' ? 'income' : 'core',
    shares: roundQuantity(shares),
    costCny,
    averageCostCny: shares > 0 ? roundMoney(costCny / shares) : 0,
    currentValueCny,
    unrealizedPnlCny: roundMoney(currentValueCny - costCny),
    realizedPnlCny: roundMoney(raw.realizedPnlCny),
    feeCny: roundMoney(raw.feeCny),
    annualDividendCny,
    yieldOnCost: costCny > 0 ? annualDividendCny / costCny : null,
    currentHoldingShares: holding ? safeNumber(holding.quantity, 0) : null
  };
}

export function computeTradeSummary() {
  const recordsAsc = state.trades
    .slice()
    .sort((a, b) => getTradeSortKey(a).localeCompare(getTradeSortKey(b)));
  const positions = new Map();

  recordsAsc.forEach((entry) => {
    const symbol = entry.symbol;
    if (!positions.has(symbol)) {
      positions.set(symbol, {
        shares: 0,
        costCny: 0,
        realizedPnlCny: 0,
        feeCny: 0,
        bucket: entry.bucket === 'income' ? 'income' : 'core'
      });
    }
    const position = positions.get(symbol);
    position.bucket = entry.bucket === 'income' ? 'income' : position.bucket;
    const shares = Math.max(0, safeNumber(entry.shares, 0));
    const valueCny = getTradeValueCny(entry);
    const feeCny = Math.max(0, safeNumber(entry.feeCny, 0));
    position.feeCny += feeCny;

    if (entry.side === 'sell') {
      const averageCost = position.shares > 0 ? position.costCny / position.shares : 0;
      const costOut = averageCost * shares;
      const proceeds = valueCny - feeCny;
      position.realizedPnlCny += proceeds - costOut;
      position.shares -= shares;
      position.costCny -= costOut;
      if (position.shares <= 0.000001) {
        position.shares = 0;
        position.costCny = 0;
      }
    } else {
      position.shares += shares;
      position.costCny += valueCny + feeCny;
    }
  });

  const positionRows = Array.from(positions.entries())
    .map(([symbol, raw]) => buildTradePosition(symbol, raw))
    .filter((row) => row.shares > 0 || Math.abs(row.realizedPnlCny) > 0 || row.feeCny > 0)
    .sort((a, b) => {
      const diff = b.currentValueCny - a.currentValueCny;
      return Math.abs(diff) > 0.000001 ? diff : a.symbol.localeCompare(b.symbol);
    });

  const records = state.trades
    .map((entry) => {
      const quote = inferQuote(entry.symbol);
      const valueCny = getTradeValueCny(entry);
      const feeCny = Math.max(0, safeNumber(entry.feeCny, 0));
      return {
        ...entry,
        name: quote.name || entry.symbol,
        valueCny,
        cashImpactCny: roundMoney(entry.side === 'sell' ? valueCny - feeCny : -(valueCny + feeCny))
      };
    })
    .sort((a, b) => getTradeSortKey(b).localeCompare(getTradeSortKey(a)));

  return {
    records,
    positions: positionRows,
    count: records.length,
    totalCostCny: roundMoney(positionRows.reduce((sum, row) => sum + row.costCny, 0)),
    totalCurrentValueCny: roundMoney(positionRows.reduce((sum, row) => sum + row.currentValueCny, 0)),
    totalUnrealizedPnlCny: roundMoney(positionRows.reduce((sum, row) => sum + row.unrealizedPnlCny, 0)),
    totalRealizedPnlCny: roundMoney(positionRows.reduce((sum, row) => sum + row.realizedPnlCny, 0)),
    totalAnnualDividendCny: roundMoney(positionRows.reduce((sum, row) => sum + row.annualDividendCny, 0))
  };
}

function getNetInflowByYear() {
  const map = new Map();
  state.cashFlows.forEach((entry) => {
    const year = getIncomeYear(entry && entry.date);
    if (!year) return;
    const current = map.get(year) || { value: 0, count: 0 };
    current.value += getCashFlowNetAmount(entry);
    current.count += 1;
    map.set(year, current);
  });
  return map;
}

function getYearEndNetCny(year, snapshotsByYear, manualByYear, archiveByYear, currentYear) {
  const manual = manualByYear.get(year);
  if (manual && manual.yearEndNetCny !== null && manual.yearEndNetCny !== undefined) {
    return { date: '', netCny: roundMoney(manual.yearEndNetCny), source: 'manual' };
  }
  // 现金模式下，当年优先用实时净值（含现金），避免被定时脚本写入的「仅股票」当年快照盖掉、把现金漏掉。
  if (year === currentYear && isCashModelActive()) {
    const summary = computeHoldings();
    if (summary.netMarketValueCny > 0) {
      return { date: formatLocalDate(), netCny: roundMoney(summary.netMarketValueCny), source: 'current' };
    }
  }

  const snapshot = snapshotsByYear.get(year);
  if (snapshot) return snapshot;

  const archived = archiveByYear.get(year);
  if (archived && archived.yearEndNetCny !== null && archived.yearEndNetCny !== undefined) {
    return { date: '', netCny: roundMoney(archived.yearEndNetCny), source: 'archive' };
  }

  if (year === currentYear) {
    const summary = computeHoldings();
    if (summary.netMarketValueCny > 0) {
      return { date: formatLocalDate(), netCny: roundMoney(summary.netMarketValueCny), source: 'current' };
    }
  }

  return { date: '', netCny: null, source: 'missing' };
}

function getIncomeYoy(currentValue, previousValue) {
  if (currentValue === null || currentValue === undefined) return null;
  if (previousValue === null || previousValue === undefined || previousValue === 0) return null;
  return (currentValue - previousValue) / Math.abs(previousValue);
}

function getIncomeCompare(row) {
  if (row.totalReferenceYoy !== null) return { value: row.totalReferenceYoy, basis: 'total' };
  if (row.dividendYoy !== null) return { value: row.dividendYoy, basis: 'dividend' };
  return { value: null, basis: '' };
}

function getCoreGrowthStreak(rowsAsc) {
  let streak = 0;
  for (let index = rowsAsc.length - 1; index > 0; index -= 1) {
    const current = rowsAsc[index].coreDividendCny;
    const previous = rowsAsc[index - 1].coreDividendCny;
    if (previous <= 0 || current <= previous) break;
    streak += 1;
  }
  return streak;
}

export function computeIncomeSummary(today = new Date(), options = {}) {
  const todayLabel = typeof today === 'string' ? formatDateLabel(today) : formatLocalDate(today);
  const todayParts = getDateParts(todayLabel) || getDateParts(formatLocalDate());
  const currentYear = todayParts ? todayParts.year : new Date().getFullYear();
  // filterKey 可被覆盖：年度归档等后台口径必须用 'all'，不能跟随日历页当前筛选。
  const filterKey = DIVIDEND_FILTER_KEYS.has(options.filterKey) ? options.filterKey : getDividendFilterKey();
  const manualByYear = options.ignoreManual === true ? new Map() : getManualByYear();
  const archiveByYear = getArchiveByYear();
  const dividendEntriesByYear = getDividendEntriesByYear();
  const snapshotsByYear = getSnapshotsByYear();
  const netInflowByYear = getNetInflowByYear();
  const years = new Set([currentYear]);

  dividendEntriesByYear.forEach((_items, year) => years.add(year));
  snapshotsByYear.forEach((_snapshot, year) => years.add(year));
  netInflowByYear.forEach((_flow, year) => years.add(year));
  manualByYear.forEach((_manual, year) => years.add(year));
  archiveByYear.forEach((_archive, year) => years.add(year));

  const rowMap = new Map();
  Array.from(years).sort((a, b) => a - b).forEach((year) => {
    const manual = manualByYear.get(year) || null;
    const archive = archiveByYear.get(year) || null;
    const entries = dividendEntriesByYear.get(year) || [];
    const filteredEntries = entries.filter((entry) => matchesDividendFilter(entry, filterKey));
    const ledgerDividendCny = roundMoney(filteredEntries.reduce((sum, entry) => sum + safeNumber(entry.netCny, 0), 0));
    const coreDividendCny = roundMoney(entries
      .filter((entry) => entry.bucket === 'core')
      .reduce((sum, entry) => sum + safeNumber(entry.netCny, 0), 0));
    const flow = netInflowByYear.get(year);
    const manualNetInflow = manual && manual.netInflowCny !== null && manual.netInflowCny !== undefined
      ? safeNumber(manual.netInflowCny, 0) : null;
    const netInflowCny = roundMoney(manualNetInflow !== null
      ? manualNetInflow
      : (flow && flow.count > 0
        ? flow.value
        : (archive && archive.netInflowCny !== null ? archive.netInflowCny : 0)));
    const netInflowSource = manualNetInflow !== null ? 'manual' : (flow && flow.count > 0 ? 'records' : (archive ? 'archive' : 'default'));

    let yearEnd = getYearEndNetCny(year, snapshotsByYear, manualByYear, archiveByYear, currentYear);
    const previousRow = rowMap.get(year - 1);
    const yearStart = previousRow && previousRow.yearEndNetCny !== null
      ? { date: previousRow.yearEndDate, netCny: previousRow.yearEndNetCny, source: 'previousYear' }
      : getYearEndNetCny(year - 1, snapshotsByYear, manualByYear, archiveByYear, currentYear);
    const startNetCny = yearStart.netCny !== null && yearStart.netCny > 0 ? yearStart.netCny : null;

    const manualDividend = manual && manual.dividendCny !== null && manual.dividendCny !== undefined
      ? roundMoney(manual.dividendCny) : null;
    const manualDividendRate = manual && manual.dividendYieldRate !== null && manual.dividendYieldRate !== undefined
      ? safeNumber(manual.dividendYieldRate, 0) : null;
    const manualCapitalCny = manual && manual.capitalReturnCny !== null && manual.capitalReturnCny !== undefined
      ? roundMoney(manual.capitalReturnCny) : null;
    const manualCapitalRate = manual && manual.capitalReturnRate !== null && manual.capitalReturnRate !== undefined
      ? safeNumber(manual.capitalReturnRate, 0) : null;

    /* 比率换算基数：优先真实年初净值；缺失时用手填的「金额 + 率」对反推一个基数，
       只用于金额↔比率互推，不参与净值链推算（避免污染年末净值/资金收益的推导）。 */
    let rateBaseNetCny = startNetCny;
    if (rateBaseNetCny === null && manualCapitalCny !== null && manualCapitalRate) {
      rateBaseNetCny = Math.abs(manualCapitalCny / manualCapitalRate);
    }
    if (rateBaseNetCny === null && manualDividend !== null && manualDividendRate) {
      rateBaseNetCny = Math.abs(manualDividend / manualDividendRate);
    }
    /* 年初净值也缺（常见于最早回填的一年）：有年末净值时按
       年末 = 年初 + 净注入 + 年初×收益率 反解年初；没填收益率就退化为 年末 − 净注入 的近似。 */
    if (rateBaseNetCny === null && yearEnd.netCny !== null) {
      rateBaseNetCny = manualCapitalRate !== null && manualCapitalRate > -1
        ? (yearEnd.netCny - netInflowCny) / (1 + manualCapitalRate)
        : yearEnd.netCny - netInflowCny;
    }
    if (rateBaseNetCny !== null && rateBaseNetCny <= 0) rateBaseNetCny = null;

    let dividendCny;
    let dividendSource;
    if (manualDividend !== null) {
      dividendCny = manualDividend; dividendSource = 'manual';
    } else if (manualDividendRate !== null && rateBaseNetCny !== null) {
      dividendCny = roundMoney(manualDividendRate * rateBaseNetCny); dividendSource = 'derivedFromManualRate';
    } else if (entries.length > 0) {
      dividendCny = ledgerDividendCny; dividendSource = 'ledger';
    } else if (filterKey === 'all' && archive && archive.dividendCny !== null) {
      dividendCny = roundMoney(archive.dividendCny); dividendSource = 'archive';
    } else {
      dividendCny = ledgerDividendCny; dividendSource = 'missing';
    }
    const dividendYieldRate = manualDividendRate !== null
      ? manualDividendRate
      : (rateBaseNetCny !== null
        ? dividendCny / rateBaseNetCny
        : (archive && archive.dividendYieldRate !== null ? archive.dividendYieldRate : null));

    let capitalReturnCny = null;
    let capitalReturnSource = 'missing';
    if (manualCapitalCny !== null) {
      capitalReturnCny = manualCapitalCny; capitalReturnSource = 'manual';
    } else if (manualCapitalRate !== null && rateBaseNetCny !== null) {
      capitalReturnCny = roundMoney(manualCapitalRate * rateBaseNetCny); capitalReturnSource = 'derivedFromManualRate';
    } else if (yearEnd.netCny !== null && startNetCny !== null) {
      capitalReturnCny = roundMoney(yearEnd.netCny - startNetCny - netInflowCny); capitalReturnSource = 'netValueChain';
    } else if (archive && archive.capitalReturnCny !== null) {
      capitalReturnCny = roundMoney(archive.capitalReturnCny); capitalReturnSource = 'archive';
    }
    const capitalReturnRate = manualCapitalRate !== null
      ? manualCapitalRate
      : (capitalReturnCny !== null && rateBaseNetCny !== null
        ? capitalReturnCny / rateBaseNetCny
        : (archive && archive.capitalReturnRate !== null ? archive.capitalReturnRate : null));
    const manualYearEnd = manual && manual.yearEndNetCny !== null && manual.yearEndNetCny !== undefined;
    const manualCapitalDriver = manualCapitalCny !== null || manualCapitalRate !== null;
    if (!manualYearEnd && startNetCny !== null && capitalReturnCny !== null
      && (yearEnd.netCny === null || manualCapitalDriver)) {
      yearEnd = {
        date: '',
        netCny: roundMoney(startNetCny + netInflowCny + capitalReturnCny),
        source: 'derived'
      };
    }
    const manualConflicts = [];
    if (manualDividend !== null && manualDividendRate !== null && startNetCny !== null
      && Math.abs(manualDividend - manualDividendRate * startNetCny) > Math.max(1, Math.abs(manualDividend) * 0.01)) {
      manualConflicts.push('股息与股息率不一致');
    }
    if (manualCapitalCny !== null && manualCapitalRate !== null && startNetCny !== null
      && Math.abs(manualCapitalCny - manualCapitalRate * startNetCny) > Math.max(1, Math.abs(manualCapitalCny) * 0.01)) {
      manualConflicts.push('资金收益与收益率不一致');
    }
    const totalReferenceCny = capitalReturnCny === null ? null : roundMoney(dividendCny + capitalReturnCny);

    rowMap.set(year, {
      year,
      filterKey,
      dividendCny,
      dividendSource,
      hasManualBackfill: Boolean(manual),
      coreDividendCny,
      capitalReturnCny,
      capitalReturnRate,
      dividendYieldRate,
      totalReferenceCny,
      netInflowCny,
      yearEndNetCny: yearEnd.netCny,
      yearEndSource: yearEnd.source,
      yearEndDate: yearEnd.date,
      yearStartNetCny: yearStart.netCny,
      fieldSources: {
        dividendCny: dividendSource,
        dividendYieldRate: manualDividendRate !== null ? 'manual' : (dividendYieldRate !== null ? 'derived' : 'missing'),
        capitalReturnCny: capitalReturnSource,
        capitalReturnRate: manualCapitalRate !== null ? 'manual' : (capitalReturnRate !== null ? 'derived' : 'missing'),
        netInflowCny: netInflowSource,
        yearEndNetCny: yearEnd.source
      },
      manualConflicts,
      capitalReturnAvailable: capitalReturnCny !== null,
      dividendYoy: null,
      capitalReturnYoy: null,
      totalReferenceYoy: null,
      compare: { value: null, basis: '' }
    });
  });

  const rowsAsc = Array.from(rowMap.values()).sort((a, b) => a.year - b.year);
  rowsAsc.forEach((row) => {
    const previous = rowMap.get(row.year - 1);
    row.dividendYoy = getIncomeYoy(row.dividendCny, previous && previous.dividendCny);
    row.capitalReturnYoy = getIncomeYoy(row.capitalReturnCny, previous && previous.capitalReturnCny);
    row.totalReferenceYoy = getIncomeYoy(row.totalReferenceCny, previous && previous.totalReferenceCny);
    row.compare = getIncomeCompare(row);
  });

  const current = rowMap.get(currentYear) || rowsAsc[rowsAsc.length - 1] || null;
  const previousCurrent = rowMap.get(currentYear - 1) || null;
  const coreYoy = current ? getIncomeYoy(current.coreDividendCny, previousCurrent && previousCurrent.coreDividendCny) : null;
  // 展示从 INCOME_START_YEAR 起；更早年份仍留在 rowMap 里参与净值链与同比计算。
  const visibleRowsAsc = rowsAsc.filter((row) => row.year >= INCOME_START_YEAR);

  return {
    currentYear,
    filterKey,
    today: todayLabel,
    rows: visibleRowsAsc.slice().sort((a, b) => b.year - a.year),
    trendRows: visibleRowsAsc,
    current,
    northStar: {
      year: currentYear,
      coreDividendCny: current ? current.coreDividendCny : 0,
      yoy: coreYoy,
      growthStreak: getCoreGrowthStreak(rowsAsc)
    },
    notes: {
      dividendBasis: 'payDate',
      capitalReturnScope: filterKey === 'all' ? 'all' : 'account'
    }
  };
}
