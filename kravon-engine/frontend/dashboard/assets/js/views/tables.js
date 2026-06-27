'use strict';

const TablesView = (() => {

  const STATUS_BADGE = {
    available: '<span class="badge badge-delivered">Available</span>',
    occupied:  '<span class="badge badge-preparing">Occupied</span>',
    reserved:  '<span class="badge badge-placed">Reserved</span>',
    cleaning:  '<span class="badge badge-pending">Cleaning</span>',
  };

  function _fmt(n) { return '₹ ' + Number(n || 0).toLocaleString('en-IN'); }

  function _dur(isoDate) {
    if (!isoDate) return '—';
    const mins = Math.floor((Date.now() - new Date(isoDate)) / 60000);
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }

  function _sessionUrgency(isoDate) {
    if (!isoDate) return '';
    const mins = Math.floor((Date.now() - new Date(isoDate)) / 60000);
    if (mins >= 90) return 'table-card--urgent';
    if (mins >= 60) return 'table-card--warning';
    return '';
  }

  function _qrUrl(table) {
    const base = window.KRAVON_FRONTEND_BASE || 'http://localhost:8000';
    const slug = Auth.state().slug;
    return `${base}/tables/?slug=${encodeURIComponent(slug)}&table_id=${table.id}`;
  }

  // ── Floor grid ────────────────────────────────────────────────────────────
  function _tableCard(t) {
    const badge   = STATUS_BADGE[t.status] || `<span class="badge badge-pending">${t.status}</span>`;
    const session = t.session;
    const urgency = session ? _sessionUrgency(session.opened_at) : '';
    const urgencyLabel = urgency === 'table-card--urgent'
      ? '<span class="table-urgency-badge table-urgency-badge--urgent">90+ min</span>'
      : urgency === 'table-card--warning'
      ? '<span class="table-urgency-badge table-urgency-badge--warn">60+ min</span>'
      : '';

    const guestsWaitingBadge = t.staff_notify_at
      ? `<div class="guests-waiting-alert">Guests Waiting</div>`
      : '';

    const billRequestedBadge = session?.bill_requested
      ? `<div class="bill-requested-alert">Bill Requested</div>`
      : '';

    const billOwnerLine = session?.bill_owner
      ? `<div class="table-session-row"><span class="detail-label">Guest</span> ${session.bill_owner}</div>`
      : '';

    return `
      <div class="table-card table-card--${t.status}${urgency ? ' ' + urgency : ''}" data-table-id="${t.id}">
        <div class="table-card-header">
          <span class="table-card-name">${t.name}</span>
          <span class="table-card-cap">${t.capacity || '—'} pax</span>
        </div>
        ${guestsWaitingBadge}
        ${badge}
        ${billRequestedBadge}
        ${session ? `
          <div class="table-session-info">
            <div class="table-session-row">
              <span class="detail-label">Open</span> ${_dur(session.opened_at)} ${urgencyLabel}
            </div>
            <div class="table-session-row">
              <span class="detail-label">Total</span> ${_fmt(session.total)}
            </div>
            ${billOwnerLine}
          </div>
          <div class="session-orders-feed" id="orders-feed-${session.id}">
            <div class="session-orders-loading">Loading orders…</div>
          </div>
          <div class="table-card-actions">
            <button class="btn btn-danger btn-sm" data-action="close-session" data-session-id="${session.id}" data-table="${t.name}">Close session</button>
            <button class="btn btn-ghost btn-sm" data-action="view-bill" data-session-id="${session.id}">View bill</button>
            <button class="btn btn-ghost btn-sm" data-action="show-qr" data-table-id="${t.id}" data-table-name="${t.name}">QR</button>
          </div>
        ` : `
          <div class="table-card-actions">
            <button class="btn btn-primary btn-sm" data-action="open-session" data-table-id="${t.id}" data-table="${t.name}">Open session</button>
            <button class="btn btn-ghost btn-sm" data-action="show-qr" data-table-id="${t.id}" data-table-name="${t.name}">QR code</button>
          </div>
        `}
        <div class="table-card-footer">
          <button class="btn btn-ghost btn-sm" data-action="edit-table" data-table-id="${t.id}">Edit</button>
          <button class="btn btn-danger btn-sm" data-action="delete-table" data-table-id="${t.id}" data-table="${t.name}">Delete</button>
        </div>
      </div>`;
  }

  function _fmtTime(iso) {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  }

  async function _loadSessionOrders(sessionId) {
    const feed = document.getElementById(`orders-feed-${sessionId}`);
    if (!feed) return;
    try {
      const data   = await Api.rGet(`/dine-in/session/orders?session_id=${sessionId}`);
      const orders = data.orders || [];

      if (!orders.length) {
        feed.innerHTML = '<div class="session-orders-empty">No orders yet</div>';
        return;
      }

      // Read-only: Tables reads Order.status from the Session domain, never writes it
      const STATUS_COLOR = {
        pending:   'var(--gray-400)',
        confirmed: 'var(--blue-500)',
        preparing: 'var(--amber-600)',
        ready:     'var(--green-600)',
        completed: 'var(--gray-500)',
        cancelled: 'var(--red-500)',
      };

      feed.innerHTML = orders.map(o => {
        const guest    = o.guest_name ? o.guest_name.split(' ')[0] : 'Guest';
        const itemList = (o.items || []).map(i => `${i.name} ×${i.qty}`).join(', ');
        const color    = STATUS_COLOR[o.status] || 'var(--gray-400)';
        return `
          <div class="session-order-row">
            <div class="session-order-meta">
              <span class="session-order-guest">${guest}</span>
              <span class="session-order-time">${_fmtTime(o.created_at)}</span>
              <span class="session-order-status" style="color:${color}">${o.status}</span>
            </div>
            <div class="session-order-items">${itemList}</div>
          </div>`;
      }).join('');
    } catch (err) {
      if (feed) feed.innerHTML = '';
    }
  }

  let _loadError = false;

  async function _load(el) {
    const grid = el.querySelector('#tables-grid');
    if (!grid) return;
    grid.innerHTML = `<div class="skeleton" style="height:120px;border-radius:var(--radius-lg)"></div>`.repeat(4);

    try {
      const data   = await Api.rGet('/tables');
      _loadError = false;
      const tables = data.tables || [];
      _tables = tables;

      if (!tables.length) {
        _tables = [];
        grid.innerHTML = DashUI.emptyState({
          icon:  '🪑',
          title: 'No tables yet',
          body:  'Add your first table to start managing dine-in sessions.',
          cta:   '+ Add table',
        });
        return;
      }

      grid.innerHTML = tables.map(_tableCard).join('');

      // Load order feeds for all occupied tables
      tables.forEach(t => {
        if (t.session?.id) _loadSessionOrders(t.session.id);
      });

    } catch (err) {
      _loadError = true;
      grid.innerHTML = DashUI.errorState(err.message);
    }
  }

  // Single delegated click handler attached once in init() on the stable el container.
  // Uses a module-level guard to prevent concurrent async actions from racing.
  let _actionInFlight = false;

  async function _handleGridClick(el, e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === 'open-session') {
      const card = btn.closest('.table-card');
      const existingForm = card.querySelector('.inline-covers-form');
      if (existingForm) { existingForm.remove(); return; }
      const form = document.createElement('div');
      form.className = 'inline-covers-form inline-add-form';
      form.innerHTML = `
        <div class="form-group" style="margin-bottom:var(--sp-2)">
          <label>Number of covers</label>
          <input type="number" min="1" max="50" placeholder="e.g. 2" class="covers-input" style="width:100%">
        </div>
        <div style="display:flex;gap:var(--sp-1)">
          <button class="btn btn-primary btn-sm covers-confirm">Open session</button>
          <button class="btn btn-ghost btn-sm covers-cancel">Cancel</button>
        </div>`;
      btn.closest('.table-card-actions').insertAdjacentElement('afterend', form);
      form.querySelector('.covers-cancel').onclick = () => form.remove();
      form.querySelector('.covers-confirm').onclick = async () => {
        const val    = form.querySelector('.covers-input').value;
        const covers = val ? parseInt(val, 10) : undefined;
        const saveBtn = form.querySelector('.covers-confirm');
        saveBtn.disabled = true; saveBtn.textContent = 'Opening…';
        try {
          await Api.rPost('/dine-in/session/open', { table_id: btn.dataset.tableId, covers });
          DashUI.toast(`Session opened for ${btn.dataset.table}`, 'success');
          _load(el);
        } catch (err) {
          DashUI.toast('Could not open session. ' + err.message, 'error');
          saveBtn.disabled = false; saveBtn.textContent = 'Open session';
        }
      };
      return;
    }

    // Non-confirm actions — always available, no guard needed
    if (action === 'view-bill') { _showBill(el, btn.dataset.sessionId); return; }
    if (action === 'show-qr')   { _showQr(btn.dataset.tableId, btn.dataset.tableName); return; }
    if (action === 'edit-table') {
      const tableData = _tables.find(t => t.id === btn.dataset.tableId);
      if (!tableData) { _load(el); return; }
      _openTableModal(el, tableData);
      return;
    }

    // Confirm-gated actions — guard prevents stacking multiple dialogs
    if (_actionInFlight) return;
    _actionInFlight = true;

    try {
      if (action === 'close-session') {
        const ok = await DashUI.confirm(
          `Close session for <strong>${btn.dataset.table}</strong>? This will finalise the bill.`,
          { title: 'Close session', confirmLabel: 'Close & Bill', danger: true }
        );
        if (!ok) return;
        btn.disabled = true;
        try {
          await Api.rPost('/dine-in/session/close', { session_id: btn.dataset.sessionId });
          DashUI.toast(`Session closed for ${btn.dataset.table}`, 'success');
          _load(el);
        } catch (err) {
          DashUI.toast('Could not close session. ' + err.message, 'error');
          btn.disabled = false;
        }
      }

      if (action === 'delete-table') {
        const ok = await DashUI.confirm(
          `Delete table <strong>${btn.dataset.table}</strong>? This cannot be undone.`,
          { title: 'Delete table', confirmLabel: 'Delete', danger: true }
        );
        if (!ok) return;
        try {
          await Api.rDel(`/tables/${btn.dataset.tableId}`);
          DashUI.toast(`Table ${btn.dataset.table} deleted`, 'success');
          _load(el);
        } catch (err) {
          DashUI.toast(err.message, 'error');
        }
      }
    } finally {
      _actionInFlight = false;
    }
  }

  // ── Bill modal ────────────────────────────────────────────────────────────
  async function _showBill(el, sessionId) {
    document.getElementById('bill-modal')?.remove();
    try {
      const data = await Api.rGet(`/dine-in/bill?session_id=${sessionId}`);
      const bill = data.bill;
      const gst  = bill.gst_snapshot;

      const ordersHtml = (bill.orders || []).map(o => `
        <div style="margin-bottom:var(--sp-3)">
          <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--gray-500);margin-bottom:4px">
            <span>Order</span><span>${_fmt(o.total)}</span>
          </div>
          ${(o.items || []).map(i => `
            <div class="order-item-line">
              <span class="order-item-name">${i.name} × ${i.qty}</span>
              <span class="order-item-price">${_fmt(i.price * i.qty)}</span>
            </div>`).join('')}
        </div>`).join('');

      const gstHtml = gst ? `
        <div class="bill-summary-block">
          <div class="bill-summary-row">
            <span>Taxable amount</span><span>${_fmt(bill.taxable_amount)}</span>
          </div>
          <div class="bill-summary-row">
            <span>CGST @ ${gst.cgst_rate}%</span><span>${_fmt(bill.cgst_amount)}</span>
          </div>
          <div class="bill-summary-row">
            <span>SGST @ ${gst.sgst_rate}%</span><span>${_fmt(bill.sgst_amount)}</span>
          </div>
          ${gst.gstin ? `<div class="bill-summary-row bill-summary-gstin"><span>GSTIN</span><span>${gst.gstin}</span></div>` : ''}
          ${bill.gst_inconsistent ? `<div class="bill-gst-warn">GST rates varied across orders — review manually.</div>` : ''}
        </div>` : '';

      document.body.insertAdjacentHTML('beforeend', `
        <div class="modal-overlay" id="bill-modal">
          <div class="modal" style="max-width:440px">
            <div class="modal-header">
              <span class="modal-title">Bill — ${bill.table_name}</span>
              <div style="display:flex;gap:var(--sp-2);align-items:center">
                <button class="btn btn-secondary btn-sm" id="bill-print-btn">Print</button>
                <button class="modal-close" id="bill-modal-close">✕</button>
              </div>
            </div>
            <div class="modal-body" id="bill-modal-body">
              <div style="font-size:12px;color:var(--gray-500);margin-bottom:var(--sp-4)">
                ${bill.covers ? `${bill.covers} covers · ` : ''}Opened ${_dur(bill.opened_at)} ago
              </div>
              ${ordersHtml}
              <div class="bill-divider"></div>
              ${gstHtml}
              <div class="cart-total-line" style="margin-top:var(--sp-3)">
                <span class="cart-total-label">Grand Total</span>
                <span class="cart-total-val">${_fmt(bill.grand_total)}</span>
              </div>
            </div>
          </div>
        </div>`);

      const overlay = document.getElementById('bill-modal');
      overlay.querySelector('#bill-modal-close').onclick = () => overlay.remove();
      overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

      overlay.querySelector('#bill-print-btn').onclick = () => {
        const slug    = Auth.state().slug || '';
        const content = document.getElementById('bill-modal-body').innerHTML;
        const win = window.open('', '_blank');
        win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
          <title>Bill — ${bill.table_name}</title>
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { font-family: -apple-system, Arial, sans-serif; padding: 24px; font-size: 14px; color: #111; max-width: 360px; margin: 0 auto; }
            h2 { font-size: 16px; font-weight: 700; margin-bottom: 4px; }
            .meta { font-size: 11px; color: #6b7280; margin-bottom: 16px; }
            .order-item-line { display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 13px; }
            .order-item-name { color: #374151; }
            .order-item-price { color: #111; font-weight: 500; }
            .bill-divider { border: none; border-top: 1px solid #e5e7eb; margin: 12px 0; }
            .bill-summary-block { margin-bottom: 8px; }
            .bill-summary-row { display: flex; justify-content: space-between; font-size: 12px; color: #6b7280; margin-bottom: 3px; }
            .bill-summary-gstin { font-size: 11px; font-family: monospace; }
            .bill-gst-warn { font-size: 11px; color: #d97706; margin-top: 4px; }
            .cart-total-line { display: flex; justify-content: space-between; font-size: 16px; font-weight: 700; border-top: 2px solid #111; padding-top: 8px; margin-top: 8px; }
            .slug { font-size: 11px; color: #9ca3af; text-align: center; margin-top: 24px; }
            @media print { @page { margin: 8mm; } }
          </style>
        </head><body>
          <h2>Bill — ${bill.table_name}</h2>
          <div class="meta">${bill.covers ? bill.covers + ' covers · ' : ''}${new Date().toLocaleString('en-IN')}</div>
          ${content}
          ${slug ? `<div class="slug">${slug}</div>` : ''}
          <script>window.onload = function() { window.print(); }<\/script>
        </body></html>`);
        win.document.close();
      };
    } catch (err) {
      DashUI.toast('Could not load bill. ' + err.message, 'error');
    }
  }

  // ── QR modal ──────────────────────────────────────────────────────────────
  function _showQr(tableId, tableName) {
    const slug  = Auth.state().slug;
    const base  = window.KRAVON_FRONTEND_BASE || 'http://localhost:8000';
    const qrUrl = `${base}/tables/?slug=${encodeURIComponent(slug)}&table_id=${tableId}`;
    const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(qrUrl)}`;

    document.getElementById('qr-modal')?.remove();

    const overlay = document.createElement('div');
    overlay.id        = 'qr-modal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:320px">
        <div class="modal-header">
          <span class="modal-title">QR Code — ${tableName}</span>
          <button class="modal-close" id="qr-modal-close">✕</button>
        </div>
        <div class="modal-body" style="display:flex;flex-direction:column;align-items:center;gap:var(--sp-4)">
          <img src="${qrSrc}" alt="QR code for ${tableName}" style="width:200px;height:200px;border-radius:var(--radius)">
          <div style="font-size:11px;color:var(--gray-400);text-align:center;word-break:break-all">${qrUrl}</div>
          <a href="${qrSrc}" download="qr-${tableName}.png" class="btn btn-secondary btn-sm">Download PNG</a>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('#qr-modal-close').onclick = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  }

  // ── Add/Edit table modal ──────────────────────────────────────────────────
  function _openTableModal(viewEl, table = null) {
    document.getElementById('table-modal')?.remove();
    const isEdit = !!table;
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal-overlay" id="table-modal">
        <div class="modal" style="max-width:400px">
          <div class="modal-header">
            <span class="modal-title">${isEdit ? 'Edit table' : 'Add table'}</span>
            <button class="modal-close" id="table-modal-close">✕</button>
          </div>
          <form id="table-form">
            <div class="modal-body">
              <div class="form-group">
                <label>Table name</label>
                <input name="name" type="text" value="${table?.name || ''}" placeholder="e.g. T1, Table 5, Garden Patio" required maxlength="50">
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label>Capacity <span class="text-muted">(pax)</span></label>
                  <input name="capacity" type="number" min="1" max="50" value="${table?.capacity || ''}" placeholder="4">
                </div>
                <div class="form-group">
                  <label>Floor / Section</label>
                  <input name="floor" type="text" value="${table?.floor || ''}" placeholder="Ground, Rooftop…" maxlength="50">
                </div>
              </div>
              <p id="table-modal-error" class="form-error" hidden></p>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" id="table-modal-cancel">Cancel</button>
              <button type="submit" class="btn btn-primary">Save</button>
            </div>
          </form>
        </div>
      </div>`);

    const overlay  = document.getElementById('table-modal');
    const close    = () => overlay.remove();
    overlay.querySelector('#table-modal-close').onclick  = close;
    overlay.querySelector('#table-modal-cancel').onclick = close;
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    overlay.querySelector('#table-form').onsubmit = async e => {
      e.preventDefault();
      const fd  = new FormData(e.target);
      const btn = overlay.querySelector('[type=submit]');
      const err = overlay.querySelector('#table-modal-error');
      btn.disabled = true; btn.textContent = 'Saving…';
      err.hidden = true;

      const body = { name: fd.get('name') };
      const cap  = parseInt(fd.get('capacity'), 10);
      const floor = fd.get('floor')?.trim();
      if (!isNaN(cap)) body.capacity = cap;
      if (floor) body.floor = floor;

      try {
        if (isEdit) {
          await Api.rPut(`/tables/${table.id}`, body);
        } else {
          await Api.rPost('/tables', body);
        }
        close();
        DashUI.toast(isEdit ? 'Table updated.' : 'Table added.', 'success');
        _load(viewEl);
      } catch (ex) {
        err.textContent = ex.message; err.hidden = false;
        btn.disabled = false; btn.textContent = 'Save';
      }
    };
  }

  // ── QR PDF sheet ──────────────────────────────────────────────────────────
  function _downloadQrPdf(tables) {
    const slug = Auth.state().slug;
    const base = window.KRAVON_FRONTEND_BASE || 'http://localhost:8000';

    const cells = tables.map(t => {
      const url = `${base}/tables/?slug=${encodeURIComponent(slug)}&table_id=${t.id}`;
      const src = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(url)}`;
      return `
        <div class="qr-cell">
          <img src="${src}" alt="QR for ${t.name}" width="150" height="150">
          <div class="qr-label">${t.name}</div>
          ${t.floor ? `<div class="qr-floor">${t.floor}</div>` : ''}
        </div>`;
    }).join('');

    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>QR Codes — ${slug}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, sans-serif; padding: 24px; background: #fff; }
    h1 { font-size: 16px; font-weight: 600; color: #111; margin-bottom: 20px; }
    .grid { display: flex; flex-wrap: wrap; gap: 24px; }
    .qr-cell {
      display: flex; flex-direction: column; align-items: center;
      width: 180px; padding: 16px 12px;
      border: 1px solid #e5e7eb; border-radius: 8px;
      page-break-inside: avoid;
    }
    .qr-cell img { width: 150px; height: 150px; display: block; }
    .qr-label { margin-top: 10px; font-size: 15px; font-weight: 700; color: #111; text-align: center; }
    .qr-floor { font-size: 11px; color: #6b7280; margin-top: 2px; text-align: center; }
    @media print {
      body { padding: 12px; }
      @page { margin: 12mm; }
    }
  </style>
</head>
<body>
  <h1>QR Codes — ${slug}</h1>
  <div class="grid">${cells}</div>
  <script>
    window.onload = function() {
      var imgs = document.querySelectorAll('img');
      var loaded = 0;
      function tryPrint() { if (++loaded === imgs.length) window.print(); }
      imgs.forEach(function(img) {
        if (img.complete) tryPrint();
        else { img.onload = tryPrint; img.onerror = tryPrint; }
      });
      if (!imgs.length) window.print();
    };
  <\/script>
</body>
</html>`);
    win.document.close();
  }

  // ── Bill history ──────────────────────────────────────────────────────────
  let _historyOffset = 0;
  const HISTORY_LIMIT = 50;

  function _fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    });
  }

  function _sessionDur(openedAt, closedAt) {
    if (!openedAt || !closedAt) return '—';
    const mins = Math.floor((new Date(closedAt) - new Date(openedAt)) / 60000);
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }

  async function _loadHistory(el, append = false) {
    const panel = el.querySelector('#bill-history-panel');
    if (!panel) return;

    if (!append) {
      _historyOffset = 0;
      panel.innerHTML = `<div class="skeleton" style="height:48px;border-radius:var(--radius)"></div>`.repeat(6);
    }

    try {
      const data     = await Api.rGet(`/dine-in/sessions/closed?limit=${HISTORY_LIMIT}&offset=${_historyOffset}`);
      const sessions = data.sessions || [];
      const total    = data.total    || 0;

      if (!append && !sessions.length) {
        panel.innerHTML = DashUI.emptyState({ icon: '🧾', title: 'No closed sessions yet', body: 'Bills will appear here once sessions are closed.' });
        return;
      }

      const rows = sessions.map(s => `
        <div class="bill-history-row">
          <div class="bill-history-cell bill-history-table">${s.table_name}</div>
          <div class="bill-history-cell bill-history-date">${_fmtDate(s.closed_at)}</div>
          <div class="bill-history-cell bill-history-dur">${_sessionDur(s.opened_at, s.closed_at)}</div>
          <div class="bill-history-cell bill-history-covers">${s.covers ? s.covers + ' pax' : '—'}</div>
          <div class="bill-history-cell bill-history-total">${_fmt(s.grand_total)}</div>
          <div class="bill-history-cell">
            <button class="btn btn-ghost btn-sm" data-action="history-bill" data-session-id="${s.session_id}">View bill</button>
          </div>
        </div>`).join('');

      if (append) {
        panel.querySelector('#bill-history-rows').insertAdjacentHTML('beforeend', rows);
      } else {
        panel.innerHTML = `
          <div class="bill-history-table-wrap">
            <div class="bill-history-header">
              <div class="bill-history-cell">Table</div>
              <div class="bill-history-cell">Closed</div>
              <div class="bill-history-cell">Duration</div>
              <div class="bill-history-cell">Covers</div>
              <div class="bill-history-cell">Total</div>
              <div class="bill-history-cell"></div>
            </div>
            <div id="bill-history-rows">${rows}</div>
          </div>
          ${total > _historyOffset + HISTORY_LIMIT
            ? `<div style="text-align:center;margin-top:var(--sp-4)">
                 <button id="history-load-more" class="btn btn-secondary btn-sm">Load more</button>
               </div>`
            : ''}`;
        const loadMore = panel.querySelector('#history-load-more');
        if (loadMore) loadMore.addEventListener('click', () => {
          _historyOffset += HISTORY_LIMIT;
          _loadHistory(el, true);
        });
      }
    } catch (err) {
      if (!append) panel.innerHTML = DashUI.errorState(err.message);
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  let _pollTimer       = null;
  let _tables          = [];
  let _elClickHandler  = null;
  let _elCtaHandler    = null;
  let _activeTab       = 'floor';

  function _switchTab(el, tab) {
    _activeTab = tab;
    el.querySelector('#tab-floor').classList.toggle('tab-active', tab === 'floor');
    el.querySelector('#tab-history').classList.toggle('tab-active', tab === 'history');
    el.querySelector('#floor-panel').hidden    = tab !== 'floor';
    el.querySelector('#history-panel-wrap').hidden = tab !== 'history';
    el.querySelector('#add-table-btn').hidden  = tab !== 'floor';
    el.querySelector('#download-qr-btn').hidden = tab !== 'floor';
    if (tab === 'history') _loadHistory(el);
  }

  function init(el) {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
    if (_elClickHandler) { el.removeEventListener('click', _elClickHandler); _elClickHandler = null; }
    if (_elCtaHandler)   { el.removeEventListener('cta',   _elCtaHandler);   _elCtaHandler   = null; }
    _actionInFlight = false;
    _loadError = false;
    _activeTab = 'floor';

    el.innerHTML = `
      <div class="toolbar">
        <div class="toolbar-left" style="display:flex;align-items:center;gap:var(--sp-2)">
          <button id="tab-floor"   class="btn btn-secondary btn-sm tab-active">Floor</button>
          <button id="tab-history" class="btn btn-secondary btn-sm">History</button>
        </div>
        <div class="toolbar-right">
          <button id="download-qr-btn" class="btn btn-secondary">Download QR Sheet</button>
          <button id="add-table-btn" class="btn btn-primary">+ Add table</button>
        </div>
      </div>
      <div id="floor-panel">
        <div id="tables-grid" class="tables-grid"></div>
      </div>
      <div id="history-panel-wrap" hidden>
        <div id="bill-history-panel"></div>
      </div>`;

    el.querySelector('#tab-floor').addEventListener('click',   () => _switchTab(el, 'floor'));
    el.querySelector('#tab-history').addEventListener('click', () => _switchTab(el, 'history'));
    el.querySelector('#add-table-btn').addEventListener('click', () => _openTableModal(el));
    el.querySelector('#download-qr-btn').addEventListener('click', () => {
      if (!_tables.length) { DashUI.toast('No tables to export.', 'error'); return; }
      _downloadQrPdf(_tables);
    });

    _elClickHandler = e => {
      // History bill button
      const hBtn = e.target.closest('[data-action="history-bill"]');
      if (hBtn) { _showBill(el, hBtn.dataset.sessionId); return; }
      _handleGridClick(el, e);
    };
    el.addEventListener('click', _elClickHandler);
    _elCtaHandler = () => _openTableModal(el);
    el.addEventListener('cta', _elCtaHandler);

    _load(el);

    _pollTimer = setInterval(() => {
      if (el.isConnected) {
        if (_activeTab === 'floor' && !_loadError) _load(el);
      } else { clearInterval(_pollTimer); _pollTimer = null; }
    }, 15000);

    const observer = new MutationObserver(() => {
      if (!el.isConnected) {
        clearInterval(_pollTimer); _pollTimer = null;
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  return { init };
})();
