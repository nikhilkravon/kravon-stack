'use strict';

/**
 * InvoicesView — universal invoice list dashboard.
 *
 * Lists all settlements across every source (dine-in, delivery, catering, manual).
 * Clicking a row opens the existing SettlementView workspace.
 * Creating a manual invoice opens a quick form then navigates to the workspace.
 */
const InvoicesView = (() => {

  const _state = {
    page:      1,
    limit:     50,
    status:    '',
    source:    '',
    search:    '',
    date_from: '',
    date_to:   '',
  };

  let _el           = null;
  let _debounceTimer = null;

  // ── Formatters ───────────────────────────────────────────────────────────

  function _fmt(paise) {
    if (paise == null) return '—';
    return '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function _fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  function _debounce(fn, ms = 350) {
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(fn, ms);
  }

  // ── Status badge ─────────────────────────────────────────────────────────

  const STATUS_COLOR = {
    draft:     'var(--gray-500)',
    open:      'var(--blue-600)',
    finalized: 'var(--green-600)',
    voided:    'var(--red-500)',
  };

  function _statusBadge(status) {
    const color = STATUS_COLOR[status] || 'var(--gray-500)';
    const label = { draft: 'Draft', open: 'Open', finalized: 'Finalized', voided: 'Voided' }[status] || status;
    return `<span class="badge" style="background:${color}1a;color:${color};font-size:11px;white-space:nowrap">${label}</span>`;
  }

  // ── Source label ─────────────────────────────────────────────────────────

  const SOURCE_LABEL = {
    dine_in:  'Dine-In',
    order:    'Order',
    catering: 'Catering',
    manual:   'Manual',
  };

  function _sourceChip(type) {
    return `<span class="badge" style="font-size:10px;background:var(--gray-100);color:var(--gray-600)">${SOURCE_LABEL[type] || type}</span>`;
  }

  // ── URL builder ──────────────────────────────────────────────────────────

  function _buildUrl() {
    const p = new URLSearchParams({ page: _state.page, limit: _state.limit });
    if (_state.status)    p.set('status',    _state.status);
    if (_state.source)    p.set('source',    _state.source);
    if (_state.search)    p.set('search',    _state.search);
    if (_state.date_from) p.set('date_from', _state.date_from);
    if (_state.date_to)   p.set('date_to',   _state.date_to);
    return `/settlements?${p}`;
  }

  // ── Pagination ───────────────────────────────────────────────────────────

  function _pagerHtml(page, pages) {
    if (pages <= 1) return '';
    return `
      <div class="pagination" style="display:flex;align-items:center;justify-content:flex-end;gap:var(--sp-2);padding:var(--sp-3) 0">
        <button class="btn btn-secondary btn-sm" id="inv-prev" ${page <= 1 ? 'disabled' : ''}>← Prev</button>
        <span class="text-sm text-muted">Page ${page} of ${pages}</span>
        <button class="btn btn-secondary btn-sm" id="inv-next" ${page >= pages ? 'disabled' : ''}>Next →</button>
      </div>`;
  }

  // ── Row renderer ─────────────────────────────────────────────────────────

  function _rowHtml(s) {
    const balance = Math.max(0, (s.total_paise || 0) - (s.paid_paise || 0));
    const label   = s.table_name
      ? `Table ${s.table_name}`
      : (s.customer_name || s.notes || '—');
    return `
      <tr class="inv-row" data-id="${s.id}" style="cursor:pointer">
        <td style="white-space:nowrap">${_fmtDate(s.created_at)}</td>
        <td>
          <div style="font-weight:500">${DashUI.esc(label)}</div>
          ${s.internal_ref ? `<div class="text-sm text-muted">${DashUI.esc(s.internal_ref)}</div>` : ''}
        </td>
        <td>${_sourceChip(s.source_type)}</td>
        <td>${_statusBadge(s.status)}</td>
        <td style="text-align:right;font-weight:500">${_fmt(s.total_paise)}</td>
        <td style="text-align:right;color:${balance > 0 ? 'var(--red-600)' : 'var(--green-600)'}">
          ${balance > 0 ? _fmt(balance) + ' due' : '✓ Paid'}
        </td>
      </tr>`;
  }

  // ── Main render ──────────────────────────────────────────────────────────

  async function _render() {
    const tbody    = _el.querySelector('#inv-tbody');
    const pagerTop = _el.querySelector('#inv-pager-top');
    const pagerBot = _el.querySelector('#inv-pager-bot');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:var(--sp-6);color:var(--gray-400)">Loading…</td></tr>`;
    if (pagerTop) pagerTop.innerHTML = '';
    if (pagerBot) pagerBot.innerHTML = '';

    try {
      const data  = await Api.rGet(_buildUrl());
      const items = data.settlements || [];
      const total = data.total || 0;
      const pages = data.pages || 1;
      const page  = data.page  || 1;

      const countEl = _el.querySelector('#inv-count');
      if (countEl) countEl.textContent = `${total.toLocaleString('en-IN')} invoices`;

      if (!items.length) {
        tbody.innerHTML = `<tr><td colspan="6">${DashUI.emptyState({ icon: '🧾', title: 'No invoices', body: 'Create a manual invoice or settle a dine-in session.' })}</td></tr>`;
        return;
      }

      tbody.innerHTML = items.map(_rowHtml).join('');

      // Row click → open settlement workspace
      _el.querySelectorAll('.inv-row').forEach(row => {
        row.addEventListener('click', () => {
          const id = row.dataset.id;
          history.pushState(null, '', `#settlement?id=${id}`);
          App.navigate('settlement');
        });
      });

      const pager = _pagerHtml(page, pages);
      if (pagerTop) pagerTop.innerHTML = pager;
      if (pagerBot) pagerBot.innerHTML = pager;

      _el.querySelectorAll('#inv-prev').forEach(b => b.addEventListener('click', () => {
        if (_state.page > 1) { _state.page--; _render(); window.scrollTo(0, 0); }
      }));
      _el.querySelectorAll('#inv-next').forEach(b => b.addEventListener('click', () => {
        if (_state.page < pages) { _state.page++; _render(); window.scrollTo(0, 0); }
      }));

    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6">${DashUI.errorState(err.message)}</td></tr>`;
    }
  }

  // ── Manual invoice modal ─────────────────────────────────────────────────

  function _openManualModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal" style="max-width:420px">
        <div class="modal-header">
          <h3 class="modal-title">New Manual Invoice</h3>
          <button class="modal-close" id="inv-modal-close">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label for="inv-manual-notes">Description / Customer</label>
            <input id="inv-manual-notes" class="input" type="text" placeholder="e.g. Walk-in — Priya" maxlength="500" />
          </div>
          <div class="form-group">
            <label for="inv-manual-ref">Internal Reference <span class="text-muted">(optional)</span></label>
            <input id="inv-manual-ref" class="input" type="text" placeholder="e.g. PO-2024-001" maxlength="100" />
          </div>
          <p id="inv-manual-err" class="form-error" hidden></p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="inv-modal-cancel">Cancel</button>
          <button class="btn btn-primary" id="inv-modal-create">Create Invoice</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const close = () => document.body.removeChild(modal);
    modal.querySelector('#inv-modal-close').addEventListener('click', close);
    modal.querySelector('#inv-modal-cancel').addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) close(); });

    modal.querySelector('#inv-modal-create').addEventListener('click', async () => {
      const notes    = modal.querySelector('#inv-manual-notes').value.trim();
      const ref      = modal.querySelector('#inv-manual-ref').value.trim();
      const errEl    = modal.querySelector('#inv-manual-err');
      const btn      = modal.querySelector('#inv-modal-create');
      errEl.hidden   = true;
      btn.disabled   = true;
      btn.textContent = 'Creating…';
      try {
        const data = await Api.rPost('/settlements/manual', { notes, internal_ref: ref || undefined });
        close();
        history.pushState(null, '', `#settlement?id=${data.settlement.id}`);
        App.navigate('settlement');
      } catch (err) {
        errEl.textContent = err.message || 'Failed to create invoice';
        errEl.hidden = false;
        btn.disabled = false;
        btn.textContent = 'Create Invoice';
      }
    });
  }

  // ── Init ─────────────────────────────────────────────────────────────────

  async function init(el) {
    _el = el;
    Object.assign(_state, { page: 1, status: '', source: '', search: '', date_from: '', date_to: '' });

    el.innerHTML = `
      <div class="toolbar" style="flex-wrap:wrap;gap:var(--sp-2)">
        <div class="toolbar-left" style="flex-wrap:wrap;gap:var(--sp-2)">

          <input id="inv-search" type="search" class="input input-sm"
            placeholder="Search notes or ref…" style="width:200px" />

          <select id="inv-status" class="input input-sm" style="width:140px">
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="open">Open</option>
            <option value="finalized">Finalized</option>
            <option value="voided">Voided</option>
          </select>

          <select id="inv-source" class="input input-sm" style="width:140px">
            <option value="">All sources</option>
            <option value="dine_in">Dine-In</option>
            <option value="order">Delivery / Takeaway</option>
            <option value="catering">Catering</option>
            <option value="manual">Manual</option>
          </select>

          <input id="inv-date-from" type="date" class="input input-sm" title="From date" />
          <input id="inv-date-to"   type="date" class="input input-sm" title="To date" />

        </div>
        <div class="toolbar-right" style="display:flex;align-items:center;gap:var(--sp-2)">
          <span id="inv-count" class="text-sm text-muted"></span>
          <button class="btn btn-primary btn-sm" id="inv-new-manual">+ Manual Invoice</button>
        </div>
      </div>

      <div id="inv-pager-top"></div>

      <div class="table-wrap" style="margin-top:var(--sp-3)">
        <table>
          <thead>
            <tr>
              <th style="white-space:nowrap">Date</th>
              <th>Description</th>
              <th>Source</th>
              <th>Status</th>
              <th style="text-align:right">Total</th>
              <th style="text-align:right">Balance</th>
            </tr>
          </thead>
          <tbody id="inv-tbody">
            <tr><td colspan="6" style="text-align:center;padding:var(--sp-6);color:var(--gray-400)">Loading…</td></tr>
          </tbody>
        </table>
      </div>

      <div id="inv-pager-bot"></div>`;

    el.querySelector('#inv-search').addEventListener('input', e => {
      _debounce(() => { _state.search = e.target.value.trim(); _state.page = 1; _render(); });
    });
    el.querySelector('#inv-status').addEventListener('change', e => {
      _state.status = e.target.value; _state.page = 1; _render();
    });
    el.querySelector('#inv-source').addEventListener('change', e => {
      _state.source = e.target.value; _state.page = 1; _render();
    });
    el.querySelector('#inv-date-from').addEventListener('change', e => {
      _state.date_from = e.target.value; _state.page = 1; _render();
    });
    el.querySelector('#inv-date-to').addEventListener('change', e => {
      _state.date_to = e.target.value; _state.page = 1; _render();
    });
    el.querySelector('#inv-new-manual').addEventListener('click', _openManualModal);

    await _render();
  }

  return { init };
})();
