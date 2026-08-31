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
const diagnosticsModule = await import('../src/diagnostics.js');
const { applySnapshot, invalidateComputeCache } = stateModule;
const { loadFundamentals, getCompanyReturnModel } = fundamentalsModule;
const { getPortfolioDiagnostics } = diagnosticsModule;

test('经营回报用净利润增长桥接股本变化，不与 EPS 重复计算', async () => {
  const year = new Date().getFullYear();
  applySnapshot({
    version: 3,
    holdings: [{ localId: 1, symbol: 'TEST.HK', quantity: 20, bucket: 'income' }],
    quotes: { 'TEST.HK': { name: '测试公司', price: 100, previousClose: 100, currency: 'HKD', dividendPerShareTtm: 5, dividends: [] } },
    rates: { CNY: 1, USD: 7, HKD: 1 },
    dividendLedger: [], dailySnapshots: [], cashFlows: [], trades: [], yearlyManual: [], yearlyArchives: [], yearlyHoldings: []
  });
  invalidateComputeCache();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      ok: true,
      provider: 'test',
      updatedAt: `${year}-07-12T00:00:00Z`,
      companies: {
        'TEST.HK': {
          symbol: 'TEST.HK', currency: 'HKD', statementCurrency: 'HKD', years: [
            { year: year - 3, dividendPerShare: 5, netIncome: 100, eps: 1, sharesOutstanding: 100 },
            { year: year - 2, dividendPerShare: 5, netIncome: 110, eps: 2, sharesOutstanding: 95 },
            { year: year - 1, dividendPerShare: 5, netIncome: 121, eps: 4, sharesOutstanding: 90.25 }
          ]
        }
      }
    })
  });
  await loadFundamentals({ force: true });
  globalThis.fetch = previousFetch;

  const model = getCompanyReturnModel('TEST.HK');
  assert.equal(model.mode, 'profitBridge');
  assert.ok(Math.abs(model.growthRate - 0.1) < 1e-9);
  assert.ok(Math.abs(model.netBuybackYield - 0.05) < 1e-9);
  assert.ok(Math.abs(model.historicalReturn - 0.20) < 1e-9);
});

test('打工仓无常规股息时自动列为严重问题（仓位纪律已退役）', async () => {
  const year = new Date().getFullYear();
  applySnapshot({
    version: 3,
    holdings: [{ localId: 1, symbol: 'PDD', quantity: 20, bucket: 'income' }],
    quotes: { PDD: { name: '拼多多', price: 100, previousClose: 100, currency: 'USD', dividends: [] } },
    rates: { CNY: 1, USD: 7, HKD: 1 },
    dividendLedger: [], dailySnapshots: [], cashFlows: [], trades: [], yearlyManual: [], yearlyArchives: [], yearlyHoldings: []
  });
  invalidateComputeCache();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      ok: true,
      provider: 'test',
      updatedAt: `${year}-07-12T00:00:00Z`,
      companies: {
        PDD: { symbol: 'PDD', currency: 'USD', statementCurrency: 'CNY', years: [
          { year: year - 3, netIncome: 100, eps: 1, sharesOutstanding: 100 },
          { year: year - 2, netIncome: 130, eps: 1.2, sharesOutstanding: 105 },
          { year: year - 1, netIncome: 120, eps: 1.1, sharesOutstanding: 110 }
        ] }
      }
    })
  });
  await loadFundamentals({ force: true });
  globalThis.fetch = previousFetch;
  const diagnostics = getPortfolioDiagnostics();
  assert.ok(!diagnostics.items.some((item) => item.title.includes('打工仓')), '仓位纪律规则已退役，不应再产出条目');
  assert.ok(diagnostics.critical.some((item) => item.title === '近两年没有常规股息'));
  assert.ok(diagnostics.actionableCount >= 1);
});

test('小仓位低于诊断门槛，公司层面的发现不进诊断', async () => {
  const year = new Date().getFullYear();
  // BIG 占 99.7%、TINY 占 0.3%（低于 1% 门槛）。两家的财务同样在恶化。
  applySnapshot({
    version: 3,
    holdings: [
      { localId: 1, symbol: 'BIG.HK', quantity: 1000, bucket: 'core' },
      { localId: 2, symbol: 'TINY.HK', quantity: 3, bucket: 'core' }
    ],
    quotes: {
      'BIG.HK': { name: '大仓', price: 100, previousClose: 100, currency: 'HKD', dividends: [] },
      'TINY.HK': { name: '小仓', price: 100, previousClose: 100, currency: 'HKD', dividends: [] }
    },
    rates: { CNY: 1, USD: 7, HKD: 1 },
    dividendLedger: [], dailySnapshots: [], cashFlows: [], trades: [], yearlyManual: [], yearlyArchives: [], yearlyHoldings: []
  });
  invalidateComputeCache();
  const declining = (symbol) => ({
    symbol, currency: 'HKD', statementCurrency: 'HKD', years: [
      { year: year - 3, netIncome: 100, eps: 1, sharesOutstanding: 100 },
      { year: year - 2, netIncome: 90, eps: 0.9, sharesOutstanding: 100 },
      { year: year - 1, netIncome: 50, eps: 0.5, sharesOutstanding: 100 }
    ]
  });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      ok: true,
      provider: 'test',
      updatedAt: `${year}-07-12T00:00:00Z`,
      companies: { 'BIG.HK': declining('BIG.HK'), 'TINY.HK': declining('TINY.HK') }
    })
  });
  await loadFundamentals({ force: true });
  globalThis.fetch = previousFetch;

  const diagnostics = getPortfolioDiagnostics();
  assert.ok(diagnostics.items.some((item) => item.symbol === 'BIG.HK' && item.title === '净利润明显下降'));
  assert.ok(!diagnostics.items.some((item) => item.symbol === 'TINY.HK'));
  assert.equal(diagnostics.mutedHoldingCount, 1);
  assert.ok(diagnostics.mutedHoldingWeight > 0 && diagnostics.mutedHoldingWeight < 0.01);
});

test('角标只认严重档，关注与数据质量不计入', async () => {
  const year = new Date().getFullYear();
  applySnapshot({
    version: 3,
    holdings: [{ localId: 1, symbol: 'SOFT.HK', quantity: 100, bucket: 'core' }],
    quotes: { 'SOFT.HK': { name: '温和下滑', price: 100, previousClose: 100, currency: 'HKD', dividends: [] } },
    rates: { CNY: 1, USD: 7, HKD: 1 },
    dividendLedger: [], dailySnapshots: [], cashFlows: [], trades: [], yearlyManual: [], yearlyArchives: [], yearlyHoldings: []
  });
  invalidateComputeCache();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      ok: true,
      provider: 'test',
      updatedAt: `${year}-07-12T00:00:00Z`,
      companies: {
        // 同比 −15%：够 MATERIAL_DECLINE 但不到 −30%，落在关注档。
        'SOFT.HK': { symbol: 'SOFT.HK', currency: 'HKD', statementCurrency: 'HKD', years: [
          { year: year - 3, netIncome: 100, eps: 1, sharesOutstanding: 100 },
          { year: year - 2, netIncome: 100, eps: 1, sharesOutstanding: 100 },
          { year: year - 1, netIncome: 85, eps: 0.85, sharesOutstanding: 100 }
        ] }
      }
    })
  });
  await loadFundamentals({ force: true });
  globalThis.fetch = previousFetch;

  const diagnostics = getPortfolioDiagnostics();
  assert.ok(diagnostics.attention.some((item) => item.title === '净利润明显下降'));
  assert.equal(diagnostics.criticalCount, 0);
  assert.ok(diagnostics.actionableCount > diagnostics.criticalCount);
});
