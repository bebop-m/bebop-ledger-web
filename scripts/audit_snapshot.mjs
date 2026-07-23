/* Read-only, privacy-safe end-to-end reconciliation.
   Reads a private snapshot from stdin and prints counts/booleans only. */
import { readFile } from 'node:fs/promises';

globalThis.document = { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const privateSnapshot = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const market = JSON.parse(await readFile(new URL('../data/market.json', import.meta.url), 'utf8'));

const { state, applySnapshot, invalidateComputeCache } = await import('../src/state.js');
const {
  computeHoldings, computeDividendRecords, computeIncomeSummary, getLedgerCalendarDate,
  getLedgerNetCny, getNormalizedDividendLedgerEntries
} = await import('../src/compute.js');
const { formatDateLabel, resolveFxRate, resolveQuoteCurrency, roundMoney, safeNumber } = await import('../src/utils.js');

applySnapshot({
  ...privateSnapshot,
  quotes: market.quotes || {},
  rates: { ...(privateSnapshot.rates || {}), ...(market.rates || {}) }
});
invalidateComputeCache();

// Independent quantity replay and current page net-value calculation.
const quantityBySymbol = new Map(state.holdings.map((holding) => [holding.symbol, safeNumber(holding.quantity, 0)]));
state.trades.forEach((trade) => {
  const date = formatDateLabel(trade && trade.date);
  if (state.positionOpeningDate && date < state.positionOpeningDate) return;
  const delta = Math.max(0, safeNumber(trade && trade.shares, 0)) * (trade.side === 'sell' ? -1 : 1);
  quantityBySymbol.set(trade.symbol, safeNumber(quantityBySymbol.get(trade.symbol), 0) + delta);
});

const computed = computeHoldings();
const sampleHoldings = computed.holdings.slice(0, 8);
let holdingFormulaMismatches = 0;
sampleHoldings.forEach((holding) => {
  const quote = state.quotes[holding.symbol] || {};
  const quantity = Math.max(0, safeNumber(quantityBySymbol.get(holding.symbol), 0));
  const currency = resolveQuoteCurrency(quote, holding.symbol);
  const independent = safeNumber(quote.price, 0) * quantity * resolveFxRate(currency, state.rates);
  if (Math.abs(independent - holding.marketValueCny) > 0.01) holdingFormulaMismatches += 1;
});
const independentMarketValue = computed.holdings.reduce((sum, holding) => {
  const quote = state.quotes[holding.symbol] || {};
  const quantity = Math.max(0, safeNumber(quantityBySymbol.get(holding.symbol), 0));
  return sum + safeNumber(quote.price, 0) * quantity * resolveFxRate(resolveQuoteCurrency(quote, holding.symbol), state.rates);
}, 0);
const independentNetValue = independentMarketValue
  + (state.currentCashCny === null ? 0 : safeNumber(state.currentCashCny, 0))
  - safeNumber(state.liabilityCny, 0);

// Raw ledger fields -> independent tax calculation -> records page projection.
const recordById = new Map(computeDividendRecords().records.map((entry) => [entry.id, entry]));
const sampleDividends = getNormalizedDividendLedgerEntries().filter((entry) => entry.confirmed === true).slice(0, 12);
let dividendFormulaMismatches = 0;
let storedNetOverrideCount = 0;
sampleDividends.forEach((entry) => {
  const gross = safeNumber(entry.grossCny, 0)
    || safeNumber(entry.amountPerShare, 0) * safeNumber(entry.shares, 0) * safeNumber(entry.fxRate, 1);
  const formulaNet = roundMoney(gross * (1 - Math.min(1, Math.max(0, safeNumber(entry.taxRate, 0)))));
  const storedNet = safeNumber(entry.netCny, 0);
  const independentNet = storedNet > 0 ? storedNet : formulaNet;
  if (storedNet > 0 && Math.abs(storedNet - formulaNet) > 0.01) storedNetOverrideCount += 1;
  const projected = recordById.get(entry.id);
  if (Math.abs(independentNet - getLedgerNetCny(entry)) > 0.01
    || !projected || Math.abs(projected.amountCny - independentNet) > 0.01
    || projected.date !== getLedgerCalendarDate(entry).date) dividendFormulaMismatches += 1;
});

// Confirmed ledger -> yearly page amount, excluding years with a manual dividend override.
const yearlyIndependent = new Map();
getNormalizedDividendLedgerEntries().forEach((entry) => {
  if (entry.confirmed !== true) return;
  const date = getLedgerCalendarDate(entry).date;
  const year = Number(date.slice(0, 4));
  if (year) yearlyIndependent.set(year, roundMoney(safeNumber(yearlyIndependent.get(year), 0) + getLedgerNetCny(entry)));
});
const manualDividendYears = new Set(state.yearlyManual
  .filter((entry) => entry.dividendCny !== null && entry.dividendCny !== undefined)
  .map((entry) => entry.year));
const incomeRows = computeIncomeSummary('2026-07-23', { filterKey: 'all' }).rows;
let yearlyFormulaMismatches = 0;
let sampledYears = 0;
incomeRows.forEach((row) => {
  if (!yearlyIndependent.has(row.year) || manualDividendYears.has(row.year)) return;
  sampledYears += 1;
  if (Math.abs(row.dividendCny - yearlyIndependent.get(row.year)) > 0.01) yearlyFormulaMismatches += 1;
});

process.stdout.write(JSON.stringify({
  sampledHoldings: sampleHoldings.length,
  holdingFormulaMismatches,
  netValueMatches: Math.abs(computed.netMarketValueCny - independentNetValue) <= 0.01,
  sampledConfirmedDividends: sampleDividends.length,
  storedNetOverrideCount,
  dividendFormulaMismatches,
  sampledYears,
  yearlyFormulaMismatches
}));
