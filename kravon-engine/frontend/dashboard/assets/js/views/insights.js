'use strict';

const InsightsView = (() => {

  let _chart = null;

  function _fmt(n) { return '₹ ' + Number(n || 0).toLocaleString('en-IN'); }

  function _statCards(o, leads, customers) {
    return `
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">Gross revenue</div>
          <div class="stat-value">${_fmt(o.gross_revenue)}</div>
          <div class="stat-sub">avg ${_fmt(o.avg_order_value)} / order</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total orders</div>
          <div class="stat-value">${Number(o.total_orders || 0).toLocaleString()}</div>
          <div class="stat-sub">${Number(o.unique_customers || 0)} unique customers</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Repeat customers</div>
          <div class="stat-value">${Number(customers.repeat_customers || 0).toLocaleString()}</div>
          <div class="stat-sub">more than one order</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Catering leads</div>
          <div class="stat-value">${Number(leads.total_leads || 0)}</div>
          <div class="stat-sub">
            <span style="color:var(--red-500)">●</span> ${leads.hot || 0} hot ·
            <span style="color:var(--amber-600)">●</span> ${leads.warm || 0} warm ·
            <span style="color:var(--blue-500)">●</span> ${leads.cool || 0} cool
          </div>
        </div>
      </div>`;
  }

  function _drawChart(canvas, rows) {
    if (_chart) { _chart.destroy(); _chart = null; }
    if (!window.Chart || !rows.length) return;

    const labels = rows.map(r => {
      const d = new Date(r.day);
      return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    });
    const revenue = rows.map(r => Number(r.revenue || 0));

    _chart = new window.Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label:           'Revenue (₹)',
          data:            revenue,
          borderColor:     '#2563EB',
          backgroundColor: 'rgba(37,99,235,.08)',
          borderWidth:     2,
          pointRadius:     3,
          tension:         0.3,
          fill:            true,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#9CA3AF' } },
          y: { grid: { color: '#F3F4F6' }, ticks: { font: { size: 11 }, color: '#9CA3AF', callback: v => '₹' + Number(v).toLocaleString('en-IN') } },
        },
      },
    });
  }

  async function _load(el, days) {
    el.querySelector('#insights-stats').innerHTML = `
      <div class="stat-grid">
        ${[1,2,3,4].map(() => `<div class="stat-card"><div class="skeleton skeleton-line short" style="height:28px"></div></div>`).join('')}
      </div>`;
    el.querySelector('#insights-chart-area').innerHTML = `<div class="chart-wrap"><canvas id="revenue-canvas"></canvas></div>`;

    try {
      const [summary, chartData] = await Promise.all([
        Api.rGet('/insights/summary'),
        Api.rGet(`/insights/orders?days=${days}`),
      ]);

      const o         = summary.orders    || {};
      const leads     = summary.leads     || {};
      const customers = summary.customers || {};

      el.querySelector('#insights-stats').innerHTML = _statCards(o, leads, customers);

      const canvas = el.querySelector('#revenue-canvas');
      if (canvas) _drawChart(canvas, chartData.data || []);

    } catch (err) {
      el.querySelector('#insights-stats').innerHTML = `<div class="empty-state">Error: ${err.message}</div>`;
    }
  }

  async function init(el) {
    let activeDays = 30;

    el.innerHTML = `
      <div class="toolbar">
        <div class="toolbar-left"></div>
        <div class="toolbar-right">
          <div class="tab-bar" style="margin-bottom:0;border-bottom:none;gap:4px">
            <button class="tab ${activeDays===7?'active':''}"  data-days="7">7d</button>
            <button class="tab ${activeDays===30?'active':''}" data-days="30">30d</button>
            <button class="tab ${activeDays===90?'active':''}" data-days="90">90d</button>
          </div>
        </div>
      </div>
      <div id="insights-stats"></div>
      <div class="card" style="margin-top:var(--sp-5)">
        <div class="card-header"><span class="card-title">Revenue over time</span></div>
        <div class="card-body" id="insights-chart-area">
          <div class="chart-wrap" style="display:flex;align-items:center;justify-content:center;color:var(--gray-300)">
            Loading Chart.js…
          </div>
        </div>
      </div>`;

    el.querySelectorAll('[data-days]').forEach(btn => {
      btn.addEventListener('click', () => {
        el.querySelectorAll('[data-days]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeDays = parseInt(btn.dataset.days, 10);
        _load(el, activeDays);
      });
    });

    // Load Chart.js from CDN if not already present
    if (!window.Chart) {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js';
      s.onload  = () => _load(el, activeDays);
      s.onerror = () => _load(el, activeDays);
      document.head.appendChild(s);
    } else {
      _load(el, activeDays);
    }
  }

  return { init };
})();
