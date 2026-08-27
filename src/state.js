import {
  DEFAULT_RATES, DEFAULT_HOLDINGS, DEFAULT_DIVIDEND_EVENTS, SEED_QUOTES, STORAGE_KEY,
  LABELS, TOAST_DEFAULT_DURATION_MS, CONFIRM_CLOSE_DELAY_MS,
  PORTFOLIO_SNAPSHOT_VERSION, PAGE_KEYS, LEGACY_PAGE_MAP, DIVIDEND_FILTER_KEYS
} from './constants.js';
import {
  safeNumber, roundMoney, clone, escapeHtml, normalizeSeedQuoteMap, mergeQuotes,
  sanitizeHolding, sanitizePerShareOverrideInput, normalizeSymbol,
  sanitizeDividendLedgerEntry, sanitizeDailySnapshotEntry,
  sanitizeCashFlowEntry, sanitizeYearlyManualEntry, sanitizeTradeEntry,
  sanitizeYearlyHoldingsEntry, sanitizeYearlyArchiveEntry, formatDateLabel, resolveEffectivePayDate,
  buildDividendSourceId, dividendIgnoreKey, sanitizeIpoRoundEntry
} from './utils.js';
// 环形依赖（compute.js ← state.js）安全：双方顶层都不调用对方，只有运行期函数体引用。
import { getEffectiveHoldingQuantityAtDate } from './compute.js';

/* ── Default Quotes (normalized from seed data) ── */
export const DEFAULT_QUOTES = normalizeSeedQuoteMap(SEED_QUOTES);

const DEMO_STORAGE_KEY = `${STORAGE_KEY}:demo-v1`;

export function isDemoMode() {
  return typeof window !== 'undefined' && /(?:^|[?&])demo=1(?:&|$)/.test(window.location.search);
}

function getActiveStorageKey() {
  return isDemoMode() ? DEMO_STORAGE_KEY : STORAGE_KEY;
}

/* ── Application State ── */
export const state = {
  holdings: [],
  quotes: {},
  rates: { ...DEFAULT_RATES },
  nextId: 1,
  showAmounts: true,
  activePage: 'home',
  dividendCalendarBucket: 'all',
  activeDividendMonth: null,
  activeAnnualYear: new Date().getFullYear(),
  sortField: 'marketValueCny',
  sortDirection: 'desc',
  legendExpanded: false,
  liabilityCny: 0,
  currentCashCny: null,
  currentCashAsOfDate: '',
  positionOpeningDate: '',
  dividendLedger: [],
  dailySnapshots: [],
  cashFlows: [],
  trades: [],
  /* 打新独立台账：与 trades 平行，不进持仓、不碰行情。一轮 = 一次中签的进出。 */
  ipoRounds: [],
  yearlyManual: [],
  yearlyArchives: [],
  yearlyHoldings: [],
  /* 用户手动删掉的股息 sourceId。台账是按行情派息事件自动生成的，
     不记下来的话下次结算会照原样再长回来。客户端与 Actions 结算脚本都要认这份名单。 */
  dividendLedgerIgnored: [],
  dividendLedgerTombstones: [],
  recordTombstones: { cashFlowIds: [], tradeIds: [], ipoRoundIds: [], holdingSymbols: [], holdingDeletes: [] },
  lastUpdatedAt: '',
  modal: null,
  modalPayload: null,
  syncing: false,
  cloudSyncing: false
};

/* 启动时本机到底有没有存档。「添加到主屏幕」生成的是一份全新存储，读不到存档时
   界面上摆的是出厂模板——这种设备只能从云端拉，绝不能把模板推上去盖掉真实账本。 */
export const bootstrap = { hadLocalArchive: false };

/* ── Shared mutable state across modules ── */
export const mutable = {
  activeHoldingSwipe: null,
  activeDividendTooltipButton: null,
  suppressHoldingClickUntil: 0,
  cloudSyncSuccessTimer: 0,
  // 年度回顾的「其余 N 项」是否展开。只活在本次会话里，切年份时归零。
  annualHoldingsExpanded: false,
  // 资金与交易页三段流水的展开状态。同样只活在本次会话里，不写进快照。
  recordsExpanded: { trade: false, ipo: false, cash: false, dividend: false },
  // 股息日历的回看年份：从年度回顾点进来时设为该年，正常导航清空（null = 当年实时）。
  dividendViewYear: null
};

/* ── Compute Cache ── */
let _computeGeneration = 0;
let _computeCache = null;
let _computeCacheGeneration = -1;

export function invalidateComputeCache() { _computeGeneration += 1; }
export function getComputeCache() {
  return _computeCacheGeneration === _computeGeneration ? _computeCache : null;
}
export function setComputeCache(result) {
  _computeCache = result;
  _computeCacheGeneration = _computeGeneration;
}

/* ── DOM Refs ── */
export const refs = {
  privacyButton: document.getElementById('privacyButton'),
  pageViews: Array.from(document.querySelectorAll('[data-page-view]')),
  homeHero: document.getElementById('homeHero'),
  homeFocusCard: document.getElementById('homeFocusCard'),
  homeNavList: document.getElementById('homeNavList'),
  pageBackButtons: Array.from(document.querySelectorAll('[data-page-back]')),
  quickAddButton: document.getElementById('quickAddButton'),
  dividendFilterGroup: document.getElementById('dividendFilterGroup'),
  dividendFilterButtons: Array.from(document.querySelectorAll('[data-dividend-filter]')),
  incomeSummaryPage: document.getElementById('incomeSummaryPage'),
  incomeOverviewGrid: document.getElementById('incomeOverviewGrid'),
  incomeTrend: document.getElementById('incomeTrend'),
  incomeYearList: document.getElementById('incomeYearList'),
  annualReviewContent: document.getElementById('annualReviewContent'),
  annualShareButton: document.getElementById('annualShareButton'),
  incomeRecordsList: document.getElementById('incomeRecordsList'),
  fundamentalsNote: document.getElementById('fundamentalsNote'),
  fundamentalsContent: document.getElementById('fundamentalsContent'),
  dividendMetricGrid: document.getElementById('dividendMetricGrid'),
  dividendMonthGrid: document.getElementById('dividendMonthGrid'),
  dividendCalendarListView: document.getElementById('dividendCalendarListView'),
  dividendMonthDetailView: document.getElementById('dividendMonthDetailView'),
  exportButton: document.getElementById('exportButton'),
  importButton: document.getElementById('importButton'),
  importFileInput: document.getElementById('importFileInput'),
  legendToggle: document.getElementById('legendToggle'),
  bucketTrack: document.getElementById('bucketTrack'),
  holdingsHero: document.getElementById('holdingsHero'),
  diagnosticsButton: document.getElementById('diagnosticsButton'),
  marketTimestamp: document.getElementById('marketTimestamp'),
  homePullIndicator: document.getElementById('homePullIndicator'),
  holdingsPullIndicator: document.getElementById('holdingsPullIndicator'),
  stockList: document.getElementById('stockList'),
  modalRoot: document.getElementById('modalRoot'),
  confirmRoot: document.getElementById('confirmRoot'),
  toastContainer: document.getElementById('toastContainer'),
  holdingsSortLabel: document.getElementById('holdingsSortLabel')
};

/* ── Toast & Confirm ── */
export function showToast(message, options = {}) {
  const { type = 'info', duration = TOAST_DEFAULT_DURATION_MS } = options;
  const el = document.createElement('div');
  el.className = `toast${type === 'error' ? ' is-error' : type === 'success' ? ' is-success' : ''}`;
  el.textContent = message;
  refs.toastContainer.appendChild(el);
  setTimeout(() => {
    el.classList.add('is-leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, duration);
}

export function showConfirm(message, options = {}) {
  const { sub = '', okLabel, cancelLabel, danger = false } = options;
  return new Promise((resolve) => {
    const okText = okLabel || LABELS.save || '\u786e\u8ba4';
    const cancelText = cancelLabel || LABELS.cancel || '\u53d6\u6d88';
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    refs.confirmRoot.innerHTML = `
      <div class="confirm-mask"></div>
      <section class="confirm-sheet${danger ? ' is-danger' : ''}" role="alertdialog" aria-modal="true" aria-labelledby="confirmMessage" aria-describedby="${sub ? 'confirmSub' : 'confirmMessage'}">
        <p class="confirm-message" id="confirmMessage">${escapeHtml(message)}</p>
        ${sub ? `<p class="confirm-sub" id="confirmSub">${escapeHtml(sub)}</p>` : ''}
        <div class="confirm-actions">
          <button class="confirm-button confirm-button--cancel" type="button" data-confirm="cancel">${escapeHtml(cancelText)}</button>
          <button class="confirm-button ${danger ? 'confirm-button--danger' : 'confirm-button--ok'}" type="button" data-confirm="ok">${escapeHtml(okText)}</button>
        </div>
      </section>
    `;
    document.body.classList.add('modal-open');
    let settled = false;
    function cleanup(result) {
      if (settled) return;
      settled = true;
      refs.confirmRoot.removeEventListener('click', handleClick);
      document.removeEventListener('keydown', handleKeydown, true);
      const mask = refs.confirmRoot.querySelector('.confirm-mask');
      const sheet = refs.confirmRoot.querySelector('.confirm-sheet');
      if (mask && sheet) {
        refs.confirmRoot.querySelectorAll('.confirm-button').forEach((b) => { b.disabled = true; });
        sheet.classList.add(result ? 'is-confirmed' : 'is-cancelled');
        window.setTimeout(() => { mask.classList.add('is-closing'); sheet.classList.add('is-closing'); }, CONFIRM_CLOSE_DELAY_MS);
        sheet.addEventListener('animationend', () => {
          refs.confirmRoot.innerHTML = '';
          document.body.classList.remove('modal-open');
          previousFocus && previousFocus.focus({ preventScroll: true });
          resolve(result);
        }, { once: true });
      } else {
        refs.confirmRoot.innerHTML = '';
        document.body.classList.remove('modal-open');
        previousFocus && previousFocus.focus({ preventScroll: true });
        resolve(result);
      }
    }
    function handleClick(event) {
      if (event.target.closest('.confirm-mask')) { cleanup(false); return; }
      const btn = event.target.closest('[data-confirm]');
      if (btn) cleanup(btn.dataset.confirm === 'ok');
    }
    function handleKeydown(event) {
      if (event.key === 'Escape') { event.preventDefault(); cleanup(false); }
    }
    refs.confirmRoot.addEventListener('click', handleClick);
    document.addEventListener('keydown', handleKeydown, true);
    requestAnimationFrame(() => {
      const target = refs.confirmRoot.querySelector('[data-confirm="cancel"]') || refs.confirmRoot.querySelector('[data-confirm="ok"]');
      target && target.focus({ preventScroll: true });
    });
  });
}

/* 把种子事件表展开成已到账的台账条目。年份补当年；股数取种子持仓的 100 股，
   金额按默认汇率折 CNY（税率种子里一律未设置，即 0%，与「税率纯手填」一致）。
   sourceId 走 buildDividendSourceId，好与行情侧的公告条目按同一把钥匙去重。 */
function buildDefaultDividendLedger(year) {
  const bySymbol = new Map(DEFAULT_HOLDINGS.map((item) => [item.symbol, item]));
  return DEFAULT_DIVIDEND_EVENTS.map((event, index) => {
    const holding = bySymbol.get(event.symbol);
    if (!holding) return null;
    const exDate = `${year}-${event.exDate}`;
    const payDate = `${year}-${event.payDate}`;
    const shares = safeNumber(holding.quantity, 0);
    const fxRate = event.currency === 'HKD' ? DEFAULT_RATES.HKD : event.currency === 'USD' ? DEFAULT_RATES.USD : 1;
    const grossCny = roundMoney(safeNumber(event.amountPerShare, 0) * shares * fxRate);
    return {
      id: `seed_div_${index + 1}`,
      sourceId: buildDividendSourceId({ symbol: event.symbol, exDate, amountPerShare: event.amountPerShare, currency: event.currency }),
      symbol: event.symbol,
      exDate,
      payDate,
      receivedDate: payDate,
      amountPerShare: event.amountPerShare,
      currency: event.currency,
      shares,
      sharesSource: 'seed',
      fxRate,
      taxRate: 0,
      grossCny,
      netCny: grossCny,
      bucket: holding.bucket === 'income' ? 'income' : 'core',
      confirmed: true,
      receiptStatus: 'received',
      confidence: 'confirmed',
      note: '',
      updatedAt: ''
    };
  }).filter(Boolean);
}

/* ── Snapshot & Persistence ── */
export function createDefaultSnapshot() {
  return {
    type: 'portfolio-snapshot',
    version: PORTFOLIO_SNAPSHOT_VERSION,
    holdings: clone(DEFAULT_HOLDINGS),
    quotes: clone(DEFAULT_QUOTES),
    rates: { ...DEFAULT_RATES },
    nextId: DEFAULT_HOLDINGS.length + 1,
    showAmounts: true,
    activePage: 'home',
    dividendCalendarBucket: 'all',
    activeDividendMonth: null,
    activeAnnualYear: new Date().getFullYear(),
    sortField: 'marketValueCny',
    sortDirection: 'desc',
    legendExpanded: false,
    liabilityCny: 0,
    currentCashCny: null,
    currentCashAsOfDate: '',
    positionOpeningDate: '',
    dividendLedger: buildDefaultDividendLedger(new Date().getFullYear()),
    dailySnapshots: [],
    cashFlows: [],
    trades: [],
    ipoRounds: [],
    yearlyManual: [],
    yearlyArchives: [],
    yearlyHoldings: [],
    dividendLedgerIgnored: [],
    dividendLedgerTombstones: [],
    recordTombstones: { cashFlowIds: [], tradeIds: [], ipoRoundIds: [], holdingSymbols: [], holdingDeletes: [] },
    lastUpdatedAt: ''
  };
}

export function createDemoSnapshot() {
  const snapshot = createDefaultSnapshot();
  const year = new Date().getFullYear();
  const previousYear = year - 1;
  const openingYear = year - 2;
  return {
    ...snapshot,
    currentCashCny: 160000,
    currentCashAsOfDate: `${year}-07-16`,
    positionOpeningDate: `${openingYear}-01-01`,
    cashFlows: [
      { id: 'demo_cf_1', date: `${previousYear}-01-10`, amountCny: 60000, type: 'deposit', note: '年度追加资金' },
      { id: 'demo_cf_2', date: `${previousYear}-08-05`, amountCny: 12000, type: 'withdrawal', note: '提取备用金' },
      { id: 'demo_cf_3', date: `${year}-02-15`, amountCny: 30000, type: 'deposit', note: '新增投资资金' },
      { id: 'demo_cf_4', date: `${year}-06-18`, amountCny: 8000, type: 'withdrawal', note: '阶段性取用' }
    ],
    trades: [
      { id: 'demo_tr_1', date: `${previousYear}-01-15`, symbol: '00700.HK', side: 'buy', shares: 400, price: 380, currency: 'HKD', fxRate: 0.92, feeCny: 28, bucket: 'core', note: '建立腾讯底仓' },
      { id: 'demo_tr_2', date: `${previousYear}-02-10`, symbol: '600519.SH', side: 'buy', shares: 20, price: 1480, currency: 'CNY', fxRate: 1, feeCny: 12, bucket: 'core', note: '分批买入' },
      { id: 'demo_tr_3', date: `${previousYear}-08-18`, symbol: '00700.HK', side: 'sell', shares: 100, price: 450, currency: 'HKD', fxRate: 0.92, feeCny: 24, bucket: 'core', note: '阶段止盈' },
      { id: 'demo_tr_4', date: `${year}-03-08`, symbol: 'PDD', side: 'buy', shares: 120, price: 105, currency: 'USD', fxRate: 7.22, feeCny: 36, bucket: 'income', note: '新增观察仓' },
      { id: 'demo_tr_5', date: `${year}-05-22`, symbol: 'PDD', side: 'sell', shares: 40, price: 125, currency: 'USD', fxRate: 7.22, feeCny: 24, bucket: 'income', note: '减仓锁定收益' },
      { id: 'demo_tr_6', date: `${year}-07-16`, symbol: '00700.HK', side: 'sell', shares: 100, price: 489, currency: 'HKD', fxRate: 0.92, feeCny: 20, bucket: 'core', note: '腾讯减仓' }
    ],
    yearlyManual: [
      { year: openingYear, dividendCny: 5800, yearEndNetCny: 205000, netInflowCny: 0, capitalReturnCny: 11000, capitalReturnRate: 0.0567 },
      { year: previousYear, dividendCny: 7395.28, yearEndNetCny: 267200, netInflowCny: 48000, capitalReturnCny: 14200, capitalReturnRate: 0.069268 },
      { year, dividendCny: 4200, yearEndNetCny: 308300, netInflowCny: 22000, capitalReturnCny: 19100, capitalReturnRate: 0.071482 }
    ],
    /* 年界汇率来源：归因里的汇率项要拿年初/年末两套汇率才算得出来。
       净值仍以 yearlyManual 为准（manual 优先），这里只提供汇率与年末持仓。 */
    dailySnapshots: [
      { date: `${openingYear}-12-31`, netCny: 205000, totalMarketValueCny: 205000, liabilityCny: 0, holdings: [], rates: { CNY: 1, USD: 7.1, HKD: 0.90 } },
      { date: `${previousYear}-12-31`, netCny: 267200, totalMarketValueCny: 267200, liabilityCny: 0, holdings: [], rates: { CNY: 1, USD: 7.2, HKD: 0.92 } }
    ],
    // 历年持仓快照：年度回顾的饼图、增减仓与已清仓行都靠它
    yearlyHoldings: [
      { year: previousYear, date: `${previousYear}-12-31`, source: 'auto', totalMarketValueCny: 264772, holdings: [
        { symbol: '00700.HK', name: '腾讯控股', shares: 260, bucket: 'core', currency: 'HKD', price: 500, marketValueCny: 119600 },
        { symbol: '00883.HK', name: '中国海洋石油', shares: 1800, bucket: 'income', currency: 'HKD', price: 19.5, marketValueCny: 32292 },
        { symbol: '601088.SH', name: '中国神华', shares: 800, bucket: 'income', currency: 'CNY', price: 40, marketValueCny: 32000 },
        { symbol: '600519.SH', name: '贵州茅台', shares: 20, bucket: 'core', currency: 'CNY', price: 1560, marketValueCny: 31200 },
        { symbol: '09618.HK', name: '京东集团', shares: 200, bucket: 'core', currency: 'HKD', price: 145, marketValueCny: 26680 },
        { symbol: '000651.SZ', name: '格力电器', shares: 500, bucket: 'income', currency: 'CNY', price: 46, marketValueCny: 23000 }
      ] },
      { year: openingYear, date: `${openingYear}-12-31`, source: 'auto', totalMarketValueCny: 204970, holdings: [
        { symbol: '00700.HK', name: '腾讯控股', shares: 200, bucket: 'core', currency: 'HKD', price: 415, marketValueCny: 74700 },
        { symbol: '601088.SH', name: '中国神华', shares: 800, bucket: 'income', currency: 'CNY', price: 38, marketValueCny: 30400 },
        { symbol: '600519.SH', name: '贵州茅台', shares: 20, bucket: 'core', currency: 'CNY', price: 1500, marketValueCny: 30000 },
        { symbol: '00941.HK', name: '中国移动', shares: 350, bucket: 'income', currency: 'HKD', price: 78, marketValueCny: 24570 },
        { symbol: '00883.HK', name: '中国海洋石油', shares: 1500, bucket: 'income', currency: 'HKD', price: 18, marketValueCny: 24300 },
        { symbol: '000651.SZ', name: '格力电器', shares: 500, bucket: 'income', currency: 'CNY', price: 42, marketValueCny: 21000 }
      ] }
    ]
  };
}

function roundCash(value) {
  return roundMoney(value);
}

function normalizeRecordTombstones(value) {
  const source = value && typeof value === 'object' ? value : {};
  const normalize = (items) => Array.from(new Set((Array.isArray(items) ? items : [])
    .map((id) => String(id || '').trim()).filter(Boolean)));
  return {
    cashFlowIds: normalize(source.cashFlowIds),
    tradeIds: normalize(source.tradeIds),
    ipoRoundIds: normalize(source.ipoRoundIds),
    holdingSymbols: normalize(source.holdingSymbols).map(normalizeSymbol).filter(Boolean),
    holdingDeletes: Array.from((Array.isArray(source.holdingDeletes) ? source.holdingDeletes : [])
      .reduce((map, item) => {
        const symbol = normalizeSymbol(item && item.symbol);
        if (!symbol) return map;
        const deletedAt = typeof item.deletedAt === 'string' ? item.deletedAt : '';
        const previous = map.get(symbol);
        if (!previous || deletedAt > previous.deletedAt) map.set(symbol, { symbol, deletedAt });
        return map;
      }, new Map()).values())
  };
}

function getTombstoneKey(type) {
  if (type === 'trade') return 'tradeIds';
  if (type === 'ipoRound') return 'ipoRoundIds';
  if (type === 'holding') return 'holdingSymbols';
  return 'cashFlowIds';
}

export function addRecordTombstone(type, id) {
  const key = getTombstoneKey(type);
  const value = type === 'holding' ? normalizeSymbol(id) : String(id || '').trim();
  if (!value) return false;
  if (!state.recordTombstones[key].includes(value)) state.recordTombstones[key].push(value);
  if (type === 'holding') {
    state.recordTombstones.holdingDeletes = state.recordTombstones.holdingDeletes
      .filter((item) => item.symbol !== value)
      .concat({ symbol: value, deletedAt: new Date().toISOString() });
  }
  return true;
}

/* 启动自愈：忽略名单/墓碑里的派息若还躺在台账里（老版本同步合并不应用墓碑，
   删掉的行会被云端旧快照并回来），启动时清掉。已确认与手动补录的行不动。
   返回清掉的条数，调用方决定要不要 saveState。 */
export function pruneIgnoredDividendLedgerRows() {
  const keys = new Set([
    ...state.dividendLedgerIgnored,
    ...state.dividendLedgerTombstones.map((item) => item && item.sourceId)
  ].map(dividendIgnoreKey).filter(Boolean));
  if (!keys.size) return 0;
  const before = state.dividendLedger.length;
  state.dividendLedger = state.dividendLedger.filter((entry) => {
    if (!entry) return false;
    if (entry.confirmed === true || entry.confidence === 'manual') return true;
    return !keys.has(dividendIgnoreKey(entry.sourceId));
  });
  const pruned = before - state.dividendLedger.length;
  if (pruned > 0) invalidateComputeCache();
  return pruned;
}

/* 启动清扫：录交易自动建的持仓在删单后可能残留 0 股空壳（733642 申购代码的教训——
   老版本删交易不清持仓，左滑删除又不一定被用户发现）。条件收得很紧才算孤儿：
   基准股 0 + 名下无任何交易 + 无任何股息台账记录。写墓碑，云同步后其他设备一并消失。
   返回清掉的条数，调用方决定要不要 saveState。 */
export function pruneOrphanHoldings() {
  const orphans = state.holdings.filter((holding) => holding
    && safeNumber(holding.quantity, 0) <= 0
    && !state.trades.some((trade) => trade && trade.symbol === holding.symbol)
    && !state.dividendLedger.some((entry) => entry && entry.symbol === holding.symbol));
  if (!orphans.length) return 0;
  invalidateComputeCache();
  state.holdings = state.holdings.filter((holding) => !orphans.includes(holding));
  orphans.forEach((holding) => addRecordTombstone('holding', holding.symbol));
  return orphans.length;
}

/* 一次性迁移：把旧口径下打了 isIpo 标记的 trades 转成打新台账。
   现金不动——每条腿的 cashTrackedCny 原样平移，迁移前后对现金余额的影响完全相等。
   原 trade 删除并写墓碑，否则云端旧快照会把它并回来、同一笔钱记两遍。
   没有买入腿的孤立卖出不迁（数据异常，留在 trades 里让用户自己看见）。
   幂等：跑完就没有 isIpo trades 了，第二次调用直接返回 0。 */
export function migrateIpoTradesToRounds() {
  const legacy = state.trades.filter((trade) => trade && trade.isIpo === true);
  if (!legacy.length) return 0;
  const bySymbol = new Map();
  legacy.forEach((trade) => {
    if (!bySymbol.has(trade.symbol)) bySymbol.set(trade.symbol, []);
    bySymbol.get(trade.symbol).push(trade);
  });
  const migratedTradeIds = new Set();
  const rounds = [];
  bySymbol.forEach((entries, symbol) => {
    const sorted = entries.slice().sort((a, b) => `${a.date}|${a.id}`.localeCompare(`${b.date}|${b.id}`));
    const buy = sorted.find((trade) => trade.side !== 'sell');
    if (!buy) return;
    const sells = sorted.filter((trade) => trade.side === 'sell' && trade !== buy);
    sorted.forEach((trade) => migratedTradeIds.add(trade.id));
    rounds.push(sanitizeIpoRoundEntry({
      id: `ipo_${buy.id}`,
      // 备注是用户当时写的中文名（「卖出打新长鑫科技」这类），比代码可读；没有就退回代码
      name: (buy.note || '').trim() || symbol,
      buyDate: buy.date,
      shares: buy.shares,
      costPerShare: buy.price,
      sells: sells.map((trade) => ({
        id: `ips_${trade.id}`, date: trade.date, shares: trade.shares, price: trade.price,
        cashTrackedCny: trade.cashTrackedCny
      })),
      cashTrackedCny: buy.cashTrackedCny,
      note: '',
      createdAt: buy.createdAt || buy.date,
      updatedAt: new Date().toISOString()
    }, state.ipoRounds.length + rounds.length + 1));
  });
  const usable = rounds.filter(Boolean);
  if (!usable.length) return 0;
  invalidateComputeCache();
  state.ipoRounds = state.ipoRounds.concat(usable);
  state.trades = state.trades.filter((trade) => !migratedTradeIds.has(trade.id));
  migratedTradeIds.forEach((id) => addRecordTombstone('trade', id));
  return usable.length;
}

export function removeRecordTombstone(type, id) {
  const key = getTombstoneKey(type);
  const value = type === 'holding' ? normalizeSymbol(id) : String(id || '').trim();
  if (!value) return false;
  const before = state.recordTombstones[key].length;
  state.recordTombstones[key] = state.recordTombstones[key].filter((item) => item !== value);
  if (type === 'holding') {
    state.recordTombstones.holdingDeletes = state.recordTombstones.holdingDeletes.filter((item) => item.symbol !== value);
  }
  return state.recordTombstones[key].length !== before;
}

function getLegacyCashFlowImpact(entry) {
  const amount = Math.abs(safeNumber(entry && entry.amountCny, 0));
  return entry && ['withdraw', 'withdrawal', 'out', 'outflow'].includes(String(entry.type || '').trim().toLowerCase())
    ? -amount : amount;
}

function getLegacyTradeImpact(entry) {
  const value = safeNumber(entry && entry.shares, 0) * safeNumber(entry && entry.price, 0) * safeNumber(entry && entry.fxRate, 1);
  const fee = Math.max(0, safeNumber(entry && entry.feeCny, 0));
  return entry && entry.side === 'sell' ? value - fee : -(value + fee);
}

function deriveLegacyCurrentCash(snapshot, cashFlows, trades, dividendLedger) {
  const openingDate = formatDateLabel(snapshot && snapshot.openingDate);
  if (!openingDate) return null;
  let cash = safeNumber(snapshot && snapshot.openingCashCny, 0);
  cashFlows.forEach((entry) => {
    if (formatDateLabel(entry && entry.date) >= openingDate) cash += getLegacyCashFlowImpact(entry);
  });
  trades.forEach((entry) => {
    if (formatDateLabel(entry && entry.date) >= openingDate) cash += getLegacyTradeImpact(entry);
  });
  dividendLedger.forEach((entry) => {
    if (!entry || entry.confirmed !== true) return;
    const date = formatDateLabel(entry.receivedDate || entry.payDate || entry.exDate);
    if (date >= openingDate) cash += safeNumber(entry.netCny, 0);
  });
  return roundCash(cash);
}

function normalizeIgnoredDividendIds(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((id) => String(id || '').trim()).filter(Boolean)));
}

function normalizeDividendTombstones(value) {
  if (!Array.isArray(value)) return [];
  const bySource = new Map();
  value.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const sourceId = String(item.sourceId || '').trim();
    if (!sourceId) return;
    bySource.set(sourceId, { sourceId, incomeDate: formatDateLabel(item.incomeDate) });
  });
  return Array.from(bySource.values());
}

/* 删除一笔自动生成的股息：既要移出台账，也要把 sourceId 记进忽略名单，
   否则下一次 settleRevenueData 会按行情派息事件把它原样重建。 */
export function ignoreDividendLedgerEntry(sourceId) {
  const id = String(sourceId || '').trim();
  if (!id) return false;
  const deleted = state.dividendLedger.find((entry) => entry && entry.sourceId === id) || null;
  if (deleted) {
    const incomeDate = formatDateLabel(deleted.receivedDate)
      || resolveEffectivePayDate(deleted.exDate, deleted.payDate, deleted.symbol).date;
    state.dividendLedgerTombstones = state.dividendLedgerTombstones
      .filter((item) => item.sourceId !== id)
      .concat({ sourceId: id, incomeDate });
  }
  const before = state.dividendLedger.length;
  state.dividendLedger = state.dividendLedger.filter((entry) => entry && entry.sourceId !== id);
  if (!state.dividendLedgerIgnored.includes(id)) state.dividendLedgerIgnored.push(id);
  invalidateComputeCache();
  return state.dividendLedger.length !== before;
}

export function setCurrentCashBalance(value, asOfDate = '') {
  state.currentCashCny = value === null || value === undefined ? null : roundCash(value);
  state.currentCashAsOfDate = state.currentCashCny === null
    ? '' : (formatDateLabel(asOfDate) || formatDateLabel(new Date()));
  // 余额校准是新的现金基准：当时已经存在的记录都已包含在用户输入的实际余额里，
  // 后续撤销/编辑不能再把这些旧影响重复冲回。新建或新确认的记录会单独写入 tracked 金额。
  if (state.currentCashCny !== null) {
    state.cashFlows = state.cashFlows.map((entry) => ({ ...entry, cashTrackedCny: 0 }));
    state.trades = state.trades.map((entry) => ({ ...entry, cashTrackedCny: 0 }));
    state.dividendLedger = state.dividendLedger.map((entry) => ({ ...entry, cashTrackedCny: 0 }));
  }
}

export function adjustCurrentCashBalance(delta) {
  if (state.currentCashCny === null) return;
  state.currentCashCny = roundCash(safeNumber(state.currentCashCny, 0) + safeNumber(delta, 0));
}

function getTrackedCashImpact(entry, impact, dateValue) {
  if (!entry || state.currentCashCny === null) return 0;
  if (entry.cashTrackedCny !== null && entry.cashTrackedCny !== undefined
    && Number.isFinite(Number(entry.cashTrackedCny))) return safeNumber(entry.cashTrackedCny, 0);
  const date = formatDateLabel(dateValue);
  return date && date >= state.currentCashAsOfDate ? impact : 0;
}

export function adjustCashForRecordChange(previousEntry, previousImpact, previousDate, nextEntry, nextImpact, nextDate) {
  const oldTracked = getTrackedCashImpact(previousEntry, previousImpact, previousDate);
  let nextTracked = 0;
  if (nextEntry && state.currentCashCny !== null) {
    const previousLabel = formatDateLabel(previousDate);
    const nextLabel = formatDateLabel(nextDate);
    const previousWasActive = Math.abs(safeNumber(previousImpact, 0)) > 0;
    const previousTrackingFrozen = previousEntry && previousEntry.cashTrackedCny !== null
      && previousEntry.cashTrackedCny !== undefined && Number.isFinite(Number(previousEntry.cashTrackedCny));
    if (previousEntry && previousWasActive && previousTrackingFrozen) {
      nextTracked = Math.abs(oldTracked) > 0 ? nextImpact : 0;
    } else if (previousEntry && previousLabel === nextLabel && previousWasActive) {
      nextTracked = Math.abs(oldTracked) > 0 ? nextImpact : 0;
    } else {
      nextTracked = nextLabel && nextLabel >= state.currentCashAsOfDate ? nextImpact : 0;
    }
    nextEntry.cashTrackedCny = roundCash(nextTracked);
  }
  adjustCurrentCashBalance(nextTracked - oldTracked);
  return roundCash(nextTracked - oldTracked);
}

export function applySnapshot(snapshot) {
  invalidateComputeCache();
  const defaults = createDefaultSnapshot();
  // 报价是行情缓存，不属于账本快照（buildPortfolioSnapshot 不导出它）。
  // 以内存里现有报价为底，避免同步/导入时先渲染出一屏 0 价市值；快照自带报价仍然覆盖。
  const baseQuotes = mergeQuotes(clone(defaults.quotes), state.quotes);
  const mergedQuotes = mergeQuotes(baseQuotes, snapshot && snapshot.quotes);
  const sanitizedHoldingsRaw = Array.isArray(snapshot && snapshot.holdings)
    ? snapshot.holdings.map((item, index) => sanitizeHolding(item, index, mergedQuotes)).filter(Boolean)
    : defaults.holdings;
  const sanitizedHoldings = Array.from(sanitizedHoldingsRaw.reduce((map, holding) => {
    const existing = map.get(holding.symbol);
    if (!existing) {
      map.set(holding.symbol, holding);
      return map;
    }
    map.set(holding.symbol, {
      ...existing,
      quantity: safeNumber(existing.quantity, 0) + safeNumber(holding.quantity, 0),
      bucket: existing.bucket === 'income' || holding.bucket === 'income' ? 'income' : 'core',
      taxRateOverride: holding.taxRateOverride !== '' ? holding.taxRateOverride : existing.taxRateOverride,
      dividendPerShareTtmOverride: holding.dividendPerShareTtmOverride !== ''
        ? holding.dividendPerShareTtmOverride : existing.dividendPerShareTtmOverride,
      dividendPerShareTtmOverrideTouched: existing.dividendPerShareTtmOverrideTouched === true
        || holding.dividendPerShareTtmOverrideTouched === true
    });
    return map;
  }, new Map()).values());
  const maxLocalId = sanitizedHoldings.reduce((max, item) => Math.max(max, item.localId), 0);
  state.holdings = Array.isArray(snapshot && snapshot.holdings) ? sanitizedHoldings : clone(defaults.holdings);
  state.quotes = mergedQuotes;
  state.rates = { ...DEFAULT_RATES, ...((snapshot && snapshot.rates) || {}) };
  state.nextId = Math.max(maxLocalId + 1, Math.floor(safeNumber(snapshot && snapshot.nextId, defaults.nextId)));
  state.showAmounts = snapshot && snapshot.showAmounts === false ? false : true;
  // 旧快照的 activePage 键（如 'assets'）映射到新信息架构。
  const rawPage = snapshot && snapshot.activePage;
  const mappedPage = LEGACY_PAGE_MAP[rawPage] || rawPage;
  state.activePage = PAGE_KEYS.has(mappedPage) ? mappedPage : 'home';
  state.dividendCalendarBucket = DIVIDEND_FILTER_KEYS.has(snapshot && snapshot.dividendCalendarBucket) ? snapshot.dividendCalendarBucket : 'all';
  const activeDividendMonth = Math.floor(safeNumber(snapshot && snapshot.activeDividendMonth, 0));
  state.activeDividendMonth = activeDividendMonth >= 1 && activeDividendMonth <= 12 ? activeDividendMonth : null;
  const activeAnnualYear = Math.floor(safeNumber(snapshot && snapshot.activeAnnualYear, new Date().getFullYear()));
  state.activeAnnualYear = activeAnnualYear >= 1900 && activeAnnualYear <= 2200 ? activeAnnualYear : new Date().getFullYear();
  state.sortField = snapshot && ['effectiveYield', 'netAnnualDividendCny'].includes(snapshot.sortField) ? snapshot.sortField : 'marketValueCny';
  state.sortDirection = snapshot && snapshot.sortDirection === 'asc' ? 'asc' : 'desc';
  state.legendExpanded = Boolean(snapshot && snapshot.legendExpanded);
  state.liabilityCny = Math.max(0, safeNumber(snapshot && snapshot.liabilityCny, 0));
  state.dividendLedger = Array.isArray(snapshot && snapshot.dividendLedger)
    ? snapshot.dividendLedger.map(sanitizeDividendLedgerEntry).filter(Boolean)
    : [];
  state.dailySnapshots = Array.isArray(snapshot && snapshot.dailySnapshots)
    ? snapshot.dailySnapshots.map(sanitizeDailySnapshotEntry).filter(Boolean)
    : [];
  state.cashFlows = Array.isArray(snapshot && snapshot.cashFlows)
    ? snapshot.cashFlows.map(sanitizeCashFlowEntry).filter(Boolean)
    : [];
  state.trades = Array.isArray(snapshot && snapshot.trades)
    ? snapshot.trades.map(sanitizeTradeEntry).filter(Boolean)
    : [];
  state.ipoRounds = Array.isArray(snapshot && snapshot.ipoRounds)
    ? snapshot.ipoRounds.map(sanitizeIpoRoundEntry).filter(Boolean)
    : [];
  const legacyOpeningDate = formatDateLabel(snapshot && snapshot.openingDate);
  state.positionOpeningDate = formatDateLabel(snapshot && (snapshot.positionOpeningDate || snapshot.openingDate));
  // 兼容一次误把“当前现金日期”设到未来的旧数据：持仓交易起点不得因此越过已有交易。
  const today = formatDateLabel(new Date());
  if (!(snapshot && snapshot.positionOpeningDate) && state.positionOpeningDate > today) {
    const earliestTradeDate = state.trades.map((entry) => formatDateLabel(entry.date)).filter(Boolean).sort()[0] || '';
    if (earliestTradeDate && earliestTradeDate < state.positionOpeningDate) state.positionOpeningDate = earliestTradeDate;
  }
  const hasCurrentCash = Boolean(snapshot && Object.prototype.hasOwnProperty.call(snapshot, 'currentCashCny'));
  const migratedCash = hasCurrentCash
    ? (snapshot.currentCashCny === null ? null : roundCash(snapshot.currentCashCny))
    : deriveLegacyCurrentCash(snapshot, state.cashFlows, state.trades, state.dividendLedger);
  state.currentCashCny = migratedCash;
  state.currentCashAsOfDate = migratedCash === null ? '' : (
    formatDateLabel(snapshot && snapshot.currentCashAsOfDate) || today || legacyOpeningDate
  );
  const legacyYearly = Array.isArray(snapshot && snapshot.yearlyManual) ? snapshot.yearlyManual : [];
  const explicitArchives = Array.isArray(snapshot && snapshot.yearlyArchives) ? snapshot.yearlyArchives : [];
  state.yearlyManual = legacyYearly
    .filter((item) => !item || item.source !== 'auto')
    .map(sanitizeYearlyManualEntry)
    .filter(Boolean);
  state.yearlyArchives = explicitArchives
    .concat(legacyYearly.filter((item) => item && item.source === 'auto'))
    .map(sanitizeYearlyArchiveEntry)
    .filter(Boolean)
    .filter((entry, index, rows) => rows.findIndex((item) => item.year === entry.year) === index);
  state.yearlyHoldings = Array.isArray(snapshot && snapshot.yearlyHoldings)
    ? snapshot.yearlyHoldings.map(sanitizeYearlyHoldingsEntry).filter(Boolean)
    : [];
  state.dividendLedgerIgnored = normalizeIgnoredDividendIds(snapshot && snapshot.dividendLedgerIgnored);
  state.dividendLedgerTombstones = normalizeDividendTombstones(snapshot && snapshot.dividendLedgerTombstones);
  state.recordTombstones = normalizeRecordTombstones(snapshot && snapshot.recordTombstones);
  state.lastUpdatedAt = typeof (snapshot && snapshot.lastUpdatedAt) === 'string' ? snapshot.lastUpdatedAt : '';
}

export function getPersistedSnapshot() {
  return {
    type: 'portfolio-snapshot', version: PORTFOLIO_SNAPSHOT_VERSION,
    holdings: state.holdings, quotes: state.quotes, rates: state.rates,
    nextId: state.nextId, showAmounts: state.showAmounts, activePage: state.activePage,
    dividendCalendarBucket: state.dividendCalendarBucket, activeDividendMonth: state.activeDividendMonth,
    activeAnnualYear: state.activeAnnualYear, sortField: state.sortField,
    sortDirection: state.sortDirection, legendExpanded: state.legendExpanded,
    liabilityCny: state.liabilityCny,
    currentCashCny: state.currentCashCny, currentCashAsOfDate: state.currentCashAsOfDate,
    positionOpeningDate: state.positionOpeningDate,
    dividendLedger: state.dividendLedger,
    dailySnapshots: state.dailySnapshots, cashFlows: state.cashFlows,
    trades: state.trades, ipoRounds: state.ipoRounds,
    yearlyManual: state.yearlyManual, yearlyArchives: state.yearlyArchives,
    yearlyHoldings: state.yearlyHoldings,
    dividendLedgerIgnored: state.dividendLedgerIgnored,
    dividendLedgerTombstones: state.dividendLedgerTombstones,
    recordTombstones: state.recordTombstones,
    lastUpdatedAt: state.lastUpdatedAt
  };
}

export function saveState() {
  invalidateComputeCache();
  localStorage.setItem(getActiveStorageKey(), JSON.stringify(getPersistedSnapshot()));
}

export function restoreState() {
  try {
    const saved = JSON.parse(localStorage.getItem(getActiveStorageKey()) || 'null');
    if ((!saved || typeof saved !== 'object') && isDemoMode()) {
      applySnapshot(createDemoSnapshot());
      saveState();
      return true;
    }
    if (!saved || typeof saved !== 'object') throw new Error('invalid state');
    applySnapshot(saved);
    bootstrap.hadLocalArchive = true;
    saveState();
    return true;
  } catch (_error) {
    bootstrap.hadLocalArchive = false;
    applySnapshot(isDemoMode() ? createDemoSnapshot() : createDefaultSnapshot());
    return false;
  }
}

export function buildPortfolioSnapshotHolding(holding) {
  const quantity = Math.max(0, safeNumber(holding && holding.quantity != null ? holding.quantity : holding && holding.shares, 0));
  const dpsOverride = sanitizePerShareOverrideInput(holding && holding.dividendPerShareTtmOverride);
  return {
    localId: Math.max(1, Math.floor(safeNumber(holding && holding.localId, 1))),
    symbol: normalizeSymbol(holding && holding.symbol),
    quantity, shares: quantity,
    accountType: holding && typeof holding.accountType === 'string' && holding.accountType.trim() ? holding.accountType.trim() : 'default',
    bucket: holding && holding.bucket === 'income' ? 'income' : 'core',
    taxRateOverride: holding && holding.taxRateOverride != null ? String(holding.taxRateOverride) : '',
    dividendPerShareTtmOverride: dpsOverride,
    dividendPerShareTtmOverrideTouched: holding && holding.dividendPerShareTtmOverrideTouched === true && dpsOverride !== '',
    createdAt: holding && typeof holding.createdAt === 'string' ? holding.createdAt : '',
    updatedAt: holding && typeof holding.updatedAt === 'string' ? holding.updatedAt : ''
  };
}

export function buildPortfolioSnapshot() {
  const persisted = getPersistedSnapshot();
  /* effectiveQuantity 是给外部读者的衍生字段：quantity 是期初基准股数，当前持股
     还要叠加 trades 净额，外部工具（以及人）几乎必然把 quantity 误读成现值。
     导入侧 sanitizeHolding 白名单会丢弃它，不参与合并，不会回流进 state。 */
  const holdings = Array.isArray(persisted.holdings)
    ? persisted.holdings.map(buildPortfolioSnapshotHolding).filter((item) => item.symbol)
      .map((item) => ({ ...item, effectiveQuantity: getEffectiveHoldingQuantityAtDate(item.symbol) }))
    : [];
  return {
    type: 'portfolio-snapshot',
    version: PORTFOLIO_SNAPSHOT_VERSION,
    updatedAt: new Date().toISOString(),
    holdings,
    rates: { CNY: 1, USD: safeNumber(persisted.rates && persisted.rates.USD, DEFAULT_RATES.USD), HKD: safeNumber(persisted.rates && persisted.rates.HKD, DEFAULT_RATES.HKD) },
    dividendLedger: Array.isArray(persisted.dividendLedger)
      ? persisted.dividendLedger.map(sanitizeDividendLedgerEntry).filter(Boolean)
      : [],
    dailySnapshots: Array.isArray(persisted.dailySnapshots)
      ? persisted.dailySnapshots.map(sanitizeDailySnapshotEntry).filter(Boolean)
      : [],
    cashFlows: Array.isArray(persisted.cashFlows)
      ? persisted.cashFlows.map(sanitizeCashFlowEntry).filter(Boolean)
      : [],
    trades: Array.isArray(persisted.trades)
      ? persisted.trades.map(sanitizeTradeEntry).filter(Boolean)
      : [],
    ipoRounds: Array.isArray(persisted.ipoRounds)
      ? persisted.ipoRounds.map(sanitizeIpoRoundEntry).filter(Boolean)
      : [],
    yearlyManual: Array.isArray(persisted.yearlyManual)
      ? persisted.yearlyManual.map(sanitizeYearlyManualEntry).filter(Boolean)
      : [],
    yearlyArchives: Array.isArray(persisted.yearlyArchives)
      ? persisted.yearlyArchives.map(sanitizeYearlyArchiveEntry).filter(Boolean)
      : [],
    yearlyHoldings: Array.isArray(persisted.yearlyHoldings)
      ? persisted.yearlyHoldings.map(sanitizeYearlyHoldingsEntry).filter(Boolean)
      : [],
    dividendLedgerIgnored: normalizeIgnoredDividendIds(persisted.dividendLedgerIgnored),
    dividendLedgerTombstones: normalizeDividendTombstones(persisted.dividendLedgerTombstones),
    recordTombstones: normalizeRecordTombstones(persisted.recordTombstones),
    nextId: Math.max(holdings.reduce((max, item) => Math.max(max, item.localId), 0) + 1, Math.floor(safeNumber(persisted.nextId, 1))),
    showAmounts: persisted.showAmounts !== false,
    sortField: ['effectiveYield', 'netAnnualDividendCny'].includes(persisted.sortField) ? persisted.sortField : 'marketValueCny',
    sortDirection: persisted.sortDirection === 'asc' ? 'asc' : 'desc',
    legendExpanded: Boolean(persisted.legendExpanded),
    liabilityCny: Math.max(0, safeNumber(persisted.liabilityCny, 0)),
    currentCashCny: persisted.currentCashCny === null ? null : roundCash(persisted.currentCashCny),
    currentCashAsOfDate: formatDateLabel(persisted.currentCashAsOfDate),
    positionOpeningDate: formatDateLabel(persisted.positionOpeningDate),
    lastUpdatedAt: typeof persisted.lastUpdatedAt === 'string' ? persisted.lastUpdatedAt : ''
  };
}
