import { state, refs, saveState, showToast } from './state.js';
import {
  safeNumber, escapeHtml, normalizeSymbol, sanitizePerShareOverrideInput,
  mergeQuotes, sanitizeCashFlowEntry, sanitizeTradeEntry, formatDateLabel,
  resolveQuoteCurrency, resolveFxRate
} from './utils.js';
import { LABELS } from './constants.js';
import { renderSavedStateQuietly, buildDividendMonthDetail } from './render.js';
import { inferQuote } from './compute.js';

let _keydownHandler = null;

export function openModal(type, payload = {}) {
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
  const input = document.getElementById('modalCashFlowTypeInput'); if (input) input.value = type;
  Array.from(document.querySelectorAll('[data-cash-flow-type]')).forEach((b) => {
    const a = b.dataset.cashFlowType === type; b.classList.toggle('is-active', a); b.setAttribute('aria-pressed', a ? 'true' : 'false');
  });
}

export function setModalTradeSideSelection(next) {
  const side = next === 'sell' ? 'sell' : 'buy';
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
  return state.trades.find((entry) => entry && entry.id === state.modalPayload.id) || state.modalPayload;
}

function renderSegmentGroup(hiddenId, value, options) {
  return `<div class="modal-bucket-group" role="group">
    ${options.map((option) => `<button class="modal-bucket-button ${option.className || ''}${option.value === value ? ' is-active' : ''}" type="button" ${option.dataAttr}="${escapeHtml(option.value)}" aria-pressed="${option.value === value ? 'true' : 'false'}">${escapeHtml(option.label)}</button>`).join('')}
  </div><input id="${hiddenId}" type="hidden" value="${escapeHtml(value)}">`;
}

function getTradeCurrencyDefault(symbol) {
  const quote = inferQuote(symbol);
  return resolveQuoteCurrency(quote, symbol);
}

function renderModal() {
  if (!state.modal) { refs.modalRoot.innerHTML = ''; return; }
  if (state.modal === 'monthDetail') { renderMonthDetailModal(); return; }
  let title = '', note = '', fields = '';
  if (state.modal === 'quantity') {
    title = LABELS.quantityTitle; note = state.modalPayload.name || '';
    fields = `<input id="modalQuantityInput" class="modal-input" type="number" inputmode="decimal" value="${escapeHtml(String(state.modalPayload.value ?? ''))}" placeholder="${LABELS.quantityPlaceholder}">`;
  } else if (state.modal === 'tax') {
    title = LABELS.taxTitle; note = state.modalPayload.name || '';
    fields = `<input id="modalTaxInput" class="modal-input" type="number" inputmode="decimal" value="${escapeHtml(String(state.modalPayload.value ?? ''))}" placeholder="${LABELS.taxPlaceholder}">`;
  } else if (state.modal === 'dividend') {
    title = LABELS.dividendPerShareTitle;
    note = [state.modalPayload.name || '', state.modalPayload.currency ? `${LABELS.dividendPerShareHint} (${state.modalPayload.currency})` : LABELS.dividendPerShareHint].filter(Boolean).join(' - ');
    fields = `<input id="modalDividendInput" class="modal-input" type="number" inputmode="decimal" value="${escapeHtml(String(state.modalPayload.value ?? ''))}" placeholder="${LABELS.dividendPerSharePlaceholder}">`;
  } else if (state.modal === 'liability') {
    title = LABELS.liabilityTitle; note = LABELS.totalMarketValue;
    fields = `<input id="modalLiabilityInput" class="modal-input" type="number" inputmode="decimal" value="${escapeHtml(String(state.modalPayload.value ?? ''))}" placeholder="${LABELS.liabilityPlaceholder}">`;
  } else if (state.modal === 'dividendLedger') {
    const entry = getDividendLedgerEntryBySourceId(state.modalPayload && state.modalPayload.sourceId);
    const quote = entry ? inferQuote(entry.symbol) : {};
    title = '股息到账';
    note = entry ? `${quote.name || entry.symbol} · ${entry.symbol}` : '未找到这笔股息';
    fields = entry ? `<label class="modal-field"><span>到账日</span><input id="modalDividendPayDateInput" class="modal-input" type="date" value="${escapeHtml(formatDateLabel(entry.payDate) || formatDateLabel(entry.exDate))}"></label>
      <label class="modal-field"><span>实收金额（CNY）</span><input id="modalDividendNetInput" class="modal-input" type="number" inputmode="decimal" value="${escapeHtml(String(safeNumber(entry.netCny, 0)))}" placeholder="0.00"></label>
      <label class="modal-field"><span>备注</span><input id="modalDividendNoteInput" class="modal-input" type="text" value="${escapeHtml(entry.note || '')}" placeholder="可选"></label>
      <label class="modal-check"><input id="modalDividendConfirmedInput" type="checkbox"${entry.confirmed === true ? ' checked' : ''}><span>标记已到账</span></label>` : '';
  } else if (state.modal === 'cashFlow') {
    const entry = getCashFlowPayload();
    const type = entry && entry.type === 'withdrawal' ? 'withdrawal' : 'deposit';
    title = entry ? '编辑出入金' : '新增出入金';
    note = '用于年度净注入口径';
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
    const currency = entry && entry.currency ? entry.currency : getTradeCurrencyDefault(symbol);
    const fxRate = entry ? entry.fxRate : resolveFxRate(currency, state.rates);
    title = entry ? '编辑交易' : '新增交易';
    note = '用于成本、已实现盈亏和 Yield on Cost';
    fields = `<label class="modal-field"><span>日期</span><input id="modalTradeDateInput" class="modal-input" type="date" value="${escapeHtml(formatDateLabel(entry && entry.date) || getTodayLabel())}"></label>
      <label class="modal-field"><span>股票代码</span><input id="modalTradeSymbolInput" class="modal-input" type="text" value="${escapeHtml(symbol)}" placeholder="${LABELS.symbolPlaceholder}"></label>
      ${renderSegmentGroup('modalTradeSideInput', side, [
        { value: 'buy', label: '买入', className: 'is-core', dataAttr: 'data-trade-side' },
        { value: 'sell', label: '卖出', className: 'is-income', dataAttr: 'data-trade-side' }
      ])}
      <div class="modal-grid-2">
        <label class="modal-field"><span>股数</span><input id="modalTradeSharesInput" class="modal-input" type="number" inputmode="decimal" value="${escapeHtml(entry ? String(safeNumber(entry.shares, 0)) : '')}" placeholder="0"></label>
        <label class="modal-field"><span>成交价</span><input id="modalTradePriceInput" class="modal-input" type="number" inputmode="decimal" value="${escapeHtml(entry ? String(safeNumber(entry.price, 0)) : '')}" placeholder="0.00"></label>
      </div>
      <div class="modal-grid-2">
        <label class="modal-field"><span>币种</span><select id="modalTradeCurrencyInput" class="modal-select"><option value="CNY"${currency === 'CNY' ? ' selected' : ''}>CNY</option><option value="HKD"${currency === 'HKD' ? ' selected' : ''}>HKD</option><option value="USD"${currency === 'USD' ? ' selected' : ''}>USD</option></select></label>
        <label class="modal-field"><span>汇率</span><input id="modalTradeFxInput" class="modal-input" type="number" inputmode="decimal" value="${escapeHtml(String(safeNumber(fxRate, 1)))}" placeholder="1"></label>
      </div>
      <label class="modal-field"><span>费用（CNY）</span><input id="modalTradeFeeInput" class="modal-input" type="number" inputmode="decimal" value="${escapeHtml(entry ? String(safeNumber(entry.feeCny, 0)) : '')}" placeholder="0.00"></label>
      ${renderSegmentGroup('modalBucketInput', entry && entry.bucket === 'income' ? 'income' : 'core', [
        { value: 'core', label: LABELS.core, className: 'is-core', dataAttr: 'data-bucket-option' },
        { value: 'income', label: LABELS.income, className: 'is-income', dataAttr: 'data-bucket-option' }
      ])}
      <label class="modal-field"><span>备注</span><input id="modalTradeNoteInput" class="modal-input" type="text" value="${escapeHtml(entry && entry.note || '')}" placeholder="可选"></label>`;
  } else if (state.modal === 'yearlyManual') {
    title = '历史回填';
    note = '补齐开始记录之前的年度收益口径';
    fields = `<input id="modalManualYearInput" class="modal-input" type="number" inputmode="numeric" value="${escapeHtml(getManualModalValue('year') || String(getDefaultManualYear()))}" placeholder="年份">
      <input id="modalManualDividendInput" class="modal-input" type="number" inputmode="decimal" value="${escapeHtml(getManualModalValue('dividendCny'))}" placeholder="手动股息收入（CNY）">
      <input id="modalManualYearEndInput" class="modal-input" type="number" inputmode="decimal" value="${escapeHtml(getManualModalValue('yearEndNetCny'))}" placeholder="年末净值（CNY）">
      <input id="modalManualNetInflowInput" class="modal-input" type="number" inputmode="decimal" value="${escapeHtml(getManualModalValue('netInflowCny'))}" placeholder="当年净注入（CNY，可为负）">`;
  } else if (state.modal === 'add') {
    title = LABELS.addTitle; note = LABELS.addNote;
    fields = `<input id="modalSymbolInput" class="modal-input" type="text" placeholder="${LABELS.symbolPlaceholder}">
      <input id="modalQuantityInput" class="modal-input" type="number" inputmode="decimal" placeholder="${LABELS.quantityPlaceholder}">
      <div class="modal-bucket-group" role="group" aria-label="${LABELS.core} / ${LABELS.income}">
        <button class="modal-bucket-button is-core is-active" type="button" data-bucket-option="core" aria-pressed="true">${LABELS.core}</button>
        <button class="modal-bucket-button is-income" type="button" data-bucket-option="income" aria-pressed="false">${LABELS.income}</button>
      </div><input id="modalBucketInput" type="hidden" value="core">`;
  }
  refs.modalRoot.innerHTML = `<div class="modal-mask" data-modal-action="close"></div>
    <section class="modal-sheet" role="dialog" aria-modal="true"><h3 class="modal-title">${title}</h3>
    ${note ? `<p class="modal-note">${escapeHtml(note)}</p>` : ''}${fields}
    <div class="modal-actions">
    ${state.modal === 'yearlyManual' && state.modalPayload.existing ? '<button class="modal-button modal-button--danger" type="button" data-modal-action="delete-yearly-manual">删除</button>' : ''}
    ${state.modal === 'cashFlow' && state.modalPayload && state.modalPayload.id ? '<button class="modal-button modal-button--danger" type="button" data-modal-action="delete-record">删除</button>' : ''}
    ${state.modal === 'trade' && state.modalPayload && state.modalPayload.id ? '<button class="modal-button modal-button--danger" type="button" data-modal-action="delete-record">删除</button>' : ''}
    <button class="modal-button modal-button--secondary" type="button" data-modal-action="cancel">${LABELS.cancel}</button>
    <button class="modal-button modal-button--primary" type="button" data-modal-action="save">${LABELS.save}</button></div></section>`;
}

function renderMonthDetailModal() {
  const month = Math.floor(safeNumber(state.modalPayload && state.modalPayload.month, 0));
  const detail = buildDividendMonthDetail(month);
  refs.modalRoot.innerHTML = `<div class="modal-mask" data-modal-action="close"></div>
    <section class="modal-sheet modal-sheet--detail is-${escapeHtml(detail.phase)}" role="dialog" aria-modal="true">
      <header class="month-detail-head">
        <div class="month-detail-title">
          <h3>${escapeHtml(detail.title)}</h3>
          <strong>${escapeHtml(detail.total)}</strong>
        </div>
        ${detail.summary ? `<p class="month-detail-summary">${escapeHtml(detail.summary)}</p>` : ''}
        ${detail.hasConfirmable ? `<p class="month-detail-hint">${escapeHtml(LABELS.dividendConfirmHint)}</p>` : ''}
      </header>
      <div class="month-detail-list">${detail.body}</div>
      <div class="modal-actions">
        <button class="modal-button modal-button--primary" type="button" data-modal-action="cancel">${LABELS.cancel === '取消' ? '关闭' : LABELS.cancel}</button>
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
  state.dividendLedger[index] = {
    ...entry,
    confirmed: confirming,
    receiptStatus: confirming ? 'received' : (entry.receiptStatus || 'pending'),
    confidence: confirming ? 'confirmed' : (entry.confidence === 'confirmed' ? 'snapshot' : entry.confidence),
    updatedAt: new Date().toISOString()
  };
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
  const netCny = safeNumber(document.getElementById('modalDividendNetInput').value, 0);
  if (!payDate) { showToast('请输入有效到账日', { type: 'error' }); return false; }
  if (netCny <= 0) { showToast('请输入有效实收金额', { type: 'error' }); return false; }
  const confirmed = document.getElementById('modalDividendConfirmedInput').checked === true;
  state.dividendLedger[index] = {
    ...entry,
    payDate,
    netCny,
    receiptStatus: confirmed ? 'received' : 'pending',
    confidence: confirmed ? 'confirmed' : 'manual',
    confirmed,
    note: document.getElementById('modalDividendNoteInput').value.trim(),
    updatedAt: new Date().toISOString()
  };
  return true;
}

function saveCashFlowEdit() {
  const previousId = state.modalPayload && state.modalPayload.id;
  const entry = sanitizeCashFlowEntry({
    id: previousId || createRecordId('cf'),
    date: document.getElementById('modalCashFlowDateInput').value,
    amountCny: safeNumber(document.getElementById('modalCashFlowAmountInput').value, 0),
    type: document.getElementById('modalCashFlowTypeInput').value,
    note: document.getElementById('modalCashFlowNoteInput').value.trim()
  });
  if (!entry || entry.amountCny <= 0) { showToast('请输入有效出入金', { type: 'error' }); return false; }
  state.cashFlows = state.cashFlows
    .filter((item) => item.id !== previousId && item.id !== entry.id)
    .concat(entry)
    .sort((a, b) => `${b.date}|${b.id}`.localeCompare(`${a.date}|${a.id}`));
  return true;
}

function saveTradeEdit() {
  const previousId = state.modalPayload && state.modalPayload.id;
  const entry = sanitizeTradeEntry({
    id: previousId || createRecordId('tr'),
    date: document.getElementById('modalTradeDateInput').value,
    symbol: document.getElementById('modalTradeSymbolInput').value,
    side: document.getElementById('modalTradeSideInput').value,
    shares: safeNumber(document.getElementById('modalTradeSharesInput').value, 0),
    price: safeNumber(document.getElementById('modalTradePriceInput').value, 0),
    currency: document.getElementById('modalTradeCurrencyInput').value,
    fxRate: safeNumber(document.getElementById('modalTradeFxInput').value, 1),
    feeCny: safeNumber(document.getElementById('modalTradeFeeInput').value, 0),
    bucket: document.getElementById('modalBucketInput').value,
    note: document.getElementById('modalTradeNoteInput').value.trim()
  });
  if (!entry) { showToast('请输入有效交易', { type: 'error' }); return false; }
  state.trades = state.trades
    .filter((item) => item.id !== previousId && item.id !== entry.id)
    .concat(entry)
    .sort((a, b) => `${b.date}|${b.id}`.localeCompare(`${a.date}|${a.id}`));
  state.quotes = mergeQuotes(state.quotes, { [entry.symbol]: inferQuote(entry.symbol) });
  return true;
}

export function handleModalSave() {
  if (state.modal === 'monthDetail') { closeModal(); return; }
  if (state.modal === 'quantity') {
    const v = Math.max(0, safeNumber(document.getElementById('modalQuantityInput').value, 0));
    state.holdings = state.holdings.map((i) => i.localId === state.modalPayload.localId ? { ...i, quantity: v } : i);
  } else if (state.modal === 'tax') {
    const v = document.getElementById('modalTaxInput').value.trim();
    state.holdings = state.holdings.map((i) => i.localId === state.modalPayload.localId ? { ...i, taxRateOverride: v } : i);
  } else if (state.modal === 'dividend') {
    const v = sanitizePerShareOverrideInput(document.getElementById('modalDividendInput').value.trim());
    state.holdings = state.holdings.map((i) => i.localId === state.modalPayload.localId ? { ...i, dividendPerShareTtmOverride: v, dividendPerShareTtmOverrideTouched: v !== '' } : i);
  } else if (state.modal === 'liability') {
    state.liabilityCny = Math.max(0, safeNumber(document.getElementById('modalLiabilityInput').value, 0));
  } else if (state.modal === 'dividendLedger') {
    if (!saveDividendLedgerEdit()) return;
  } else if (state.modal === 'cashFlow') {
    if (!saveCashFlowEdit()) return;
  } else if (state.modal === 'trade') {
    if (!saveTradeEdit()) return;
  } else if (state.modal === 'yearlyManual') {
    const year = Math.floor(safeNumber(document.getElementById('modalManualYearInput').value, 0));
    if (year < 1900 || year > 2200) { showToast('请输入有效年份', { type: 'error' }); return; }
    const previousYear = Math.floor(safeNumber(state.modalPayload && state.modalPayload.year, 0));
    const entry = {
      year,
      dividendCny: Math.max(0, safeNumber(document.getElementById('modalManualDividendInput').value, 0)),
      yearEndNetCny: Math.max(0, safeNumber(document.getElementById('modalManualYearEndInput').value, 0)),
      netInflowCny: safeNumber(document.getElementById('modalManualNetInflowInput').value, 0)
    };
    state.yearlyManual = state.yearlyManual
      .filter((item) => item.year !== year && item.year !== previousYear)
      .concat(entry)
      .sort((a, b) => b.year - a.year);
  } else if (state.modal === 'add') {
    const symbol = normalizeSymbol(document.getElementById('modalSymbolInput').value);
    const quantity = Math.max(0, safeNumber(document.getElementById('modalQuantityInput').value, 0));
    const bucket = document.getElementById('modalBucketInput').value === 'income' ? 'income' : 'core';
    if (!symbol) { showToast(LABELS.missingSymbol, { type: 'error' }); return; }
    if (state.holdings.some((i) => normalizeSymbol(i.symbol) === symbol)) { showToast(`${symbol} ${LABELS.duplicateHolding}`, { type: 'error' }); return; }
    state.holdings = state.holdings.concat({ localId: state.nextId, symbol, quantity, bucket, taxRateOverride: '', dividendPerShareTtmOverride: '', dividendPerShareTtmOverrideTouched: false });
    state.quotes = mergeQuotes(state.quotes, { [symbol]: inferQuote(symbol) });
    state.nextId += 1;
  }
  saveState(); closeModal(); renderSavedStateQuietly({ animateHoldingReflow: true });
}

export function handleModalDelete() {
  if (state.modal === 'cashFlow') {
    const id = state.modalPayload && state.modalPayload.id;
    if (!id) return;
    state.cashFlows = state.cashFlows.filter((item) => item.id !== id);
    saveState(); closeModal(); renderSavedStateQuietly({ animateHoldingReflow: false });
    return;
  }
  if (state.modal === 'trade') {
    const id = state.modalPayload && state.modalPayload.id;
    if (!id) return;
    state.trades = state.trades.filter((item) => item.id !== id);
    saveState(); closeModal(); renderSavedStateQuietly({ animateHoldingReflow: false });
    return;
  }
  if (state.modal !== 'yearlyManual') return;
  const year = Math.floor(safeNumber(state.modalPayload && state.modalPayload.year, 0));
  if (!year) return;
  state.yearlyManual = state.yearlyManual.filter((item) => item.year !== year);
  saveState(); closeModal(); renderSavedStateQuietly({ animateHoldingReflow: false });
}
