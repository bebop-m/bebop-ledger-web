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

test('打工仓超过硬上限且无股息时自动列为严重问题', async () => {
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
  assert.ok(diagnostics.critical.some((item) => item.title === '打工仓超过 10% 上限'));
  assert.ok(diagnostics.critical.some((item) => item.title === '近两年没有常规股息'));
  assert.ok(diagnostics.actionableCount >= 2);
});
