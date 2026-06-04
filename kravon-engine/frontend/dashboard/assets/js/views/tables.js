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
    return `
      <div class="table-card table-card--${t.status}${urgency ? ' ' + urgency : ''}" data-table-id="${t.id}">
        <div class="table-card-header">
          <span class="table-card-name">${t.name}</span>
          <span class="table-card-cap">${t.capacity || '—'} pax</span>
        </div>
        ${badge}
        ${session ? `
          <div class="table-session-info">
            <div class="table-session-row">
              <span class="detail-label">Open</span> ${_dur(session.opened_at)} ${urgencyLabel}
            </div>
            <div class="table-session-row">
              <span class="detail-label">Total</span> ${_fmt(session.total)}
            </div>
          </div>
          <div class="table-card-actions">
            <button class="btn btn-danger btn-sm" data-action="close-session" data-session-id="${session.id}" data-table="${t.name}">Close session</button>
            <button class="btn btn-ghost btn-sm" data-action="view-bill" data-session-id="${session.id}">View bill</button>
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

  async function _load(el) {
    const grid = el.querySelector('#tables-grid');
    if (!grid) return;
    grid.innerHTML = `<div class="skeleton" style="height:120px;border-radius:var(--radius-lg)"></div>`.repeat(4);

    try {
      const data   = await Api.rGet('/tables');
      const tables = data.tables || [];

      if (!tables.length) {
        grid.innerHTML = DashUI.emptyState({
          icon:  '🪑',
          title: 'No tables yet',
          body:  'Add your first table to start managing dine-in sessions.',
          cta:   '+ Add table',
        });
        grid.querySelector('.btn')?.addEventListener('click', () => _openTableModal());
        return;
      }

      grid.innerHTML = tables.map(_tableCard).join('');

      // Event delegation
      grid.addEventListener('click', async e => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;

        if (action === 'open-session') {
          // Inline covers form inside the card
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
        }

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

        if (action === 'view-bill') {
          _showBill(el, btn.dataset.sessionId);
        }

        if (action === 'show-qr') {
          _showQr(btn.dataset.tableId, btn.dataset.tableName);
        }

        if (action === 'edit-table') {
          const tableData = tables.find(t => t.id === btn.dataset.tableId);
          _openTableModal(tableData);
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
      });

    } catch (err) {
      grid.innerHTML = DashUI.errorState(err.message);
    }
  }

  // ── Bill modal ────────────────────────────────────────────────────────────
  async function _showBill(el, sessionId) {
    try {
      const data = await Api.rGet(`/dine-in/bill?session_id=${sessionId}`);
      const bill = data.bill;
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

      document.body.insertAdjacentHTML('beforeend', `
        <div class="modal-overlay" id="bill-modal">
          <div class="modal" style="max-width:440px">
            <div class="modal-header">
              <span class="modal-title">Bill — ${bill.table_name}</span>
              <button class="modal-close" id="bill-modal-close">✕</button>
            </div>
            <div class="modal-body">
              <div style="font-size:12px;color:var(--gray-500);margin-bottom:var(--sp-4)">
                ${bill.covers ? `${bill.covers} covers · ` : ''}Opened ${_dur(bill.opened_at)} ago
              </div>
              ${ordersHtml}
              <div class="cart-total-line" style="margin-top:var(--sp-4)">
                <span class="cart-total-label">Grand Total</span>
                <span class="cart-total-val">${_fmt(bill.grand_total)}</span>
              </div>
            </div>
          </div>
        </div>`);

      const overlay = document.getElementById('bill-modal');
      overlay.querySelector('#bill-modal-close').onclick = () => overlay.remove();
      overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    } catch (err) {
      DashUI.toast('Could not load bill. ' + err.message, 'error');
    }
  }

  // ── QR modal ──────────────────────────────────────────────────────────────
  function _showQr(tableId, tableName) {
    const slug    = Auth.state().slug;
    const base    = window.KRAVON_FRONTEND_BASE || 'http://localhost:8000';
    const qrUrl   = `${base}/tables/?slug=${encodeURIComponent(slug)}&table_id=${tableId}`;
    const qrSrc   = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(qrUrl)}`;

    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal-overlay" id="qr-modal">
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
        </div>
      </div>`);

    const overlay = document.getElementById('qr-modal');
    overlay.querySelector('#qr-modal-close').onclick = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  }

  // ── Add/Edit table modal ──────────────────────────────────────────────────
  function _openTableModal(table = null) {
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
        // Reload the tables view
        const content = document.getElementById('dash-content');
        if (content) TablesView.init(content);
      } catch (ex) {
        err.textContent = ex.message; err.hidden = false;
        btn.disabled = false; btn.textContent = 'Save';
      }
    };
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  let _pollTimer = null;

  function init(el) {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }

    el.innerHTML = `
      <div class="toolbar">
        <div class="toolbar-left">
          <span class="text-sm text-muted" id="tables-count"></span>
        </div>
        <div class="toolbar-right">
          <button id="add-table-btn" class="btn btn-primary">+ Add table</button>
        </div>
      </div>
      <div id="tables-grid" class="tables-grid"></div>`;

    el.querySelector('#add-table-btn').addEventListener('click', () => _openTableModal());
    _load(el);

    _pollTimer = setInterval(() => {
      // Silent refresh — only re-render if grid is still mounted
      if (el.isConnected) _load(el);
      else { clearInterval(_pollTimer); _pollTimer = null; }
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
