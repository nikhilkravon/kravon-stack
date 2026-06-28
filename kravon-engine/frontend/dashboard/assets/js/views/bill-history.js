'use strict';

const BillHistoryView = (() => {

  let _state = {
    page: 1,
    limit: 50,
    date_from: '',
    date_to: '',
    table_search: '',
    payment_mode: '',
  };

  function _fmt(n) { return '₹ ' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  function _fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function _fmtDur(openedAt, closedAt) {
    if (!openedAt || !closedAt) return '—';
    const mins = Math.round((new Date(closedAt) - new Date(openedAt)) / 60000);
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }

  function _paymentLabel(mode) {
    const MAP = { offline: 'Cash/Offline', razorpay: 'Razorpay', upi: 'UPI', card: 'Card', cod: 'Cash on Delivery' };
    return MAP[mode] || mode || '—';
  }

  function _buildUrl(extra = {}) {
    const s = { ..._state, ...extra };
    const p = new URLSearchParams();
    p.set('limit',  s.limit);
    p.set('offset', (s.page - 1) * s.limit);
    if (s.date_from)    p.set('date_from',    s.date_from);
    if (s.date_to)      p.set('date_to',      s.date_to + 'T23:59:59');
    if (s.table_search) p.set('table_search', s.table_search);
    if (s.payment_mode) p.set('payment_mode', s.payment_mode);
    return `/dine-in/sessions/closed?${p}`;
  }

  async function _triggerExport() {
    try {
      const base  = window.KRAVON_API_BASE || 'http://localhost:3000';
      const slug  = App.slug;
      const token = Auth.state()?.token;
      const p     = new URLSearchParams();
      if (_state.date_from)    p.set('date_from',    _state.date_from);
      if (_state.date_to)      p.set('date_to',      _state.date_to + 'T23:59:59');
      if (_state.table_search) p.set('table_search', _state.table_search);
      if (_state.payment_mode) p.set('payment_mode', _state.payment_mode);

      const res = await fetch(`${base}/v1/restaurants/${slug}/dine-in/sessions/closed/export?${p}`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `bill-history-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      DashUI.toast('Could not export: ' + err.message, 'error');
    }
  }

  async function _load(el) {
    const tbody   = el.querySelector('#bh-tbody');
    const info    = el.querySelector('#bh-info');
    const prevBtn = el.querySelector('#bh-prev');
    const nextBtn = el.querySelector('#bh-next');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="7"><div class="skeleton skeleton-line" style="margin:12px 0"></div></td></tr>`;

    try {
      const data     = await Api.rGet(_buildUrl());
      const sessions = data.sessions || [];
      const total    = data.total    || 0;
      const pages    = Math.max(1, Math.ceil(total / _state.limit));

      if (!sessions.length) {
        tbody.innerHTML = `<tr><td colspan="7">${DashUI.emptyState({
          icon:  '🧾',
          title: 'No closed sessions yet',
          body:  'Completed dine-in sessions will appear here after checkout.',
        })}</td></tr>`;
      } else {
        tbody.innerHTML = sessions.map(s => `
          <tr class="bh-row" data-session-id="${s.session_id}" style="cursor:pointer">
            <td class="td-muted" style="font-size:11px">${s.session_id.slice(-8).toUpperCase()}</td>
            <td style="font-weight:600">${s.table_name || '—'}</td>
            <td class="td-muted">${s.covers || '—'}</td>
            <td class="td-muted" style="font-size:12px">${_fmtDate(s.closed_at)}</td>
            <td class="td-muted">${_fmtDur(s.opened_at, s.closed_at)}</td>
            <td style="font-weight:700;text-align:right">${_fmt(s.grand_total)}</td>
            <td>
              <span class="badge badge-delivered" style="font-size:10px">${_paymentLabel(s.payment_method)}</span>
            </td>
          </tr>
          <tr class="bh-detail-row" data-for="${s.session_id}" style="display:none">
            <td colspan="7">
              <div class="order-detail" style="padding:10px 16px 12px">
                <div class="bh-detail-loading text-sm text-muted">Loading bill…</div>
              </div>
            </td>
          </tr>`).join('');

        // Row expand/collapse to show full bill
        tbody.querySelectorAll('.bh-row').forEach(row => {
          row.addEventListener('click', () => {
            const sid = row.dataset.sessionId;
            const detailRow = tbody.querySelector(`.bh-detail-row[data-for="${sid}"]`);
            if (!detailRow) return;
            const isOpen = detailRow.style.display === 'table-row';
            tbody.querySelectorAll('.bh-detail-row').forEach(r => { r.style.display = 'none'; });
            tbody.querySelectorAll('.bh-row').forEach(r => r.style.fontWeight = '');
            if (!isOpen) {
              detailRow.style.display = 'table-row';
              row.style.background = 'var(--blue-50)';
              _loadDetail(detailRow, sid);
            }
          });
        });
      }

      if (info)    info.textContent  = `${total} session${total !== 1 ? 's' : ''}`;
      if (prevBtn) prevBtn.disabled  = _state.page <= 1;
      if (nextBtn) nextBtn.disabled  = _state.page >= pages;

    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7">${DashUI.errorState(err.message)}</td></tr>`;
    }
  }

  async function _loadDetail(detailRow, sessionId) {
    const inner = detailRow.querySelector('.order-detail');
    if (!inner || !inner.querySelector('.bh-detail-loading')) return;

    try {
      const data = await Api.rGet(`/dine-in/bill?session_id=${sessionId}`);
      const bill = data.bill;
      if (!bill) { inner.innerHTML = '<div class="text-sm text-muted">No bill data.</div>'; return; }

      const ordersHtml = (bill.orders || []).map(o => {
        const items = (o.items || []).map(i =>
          `<div class="order-item-line">
            <span class="order-item-name">${i.name} × ${i.qty}</span>
            <span class="order-item-price">${_fmt(i.price * i.qty)}</span>
          </div>`
        ).join('');
        return `<div style="margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid var(--gray-100)">
          ${items}
        </div>`;
      }).join('');

      const gstHtml = bill.gst_snapshot ? `
        <div class="bill-summary-row"><span>CGST (${bill.gst_snapshot.cgst_rate}%)</span><span>${_fmt(bill.cgst_amount)}</span></div>
        <div class="bill-summary-row"><span>SGST (${bill.gst_snapshot.sgst_rate}%)</span><span>${_fmt(bill.sgst_amount)}</span></div>` : '';

      inner.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px 24px">
          <div class="order-items-list">${ordersHtml || '<span class="text-sm text-muted">No items</span>'}</div>
          <div>
            <div class="bill-summary-block">
              <div class="bill-summary-row"><span>Subtotal</span><span>${_fmt(bill.subtotal)}</span></div>
              ${gstHtml}
              <div class="bill-summary-row" style="font-weight:700;font-size:14px;color:var(--gray-900)">
                <span>Total</span><span>${_fmt(bill.grand_total)}</span>
              </div>
            </div>
            ${bill.gst_snapshot?.gstin ? `<div class="bill-summary-row text-muted" style="font-size:11px">GSTIN: ${bill.gst_snapshot.gstin}</div>` : ''}
            <div style="margin-top:var(--sp-3)">
              <a href="#settlement?session_id=${sessionId}" class="btn btn-primary btn-sm">Open Settlement Editor →</a>
            </div>
          </div>
        </div>`;
    } catch {
      inner.innerHTML = '<div class="text-sm text-muted">Could not load bill details.</div>';
    }
  }

  function _resetPage() { _state.page = 1; }

  function init(el) {
    _state = { page: 1, limit: 50, date_from: '', date_to: '', table_search: '', payment_mode: '' };

    el.innerHTML = `
      <div class="toolbar" style="flex-wrap:wrap;gap:var(--sp-2)">
        <div class="toolbar-left" style="flex-wrap:wrap;gap:var(--sp-2)">
          <input id="bh-table-search" class="search-input" type="search"
            placeholder="Search table…" style="width:160px">
          <input id="bh-date-from" type="date" class="search-input" style="width:140px" title="From date">
          <input id="bh-date-to"   type="date" class="search-input" style="width:140px" title="To date">
          <select id="bh-payment-mode" class="search-input" style="width:160px">
            <option value="">All payment modes</option>
            <option value="offline">Cash / Offline</option>
            <option value="razorpay">Razorpay</option>
            <option value="upi">UPI</option>
            <option value="card">Card</option>
            <option value="cod">Cash on Delivery</option>
          </select>
        </div>
        <div class="toolbar-right">
          <span id="bh-info" class="text-sm text-muted"></span>
          <button id="bh-export" class="btn btn-secondary btn-sm">↓ Export CSV</button>
        </div>
      </div>

      <div class="card">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Session</th>
                <th>Table</th>
                <th>Covers</th>
                <th>Closed At</th>
                <th>Duration</th>
                <th class="text-right">Total</th>
                <th>Payment</th>
              </tr>
            </thead>
            <tbody id="bh-tbody"></tbody>
          </table>
        </div>
        <div class="pagination">
          <span id="bh-info-bottom" class="pagination-info"></span>
          <div class="pagination-btns">
            <button id="bh-prev" class="btn btn-secondary btn-sm">← Prev</button>
            <button id="bh-next" class="btn btn-secondary btn-sm">Next →</button>
          </div>
        </div>
      </div>`;

    el.querySelector('#bh-export').addEventListener('click', _triggerExport);

    // Debounced table search
    let _searchTimer;
    el.querySelector('#bh-table-search').addEventListener('input', e => {
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(() => {
        _state.table_search = e.target.value.trim();
        _resetPage();
        _load(el);
      }, 300);
    });

    el.querySelector('#bh-date-from').addEventListener('change', e => {
      _state.date_from = e.target.value;
      _resetPage();
      _load(el);
    });

    el.querySelector('#bh-date-to').addEventListener('change', e => {
      _state.date_to = e.target.value;
      _resetPage();
      _load(el);
    });

    el.querySelector('#bh-payment-mode').addEventListener('change', e => {
      _state.payment_mode = e.target.value;
      _resetPage();
      _load(el);
    });

    el.querySelector('#bh-prev').addEventListener('click', () => { _state.page--; _load(el); });
    el.querySelector('#bh-next').addEventListener('click', () => { _state.page++; _load(el); });

    _updateExport();
    _load(el);
  }

  return { init };
})();
