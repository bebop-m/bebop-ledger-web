import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = {
  getElementById: () => null,
  querySelectorAll: () => [],
  querySelector: () => null
};
globalThis.localStorage = { getItem: () => null, setItem: () => {} };

const stateModule = await import('../src/state.js');
const fundamentalsModule = await import('../src/fundamentals.js');
const annalsModule = await import('../src/annals.js');
const { state, applySnapshot, invalidateComputeCache } = stateModule;
const { loadFundamentals } = fundamentalsModule;
const { computeYearAnnals } = annalsModule;

function applyTestSnapshot(overrides = {}) {
  applySnapshot({
    version: 2,
    holdings: [{ localId: 1, symbol: '00700.HK', quantity: 1000, bucket: 'core' }],
    quotes: {
      '00700.HK': { name: '腾讯控股', price: 500, currency: 'HKD', dividends: [] },
      '600519.SH': { name: '贵州茅台', price: 1600, currency: 'CNY', dividends: [] }
    },
    rates: { CNY: 1, USD: 7.2, HKD: 0.92 },
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

test('year annals: 本年收益率 from interval simple method and fx/eps/valuation attribution', async () => {
  applyTestSnapshot({
    dailySnapshots: [
      { date: '2024-12-31', netCny: 510000, totalMarketValueCny: 510000, liabilityCny: 0, holdings: [], rates: { CNY: 1, USD: 7.1, HKD: 0.90 } },
      { date: '2025-12-31', netCny: 620000, totalMarketValueCny: 620000, liabilityCny: 0, holdings: [], rates: { CNY: 1, USD: 7.2, HKD: 0.92 } }
    ],
    yearlyHoldings: [
      { year: 2024, date: '2024-12-31', source: 'auto', totalMarketValueCny: 510000, holdings: [
        { symbol: '00700.HK', name: '腾讯控股', shares: 1000, bucket: 'core', currency: 'HKD', price: 400, marketValueCny: 360000 },
        { symbol: '600519.SH', name: '贵州茅台', shares: 100, bucket: 'core', currency: 'CNY', price: 1500, marketValueCny: 150000 }
      ] },
      { year: 2025, date: '2025-12-31', source: 'auto', totalMarketValueCny: 620000, holdings: [
        { symbol: '00700.HK', name: '腾讯控股', shares: 1000, bucket: 'core', currency: 'HKD', price: 500, marketValueCny: 460000 },
        { symbol: '600519.SH', name: '贵州茅台', shares: 100, bucket: 'core', currency: 'CNY', price: 1600, marketValueCny: 160000 }
      ] }
    ]
  });

  // 用真实加载路径注入基本面（EPS 序列），fetch 打桩。
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      ok: true,
      updatedAt: '2026-07-12T00:00:00Z',
      companies: {
        '00700.HK': { symbol: '00700.HK', name: 'TENCENT', currency: 'HKD', statementCurrency: 'CNY', years: [
          { year: 2024, eps: 20 }, { year: 2025, eps: 25 }
        ] },
        '600519.SH': { symbol: '600519.SH', name: 'MOUTAI', currency: 'CNY', statementCurrency: 'CNY', years: [
          { year: 2024, eps: 60 }, { year: 2025, eps: 63 }
        ] }
      }
    })
  });
  await loadFundamentals({ force: true });
  globalThis.fetch = previousFetch;

  const annals = computeYearAnnals(2025);
  assert.ok(annals);

  // 资金收益 = 620000 − 510000 − 0 = 110000
  assert.equal(annals.row.capitalReturnCny, 110000);

  // 本年收益率（区间简单法）= 110000 ÷ 510000 ≈ 21.57%
  assert.equal(annals.yearStartNetCny, 510000);
  assert.ok(annals.returnRate > 0.2156 && annals.returnRate < 0.2158);

  const att = annals.attribution;
  assert.equal(att.available, true);
  // 汇率贡献 = 1000 × 400 × (0.92 − 0.90) = 8000
  assert.ok(Math.abs(att.fxCny - 8000) < 1);
  // 价格贡献 = 110000 − 8000 = 102000
  assert.ok(Math.abs(att.priceCny - 102000) < 1);
  // EPS 贡献 = 360000×25% + 150000×5% = 97500；估值 = 150000×(6.67%−5%) = 2500
  assert.ok(Math.abs(att.epsCny - 97500) < 1);
  assert.ok(Math.abs(att.valuationCny - 2500) < 5);
  assert.ok(Math.abs(att.epsSplitCoverage - 1) < 1e-9);
});

test('year annals uses confirmed dividend calendar dates for monthly totals and 本年收益率', () => {
  applyTestSnapshot({
    dailySnapshots: [
      { date: '2024-12-31', netCny: 1000, totalMarketValueCny: 1000, holdings: [], rates: { CNY: 1, USD: 7.2, HKD: 0.92 } },
      { date: '2025-12-31', netCny: 1100, totalMarketValueCny: 1100, holdings: [], rates: { CNY: 1, USD: 7.2, HKD: 0.92 } }
    ],
    dividendLedger: [{
      id: 'confirmed-dividend', sourceId: '00700.HK|2025-05-20|1|HKD', symbol: '00700.HK',
      exDate: '2025-05-20', payDate: '2025-06-18', receivedDate: '2025-06-20',
      amountPerShare: 1, currency: 'HKD', shares: 10, fxRate: 1, taxRate: 0,
      grossCny: 10, netCny: 10, confirmed: true, receiptStatus: 'received'
    }]
  });

  const annals = computeYearAnnals(2025);
  assert.ok(annals);
  assert.equal(annals.dividendMonths[5], 10);
  // 本年收益率仍取区间简单法：资金收益 ÷ 年初净值，且为有限值。
  assert.equal(annals.yearStartNetCny, 1000);
  assert.ok(Number.isFinite(annals.returnRate));
});
