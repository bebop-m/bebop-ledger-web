import {
  state, refs, saveState, showToast, setCurrentCashBalance,
  ignoreDividendLedgerEntry, addRecordTombstone, removeRecordTombstone, adjustCashForRecordChange
} from './state.js';
import {
  safeNumber, escapeHtml, normalizeSymbol, sanitizePerShareOverrideInput,
  mergeQuotes, sanitizeCashFlowEntry, sanitizeTradeEntry, formatDateLabel,
  resolveQuoteCurrency, resolveFxRate, resolveEffectivePayDate
} from './utils.js';
import { LABELS } from './constants.js';
import { renderSavedStateQuietly, buildDividendMonthDetail, formatDisplayMoney } from './render.js';
import {
  inferQuote, computeHoldings, computeIncomeSummary,
  getDividendCashImpactCny, getCashFlowCashImpactCny, getTradeCashImpactCny, validateTradeInventory
} from './compute.js';
import { getFundamentalsPickerModel } from './fundamentals.js';
import { computeYearAnnals } from './annals.js';
import { getPortfolioDiagnostics } from './diagnostics.js';
import { archiveCompletedYears } from './revenue.js';

let _keydownHandler = null;

export function openModal(type, payload = {}) {
  if (_keydownHandler) document.removeEventListener('keydown', _keydownHandler, true);
  state.modal = type; state.modalPayload = payload;
  document.body.classList.add('modal-open');
  renderModal();
  _keydownHandler = handleModalKeydown;
  document.addEventListener('keydown', _keydownHandler, true);
  requestAnimationFrame(() => {
    const input = refs.modalRoot.querySelector('.modal-input');
    if (input) { input.focus({ preventScroll: true }); if (input.type !== 'number') input.select(); }
  });
}

function handleModalKeydown(event) {
  if (!state.modal) return;
  if (event.key === 'Escape') { event.preventDefault(); closeModal(); return; }
  if (event.key === 'Enter') { event.preventDefault(); handleModalSave(); }
}

export function closeModal() {
  if (_keydownHandler) { document.removeEventListener('keydown', _keydownHandler, true); _keydownHandler = null; }
  const mask = refs.modalRoot.querySelector('.modal-mask'), sheet = refs.modalRoot.querySelector('.modal-sheet');
  if (mask && sheet) {
    mask.classList.add('is-closing'); sheet.classList.add('is-closing');
    sheet.addEventListener('animationend', () => { state.modal = null; state.modalPayload = null; document.body.classList.remove('modal-open'); refs.modalRoot.innerHTML = ''; }, { once: true });
  } else { state.modal = null; state.modalPayload = null; document.body.classList.remove('modal-open'); refs.modalRoot.innerHTML = ''; }
}

export function setModalBucketSelection(next) {
  const bucket = next === 'income' ? 'income' : 'core';
  const input = document.getElementById('modalBucketInput'); if (input) input.value = bucket;
  Array.from(document.querySelectorAll('[data-bucket-option]')).forEach((b) => {
    const a = b.dataset.bucketOption === bucket; b.classList.toggle('is-active', a); b.setAttribute('aria-pressed', a ? 'true' : 'false');
  });
}

export function setModalCashFlowTypeSelection(next) {
  const type = next === 'withdrawal' ? 'withdrawal' : 'deposit';
  state.modalPayload = { ...(state.modalPayload || {}), type };
  const input = document.getElementById('modalCashFlowTypeInput'); if (input) input.value = type;
  Array.from(document.querySelectorAll('[data-cash-flow-type]')).forEach((b) => {
    const a = b.dataset.cashFlowType === type; b.classList.toggle('is-active', a); b.setAttribute('aria-pressed', a ? 'true' : 'false');
  });
}

export function setModalTradeSideSelection(next) {
  const side = next === 'sell' ? 'sell' : 'buy';
  state.modalPayload = { ...(state.modalPayload || {}), side };
  const input = document.getElementById('modalTradeSideInput'); if (input) input.value = side;
  Array.from(document.querySelectorAll('[data-trade-side]')).forEach((b) => {
    const a = b.dataset.tradeSide === side; b.classList.toggle('is-active', a); b.setAttribute('aria-pressed', a ? 'true' : 'false');
  });
}

function getDefaultManualYear() {
  return new Date().getFullYear() - 1;
}

function getTodayLabel() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getDividendCashDate(entry) {
  return formatDateLabel(entry && (entry.receivedDate || entry.payDate || entry.exDate));
}

function createRecordId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getManualModalValue(key) {
  const value = state.modalPayload && state.modalPayload[key];
  return value === null || value === undefined ? '' : String(value);
}

function getDividendLedgerEntryBySourceId(sourceId) {
  return state.dividendLedger.find((entry) => entry && entry.sourceId === sourceId) || null;
}

function getCashFlowPayload() {
  if (!state.modalPayload || !state.modalPayload.id) return null;
  return state.cashFlows.find((entry) => entry && entry.id === state.modalPayload.id) || state.modalPayload;
}

function getTradePayload() {
  if (!state.modalPayload || !state.modalPayload.id) return null;
  const stored = state.trades.find((entry) => entry && entry.id === state.modalPayload.id);
  return stored ? { ...stored, ...state.modalPayload } : state.modalPayload;
}

function renderSegmentGroup(hiddenId, value, options) {
  return `<div class="modal-bucket-group" role="group">
    ${options.map((option) => `<button class="modal-bucket-button ${option.className || ''}${option.value === value ? ' is-active' : ''}" type="button" ${option.dataAttr}="${escapeHtml(option.value)}" aria-pressed="${option.value === value ? 'true' : 'false'}">${escapeHtml(option.label)}</button>`).join('')}
  </div><input id="${hiddenId}" type="hidden" value="${escapeHtml(value)}">`;
}

// 按代码自动判定币种：.HK→港元，.SH/.SZ 或纯 6 位数字→人民币，纯字母（美股）→美元。
function detectTradeCurrency(symbol) {
  const s = normalizeSymbol(symbol);
  if (/\.HK$/i.test(s)) return 'HKD';
  if (/\.(SS|SH|SZ)$/i.test(s) || /^\d{6}$/.test(s)) return 'CNY';
  const quote = inferQuote(s);
  const known = String(quote.currency || '').trim().toUpperCase();
  if (known === 'CNY' || known === 'USD' || known === 'HKD') return known;
  if (/^[A-Z][A-Z.]*$/.test(s)) return 'USD';
  return resolveQuoteCurrency(quote, s);
}

// 交易弹窗里的实时行情提示：识别到的币种 + 名称 + 现价（外币附当天折人民币）。
function buildTradeQuoteInfoText(symbol) {
  const s = normalizeSymbol(symbol);
  if (!s) return '输入代码后自动识别币种与现价';
  const currency = detectTradeCurrency(s);
  const quote = inferQuote(s);
  const price = safeNumber(quote.price, 0);
  const name = quote.name && quote.name !== s ? quote.name : '';
  if (price > 0) {
    const fx = resolveFxRate(currency, state.rates);
    const cny = currency === 'CNY' ? '' : `（≈¥${(price * fx).toFixed(2)}）`;
    return `${name ? name + ' · ' : ''}现价 ${price} ${currency}${cny}`;
  }
  return `币种 ${currency} · 未识别到行情，成交价请手动填写`;
}

// 股票代码输入变化时，刷新行情提示，并在新增交易且价格为空时自动带出现价。
export function updateTradeQuoteInfo() {
  const input = document.getElementById('modalTradeSymbolInput');
  const info = document.getElementById('modalTradeQuoteInfo');
  if (!input || !info) return;
  const symbol = normalizeSymbol(input.value);
  info.textContent = buildTradeQuoteInfoText(symbol);
  const priceInput = document.getElementById('modalTradePriceInput');
  const isNew = !(state.modalPayload && state.modalPayload.id);
  if (priceInput && isNew && !priceInput.value) {
    const price = safeNumber(inferQuote(symbol).price, 0);
    if (price > 0) priceInput.value = String(price);
  }
}

/* 05-单字段编辑抽屉：基准股数 / 税率 / 每股股息 / 负债共用一套形制。
   金线托底的大号输入 + 取消／保存两个文字键；税率纯手填，不给快捷选项。
   input 的 id 与旧版一致，handleModalSave 的取值链路不变。 */
const FIELD_EDIT_SHEETS = {
  quantity: { title: '基准股数', unit: '股', inputId: 'modalQuantityInput', placeholder: LABELS.quantityPlaceholder },
  tax: { title: '股息税率', unit: '%', inputId: 'modalTaxInput', placeholder: LABELS.taxPlaceholder },
  dividend: { title: '每股股息', unit: '', inputId: 'modalDividendInput', placeholder: LABELS.dividendPerSharePlaceholder },
  liability: { title: '负债', unit: '元', inputId: 'modalLiabilityInput', placeholder: LABELS.liabilityPlaceholder }
};

function getFieldEditNote(type) {
  const name = (state.modalPayload && state.modalPayload.name) || '';
  if (type === 'quantity') return [`${name} · 交易起点的持股`, '当前持股 = 基准 + 之后的交易回放'];
  if (type === 'tax') return [`${name} · 按实际预扣税率填写`, '留空表示未知，计算时暂按 0% 估算'];
  if (type === 'dividend') return [`${name} · 每股 TTM 股息`, '按股票原币输入，留空则回到自动行情'];
  return ['净资产 = 股票市值 + 现金 − 负债', '没有负债就填 0'];
}

/* input 没法按内容自动收宽（field-sizing 在 iOS Safari 还不能用），
   金线要像定稿图那样贴着数字就得自己算宽度。数字是 tabular-nums，
   1ch 正好是一个数位宽，按字符数给 ch 即可，各浏览器一致。 */
export function getZenEditWidthCh(value) {
  return Math.max(3, String(value === null || value === undefined ? '' : value).length);
}

export function syncZenEditWidth(input) {
  if (!input || !input.classList.contains('zen-edit-field')) return;
  input.style.width = `${getZenEditWidthCh(input.value)}ch`;
}

function renderFieldEditModal() {
  const spec = FIELD_EDIT_SHEETS[state.modal];
  const payload = state.modalPayload || {};
  const unit = state.modal === 'dividend' && payload.currency ? String(payload.currency) : spec.unit;
  const value = payload.value === null || payload.value === undefined ? '' : String(payload.value);
  refs.modalRoot.innerHTML = `<div class="modal-mask" data-modal-action="close"></div>
    <section class="modal-sheet zen-sheet zen-sheet--edit" role="dialog" aria-modal="true" aria-labelledby="zenSheetTitle">
      <div class="zen-sheet-handle" aria-hidden="true"></div>
      <div class="zen-sheet-title">
        <span class="zen-sheet-title-text" id="zenSheetTitle">${escapeHtml(spec.title)}</span>
        <p class="zen-sheet-note">${getFieldEditNote(state.modal).map((line) => escapeHtml(line)).join('<br>')}</p>
      </div>
      <div class="zen-edit-input">
        <span class="zen-edit-value"><input id="${spec.inputId}" class="modal-input zen-edit-field" type="number" inputmode="decimal" style="width:${getZenEditWidthCh(value)}ch" value="${escapeHtml(value)}" placeholder="${escapeHtml(spec.placeholder)}" aria-label="${escapeHtml(spec.title)}">${unit ? `<em class="zen-edit-unit">${escapeHtml(unit)}</em>` : ''}<i class="zen-edit-line" aria-hidden="true"></i></span>
      </div>
      <div class="zen-sheet-actions">
        <button class="zen-key zen-key--cancel" type="button" data-modal-action="cancel">取 消</button>
        <button class="zen-key zen-key--save" type="button" data-modal-action="save">保 存<i class="zen-key-dot" aria-hidden="true"></i></button>
      </div>
    </section>`;
}

function renderModal() {
  if (!state.modal) { refs.modalRoot.innerHTML = ''; return; }
  if (FIELD_EDIT_SHEETS[state.modal]) { renderFieldEditModal(); return; }
  if (state.modal === 'monthDetail') { renderMonthDetailModal(); return; }
  if (state.modal === 'holdingDetail') { renderHoldingDetailModal(); return; }
  if (state.modal === 'yearHoldings') { renderYearHoldingsModal(); return; }
  if (state.modal === 'yearAnnals') { renderYearAnnalsModal(); return; }
  if (state.modal === 'diagnostics') { renderDiagnosticsModal(); return; }
  if (state.modal === 'fundPicker') { renderFundPickerModal(); return; }
  let title = '', note = '', fields = '';
  if (state.modal === 'quickAdd') {
    title = '记一笔';
    note = '选择要记录或校准的项目';
    // 出入金是「流水」，当前现金是「余额快照」——描述上要让人一眼分清，填错会污染现金口径。
    fields = `<div class="quick-add-options">
      <button class="quick-add-option" type="button" data-modal-action="open-trade"><strong>交易</strong><span>买入 / 卖出一笔股票</span></button>
      <button class="quick-add-option" type="button" data-modal-action="open-cash-flow"><strong>出入金</strong><span>真实的资金转入 / 转出</span></button>
      <button class="quick-add-option" type="button" data-modal-action="open-current-cash"><strong>当前现金</strong><span>直接校准券商的现金余额</span></button>
    </div>`;
  } else if (state.modal === 'holdingsMenu') {
    title = '持仓操作';
    note = `${state.holdings.length} 项持仓`;
    fields = `<div class="quick-add-options holdings-menu-options">
      <button class="quick-add-option" type="button" data-modal-action="holding-add"><strong>新增持仓</strong><span>添加证券或记录一笔买入</span></button>
      <button class="quick-add-option" type="button" data-modal-action="holding-refresh"><strong>刷新行情</strong><span>更新价格、汇率与股息数据</span></button>
      <button class="quick-add-option" type="button" data-modal-action="holding-diagnostics"><strong>持仓诊断</strong><span>查看仓位、股息与数据异常</span></button>
    </div>`;
  } else if (state.modal === 'openingCash') {
    title = '当前现金余额';
    note = '填写券商此刻的实际现金；保存不会重算历史交易，也不会改变持股数量';
    fields = `<label class="modal-field"><span>当前现金（CNY，可为负数）</span><input id="modalCurrentCashInput" class="modal-input" type="number" inputmode="decimal" value="${escapeHtml(state.currentCashCny === null ? '' : String(state.currentCashCny))}" placeholder="0.00"></label>
      <label class="modal-field"><span>现金基准日</span><input id="modalCurrentCashDateInput" class="modal-input" type="date" value="${escapeHtml(state.currentCashAsOfDate || getTodayLabel())}"></label>
      <label class="modal-field"><span>交易持仓起点</span><input id="modalPositionOpeningDateInput" class="modal-input" type="date" value="${escapeHtml(state.positionOpeningDate || getTodayLabel())}"></label>
      <p class="modal-quote-line">基准日之后的新记录才调整现金；持仓股数从交易起点的基准股数开始回放</p>`;
  } else if (state.modal === 'dividendLedger') {
    const entry = getDividendLedgerEntryBySourceId(state.modalPayload && state.modalPayload.sourceId);
    const quote = entry ? inferQuote(entry.symbol) : {};
    title = '股息到账';
    note = entry ? `${quote.name || entry.symbol}` : '未找到这笔股息';
    fields = entry ? `<label class="modal-field"><span>官方派付日（可选）</span><input id="modalDividendPayDateInput" class="modal-input" type="date" value="${escapeHtml(formatDateLabel(entry.payDate))}"></label>
      <label class="modal-field"><span>实际到账日</span><input id="modalDividendReceivedDateInput" class="modal-input" type="date" value="${escapeHtml(formatDateLabel(entry.receivedDate))}"></label>
      <label class="modal-field"><span>实收金额（CNY）</span><input id="modalDividendNetInput" class="modal-input" type="number" inputmode="decimal" value="${escapeHtml(String(safeNumber(entry.netCny, 0)))}" placeholder="0.00"></label>
      <label class="modal-field"><span>备注</span><input id="modalDividendNoteInput" class="modal-input" type="text" value="${escapeHtml(entry.note || '')}" placeholder="可选"></label>
      <label class="modal-check"><input id="modalDividendConfirmedInput" type="checkbox"${entry.confirmed === true ? ' checked' : ''}><span>标记已到账</span></label>` : '';
  } else if (state.modal === 'cashFlow') {
    const entry = getCashFlowPayload();
    const type = entry && entry.type === 'withdrawal' ? 'withdrawal' : 'deposit';
    title = entry ? '编辑出入金' : '新增出入金';
    note = '真实的资金转入 / 转出';
    fields = `<label class="modal-field"><span>日期</span><input id="modalCashFlowDateInput" class="modal-input" type="date" value="${escapeHtml(formatDateLabel(entry && entry.date) || getTodayLabel())}"></label>
      <label class="modal-field"><span>金额（CNY）</span><input id="modalCashFlowAmountInput" class="modal-input" type="number" inputmode="decimal" value="${escapeHtml(entry ? String(Math.abs(safeNumber(entry.amountCny, 0))) : '')}" placeholder="0.00"></label>
      ${renderSegmentGroup('modalCashFlowTypeInput', type, [
        { value: 'deposit', label: '入金', className: 'is-core', dataAttr: 'data-cash-flow-type' },
        { value: 'withdrawal', label: '出金', className: 'is-income', dataAttr: 'data-cash-flow-type' }
      ])}
      <label class="modal-field"><span>备注</span><input id="modalCashFlowNoteInput" class="modal-input" type="text" value="${escapeHtml(entry && entry.note || '')}" placeholder="可选"></label>`;
  } else if (state.modal === 'trade') {
    const entry = getTradePayload();
    const symbol = normalizeSymbol(entry && entry.symbol || state.modalPayload && state.modalPayload.symbol || '');
    const side = entry && entry.side === 'sell' ? 'sell' : 'buy';
    title = entry ? '编辑交易' : '新增交易';
    note = '币种按代码自动识别，汇率按当天自动换算';
    fields = `<label class="modal-field"><span>日期</span><input id="modalTradeDateInput" class="modal-input" type="date" value="${escapeHtml(formatDateLabel(entry && entry.date) || getTodayLabel())}"></label>
      <label class="modal-field"><span>股票代码</span><input id="modalTradeSymbolInput" class="modal-input" type="text" value="${escapeHtml(symbol)}" placeholder="${LABELS.symbolPlaceholder}"></label>
      <p class="modal-quote-line" id="modalTradeQuoteInfo">${escapeHtml(buildTradeQuoteInfoText(symbol))}</p>
      ${renderSegmentGroup('modalTradeSideInput', side, [
        { value: 'buy', label: '买入', className: 'is-core', dataAttr: 'data-trade-side' },
        { value: 'sell', label: '卖出', className: 'is-income', dataAttr: 'data-trade-side' }
      ])}
      <div class="modal-grid-2">
        <label class="modal-field"><span>股数</span><input id="modalTradeSharesInput" class="modal-input" type="number" inputmode="decimal" value="${escapeHtml(entry ? String(safeNumber(entry.shares, 0)) : '')}" placeholder="0"></label>
        <label class="modal-field"><span>成交价</span><input id="modalTradePriceInput" class="modal-input" type="number" inputmode="decimal" value="${escapeHtml(entry ? String(safeNumber(entry.price, 0)) : '')}" placeholder="0.00"></label>
      </div>
      <label class="modal-field"><span>费用（CNY，可选）</span><input id="modalTradeFeeInput" class="modal-input" type="number" inputmode="decimal" value="${escapeHtml(entry ? String(safeNumber(entry.feeCny, 0)) : '')}" placeholder="0.00"></label>
      ${renderSegmentGroup('modalBucketInput', entry && entry.bucket === 'income' ? 'income' : 'core', [
        { value: 'core', label: LABELS.core, className: 'is-core', dataAttr: 'data-bucket-option' },
        { value: 'income', label: LABELS.income, className: 'is-income', dataAttr: 'data-bucket-option' }
      ])}
      <label class="modal-field"><span>备注</span><input id="modalTradeNoteInput" class="modal-input" type="text" value="${escapeHtml(entry && entry.note || '')}" placeholder="可选"></label>`;
  } else if (state.modal === 'yearlyManual') {
    title = '年度数据';
    note = '填写项优先；留空即使用账本、快照或其他字段自动推算';
    const year = Math.floor(safeNumber(state.modalPayload && state.modalPayload.year, getDefaultManualYear()));
    const row = computeIncomeSummary().rows.find((item) => item.year === year) || null;
    const autoRow = computeIncomeSummary(new Date(), { ignoreManual: true }).rows.find((item) => item.year === year) || null;
    const sourceText = (key, formatted) => autoRow && autoRow.fieldSources && autoRow.fieldSources[key] !== 'missing'
      ? `<small class="modal-field-source">当前自动值 ${escapeHtml(formatted)}</small>` : '';
    fields = `<label class="modal-field"><span>年份</span><input id="modalManualYearInput" class="modal-input" type="number" inputmode="numeric" value="${escapeHtml(getManualModalValue('year') || String(getDefaultManualYear()))}" placeholder="年份"></label>
      <label class="modal-field"><span>股息收入（CNY）</span><input id="modalManualDividendInput" class="modal-input" type="number" inputmode="decimal" value="${escapeHtml(getManualModalValue('dividendCny'))}" placeholder="留空自动">${sourceText('dividendCny', autoRow ? formatDisplayMoney(autoRow.dividendCny, 'CNY') : '')}</label>
      <label class="modal-field"><span>股息率（%）</span><input id="modalManualDividendRateInput" class="modal-input" type="number" inputmode="decimal" value="${escapeHtml(getManualModalValue('dividendYieldRatePercent'))}" placeholder="留空自动">${sourceText('dividendYieldRate', autoRow && autoRow.dividendYieldRate !== null ? `${(autoRow.dividendYieldRate * 100).toFixed(2)}%` : '')}</label>
      <label class="modal-field"><span>资金收益（CNY）</span><input id="modalManualCapitalInput" class="modal-input" type="number" inputmode="decimal" value="${escapeHtml(getManualModalValue('capitalReturnCny'))}" placeholder="留空自动">${sourceText('capitalReturnCny', autoRow ? formatDisplayMoney(autoRow.capitalReturnCny, 'CNY') : '')}</label>
      <label class="modal-field"><span>资金收益率（%）</span><input id="modalManualCapitalRateInput" class="modal-input" type="number" inputmode="decimal" value="${escapeHtml(getManualModalValue('capitalReturnRatePercent'))}" placeholder="留空自动">${sourceText('capitalReturnRate', autoRow && autoRow.capitalReturnRate !== null ? `${(autoRow.capitalReturnRate * 100).toFixed(2)}%` : '')}</label>
      <label class="modal-field"><span>年末净值（CNY）</span><input id="modalManualYearEndInput" class="modal-input" type="number" inputmode="decimal" value="${escapeHtml(getManualModalValue('yearEndNetCny'))}" placeholder="留空自动">${sourceText('yearEndNetCny', autoRow ? formatDisplayMoney(autoRow.yearEndNetCny, 'CNY') : '')}</label>
      <label class="modal-field"><span>当年净注入（CNY）</span><input id="modalManualNetInflowInput" class="modal-input" type="number" inputmode="decimal" value="${escapeHtml(getManualModalValue('netInflowCny'))}" placeholder="留空自动">${sourceText('netInflowCny', autoRow ? formatDisplayMoney(autoRow.netInflowCny, 'CNY') : '')}</label>
      ${row && row.manualConflicts && row.manualConflicts.length ? `<p class="modal-field-warning">${escapeHtml(row.manualConflicts.join('；'))}</p>` : ''}`;
  } else if (state.modal === 'add') {
    title = LABELS.addTitle; note = LABELS.addNote;
    fields = `<input id="modalSymbolInput" class="modal-input" type="text" placeholder="${LABELS.symbolPlaceholder}">
      <input id="modalQuantityInput" class="modal-input" type="number" inputmode="decimal" placeholder="${LABELS.quantityPlaceholder}">
      <div class="modal-bucket-group" role="group" aria-label="${LABELS.core} / ${LABELS.income}">
        <button class="modal-bucket-button is-core is-active" type="button" data-bucket-option="core" aria-pressed="true">${LABELS.core}</button>
        <button class="modal-bucket-button is-income" type="button" data-bucket-option="income" aria-pressed="false">${LABELS.income}</button>
      </div><input id="modalBucketInput" type="hidden" value="core">`;
  }
  const isReceipt = state.modal === 'dividendLedger';
  refs.modalRoot.innerHTML = `<div class="modal-mask" data-modal-action="close"></div>
    <section class="modal-sheet${isReceipt ? ' dividend-receipt-sheet' : ''}" role="dialog" aria-modal="true">${isReceipt ? '<div class="sheet-handle" aria-hidden="true"></div>' : ''}
    <div class="modal-title-row"><h3 class="modal-title">${title}</h3>${note ? `<p class="modal-note">${escapeHtml(note)}</p>` : ''}</div>${fields}
    <div class="modal-actions">
    ${state.modal === 'yearlyManual' && state.modalPayload.existing ? '<button class="modal-button modal-button--danger" type="button" data-modal-action="delete-yearly-manual">删除</button>' : ''}
    ${state.modal === 'cashFlow' && state.modalPayload && state.modalPayload.id ? '<button class="modal-button modal-button--danger" type="button" data-modal-action="delete-record">删除</button>' : ''}
    ${state.modal === 'trade' && state.modalPayload && state.modalPayload.id ? '<button class="modal-button modal-button--danger" type="button" data-modal-action="delete-record">删除</button>' : ''}
    ${state.modal === 'dividendLedger' && state.modalPayload && state.modalPayload.sourceId ? '<button class="modal-button modal-button--danger" type="button" data-modal-action="delete-dividend-ledger">删除</button>' : ''}
    <button class="modal-button modal-button--secondary" type="button" data-modal-action="cancel">${LABELS.cancel}</button>
    ${state.modal === 'quickAdd' || state.modal === 'holdingsMenu' ? '' : `<button class="modal-button modal-button--primary" type="button" data-modal-action="save">${LABELS.save}</button>`}</div></section>`;
}

function renderMonthDetailModal() {
  const month = Math.floor(safeNumber(state.modalPayload && state.modalPayload.month, 0));
  const detail = buildDividendMonthDetail(month);
  refs.modalRoot.innerHTML = `<div class="modal-mask" data-modal-action="close"></div>
    <section class="modal-sheet modal-sheet--detail is-${escapeHtml(detail.phase)}" role="dialog" aria-modal="true">
      <header class="month-detail-head">
        <div class="month-detail-title">
          <div><small>股息月份</small><h3>${escapeHtml(detail.title)}</h3></div>
          <div class="month-detail-total"><small>应收合计</small><strong>${escapeHtml(detail.total)}</strong></div>
        </div>
        ${detail.stats.length ? `<div class="month-detail-stats">${detail.stats.map((item) => `<span><small>${escapeHtml(item.label)}</small><strong>${escapeHtml(item.value)}</strong></span>`).join('')}</div>` : ''}
        ${detail.hasConfirmable ? '<p class="month-detail-hint">点按待核对项目，确认到账</p>' : ''}
      </header>
      <div class="month-detail-list">${detail.body}</div>
      <div class="modal-actions">
        <button class="modal-button modal-button--primary" type="button" data-modal-action="cancel">${LABELS.cancel === '取消' ? '关闭' : LABELS.cancel}</button>
      </div>
    </section>`;
}

/* 04-持仓诊断抽屉 · 按 designs/禅意UI/04-持仓诊断/定稿图.html
   三组严重度：严重＝涨红点、关注＝金点、数据质量＝灰点（不计入右上计数）。
   每项两行：结论（公司名加粗）+ 依据行，左侧 4px 色点悬挂缩进。诊断规则本身不动。 */
function renderDiagnosticsModal() {
  const model = getPortfolioDiagnostics();
  const group = (label, items, className) => {
    if (!items.length) return '';
    return `<div class="zen-diag-group ${className}">
      <span class="zen-diag-group-label">${escapeHtml(label)}<b>· ${items.length}</b></span>
      <div class="zen-diag-items">${items.map((item) => `<div class="zen-diag-item"><i class="zen-diag-dot" aria-hidden="true"></i><strong>${escapeHtml(item.name)}</strong> ${escapeHtml(item.title)}<br>依据：${escapeHtml(item.evidence)}</div>`).join('')}</div>
    </div>`;
  };
  let body = '';
  if (!model.ready) {
    body = '<p class="zen-diag-empty">正在读取自动基本面，完成后会自动生成诊断</p>';
  } else if (!model.items.length) {
    body = '<p class="zen-diag-empty">仓位、股息与公司基本面均未触发当前规则</p>';
  } else {
    body = [
      group('严重', model.critical, 'is-critical'),
      group('关注', model.attention, 'is-attention'),
      group('数据质量', model.data, 'is-data')
    ].join('');
  }
  refs.modalRoot.innerHTML = `<div class="modal-mask" data-modal-action="close"></div>
    <section class="modal-sheet zen-sheet zen-sheet--diag" role="dialog" aria-modal="true" aria-labelledby="diagnosticsTitle">
      <div class="zen-sheet-handle" aria-hidden="true"></div>
      <header class="zen-diag-head">
        <div><h3 id="diagnosticsTitle">持仓诊断</h3><p>只列异常 · 全部自动计算</p></div>
        <strong class="zen-diag-count">${model.actionableCount}</strong>
      </header>
      <div class="zen-diag-body">${body}</div>
      <div class="zen-sheet-actions"><button class="zen-key zen-key--cancel" type="button" data-modal-action="cancel">关 闭</button></div>
    </section>`;
}

// 基本面页的公司选择：半屏列表，持仓在前（附市值），观察/已清仓排在后。
function renderFundPickerModal() {
  const model = getFundamentalsPickerModel();
  const rowHtml = (item) => `<button class="fund-picker-row${item.selected ? ' is-active' : ''}" type="button" data-modal-action="pick-fund-symbol" data-symbol="${escapeHtml(item.symbol)}" aria-pressed="${item.selected ? 'true' : 'false'}">
      <span class="fp-name"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.symbol)}</small></span>
      <span class="fp-side">${item.marketValueCny > 0 ? `<strong>${escapeHtml(formatDisplayMoney(item.marketValueCny, 'CNY'))}</strong>` : '<strong>—</strong>'}<small>${item.selected ? '当前' : '&nbsp;'}</small></span>
    </button>`;
  const holdingsHtml = model.holdings.length
    ? `<p class="fund-picker-group">持仓 · 按市值</p>${model.holdings.map(rowHtml).join('')}`
    : '';
  const othersHtml = model.others.length
    ? `<p class="fund-picker-group">观察 / 已清仓</p>${model.others.map(rowHtml).join('')}`
    : '';
  refs.modalRoot.innerHTML = `<div class="modal-mask" data-modal-action="close"></div>
    <section class="modal-sheet modal-sheet--detail" role="dialog" aria-modal="true">
      <header class="month-detail-head">
        <div class="month-detail-title">
          <h3>选择公司</h3>
          <strong>${model.holdings.length + model.others.length} 家</strong>
        </div>
      </header>
      <div class="month-detail-list fund-picker-list">${holdingsHtml}${othersHtml}</div>
      <div class="modal-actions">
        <button class="modal-button modal-button--primary" type="button" data-modal-action="cancel">关闭</button>
      </div>
    </section>`;
}

function formatSnapshotShares(value) {
  return safeNumber(value, 0).toLocaleString('en-US', { maximumFractionDigits: 6 });
}

// 与上一份快照（最近的更早年份）逐只对比：新增 / 清仓 / 加减仓。
function buildYearHoldingsDiff(entry, previous) {
  const previousBySymbol = new Map((previous ? previous.holdings : []).map((item) => [item.symbol, item]));
  const rows = entry.holdings.map((item) => {
    const before = previousBySymbol.get(item.symbol);
    previousBySymbol.delete(item.symbol);
    if (!previous) return { ...item, change: '' };
    if (!before) return { ...item, change: '新增' };
    const delta = safeNumber(item.shares, 0) - safeNumber(before.shares, 0);
    if (Math.abs(delta) < 0.000001) return { ...item, change: '' };
    return { ...item, change: `${delta > 0 ? '+' : '−'}${formatSnapshotShares(Math.abs(delta))}` };
  });
  const removed = Array.from(previousBySymbol.values());
  return { rows, removed };
}

// 年度持仓快照弹窗：该年逐只持仓 + 权重，附与上一份快照的增减仓对比。
function renderYearHoldingsModal() {
  const year = Math.floor(safeNumber(state.modalPayload && state.modalPayload.year, 0));
  const entry = state.yearlyHoldings.find((item) => item && item.year === year) || null;
  if (!entry) {
    refs.modalRoot.innerHTML = `<div class="modal-mask" data-modal-action="close"></div>
      <section class="modal-sheet modal-sheet--detail" role="dialog" aria-modal="true">
        <h3 class="modal-title">${year} 年持仓</h3>
        <div class="month-detail-empty">该年暂无持仓快照</div>
        <div class="modal-actions"><button class="modal-button modal-button--primary" type="button" data-modal-action="cancel">关闭</button></div>
      </section>`;
    return;
  }
  const previous = state.yearlyHoldings
    .filter((item) => item && item.year < year)
    .sort((a, b) => b.year - a.year)[0] || null;
  const diff = buildYearHoldingsDiff(entry, previous);
  const total = entry.holdings.reduce((sum, item) => sum + safeNumber(item.marketValueCny, 0), 0) || 1;
  const isCurrentYear = year === new Date().getFullYear();
  const noteParts = [`截至 ${entry.date || `${year}-12-31`}`];
  if (isCurrentYear) noteParts.push('当年快照随行情结算持续更新，跨年后自动冻结');
  if (entry.source === 'backfill') noteParts.push('由历史日快照补出，市值按当前价估算');
  if (previous) noteParts.push(`增减仓对比 ${previous.year} 年`);
  const rowsHtml = diff.rows
    .slice()
    .sort((a, b) => safeNumber(b.marketValueCny, 0) - safeNumber(a.marketValueCny, 0))
    .map((item) => `<div class="year-holdings-row">
      <span class="yh-name"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.symbol)} · ${item.bucket === 'income' ? LABELS.income : LABELS.core}</small></span>
      <span class="yh-shares"><strong>${escapeHtml(formatSnapshotShares(item.shares))}</strong>${item.change ? `<small class="yh-change${item.change === '新增' ? ' is-new' : ''}">${escapeHtml(item.change)}</small>` : '<small>&nbsp;</small>'}</span>
      <span class="yh-value"><strong>${escapeHtml(formatDisplayMoney(item.marketValueCny, 'CNY'))}</strong><small>${((safeNumber(item.marketValueCny, 0) / total) * 100).toFixed(1)}%</small></span>
    </div>`).join('');
  const removedHtml = diff.removed.length
    ? `<div class="year-holdings-removed">
        <span class="yh-removed-label">已清仓（${previous.year} 年持有）</span>
        ${diff.removed.map((item) => `<span class="yh-removed-item">${escapeHtml(item.name)} · ${escapeHtml(formatSnapshotShares(item.shares))}</span>`).join('')}
      </div>`
    : '';
  refs.modalRoot.innerHTML = `<div class="modal-mask" data-modal-action="close"></div>
    <section class="modal-sheet modal-sheet--detail" role="dialog" aria-modal="true">
      <header class="month-detail-head">
        <div class="month-detail-title">
          <h3>${year} 年持仓 · ${entry.holdings.length} 项</h3>
          <strong>${escapeHtml(formatDisplayMoney(entry.totalMarketValueCny, 'CNY'))}</strong>
        </div>
        <p class="month-detail-summary">${escapeHtml(noteParts.join(' · '))}</p>
      </header>
      <div class="month-detail-list year-holdings-list">${rowsHtml}</div>
      ${removedHtml}
      <div class="modal-actions">
        <button class="modal-button modal-button--primary" type="button" data-modal-action="cancel">关闭</button>
      </div>
    </section>`;
}

function formatAnnalsMoney(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return formatDisplayMoney(value, 'CNY');
}

function formatAnnalsSigned(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const numeric = Number(value);
  return `${numeric >= 0 ? '+' : '−'}${formatDisplayMoney(Math.abs(numeric), 'CNY')}`;
}

function annalsReturnTone(value) {
  const numeric = safeNumber(value, 0);
  return numeric > 0 ? 'is-gain' : numeric < 0 ? 'is-loss' : 'is-flat';
}

function buildAnnalsMetric(label, value, toneClass = '') {
  return `<span class="annals-metric"><small>${escapeHtml(label)}</small><strong${toneClass ? ` class="${toneClass}"` : ''}>${escapeHtml(value)}</strong></span>`;
}

/* 归因区：股息 / 汇率 / 价格三行；价格行下按覆盖度附 EPS/估值 拆分。 */
function buildAnnalsAttribution(annals) {
  const attribution = annals.attribution;
  const rows = [];
  rows.push(`<div class="annals-attr-row"><span>股息收入</span><strong class="${annalsReturnTone(attribution.dividendCny)}">${escapeHtml(formatAnnalsSigned(attribution.dividendCny))}</strong></div>`);
  if (!attribution.available) {
    return `<div class="annals-block">
      <p class="annals-block-title">收益归因</p>
      ${rows.join('')}
      <p class="annals-note">缺少该年的年初持仓快照或汇率，汇率与价格归因暂不可算。</p>
    </div>`;
  }
  rows.push(`<div class="annals-attr-row"><span>汇率变动</span><strong class="${annalsReturnTone(attribution.fxCny)}">${escapeHtml(formatAnnalsSigned(attribution.fxCny))}</strong></div>`);
  rows.push(`<div class="annals-attr-row"><span>价格变动</span><strong class="${annalsReturnTone(attribution.priceCny)}">${escapeHtml(formatAnnalsSigned(attribution.priceCny))}</strong></div>`);
  const coverage = Math.round(safeNumber(attribution.epsSplitCoverage, 0) * 100);
  const split = coverage > 0
    ? `<div class="annals-attr-sub">
        <span>其中（按年初持仓 ${coverage}% 市值近似）</span>
        <span>EPS 增长 <strong class="${annalsReturnTone(attribution.epsCny)}">${escapeHtml(formatAnnalsSigned(attribution.epsCny))}</strong> · 估值变动 <strong class="${annalsReturnTone(attribution.valuationCny)}">${escapeHtml(formatAnnalsSigned(attribution.valuationCny))}</strong></span>
      </div>`
    : '';
  return `<div class="annals-block">
    <p class="annals-block-title">收益归因</p>
    ${rows.join('')}
    ${split}
    <p class="annals-note">合计 = 股息 + 汇率 + 价格；汇率按年初持仓与年界汇率近似，不含年内调仓影响。</p>
  </div>`;
}

function buildAnnalsTrades(annals) {
  if (!annals.trades.length) {
    return `<div class="annals-block"><p class="annals-block-title">当年交易</p><p class="annals-empty">暂无交易记录，无法判断年内调仓情况。</p></div>`;
  }
  const rows = annals.trades.map((trade) => `<div class="annals-trade-row">
    <span class="annals-trade-date">${escapeHtml(trade.date.slice(5))}</span>
    <span class="annals-trade-side ${trade.side === 'sell' ? 'is-income' : 'is-core'}">${trade.side === 'sell' ? '卖出' : '买入'}</span>
    <span class="annals-trade-name">${escapeHtml(trade.name)}</span>
    <span class="annals-trade-value">${escapeHtml(formatAnnalsMoney(trade.valueCny))}</span>
  </div>`).join('');
  return `<div class="annals-block">
    <p class="annals-block-title">当年交易<span class="annals-block-count">${annals.trades.length} 笔</span></p>
    ${rows}
  </div>`;
}

/* 年度年鉴弹窗：数字 → 归因 → 交易，全部只读、全自动。 */
function renderYearAnnalsModal() {
  const year = Math.floor(safeNumber(state.modalPayload && state.modalPayload.year, 0));
  const annals = year ? computeYearAnnals(year) : null;
  if (!annals) {
    refs.modalRoot.innerHTML = `<div class="modal-mask" data-modal-action="close"></div>
      <section class="modal-sheet modal-sheet--detail" role="dialog" aria-modal="true">
        <h3 class="modal-title">${year} 年鉴</h3>
        <div class="month-detail-empty">该年暂无数据</div>
        <div class="modal-actions"><button class="modal-button modal-button--primary" type="button" data-modal-action="cancel">关闭</button></div>
      </section>`;
    return;
  }
  const row = annals.row;
  const rate = (value) => (value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : `${(Number(value) * 100).toFixed(1)}%`);
  const metrics = [
    buildAnnalsMetric('股息收入', formatAnnalsMoney(row.dividendCny)),
    buildAnnalsMetric('资金收益', formatAnnalsSigned(row.capitalReturnCny), annalsReturnTone(row.capitalReturnCny)),
    buildAnnalsMetric(`XIRR${annals.xirrScope ? `（${annals.xirrScope}）` : ''}`, rate(annals.xirr), annalsReturnTone(annals.xirr)),
    buildAnnalsMetric('净注入', formatAnnalsSigned(row.netInflowCny)),
    buildAnnalsMetric('年末净值', formatAnnalsMoney(row.yearEndNetCny))
  ].join('');
  refs.modalRoot.innerHTML = `<div class="modal-mask" data-modal-action="close"></div>
    <section class="modal-sheet modal-sheet--detail" role="dialog" aria-modal="true">
      <header class="month-detail-head">
        <div class="month-detail-title">
          <h3>${year} 年鉴</h3>
          ${annals.isCurrentYear ? '<strong class="annals-live">进行中</strong>' : ''}
        </div>
        <p class="month-detail-summary">${annals.isCurrentYear ? '当年数据随结算滚动，跨年后自动冻结' : '已冻结的年度复盘'}</p>
      </header>
      <div class="month-detail-list annals-body">
        <div class="annals-metric-grid">${metrics}</div>
        ${buildAnnalsAttribution(annals)}
        ${buildAnnalsTrades(annals)}
      </div>
      <div class="modal-actions">
        <button class="modal-button modal-button--primary" type="button" data-modal-action="cancel">关闭</button>
      </div>
    </section>`;
}

// 切换某笔股息的「已到账确认」。确认=锁定为已到账(绿点，且对账不再清理)；取消=回到自动判定(黄点)。
export function toggleDividendConfirm(sourceId) {
  if (!sourceId) return;
  const index = state.dividendLedger.findIndex((entry) => entry && entry.sourceId === sourceId);
  if (index < 0) return;
  const entry = state.dividendLedger[index];
  const confirming = entry.confirmed !== true;
  const nextEntry = {
    ...entry,
    confirmed: confirming,
    receiptStatus: confirming ? 'received' : (entry.receiptStatus || 'pending'),
    confidence: confirming ? 'confirmed' : (entry.confidence === 'confirmed' ? 'snapshot' : entry.confidence),
    receivedDate: confirming ? (formatDateLabel(entry.receivedDate) || getTodayLabel()) : '',
    updatedAt: new Date().toISOString()
  };
  adjustCashForRecordChange(
    entry, getDividendCashImpactCny(entry), getDividendCashDate(entry),
    nextEntry, getDividendCashImpactCny(nextEntry), getDividendCashDate(nextEntry)
  );
  state.dividendLedger[index] = nextEntry;
  archiveCompletedYears(getTodayLabel());
  saveState();
  renderSavedStateQuietly({ animateHoldingReflow: false });
  if (state.modal === 'monthDetail') renderMonthDetailModal();
}

function saveDividendLedgerEdit() {
  const sourceId = state.modalPayload && state.modalPayload.sourceId;
  const index = state.dividendLedger.findIndex((entry) => entry && entry.sourceId === sourceId);
  if (index < 0) { showToast('未找到这笔股息', { type: 'error' }); return false; }
  const entry = state.dividendLedger[index];
  const payDate = formatDateLabel(document.getElementById('modalDividendPayDateInput').value);
  const receivedDateRaw = formatDateLabel(document.getElementById('modalDividendReceivedDateInput').value);
  const netCny = safeNumber(document.getElementById('modalDividendNetInput').value, 0);
  if (netCny <= 0) { showToast('请输入有效实收金额', { type: 'error' }); return false; }
  const confirmed = document.getElementById('modalDividendConfirmedInput').checked === true;
  const receivedDate = confirmed ? (receivedDateRaw || getTodayLabel()) : receivedDateRaw;
  const effectivePay = resolveEffectivePayDate(entry.exDate, payDate, entry.symbol);
  const receiptStatus = confirmed
    ? 'received'
    : ((effectivePay.date || entry.exDate) <= getTodayLabel() ? 'due' : 'pending');
  const nextEntry = {
    ...entry,
    payDate,
    payDateSource: payDate !== formatDateLabel(entry.payDate) ? 'manual' : entry.payDateSource,
    receivedDate,
    netCny,
    receiptStatus,
    confidence: confirmed ? 'confirmed' : 'manual',
    confirmed,
    note: document.getElementById('modalDividendNoteInput').value.trim(),
    updatedAt: new Date().toISOString()
  };
  adjustCashForRecordChange(
    entry, getDividendCashImpactCny(entry), getDividendCashDate(entry),
    nextEntry, getDividendCashImpactCny(nextEntry), getDividendCashDate(nextEntry)
  );
  state.dividendLedger[index] = nextEntry;
  return true;
}

function saveCashFlowEdit() {
  const previousId = state.modalPayload && state.modalPayload.id;
  const previousEntry = state.cashFlows.find((item) => item.id === previousId) || null;
  const now = new Date().toISOString();
  const entry = sanitizeCashFlowEntry({
    id: previousId || createRecordId('cf'),
    date: document.getElementById('modalCashFlowDateInput').value,
    amountCny: safeNumber(document.getElementById('modalCashFlowAmountInput').value, 0),
    type: document.getElementById('modalCashFlowTypeInput').value,
    note: document.getElementById('modalCashFlowNoteInput').value.trim(),
    createdAt: previousEntry && previousEntry.createdAt || now,
    updatedAt: now
  });
  if (!entry || entry.amountCny <= 0) { showToast('请输入有效出入金', { type: 'error' }); return false; }
  adjustCashForRecordChange(
    previousEntry, getCashFlowCashImpactCny(previousEntry), previousEntry && previousEntry.date,
    entry, getCashFlowCashImpactCny(entry), entry.date
  );
  state.cashFlows = state.cashFlows
    .filter((item) => item.id !== previousId && item.id !== entry.id)
    .concat(entry)
    .sort((a, b) => `${b.date}|${b.id}`.localeCompare(`${a.date}|${a.id}`));
  return true;
}

function saveTradeEdit() {
  const previousId = state.modalPayload && state.modalPayload.id;
  const previousEntry = state.trades.find((item) => item.id === previousId) || null;
  const symbolValue = document.getElementById('modalTradeSymbolInput').value;
  const selectedSide = document.querySelector('[data-trade-side][aria-pressed="true"]')?.dataset.tradeSide;
  // 币种按代码自动识别；汇率按当天行情自动换算。
  const currency = detectTradeCurrency(symbolValue);
  const now = new Date().toISOString();
  const entry = sanitizeTradeEntry({
    id: previousId || createRecordId('tr'),
    date: document.getElementById('modalTradeDateInput').value,
    symbol: symbolValue,
    side: selectedSide === 'sell' ? 'sell' : document.getElementById('modalTradeSideInput').value,
    shares: safeNumber(document.getElementById('modalTradeSharesInput').value, 0),
    price: safeNumber(document.getElementById('modalTradePriceInput').value, 0),
    currency,
    fxRate: resolveFxRate(currency, state.rates),
    feeCny: safeNumber(document.getElementById('modalTradeFeeInput').value, 0),
    bucket: document.getElementById('modalBucketInput').value,
    note: document.getElementById('modalTradeNoteInput').value.trim(),
    createdAt: previousEntry && previousEntry.createdAt || now,
    updatedAt: now
  });
  if (!entry) { showToast('请输入有效交易', { type: 'error' }); return false; }
  const proposedTrades = state.trades.filter((item) => item.id !== previousId && item.id !== entry.id).concat(entry);
  if (!validateTradeInventory(proposedTrades).valid) { showToast('卖出股数超过该时点可用持仓，请检查交易日期与顺序', { type: 'error' }); return false; }
  adjustCashForRecordChange(
    previousEntry, getTradeCashImpactCny(previousEntry), previousEntry && previousEntry.date,
    entry, getTradeCashImpactCny(entry), entry.date
  );
  if (!state.positionOpeningDate) state.positionOpeningDate = entry.date;
  state.trades = proposedTrades
    .sort((a, b) => `${b.date}|${b.id}`.localeCompare(`${a.date}|${a.id}`));
  state.quotes = mergeQuotes(state.quotes, { [entry.symbol]: inferQuote(entry.symbol) });
  // 买入一只尚未持有的股票时，自动建一条基准股数为 0 的持仓；现金是否设置不再影响持股推算。
  if (!state.holdings.some((h) => h.symbol === entry.symbol)) {
    state.holdings = state.holdings.concat({
      localId: state.nextId, symbol: entry.symbol, quantity: 0, bucket: entry.bucket === 'income' ? 'income' : 'core',
      taxRateOverride: '', dividendPerShareTtmOverride: '', dividendPerShareTtmOverrideTouched: false,
      createdAt: now, updatedAt: now
    });
    removeRecordTombstone('holding', entry.symbol);
    state.nextId += 1;
  }
  return true;
}

export function handleModalSave() {
  if (state.modal === 'monthDetail' || state.modal === 'holdingDetail' || state.modal === 'yearHoldings' || state.modal === 'yearAnnals' || state.modal === 'diagnostics' || state.modal === 'fundPicker' || state.modal === 'holdingsMenu') { closeModal(); return; }
  if (state.modal === 'quickAdd') return;
  let returnMonth = 0;
  if (state.modal === 'quantity') {
    const v = Math.max(0, safeNumber(document.getElementById('modalQuantityInput').value, 0));
    state.holdings = state.holdings.map((i) => i.localId === state.modalPayload.localId ? { ...i, quantity: v, updatedAt: new Date().toISOString() } : i);
  } else if (state.modal === 'tax') {
    const raw = document.getElementById('modalTaxInput').value.trim();
    const v = raw === '' ? '' : String(Math.min(100, Math.max(0, safeNumber(raw, 0))));
    state.holdings = state.holdings.map((i) => i.localId === state.modalPayload.localId ? { ...i, taxRateOverride: v, updatedAt: new Date().toISOString() } : i);
  } else if (state.modal === 'dividend') {
    const v = sanitizePerShareOverrideInput(document.getElementById('modalDividendInput').value.trim());
    state.holdings = state.holdings.map((i) => i.localId === state.modalPayload.localId ? { ...i, dividendPerShareTtmOverride: v, dividendPerShareTtmOverrideTouched: v !== '', updatedAt: new Date().toISOString() } : i);
  } else if (state.modal === 'liability') {
    state.liabilityCny = Math.max(0, safeNumber(document.getElementById('modalLiabilityInput').value, 0));
  } else if (state.modal === 'openingCash') {
    const cashDate = formatDateLabel(document.getElementById('modalCurrentCashDateInput').value) || getTodayLabel();
    const positionDate = formatDateLabel(document.getElementById('modalPositionOpeningDateInput').value);
    const earliestTrade = state.trades.map((entry) => formatDateLabel(entry.date)).filter(Boolean).sort()[0] || '';
    if (earliestTrade && positionDate && positionDate > earliestTrade) {
      showToast('交易持仓起点不能晚于已有最早交易', { type: 'error' }); return;
    }
    state.positionOpeningDate = positionDate;
    setCurrentCashBalance(safeNumber(document.getElementById('modalCurrentCashInput').value, 0), cashDate);
  } else if (state.modal === 'dividendLedger') {
    returnMonth = Math.floor(safeNumber(state.modalPayload && state.modalPayload.returnMonth, 0));
    if (!saveDividendLedgerEdit()) return;
  } else if (state.modal === 'cashFlow') {
    if (!saveCashFlowEdit()) return;
  } else if (state.modal === 'trade') {
    if (!saveTradeEdit()) return;
  } else if (state.modal === 'yearlyManual') {
    const year = Math.floor(safeNumber(document.getElementById('modalManualYearInput').value, 0));
    if (year < 1900 || year > 2200) { showToast('请输入有效年份', { type: 'error' }); return; }
    const previousYear = Math.floor(safeNumber(state.modalPayload && state.modalPayload.year, 0));
    const nullable = (id, opts = {}) => {
      const raw = document.getElementById(id).value.trim();
      if (raw === '') return null;
      const value = safeNumber(raw, 0);
      return opts.nonNegative ? Math.max(0, value) : value;
    };
    const capitalRaw = document.getElementById('modalManualCapitalInput').value.trim();
    const capitalRateRaw = document.getElementById('modalManualCapitalRateInput').value.trim();
    const entry = {
      year,
      dividendCny: nullable('modalManualDividendInput', { nonNegative: true }),
      dividendYieldRate: nullable('modalManualDividendRateInput', { nonNegative: true }) === null ? null : nullable('modalManualDividendRateInput', { nonNegative: true }) / 100,
      yearEndNetCny: nullable('modalManualYearEndInput'),
      netInflowCny: nullable('modalManualNetInflowInput'),
      capitalReturnCny: capitalRaw === '' ? null : safeNumber(capitalRaw, 0),
      capitalReturnRate: capitalRateRaw === '' ? null : safeNumber(capitalRateRaw, 0) / 100,
      source: 'manual'
    };
    const hasOverride = ['dividendCny', 'dividendYieldRate', 'yearEndNetCny', 'netInflowCny', 'capitalReturnCny', 'capitalReturnRate']
      .some((key) => entry[key] !== null && entry[key] !== undefined);
    state.yearlyManual = state.yearlyManual
      .filter((item) => item.year !== year && item.year !== previousYear)
      .concat(hasOverride ? entry : [])
      .sort((a, b) => b.year - a.year);
  } else if (state.modal === 'add') {
    const symbol = normalizeSymbol(document.getElementById('modalSymbolInput').value);
    const quantity = Math.max(0, safeNumber(document.getElementById('modalQuantityInput').value, 0));
    const bucket = document.getElementById('modalBucketInput').value === 'income' ? 'income' : 'core';
    if (!symbol) { showToast(LABELS.missingSymbol, { type: 'error' }); return; }
    if (state.holdings.some((i) => normalizeSymbol(i.symbol) === symbol)) { showToast(`${symbol} ${LABELS.duplicateHolding}`, { type: 'error' }); return; }
    const now = new Date().toISOString();
    state.holdings = state.holdings.concat({ localId: state.nextId, symbol, quantity, bucket, taxRateOverride: '', dividendPerShareTtmOverride: '', dividendPerShareTtmOverrideTouched: false, createdAt: now, updatedAt: now });
    removeRecordTombstone('holding', symbol);
    state.quotes = mergeQuotes(state.quotes, { [symbol]: inferQuote(symbol) });
    state.nextId += 1;
  }
  archiveCompletedYears(getTodayLabel());
  saveState();
  if (returnMonth >= 1 && returnMonth <= 12) {
    renderSavedStateQuietly({ animateHoldingReflow: false });
    state.modal = 'monthDetail';
    state.modalPayload = { month: returnMonth };
    renderModal();
    return;
  }
  closeModal();
  renderSavedStateQuietly({ animateHoldingReflow: true });
}

function formatHoldingQuantity(value) {
  if (!state.showAmounts) return '••••';
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 4 }).format(Math.max(0, safeNumber(value, 0)));
}

/* 03-持仓详情抽屉 · 按 designs/禅意UI/03-持仓详情/定稿图.html
   抬头（代码·所属仓 / 公司名 / 权重）→ 当前持股主数 → 台账七行 → 沉底口径说明 → 关闭。 */
function renderHoldingDetailModal() {
  const localId = safeNumber(state.modalPayload && state.modalPayload.localId, 0);
  const item = computeHoldings().holdings.find((holding) => holding.localId === localId);
  if (!item) {
    refs.modalRoot.innerHTML = `<div class="modal-mask" data-modal-action="close"></div>
      <section class="modal-sheet zen-sheet zen-sheet--detail" role="dialog" aria-modal="true">
        <div class="zen-sheet-handle" aria-hidden="true"></div>
        <div class="zen-sheet-title"><span class="zen-sheet-title-text">持仓详情</span><p class="zen-sheet-note">未找到这项持仓</p></div>
        <div class="zen-sheet-actions"><button class="zen-key zen-key--cancel" type="button" data-modal-action="cancel">关 闭</button></div>
      </section>`;
    return;
  }
  const taxPercent = Math.min(100, Math.max(0, safeNumber(item.taxRateOverride, 0)));
  const bucketLabel = item.bucket === 'income' ? LABELS.income : LABELS.core;
  const sourceLabel = item.dividendPerShareTtmOverrideTouched === true ? '手动每股股息' : '自动行情';
  const quantity = formatHoldingQuantity(item.quantity);
  const baselineHolding = state.holdings.find((holding) => holding.localId === localId);
  const baselineQuantity = formatHoldingQuantity(baselineHolding && baselineHolding.quantity);
  const row = (label, value) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
  refs.modalRoot.innerHTML = `<div class="modal-mask" data-modal-action="close"></div>
    <section class="modal-sheet zen-sheet zen-sheet--detail" role="dialog" aria-modal="true" aria-labelledby="holdingDetailTitle">
      <div class="zen-sheet-handle" aria-hidden="true"></div>
      <header class="zen-detail-head">
        <div><small>${escapeHtml(item.symbol)} · ${escapeHtml(bucketLabel)}</small><h3 id="holdingDetailTitle">${escapeHtml(item.name)}</h3></div>
        <span class="zen-detail-weight">${escapeHtml((safeNumber(item.holdingWeight, 0) * 100).toFixed(1))}%</span>
      </header>
      <div class="zen-detail-qty">
        <small>当前持股</small><strong>${escapeHtml(quantity)}<em>股</em></strong>
      </div>
      <dl class="zen-detail-rows">
        ${row('现价', state.showAmounts ? formatDisplayMoney(item.price, item.currency) : '••••')}
        ${row('持仓市值', formatDisplayMoney(item.marketValueCny, 'CNY'))}
        ${row('交易起点基准股数', baselineQuantity)}
        ${row('股息税率', item.taxRateKnown ? `${taxPercent}%` : '未设置（按 0% 估算）')}
        ${row('每股 TTM 股息', state.showAmounts ? formatDisplayMoney(item.effectiveDividendPerShareTtm, item.currency) : '••••')}
        ${row('税前年化股息', formatDisplayMoney(item.grossAnnualDividendCny, 'CNY'))}
        ${row('税后年化股息', formatDisplayMoney(item.netAnnualDividendCny, 'CNY'))}
      </dl>
      <p class="zen-detail-note">${escapeHtml(sourceLabel)} · 金额按当前汇率折算人民币 · 已除息事件以除息日快照为准</p>
      <div class="zen-sheet-actions"><button class="zen-key zen-key--cancel" type="button" data-modal-action="cancel">关 闭</button></div>
    </section>`;
}

export function handleModalDelete() {
  if (state.modal === 'cashFlow') {
    const id = state.modalPayload && state.modalPayload.id;
    if (!id) return;
    const entry = state.cashFlows.find((item) => item.id === id) || null;
    adjustCashForRecordChange(
      entry, getCashFlowCashImpactCny(entry), entry && entry.date,
      null, 0, ''
    );
    state.cashFlows = state.cashFlows.filter((item) => item.id !== id);
    addRecordTombstone('cashFlow', id);
    archiveCompletedYears(getTodayLabel());
    saveState(); closeModal(); renderSavedStateQuietly({ animateHoldingReflow: false });
    return;
  }
  if (state.modal === 'trade') {
    const id = state.modalPayload && state.modalPayload.id;
    if (!id) return;
    const entry = state.trades.find((item) => item.id === id) || null;
    adjustCashForRecordChange(
      entry, getTradeCashImpactCny(entry), entry && entry.date,
      null, 0, ''
    );
    state.trades = state.trades.filter((item) => item.id !== id);
    addRecordTombstone('trade', id);
    archiveCompletedYears(getTodayLabel());
    saveState(); closeModal(); renderSavedStateQuietly({ animateHoldingReflow: false });
    return;
  }
  if (state.modal === 'dividendLedger') {
    const sourceId = state.modalPayload && state.modalPayload.sourceId;
    if (!sourceId) return;
    const entry = getDividendLedgerEntryBySourceId(sourceId);
    if (!entry) return;
    // 已确认的股息进过现金余额，删除时要原路冲回。
    adjustCashForRecordChange(
      entry, getDividendCashImpactCny(entry), getDividendCashDate(entry),
      null, 0, ''
    );
    ignoreDividendLedgerEntry(sourceId);
    archiveCompletedYears(getTodayLabel());
    saveState(); closeModal(); renderSavedStateQuietly({ animateHoldingReflow: false });
    showToast('已删除这笔股息，不会再自动生成', { type: 'success' });
    return;
  }
  if (state.modal !== 'yearlyManual') return;
  const year = Math.floor(safeNumber(state.modalPayload && state.modalPayload.year, 0));
  if (!year) return;
  state.yearlyManual = state.yearlyManual.filter((item) => item.year !== year);
  saveState(); closeModal(); renderSavedStateQuietly({ animateHoldingReflow: false });
}
