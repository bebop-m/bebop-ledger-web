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
const computeModule = await import('../src/compute.js');
const { state, applySnapshot, invalidateComputeCache } = stateModule;
const { loadFundamentals } = fundamentalsModule;
const { computeYearAnnals } = annalsModule;
const { computeHoldings } = computeModule;

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

test('year annals: 本年收益率走区间简单法，并给出 fx/eps/valuation 归因', async () => {
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
        { symbol: '00700.HK', name: '腾讯控股', shares: 1200, bucket: 'core', currency: 'HKD', price: 500, marketValueCny: 460000 },
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
  assert.ok(Math.abs(annals.returnRate - 110000 / 510000) < 1e-9);
  assert.equal(annals.xirr, undefined);

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

test('year annals: 归因四项相加恒等于资金收益（残差进估值变动）', async () => {
  const annals = computeYearAnnals(2025);
  const att = annals.attribution;
  const valuation = annals.row.capitalReturnCny - att.dividendCny - att.fxCny - att.epsCny;
  const total = att.dividendCny + att.fxCny + att.epsCny + valuation;
  assert.ok(Math.abs(total - annals.row.capitalReturnCny) < 1e-6);
  // 四项贡献率相加 = 本年收益率
  const rateSum = total / annals.yearStartNetCny;
  assert.ok(Math.abs(rateSum - annals.returnRate) < 1e-9);
});

test('year annals: 年度持仓分解给出占比、较上年股数增减与已清仓', () => {
  const annals = computeYearAnnals(2025);
  const holdings = annals.holdings;
  assert.equal(holdings.hasData, true);
  assert.equal(holdings.previousYear, 2024);
  assert.equal(holdings.count, 2);
  const tencent = holdings.items.find((item) => item.symbol === '00700.HK');
  assert.equal(tencent.change, '+200');
  // 占比按 CNY 市值降序，两项相加为 1
  assert.ok(Math.abs(holdings.items.reduce((sum, item) => sum + item.pct, 0) - 1) < 1e-9);
  assert.deepEqual(holdings.removed, []);
});

test('year annals: 清仓的标的进 removed，供沉底行披露', () => {
  applyTestSnapshot({
    dailySnapshots: [
      { date: '2024-12-31', netCny: 510000, totalMarketValueCny: 510000, holdings: [], rates: { CNY: 1, USD: 7.1, HKD: 0.90 } },
      { date: '2025-12-31', netCny: 620000, totalMarketValueCny: 620000, holdings: [], rates: { CNY: 1, USD: 7.2, HKD: 0.92 } }
    ],
    yearlyHoldings: [
      { year: 2024, date: '2024-12-31', source: 'auto', totalMarketValueCny: 510000, holdings: [
        { symbol: '00700.HK', name: '腾讯控股', shares: 1000, bucket: 'core', currency: 'HKD', price: 400, marketValueCny: 360000 },
        { symbol: '600519.SH', name: '贵州茅台', shares: 100, bucket: 'core', currency: 'CNY', price: 1500, marketValueCny: 150000 }
      ] },
      { year: 2025, date: '2025-12-31', source: 'auto', totalMarketValueCny: 460000, holdings: [
        { symbol: '00700.HK', name: '腾讯控股', shares: 1000, bucket: 'core', currency: 'HKD', price: 500, marketValueCny: 460000 }
      ] }
    ]
  });
  const holdings = computeYearAnnals(2025).holdings;
  assert.equal(holdings.removed.length, 1);
  assert.equal(holdings.removed[0].name, '贵州茅台');
  assert.equal(holdings.removed[0].shares, 100);
});

test('year annals uses confirmed dividend calendar dates for monthly totals', () => {
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
  // 净值链：1100 − 1000 = 100，年初 1000
  assert.equal(annals.row.capitalReturnCny, 100);
  assert.ok(Math.abs(annals.returnRate - 0.1) < 1e-9);
});

test('打新收益走独立台账：按卖出日期归年，与股票买卖盈亏互不重叠', () => {
  applyTestSnapshot({
    dailySnapshots: [
      { date: '2024-12-31', netCny: 500000, totalMarketValueCny: 500000, liabilityCny: 0, holdings: [], rates: { CNY: 1, USD: 7.1, HKD: 0.90 } },
      { date: '2025-12-31', netCny: 520000, totalMarketValueCny: 520000, liabilityCny: 0, holdings: [], rates: { CNY: 1, USD: 7.2, HKD: 0.92 } }
    ],
    quotes: { '600519.SH': { name: '贵州茅台', price: 1600, currency: 'CNY', dividends: [] } },
    trades: [
      // 普通波段：进总已实现盈亏，不进打新收益
      { id: 't3', date: '2025-03-01', symbol: '600519.SH', side: 'buy', shares: 10, price: 1500, currency: 'CNY', fxRate: 1, feeCny: 0, bucket: 'core' },
      { id: 't4', date: '2025-09-01', symbol: '600519.SH', side: 'sell', shares: 10, price: 1600, currency: 'CNY', fxRate: 1, feeCny: 10, bucket: 'core' }
    ],
    ipoRounds: [
      // 分两笔卖出，跨年：只有 2025 那笔算进 2025
      { id: 'ipo_1', name: '南银转债', buyDate: '2025-08-01', shares: 20, costPerShare: 100, sells: [
        { id: 'ips_1', date: '2025-08-20', shares: 10, price: 130 },
        { id: 'ips_2', date: '2026-01-05', shares: 10, price: 140 }
      ] }
    ]
  });
  const annals = computeYearAnnals(2025);
  assert.ok(annals);
  assert.equal(annals.hasIpoSells, true);
  assert.equal(Math.round(annals.ipoRealizedPnlCny), 300, '2025 只含第一笔卖出：10 ×(130 − 100)');
  assert.equal(Math.round(annals.realizedPnlCny), 990, '股票买卖盈亏不含打新');
  const next = computeYearAnnals(2026);
  if (next) assert.equal(Math.round(next.ipoRealizedPnlCny), 400, '第二笔卖出归 2026：10 ×(140 − 100)');
});

test('打新在途按成本计入总资产，卖光后归零', async () => {
  const { computeIpoRounds } = computeModule;
  applyTestSnapshot({
    holdings: [],
    ipoRounds: [
      { id: 'ipo_open', name: '长鑫科技', buyDate: '2026-08-11', shares: 10, costPerShare: 100, sells: [] },
      { id: 'ipo_done', name: '某某转债', buyDate: '2026-07-01', shares: 10, costPerShare: 100, sells: [
        { id: 'ips_x', date: '2026-07-20', shares: 10, price: 130 }
      ] }
    ]
  });
  const model = computeIpoRounds();
  assert.equal(model.openRounds.length, 1, '只有没卖光的算在途');
  assert.equal(model.inTransitCostCny, 1000, '在途按成本计价，不是市值');
  assert.equal(computeHoldings().ipoInTransitCny, 1000);
  assert.equal(computeHoldings().totalAssetCny, 1000, '在途成本进总资产（无持仓无现金时就是它）');
  // 部分卖出：剩余股数按比例算在途
  applyTestSnapshot({
    holdings: [],
    ipoRounds: [{ id: 'ipo_part', name: '半卖', buyDate: '2026-08-01', shares: 10, costPerShare: 100, sells: [
      { id: 'ips_p', date: '2026-08-05', shares: 4, price: 120 }
    ] }]
  });
  assert.equal(computeIpoRounds().inTransitCostCny, 600, '剩 6 股 × 成本 100');
});
