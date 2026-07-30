'use strict';

const OverviewView = (() => {

  function _fmt(n) { return '₹ ' + Number(n || 0).toLocaleString('en-IN'); }

  function _ago(iso) {
    const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (diff < 60)   return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
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
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">Revenue (30d)</div>
          <div class="stat-value">${_fmt(o.gross_revenue)}</div>
          <div class="stat-sub">avg ${_fmt(o.avg_order_value)} / order</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Orders (30d)</div>
          <div class="stat-value">${Number(o.total_orders || 0).toLocaleString()}</div>
          <div class="stat-sub">${Number(o.unique_customers || 0).toLocaleString()} unique customers</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Repeat customers</div>
          <div class="stat-value">${Number(c.repeat_customers || 0).toLocaleString()}</div>
          <div class="stat-sub">ordered more than once</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Catering leads (30d)</div>
          <div class="stat-value">${Number(leads.total_leads || 0).toLocaleString()}</div>
          <div class="stat-sub">${Number(leads.hot || 0)} hot · ${Number(leads.warm || 0)} warm</div>
        </div>
      </div>`;
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
      <tr>
        <td class="text-sm text-muted">#${o.id.slice(-6).toUpperCase()}</td>
        <td class="text-sm">${_channel(o)}</td>
        <td style="font-weight:500">${_fmt(o.total_amount)}</td>
        <td>${_statusBadge(o.status)}</td>
        <td class="td-muted">${_ago(o.created_at)}</td>
      </tr>`).join('');
    return `
      <div class="table-wrap">
        <table>
          <thead><tr><th>#</th><th>Channel</th><th>Amount</th><th>Status</th><th>Time</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
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
      <div class="stat-grid">
        ${[1,2,3,4].map(() => `
          <div class="stat-card">
            <div class="skeleton skeleton-line short" style="margin-bottom:var(--sp-2)"></div>
            <div class="skeleton skeleton-line wide" style="height:28px"></div>
          </div>`).join('')}
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Recent orders</span></div>
        <div class="card-body"><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line wide"></div></div>
      </div>`;

    try {
      const [summary, ordersData, tonight] = await Promise.all([
        Api.rGet('/insights/summary'),
        Api.rGet('/orders?limit=5'),
        Api.rGet('/insights/tonight').catch(() => null),
      ]);

      // The user may have already navigated away while these were in flight —
      // don't stomp whatever view is now showing in the shared content element.
      if (typeof App !== 'undefined' && !App.isCurrentView('overview')) return;

      el.innerHTML = `
        ${tonight ? _tonightPanel(tonight) : ''}
        ${_statCards(summary)}
        <div class="card">
          <div class="card-header">
            <span class="card-title">Recent orders</span>
            <a href="#orders" class="btn btn-ghost btn-sm">See all →</a>
          </div>
          ${_recentOrders(ordersData.orders || [])}
        </div>`;

    } catch (err) {
      if (typeof App !== 'undefined' && !App.isCurrentView('overview')) return;
      console.error('[overview] load failed:', err);
      const errHtml = (typeof DashUI !== 'undefined')
        ? DashUI.errorState(err.message)
        : `<div style="padding:32px;text-align:center;color:#9CA3AF;font-size:13px">Could not load overview. Try refreshing.</div>`;
      el.innerHTML = `
        <div class="card" style="margin-top:var(--sp-4)">
          <div class="card-header"><span class="card-title">Overview</span></div>
          ${errHtml}
        </div>`;
    }
  }

  return { init };
})();
