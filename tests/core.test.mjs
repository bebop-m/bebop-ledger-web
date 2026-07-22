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
const {
  state, applySnapshot, invalidateComputeCache, createDemoSnapshot,
  ignoreDividendLedgerEntry, buildPortfolioSnapshot
} = stateModule;
const {
  computeCashBalance, computeCashFlowRecords, computeTradeSummary, computeDividendCalendar,
  computeDividendRecords, computeIncomeSummary, computeHoldings, getBucketSummaryItems, getAnnualDividendOverview
} = computeModule;
const { settleRevenueData } = revenueModule;

// 与 state.js 的 formatDateLabel 一样按本地时区取日期，避免跨时区差一天。
function shiftToday(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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

test('demo records preserve buy and sell directions', () => {
  applySnapshot(createDemoSnapshot());
  const trades = computeTradeSummary();
  const cash = computeCashFlowRecords();
  assert.equal(trades.count, 6);
  assert.equal(trades.records.filter((entry) => entry.side === 'buy').length, 3);
  assert.equal(trades.records.filter((entry) => entry.side === 'sell').length, 3);
  assert.equal(trades.records.find((entry) => entry.id === 'demo_tr_6').side, 'sell');
  assert.equal(cash.count, 4);
});

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
  // due（到账日已过但未确认）计入「即将到账」，这样 已到账 + 即将到账 恒等于 全年预计。
  assert.equal(metrics.dueCny, 10);
  assert.equal(metrics.upcomingCny, 10);
  assert.equal(metrics.projectedCny, 10);
  assert.equal(metrics.receivedCny + metrics.upcomingCny, metrics.projectedCny);

  state.quotes['TEST.HK'].dividends[0].payDate = '2026-07-08';
  settleRevenueData(new Date(2026, 6, 10));
  assert.equal(state.dividendLedger[0].payDate, '2026-07-08');

  state.dividendLedger[0].confidence = 'manual';
  state.dividendLedger[0].payDate = '2026-07-09';
  state.quotes['TEST.HK'].dividends[0].payDate = '2026-07-12';
  settleRevenueData(new Date(2026, 6, 10));
  assert.equal(state.dividendLedger[0].payDate, '2026-07-09');
});

test('a current-cash snapshot is not replayed when historical dividend records change', () => {
  applyTestSnapshot({
    currentCashCny: 1000,
    currentCashAsOfDate: '2026-07-10',
    dividendLedger: [{
      id: 'div_manual',
      sourceId: 'TEST.HK|2026-06-02|1',
      symbol: 'TEST.HK',
      exDate: '2026-06-02',
      payDate: '2026-07-08',
      receivedDate: '',
      amountPerShare: 1,
      currency: 'HKD',
      shares: 10,
      fxRate: 1,
      taxRate: 0,
      grossCny: 10,
      netCny: 10,
      bucket: 'core',
      receiptStatus: 'due',
      confidence: 'manual',
      confirmed: false
    }]
  });

  assert.equal(computeCashBalance(), 1000);
  let income = computeIncomeSummary('2026-07-10').rows.find((row) => row.year === 2026);
  assert.equal(income.dividendCny, 0);
  let item = computeDividendCalendar('2026-07-10').allDetails.find((entry) => entry.id === 'div_manual');
  assert.equal(item.status, 'due');

  state.dividendLedger[0].confirmed = true;
  state.dividendLedger[0].receivedDate = '2026-07-08';
  assert.equal(computeCashBalance(), 1000);
  income = computeIncomeSummary('2026-07-10').rows.find((row) => row.year === 2026);
  assert.equal(income.dividendCny, 10);
  item = computeDividendCalendar('2026-07-10').allDetails.find((entry) => entry.id === 'div_manual');
  assert.equal(item.status, 'received');
});

test('cash balance applies deposits, withdrawals, trade direction, fees and confirmed dividends', () => {
  applyTestSnapshot({
    openingDate: '2026-01-01',
    openingCashCny: 100,
    cashFlows: [
      { id: 'deposit', date: '2026-02-01', amountCny: 50, type: 'deposit' },
      { id: 'withdrawal', date: '2026-02-02', amountCny: 20, type: 'withdrawal' }
    ],
    trades: [
      { id: 'buy', date: '2026-03-01', symbol: 'TEST.HK', side: 'buy', shares: 10, price: 20, currency: 'CNY', fxRate: 1, feeCny: 5, bucket: 'core' },
      { id: 'sell', date: '2026-04-01', symbol: 'TEST.HK', side: 'sell', shares: 2, price: 25, currency: 'CNY', fxRate: 1, feeCny: 1, bucket: 'core' }
    ],
    dividendLedger: [{
      id: 'confirmed', sourceId: 'TEST.HK|2026-05-01|1', symbol: 'TEST.HK', exDate: '2026-05-01',
      receivedDate: '2026-05-10', amountPerShare: 1, shares: 10, currency: 'CNY', fxRate: 1,
      grossCny: 10, netCny: 10, confirmed: true, bucket: 'core'
    }]
  });
  assert.equal(computeCashBalance(), -16);
  assert.equal(state.currentCashCny, -16);
  assert.equal(state.positionOpeningDate, '2026-01-01');
  assert.equal(computeHoldings().holdings[0].quantity, 18);
});

test('future legacy cash date migrates without changing the actual holding quantity', () => {
  // 这条迁移只在“旧数据把开仓日填到了未来”时触发，日期必须相对今天算，
  // 否则写死的未来日期迟早会变成过去，测试会凭空失败。
  const futureOpeningDate = shiftToday(30);
  const tradeDate = shiftToday(-14);
  applyTestSnapshot({
    holdings: [{ localId: 1, symbol: '600519.SH', quantity: 1300, bucket: 'core' }],
    quotes: { '600519.SH': { name: '贵州茅台', price: 1400, currency: 'CNY', dividends: [] } },
    openingDate: futureOpeningDate,
    openingCashCny: -366813,
    trades: [{
      id: 'moutai-buy', date: tradeDate, symbol: '600519.SH', side: 'buy',
      shares: 100, price: 1187, currency: 'CNY', fxRate: 1, feeCny: 17.26, bucket: 'core'
    }]
  });

  const summary = computeHoldings();
  assert.equal(state.currentCashCny, -366813);
  assert.equal(state.positionOpeningDate, tradeDate);
  assert.equal(summary.holdings[0].quantity, 1400);
  assert.equal(summary.cashBalanceCny, -366813);
  assert.equal(summary.netMarketValueCny, 1593187);
});

test('direct current cash stays exact even when historical records exist', () => {
  applyTestSnapshot({
    currentCashCny: 345678.9,
    currentCashAsOfDate: '2026-07-17',
    positionOpeningDate: '2026-01-01',
    cashFlows: [{ id: 'old-deposit', date: '2026-06-01', amountCny: 50000, type: 'deposit' }],
    trades: [{ id: 'old-buy', date: '2026-06-02', symbol: 'TEST.HK', side: 'buy', shares: 2, price: 20, currency: 'CNY', fxRate: 1, feeCny: 1, bucket: 'core' }]
  });
  assert.equal(computeCashBalance(), 345678.9);
});

test('confirmed dividends appear as records without becoming duplicate cash flows', () => {
  applyTestSnapshot({
    dividendLedger: [
      {
        id: 'received', sourceId: 'TEST.HK|2026-05-01|1', symbol: 'TEST.HK', exDate: '2026-05-01',
        payDate: '2026-05-08', receivedDate: '2026-05-10', amountPerShare: 1, shares: 10,
        currency: 'CNY', fxRate: 1, grossCny: 10, netCny: 9, confirmed: true, note: '券商实收'
      },
      {
        id: 'pending', sourceId: 'TEST.HK|2026-06-01|1', symbol: 'TEST.HK', exDate: '2026-06-01',
        payDate: '2026-06-08', amountPerShare: 1, shares: 10, currency: 'CNY', fxRate: 1,
        grossCny: 10, netCny: 9, confirmed: false
      }
    ]
  });
  const dividends = computeDividendRecords();
  assert.equal(dividends.count, 1);
  assert.equal(dividends.totalCny, 9);
  assert.equal(dividends.records[0].date, '2026-05-10');
  assert.equal(dividends.records[0].name, 'Test');
  assert.equal(computeCashFlowRecords().count, 0);
});

test('bucket summaries and all three holding sorts use the same computed values', () => {
  applyTestSnapshot({
    holdings: [
      { localId: 1, symbol: 'CORE.HK', quantity: 10, bucket: 'core' },
      { localId: 2, symbol: 'INCOME.HK', quantity: 20, bucket: 'income' }
    ],
    quotes: {
      'CORE.HK': { name: 'Core', price: 10, currency: 'CNY', dividendPerShareTtm: 0.2, dividends: [] },
      'INCOME.HK': { name: 'Income', price: 5, currency: 'CNY', dividendPerShareTtm: 1, dividends: [] }
    }
  });
  let summary = computeHoldings();
  const buckets = getBucketSummaryItems(summary.holdings);
  assert.deepEqual(buckets.map((item) => [item.key, item.marketValueCny, item.totalDividendCny, item.averageYield]), [
    ['core', 100, 2, 0.02],
    ['income', 100, 20, 0.2]
  ]);

  state.sortField = 'effectiveYield'; state.sortDirection = 'desc'; invalidateComputeCache();
  assert.equal(computeHoldings().holdings[0].symbol, 'INCOME.HK');
  state.sortField = 'netAnnualDividendCny'; state.sortDirection = 'asc'; invalidateComputeCache();
  assert.equal(computeHoldings().holdings[0].symbol, 'CORE.HK');
  state.sortField = 'marketValueCny'; state.sortDirection = 'desc'; invalidateComputeCache();
  summary = computeHoldings();
  assert.equal(summary.holdings.length, 2);
});

test('annual dividend overview reports expected cashflow, remaining amount, progress and yield', () => {
  const overview = getAnnualDividendOverview({ metrics: { projectedCny: 120, receivedCny: 45 } }, { totalMarketValueCny: 2000 });
  assert.deepEqual(overview, {
    projectedCny: 120,
    receivedCny: 45,
    waitingCny: 75,
    receivedRatio: 0.375,
    annualYield: 0.06
  });
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

test('删除的股息不会被自动结算重建，且跨端 sourceId 格式都能挡住', () => {
  const seed = () => {
    applyTestSnapshot({
      holdings: [{ localId: 1, symbol: 'TEST.HK', quantity: 10, bucket: 'income' }],
      quotes: {
        'TEST.HK': {
          name: 'Test', price: 10, currency: 'HKD',
          dividends: [{ exDate: '2026-06-02', payDate: '2026-06-20', amountPerShare: 1, currency: 'HKD', source: 'yahoo' }]
        }
      }
    });
  };

  seed();
  settleRevenueData(new Date(2026, 6, 10));
  assert.equal(state.dividendLedger.length, 1);
  const sourceId = state.dividendLedger[0].sourceId;

  ignoreDividendLedgerEntry(sourceId);
  assert.equal(state.dividendLedger.length, 0);
  settleRevenueData(new Date(2026, 6, 11));
  assert.equal(state.dividendLedger.length, 0, '删除后不得被结算重建');

  // 忽略名单必须随快照同步，否则换设备/云端回灌后又会复活
  assert.ok(buildPortfolioSnapshot().dividendLedgerIgnored.includes(sourceId));

  /* 结算脚本(Python)拼整数金额得到 "1.0"，前端得到 "1"。
     名单里存的若是另一端的写法，也必须挡得住。 */
  seed();
  settleRevenueData(new Date(2026, 6, 10));
  state.dividendLedger = [];
  state.dividendLedgerIgnored = ['TEST.HK|2026-06-02|1.0|HKD'];
  invalidateComputeCache();
  settleRevenueData(new Date(2026, 6, 12));
  assert.equal(state.dividendLedger.length, 0, '跨端 sourceId 格式也必须匹配');
});

test('删除某一年的股息不会连带挡掉这只股票以后年份的同期派息', () => {
  /* 真实场景：4 月才买入的股票，被功能按「当前持仓」倒推出一笔 3 月的假股息。
     删掉它之后，公司之后每年 3 月照常派息，必须能正常入账——
     忽略名单按完整 sourceId（含除息日）匹配，不能退化成按「股票+月份」匹配。 */
  applyTestSnapshot({
    holdings: [{ localId: 1, symbol: '01023.HK', quantity: 300000, bucket: 'income' }],
    quotes: {
      '01023.HK': {
        name: '时代集团控股', price: 1, currency: 'HKD',
        dividends: [{ exDate: '2026-03-26', payDate: '2026-04-27', amountPerShare: 0.02, currency: 'HKD', source: 'yahoo' }]
      }
    },
    rates: { CNY: 1, USD: 7, HKD: 0.9 }
  });
  settleRevenueData(new Date(2026, 6, 21));
  const fake = state.dividendLedger.find((entry) => entry.exDate === '2026-03-26');
  assert.ok(fake, '应先由自动结算生成这笔倒推记录');
  ignoreDividendLedgerEntry(fake.sourceId);
  assert.equal(state.dividendLedger.length, 0);

  for (const [exDate, payDate, year] of [
    ['2027-03-25', '2027-04-26', 2027],
    ['2028-03-24', '2028-04-25', 2028]
  ]) {
    state.quotes['01023.HK'].dividends.push({ exDate, payDate, amountPerShare: 0.02, currency: 'HKD', source: 'yahoo' });
    invalidateComputeCache();
    settleRevenueData(new Date(year, 5, 1));
    assert.ok(
      state.dividendLedger.some((entry) => entry.exDate === exDate),
      `${year} 年同期派息不应被 ${fake.sourceId} 的删除连带挡掉`
    );
  }
  assert.deepEqual(state.dividendLedgerIgnored, [fake.sourceId], '忽略名单不应扩散');
});

test('数据源小幅修订金额后，已删除的股息不会复活，但不影响以后年份', () => {
  /* 墓碑按「股票 + 除息日」匹配而非完整 sourceId：
     金额被数据源改一点（1 → 1.01）就会让完整 ID 变样，删掉的记录随即复活。 */
  applyTestSnapshot({
    holdings: [{ localId: 1, symbol: 'TEST.HK', quantity: 10, bucket: 'income' }],
    quotes: {
      'TEST.HK': {
        name: 'Test', price: 10, currency: 'HKD',
        dividends: [{ exDate: '2026-06-02', payDate: '2026-06-20', amountPerShare: 1, currency: 'HKD', source: 'yahoo' }]
      }
    }
  });
  settleRevenueData(new Date(2026, 6, 10));
  ignoreDividendLedgerEntry(state.dividendLedger[0].sourceId);

  for (const amount of [1.01, 0.98, 1.5]) {
    state.quotes['TEST.HK'].dividends[0].amountPerShare = amount;
    invalidateComputeCache();
    settleRevenueData(new Date(2026, 6, 11));
    assert.equal(state.dividendLedger.length, 0, `金额修订为 ${amount} 后不应复活`);
  }

  state.quotes['TEST.HK'].dividends.push({ exDate: '2027-06-02', payDate: '2027-06-20', amountPerShare: 1, currency: 'HKD', source: 'yahoo' });
  invalidateComputeCache();
  settleRevenueData(new Date(2027, 6, 1));
  assert.ok(state.dividendLedger.some((e) => e.exDate === '2027-06-02'), '以后年份的同期派息必须照常入账');
});

test('月份详情的已到账/待核对/即将到账互不重叠，相加等于当月合计', () => {
  // upcomingCny 已含 dueCny，展示时若不扣减，同一笔钱会在两栏各出现一次。
  applyTestSnapshot({
    holdings: [{ localId: 1, symbol: 'TEST.HK', quantity: 10, bucket: 'income' }],
    quotes: {
      'TEST.HK': {
        name: 'Test', price: 10, currency: 'HKD',
        dividends: [{ exDate: '2026-07-02', payDate: '2026-07-05', amountPerShare: 1, currency: 'HKD', source: 'yahoo' }]
      }
    }
  });
  settleRevenueData(new Date(2026, 6, 21));
  const item = computeDividendCalendar('2026-07-21', 'all').months[6];
  assert.ok(item.dueCny > 0, '应先构造出一笔待核对');
  const restUpcoming = Math.max(0, item.upcomingCny - item.dueCny);
  assert.equal(item.receivedCny + item.dueCny + restUpcoming, item.totalCny);
});

test('台账里混有结算脚本格式的 sourceId 时，前端不会重复追加同一笔派息', () => {
  /* 结算脚本把整数金额拼成 "1.0"，前端拼成 "1"。台账由两端共同写入，
     若按原字符串比对，前端会认不出脚本写的那条，再追加一条，导致重复计账。 */
  applyTestSnapshot({
    holdings: [{ localId: 1, symbol: 'TEST.HK', quantity: 10, bucket: 'income' }],
    quotes: {
      'TEST.HK': {
        name: 'Test', price: 10, currency: 'HKD',
        dividends: [{ exDate: '2026-06-02', payDate: '2026-06-20', amountPerShare: 1, currency: 'HKD', source: 'yahoo' }]
      }
    },
    dividendLedger: [{
      id: 'div_x', sourceId: 'TEST.HK|2026-06-02|1.0|HKD', symbol: 'TEST.HK',
      exDate: '2026-06-02', payDate: '2026-06-20', amountPerShare: 1, currency: 'HKD',
      shares: 10, sharesSource: 'manual', fxRate: 1, taxRate: 0, grossCny: 10, netCny: 10,
      bucket: 'income', receiptStatus: 'received', confidence: 'manual', confirmed: true
    }]
  });
  settleRevenueData(new Date(2026, 6, 10));
  assert.equal(state.dividendLedger.length, 1, '不得因 ID 写法不同而重复追加');
  assert.equal(state.dividendLedger[0].sourceId, 'TEST.HK|2026-06-02|1.0|HKD', '应保留已存储的 sourceId');
});
