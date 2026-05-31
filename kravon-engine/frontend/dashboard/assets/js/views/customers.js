'use strict';

const CustomersView = (() => {

  let _state = { page: 1, search: '' };

  function _fmt(n) { return n ? '₹ ' + Number(n).toLocaleString('en-IN') : '—'; }

  function _date(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
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
                if (!saveBtn) return;
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
        <span class="order-item-name">#${o.id.slice(-6).toUpperCase()} · ${o.fulfillment_type?.replace(/_/g,' ')} · ${o.status}</span>
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
      </div>`;
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
