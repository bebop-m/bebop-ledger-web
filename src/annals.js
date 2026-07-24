/* ── 年度年鉴：全自动年度复盘 ──
   一切数字来自已有数据（收益汇总、出入金、交易、日快照、年度持仓快照、基本面），
   不新增任何存储；过去年份因归档与快照冻结而天然稳定。

   口径：
   - 本年收益率（区间简单法）：资金收益 ÷ 年初净值（capitalReturnCny 已含股息与汇率）。
     XIRR 资金加权口径已移除，UI 与归因统一走此区间简单法。
   - 归因：合计收益 = 股息 + 汇率 + 价格；价格部分再按年初持仓与 EPS
     增速近似拆成「EPS 增长」与「估值变动」，覆盖不到的按未拆分披露。
     各项贡献率 = 金额 ÷ 年初净值，四项相加 = 本年收益率。 */
import { state } from './state.js';
import { safeNumber, formatDateLabel, resolveFxRate } from './utils.js';
import {
  computeIncomeSummary, inferQuote, getLedgerCalendarDate, getLedgerNetCny,
  getNormalizedDividendLedgerEntries
} from './compute.js';
import { getCompanyFundamentals } from './fundamentals.js';

function getYearlyHoldingsEntry(year) {
  return state.yearlyHoldings.find((entry) => entry && entry.year === year) || null;
}

/* 年界汇率：优先该年最后一份日快照的汇率；当前年退回实时汇率。 */
function getYearEndRates(year, currentYear) {
  const snapshots = state.dailySnapshots
    .filter((snapshot) => formatDateLabel(snapshot && snapshot.date).startsWith(String(year)))
    .sort((a, b) => formatDateLabel(b.date).localeCompare(formatDateLabel(a.date)));
  const snapshot = snapshots[0];
  if (snapshot && snapshot.rates && typeof snapshot.rates === 'object') return snapshot.rates;
  return year >= currentYear ? state.rates : null;
}

function getCompanyYearRow(company, year) {
  return (Array.isArray(company.years) ? company.years : [])
    .find((row) => row && row.year === year) || null;
}

/* 归因：合计 = 股息 + 汇率 + 价格；价格再按 EPS/估值 近似拆分。 */
function computeAttribution(row, year, currentYear) {
  const startEntry = getYearlyHoldingsEntry(year - 1);
  const endEntry = getYearlyHoldingsEntry(year);
  const startRates = getYearEndRates(year - 1, currentYear);
  const endRates = getYearEndRates(year, currentYear);
  if (!startEntry || !startRates || !endRates || row.capitalReturnCny === null) {
    return { available: false, dividendCny: row.dividendCny };
  }

  let fxCny = 0;
  let epsCny = 0;
  let valuationCny = 0;
  let coveredStartValue = 0;
  let totalStartValue = 0;
  const endBySymbol = new Map((endEntry ? endEntry.holdings : []).map((item) => [item.symbol, item]));

  startEntry.holdings.forEach((holding) => {
    const shares = safeNumber(holding.shares, 0);
    const startPrice = safeNumber(holding.price, 0);
    if (shares <= 0 || startPrice <= 0) return;
    const currency = holding.currency || 'CNY';
    const fxStart = resolveFxRate(currency, startRates);
    const fxEnd = resolveFxRate(currency, endRates);
    const startValueCny = shares * startPrice * fxStart;
    totalStartValue += startValueCny;
    if (currency !== 'CNY') fxCny += shares * startPrice * (fxEnd - fxStart);

    // EPS/估值拆分：需要年末价格与该年、上年皆为正的 EPS。
    const endHolding = endBySymbol.get(holding.symbol);
    const endPrice = endHolding
      ? safeNumber(endHolding.price, 0)
      : (year === currentYear ? safeNumber(inferQuote(holding.symbol).price, 0) : 0);
    const company = getCompanyFundamentals(holding.symbol);
    if (!company || endPrice <= 0) return;
    const thisRow = getCompanyYearRow(company, year);
    const prevRow = getCompanyYearRow(company, year - 1);
    const epsNow = thisRow ? safeNumber(thisRow.eps, NaN) : NaN;
    const epsPrev = prevRow ? safeNumber(prevRow.eps, NaN) : NaN;
    if (!Number.isFinite(epsNow) || !Number.isFinite(epsPrev) || epsNow <= 0 || epsPrev <= 0) return;
    const localReturn = endPrice / startPrice - 1;
    const growth = epsNow / epsPrev - 1;
    epsCny += startValueCny * growth;
    valuationCny += startValueCny * (localReturn - growth);
    coveredStartValue += startValueCny;
  });

  // 现金已进入净值链时，资本收益已经包含股息，价格项必须先扣掉股息，
  // 否则归因条会把同一笔股息同时算进价格与股息。
  const priceCny = row.capitalReturnCny - fxCny
    - (row.capitalReturnIncludesDividend ? row.dividendCny : 0);
  return {
    available: true,
    dividendCny: row.dividendCny,
    fxCny,
    priceCny,
    epsCny,
    valuationCny,
    epsSplitCoverage: totalStartValue > 0 ? coveredStartValue / totalStartValue : 0,
    startDate: startEntry.date || `${year - 1}-12-31`
  };
}

function getYearTrades(year) {
  const positions = new Map();
  const rows = state.trades
    .filter(Boolean)
    .slice()
    .sort((a, b) => `${formatDateLabel(a.date)}|${a.id || ''}`.localeCompare(`${formatDateLabel(b.date)}|${b.id || ''}`))
    .map((trade) => {
      const shares = Math.max(0, safeNumber(trade.shares, 0));
      const valueCny = shares * safeNumber(trade.price, 0) * Math.max(safeNumber(trade.fxRate, 1), 0);
      const feeCny = Math.max(0, safeNumber(trade.feeCny, 0));
      const baselineHolding = state.holdings.find((holding) => holding && holding.symbol === trade.symbol);
      const baselineShares = Math.max(0, safeNumber(baselineHolding && baselineHolding.quantity, 0));
      const position = positions.get(trade.symbol) || { shares: baselineShares, unknownCostShares: baselineShares, costCny: 0 };
      let realizedPnlCny = null;
      let realizedPnlComplete = true;
      if (trade.side === 'sell') {
        const unknownOut = Math.min(shares, Math.max(0, position.unknownCostShares));
        const knownOut = Math.max(0, shares - unknownOut);
        const knownShares = Math.max(0, position.shares - position.unknownCostShares);
        const averageCost = knownShares > 0 ? position.costCny / knownShares : 0;
        const costOut = averageCost * knownOut;
        realizedPnlComplete = unknownOut <= 0.000001;
        realizedPnlCny = realizedPnlComplete ? valueCny - feeCny - costOut : null;
        position.shares = Math.max(0, position.shares - shares);
        position.unknownCostShares = Math.max(0, position.unknownCostShares - unknownOut);
        position.costCny = Math.max(0, position.costCny - costOut);
      } else {
        position.shares += shares;
        position.costCny += valueCny + feeCny;
      }
      positions.set(trade.symbol, position);
      return {
        id: trade.id,
        date: formatDateLabel(trade.date),
        side: trade.side === 'sell' ? 'sell' : 'buy',
        symbol: trade.symbol,
        name: inferQuote(trade.symbol).name || trade.symbol,
        shares,
        price: safeNumber(trade.price, 0),
        currency: trade.currency || 'CNY',
        valueCny,
        cashImpactCny: trade.side === 'sell' ? valueCny - feeCny : -(valueCny + feeCny),
        realizedPnlCny,
        realizedPnlComplete
      };
    });
  return rows.filter((trade) => trade.date.startsWith(String(year)));
}

function getYearDividendMonths(year) {
  const months = Array.from({ length: 12 }, () => 0);
  getNormalizedDividendLedgerEntries().forEach((entry) => {
    if (!entry || entry.confirmed !== true) return;
    const date = getLedgerCalendarDate(entry).date;
    if (!date.startsWith(String(year))) return;
    const month = Number(date.slice(5, 7));
    if (month >= 1 && month <= 12) months[month - 1] += getLedgerNetCny(entry);
  });
  return months;
}

/* 年度持仓分解：该年快照按 CNY 市值降序，附占比与「较上年股数增减」；
   清仓的标的单列，供 10-年度回顾 的饼图与沉底行。 */
function formatSnapshotShares(value) {
  return safeNumber(value, 0).toLocaleString('en-US', { maximumFractionDigits: 6 });
}

function buildYearHoldingsBreakdown(year, currentYear) {
  const endEntry = getYearlyHoldingsEntry(year);
  if (!endEntry || !Array.isArray(endEntry.holdings) || !endEntry.holdings.length) {
    return { hasData: false, items: [], removed: [], total: 0, count: 0, year, previousYear: null };
  }
  const rates = getYearEndRates(year, currentYear) || state.rates;
  const mv = (holding) => {
    const stored = safeNumber(holding.marketValueCny, NaN);
    if (Number.isFinite(stored) && stored > 0) return stored;
    return safeNumber(holding.shares, 0) * safeNumber(holding.price, 0) * resolveFxRate(holding.currency || 'CNY', rates);
  };
  const previous = state.yearlyHoldings
    .filter((item) => item && item.year < year)
    .sort((a, b) => b.year - a.year)[0] || null;
  const previousBySymbol = new Map((previous ? previous.holdings : []).map((item) => [item.symbol, item]));
  const items = endEntry.holdings
    .map((holding) => {
      const before = previousBySymbol.get(holding.symbol);
      previousBySymbol.delete(holding.symbol);
      const delta = before ? safeNumber(holding.shares, 0) - safeNumber(before.shares, 0) : null;
      return {
        symbol: holding.symbol,
        name: holding.name || holding.symbol,
        shares: safeNumber(holding.shares, 0),
        value: mv(holding),
        change: !previous ? '' : (!before ? '新增' : (Math.abs(delta) < 0.000001 ? '' : `${delta > 0 ? '+' : '−'}${formatSnapshotShares(Math.abs(delta))}`))
      };
    })
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value);
  const total = items.reduce((sum, item) => sum + item.value, 0) || 1;
  items.forEach((item) => { item.pct = item.value / total; });
  const removed = Array.from(previousBySymbol.values())
    .map((item) => ({ name: item.name || item.symbol, shares: safeNumber(item.shares, 0) }));
  return { hasData: true, items, removed, total, count: items.length, year, previousYear: previous ? previous.year : null };
}

export function computeYearAnnals(year) {
  const summary = computeIncomeSummary(new Date(), { filterKey: 'all' });
  const row = summary.trendRows.find((item) => item.year === year) || null;
  if (!row) return null;
  const currentYear = summary.currentYear;

  // 本年收益率（区间简单法）：资金收益 ÷ 年初净值；capitalReturnCny 已含股息与汇率。
  const yearStartNetCny = safeNumber(row.yearStartNetCny, 0);
  const returnRate = yearStartNetCny > 0 && row.capitalReturnCny !== null
    ? row.capitalReturnCny / yearStartNetCny
    : null;

  const trades = getYearTrades(year);
  return {
    year,
    isCurrentYear: year === currentYear,
    today: summary.today,
    row,
    returnRate,
    yearStartNetCny,
    attribution: computeAttribution(row, year, currentYear),
    holdings: buildYearHoldingsBreakdown(year, currentYear),
    dividendMonths: getYearDividendMonths(year),
    trades,
    realizedPnlCny: trades.reduce((sum, trade) => sum + safeNumber(trade.realizedPnlCny, 0), 0)
  };
}
