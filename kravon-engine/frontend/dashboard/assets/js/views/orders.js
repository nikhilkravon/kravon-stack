'use strict';

const OrdersView = (() => {

  let _state       = { tab: 'all', page: 1, search: '' };
  let _pollTimer   = null;
  let _lastCount   = null;
  let _newCount    = 0;       // cumulative unseen new orders since last badge clear
  let _expandedId  = null;    // order id whose detail row is currently open
  const _origTitle = document.title;
  let _alertsEnabled = false; // user must gesture to unlock audio

  function _pingAudio() {
    try {
      const ctx  = new (window.AudioContext || window.webkitAudioContext)();
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type      = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(660, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.5);
    } catch (_) { /* audio unavailable */ }
  }

  function _pushNotification(count) {
    if (Notification.permission !== 'granted') return;
    new Notification(`${count} new order${count > 1 ? 's' : ''} — Kravon`, {
      body: 'New orders have arrived. Check your dashboard.',
      icon: '/favicon.ico',
    });
  }

  // Order domain: status transitions per fulfillment_type
  // Kitchen owns confirmed→preparing→ready; Orders view owns the rest
  const STATUS_NEXT_DELIVERY = {
    pending:          ['confirmed', 'cancelled'],
    confirmed:        ['preparing', 'cancelled'],
    preparing:        ['ready'],
    ready:            ['out_for_delivery'],
    out_for_delivery: ['completed'],
  };

  const STATUS_NEXT_PICKUP = {
    pending:          ['confirmed', 'cancelled'],
    confirmed:        ['preparing', 'cancelled'],
    preparing:        ['ready'],
    ready:            ['completed'],
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
    if (fulfillmentType === 'delivery') return STATUS_NEXT_DELIVERY;
    if (fulfillmentType === 'pickup')   return STATUS_NEXT_PICKUP;
    if (fulfillmentType === 'catering') return STATUS_NEXT_CATERING;
    return STATUS_NEXT_DINE_IN;
  }

  const ACTION_LABELS = {
    confirmed:        'Confirm',
    preparing:        'Start Preparing',
    ready:            'Mark Ready',
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

  // fulfillment_type labels (primary)
  const FULFILLMENT_LABEL = {
    dine_in:  'Dine-in',
    delivery: 'Delivery',
    pickup:   'Pickup',
    catering: 'Catering',
  };

  // channel labels (secondary context, shown when fulfillment_type alone is ambiguous)
  const CHANNEL_LABEL = {
    qr:        'QR',
    web:       'Online',
    whatsapp:  'WhatsApp',
    pos:       'POS',
    phone:     'Phone',
  };

  function _fmt(n) { return '₹ ' + Number(n || 0).toLocaleString('en-IN'); }

  function _ago(iso) {
    const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (diff < 60)    return `${diff}s ago`;
    if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }

  function _isStale(iso, status) {
    const mins = Math.floor((Date.now() - new Date(iso)) / 60000);
    if (['pending', 'confirmed'].includes(status)) return mins >= 15;
    if (status === 'preparing')                    return mins >= 20;
    return false;
  }

  function _badge(s) {
    const cls   = STATUS_BADGE[s]  || 'badge-placed';
    const label = STATUS_LABEL[s]  || s.replace(/_/g, ' ');
    return `<span class="badge ${cls}">${label}</span>`;
  }

  function _channel(o) {
    const type = FULFILLMENT_LABEL[o.fulfillment_type] || (o.fulfillment_type || '').replace(/_/g, ' ');
    const ch   = CHANNEL_LABEL[o.channel];
    return ch ? `${type} · ${ch}` : type || '—';
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

  function _renderDetail(ord, itemsRes) {
    const meta    = ord.metadata || {};
    const address = meta.delivery_address || meta.address || ord.special_instructions || null;
    const items   = itemsRes?.items || [];
    const phone   = ord.customer_phone;

    let html = '<div class="order-detail-grid">';
    if (ord.fulfillment_type) html += `<div><span class="detail-label">Type</span> ${CHANNEL_LABEL[ord.fulfillment_type] || ord.fulfillment_type.replace(/_/g,' ')}</div>`;
    if (ord.channel)          html += `<div><span class="detail-label">Channel</span> ${CHANNEL_LABEL[ord.channel] || ord.channel}</div>`;
    if (address)              html += `<div><span class="detail-label">Address</span> ${address}</div>`;
    if (phone)                html += `<div><span class="detail-label">Phone</span> <a href="tel:${phone}" style="color:inherit">${phone}</a></div>`;
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

  async function _openDetail(el, id) {
    el.querySelectorAll('.order-detail-row').forEach(r => r.classList.remove('open'));
    const detailRow = el.querySelector(`.order-detail-row[data-for="${id}"]`);
    if (!detailRow) return;
    detailRow.classList.add('open');
    _expandedId = id;

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
  }

  async function _load(el) {
    const tbody = el.querySelector('#orders-tbody');
    const info  = el.querySelector('#orders-page-info');
    if (!tbody) return;

    // Don't skeleton-flash on background polls — only on tab/page change
    const isBackground = _lastCount !== null;
    if (!isBackground) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="skeleton skeleton-line" style="margin:12px 0"></div></td></tr>`;
    }

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

        // Re-expand previously open row after reload
        if (_expandedId && el.querySelector(`.order-detail-row[data-for="${_expandedId}"]`)) {
          _openDetail(el, _expandedId);
        }
      }

      const total = data.total || 0;
      const pages = data.pages || 1;
      if (info) info.textContent = `${total} order${total !== 1 ? 's' : ''}`;
      const prevBtn = el.querySelector('#orders-prev');
      const nextBtn = el.querySelector('#orders-next');
      if (prevBtn) prevBtn.disabled = _state.page <= 1;
      if (nextBtn) nextBtn.disabled = _state.page >= pages;

      // New-order detection: accumulate count, badge stays until manually cleared
      if (_lastCount !== null && total > _lastCount && _state.tab !== 'completed' && _state.tab !== 'cancelled') {
        const diff = total - _lastCount;
        _newCount += diff;
        document.title = `(${_newCount}) New Order${_newCount > 1 ? 's' : ''} — Kravon`;
        const badgeEl = el.querySelector('#orders-new-badge');
        if (badgeEl) {
          badgeEl.textContent = `+${_newCount} new`;
          badgeEl.style.display = '';
        }
        if (_alertsEnabled) _pingAudio();
        _pushNotification(diff);
      }
      _lastCount = total;

      // Row expand/collapse
      el.querySelectorAll('.order-main-row').forEach(row => {
        row.addEventListener('click', async (e) => {
          if (e.target.closest('button')) return;
          const id = row.dataset.id;
          if (_expandedId === id) {
            el.querySelectorAll('.order-detail-row').forEach(r => r.classList.remove('open'));
            _expandedId = null;
            return;
          }
          _openDetail(el, id);
        });
      });

      // Action buttons
      el.querySelectorAll('.order-action').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (btn.dataset.status === 'cancelled') {
            if (!confirm('Cancel this order? This cannot be undone.')) return;
          }
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

  function init(el) {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
    _state      = { tab: 'all', page: 1, search: '' };
    _lastCount  = null;
    _newCount   = 0;
    _expandedId = null;

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
            <button id="orders-new-badge" class="badge badge-placed" style="display:none;cursor:pointer" title="Click to dismiss">+0 new</button>
            <button id="orders-notify-btn" class="btn btn-secondary btn-sm" title="Enable sound and browser notifications for new orders">🔔 Enable alerts</button>
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

    // Clicking the badge clears it
    el.querySelector('#orders-new-badge').addEventListener('click', () => {
      _newCount = 0;
      document.title = _origTitle;
      const badgeEl = el.querySelector('#orders-new-badge');
      if (badgeEl) badgeEl.style.display = 'none';
    });

    // Enable alerts button — requires user gesture to unlock AudioContext
    el.querySelector('#orders-notify-btn').addEventListener('click', async () => {
      _alertsEnabled = true;
      _pingAudio(); // unlock audio context with user gesture
      if ('Notification' in window && Notification.permission === 'default') {
        await Notification.requestPermission();
      }
      const btn = el.querySelector('#orders-notify-btn');
      if (btn) { btn.textContent = '🔔 Alerts on'; btn.disabled = true; }
    });

    el.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        el.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        _state.tab  = tab.dataset.tab;
        _state.page = 1;
        _expandedId = null;
        _load(el);
      });
    });

    let _searchTimer;
    el.querySelector('#orders-search').addEventListener('input', e => {
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(() => {
        _state.search = e.target.value;
        _state.page   = 1;
        _expandedId   = null;
        _load(el);
      }, 300);
    });

    el.querySelector('#orders-prev').addEventListener('click', () => { _state.page--; _expandedId = null; _load(el); });
    el.querySelector('#orders-next').addEventListener('click', () => { _state.page++; _expandedId = null; _load(el); });

    _load(el);

    _pollTimer = setInterval(() => _load(el), 10000);

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
