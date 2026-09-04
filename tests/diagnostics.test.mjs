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
const { getDividendChangeReview } = diagnosticsModule;

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

/* 股息增减复核：与股息页减派标记同一口径（除息日回推一年 ±75 天找可比笔）。
   日期相对真实今天构造，避免固定日期随时间腐烂。 */
const DAY = 86400000;
const label = (daysAgo) => new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10);

test('股息增减复核：减派、增派、持平与无可比分别归位', () => {
  const recentEx = 30;            // 最近一笔：30 天前除息
  const priorEx = 30 + 365;       // 去年同期：正好一年前
  applySnapshot({
    version: 5,
    holdings: [
      { localId: 1, symbol: 'CUT.HK', name: '减派股', quantity: 100, bucket: 'income' },
      { localId: 2, symbol: 'RAISE.HK', name: '增派股', quantity: 100, bucket: 'income' },
      { localId: 3, symbol: 'FLAT.HK', name: '持平股', quantity: 100, bucket: 'core' },
      { localId: 4, symbol: 'NEW.HK', name: '首派股', quantity: 100, bucket: 'core' },
      { localId: 5, symbol: 'OLD.HK', name: '停派股', quantity: 100, bucket: 'core' },
      { localId: 6, symbol: 'GONE.HK', name: '已清仓', quantity: 0, bucket: 'core' }
    ],
    quotes: {
      'CUT.HK': { name: '减派股', price: 10, currency: 'HKD', dividends: [
        { exDate: label(priorEx), amountPerShare: 0.2, currency: 'HKD' },
        { exDate: label(recentEx), amountPerShare: 0.15, currency: 'HKD' }
      ] },
      'RAISE.HK': { name: '增派股', price: 10, currency: 'HKD', dividends: [
        { exDate: label(priorEx), amountPerShare: 0.2, currency: 'HKD' },
        { exDate: label(recentEx), amountPerShare: 0.25, currency: 'HKD' }
      ] },
      'FLAT.HK': { name: '持平股', price: 10, currency: 'HKD', dividends: [
        { exDate: label(priorEx), amountPerShare: 0.2, currency: 'HKD' },
        { exDate: label(recentEx), amountPerShare: 0.2, currency: 'HKD' }
      ] },
      'NEW.HK': { name: '首派股', price: 10, currency: 'HKD', dividends: [
        { exDate: label(recentEx), amountPerShare: 0.1, currency: 'HKD' }
      ] },
      'OLD.HK': { name: '停派股', price: 10, currency: 'HKD', dividends: [
        { exDate: label(500), amountPerShare: 0.3, currency: 'HKD' },
        { exDate: label(500 + 365), amountPerShare: 0.3, currency: 'HKD' }
      ] },
      'GONE.HK': { name: '已清仓', price: 10, currency: 'HKD', dividends: [
        { exDate: label(priorEx), amountPerShare: 0.5, currency: 'HKD' },
        { exDate: label(recentEx), amountPerShare: 0.1, currency: 'HKD' }
      ] }
    },
    rates: { CNY: 1, USD: 7, HKD: 1 },
    dividendLedger: [], dailySnapshots: [], cashFlows: [], trades: [], yearlyManual: [], yearlyArchives: [], yearlyHoldings: []
  });
  invalidateComputeCache();

  const model = getDividendChangeReview();
  assert.equal(model.cuts.length, 1, '只有减派股进减派组（清仓股不参与）');
  assert.equal(model.cuts[0].symbol, 'CUT.HK');
  assert.ok(Math.abs(model.cuts[0].change - (0.15 / 0.2 - 1)) < 1e-9, '0.2 → 0.15 是 −25%');
  assert.equal(model.cuts[0].priorPerShare, 0.2);
  assert.equal(model.raises.length, 1);
  assert.equal(model.raises[0].symbol, 'RAISE.HK');
  assert.ok(Math.abs(model.raises[0].change - 0.25) < 1e-9, '0.2 → 0.25 是 +25%');
  assert.equal(model.flatCount, 1, '持平股沉底计数');
  assert.equal(model.unratedCount, 2, '首派无可比 + 停派超窗口都归入无可比');
});

test('公告中的未来除息也参与增减复核，并标记已公告', () => {
  applySnapshot({
    version: 5,
    holdings: [{ localId: 1, symbol: 'ANN.HK', name: '公告股', quantity: 100, bucket: 'income' }],
    quotes: {
      'ANN.HK': { name: '公告股', price: 10, currency: 'HKD', dividends: [
        { exDate: label(340), amountPerShare: 0.2, currency: 'HKD' },
        { exDate: label(-25), amountPerShare: 0.15, currency: 'HKD', status: 'announced' }
      ] }
    },
    rates: { CNY: 1, USD: 7, HKD: 1 },
    dividendLedger: [], dailySnapshots: [], cashFlows: [], trades: [], yearlyManual: [], yearlyArchives: [], yearlyHoldings: []
  });
  invalidateComputeCache();

  const model = getDividendChangeReview();
  assert.equal(model.cuts.length, 1);
  assert.equal(model.cuts[0].announced, true);
  assert.ok(Math.abs(model.cuts[0].change - (0.15 / 0.2 - 1)) < 1e-9);
});

test('同日常规 + 特别息先加总再比：合计增派不能被逐笔误报成减派', () => {
  applySnapshot({
    version: 5,
    holdings: [{ localId: 1, symbol: 'SPL.HK', name: '特别息股', quantity: 100, bucket: 'income' }],
    quotes: {
      'SPL.HK': { name: '特别息股', price: 10, currency: 'HKD', dividends: [
        { exDate: label(340), amountPerShare: 0.0949, currency: 'HKD' },
        { exDate: label(-25), amountPerShare: 0.0728, currency: 'HKD', status: 'announced' },
        { exDate: label(-25), amountPerShare: 0.0291, currency: 'HKD', status: 'announced' }
      ] }
    },
    rates: { CNY: 1, USD: 7, HKD: 1 },
    dividendLedger: [], dailySnapshots: [], cashFlows: [], trades: [], yearlyManual: [], yearlyArchives: [], yearlyHoldings: []
  });
  invalidateComputeCache();

  const model = getDividendChangeReview();
  assert.equal(model.cuts.length, 0, '不能报减派');
  assert.equal(model.raises.length, 1);
  assert.ok(Math.abs(model.raises[0].amountPerShare - (0.0728 + 0.0291)) < 1e-9, '细则里的现值是同日加总');
  assert.ok(Math.abs(model.raises[0].change - ((0.0728 + 0.0291) / 0.0949 - 1)) < 1e-9);
});

test('两侧带类型时只比常规部分：去年含特别息不算今年减派', () => {
  applySnapshot({
    version: 5,
    holdings: [{ localId: 1, symbol: 'JM.HK', name: '金茂型', quantity: 100, bucket: 'income' }],
    quotes: {
      'JM.HK': { name: '金茂型', price: 10, currency: 'HKD', dividends: [
        { exDate: label(340), amountPerShare: 0.153, currency: 'HKD', source: 'yahoo',
          components: [{ amountPerShare: 0.087, currency: 'HKD', kind: 'regular' }, { amountPerShare: 0.066, currency: 'HKD', kind: 'special' }] },
        { exDate: label(-25), amountPerShare: 0.107, currency: 'HKD', status: 'announced', kind: 'regular' }
      ] }
    },
    rates: { CNY: 1, USD: 7, HKD: 1 },
    dividendLedger: [], dailySnapshots: [], cashFlows: [], trades: [], yearlyManual: [], yearlyArchives: [], yearlyHoldings: []
  });
  invalidateComputeCache();

  const model = getDividendChangeReview();
  assert.equal(model.cuts.length, 0, '总额 0.153 → 0.107 不是减派');
  assert.equal(model.raises.length, 1);
  assert.equal(model.raises[0].priorPerShare, 0.087, '细则里去年只报常规部分');
  assert.ok(Math.abs(model.raises[0].change - (0.107 / 0.087 - 1)) < 1e-9);
});
