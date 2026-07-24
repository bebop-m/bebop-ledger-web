import { state, refs, mutable, saveState, applySnapshot, showToast, showConfirm, buildPortfolioSnapshot, DEFAULT_QUOTES } from './state.js';
import { safeNumber, normalizeSymbol, mergeQuotes } from './utils.js';
import { canonicalDividendSourceId } from './utils.js';
import { computeHoldings, normalizeEconomicDividendEntries } from './compute.js';
import {
  GITHUB_TOKEN_STORAGE_KEY, GITHUB_PRIVATE_PORTFOLIO_CONTENTS_API, GITHUB_WATCHLIST_CONTENTS_API,
  GITHUB_MARKET_WORKFLOW_DISPATCH_API, MARKET_ENDPOINT, MARKET_DEPLOY_WAIT_TIMEOUT_MS,
  MARKET_DEPLOY_WAIT_INTERVAL_MS, SYNC_WAIT_POLL_INTERVAL_MS, SYNC_WAIT_MAX_ATTEMPTS,
  CLOUD_SUCCESS_FLASH_MS, LABELS, DEFAULT_HOLDINGS, PORTFOLIO_SNAPSHOT_FILENAME
} from './constants.js';
import { renderSavedStateQuietly } from './render.js';
import { refreshMarketData, decodeBase64Utf8 } from './network.js';

/* ── GitHub Token ── */
/* token 长期保存在 localStorage：这是自用 PWA，iOS 回收进程会清空 sessionStorage，
   若只存会话级则每次冷启动都要在手机上重新粘贴 PAT。 */
function getGithubToken() {
  const stored = (localStorage.getItem(GITHUB_TOKEN_STORAGE_KEY) || '').trim();
  if (stored) return stored;
  // 回收 2026-07 期间存进 sessionStorage 的 token，避免刚输过的人再输一次
  const sessionToken = (sessionStorage.getItem(GITHUB_TOKEN_STORAGE_KEY) || '').trim();
  if (sessionToken) {
    localStorage.setItem(GITHUB_TOKEN_STORAGE_KEY, sessionToken);
    sessionStorage.removeItem(GITHUB_TOKEN_STORAGE_KEY);
  }
  return sessionToken;
}
function saveGithubToken(token) { localStorage.setItem(GITHUB_TOKEN_STORAGE_KEY, token.trim()); }
function promptGithubToken() { const t = window.prompt(LABELS.syncTokenPrompt); if (!t || !t.trim()) return null; saveGithubToken(t); return t.trim(); }
function createGithubHeaders(token, extra = {}) { return { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, ...extra }; }

function encodeBase64Utf8(value) {
  const bytes = new TextEncoder().encode(String(value ?? ''));
  let binary = ''; bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

/* GitHub 的报错必须原样带出来：状态码 + 官方 message。否则一律吞成
   「请检查 Token 或仓库权限」，遇到 409 冲突、限流、网络问题时会把人引向错误方向。 */
function buildGithubError(status, message) {
  const err = new Error(message || `HTTP ${status}`);
  err.status = status;
  return err;
}

async function fetchGithubContentsEntry(apiUrl, token, opts = {}) {
  const r = await fetch(apiUrl, { headers: createGithubHeaders(token) });
  if (!r.ok) {
    if (opts.allowMissing && r.status === 404) return null;
    const ed = await r.json().catch(() => ({}));
    throw buildGithubError(r.status, ed.message);
  }
  return await r.json();
}

async function loadGithubJsonFile(apiUrl, token, opts = {}) {
  const entry = await fetchGithubContentsEntry(apiUrl, token, opts);
  if (!entry) return null;
  if (typeof entry.content !== 'string') throw new Error('github contents payload missing content');
  return { sha: typeof entry.sha === 'string' ? entry.sha : null, payload: JSON.parse(decodeBase64Utf8(entry.content.replace(/\n/g, ''))) };
}

async function saveGithubJsonFile(apiUrl, token, payload, message, opts = {}) {
  const hasExpectedSha = Object.prototype.hasOwnProperty.call(opts, 'expectedSha');
  const existing = hasExpectedSha ? null : await fetchGithubContentsEntry(apiUrl, token, { allowMissing: true });
  const body = { message, content: encodeBase64Utf8(JSON.stringify(payload, null, 2)) };
  const sha = hasExpectedSha ? opts.expectedSha : existing && existing.sha;
  if (typeof sha === 'string' && sha) body.sha = sha;
  const r = await fetch(apiUrl, { method: 'PUT', headers: createGithubHeaders(token, { 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
  if (!r.ok) { const ed = await r.json().catch(() => ({})); throw buildGithubError(r.status, ed.message); }
  return await r.json().catch(() => null);
}

/* ── Helpers ── */
function normalizeImportedSnapshotSource(payload) {
  const s = payload && payload.state ? payload.state : payload;
  if (s && Array.isArray(s.holdings)) return s;
  if (s && Array.isArray(s.positions)) return { ...s, holdings: s.positions };
  return null;
}

function isLocalPortfolioTemplateState() {
  const holdingsAreDefault = state.holdings.length > 0 && state.holdings.length === DEFAULT_HOLDINGS.length
    && state.holdings.every((h, i) => DEFAULT_HOLDINGS[i] && h.symbol === DEFAULT_HOLDINGS[i].symbol && h.quantity === DEFAULT_HOLDINGS[i].quantity);
  return holdingsAreDefault
    && !state.dividendLedger.length && !state.dailySnapshots.length && !state.cashFlows.length && !state.trades.length
    && !state.yearlyManual.length && !state.yearlyArchives.length && !state.yearlyHoldings.length
    && !state.dividendLedgerIgnored.length && !state.dividendLedgerTombstones.length
    && state.currentCashCny === null && safeNumber(state.liabilityCny, 0) === 0;
}

function getSyncEligibleSymbols(holdings = computeHoldings().holdings) {
  return Array.from(new Set((holdings || []).filter((i) => Math.max(0, safeNumber(i && i.quantity != null ? i.quantity : i && i.shares, 0)) > 0).map((i) => normalizeSymbol(i && i.symbol)).filter(Boolean)));
}

function recordTimestamp(entry) {
  return String(entry && (entry.updatedAt || entry.createdAt || entry.deletedAt) || '');
}

function preferRecord(remoteEntry, localEntry) {
  if (!remoteEntry) return localEntry;
  if (!localEntry) return remoteEntry;
  const remoteTime = recordTimestamp(remoteEntry);
  const localTime = recordTimestamp(localEntry);
  if (remoteTime && localTime && remoteTime !== localTime) return remoteTime > localTime ? remoteEntry : localEntry;
  return localEntry;
}

function mergeByKey(remoteItems, localItems, keyOf) {
  const merged = new Map();
  (Array.isArray(remoteItems) ? remoteItems : []).forEach((entry) => {
    const key = keyOf(entry);
    if (key) merged.set(key, entry);
  });
  (Array.isArray(localItems) ? localItems : []).forEach((entry) => {
    const key = keyOf(entry);
    if (key) merged.set(key, preferRecord(merged.get(key), entry));
  });
  return Array.from(merged.values());
}

function mergeTombstones(remoteValue, localValue) {
  const remote = remoteValue && typeof remoteValue === 'object' ? remoteValue : {};
  const local = localValue && typeof localValue === 'object' ? localValue : {};
  const union = (key, normalize = (value) => String(value || '').trim()) => Array.from(new Set([
    ...(Array.isArray(remote[key]) ? remote[key] : []),
    ...(Array.isArray(local[key]) ? local[key] : [])
  ].map(normalize).filter(Boolean)));
  const holdingDeletes = mergeByKey(remote.holdingDeletes, local.holdingDeletes, (entry) => normalizeSymbol(entry && entry.symbol));
  return {
    cashFlowIds: union('cashFlowIds'),
    tradeIds: union('tradeIds'),
    holdingSymbols: union('holdingSymbols', normalizeSymbol),
    holdingDeletes
  };
}

export function mergePortfolioSnapshots(remotePayload, localPayload) {
  const remote = normalizeImportedSnapshotSource(remotePayload) || {};
  const local = normalizeImportedSnapshotSource(localPayload) || {};
  const tombstones = mergeTombstones(remote.recordTombstones, local.recordTombstones);
  const holdingTombstones = new Set(tombstones.holdingSymbols);
  const holdingDeleteBySymbol = new Map(tombstones.holdingDeletes.map((entry) => [entry.symbol, entry]));
  const cashTombstones = new Set(tombstones.cashFlowIds);
  const tradeTombstones = new Set(tombstones.tradeIds);
  const holdings = local.holdings && local.holdings.length === 0
    ? []
    : mergeByKey(remote.holdings, local.holdings, (entry) => normalizeSymbol(entry && entry.symbol))
      .filter((entry) => {
        const symbol = normalizeSymbol(entry && entry.symbol);
        const deletion = holdingDeleteBySymbol.get(symbol);
        if (deletion && deletion.deletedAt) return recordTimestamp(entry) > deletion.deletedAt;
        if (!holdingTombstones.has(symbol)) return true;
        return Boolean((Array.isArray(local.holdings) ? local.holdings : [])
          .find((item) => normalizeSymbol(item && item.symbol) === symbol && recordTimestamp(item)));
      });
  const dividendLedger = normalizeEconomicDividendEntries(mergeByKey(
    remote.dividendLedger,
    local.dividendLedger,
    (entry) => canonicalDividendSourceId(entry && entry.sourceId)
  ));
  return {
    ...remote,
    ...local,
    type: 'portfolio-snapshot',
    holdings,
    dividendLedger,
    dailySnapshots: mergeByKey(remote.dailySnapshots, local.dailySnapshots, (entry) => String(entry && entry.date || '')),
    cashFlows: mergeByKey(remote.cashFlows, local.cashFlows, (entry) => String(entry && entry.id || ''))
      .filter((entry) => !cashTombstones.has(String(entry && entry.id || ''))),
    trades: mergeByKey(remote.trades, local.trades, (entry) => String(entry && entry.id || ''))
      .filter((entry) => !tradeTombstones.has(String(entry && entry.id || ''))),
    yearlyManual: mergeByKey(remote.yearlyManual, local.yearlyManual, (entry) => String(entry && entry.year || '')),
    yearlyArchives: mergeByKey(remote.yearlyArchives, local.yearlyArchives, (entry) => String(entry && entry.year || '')),
    yearlyHoldings: mergeByKey(remote.yearlyHoldings, local.yearlyHoldings, (entry) => String(entry && entry.year || '')),
    dividendLedgerIgnored: Array.from(new Set([
      ...(Array.isArray(remote.dividendLedgerIgnored) ? remote.dividendLedgerIgnored : []),
      ...(Array.isArray(local.dividendLedgerIgnored) ? local.dividendLedgerIgnored : [])
    ].map((entry) => String(entry || '').trim()).filter(Boolean))),
    dividendLedgerTombstones: mergeByKey(
      remote.dividendLedgerTombstones,
      local.dividendLedgerTombstones,
      (entry) => canonicalDividendSourceId(entry && entry.sourceId)
    ),
    recordTombstones: tombstones
  };
}

/* 把 GitHub 的状态码翻成人话。注意 404：Token 看不见私有仓时 GitHub 返回的是
   404 而不是 403，所以「找不到」和「没权限」必须一起提示，否则会误判成仓库被删。 */
function describeSyncFailure(error) {
  const status = error && error.status;
  const detail = (error && error.message ? String(error.message) : '').trim();
  const hint = {
    401: 'Token 无效或已过期，请重新填写',
    403: 'Token 没有该仓库的写入权限（细粒度 Token 需要 Contents: Read and write）',
    404: '仓库或路径不存在；也可能是 Token 未勾选这个私有仓的访问权限',
    409: '云端版本已变动，请再点一次同步',
    422: '提交内容被 GitHub 拒绝'
  }[status];
  if (!status) return `${LABELS.syncFailed}${detail ? `（${detail}）` : ''}`;
  return `同步失败 ${status}：${hint || detail || '未知错误'}${hint && detail ? `。GitHub：${detail}` : ''}`;
}

function buildSyncSuccessMessage(opts = {}) {
  const { restored = false, addedCount = 0, workflowTriggered = false, watchlistUpdateFailed = false } = opts;
  let msg = restored ? LABELS.cloudRestored : LABELS.syncSuccess;
  if (watchlistUpdateFailed) return `${msg}\uff0c\u4f46\u516c\u5f00\u89c2\u5bdf\u540d\u5355\u66f4\u65b0\u5931\u8d25\u3002`;
  if (addedCount > 0) { msg += `\uff0c${addedCount} \u53ea\u65b0\u80a1\u7968\u5df2\u52a0\u5165\u516c\u5f00\u89c2\u5bdf\u540d\u5355`; msg += workflowTriggered ? '\uff0c\u884c\u60c5\u66f4\u65b0\u5df2\u89e6\u53d1\u3002' : '\uff0c\u884c\u60c5\u5c06\u5728\u5b9a\u65f6\u4efb\u52a1\u4e2d\u8865\u9f50\u3002'; }
  return msg;
}

function setCloudSyncButtonBusy(isBusy) {
  state.cloudSyncing = isBusy; refs.exportButton.disabled = isBusy; refs.exportButton.classList.toggle('is-syncing', isBusy);
  if (isBusy) { window.clearTimeout(mutable.cloudSyncSuccessTimer); mutable.cloudSyncSuccessTimer = 0; refs.exportButton.classList.remove('is-success'); }
  refs.exportButton.setAttribute('aria-busy', isBusy ? 'true' : 'false');
}

function flashCloudSyncButtonSuccess() {
  window.clearTimeout(mutable.cloudSyncSuccessTimer);
  refs.exportButton.classList.remove('is-syncing'); refs.exportButton.classList.add('is-success');
  refs.exportButton.disabled = false; refs.exportButton.setAttribute('aria-busy', 'false');
  mutable.cloudSyncSuccessTimer = window.setTimeout(() => { refs.exportButton.classList.remove('is-success'); mutable.cloudSyncSuccessTimer = 0; }, CLOUD_SUCCESS_FLASH_MS);
}

function delay(ms) { return new Promise((resolve) => { window.setTimeout(resolve, ms); }); }

async function loadSiteMarketSnapshot() {
  const r = await fetch(MARKET_ENDPOINT + '?t=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) throw new Error('site market request failed: ' + r.status);
  return await r.json();
}

function hasRequiredMarketUpdate(payload, baseline = '', required = []) {
  const next = payload && typeof payload.updatedAt === 'string' ? payload.updatedAt : '';
  if (!next || next === baseline) return false;
  const q = payload && payload.quotes && typeof payload.quotes === 'object' ? payload.quotes : {};
  return required.every((s) => q[s]);
}

async function waitForDeployedMarketSnapshot(ctx = {}) {
  const { baselineUpdatedAt = '', requiredSymbols = [] } = ctx;
  const deadline = Date.now() + MARKET_DEPLOY_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await delay(MARKET_DEPLOY_WAIT_INTERVAL_MS);
    try { const p = await loadSiteMarketSnapshot(); if (hasRequiredMarketUpdate(p, baselineUpdatedAt, requiredSymbols)) return p; } catch (e) { console.warn('waiting for deployed market snapshot failed', e); }
  }
  return null;
}

async function runBackgroundMarketRefreshWait(ctx = {}) {
  try {
    const snap = await waitForDeployedMarketSnapshot(ctx); if (!snap) return false;
    let attempts = 0; while (state.syncing && attempts < SYNC_WAIT_MAX_ATTEMPTS) { attempts++; await delay(SYNC_WAIT_POLL_INTERVAL_MS); }
    await refreshMarketData({ silent: true });
    if (ctx.token) {
      const remote = await loadGithubJsonFile(GITHUB_PRIVATE_PORTFOLIO_CONTENTS_API, ctx.token, { allowMissing: true });
      const merged = mergePortfolioSnapshots(remote && remote.payload, buildPortfolioSnapshot());
      importSnapshot(merged);
      await saveGithubJsonFile(GITHUB_PRIVATE_PORTFOLIO_CONTENTS_API, ctx.token, buildPortfolioSnapshot(), 'sync: settle refreshed private portfolio', { expectedSha: remote && remote.sha });
    }
    flashCloudSyncButtonSuccess(); return true;
  } catch (e) { console.warn('background market refresh wait failed', e); return false; }
  finally { setCloudSyncButtonBusy(false); }
}

async function uploadPrivatePortfolioSnapshot(token, expectedSha) {
  await saveGithubJsonFile(GITHUB_PRIVATE_PORTFOLIO_CONTENTS_API, token, buildPortfolioSnapshot(), 'sync: update private portfolio snapshot', { expectedSha });
}

async function dispatchMarketUpdateWorkflow(token) {
  const r = await fetch(GITHUB_MARKET_WORKFLOW_DISPATCH_API, { method: 'POST', headers: createGithubHeaders(token, { 'Content-Type': 'application/json' }), body: JSON.stringify({ ref: 'main' }) });
  if (!r.ok) { const ed = await r.json().catch(() => ({})); throw new Error(ed.message || `HTTP ${r.status}`); }
}

async function syncPublicWatchlistFromPortfolio(token) {
  const file = await loadGithubJsonFile(GITHUB_WATCHLIST_CONTENTS_API, token);
  const payload = file && file.payload && typeof file.payload === 'object' ? file.payload : { symbols: [] };
  const existing = Array.isArray(payload.symbols) ? payload.symbols.map((s) => normalizeSymbol(s)).filter(Boolean) : [];
  const added = getSyncEligibleSymbols().filter((s) => !existing.includes(s));
  if (!added.length) return { addedSymbols: [], workflowTriggered: false };
  await saveGithubJsonFile(GITHUB_WATCHLIST_CONTENTS_API, token, { ...payload, symbols: existing.concat(added) }, 'sync: append symbols to public watchlist', { expectedSha: file && file.sha });
  let wt = false; try { await dispatchMarketUpdateWorkflow(token); wt = true; } catch (e) { console.warn('market update workflow dispatch failed', e); }
  return { addedSymbols: added, workflowTriggered: wt };
}

export async function syncPortfolioToCloud() {
  if (state.cloudSyncing) return;
  setCloudSyncButtonBusy(true);
  let token = getGithubToken(); if (!token) { token = promptGithubToken(); if (!token) { setCloudSyncButtonBusy(false); showToast(LABELS.syncTokenInvalid, { type: 'error' }); return; } }
  const localIsTemplate = isLocalPortfolioTemplateState();
  let restored = false, keepBusy = false, shouldFlash = false;
  try {
    const remote = await loadGithubJsonFile(GITHUB_PRIVATE_PORTFOLIO_CONTENTS_API, token, { allowMissing: true });
    if (localIsTemplate && !remote) { showToast(LABELS.syncNoPrivateSnapshot, { type: 'error' }); return; }
    const remoteSource = remote ? normalizeImportedSnapshotSource(remote.payload) : null;
    if (remote && (!remoteSource || !Array.isArray(remoteSource.holdings))) throw new Error('invalid private portfolio snapshot');
    const merged = localIsTemplate ? remoteSource : mergePortfolioSnapshots(remoteSource, buildPortfolioSnapshot());
    importSnapshot(merged);
    restored = localIsTemplate;
    const baseline = state.lastUpdatedAt;
    let wlResult = { addedSymbols: [], workflowTriggered: false }, wlFailed = false;
    try { wlResult = await syncPublicWatchlistFromPortfolio(token); } catch (e) { wlFailed = true; console.warn('public watchlist sync failed', e); }
    await refreshMarketData({ silent: true });
    await uploadPrivatePortfolioSnapshot(token, remote && remote.sha);
    showToast(buildSyncSuccessMessage({ restored, addedCount: wlResult.addedSymbols.length, workflowTriggered: wlResult.workflowTriggered, watchlistUpdateFailed: wlFailed }), { type: wlFailed ? 'error' : 'success' });
    if (wlResult.workflowTriggered && wlResult.addedSymbols.length) { keepBusy = true; void runBackgroundMarketRefreshWait({ baselineUpdatedAt: baseline, requiredSymbols: wlResult.addedSymbols.slice(), token }); }
    else { shouldFlash = true; }
  } catch (e) { console.warn('cloud sync failed', e); showToast(describeSyncFailure(e), { type: 'error' }); }
  finally { if (!keepBusy) { setCloudSyncButtonBusy(false); if (shouldFlash) flashCloudSyncButtonSuccess(); } }
}

export function exportPortfolioSnapshot() {
  try {
    const blob = new Blob([JSON.stringify(buildPortfolioSnapshot(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = PORTFOLIO_SNAPSHOT_FILENAME;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  } catch (e) { console.warn('export failed', e); showToast(LABELS.exportFailed, { type: 'error' }); }
}

export function importSnapshot(payload) {
  const src = normalizeImportedSnapshotSource(payload);
  if (!src || !Array.isArray(src.holdings)) throw new Error('invalid backup payload');
  applySnapshot(src); saveState(); renderSavedStateQuietly({ animateHoldingReflow: false });
}

export async function handleImportFile(event) {
  const file = event.target.files && event.target.files[0]; if (!file) return;
  try {
    const confirmed = await showConfirm(LABELS.importConfirm, { okLabel: '\u786e\u8ba4\u5bfc\u5165', cancelLabel: LABELS.cancel });
    if (!confirmed) return;
    importSnapshot(JSON.parse(await file.text())); await refreshMarketData({ silent: true });
  } catch (e) { console.warn('import failed', e); showToast(LABELS.importFailed, { type: 'error' }); }
  finally { refs.importFileInput.value = ''; }
}
