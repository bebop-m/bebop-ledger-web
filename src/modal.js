import { state, refs, saveState, showToast } from './state.js';
import { safeNumber, escapeHtml, normalizeSymbol, sanitizePerShareOverrideInput, mergeQuotes } from './utils.js';
import { LABELS } from './constants.js';
import { renderSavedStateQuietly } from './render.js';
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

function getDefaultManualYear() {
  return new Date().getFullYear() - 1;
}

function getManualModalValue(key) {
  const value = state.modalPayload && state.modalPayload[key];
  return value === null || value === undefined ? '' : String(value);
}

function renderModal() {
  if (!state.modal) { refs.modalRoot.innerHTML = ''; return; }
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
    <button class="modal-button modal-button--secondary" type="button" data-modal-action="cancel">${LABELS.cancel}</button>
    <button class="modal-button modal-button--primary" type="button" data-modal-action="save">${LABELS.save}</button></div></section>`;
}

export function handleModalSave() {
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
  if (state.modal !== 'yearlyManual') return;
  const year = Math.floor(safeNumber(state.modalPayload && state.modalPayload.year, 0));
  if (!year) return;
  state.yearlyManual = state.yearlyManual.filter((item) => item.year !== year);
  saveState(); closeModal(); renderSavedStateQuietly({ animateHoldingReflow: false });
}
