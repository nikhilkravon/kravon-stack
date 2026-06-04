'use strict';

const OrdersView = (() => {

  let _state     = { tab: 'all', page: 1, search: '' };
  let _pollTimer = null;
  let _lastCount = null; // last known total order count for new-order detection
  const _origTitle = document.title;

  // State machines per fulfillment type — delivery is the only one with out_for_delivery.
  const STATUS_NEXT_DELIVERY = {
    pending:          ['confirmed', 'cancelled'],
    confirmed:        ['preparing', 'cancelled'],
    preparing:        ['ready'],
    ready:            ['out_for_delivery'],
    out_for_delivery: ['completed'],
  };

  const STATUS_NEXT_DINE_IN = {
    pending:          ['confirmed', 'cancelled'],
    confirmed:        ['preparing', 'cancelled'],
    preparing:        ['ready'],
    ready:            ['completed'],
  };

  const STATUS_NEXT_CATERING = {
    pending:          ['confirmed', 'cancelled'],
    confirmed:        ['completed', 'cancelled'],
  };

  function _statusNext(fulfillmentType) {
    if (fulfillmentType === 'delivery')        return STATUS_NEXT_DELIVERY;
    if (fulfillmentType === 'catering')        return STATUS_NEXT_CATERING;
    // dine_in, pickup, qr, or anything else — no out_for_delivery
    return STATUS_NEXT_DINE_IN;
  }

  const ACTION_LABELS = {
    confirmed:        'Accept',
    preparing:        'Preparing',
    ready:            'Ready',
    out_for_delivery: 'Out for Delivery',
    completed:        'Complete',
    cancelled:        'Cancel',
  };

  const ACTION_STYLE = {
    confirmed:        'btn-primary',
    preparing:        'btn-primary',
    ready:            'btn-primary',
    out_for_delivery: 'btn-primary',
    completed:        'btn-primary',
    cancelled:        'btn-danger',
  };

  const STATUS_BADGE = {
    pending:          'badge-placed',
    confirmed:        'badge-preparing',
    preparing:        'badge-preparing',
    ready:            'badge-ready',
    out_for_delivery: 'badge-preparing',
    delivered:        'badge-delivered',
    completed:        'badge-delivered',
    cancelled:        'badge-cancelled',
    refunded:         'badge-cancelled',
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

  const CHANNEL_LABEL = {
    dine_in:  'Dine-in',
    delivery: 'Delivery',
    pickup:   'Pickup',
    catering: 'Catering',
    dine_in_takeaway: 'Takeaway',
    qr:       'QR Table',
    web:      'Online',
    whatsapp: 'WhatsApp',
    pos:      'POS',
    phone:    'Phone',
  };

  function _fmt(n)   { return '₹ ' + Number(n || 0).toLocaleString('en-IN'); }

  function _ago(iso) {
    const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (diff < 60)    return `${diff}s ago`;
    if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }

  function _isStale(iso, status) {
    if (!['pending', 'confirmed'].includes(status)) return false;
    const mins = Math.floor((Date.now() - new Date(iso)) / 60000);
    return mins >= 15;
  }

  function _badge(s) {
    const cls   = STATUS_BADGE[s]  || 'badge-placed';
    const label = STATUS_LABEL[s]  || s.replace(/_/g, ' ');
    return `<span class="badge ${cls}">${label}</span>`;
  }

  function _channel(o) {
    const key = o.fulfillment_type || o.channel || '';
    return CHANNEL_LABEL[key] || key.replace(/_/g, ' ') || '—';
  }

  function _actionButtons(o) {
    const machine = _statusNext(o.fulfillment_type);
    const nexts   = machine[o.status];
    if (!nexts) return '';
    return nexts.map(s =>
      `<button class="btn ${ACTION_STYLE[s]} btn-sm order-action"
         data-id="${o.id}" data-status="${s}">${ACTION_LABELS[s]}</button>`
    ).join(' ');
  }

  function _tabStatus(tab) {
    if (tab === 'live')      return 'live';
    if (tab === 'completed') return 'completed';
    if (tab === 'cancelled') return 'cancelled';
    return null;
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
      let orders = (data.orders || []).filter(o => {
        if (!_state.search) return true;
        const s = _state.search.toLowerCase();
        return (o.customer_name  || '').toLowerCase().includes(s) ||
               (o.customer_phone || '').includes(s);
      });

      if (!orders.length) {
        tbody.innerHTML = `
          <tr><td colspan="7">
            ${DashUI.emptyState({
              icon:  '🛍',
              title: _state.search ? 'No orders match your search' : 'No orders here yet',
              body:  _state.search ? 'Try a different name or phone number.' : 'Orders will appear here when customers place them.',
            })}
          </td></tr>`;
      } else {
        tbody.innerHTML = orders.map(o => {
          const stale = _isStale(o.created_at, o.status);
          const timeCell = stale
            ? `<td class="td-muted" style="color:var(--amber-600,#e8a020);font-weight:600">${_ago(o.created_at)} ⚠</td>`
            : `<td class="td-muted">${_ago(o.created_at)}</td>`;
          return `
          <tr class="order-main-row${stale ? ' order-row--stale' : ''}" data-id="${o.id}" style="cursor:pointer">
            <td class="text-sm text-muted">#${o.id.slice(-6).toUpperCase()}</td>
            <td class="text-sm">${_channel(o)}</td>
            <td>
              <div style="font-weight:500">${o.customer_name || '—'}</div>
              ${o.customer_phone ? `<div class="text-sm text-muted">${o.customer_phone}</div>` : ''}
            </td>
            <td class="text-right" style="font-weight:600">${_fmt(o.total_amount)}</td>
            <td>${_badge(o.status)}</td>
            ${timeCell}
            <td>
              <div class="order-actions">${_actionButtons(o)}</div>
            </td>
          </tr>
          <tr class="order-detail-row" data-for="${o.id}">
            <td colspan="7">
              <div class="order-detail">
                <div class="order-detail-loading text-sm text-muted">Loading items…</div>
              </div>
            </td>
          </tr>`;
        }).join('');
      }

      const total = data.total || 0;
      const pages = data.pages || 1;
      if (info) info.textContent = `${total} order${total !== 1 ? 's' : ''}`;
      const prevBtn = el.querySelector('#orders-prev');
      const nextBtn = el.querySelector('#orders-next');
      if (prevBtn) prevBtn.disabled = _state.page <= 1;
      if (nextBtn) nextBtn.disabled = _state.page >= pages;

      // New-order detection: flash tab title when count grows
      if (_lastCount !== null && total > _lastCount && _state.tab !== 'completed' && _state.tab !== 'cancelled') {
        const diff = total - _lastCount;
        document.title = `🔔 ${diff} New Order${diff > 1 ? 's' : ''} — Kravon`;
        const badgeEl = el.querySelector('#orders-new-badge');
        if (badgeEl) { badgeEl.textContent = `+${diff} new`; badgeEl.style.display = ''; }
        // Reset title after 8 seconds
        setTimeout(() => { document.title = _origTitle; }, 8000);
      }
      _lastCount = total;

      // Expand / collapse detail row on row click
      el.querySelectorAll('.order-main-row').forEach(row => {
        row.addEventListener('click', async (e) => {
          if (e.target.closest('button')) return;
          const id        = row.dataset.id;
          const detailRow = el.querySelector(`.order-detail-row[data-for="${id}"]`);
          if (!detailRow) return;

          const isOpen = detailRow.classList.contains('open');
          el.querySelectorAll('.order-detail-row').forEach(r => r.classList.remove('open'));
          if (isOpen) return;

          detailRow.classList.add('open');

          const inner = detailRow.querySelector('.order-detail');
          if (inner.querySelector('.order-detail-loading')) {
            try {
              const [d, itemsRes] = await Promise.all([
                Api.rGet(`/orders/${id}`),
                Api.rGet(`/orders/${id}/items`).catch(() => null),
              ]);
              inner.innerHTML = _renderDetail(d.order, itemsRes);
            } catch (err) {
              inner.innerHTML = `<div class="text-sm text-muted">Could not load details.</div>`;
            }
          }
        });
      });

      // Action buttons
      el.querySelectorAll('.order-action').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          btn.disabled = true;
          try {
            await Api.rPatch(`/orders/${btn.dataset.id}`, { status: btn.dataset.status });
            _load(el);
          } catch (err) {
            DashUI.toast(`Could not update order status. Please try again.`, 'error');
            btn.disabled = false;
          }
        });
      });

    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7">${DashUI.errorState(err.message)}</td></tr>`;
    }
  }

  function _renderDetail(ord, itemsRes) {
    const meta    = ord.metadata || {};
    const address = meta.delivery_address || meta.address || ord.special_instructions || null;
    const items   = itemsRes?.items || [];

    let html = '<div class="order-detail-grid">';
    if (ord.fulfillment_type) html += `<div><span class="detail-label">Type</span> ${CHANNEL_LABEL[ord.fulfillment_type] || ord.fulfillment_type.replace(/_/g,' ')}</div>`;
    if (ord.channel)          html += `<div><span class="detail-label">Channel</span> ${CHANNEL_LABEL[ord.channel] || ord.channel}</div>`;
    if (address)              html += `<div><span class="detail-label">Address</span> ${address}</div>`;
    const note = ord.special_instructions;
    if (note && note !== address) html += `<div><span class="detail-label">Note</span> ${note}</div>`;
    html += '</div>';

    if (items.length) {
      html += '<div class="order-items-list">';
      items.forEach(it => {
        html += `<div class="order-item-line">
          <span class="order-item-name">${it.item_name} × ${it.quantity}</span>
          <span class="order-item-price">${_fmt(it.total_price)}</span>
        </div>`;
      });
      html += '</div>';
    }

    return html;
  }

  function init(el) {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
    _state     = { tab: 'all', page: 1, search: '' };
    _lastCount = null;

    el.innerHTML = `
      <div class="tab-bar">
        <button class="tab active" data-tab="all">All</button>
        <button class="tab" data-tab="live">Live</button>
        <button class="tab" data-tab="completed">Completed</button>
        <button class="tab" data-tab="cancelled">Cancelled</button>
      </div>
      <div class="card">
        <div class="card-header">
          <input id="orders-search" class="search-input" type="search" placeholder="Search by name or phone…">
          <div style="display:flex;align-items:center;gap:var(--sp-3)">
            <span id="orders-new-badge" class="badge badge-placed" style="display:none"></span>
            <span id="orders-page-info" class="text-sm text-muted"></span>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th><th>Channel</th><th>Customer</th>
                <th class="text-right">Amount</th><th>Status</th>
                <th>Time</th><th>Actions</th>
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
      _searchTimer = setTimeout(() => {
        _state.search = e.target.value;
        _state.page   = 1;
        _load(el);
      }, 300);
    });

    el.querySelector('#orders-prev').addEventListener('click', () => { _state.page--; _load(el); });
    el.querySelector('#orders-next').addEventListener('click', () => { _state.page++; _load(el); });

    _load(el);

    // Auto-refresh every 30 seconds — same pattern as kitchen.js
    _pollTimer = setInterval(() => _load(el), 30000);

    // Stop polling when navigating away
    const observer = new MutationObserver(() => {
      if (!el.isConnected) {
        clearInterval(_pollTimer);
        _pollTimer = null;
        document.title = _origTitle;
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  return { init };
})();
