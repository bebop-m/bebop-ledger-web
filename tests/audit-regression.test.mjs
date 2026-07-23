import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = {
  getElementById: () => null,
  querySelectorAll: () => [],
  querySelector: () => null
};
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const stateModule = await import('../src/state.js');
const computeModule = await import('../src/compute.js');
const revenueModule = await import('../src/revenue.js');
const utilsModule = await import('../src/utils.js');
const syncModule = await import('../src/sync.js');

const {
  state, applySnapshot, invalidateComputeCache, setCurrentCashBalance, adjustCashForRecordChange,
  ignoreDividendLedgerEntry
} = stateModule;
const {
  computeHoldings, computeIncomeSummary, computeTradeSummary, getEffectiveHoldingQuantityAtDate,
  normalizeEconomicDividendEntries, validateTradeInventory
} = computeModule;
const { settleRevenueData, archiveCompletedYears } = revenueModule;
const { roundMoney, roundTo, formatDateLabel } = utilsModule;
const { mergePortfolioSnapshots } = syncModule;

function applyBase(overrides = {}) {
  applySnapshot({
    version: 5,
    holdings: [],
    quotes: {},
    rates: { CNY: 1, USD: 7, HKD: 0.9 },
    liabilityCny: 0,
    currentCashCny: null,
    currentCashAsOfDate: '',
    positionOpeningDate: '2026-01-01',
    dividendLedger: [],
    dailySnapshots: [],
    cashFlows: [],
    trades: [],
    yearlyManual: [],
    yearlyArchives: [],
    yearlyHoldings: [],
    dividendLedgerIgnored: [],
    dividendLedgerTombstones: [],
    recordTombstones: { cashFlowIds: [], tradeIds: [], holdingSymbols: [] },
    ...overrides
  });
  invalidateComputeCache();
}

function ledgerEntry(amountPerShare, grossCny, extra = {}) {
  return {
    id: `d_${amountPerShare}_${extra.id || ''}`,
    sourceId: `TEST.HK|2026-06-02|${amountPerShare}|HKD`,
    symbol: 'TEST.HK', exDate: '2026-06-02', payDate: '2026-06-20',
    amountPerShare, currency: 'HKD', shares: 10, sharesSource: 'snapshotReplay',
    fxRate: 1, taxRate: 0, grossCny, netCny: grossCny, bucket: 'income',
    receiptStatus: 'due', confidence: 'snapshot', confirmed: false, ...extra
  };
}

test('independent reconciliation: market value, negative cash, debt and capped tax reach the same net value', () => {
  applyBase({
    holdings: [{ localId: 1, symbol: 'TEST.HK', quantity: 10, bucket: 'income', taxRateOverride: '120' }],
    quotes: { 'TEST.HK': { name: 'Test', price: 12, previousClose: 10, currency: 'HKD', dividendPerShareTtm: 2 } },
    currentCashCny: -20,
    currentCashAsOfDate: '2026-07-01',
    liabilityCny: 100
  });
  const summary = computeHoldings();
  const independentlyCalculatedMarketValue = 12 * 10 * 0.9;
  const independentlyCalculatedNetValue = independentlyCalculatedMarketValue - 20 - 100;
  assert.equal(summary.totalMarketValueCny, independentlyCalculatedMarketValue);
  assert.equal(summary.netMarketValueCny, independentlyCalculatedNetValue);
  assert.equal(summary.holdings[0].netAnnualDividendCny, 0, '120% tax must be capped at 100%');
  assert.equal(summary.holdings[0].totalAssetWeight, independentlyCalculatedMarketValue / (independentlyCalculatedMarketValue - 20));
});

test('money rounding is symmetric and invalid calendar dates are rejected', () => {
  assert.equal(roundMoney(1.005), 1.01);
  assert.equal(roundMoney(-1.005), -1.01);
  assert.equal(roundMoney(10.075), 10.08);
  assert.equal(roundMoney(-10.075), -10.08);
  assert.equal(roundTo(1.2345675, 6), 1.234568);
  assert.equal(roundTo(-1.2345675, 6), -1.234568);
  assert.equal(formatDateLabel('2026-02-30'), '');
  assert.equal(formatDateLabel('2026-12-31T23:30:00-08:00'), '2026-12-31');
});

test('economic dividend identity collapses aggregate/components but preserves two genuine components', () => {
  const aggregate = ledgerEntry(3, 30, { id: 'aggregate', eventSource: 'yahoo' });
  const componentA = ledgerEntry(1, 10, { id: 'a', sourceId: 'TEST.HK|2026-06-02|1|HKD', eventSource: 'etnet' });
  const componentB = ledgerEntry(2, 20, { id: 'b', sourceId: 'TEST.HK|2026-06-02|2|HKD', eventSource: 'etnet' });
  assert.deepEqual(normalizeEconomicDividendEntries([aggregate, componentA, componentB]).map((entry) => entry.grossCny), [30]);
  assert.deepEqual(normalizeEconomicDividendEntries([componentA, componentB]).map((entry) => entry.grossCny).sort((a, b) => a - b), [10, 20]);
  componentA.confirmed = true;
  componentB.confirmed = true;
  assert.deepEqual(
    normalizeEconomicDividendEntries([aggregate, componentA, componentB]).map((entry) => entry.grossCny).sort((a, b) => a - b),
    [10, 20],
    'confirmed components must beat an unconfirmed aggregate representation'
  );
  const sameSource = [aggregate, componentA, componentB].map((entry) => ({ ...entry, confirmed: false, eventSource: 'etnet' }));
  assert.equal(normalizeEconomicDividendEntries(sameSource).length, 3, 'same-source components must not be inferred away');
  const revisedAggregate = { ...aggregate, sourceId: 'TEST.HK|2026-06-02|3.01|HKD', grossCny: 30.1 };
  const revisedComponents = [componentA, componentB].map((entry) => ({ ...entry, confirmed: false }));
  assert.equal(normalizeEconomicDividendEntries([revisedAggregate, ...revisedComponents]).length, 1,
    'small cross-source revisions must use the same 0.5% tolerance as private settlement');
});

test('dividend freezes prior-day shares, FX and tax; an ex-date trade does not change entitlement', () => {
  applyBase({
    holdings: [{ localId: 1, symbol: 'TEST.HK', quantity: 100, bucket: 'income', taxRateOverride: '0' }],
    quotes: {
      'TEST.HK': { name: 'Test', price: 10, currency: 'HKD', dividends: [
        { exDate: '2026-06-02', payDate: '2026-06-20', amountPerShare: 1, currency: 'HKD', source: 'audit' }
      ] }
    },
    dailySnapshots: [{
      date: '2026-05-31', netCny: 90, totalMarketValueCny: 90,
      rates: { CNY: 1, USD: 7, HKD: 0.9 },
      holdings: [{ symbol: 'TEST.HK', shares: 100, bucket: 'income', taxRate: 0.2 }]
    }],
    trades: [
      { id: 'tr_1', date: '2026-06-01', createdAt: '2026-06-01T01:00:00Z', symbol: 'TEST.HK', side: 'buy', shares: 50, price: 10, currency: 'HKD', fxRate: 0.9 },
      { id: 'tr_2', date: '2026-06-02', createdAt: '2026-06-02T01:00:00Z', symbol: 'TEST.HK', side: 'buy', shares: 25, price: 10, currency: 'HKD', fxRate: 0.9 }
    ]
  });
  settleRevenueData(new Date(2026, 6, 1));
  const entry = state.dividendLedger[0];
  assert.equal(entry.shares, 150);
  assert.equal(entry.fxRate, 0.9);
  assert.equal(entry.taxRate, 0.2);
  assert.equal(entry.grossCny, 135);
  assert.equal(entry.netCny, 108);
  state.rates.HKD = 1.1;
  state.holdings[0].taxRateOverride = '50';
  settleRevenueData(new Date(2026, 6, 2));
  assert.deepEqual(
    { shares: state.dividendLedger[0].shares, fx: state.dividendLedger[0].fxRate, tax: state.dividendLedger[0].taxRate, net: state.dividendLedger[0].netCny },
    { shares: 150, fx: 0.9, tax: 0.2, net: 108 }
  );
});

test('missing historical anchor is surfaced by omission instead of current-holding backfill', () => {
  applyBase({
    positionOpeningDate: '',
    holdings: [{ localId: 1, symbol: 'TEST.HK', quantity: 100, bucket: 'income' }],
    quotes: { 'TEST.HK': { price: 10, currency: 'HKD', dividends: [
      { exDate: '2025-06-02', payDate: '2025-06-20', amountPerShare: 1, currency: 'HKD' }
    ] } }
  });
  settleRevenueData(new Date(2026, 6, 1));
  assert.equal(state.dividendLedger.length, 0);
});

test('same-day cash calibration and dividend confirmation are reversible in both operation orders', () => {
  applyBase({ currentCashCny: 0, currentCashAsOfDate: '2026-06-30' });
  const unconfirmed = { id: 'd1', confirmed: false, receivedDate: '', cashTrackedCny: null };
  state.dividendLedger = [unconfirmed];
  setCurrentCashBalance(100, '2026-07-01');
  const dateMoved = { ...state.dividendLedger[0], confirmed: true, receivedDate: '2026-07-02' };
  state.dividendLedger[0] = { ...state.dividendLedger[0], confirmed: true, receivedDate: '2026-06-30' };
  adjustCashForRecordChange(state.dividendLedger[0], 10, '2026-06-30', dateMoved, 10, '2026-07-02');
  assert.equal(state.currentCashCny, 100, 'moving the receipt date cannot replay a baseline-absorbed dividend');
  state.dividendLedger[0] = { ...unconfirmed, cashTrackedCny: 0 };
  const confirmed = { ...state.dividendLedger[0], confirmed: true, receivedDate: '2026-07-01' };
  adjustCashForRecordChange(state.dividendLedger[0], 0, '', confirmed, 10, confirmed.receivedDate);
  state.dividendLedger[0] = confirmed;
  assert.equal(state.currentCashCny, 110, 'confirmation after calibration is a new same-day cash event');
  const undone = { ...confirmed, confirmed: false, receivedDate: '' };
  adjustCashForRecordChange(confirmed, 10, confirmed.receivedDate, undone, 0, '');
  assert.equal(state.currentCashCny, 100);

  applyBase({ currentCashCny: 0, currentCashAsOfDate: '2026-06-30', dividendLedger: [unconfirmed] });
  const firstConfirmation = { ...state.dividendLedger[0], confirmed: true, receivedDate: '2026-07-01' };
  adjustCashForRecordChange(state.dividendLedger[0], 0, '', firstConfirmation, 10, firstConfirmation.receivedDate);
  state.dividendLedger[0] = firstConfirmation;
  assert.equal(state.currentCashCny, 10);
  setCurrentCashBalance(100, '2026-07-01');
  const afterRecalibrationUndo = { ...state.dividendLedger[0], confirmed: false, receivedDate: '' };
  adjustCashForRecordChange(state.dividendLedger[0], 10, '2026-07-01', afterRecalibrationUndo, 0, '');
  assert.equal(state.currentCashCny, 100, 'recalibration absorbs prior effects, so later unconfirm must not subtract again');
});

test('same-day snapshot is replaced after cash changes and keeps one canonical row', () => {
  applyBase({ currentCashCny: 100, currentCashAsOfDate: '2026-07-01' });
  settleRevenueData(new Date(2026, 6, 1));
  setCurrentCashBalance(250, '2026-07-01');
  invalidateComputeCache();
  settleRevenueData(new Date(2026, 6, 1));
  const rows = state.dailySnapshots.filter((entry) => entry.date === '2026-07-01');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cashCny, 250);
  assert.equal(rows[0].netCny, 250);
});

test('trade chronology rejects oversell and unknown opening cost is never reported as profit', () => {
  const holdings = [{ symbol: 'TEST.HK', quantity: 10 }];
  const buyThenSell = [
    { id: 'b', date: '2026-07-01', createdAt: '2026-07-01T01:00:00Z', symbol: 'TEST.HK', side: 'buy', shares: 5 },
    { id: 's', date: '2026-07-01', createdAt: '2026-07-01T02:00:00Z', symbol: 'TEST.HK', side: 'sell', shares: 15 }
  ];
  assert.equal(validateTradeInventory(buyThenSell, holdings, '2026-01-01').valid, true);
  assert.equal(validateTradeInventory(buyThenSell.slice().reverse().map((item, index) => ({ ...item, createdAt: `2026-07-01T0${index + 1}:00:00Z` })), holdings, '2026-01-01').valid, false);

  applyBase({
    holdings: [{ localId: 1, symbol: 'TEST.HK', quantity: 10, bucket: 'core' }],
    quotes: { 'TEST.HK': { price: 20, currency: 'HKD' } },
    trades: [{ id: 's1', date: '2026-07-01', symbol: 'TEST.HK', side: 'sell', shares: 5, price: 20, currency: 'HKD', fxRate: 1, feeCny: 0 }]
  });
  const position = computeTradeSummary().positions[0];
  assert.equal(position.realizedPnlComplete, false);
  assert.equal(position.realizedPnlCny, 0);
  assert.equal(getEffectiveHoldingQuantityAtDate('TEST.HK', '2026-07-01'), 5);
});

test('cross-year dividend uses received date and completed archives are rebuilt after changes', () => {
  applyBase({
    dailySnapshots: [
      { date: '2025-12-31', netCny: 1000, totalMarketValueCny: 1000, cashCny: 0, cashModelActive: true, rates: { CNY: 1, USD: 7, HKD: 1 }, holdings: [] },
      { date: '2026-12-31', netCny: 1110, totalMarketValueCny: 1110, cashCny: 10, cashModelActive: true, rates: { CNY: 1, USD: 7, HKD: 1 }, holdings: [] }
    ],
    dividendLedger: [{
      ...ledgerEntry(1, 10),
      sourceId: 'TEST.HK|2025-12-30|1|HKD', exDate: '2025-12-30', payDate: '2026-01-02',
      confirmed: true, receivedDate: '2026-01-02', receiptStatus: 'received'
    }]
  });
  archiveCompletedYears('2027-01-02');
  const row2026 = state.yearlyArchives.find((entry) => entry.year === 2026);
  assert.equal(row2026.dividendCny, 10);
  assert.equal(row2026.capitalReturnCny, 110);
  ignoreDividendLedgerEntry(state.dividendLedger[0].sourceId);
  invalidateComputeCache();
  archiveCompletedYears('2027-01-02');
  assert.equal(state.yearlyArchives.find((entry) => entry.year === 2026).dividendCny, 0);
});

test('manual overrides preserve signed year-end net value and remain higher priority than snapshots', () => {
  applyBase({
    dailySnapshots: [{ date: '2025-12-31', netCny: 100, totalMarketValueCny: 100, rates: { CNY: 1, USD: 7, HKD: 1 }, holdings: [] }],
    yearlyManual: [{ year: 2025, yearEndNetCny: -50, dividendCny: 5, netInflowCny: -20 }]
  });
  const row = computeIncomeSummary('2026-07-01').rows.find((entry) => entry.year === 2025);
  assert.equal(row.yearEndNetCny, -50);
  assert.equal(row.dividendCny, 5);
  assert.equal(row.netInflowCny, -20);
  assert.equal(row.fieldSources.yearEndNetCny, 'manual');
});

test('cloud merge retains remote-only records, applies tombstones, accepts all-cash, and normalizes dividends', () => {
  const remote = {
    holdings: [{ symbol: 'OLD.HK', quantity: 10 }],
    cashFlows: [{ id: 'remote_keep', date: '2026-01-01', amountCny: 10 }, { id: 'remote_delete', date: '2026-01-02', amountCny: 20 }],
    trades: [{ id: 'remote_trade', date: '2026-01-01', symbol: 'OLD.HK', shares: 1, price: 1 }],
    dividendLedger: [
      ledgerEntry(1, 10, { eventSource: 'etnet' }),
      ledgerEntry(2, 20, { eventSource: 'etnet' })
    ],
    recordTombstones: { cashFlowIds: [], tradeIds: [], holdingSymbols: [] }
  };
  const local = {
    holdings: [],
    cashFlows: [{ id: 'local_keep', date: '2026-02-01', amountCny: 30 }],
    trades: [],
    dividendLedger: [ledgerEntry(3, 30, { eventSource: 'yahoo' })],
    recordTombstones: { cashFlowIds: ['remote_delete'], tradeIds: ['remote_trade'], holdingSymbols: ['OLD.HK'] }
  };
  const merged = mergePortfolioSnapshots(remote, local);
  assert.deepEqual(merged.holdings, []);
  assert.deepEqual(merged.cashFlows.map((entry) => entry.id).sort(), ['local_keep', 'remote_keep']);
  assert.deepEqual(merged.trades, []);
  assert.equal(merged.dividendLedger.length, 1);
  assert.equal(merged.dividendLedger[0].grossCny, 30);

  const readded = mergePortfolioSnapshots(
    {
      holdings: [],
      recordTombstones: {
        cashFlowIds: [], tradeIds: [], holdingSymbols: ['OLD.HK'],
        holdingDeletes: [{ symbol: 'OLD.HK', deletedAt: '2026-01-01T00:00:00Z' }]
      }
    },
    {
      holdings: [{ symbol: 'OLD.HK', quantity: 5, updatedAt: '2026-02-01T00:00:00Z' }],
      recordTombstones: { cashFlowIds: [], tradeIds: [], holdingSymbols: [], holdingDeletes: [] }
    }
  );
  assert.equal(readded.holdings.length, 1, 'a later explicit re-add must beat an older deletion tombstone');
});
