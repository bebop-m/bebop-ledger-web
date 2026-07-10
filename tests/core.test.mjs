import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = {
  getElementById: () => null,
  querySelectorAll: () => [],
  querySelector: () => null
};
globalThis.localStorage = { getItem: () => null, setItem: () => {} };

const stateModule = await import('../src/state.js');
const computeModule = await import('../src/compute.js');
const revenueModule = await import('../src/revenue.js');
const { state, applySnapshot, invalidateComputeCache } = stateModule;
const { computeDividendCalendar, computeIncomeSummary } = computeModule;
const { settleRevenueData } = revenueModule;

function applyTestSnapshot(overrides = {}) {
  applySnapshot({
    version: 2,
    holdings: [{ localId: 1, symbol: 'TEST.HK', quantity: 10, bucket: 'core' }],
    quotes: { 'TEST.HK': { name: 'Test', price: 10, currency: 'HKD', dividends: [] } },
    rates: { CNY: 1, USD: 7, HKD: 1 },
    dailySnapshots: [],
    dividendLedger: [],
    cashFlows: [],
    trades: [],
    yearlyManual: [],
    yearlyArchives: [],
    yearlyHoldings: [],
    ...overrides
  });
  invalidateComputeCache();
}

test('legacy auto yearly data migrates separately from manual overrides', () => {
  applyTestSnapshot({
    yearlyManual: [
      { year: 2024, source: 'auto', dividendCny: 0, yearEndNetCny: 1000, netInflowCny: 0 },
      { year: 2025, dividendYieldRate: 0.05 }
    ]
  });
  assert.equal(state.yearlyArchives.length, 1);
  assert.equal(state.yearlyArchives[0].dividendCny, null);
  assert.equal(state.yearlyArchives[0].yearEndNetCny, 1000);
  assert.equal(state.yearlyManual.length, 1);
  assert.equal(state.yearlyManual[0].dividendYieldRate, 0.05);
});

test('manual rates backfill amounts and related year-end value', () => {
  applyTestSnapshot({
    dailySnapshots: [
      { date: '2024-12-31', netCny: 1000, totalMarketValueCny: 1000, holdings: [], rates: { CNY: 1, USD: 7, HKD: 1 } },
      { date: '2025-12-31', netCny: 1500, totalMarketValueCny: 1500, holdings: [], rates: { CNY: 1, USD: 7, HKD: 1 } }
    ],
    yearlyManual: [{ year: 2025, dividendYieldRate: 0.05, capitalReturnRate: 0.1, netInflowCny: 0 }]
  });
  const row = computeIncomeSummary('2026-07-10').rows.find((item) => item.year === 2025);
  assert.equal(row.dividendCny, 50);
  assert.equal(row.capitalReturnCny, 100);
  assert.equal(row.yearEndNetCny, 1100);
  assert.equal(row.yearEndSource, 'derived');
});

test('late official pay date patches automatic ledger and due remains in projected total', () => {
  applyTestSnapshot({
    quotes: {
      'TEST.HK': {
        name: 'Test', price: 10, currency: 'HKD',
        dividends: [{ exDate: '2026-06-02', payDate: '', amountPerShare: 1, currency: 'HKD', source: 'yahoo' }]
      }
    },
    dailySnapshots: [{
      date: '2026-06-02', netCny: 100, totalMarketValueCny: 100,
      holdings: [{ symbol: 'TEST.HK', shares: 10, bucket: 'core' }],
      rates: { CNY: 1, USD: 7, HKD: 1 }
    }]
  });
  settleRevenueData(new Date(2026, 6, 10));
  assert.equal(state.dividendLedger[0].receiptStatus, 'due');
  let metrics = computeDividendCalendar('2026-07-10').metrics;
  assert.equal(metrics.upcomingCny, 0);
  assert.equal(metrics.dueCny, 10);
  assert.equal(metrics.projectedCny, 10);

  state.quotes['TEST.HK'].dividends[0].payDate = '2026-07-08';
  settleRevenueData(new Date(2026, 6, 10));
  assert.equal(state.dividendLedger[0].payDate, '2026-07-08');

  state.dividendLedger[0].confidence = 'manual';
  state.dividendLedger[0].payDate = '2026-07-09';
  state.quotes['TEST.HK'].dividends[0].payDate = '2026-07-12';
  settleRevenueData(new Date(2026, 6, 10));
  assert.equal(state.dividendLedger[0].payDate, '2026-07-09');
});

test('an all-cash year overwrites the current holdings snapshot with an empty list', () => {
  applyTestSnapshot();
  settleRevenueData(new Date(2026, 6, 10));
  assert.equal(state.yearlyHoldings[0].holdings.length, 1);
  state.holdings[0].quantity = 0;
  invalidateComputeCache();
  settleRevenueData(new Date(2026, 7, 1));
  const entry = state.yearlyHoldings.find((item) => item.year === 2026);
  assert.equal(entry.totalMarketValueCny, 0);
  assert.deepEqual(entry.holdings, []);
});

test('dividend yield derives from manual capital pair when prior year-end is missing', () => {
  // 没有 2024 年末净值：股息率的分母用手填「资金收益 + 收益率」反推的年初净值。
  applyTestSnapshot({
    yearlyManual: [{ year: 2025, dividendCny: 7000, capitalReturnCny: 12000, capitalReturnRate: 0.06, yearEndNetCny: 228500 }]
  });
  const row = computeIncomeSummary('2026-07-10').rows.find((item) => item.year === 2025);
  assert.equal(row.dividendYieldRate, 7000 / (12000 / 0.06));
  assert.equal(row.capitalReturnCny, 12000);
  assert.equal(row.capitalReturnRate, 0.06);
});
