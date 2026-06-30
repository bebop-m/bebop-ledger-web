import { state, DEFAULT_QUOTES, invalidateComputeCache, getComputeCache, setComputeCache } from './state.js';
import {
  safeNumber, inferQuoteFromMap, resolveQuoteCurrency, resolveFxRate,
  parsePercentOverride, resolveManualDividendPerShareOverride,
  normalizeDividendSource, normalizeDividendStatus, formatDateLabel,
  buildDividendSourceId, resolveEffectivePayDate
} from './utils.js';
import { COMPANY_COLORS, BUCKET_COLORS, LABELS, DIVIDEND_FILTER_KEYS } from './constants.js';

export function inferQuote(symbol) {
  return inferQuoteFromMap(symbol, state.quotes, DEFAULT_QUOTES);
}

export function computeHoldings() {
  const cached = getComputeCache();
  if (cached) return cached;

  const holdings = state.holdings.map((holding) => {
    const quote = inferQuote(holding.symbol);
    const quantity = Math.max(0, safeNumber(holding.quantity, 0));
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
  const result = {
    holdings: holdings.map((i) => ({ ...i, holdingWeight: safeNumber(i.marketValueCny, 0) / divisor })),
    totalMarketValueCny, totalDividendCny, totalDailyPnlCny,
    netMarketValueCny: totalMarketValueCny - state.liabilityCny
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

function buildLedgerDividendEntry(entry, year, todayLabel) {
  const exParts = getDateParts(entry && entry.exDate);
  if (!exParts) return null;
  const effectivePay = getLedgerEffectivePayDate(entry);
  const payParts = getDateParts(effectivePay.date) || exParts;
  if (payParts.year !== year) return null;
  const quote = inferQuote(entry.symbol);
  const isReceived = entry.confirmed === true || payParts.label <= todayLabel;
  const netCny = getLedgerNetCny(entry);
  return {
    id: entry.id || entry.sourceId || buildDividendSourceId(entry),
    sourceId: entry.sourceId || buildDividendSourceId(entry),
    symbol: entry.symbol,
    name: quote.name || entry.symbol,
    exDate: exParts.label,
    payDate: payParts.label,
    payDateEstimated: effectivePay.estimated,
    month: payParts.month,
    amountPerShare: safeNumber(entry.amountPerShare, 0),
    currency: entry.currency || resolveQuoteCurrency(quote, entry.symbol),
    shares: safeNumber(entry.shares, 0),
    sharesSource: entry.sharesSource || 'manual',
    netCny,
    bucket: entry.bucket === 'income' ? 'income' : 'core',
    status: isReceived ? 'received' : 'pending',
    receiptStatus: isReceived ? 'received' : 'pending',
    confidence: entry.confidence || (isReceived ? 'confirmed' : 'estimated'),
    confirmed: entry.confirmed === true,
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

function buildForecastDividendEntries(summary, year, todayLabel, ledgerEntries) {
  // 同一 (symbol, 到账月) 已有真实账本条目时跳过预估，避免与实际派息重复计数。
  const ledgerMonthKeys = new Set(ledgerEntries.map((entry) => `${entry.symbol}|${entry.month}`));
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
      if (ledgerMonthKeys.has(`${holding.symbol}|${payParts.month}`)) return;
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
    forecastCny: 0,
    totalCny: 0
  }));
  entries.forEach((entry) => {
    const item = months[entry.month - 1];
    if (!item) return;
    if (entry.status === 'received') item.receivedCny += entry.netCny;
    else if (entry.status === 'pending') item.pendingCny += entry.netCny;
    else item.forecastCny += entry.netCny;
    item.totalCny += entry.netCny;
  });
  return months.map((item) => ({
    ...item,
    receivedCny: roundMoney(item.receivedCny),
    pendingCny: roundMoney(item.pendingCny),
    forecastCny: roundMoney(item.forecastCny),
    upcomingCny: roundMoney(item.pendingCny + item.forecastCny),
    totalCny: roundMoney(item.totalCny),
    phase: item.month < currentMonth ? 'past' : item.month === currentMonth ? 'current' : 'future'
  }));
}

export function computeDividendCalendar(today = new Date()) {
  const todayLabel = typeof today === 'string' ? formatDateLabel(today) : formatLocalDate(today);
  const todayParts = getDateParts(todayLabel) || getDateParts(formatLocalDate());
  const year = todayParts ? todayParts.year : new Date().getFullYear();
  const filterKey = getDividendFilterKey();
  const summary = computeHoldings();
  const ledgerEntries = state.dividendLedger
    .map((entry) => buildLedgerDividendEntry(entry, year, todayLabel))
    .filter(Boolean);
  const forecastEntries = buildForecastDividendEntries(summary, year, todayLabel, ledgerEntries);
  const entries = [...ledgerEntries, ...forecastEntries]
    .filter((entry) => matchesDividendFilter(entry, filterKey))
    .sort((a, b) => `${a.payDate}|${a.status}|${a.symbol}`.localeCompare(`${b.payDate}|${b.status}|${b.symbol}`));
  const receivedCny = entries
    .filter((entry) => entry.status === 'received')
    .reduce((sum, entry) => sum + entry.netCny, 0);
  const pendingCny = entries
    .filter((entry) => entry.status === 'pending')
    .reduce((sum, entry) => sum + entry.netCny, 0);
  const forecastCny = entries
    .filter((entry) => entry.status === 'forecast')
    .reduce((sum, entry) => sum + entry.netCny, 0);
  // 即将到账 = 在途待到账(pending) + 节奏预估(forecast)；预计全年 = 已到账 + 即将到账。
  const upcomingCny = pendingCny + forecastCny;
  const projectedCny = receivedCny + upcomingCny;
  // 同比：今年「预计全年」对比上一年实际到账总额（同口径筛选）。
  const lastYear = year - 1;
  const lastYearTotalCny = roundMoney(state.dividendLedger.reduce((sum, entry) => {
    const payYear = getIncomeYear(getLedgerEffectivePayDate(entry).date || (entry && entry.exDate));
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

function getIncomeYear(value) {
  const parts = getDateParts(value);
  return parts ? parts.year : 0;
}

function getManualByYear() {
  return new Map(state.yearlyManual.map((entry) => [entry.year, entry]));
}

function getDividendEntriesByYear() {
  const map = new Map();
  state.dividendLedger.forEach((entry) => {
    const year = getIncomeYear(getLedgerEffectivePayDate(entry).date || (entry && entry.exDate));
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

function getYearEndNetCny(year, snapshotsByYear, manualByYear, currentYear) {
  const snapshot = snapshotsByYear.get(year);
  if (snapshot) return snapshot;

  const manual = manualByYear.get(year);
  const manualValue = safeNumber(manual && manual.yearEndNetCny, 0);
  if (manualValue > 0) return { date: '', netCny: roundMoney(manualValue), source: 'manual' };

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

export function computeIncomeSummary(today = new Date()) {
  const todayLabel = typeof today === 'string' ? formatDateLabel(today) : formatLocalDate(today);
  const todayParts = getDateParts(todayLabel) || getDateParts(formatLocalDate());
  const currentYear = todayParts ? todayParts.year : new Date().getFullYear();
  const filterKey = getDividendFilterKey();
  const manualByYear = getManualByYear();
  const dividendEntriesByYear = getDividendEntriesByYear();
  const snapshotsByYear = getSnapshotsByYear();
  const netInflowByYear = getNetInflowByYear();
  const years = new Set([currentYear]);

  dividendEntriesByYear.forEach((_items, year) => years.add(year));
  snapshotsByYear.forEach((_snapshot, year) => years.add(year));
  netInflowByYear.forEach((_flow, year) => years.add(year));
  manualByYear.forEach((_manual, year) => years.add(year));

  const rowMap = new Map();
  Array.from(years).sort((a, b) => a - b).forEach((year) => {
    const manual = manualByYear.get(year) || null;
    const entries = dividendEntriesByYear.get(year) || [];
    const filteredEntries = entries.filter((entry) => matchesDividendFilter(entry, filterKey));
    const manualDividend = safeNumber(manual && manual.dividendCny, 0);
    const shouldUseManualDividend = Boolean(filterKey === 'all' && entries.length === 0 && manual);
    const dividendCny = roundMoney(shouldUseManualDividend
      ? manualDividend
      : filteredEntries.reduce((sum, entry) => sum + safeNumber(entry.netCny, 0), 0));
    const coreDividendCny = roundMoney(entries
      .filter((entry) => entry.bucket === 'core')
      .reduce((sum, entry) => sum + safeNumber(entry.netCny, 0), 0));
    const flow = netInflowByYear.get(year);
    const netInflowCny = roundMoney(flow && flow.count > 0
      ? flow.value
      : safeNumber(manual && manual.netInflowCny, 0));
    const yearEnd = getYearEndNetCny(year, snapshotsByYear, manualByYear, currentYear);
    const yearStart = getYearEndNetCny(year - 1, snapshotsByYear, manualByYear, currentYear);
    const hasCapitalReturn = yearEnd.netCny !== null && yearStart.netCny !== null;
    const capitalReturnCny = hasCapitalReturn
      ? roundMoney(yearEnd.netCny - yearStart.netCny - netInflowCny)
      : null;
    const totalReferenceCny = capitalReturnCny === null ? null : roundMoney(dividendCny + capitalReturnCny);

    rowMap.set(year, {
      year,
      filterKey,
      dividendCny,
      dividendSource: shouldUseManualDividend ? 'manual' : 'ledger',
      hasManualBackfill: Boolean(manual),
      coreDividendCny,
      capitalReturnCny,
      totalReferenceCny,
      netInflowCny,
      yearEndNetCny: yearEnd.netCny,
      yearEndSource: yearEnd.source,
      yearEndDate: yearEnd.date,
      yearStartNetCny: yearStart.netCny,
      capitalReturnAvailable: hasCapitalReturn,
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

  return {
    currentYear,
    filterKey,
    today: todayLabel,
    rows: rowsAsc.slice().sort((a, b) => b.year - a.year),
    trendRows: rowsAsc,
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
