'use strict';

/**
 * SettlementView
 *
 * Spreadsheet-like settlement editor embedded in the dashboard.
 * Reached via #settlement or navigated to programmatically from
 * the Bill History or Tables view with a session_id query param.
 *
 * URL pattern (hash): #settlement?session_id=<uuid>
 * or:                 #settlement?id=<settlement_uuid>
 *
 * Lifecycle:
 *   init(el) — called by app.js router
 *   _load()  — fetch or create settlement
 *   _render() — full re-render from _state
 *   line ops mutate state then call _renderLines() + _renderTotals()
 *   finalize / void / payment open modal overlays
 */

const SettlementView = (() => {

  // ── State ──────────────────────────────────────────────────────────────────
  let _el         = null;
  let _settlement = null;   // settlement header object
  let _lines      = [];     // active lines (sorted)
  let _payments   = [];     // recorded payments
  let _sessionId  = null;
  let _settlementId = null;
  let _undoStack  = [];     // local undo within draft (line snapshots before edit)

  // ── Formatters ─────────────────────────────────────────────────────────────
  const _fmt     = n => '₹ ' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const _fmtP    = p => _fmt(p / 100);
  const _fmtDate = iso => iso ? new Date(iso).toLocaleString('en-IN', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }) : '—';

  const LINE_LABELS = {
    ORDER_ITEM:         'Order item',
    MANUAL_ITEM:        'Manual item',
    PRICE_OVERRIDE:     'Price override',
    DISCOUNT:           'Discount',
    COMPLIMENTARY_ITEM: 'Complimentary',
    SERVICE_CHARGE:     'Service charge',
    DELIVERY_CHARGE:    'Delivery charge',
    PACKAGING:          'Packaging',
    TAX:                'Tax',
    ROUND_OFF:          'Round off',
    TIP:                'Tip',
    ADJUSTMENT:         'Adjustment',
  };

  const STATUS_BADGE = {
    draft:     '<span class="badge" style="background:var(--gray-100);color:var(--gray-600)">Draft</span>',
    open:      '<span class="badge badge-placed">Open</span>',
    finalized: '<span class="badge badge-confirmed">Finalized</span>',
    voided:    '<span class="badge" style="background:var(--red-50);color:var(--red-600)">Voided</span>',
  };

  const METHOD_LABELS = { cash:'Cash', card:'Card', upi:'UPI', wallet:'Wallet', advance:'Advance', other:'Other' };

  // ── Capability helpers ─────────────────────────────────────────────────────
  // Mirror the backend ROLE_CAPS so the UI shows/hides controls correctly.
  // The backend is still the authority — these guards are UX only.
  const ROLE_CAPS = {
    owner:    new Set(['ADD','REMOVE','PRICE','DISCOUNT','COMP','VOID','FINALIZE','PAYMENT','INVOICE']),
    manager:  new Set(['ADD','REMOVE','PRICE','DISCOUNT','COMP','FINALIZE','PAYMENT','INVOICE']),
    cashier:  new Set(['ADD','DISCOUNT','FINALIZE','PAYMENT','INVOICE']),
    host:     new Set(['ADD','REMOVE']),
    kitchen:  new Set([]),
    catering: new Set([]),
  };

  function _can(cap) {
    const roles = Auth.state()?.staff?.roles || [];
    return roles.some(r => ROLE_CAPS[r]?.has(cap));
  }

  const isEditable = () => _settlement && ['draft','open'].includes(_settlement.status);

  // ── API helpers ────────────────────────────────────────────────────────────
  const _sid = () => _settlementId;

  async function _apiPost(path, body = {}) {
    return Api.rPost(`/settlements/${_sid()}${path}`, body);
  }
  async function _apiPatch(path, body = {}) {
    return Api.rPatch(`/settlements/${_sid()}${path}`, body);
  }
  async function _apiDel(path, queryParams = {}) {
    const p = new URLSearchParams(queryParams);
    const qs = [...p].length ? `?${p}` : '';
    return Api.rDel(`/settlements/${_sid()}${path}${qs}`);
  }

  // ── Load settlement ────────────────────────────────────────────────────────
  async function _load() {
    _showLoading();
    try {
      let data;
      if (_sessionId) {
        // Try to fetch existing, or create from session
        try {
          data = await Api.rGet(`/settlements/by-session/${_sessionId}`);
        } catch {
          data = await Api.rPost('/settlements/from-session', { session_id: _sessionId });
        }
      } else if (_settlementId) {
        data = await Api.rGet(`/settlements/${_settlementId}`);
      } else {
        _showError('No session or settlement specified.');
        return;
      }

      _settlement   = data.settlement;
      _settlementId = _settlement.id;
      _lines        = data.lines    || [];
      _payments     = data.payments || [];
      _undoStack    = [];
      _render();
    } catch (err) {
      _showError(err.message);
    }
  }

  // ── Skeleton / error helpers ───────────────────────────────────────────────
  function _showLoading() {
    if (!_el) return;
    _el.innerHTML = `<div style="padding:var(--sp-8);text-align:center;color:var(--gray-400)">Loading settlement…</div>`;
  }
  function _showError(msg) {
    if (!_el) return;
    _el.innerHTML = DashUI.errorState(msg);
  }

  // ── Full render ────────────────────────────────────────────────────────────
  function _render() {
    if (!_el || !_settlement) return;
    const s   = _settlement;
    const editable = isEditable();

    _el.innerHTML = `
      <div class="toolbar">
        <div class="toolbar-left" style="gap:var(--sp-3);flex-wrap:wrap">
          <span style="font-weight:700;font-size:15px">Settlement</span>
          ${STATUS_BADGE[s.status] || ''}
          <span class="text-sm text-muted">${_fmtDate(s.created_at)}</span>
        </div>
        <div class="toolbar-right" style="gap:var(--sp-2)">
          ${editable && _can('FINALIZE') ? `<button id="stl-finalize-btn" class="btn btn-primary btn-sm">Finalize &amp; Close</button>` : ''}
          ${s.status === 'finalized' && _can('INVOICE') ? `<button id="stl-invoice-btn" class="btn btn-secondary btn-sm">Generate Invoice</button>` : ''}
          ${editable && _can('VOID') ? `<button id="stl-void-btn" class="btn btn-secondary btn-sm" style="color:var(--red-600)">Void</button>` : ''}
          <button id="stl-history-btn" class="btn btn-secondary btn-sm">History</button>
        </div>
      </div>

      ${s.status === 'voided' ? `<div class="callout callout--error" style="margin-bottom:var(--sp-4)">
        <strong>Voided</strong>${s.void_reason ? ` — ${s.void_reason}` : ''}
      </div>` : ''}

      <div id="stl-body" style="display:grid;grid-template-columns:minmax(0,1fr) clamp(240px,320px,100%);gap:var(--sp-5);align-items:start;flex-wrap:wrap" class="stl-body-grid">

        <!-- Lines panel -->
        <div>
          <div class="card">
            <div class="card-header" style="display:flex;align-items:center;justify-content:space-between">
              <span class="card-title">Bill items</span>
              ${editable && _can('ADD') ? `
                <div style="display:flex;gap:var(--sp-2)">
                  <button id="stl-add-item-btn"     class="btn btn-secondary btn-sm">+ Item</button>
                  <button id="stl-add-discount-btn" class="btn btn-secondary btn-sm">+ Discount</button>
                  <button id="stl-add-charge-btn"   class="btn btn-secondary btn-sm">+ Charge</button>
                </div>` : ''}
            </div>
            <div id="stl-lines-wrap" class="table-wrap">
              ${_renderLinesHtml()}
            </div>
          </div>

          ${editable ? `
          <div class="card" style="margin-top:var(--sp-4)">
            <div class="card-header"><span class="card-title">Notes</span></div>
            <div class="card-body">
              <textarea id="stl-notes" class="input" rows="2" placeholder="Internal notes…" style="width:100%;resize:vertical">${s.notes || ''}</textarea>
              <button id="stl-save-notes" class="btn btn-secondary btn-sm" style="margin-top:var(--sp-2)">Save notes</button>
            </div>
          </div>` : (s.notes ? `
          <div class="card" style="margin-top:var(--sp-4)">
            <div class="card-header"><span class="card-title">Notes</span></div>
            <div class="card-body"><p class="text-sm">${s.notes}</p></div>
          </div>` : '')}
        </div>

        <!-- Totals + Payments panel -->
        <div>
          <div class="card">
            <div class="card-header"><span class="card-title">Totals</span></div>
            <div class="card-body" id="stl-totals-wrap">
              ${_renderTotalsHtml()}
            </div>
          </div>

          <div class="card" style="margin-top:var(--sp-4)">
            <div class="card-header" style="display:flex;align-items:center;justify-content:space-between">
              <span class="card-title">Payments</span>
              <div style="display:flex;gap:var(--sp-2)">
                ${_can('PAYMENT') && s.status !== 'voided' ? `<button id="stl-add-payment-btn" class="btn btn-secondary btn-sm">+ Payment</button>` : ''}
                ${_can('PAYMENT') && s.status === 'finalized' ? `<button id="stl-add-refund-btn" class="btn btn-secondary btn-sm" style="color:var(--red-600)">Refund</button>` : ''}
              </div>
            </div>
            <div id="stl-payments-wrap">
              ${_renderPaymentsHtml()}
            </div>
          </div>
        </div>

      </div>

      <!-- Modals -->
      <div id="stl-modal-root"></div>`;

    _bindEvents();
  }

  function _renderLinesHtml() {
    if (!_lines.length) {
      return `<div style="padding:var(--sp-6);text-align:center;color:var(--gray-400)">No lines yet.</div>`;
    }
    const editable = isEditable();
    const rows = _lines.map(l => {
      const isComp    = l.is_comp;
      const isTax     = l.line_type === 'TAX';
      const isDisc    = l.line_type === 'DISCOUNT';
      const amtStyle  = isDisc ? 'color:var(--green-600)' : isComp ? 'color:var(--gray-400);text-decoration:line-through' : '';
      const prefix    = isDisc ? '−' : '';
      const typeLabel = LINE_LABELS[l.line_type] || l.line_type;
      const unitCell  = l.unit_price_paise != null
        ? `<span class="text-sm text-muted">${_fmtP(l.unit_price_paise)} × ${Number(l.quantity).toFixed(l.quantity % 1 ? 2 : 0)}</span>`
        : (l.percent ? `<span class="text-sm text-muted">${(l.percent * 100).toFixed(1)}%</span>` : '');

      return `<tr data-line-id="${l.id}">
        <td>
          <div style="font-weight:500">${l.description}</div>
          <div class="text-sm text-muted">${typeLabel}${isComp ? ' · <em>Comp</em>' : ''}</div>
        </td>
        <td class="text-right">${unitCell}</td>
        <td class="text-right" style="${amtStyle};font-weight:600;white-space:nowrap">
          ${prefix}${_fmtP(l.amount_paise)}
        </td>
        <td style="width:64px;text-align:right">
          ${editable && !isTax ? `
            <div style="display:flex;gap:4px;justify-content:flex-end">
              ${_can('PRICE') || l.line_type === 'DISCOUNT' || l.line_type === 'COMPLIMENTARY_ITEM' ? `
                <button class="stl-edit-line-btn icon-btn" data-line-id="${l.id}" title="Edit">✏</button>` : ''}
              ${_can('REMOVE') ? `
                <button class="stl-del-line-btn icon-btn" data-line-id="${l.id}" title="Remove" style="color:var(--red-500)">✕</button>` : ''}
            </div>` : ''}
        </td>
      </tr>`;
    }).join('');

    return `<table>
      <thead><tr><th>Description</th><th class="text-right">Unit / %</th><th class="text-right">Amount</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  function _renderTotalsHtml() {
    const s = _settlement;
    const bal = Math.max(0, s.total_paise - s.paid_paise);
    return `
      <div style="display:flex;flex-direction:column;gap:var(--sp-2)">
        ${_totRow('Subtotal', s.subtotal_paise)}
        ${s.discount_paise ? _totRow('Discount', -s.discount_paise, 'var(--green-600)') : ''}
        ${s.tax_paise      ? _totRow('Tax',      s.tax_paise) : ''}
        ${s.tip_paise      ? _totRow('Tip',      s.tip_paise) : ''}
        ${s.round_off_paise ? _totRow('Round off', s.round_off_paise) : ''}
        <div style="border-top:2px solid var(--gray-200);margin:var(--sp-1) 0;padding-top:var(--sp-2);display:flex;justify-content:space-between;font-weight:700;font-size:16px">
          <span>Total</span><span>${_fmtP(s.total_paise)}</span>
        </div>
        ${s.paid_paise ? _totRow('Paid', -s.paid_paise, 'var(--green-600)') : ''}
        ${bal > 0 ? `<div style="display:flex;justify-content:space-between;font-weight:700;color:var(--red-600)">
          <span>Balance due</span><span>${_fmtP(bal)}</span>
        </div>` : (s.paid_paise >= s.total_paise && s.total_paise > 0 ? `<div style="color:var(--green-600);font-weight:600;text-align:center;padding:var(--sp-2)">✓ Fully paid</div>` : '')}
      </div>`;
  }

  function _totRow(label, paise, color = null) {
    const style = color ? `color:${color}` : '';
    return `<div style="display:flex;justify-content:space-between;font-size:13px;${style}">
      <span>${label}</span><span>${paise < 0 ? '−' : ''}${_fmtP(Math.abs(paise))}</span>
    </div>`;
  }

  function _renderPaymentsHtml() {
    if (!_payments.length) {
      return `<div style="padding:var(--sp-4);text-align:center;color:var(--gray-400);font-size:13px">No payments recorded.</div>`;
    }
    return `<div style="padding:var(--sp-2) var(--sp-4);display:flex;flex-direction:column;gap:var(--sp-2)">
      ${_payments.map(p => {
        const isVoided = !!p.voided_at;
        const isRefund = p.kind === 'refund';
        const rowStyle = isVoided ? 'opacity:0.5;text-decoration:line-through' : '';
        const amountColor = isVoided ? 'var(--gray-400)' : (isRefund ? 'var(--red-600)' : 'var(--green-600)');
        const canCorrect = !isVoided && _can('PAYMENT');
        return `
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;${rowStyle}">
          <div>
            <span style="font-weight:600">${isRefund ? 'Refund — ' : ''}${METHOD_LABELS[p.method] || p.method}</span>
            ${p.reference ? `<span class="text-sm text-muted" style="margin-left:4px">${p.reference}</span>` : ''}
            ${p.reason ? `<div class="text-sm text-muted">${p.reason}</div>` : ''}
            ${isVoided ? `<div class="text-sm text-muted">Corrected: ${p.void_reason || ''}</div>` : ''}
          </div>
          <div style="display:flex;align-items:center;gap:var(--sp-2)">
            <span style="font-weight:600;color:${amountColor}">${isRefund ? '−' : ''}${_fmt(p.amount)}</span>
            ${canCorrect ? `<button class="btn-link stl-correct-payment-btn" data-payment-id="${p.id}" style="font-size:12px">Correct a mistake</button>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }

  // ── Event binding ──────────────────────────────────────────────────────────
  function _bindEvents() {
    // Toolbar actions
    _el.querySelector('#stl-finalize-btn')?.addEventListener('click', _handleFinalize);
    _el.querySelector('#stl-void-btn')?.addEventListener('click', _handleVoid);
    _el.querySelector('#stl-invoice-btn')?.addEventListener('click', _handleInvoice);
    _el.querySelector('#stl-history-btn')?.addEventListener('click', _handleHistory);
    _el.querySelector('#stl-add-payment-btn')?.addEventListener('click', _handleAddPayment);
    _el.querySelector('#stl-add-refund-btn')?.addEventListener('click', _handleAddRefund);
    _bindPaymentEvents();

    // Line actions
    _el.querySelector('#stl-add-item-btn')?.addEventListener('click', () => _openLineModal('MANUAL_ITEM'));
    _el.querySelector('#stl-add-discount-btn')?.addEventListener('click', () => _openLineModal('DISCOUNT'));
    _el.querySelector('#stl-add-charge-btn')?.addEventListener('click', () => _openLineModal('SERVICE_CHARGE'));

    _el.querySelectorAll('.stl-edit-line-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const line = _lines.find(l => l.id === btn.dataset.lineId);
        if (line) _openLineModal(line.line_type, line);
      });
    });

    _el.querySelectorAll('.stl-del-line-btn').forEach(btn => {
      btn.addEventListener('click', () => _handleRemoveLine(btn.dataset.lineId));
    });

    // Notes save
    _el.querySelector('#stl-save-notes')?.addEventListener('click', async () => {
      const notes = _el.querySelector('#stl-notes')?.value || '';
      try {
        await Api.rPatch(`/settlements/${_sid()}`, { notes });
        _settlement.notes = notes;
        DashUI.toast('Notes saved.', 'success');
      } catch (err) { DashUI.toast(err.message, 'error'); }
    });
  }

  // ── Line modal ─────────────────────────────────────────────────────────────
  function _openLineModal(lineType, existingLine = null) {
    const isEdit   = !!existingLine;
    const isDisc   = lineType === 'DISCOUNT';
    const isCharge = ['SERVICE_CHARGE','DELIVERY_CHARGE','PACKAGING','ADJUSTMENT'].includes(lineType);
    const isComp   = lineType === 'COMPLIMENTARY_ITEM';
    const title    = isEdit ? `Edit ${LINE_LABELS[lineType]}` : `Add ${LINE_LABELS[lineType]}`;

    const modal = _modal(`
      <div class="modal-header"><h3>${title}</h3></div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:var(--sp-3)">
        <label>
          <span class="label">Description</span>
          <input id="ml-desc" class="input" value="${existingLine?.description || ''}" placeholder="e.g. Dal Makhani" />
        </label>
        ${!isCharge && !isDisc ? `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-3)">
          <label>
            <span class="label">Quantity</span>
            <input id="ml-qty" type="number" class="input" min="0.001" step="0.001" value="${existingLine?.quantity ?? 1}" />
          </label>
          <label>
            <span class="label">Unit price (₹)</span>
            <input id="ml-price" type="number" class="input" min="0" step="0.01"
              value="${existingLine?.unit_price_paise != null ? existingLine.unit_price_paise / 100 : ''}"
              placeholder="0.00" />
          </label>
        </div>` : ''}
        ${isDisc || isCharge ? `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-3)">
          <label>
            <span class="label">Amount (₹)</span>
            <input id="ml-amount" type="number" class="input" min="0" step="0.01"
              value="${existingLine ? Math.abs(existingLine.amount_paise) / 100 : ''}"
              placeholder="0.00" />
          </label>
          <label>
            <span class="label">Or percent (%)</span>
            <input id="ml-pct" type="number" class="input" min="0" max="100" step="0.1"
              value="${existingLine?.percent ? (existingLine.percent * 100).toFixed(1) : ''}"
              placeholder="optional" />
          </label>
        </div>` : ''}
        ${isComp ? `
        <label>
          <span class="label">Reason for comp</span>
          <input id="ml-comp-reason" class="input" value="${existingLine?.comp_reason || ''}" placeholder="VIP guest, error, etc." />
        </label>` : ''}
        <label>
          <span class="label">Reason for change (optional)</span>
          <input id="ml-reason" class="input" placeholder="Manager approval, etc." />
        </label>
      </div>
      <div class="modal-footer">
        <button id="ml-cancel" class="btn btn-secondary">Cancel</button>
        <button id="ml-save" class="btn btn-primary">${isEdit ? 'Save changes' : 'Add line'}</button>
      </div>`);

    modal.querySelector('#ml-cancel').addEventListener('click', () => modal.remove());

    // Auto-compute amount when qty/price changes (for item lines)
    const qtyEl   = modal.querySelector('#ml-qty');
    const priceEl = modal.querySelector('#ml-price');
    if (qtyEl && priceEl) {
      const _sync = () => {};  // amount is derived on submit
      qtyEl.addEventListener('input', _sync);
      priceEl.addEventListener('input', _sync);
    }

    // Percent → amount auto-fill for discounts/charges
    const pctEl    = modal.querySelector('#ml-pct');
    const amtEl    = modal.querySelector('#ml-amount');
    if (pctEl && amtEl) {
      pctEl.addEventListener('input', () => {
        const pct = parseFloat(pctEl.value);
        if (!isNaN(pct) && pct > 0 && _settlement) {
          const subtotalPaise = _settlement.subtotal_paise || 0;
          amtEl.value = (subtotalPaise * pct / 100 / 100).toFixed(2);
        }
      });
    }

    modal.querySelector('#ml-save').addEventListener('click', async () => {
      const btn   = modal.querySelector('#ml-save');
      btn.disabled = true; btn.textContent = 'Saving…';

      try {
        const desc = modal.querySelector('#ml-desc')?.value?.trim();
        if (!desc) throw new Error('Description is required.');

        let amount_paise, unit_price_paise, quantity, percent;

        if (!isCharge && !isDisc) {
          quantity        = parseFloat(modal.querySelector('#ml-qty')?.value) || 1;
          const priceRup  = parseFloat(modal.querySelector('#ml-price')?.value);
          if (isNaN(priceRup)) throw new Error('Price is required.');
          unit_price_paise = Math.round(priceRup * 100);
          amount_paise     = Math.round(unit_price_paise * quantity);
        } else {
          const amtRup = parseFloat(amtEl?.value);
          const pctVal = parseFloat(pctEl?.value);
          if (!isNaN(pctVal) && pctVal > 0) {
            percent      = pctVal / 100;
            const subtot = _settlement?.subtotal_paise || 0;
            amount_paise = Math.round(subtot * percent);
          } else if (!isNaN(amtRup) && amtRup >= 0) {
            amount_paise = Math.round(amtRup * 100);
          } else {
            throw new Error('Provide either an amount or a percentage.');
          }
          if (isDisc) amount_paise = -Math.abs(amount_paise);
          quantity = 1;
        }

        const payload = {
          line_type: lineType, description: desc,
          quantity:  quantity || 1,
          amount_paise,
          reason: modal.querySelector('#ml-reason')?.value?.trim() || undefined,
        };
        if (unit_price_paise !== undefined) payload.unit_price_paise = unit_price_paise;
        if (percent !== undefined)          payload.percent = percent;
        if (isComp) {
          payload.is_comp     = true;
          payload.comp_reason = modal.querySelector('#ml-comp-reason')?.value?.trim() || undefined;
        }

        let data;
        if (isEdit) {
          data = await _apiPatch(`/lines/${existingLine.id}`, payload);
          const idx = _lines.findIndex(l => l.id === existingLine.id);
          if (idx !== -1) _lines[idx] = data.line;
        } else {
          data = await _apiPost('/lines', payload);
          _lines.push(data.line);
        }

        _updateTotalsFromResponse(data.totals);
        _rerenderLines();
        modal.remove();
        DashUI.toast(isEdit ? 'Line updated.' : 'Line added.', 'success');
      } catch (err) {
        btn.disabled = false; btn.textContent = isEdit ? 'Save changes' : 'Add line';
        DashUI.toast(err.message, 'error');
      }
    });
  }

  // ── Remove line ────────────────────────────────────────────────────────────
  async function _handleRemoveLine(lineId) {
    const line   = _lines.find(l => l.id === lineId);
    const label  = line?.description || 'this line';
    const reason = await _promptReason(`Remove "${label}"?`, 'Reason (optional)');
    if (reason === null) return; // cancelled

    try {
      const data = await _apiDel(`/lines/${lineId}`, reason ? { reason } : {});
      _lines = _lines.filter(l => l.id !== lineId);
      _updateTotalsFromResponse(data.totals);
      _rerenderLines();
      DashUI.toast('Line removed.', 'success');
    } catch (err) { DashUI.toast(err.message, 'error'); }
  }

  // ── Finalize ───────────────────────────────────────────────────────────────
  async function _handleFinalize() {
    const confirmed = await DashUI.confirm(
      'The bill will be locked. You can still record payments and generate an invoice.',
      { title: 'Finalize settlement?', confirmLabel: 'Finalize' }
    );
    if (!confirmed) return;

    try {
      // Omit gst_snapshot entirely when there isn't one (manual/catering settlements) —
      // the backend schema treats it as optional but rejects an explicit null.
      const body = _settlement.gst_snapshot ? { gst_snapshot: _settlement.gst_snapshot } : {};
      const data = await _apiPost('/finalize', body);
      _settlement = data.settlement;
      _render();
      DashUI.toast('Settlement finalized.', 'success');
    } catch (err) { DashUI.toast(err.message, 'error'); }
  }

  // ── Void ──────────────────────────────────────────────────────────────────
  async function _handleVoid() {
    const reason = await _promptReason('Void this settlement?', 'Reason (required)', true);
    if (!reason) return;
    try {
      const data = await _apiPost('/void', { void_reason: reason });
      _settlement = data.settlement;
      _render();
      DashUI.toast('Settlement voided.', 'success');
    } catch (err) { DashUI.toast(err.message, 'error'); }
  }

  // ── Invoice ────────────────────────────────────────────────────────────────
  async function _handleInvoice() {
    const btn = _el.querySelector('#stl-invoice-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
    try {
      const data = await _apiPost('/invoice');
      DashUI.toast(`Invoice ${data.invoice.invoice_number} generated.`, 'success');
      _openInvoicePreview(data.invoice);
    } catch (err) {
      DashUI.toast(err.message, 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Generate Invoice'; }
    }
  }

  // ── Invoice preview modal ──────────────────────────────────────────────────
  function _openInvoicePreview(invoice) {
    const snap  = invoice.snapshot;
    const lines = snap.lines || [];
    const gst   = snap.gst_snapshot;

    const itemLines = lines.filter(l => ['ORDER_ITEM','MANUAL_ITEM','COMPLIMENTARY_ITEM','PRICE_OVERRIDE'].includes(l.line_type));
    const taxLines  = lines.filter(l => l.line_type === 'TAX');
    const otherLines= lines.filter(l => !['ORDER_ITEM','MANUAL_ITEM','COMPLIMENTARY_ITEM','PRICE_OVERRIDE','TAX'].includes(l.line_type));

    const modal = _modal(`
      <div class="modal-header" style="display:flex;align-items:center;justify-content:space-between">
        <h3>Invoice ${invoice.invoice_number}</h3>
        <button id="inv-print-btn" class="btn btn-secondary btn-sm">Print / PDF</button>
      </div>
      <div class="modal-body" id="inv-print-area">
        <div style="text-align:center;margin-bottom:var(--sp-4)">
          <div style="font-weight:700;font-size:18px">${snap.restaurant_name || ''}</div>
          ${snap.gstin ? `<div class="text-sm text-muted">GSTIN: ${snap.gstin}</div>` : ''}
          <div class="text-sm text-muted">Invoice No: ${invoice.invoice_number} &bull; ${_fmtDate(invoice.generated_at)}</div>
        </div>

        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:var(--sp-4)">
          <thead>
            <tr style="border-bottom:2px solid var(--gray-200)">
              <th style="text-align:left;padding:4px 0">Item</th>
              <th style="text-align:right;padding:4px 0">Qty</th>
              <th style="text-align:right;padding:4px 0">Rate</th>
              <th style="text-align:right;padding:4px 0">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${itemLines.map(l => `
              <tr style="border-bottom:1px solid var(--gray-100)">
                <td style="padding:4px 0">${l.description}${l.is_comp ? ' <em>(Comp)</em>' : ''}</td>
                <td style="text-align:right;padding:4px 0">${Number(l.quantity).toFixed(l.quantity % 1 ? 2 : 0)}</td>
                <td style="text-align:right;padding:4px 0">${l.unit_price_paise != null ? _fmtP(l.unit_price_paise) : '—'}</td>
                <td style="text-align:right;padding:4px 0;${l.is_comp ? 'text-decoration:line-through;color:var(--gray-400)' : ''}">${_fmtP(l.amount_paise)}</td>
              </tr>`).join('')}
          </tbody>
        </table>

        <div style="margin-left:auto;width:240px;font-size:13px">
          ${_invRow('Subtotal', snap.subtotal_paise)}
          ${snap.discount_paise ? _invRow('Discount', -snap.discount_paise, 'var(--green-600)') : ''}
          ${otherLines.filter(l=>l.line_type!=='ROUND_OFF'&&l.line_type!=='TIP').map(l=>_invRow(l.description, l.amount_paise)).join('')}
          ${taxLines.map(l => _invRow(l.description, l.amount_paise)).join('')}
          ${snap.tip_paise ? _invRow('Tip', snap.tip_paise) : ''}
          ${snap.round_off_paise ? _invRow('Round off', snap.round_off_paise) : ''}
          <div style="border-top:2px solid var(--gray-800);padding-top:4px;display:flex;justify-content:space-between;font-weight:700;font-size:15px">
            <span>Total</span><span>${_fmtP(snap.total_paise)}</span>
          </div>
          ${(snap.payments||[]).map(p => _invRow(`Paid — ${METHOD_LABELS[p.method]||p.method}`, -p.amount_paise, 'var(--green-600)')).join('')}
          ${snap.total_paise > snap.paid_paise ? _invRow('Balance due', snap.total_paise - snap.paid_paise, 'var(--red-600)', true) : ''}
        </div>

        ${gst ? `<div class="text-sm text-muted" style="margin-top:var(--sp-4);text-align:center">
          This is a tax invoice. CGST: ${(gst.cgst_rate*100).toFixed(1)}% &bull; SGST: ${(gst.sgst_rate*100).toFixed(1)}%
        </div>` : ''}
      </div>
      <div class="modal-footer">
        <button id="inv-close-btn" class="btn btn-secondary">Close</button>
      </div>`,
      'modal--large');

    modal.querySelector('#inv-close-btn').addEventListener('click', () => modal.remove());
    modal.querySelector('#inv-print-btn').addEventListener('click', () => {
      const base = window.KRAVON_API_BASE || 'http://localhost:3000';
      const slug  = App.slug;
      const token = Auth.state()?.token;
      const url   = `${base}/v1/restaurants/${slug}/settlements/${_sid()}/invoice/${invoice.id}/render`;
      const w = window.open('', '_blank');
      w.document.write(`<script>
        fetch(${JSON.stringify(url)}, { headers: { Authorization: 'Bearer ${token}' } })
          .then(r => r.text()).then(html => {
            document.open(); document.write(html); document.close();
          });
      <\/script>`);
    });
  }

  function _invRow(label, paise, color = null, bold = false) {
    return `<div style="display:flex;justify-content:space-between;padding:2px 0;${color?`color:${color}`:''};${bold?'font-weight:700':''}">
      <span>${label}</span><span>${paise < 0 ? '−' : ''}${_fmtP(Math.abs(paise))}</span>
    </div>`;
  }

  // ── Revision history modal ────────────────────────────────────────────────
  async function _handleHistory() {
    const modal = _modal(`
      <div class="modal-header"><h3>Change history</h3></div>
      <div class="modal-body" id="hist-body"><div class="text-sm text-muted">Loading…</div></div>
      <div class="modal-footer"><button id="hist-close" class="btn btn-secondary">Close</button></div>`);
    modal.querySelector('#hist-close').addEventListener('click', () => modal.remove());
    try {
      const data = await Api.rGet(`/settlements/${_sid()}/revisions`);
      const revs = data.revisions || [];
      if (!revs.length) {
        modal.querySelector('#hist-body').innerHTML = `<div class="text-sm text-muted">No history yet.</div>`;
        return;
      }
      const CHANGE_LABELS = { line_add:'Added', line_remove:'Removed', line_edit:'Edited', status_change:'Status', payment_recorded:'Payment', note_change:'Note' };
      modal.querySelector('#hist-body').innerHTML = `
        <div style="display:flex;flex-direction:column;gap:var(--sp-3);max-height:420px;overflow-y:auto">
          ${revs.reverse().map(r => `
            <div style="display:flex;gap:var(--sp-3);padding:var(--sp-2) 0;border-bottom:1px solid var(--gray-100)">
              <div style="flex:0 0 80px;text-align:right;color:var(--gray-400);font-size:11px">${_fmtDate(r.created_at)}</div>
              <div style="flex:1">
                <div style="font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--gray-500)">${CHANGE_LABELS[r.change_type] || r.change_type}</div>
                <div class="text-sm" style="margin-top:2px">${r.actor_name || 'System'}</div>
                ${r.reason ? `<div class="text-sm text-muted" style="font-style:italic">${r.reason}</div>` : ''}
                ${r.after_state ? `<pre style="font-size:10px;background:var(--gray-50);padding:4px 6px;border-radius:4px;overflow:auto;max-height:80px;white-space:pre-wrap;margin-top:4px">${JSON.stringify(r.after_state, null, 2)}</pre>` : ''}
              </div>
            </div>`).join('')}
        </div>`;
    } catch (err) {
      modal.querySelector('#hist-body').innerHTML = `<div class="text-sm" style="color:var(--red-600)">${err.message}</div>`;
    }
  }

  // ── Add payment modal ─────────────────────────────────────────────────────
  async function _handleAddPayment() {
    const bal = Math.max(0, (_settlement.total_paise || 0) - (_settlement.paid_paise || 0));
    const modal = _modal(`
      <div class="modal-header"><h3>Record payment</h3></div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:var(--sp-3)">
        <label>
          <span class="label">Method</span>
          <select id="pm-method" class="input">
            ${Object.entries(METHOD_LABELS).map(([v,l]) => `<option value="${v}">${l}</option>`).join('')}
          </select>
        </label>
        <label>
          <span class="label">Amount (₹)</span>
          <input id="pm-amount" type="number" class="input" min="0.01" step="0.01" value="${(bal / 100).toFixed(2)}" />
        </label>
        <label>
          <span class="label">Reference / UPI ID (optional)</span>
          <input id="pm-ref" class="input" placeholder="e.g. UPI ref, card last 4" />
        </label>
      </div>
      <div class="modal-footer">
        <button id="pm-cancel" class="btn btn-secondary">Cancel</button>
        <button id="pm-save" class="btn btn-primary">Record payment</button>
      </div>`);

    modal.querySelector('#pm-cancel').addEventListener('click', () => modal.remove());
    modal.querySelector('#pm-save').addEventListener('click', async () => {
      const btn = modal.querySelector('#pm-save');
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        const amt = parseFloat(modal.querySelector('#pm-amount').value);
        if (isNaN(amt) || amt <= 0) throw new Error('Enter a valid amount.');
        const method    = modal.querySelector('#pm-method').value;
        const reference = modal.querySelector('#pm-ref').value?.trim() || undefined;

        const data = await _apiPost('/payments', { method, amount_paise: Math.round(amt * 100), reference });
        _payments.push(data.payment);
        _settlement.paid_paise    = data.paid_paise;
        _settlement.paid          = data.paid_paise / 100;
        _settlement.balance_paise = data.balance_paise;

        _el.querySelector('#stl-payments-wrap').innerHTML = _renderPaymentsHtml();
        _bindPaymentEvents();
        _el.querySelector('#stl-totals-wrap').innerHTML   = _renderTotalsHtml();
        modal.remove();
        DashUI.toast('Payment recorded.', 'success');
      } catch (err) {
        btn.disabled = false; btn.textContent = 'Record payment';
        DashUI.toast(err.message, 'error');
      }
    });
  }

  // ── Add refund modal ──────────────────────────────────────────────────────
  // A refund means money actually went back to the guest — distinct from
  // correcting a mis-entered payment (see _handleCorrectPayment below), which
  // is a staff mistake, not a return of money. Reason is required so anyone
  // reviewing this bill later can tell why it happened.
  async function _handleAddRefund() {
    const modal = _modal(`
      <div class="modal-header"><h3>Refund to guest</h3></div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:var(--sp-3)">
        <label>
          <span class="label">Method</span>
          <select id="rf-method" class="input">
            ${Object.entries(METHOD_LABELS).map(([v,l]) => `<option value="${v}">${l}</option>`).join('')}
          </select>
        </label>
        <label>
          <span class="label">Refund amount (₹)</span>
          <input id="rf-amount" type="number" class="input" min="0.01" step="0.01" placeholder="0.00" />
        </label>
        <label>
          <span class="label">Reason</span>
          <input id="rf-reason" class="input" placeholder="e.g. Guest sent back a dish" />
        </label>
        <label>
          <span class="label">Reference (optional)</span>
          <input id="rf-ref" class="input" placeholder="e.g. UPI ref" />
        </label>
      </div>
      <div class="modal-footer">
        <button id="rf-cancel" class="btn btn-secondary">Cancel</button>
        <button id="rf-save" class="btn btn-primary" style="background:var(--red-600)">Refund to guest</button>
      </div>`);

    modal.querySelector('#rf-cancel').addEventListener('click', () => modal.remove());
    modal.querySelector('#rf-save').addEventListener('click', async () => {
      const btn = modal.querySelector('#rf-save');
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        const amt = parseFloat(modal.querySelector('#rf-amount').value);
        if (isNaN(amt) || amt <= 0) throw new Error('Enter a valid refund amount.');
        const reason = modal.querySelector('#rf-reason').value?.trim();
        if (!reason) throw new Error('A reason is required for a refund.');
        const method    = modal.querySelector('#rf-method').value;
        const reference = modal.querySelector('#rf-ref').value?.trim() || undefined;

        const data = await _apiPost('/payments', { method, amount_paise: Math.round(amt * 100), kind: 'refund', reason, reference });
        _payments.push(data.payment);
        _settlement.paid_paise    = data.paid_paise;
        _settlement.paid          = data.paid_paise / 100;
        _settlement.balance_paise = data.balance_paise;

        _el.querySelector('#stl-payments-wrap').innerHTML = _renderPaymentsHtml();
        _bindPaymentEvents();
        _el.querySelector('#stl-totals-wrap').innerHTML   = _renderTotalsHtml();
        modal.remove();
        DashUI.toast('Refund recorded.', 'success');
      } catch (err) {
        btn.disabled = false; btn.textContent = 'Refund to guest';
        DashUI.toast(err.message, 'error');
      }
    });
  }

  // ── Correct a mis-entered payment ─────────────────────────────────────────
  // Soft-voids the original row rather than deleting it — the payments list
  // keeps a struck-through entry with a reason, not a silently vanished number.
  async function _handleCorrectPayment(paymentId) {
    const reason = await _promptReason(
      'Correct a mistake',
      'What was wrong? (e.g. wrong amount, wrong method, duplicate entry)',
      true
    );
    if (!reason) return;
    try {
      const data = await _apiPost(`/payments/${paymentId}/correct`, { reason });
      const idx = _payments.findIndex(p => p.id === paymentId);
      if (idx !== -1) _payments[idx] = data.payment;
      _settlement.paid_paise    = data.paid_paise;
      _settlement.paid          = data.paid_paise / 100;
      _settlement.balance_paise = data.balance_paise;

      _el.querySelector('#stl-payments-wrap').innerHTML = _renderPaymentsHtml();
      _bindPaymentEvents();
      _el.querySelector('#stl-totals-wrap').innerHTML   = _renderTotalsHtml();
      DashUI.toast('Payment corrected.', 'success');
    } catch (err) {
      DashUI.toast(err.message, 'error');
    }
  }

  function _bindPaymentEvents() {
    _el.querySelectorAll('.stl-correct-payment-btn').forEach(btn => {
      btn.addEventListener('click', () => _handleCorrectPayment(btn.dataset.paymentId));
    });
  }

  // ── Shared re-render helpers ───────────────────────────────────────────────
  function _rerenderLines() {
    const wrap = _el?.querySelector('#stl-lines-wrap');
    if (wrap) wrap.innerHTML = _renderLinesHtml();
    _bindLineEvents();
  }

  function _bindLineEvents() {
    _el.querySelectorAll('.stl-edit-line-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const line = _lines.find(l => l.id === btn.dataset.lineId);
        if (line) _openLineModal(line.line_type, line);
      });
    });
    _el.querySelectorAll('.stl-del-line-btn').forEach(btn => {
      btn.addEventListener('click', () => _handleRemoveLine(btn.dataset.lineId));
    });
  }

  function _updateTotalsFromResponse(totals) {
    if (!totals || !_settlement) return;
    Object.assign(_settlement, totals);
    const wrap = _el?.querySelector('#stl-totals-wrap');
    if (wrap) wrap.innerHTML = _renderTotalsHtml();
  }

  // ── Modal factory ──────────────────────────────────────────────────────────
  function _modal(innerHtml, extraClass = '') {
    const root = _el.querySelector('#stl-modal-root') || document.body;
    const el = document.createElement('div');
    el.className = 'modal-backdrop';
    el.innerHTML = `<div class="modal ${extraClass}">${innerHtml}</div>`;
    el.addEventListener('click', e => { if (e.target === el) el.remove(); });
    root.appendChild(el);
    return el;
  }

  // ── Prompt helper (simple inline modal) ──────────────────────────────────
  function _promptReason(heading, label, required = false) {
    return new Promise(resolve => {
      const modal = _modal(`
        <div class="modal-header"><h3>${heading}</h3></div>
        <div class="modal-body">
          <label><span class="label">${label}</span>
          <input id="pr-input" class="input" placeholder="${required ? 'Required' : 'Optional'}" /></label>
        </div>
        <div class="modal-footer">
          <button id="pr-cancel" class="btn btn-secondary">Cancel</button>
          <button id="pr-ok" class="btn btn-primary">OK</button>
        </div>`);
      modal.querySelector('#pr-cancel').addEventListener('click', () => { modal.remove(); resolve(null); });
      modal.querySelector('#pr-ok').addEventListener('click', () => {
        const val = modal.querySelector('#pr-input').value.trim();
        if (required && !val) { DashUI.toast('Reason is required.', 'error'); return; }
        modal.remove(); resolve(val || undefined);
      });
    });
  }

  // ── Public init ────────────────────────────────────────────────────────────
  function init(el) {
    _el         = el;
    _settlement = null;
    _lines      = [];
    _payments   = [];

    // Parse params from URL hash: #settlement?session_id=xxx or ?id=xxx
    const hash   = location.hash.slice(1);        // "settlement?session_id=..."
    const qIdx   = hash.indexOf('?');
    const params = new URLSearchParams(qIdx !== -1 ? hash.slice(qIdx + 1) : '');
    _sessionId    = params.get('session_id') || null;
    _settlementId = params.get('id')          || null;

    if (!_sessionId && !_settlementId) {
      el.innerHTML = DashUI.emptyState({
        icon:  '🧾',
        title: 'No settlement selected',
        body:  'Navigate here from Bill History or Tables.',
      });
      return;
    }

    _load();
  }

  return { init };
})();
