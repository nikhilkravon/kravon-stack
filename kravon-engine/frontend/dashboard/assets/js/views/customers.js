'use strict';

const CustomersView = (() => {

  let _state = { page: 1, search: '' };

  function _fmt(n) { return n ? '₹ ' + Number(n).toLocaleString('en-IN') : '—'; }

  function _date(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // Same vocabulary as Orders/Home — plain labels, not raw fulfillment_type/status.
  const FULFILLMENT_LABEL = {
    dine_in:  'Dine-in',
    delivery: 'Delivery',
    pickup:   'Pickup',
    catering: 'Catering',
  };

  const STATUS_LABEL = {
    pending:          'Pending',
    confirmed:        'Confirmed',
    preparing:        'Preparing',
    ready:            'Ready',
    out_for_delivery: 'Out for delivery',
    delivered:        'Delivered',
    completed:        'Completed',
    cancelled:        'Cancelled',
    refunded:         'Refunded',
  };

  function _can(...roles) {
    const staffRoles = Auth.state()?.staff?.roles || [];
    return roles.some(r => staffRoles.includes(r));
  }

  async function _load(el) {
    const tbody = el.querySelector('#customers-tbody');
    const info  = el.querySelector('#customers-count');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="6"><div class="skeleton skeleton-line" style="margin:12px 0"></div></td></tr>`;

    try {
      const params = new URLSearchParams({ page: _state.page, limit: 25 });
      if (_state.search) params.set('search', _state.search);
      const data      = await Api.rGet(`/customers?${params}`);
      const customers = data.customers || [];

      if (info) info.textContent = `${data.total || 0} customers`;

      if (!customers.length) {
        tbody.innerHTML = `<tr><td colspan="6">${DashUI.emptyState({
          icon:  '👤',
          title: _state.search ? 'No customers match' : 'No customers yet',
          body:  _state.search ? 'Try a different name, phone, or email.' : 'Customers are created automatically when orders are placed.',
        })}</td></tr>`;
        return;
      }

      tbody.innerHTML = customers.map(c => `
        <tr class="customer-row" data-id="${c.id}" style="cursor:pointer">
          <td>
            <div style="font-weight:500">${c.name || '—'}</div>
            ${c.email ? `<div class="text-sm text-muted">${c.email}</div>` : ''}
          </td>
          <td class="text-sm">${c.phone || '—'}</td>
          <td style="font-weight:600">${c.order_count || 0}</td>
          <td class="text-sm">${_fmt(c.total_spent)}</td>
          <td class="td-muted">${_date(c.last_order_at)}</td>
          <td class="td-muted">${_date(c.created_at)}</td>
        </tr>
        <tr class="order-detail-row" data-for="${c.id}">
          <td colspan="6">
            <div class="order-detail" id="cust-detail-${c.id}">
              <div class="order-detail-loading text-sm text-muted">Loading history…</div>
            </div>
          </td>
        </tr>`).join('');

      const prevBtn = el.querySelector('#cust-prev');
      const nextBtn = el.querySelector('#cust-next');
      if (prevBtn) prevBtn.disabled = _state.page <= 1;
      if (nextBtn) nextBtn.disabled = _state.page >= (data.pages || 1);

      el.querySelectorAll('.customer-row').forEach(row => {
        row.addEventListener('click', async () => {
          const id        = row.dataset.id;
          const detailRow = el.querySelector(`.order-detail-row[data-for="${id}"]`);
          if (!detailRow) return;
          const isOpen = detailRow.classList.contains('open');
          el.querySelectorAll('.order-detail-row').forEach(r => r.classList.remove('open'));
          if (isOpen) return;
          detailRow.classList.add('open');

          const inner = document.getElementById(`cust-detail-${id}`);
          if (inner?.querySelector('.order-detail-loading')) {
            try {
              const d = await Api.rGet(`/customers/${id}`);
              inner.innerHTML = _renderCustomerDetail(d.customer, d.orders);
              inner.addEventListener('click', async e => {
                const saveBtn = e.target.closest('[data-action="save-notes"]');
                if (saveBtn) {
                  const ta = inner.querySelector('textarea[name="notes"]');
                  if (!ta) return;
                  saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
                  try {
                    await Api.rPatch(`/customers/${id}`, { notes: ta.value });
                    DashUI.toast('Notes saved.', 'success');
                  } catch (err) {
                    DashUI.toast('Could not save notes.', 'error');
                  } finally {
                    saveBtn.disabled = false; saveBtn.textContent = 'Save notes';
                  }
                  return;
                }

                const exportBtn = e.target.closest('[data-action="export-data"]');
                if (exportBtn) { _handleExportData(inner, id, exportBtn); return; }

                const deleteBtn = e.target.closest('[data-action="request-deletion"]');
                if (deleteBtn) { _handleRequestDeletion(inner, id, deleteBtn); return; }
              });
            } catch (err) {
              if (inner) inner.innerHTML = `<div class="text-sm text-muted">Could not load history.</div>`;
            }
          }
        });
      });

    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6">${DashUI.errorState(err.message)}</td></tr>`;
    }
  }

  function _renderCustomerDetail(customer, orders) {
    const orderRows = (orders || []).map(o => `
      <div class="order-item-line">
        <span class="order-item-name">${FULFILLMENT_LABEL[o.fulfillment_type] || (o.fulfillment_type || '').replace(/_/g,' ')} · ${STATUS_LABEL[o.status] || o.status} · ${_date(o.created_at)}</span>
        <span class="order-item-price">₹ ${Number(o.total_amount).toLocaleString('en-IN')}</span>
      </div>`).join('');

    return `
      <div class="order-detail-grid">
        ${customer.phone ? `<div><span class="detail-label">Phone</span> ${customer.phone}</div>` : ''}
        ${customer.email ? `<div><span class="detail-label">Email</span> ${customer.email}</div>` : ''}
        ${(customer.dietary_pref || []).length ? `<div><span class="detail-label">Dietary</span> ${customer.dietary_pref.join(', ')}</div>` : ''}
        ${(customer.tags || []).length ? `<div><span class="detail-label">Tags</span> ${customer.tags.join(', ')}</div>` : ''}
      </div>
      ${orderRows ? `<div class="order-items-list" style="margin-bottom:var(--sp-3)">${orderRows}</div>` : ''}
      <div style="display:flex;flex-direction:column;gap:var(--sp-2)">
        <label class="text-sm" style="color:var(--gray-500);font-weight:600">Notes</label>
        <textarea name="notes" rows="2" style="width:100%;background:var(--gray-50);border:1px solid var(--gray-200);border-radius:var(--radius);padding:8px 10px;font-size:13px;resize:vertical">${customer.notes || ''}</textarea>
        <div><button class="btn btn-secondary btn-sm" data-action="save-notes">Save notes</button></div>
      </div>
      ${_can('owner', 'admin') ? _renderPrivacySection(customer) : ''}`;
  }

  // Owner/admin-only DPDP tooling — mirrors the backend's requireRole('owner','admin')
  // gate on /export, /delete-request, /correct. These three endpoints exist server-side
  // with no UI at all until now.
  function _renderPrivacySection(customer) {
    return `
      <div style="margin-top:var(--sp-4);padding-top:var(--sp-3);border-top:1px solid var(--gray-100)">
        <label class="text-sm" style="color:var(--gray-500);font-weight:600">Data &amp; privacy</label>
        <div style="display:flex;gap:var(--sp-2);margin-top:var(--sp-2)">
          <button class="btn btn-secondary btn-sm" data-action="export-data">Export data</button>
          <button class="btn btn-secondary btn-sm" data-action="request-deletion" style="color:var(--red-600)">Request deletion</button>
        </div>
        <div class="privacy-status text-sm text-muted" style="margin-top:var(--sp-2)"></div>
      </div>`;
  }

  async function _handleExportData(inner, id, btn) {
    const status = inner.querySelector('.privacy-status');
    btn.disabled = true; btn.textContent = 'Exporting…';
    try {
      const data = await Api.rGet(`/customers/${id}/export`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = `customer-data-${(data.profile?.name || id).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      if (status) status.textContent = `Exported ${_date(data.exportedAt)}.`;
    } catch (err) {
      DashUI.toast('Could not export data. ' + err.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Export data';
    }
  }

  async function _handleRequestDeletion(inner, id, btn) {
    const ok = await DashUI.confirm(
      'This starts a data-deletion request for this customer. It cannot be undone once processed.',
      { title: 'Request deletion', confirmLabel: 'Request Deletion', danger: true }
    );
    if (!ok) return;

    const status = inner.querySelector('.privacy-status');
    btn.disabled = true; btn.textContent = 'Requesting…';
    try {
      await Api.rPost(`/customers/${id}/delete-request`, {});
      if (status) status.textContent = 'Deletion requested — pending processing.';
      DashUI.toast('Deletion request submitted.', 'success');
      btn.textContent = 'Requested';
    } catch (err) {
      DashUI.toast('Could not submit deletion request. ' + err.message, 'error');
      btn.disabled = false; btn.textContent = 'Request deletion';
    }
  }

  function init(el) {
    _state = { page: 1, search: '' };

    el.innerHTML = `
      <div class="card">
        <div class="card-header">
          <input id="cust-search" class="search-input" type="search" placeholder="Search name, phone or email…">
          <span id="customers-count" class="text-sm text-muted"></span>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Customer</th><th>Phone</th><th>Orders</th>
                <th>Total spent</th><th>Last order</th><th>Since</th>
              </tr>
            </thead>
            <tbody id="customers-tbody"></tbody>
          </table>
        </div>
        <div class="pagination">
          <span></span>
          <div class="pagination-btns">
            <button id="cust-prev" class="btn btn-secondary btn-sm">← Prev</button>
            <button id="cust-next" class="btn btn-secondary btn-sm">Next →</button>
          </div>
        </div>
      </div>`;

    let _searchTimer;
    el.querySelector('#cust-search').addEventListener('input', e => {
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(() => {
        _state.search = e.target.value;
        _state.page   = 1;
        _load(el);
      }, 300);
    });

    el.querySelector('#cust-prev').addEventListener('click', () => { _state.page--; _load(el); });
    el.querySelector('#cust-next').addEventListener('click', () => { _state.page++; _load(el); });

    _load(el);
  }

  return { init };
})();
