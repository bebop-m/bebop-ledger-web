/* ── 年度年鉴：全自动年度复盘 ──
   一切数字来自已有数据（收益汇总、出入金、交易、日快照、年度持仓快照、基本面），
   不新增任何存储；过去年份因归档与快照冻结而天然稳定。

   口径：
   - XIRR：净值链（年初净值 → 出入金 → 年末净值）的资金加权年化。
     未启用现金模式时股息不在净值内，把当年股息按年中收到的分配现金计入。
   - 归因：合计收益 = 股息 + 汇率 + 价格；价格部分再按年初持仓与 EPS
     增速近似拆成「EPS 增长」与「估值变动」，覆盖不到的按未拆分披露。 */
import { state } from './state.js';
import { safeNumber, formatDateLabel, resolveFxRate } from './utils.js';
import { computeIncomeSummary, inferQuote, isCashModelActive } from './compute.js';
import { getCompanyFundamentals } from './fundamentals.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/* 资金加权年化收益（XIRR）。flows: [{ date: 'YYYY-MM-DD', amountCny }]，
   投资人视角：投入为负、取回与期末价值为正。Newton 失败时退回二分。 */
export function computeXirr(flows) {
  const parsed = flows
    .map((flow) => ({ time: new Date(`${flow.date}T00:00:00`).getTime(), amount: safeNumber(flow.amountCny, 0) }))
    .filter((flow) => Number.isFinite(flow.time) && flow.amount !== 0)
    .sort((a, b) => a.time - b.time);
  if (parsed.length < 2) return null;
  if (!parsed.some((f) => f.amount > 0) || !parsed.some((f) => f.amount < 0)) return null;
  const t0 = parsed[0].time;
  const npv = (rate) => parsed.reduce((sum, flow) =>
    sum + flow.amount / Math.pow(1 + rate, (flow.time - t0) / (365 * DAY_MS)), 0);

  let rate = 0.1;
  for (let i = 0; i < 50; i += 1) {
    const value = npv(rate);
    if (Math.abs(value) < 1e-7) return rate;
    const step = 1e-6;
    const derivative = (npv(rate + step) - value) / step;
    if (!Number.isFinite(derivative) || derivative === 0) break;
    const next = rate - value / derivative;
    if (!Number.isFinite(next) || next <= -0.9999) break;
    if (Math.abs(next - rate) < 1e-9) return next;
    rate = next;
  }
  let low = -0.9999;
  let high = 10;
  let npvLow = npv(low);
  if (npvLow * npv(high) > 0) return null;
  for (let i = 0; i < 200; i += 1) {
    const mid = (low + high) / 2;
    const value = npv(mid);
    if (Math.abs(value) < 1e-7) return mid;
    if (npvLow * value < 0) high = mid;
    else { low = mid; npvLow = value; }
  }
  return (low + high) / 2;
}

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

  const priceCny = row.capitalReturnCny - fxCny;
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
      const position = positions.get(trade.symbol) || { shares: 0, costCny: 0 };
      let realizedPnlCny = 0;
      if (trade.side === 'sell') {
        const averageCost = position.shares > 0 ? position.costCny / position.shares : 0;
        const costOut = averageCost * shares;
        realizedPnlCny = valueCny - feeCny - costOut;
        position.shares = Math.max(0, position.shares - shares);
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
        realizedPnlCny
      };
    });
  return rows.filter((trade) => trade.date.startsWith(String(year)));
}

function getYearDividendMonths(year) {
  const months = Array.from({ length: 12 }, () => 0);
  state.dividendLedger.forEach((entry) => {
    if (!entry || entry.confirmed !== true) return;
    const date = formatDateLabel(entry.receivedDate || entry.payDate || entry.exDate);
    if (!date.startsWith(String(year))) return;
    const month = Number(date.slice(5, 7));
    if (month >= 1 && month <= 12) months[month - 1] += safeNumber(entry.netCny, 0);
  });
  return months;
}

export function computeYearAnnals(year) {
  const summary = computeIncomeSummary(new Date(), { filterKey: 'all' });
  const row = summary.trendRows.find((item) => item.year === year) || null;
  if (!row) return null;
  const currentYear = summary.currentYear;

  let xirr = null;
  let xirrScope = '';
  const startNet = safeNumber(row.yearStartNetCny, 0);
  const endNet = safeNumber(row.yearEndNetCny, 0);
  if (startNet > 0 && endNet > 0) {
    const flows = [{ date: `${year}-01-01`, amountCny: -startNet }];
    const prefix = String(year);
    state.cashFlows.forEach((entry) => {
      const date = formatDateLabel(entry && entry.date);
      if (!date.startsWith(prefix)) return;
      const amount = Math.abs(safeNumber(entry.amountCny, 0));
      if (amount <= 0) return;
      flows.push({ date, amountCny: entry.type === 'withdrawal' ? amount : -amount });
    });
    // 无逐笔出入金记录、但年度净注入非零（手填/归档口径）时按年中一笔近似。
    if (flows.length === 1 && row.netInflowCny) {
      flows.push({ date: `${year}-07-01`, amountCny: -row.netInflowCny });
    }
    if (!isCashModelActive() && row.dividendCny > 0) {
      flows.push({ date: year === currentYear ? summary.today : `${year}-07-01`, amountCny: row.dividendCny });
      xirrScope = '股息+资金';
    } else {
      xirrScope = '净值链';
    }
    flows.push({ date: year === currentYear ? summary.today : `${year}-12-31`, amountCny: endNet });
    xirr = computeXirr(flows);
  }

  const trades = getYearTrades(year);
  return {
    year,
    isCurrentYear: year === currentYear,
    row,
    xirr,
    xirrScope,
    attribution: computeAttribution(row, year, currentYear),
    dividendMonths: getYearDividendMonths(year),
    trades,
    realizedPnlCny: trades.reduce((sum, trade) => sum + safeNumber(trade.realizedPnlCny, 0), 0)
  };
}
