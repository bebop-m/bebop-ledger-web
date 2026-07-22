import { state, refs, mutable, saveState, applySnapshot, showToast, showConfirm, buildPortfolioSnapshot, DEFAULT_QUOTES } from './state.js';
import { safeNumber, normalizeSymbol, mergeQuotes } from './utils.js';
import {
  GITHUB_TOKEN_STORAGE_KEY, GITHUB_PRIVATE_PORTFOLIO_CONTENTS_API, GITHUB_WATCHLIST_CONTENTS_API,
  GITHUB_MARKET_WORKFLOW_DISPATCH_API, MARKET_ENDPOINT, MARKET_DEPLOY_WAIT_TIMEOUT_MS,
  MARKET_DEPLOY_WAIT_INTERVAL_MS, SYNC_WAIT_POLL_INTERVAL_MS, SYNC_WAIT_MAX_ATTEMPTS,
  CLOUD_SUCCESS_FLASH_MS, LABELS, DEFAULT_HOLDINGS, PORTFOLIO_SNAPSHOT_FILENAME
} from './constants.js';
import { renderSavedStateQuietly } from './render.js';
import { refreshMarketData, decodeBase64Utf8 } from './network.js';

/* ── GitHub Token ── */
function getGithubToken() { return (localStorage.getItem(GITHUB_TOKEN_STORAGE_KEY) || '').trim(); }
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

async function saveGithubJsonFile(apiUrl, token, payload, message) {
  const existing = await fetchGithubContentsEntry(apiUrl, token, { allowMissing: true });
  const body = { message, content: encodeBase64Utf8(JSON.stringify(payload, null, 2)) };
  if (existing && typeof existing.sha === 'string' && existing.sha) body.sha = existing.sha;
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
  return state.holdings.length > 0 && state.holdings.length === DEFAULT_HOLDINGS.length &&
    state.holdings.every((h, i) => DEFAULT_HOLDINGS[i] && h.symbol === DEFAULT_HOLDINGS[i].symbol && h.quantity === DEFAULT_HOLDINGS[i].quantity);
}

function getSyncEligibleSymbols(holdings = state.holdings) {
  return Array.from(new Set((holdings || []).filter((i) => Math.max(0, safeNumber(i && i.quantity != null ? i.quantity : i && i.shares, 0)) > 0).map((i) => normalizeSymbol(i && i.symbol)).filter(Boolean)));
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
    await refreshMarketData({ silent: true }); flashCloudSyncButtonSuccess(); return true;
  } catch (e) { console.warn('background market refresh wait failed', e); return false; }
  finally { setCloudSyncButtonBusy(false); }
}

async function uploadPrivatePortfolioSnapshot(token) { await saveGithubJsonFile(GITHUB_PRIVATE_PORTFOLIO_CONTENTS_API, token, buildPortfolioSnapshot(), 'sync: update private portfolio snapshot'); }

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
  await saveGithubJsonFile(GITHUB_WATCHLIST_CONTENTS_API, token, { ...payload, symbols: existing.concat(added) }, 'sync: append symbols to public watchlist');
  let wt = false; try { await dispatchMarketUpdateWorkflow(token); wt = true; } catch (e) { console.warn('market update workflow dispatch failed', e); }
  return { addedSymbols: added, workflowTriggered: wt };
}

async function restoreFromCloud(token) {
  try {
    const file = await loadGithubJsonFile(GITHUB_PRIVATE_PORTFOLIO_CONTENTS_API, token, { allowMissing: true });
    if (!file) return { restored: false, reason: 'missing' };
    const src = normalizeImportedSnapshotSource(file.payload);
    if (!src || !Array.isArray(src.holdings) || !src.holdings.length) return { restored: false, reason: 'missing' };
    importSnapshot(src); return { restored: true };
  } catch (e) { console.warn('private portfolio restore failed', e); return { restored: false, reason: 'error', error: e }; }
}

export async function syncPortfolioToCloud() {
  if (state.cloudSyncing) return;
  setCloudSyncButtonBusy(true);
  let token = getGithubToken(); if (!token) { token = promptGithubToken(); if (!token) { setCloudSyncButtonBusy(false); showToast(LABELS.syncTokenInvalid, { type: 'error' }); return; } }
  const localIsTemplate = isLocalPortfolioTemplateState();
  let restored = false, keepBusy = false, shouldFlash = false;
  try {
    if (localIsTemplate) { const rr = await restoreFromCloud(token); if (rr.reason === 'error') { showToast(describeSyncFailure(rr.error), { type: 'error' }); return; } if (!rr.restored) { showToast(LABELS.syncNoPrivateSnapshot, { type: 'error' }); return; } restored = true; }
    else { await uploadPrivatePortfolioSnapshot(token); }
    const baseline = state.lastUpdatedAt;
    let wlResult = { addedSymbols: [], workflowTriggered: false }, wlFailed = false;
    try { wlResult = await syncPublicWatchlistFromPortfolio(token); } catch (e) { wlFailed = true; console.warn('public watchlist sync failed', e); }
    await refreshMarketData({ silent: true });
    showToast(buildSyncSuccessMessage({ restored, addedCount: wlResult.addedSymbols.length, workflowTriggered: wlResult.workflowTriggered, watchlistUpdateFailed: wlFailed }), { type: wlFailed ? 'error' : 'success' });
    if (wlResult.workflowTriggered && wlResult.addedSymbols.length) { keepBusy = true; void runBackgroundMarketRefreshWait({ baselineUpdatedAt: baseline, requiredSymbols: wlResult.addedSymbols.slice() }); }
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
