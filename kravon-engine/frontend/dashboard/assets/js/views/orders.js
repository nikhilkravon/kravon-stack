'use strict';

const OrdersView = (() => {

  let _state = { tab: 'all', page: 1, search: '' };

  function _fmt(n)   { return '₹ ' + Number(n || 0).toLocaleString('en-IN'); }
  function _ago(iso) {
    const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (diff < 60)   return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }
  function _badge(s) {
    const live = new Set(['pending','confirmed','preparing','ready','out_for_delivery']);
    const done = new Set(['delivered','completed']);
    const off  = new Set(['cancelled','refunded']);
    const cls  = live.has(s) ? (s === 'confirmed' || s === 'pending' ? 'placed' : 'preparing')
               : done.has(s) ? 'delivered' : off.has(s) ? 'cancelled' : 'pending';
    return `<span class="badge badge-${cls}">${s.replace(/_/g,' ')}</span>`;
  }

  function _surfaceLabel(o) {
    const ft = o.fulfillment_type;
    if (ft === 'dine_in')  return 'Dine-in';
    if (ft === 'pickup')   return 'Pickup';
    if (ft === 'delivery') return 'Delivery';
    if (ft === 'catering') return 'Catering';
    return o.channel || '—';
  }

  // live = in-progress statuses; map tab → ?status= param (single value; use ANY for multi)
  function _tabStatus(tab) {
    const map = { live: 'confirmed', delivered: 'delivered', cancelled: 'cancelled' };
    return map[tab] || null;
  }

  function _buildUrl(tab, page) {
    const params = new URLSearchParams({ page, limit: 25 });
    const status = _tabStatus(tab);
    if (status) params.set('status', status);
    return `/orders?${params}`;
  }

  async function _load(el) {
    const tbody = el.querySelector('#orders-tbody');
    const info  = el.querySelector('#orders-page-info');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="7"><div class="skeleton skeleton-line" style="margin:12px 0"></div></td></tr>`;

    try {
      const data = await Api.rGet(_buildUrl(_state.tab, _state.page));
      const orders = (data.orders || []).filter(o => {
        if (!_state.search) return true;
        const s = _state.search.toLowerCase();
        return (o.customer_name || '').toLowerCase().includes(s) ||
               (o.customer_phone || '').includes(s);
      });

      if (!orders.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No orders found</td></tr>`;
      } else {
        tbody.innerHTML = orders.map(o => `
          <tr>
            <td class="text-sm text-muted">#${o.id.slice(-6).toUpperCase()}</td>
            <td>${_surfaceLabel(o)}</td>
            <td>${o.customer_name || '—'}</td>
            <td>${o.customer_phone || '—'}</td>
            <td class="text-right">${_fmt(o.total_amount)}</td>
            <td>${_badge(o.status)}</td>
            <td class="td-muted">${_ago(o.created_at)}</td>
          </tr>`).join('');
      }

      const total = data.total || 0;
      const pages = data.pages || 1;
      if (info) info.textContent = `${total} order${total !== 1 ? 's' : ''}`;
      const prevBtn = el.querySelector('#orders-prev');
      const nextBtn = el.querySelector('#orders-next');
      if (prevBtn) prevBtn.disabled = _state.page <= 1;
      if (nextBtn) nextBtn.disabled = _state.page >= pages;

    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Error: ${err.message}</td></tr>`;
    }
  }

  function init(el) {
    _state = { tab: 'all', page: 1, search: '' };

    el.innerHTML = `
      <div class="tab-bar">
        <button class="tab active" data-tab="all">All</button>
        <button class="tab" data-tab="live">Live</button>
        <button class="tab" data-tab="delivered">Delivered</button>
        <button class="tab" data-tab="cancelled">Cancelled</button>
      </div>
      <div class="card">
        <div class="card-header">
          <input id="orders-search" class="search-input" type="search" placeholder="Search name or phone…">
          <span id="orders-page-info" class="text-sm text-muted"></span>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th><th>Surface</th><th>Customer</th><th>Phone</th>
                <th class="text-right">Amount</th><th>Status</th><th>Time</th>
              </tr>
            </thead>
            <tbody id="orders-tbody"></tbody>
          </table>
        </div>
        <div class="pagination">
          <span></span>
          <div class="pagination-btns">
            <button id="orders-prev" class="btn btn-secondary btn-sm">← Prev</button>
            <button id="orders-next" class="btn btn-secondary btn-sm">Next →</button>
          </div>
        </div>
      </div>`;

    el.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        el.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        _state.tab  = tab.dataset.tab;
        _state.page = 1;
        _load(el);
      });
    });

    let _searchTimer;
    el.querySelector('#orders-search').addEventListener('input', e => {
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(() => { _state.search = e.target.value; _state.page = 1; _load(el); }, 300);
    });

    el.querySelector('#orders-prev').addEventListener('click', () => { _state.page--; _load(el); });
    el.querySelector('#orders-next').addEventListener('click', () => { _state.page++; _load(el); });

    _load(el);
  }

  return { init };
})();
