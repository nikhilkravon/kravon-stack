'use strict';

const OverviewView = (() => {

  function _fmt(n) { return '₹ ' + Number(n || 0).toLocaleString('en-IN'); }
  function _ago(iso) {
    const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (diff < 60)  return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  }

  function _statusBadge(s) {
    const map = { placed: 'placed', preparing: 'preparing', delivered: 'delivered', cancelled: 'cancelled' };
    return `<span class="badge badge-${map[s] || 'pending'}">${s}</span>`;
  }

  function _statCards(s, r) {
    const o  = s.orders  || {};
    const c  = s.customers || {};
    const leads = s.leads || {};
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
    if (!orders.length) return `<div class="empty-state">No orders yet</div>`;
    const rows = orders.map(o => `
      <tr>
        <td>#${o.id.slice(-6).toUpperCase()}</td>
        <td>${o.fulfillment_type === 'dine_in' ? 'Dine-in' : o.fulfillment_type === 'delivery' ? 'Delivery' : (o.fulfillment_type || o.channel || '—')}</td>
        <td>${_fmt(o.total_amount)}</td>
        <td>${_statusBadge(o.status)}</td>
        <td class="td-muted">${_ago(o.created_at)}</td>
        <td><button class="btn btn-ghost btn-sm" data-order-id="${o.id}">Details</button></td>
      </tr>`).join('');
    return `
      <div class="table-wrap">
        <table>
          <thead><tr><th>#</th><th>Surface</th><th>Amount</th><th>Status</th><th>Time</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  async function init(el) {
    el.innerHTML = `
      <div class="stat-grid">
        ${[1,2,3,4].map(() => `<div class="stat-card"><div class="skeleton skeleton-line wide"></div><div class="skeleton skeleton-line short" style="height:28px;margin-top:4px"></div></div>`).join('')}
      </div>
      <div class="card"><div class="card-body"><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line wide"></div></div></div>`;

    try {
      const [summary, ordersData] = await Promise.all([
        Api.rGet('/insights/summary'),
        Api.rGet('/orders?limit=5'),
      ]);

      el.innerHTML = `
        ${_statCards(summary, ordersData)}
        <div class="card">
          <div class="card-header">
            <span class="card-title">Recent orders</span>
            <a href="#orders" class="btn btn-ghost btn-sm">See all →</a>
          </div>
          ${_recentOrders(ordersData.orders || [])}
        </div>`;

      el.querySelector('.card')?.addEventListener('click', e => {
        const btn = e.target.closest('[data-order-id]');
        if (btn) App.navigate('orders');
      });

    } catch (err) {
      el.innerHTML = `<div class="empty-state">Failed to load overview: ${err.message}</div>`;
    }
  }

  return { init };
})();
