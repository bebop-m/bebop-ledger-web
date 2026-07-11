import { state, refs, invalidateComputeCache, saveState, showToast } from './state.js';
import {
  safeNumber, normalizeSymbol, normalizeDividendSource, chunkSymbols,
  toTencentSymbol, inferQuoteFromMap, mergeQuotes, setStaleDays, normalizeStaleDays
} from './utils.js';
import { settleRevenueData } from './revenue.js';
import {
  MARKET_ENDPOINT, OVERRIDE_ENDPOINT, CONFIG_ENDPOINT, TENCENT_REALTIME_ENDPOINT,
  TENCENT_BATCH_SIZE, TENCENT_REQUEST_TIMEOUT_MS, GITHUB_MARKET_CONTENTS_API,
  LABELS, DEFAULT_STALE_DAYS
} from './constants.js';
import { renderApp } from './render.js';

export function decodeBase64Utf8(value) {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

function getRealtimeSymbols() {
  return Array.from(new Set(state.holdings.map((i) => normalizeSymbol(i.symbol)).filter(Boolean)));
}

export function applyMarketPayload(payload) {
  invalidateComputeCache();
  if (payload && payload.rates) state.rates = { CNY: 1, USD: safeNumber(payload.rates.USD, state.rates.USD), HKD: safeNumber(payload.rates.HKD, state.rates.HKD) };
  if (payload && payload.quotes) state.quotes = mergeQuotes(state.quotes, payload.quotes);
  if (payload && typeof payload.updatedAt === 'string') state.lastUpdatedAt = payload.updatedAt;
}

export function applyDividendOverridePayload(payload) {
  if (!payload || typeof payload !== 'object') return 0;
  const overrides = {};
  Object.entries(payload).forEach(([raw, ov]) => {
    const symbol = normalizeSymbol(raw);
    if (!symbol || !ov || typeof ov !== 'object') return;
    overrides[symbol] = { symbol, dividendPerShareTtm: safeNumber(ov.dividendPerShareTtm, 0), dividendSource: 'manual', dividendUpdatedAt: typeof ov.updatedAt === 'string' ? ov.updatedAt : '', lastExDate: typeof ov.lastExDate === 'string' ? ov.lastExDate : '', dividendFetchError: '', dividendStatus: 'manual', reason: typeof ov.reason === 'string' ? ov.reason : '' };
  });
  if (Object.keys(overrides).length) { invalidateComputeCache(); state.quotes = mergeQuotes(state.quotes, overrides); }
  return Object.keys(overrides).length;
}

export function applyClientConfigPayload(payload) {
  if (!payload || typeof payload !== 'object') return;
  setStaleDays(normalizeStaleDays(payload.staleDays, DEFAULT_STALE_DAYS));
  state.discipline = normalizeDisciplineConfig(payload.discipline);
}

/* 纪律规则：config.json 一次性配置，前端只读。缺失或非法时返回 null（不做任何检查）。 */
function normalizeDisciplineConfig(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const ratio = (value, fallback) => {
    const parsed = safeNumber(value, fallback);
    return parsed > 0 && parsed <= 1 ? parsed : fallback;
  };
  return {
    incomeTargetMax: ratio(raw.incomeTargetMax, 0.05),
    incomeHardMax: ratio(raw.incomeHardMax, 0.1),
    debtRatioMax: ratio(raw.debtRatioMax, 0.65),
    dividendCutThreshold: ratio(raw.dividendCutThreshold, 0.1),
    fcfCoverageMin: Math.max(0, safeNumber(raw.fcfCoverageMin, 1)),
    dilutionMax: ratio(raw.dilutionMax, 0.01),
    exceptions: Array.isArray(raw.exceptions)
      ? raw.exceptions.map((symbol) => normalizeSymbol(symbol)).filter(Boolean)
      : []
  };
}

export async function loadClientConfigSnapshot() {
  const r = await fetch(CONFIG_ENDPOINT + '?t=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) throw new Error('config request failed: ' + r.status);
  return await r.json();
}

export async function loadLatestMarketSnapshot() {
  const errors = [];
  try { const r = await fetch(MARKET_ENDPOINT + '?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) throw new Error('site market request failed: ' + r.status); return await r.json(); } catch (e) { errors.push(e); }
  try {
    const r = await fetch(GITHUB_MARKET_CONTENTS_API + '?t=' + Date.now(), { cache: 'no-store', headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error('github contents request failed: ' + r.status);
    const p = await r.json(); if (p && typeof p.content === 'string') { return JSON.parse(decodeBase64Utf8(p.content.replace(/\n/g, ''))); }
    throw new Error('github contents payload missing content');
  } catch (e) { errors.push(e); }
  throw errors[0] || new Error('failed to load market snapshot');
}

export async function loadDividendOverrideSnapshot() {
  const r = await fetch(OVERRIDE_ENDPOINT + '?t=' + Date.now(), { cache: 'no-store' });
  if (r.status === 404) return {};
  if (!r.ok) throw new Error('override request failed: ' + r.status);
  return await r.json();
}

export async function loadTencentQuoteBatch(symbols) {
  const codes = [], codeMap = new Map();
  symbols.forEach((s) => { const c = toTencentSymbol(s); if (c) { codeMap.set(c, s); codes.push(c); } });
  if (!codes.length) return {};
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const tid = window.setTimeout(() => { script.remove(); reject(new Error('tencent realtime request timeout')); }, TENCENT_REQUEST_TIMEOUT_MS);
    script.async = true; script.src = `${TENCENT_REALTIME_ENDPOINT}${codes.join(',')}&_=${Date.now()}`;
    script.onload = () => { window.clearTimeout(tid); script.remove(); resolve(); };
    script.onerror = () => { window.clearTimeout(tid); script.remove(); reject(new Error('tencent realtime request failed')); };
    document.head.appendChild(script);
  });
  const quotes = {};
  codes.forEach((code) => {
    const key = `v_${code}`, payload = window[key];
    try { delete window[key]; } catch (_) { window[key] = undefined; }
    if (typeof payload !== 'string') return;
    const f = payload.split('~'); if (f.length < 5) return;
    const symbol = codeMap.get(code); if (!symbol) return;
    const fallback = inferQuoteFromMap(symbol, state.quotes);
    const price = safeNumber(f[3], safeNumber(f[4], 0)); if (price <= 0) return;
    const prevClose = safeNumber(f[4], 0);
    quotes[symbol] = { symbol, name: String(f[1] || fallback.name || symbol).trim() || fallback.name || symbol, market: fallback.market, currency: fallback.currency, price, previousClose: prevClose > 0 ? prevClose : 0 };
  });
  return quotes;
}

export async function loadRealtimeQuoteSnapshot() {
  const quotes = {};
  for (const batch of chunkSymbols(getRealtimeSymbols(), TENCENT_BATCH_SIZE)) Object.assign(quotes, await loadTencentQuoteBatch(batch));
  return quotes;
}

function getRefreshButtons() {
  return [refs.refreshButton].filter(Boolean);
}

export async function refreshMarketData(opts = {}) {
  const { silent = false } = opts;
  if (state.syncing) return;
  state.syncing = true;
  getRefreshButtons().forEach((btn) => { btn.disabled = true; btn.classList.add('is-syncing'); });
  let hasUpdates = false, lastError = null;
  try {
    try { applyClientConfigPayload(await loadClientConfigSnapshot()); } catch (e) { lastError = lastError || e; console.warn('config refresh failed', e); }
    try { const p = await loadLatestMarketSnapshot(); if (!p || p.ok === false) throw new Error(p && p.error ? p.error : 'invalid market payload'); applyMarketPayload(p); hasUpdates = true; } catch (e) { lastError = e; console.warn('snapshot refresh failed', e); }
    try { hasUpdates = applyDividendOverridePayload(await loadDividendOverrideSnapshot()) > 0 || hasUpdates; } catch (e) { lastError = lastError || e; console.warn('dividend override refresh failed', e); }
    try { const rq = await loadRealtimeQuoteSnapshot(); if (Object.keys(rq).length) { invalidateComputeCache(); state.quotes = mergeQuotes(state.quotes, rq); hasUpdates = true; } } catch (e) { lastError = lastError || e; console.warn('realtime quote refresh failed', e); }
    if (!hasUpdates) throw lastError || new Error('invalid market payload');
    settleRevenueData();
    saveState(); renderApp({ incremental: true, animateHoldingReflow: true });
  } catch (e) {
    console.warn('refresh failed', e);
    const settlement = settleRevenueData();
    if (settlement.changed) {
      saveState();
      renderApp({ incremental: true, animateHoldingReflow: false });
    }
    if (!silent) showToast(LABELS.refreshFailed, { type: 'error' });
  }
  finally { state.syncing = false; getRefreshButtons().forEach((btn) => { btn.disabled = false; btn.classList.remove('is-syncing'); }); }
}

export async function cleanupLegacyCaches() {
  try {
    if ('serviceWorker' in navigator) { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map((r) => r.unregister())); }
    if ('caches' in window) { const keys = await caches.keys(); await Promise.all(keys.filter((k) => k.startsWith('bopup-ledger')).map((k) => caches.delete(k))); }
  } catch (e) { console.warn('legacy cache cleanup failed', e); }
}
