'use strict';

const OverviewView = (() => {

  function _fmt(n) { return '₹ ' + Number(n || 0).toLocaleString('en-IN'); }

  function _ago(iso) {
    const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (diff < 60)    return `${diff}s ago`;
    if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }

  // Complete status → badge class map covering every possible order status
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
    qr:       'QR Table',
    web:      'Online',
    whatsapp: 'WhatsApp',
    pos:      'POS',
    phone:    'Phone',
  };

  function _statusBadge(s) {
    const cls   = STATUS_BADGE[s]  || 'badge-placed';
    const label = STATUS_LABEL[s]  || s.replace(/_/g, ' ');
    return `<span class="badge ${cls}">${label}</span>`;
  }

  function _channel(o) {
    const key = o.fulfillment_type || o.channel || '';
    return CHANNEL_LABEL[key] || key || '—';
  }

  function _statCards(s) {
    const o     = s.orders    || {};
    const c     = s.customers || {};
    const leads = s.leads     || {};
    return `
      <div class="card" style="margin-bottom:var(--sp-4)">
        <div class="card-header">
          <span class="card-title">Last 30 days</span>
          <a href="#insights" class="btn btn-ghost btn-sm">Full insights →</a>
        </div>
        <div class="stat-grid" style="padding:var(--sp-4);gap:var(--sp-3)">
          <div class="stat-card" style="padding:var(--sp-3)">
            <div class="stat-label">Revenue</div>
            <div class="stat-value" style="font-size:1.6rem">${_fmt(o.gross_revenue)}</div>
            <div class="stat-sub">avg ${_fmt(o.avg_order_value)} / order</div>
          </div>
          <div class="stat-card" style="padding:var(--sp-3)">
            <div class="stat-label">Orders</div>
            <div class="stat-value" style="font-size:1.6rem">${Number(o.total_orders || 0).toLocaleString()}</div>
            <div class="stat-sub">${Number(o.unique_customers || 0).toLocaleString()} new customers</div>
          </div>
          <div class="stat-card" style="padding:var(--sp-3)">
            <div class="stat-label">Repeat customers</div>
            <div class="stat-value" style="font-size:1.6rem">${Number(c.repeat_customers || 0).toLocaleString()}</div>
            <div class="stat-sub">ordered more than once</div>
          </div>
          <div class="stat-card" style="padding:var(--sp-3)">
            <div class="stat-label">Catering leads</div>
            <div class="stat-value" style="font-size:1.6rem">${Number(leads.total_leads || 0).toLocaleString()}</div>
            <div class="stat-sub">${Number(leads.hot || 0)} hot · ${Number(leads.warm || 0)} warm</div>
          </div>
        </div>
      </div>`;
  }

  // ── Needs Attention — derived client-side from data the Kitchen/Orders
  // views already fetch. No new backend concept: just surfaces orders sitting
  // too long in one status, and dine-in tables that asked for the bill.
  const STUCK_AFTER_MINS = { confirmed: 10, preparing: 20 };

  function _attentionItems(kitchenData, ordersData) {
    const items = [];

    const tables = (kitchenData && kitchenData.tables) || [];
    const queue  = (kitchenData && kitchenData.queue)  || [];

    tables.forEach(t => {
      if (t.bill_requested_at) {
        items.push({
          icon:   '🧾',
          text:   `${t.table_name} is waiting for the bill`,
          sub:    _ago(t.bill_requested_at),
          view:   'tables',
        });
      }
      (t.orders || []).forEach(o => _pushIfStuck(items, o, t.table_name));
    });

    queue.forEach(o => _pushIfStuck(items, o, CHANNEL_LABEL[o.fulfillment_type] || 'Order'));

    // Fallback signal from the plain order list in case kitchen data failed to load
    // (e.g. tenant is on a plan without has_tables, so /dine-in/kitchen 403s)
    if (!kitchenData) {
      (ordersData || []).forEach(o => _pushIfStuck(items, o, _channel(o)));
    }

    return items.slice(0, 6);
  }

  // Upper bound on "stuck" — an order sitting in one status for days is almost
  // certainly stale/orphaned test or historical data, not something a staff
  // member should be nudged to act on right now. Past this ceiling it's
  // excluded from Needs Attention entirely rather than showing a nonsensical
  // triple-digit hour count.
  const STUCK_CEILING_MINS = 24 * 60;

  function _pushIfStuck(items, o, label) {
    const threshold = STUCK_AFTER_MINS[o.status];
    if (!threshold) return;
    const mins = Math.floor((Date.now() - new Date(o.created_at)) / 60000);
    if (mins < threshold || mins > STUCK_CEILING_MINS) return;
    const dur = mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
    items.push({
      icon: '⏱',
      text: `${label} order has been ${STATUS_LABEL[o.status].toLowerCase()} for ${dur}`,
      sub:  'Needs a check',
      view: 'kitchen',
    });
  }

  function _attentionPanel(items) {
    if (!items.length) {
      return `
        <div class="card" style="margin-bottom:var(--sp-4)">
          <div class="card-header"><span class="card-title">Needs attention</span></div>
          <div style="padding:var(--sp-4);color:var(--gray-500);font-size:13px">
            All caught up — nothing needs you right now.
          </div>
        </div>`;
    }
    const rows = items.map(i => `
      <a href="#${i.view}" class="attention-row" style="display:flex;align-items:center;gap:var(--sp-3);padding:var(--sp-3) var(--sp-4);text-decoration:none;color:inherit;border-bottom:1px solid var(--gray-100)">
        <span style="font-size:1.1rem">${i.icon}</span>
        <span style="flex:1;font-size:13px;font-weight:500">${i.text}</span>
        <span style="font-size:12px;color:var(--gray-500)">${i.sub}</span>
        <span style="color:var(--gray-400)">→</span>
      </a>`).join('');
    return `
      <div class="card" style="margin-bottom:var(--sp-4)">
        <div class="card-header"><span class="card-title">Needs attention</span></div>
        <div>${rows}</div>
      </div>`;
  }

  function _activityLine(o) {
    const who = (o.metadata && o.metadata.customer_name) || _channel(o);
    if (o.status === 'completed' || o.status === 'delivered') {
      return `${who} — ${_channel(o)} order completed, ${_fmt(o.total_amount)}`;
    }
    if (o.status === 'cancelled' || o.status === 'refunded') {
      return `${who} — ${_channel(o)} order ${STATUS_LABEL[o.status].toLowerCase()}`;
    }
    return `${who} — new ${_channel(o).toLowerCase()} order, ${_fmt(o.total_amount)}`;
  }

  function _recentOrders(orders) {
    if (!orders.length) {
      return DashUI.emptyState({
        icon:    '🛍',
        title:   'No orders yet',
        body:    'Orders placed through your restaurant will appear here.',
      });
    }
    const rows = orders.map(o => `
      <div style="display:flex;align-items:center;gap:var(--sp-3);padding:var(--sp-3) var(--sp-4);border-bottom:1px solid var(--gray-100)">
        <span style="flex:1;font-size:13px">${_activityLine(o)}</span>
        ${_statusBadge(o.status)}
        <span class="text-sm text-muted" style="min-width:56px;text-align:right">${_ago(o.created_at)}</span>
      </div>`).join('');
    return `<div>${rows}</div>`;
  }

  function _tonightPanel(t) {
    const o = t.orders   || {};
    const s = t.sessions || {};
    return `
      <div class="card" style="margin-bottom:var(--sp-4)">
        <div class="card-header">
          <span class="card-title">Tonight</span>
          <span class="text-sm text-muted">since midnight</span>
        </div>
        <div class="stat-grid" style="padding:var(--sp-4);gap:var(--sp-3)">
          <div class="stat-card" style="padding:var(--sp-3)">
            <div class="stat-label">Open tables</div>
            <div class="stat-value" style="font-size:1.6rem">${Number(s.open_tables || 0)}</div>
            <div class="stat-sub">${Number(s.covers || 0)} covers seated</div>
          </div>
          <div class="stat-card" style="padding:var(--sp-3)">
            <div class="stat-label">Live orders</div>
            <div class="stat-value" style="font-size:1.6rem">${Number(o.live_orders || 0)}</div>
            <div class="stat-sub">${Number(o.order_count || 0)} total tonight</div>
          </div>
          <div class="stat-card" style="padding:var(--sp-3)">
            <div class="stat-label">Revenue tonight</div>
            <div class="stat-value" style="font-size:1.6rem">${_fmt(o.revenue)}</div>
            <div class="stat-sub">confirmed orders only</div>
          </div>
        </div>
      </div>`;
  }

  async function init(el) {
    el.innerHTML = `
      <div class="card" style="margin-bottom:var(--sp-4)">
        <div class="card-header"><span class="card-title">Needs attention</span></div>
        <div class="card-body"><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line wide"></div></div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Recent activity</span></div>
        <div class="card-body"><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line wide"></div></div>
      </div>`;

    try {
      const [summary, ordersData, tonight, kitchenData] = await Promise.all([
        Api.rGet('/insights/summary'),
        Api.rGet('/orders?limit=5'),
        Api.rGet('/insights/tonight').catch(() => null),
        Api.rGet('/dine-in/kitchen').catch(() => null),
      ]);

      // The user may have already navigated away while these were in flight —
      // don't stomp whatever view is now showing in the shared content element.
      if (typeof App !== 'undefined' && !App.isCurrentView('overview')) return;

      const attention = _attentionItems(kitchenData, ordersData.orders || []);

      el.innerHTML = `
        ${_attentionPanel(attention)}
        ${tonight ? _tonightPanel(tonight) : ''}
        <div class="card" style="margin-bottom:var(--sp-4)">
          <div class="card-header">
            <span class="card-title">Recent activity</span>
            <a href="#orders" class="btn btn-ghost btn-sm">See all →</a>
          </div>
          ${_recentOrders(ordersData.orders || [])}
        </div>
        ${_statCards(summary)}`;

    } catch (err) {
      if (typeof App !== 'undefined' && !App.isCurrentView('overview')) return;
      console.error('[overview] load failed:', err);
      const errHtml = (typeof DashUI !== 'undefined')
        ? DashUI.errorState(err.message)
        : `<div style="padding:32px;text-align:center;color:#9CA3AF;font-size:13px">Could not load overview. Try refreshing.</div>`;
      el.innerHTML = `
        <div class="card" style="margin-top:var(--sp-4)">
          <div class="card-header"><span class="card-title">Home</span></div>
          ${errHtml}
        </div>`;
    }
  }

  return { init };
})();
