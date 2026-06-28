'use strict';

const InsightsView = (() => {

  let _charts = {};

  function _fmt(n)  { return '₹ ' + Number(n || 0).toLocaleString('en-IN'); }
  function _fmtNum(n) { return Number(n || 0).toLocaleString('en-IN'); }
  function _fmtMins(n) {
    const m = Number(n || 0);
    if (m < 60) return `${m.toFixed(0)}m`;
    return `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`;
  }

  function _destroyCharts() {
    Object.values(_charts).forEach(c => { try { c.destroy(); } catch (_) {} });
    _charts = {};
  }

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
          <div class="stat-value">${_fmtNum(o.total_orders)}</div>
          <div class="stat-sub">${_fmtNum(o.unique_customers)} unique customers</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Repeat customers</div>
          <div class="stat-value">${_fmtNum(customers.repeat_customers)}</div>
          <div class="stat-sub">more than one order</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Catering leads</div>
          <div class="stat-value">${_fmtNum(leads.total_leads)}</div>
          <div class="stat-sub">
            <span style="color:var(--red-500)">●</span> ${leads.hot || 0} hot ·
            <span style="color:var(--amber-600)">●</span> ${leads.warm || 0} warm ·
            <span style="color:var(--blue-500)">●</span> ${leads.cool || 0} cool
          </div>
        </div>
      </div>`;
  }

  function _makeChart(canvas, config) {
    if (!window.Chart || !canvas) return null;
    return new window.Chart(canvas, config);
  }

  const CHART_COLORS = ['#2563EB','#16A34A','#D97706','#7C3AED','#DC2626','#0891B2','#EA580C'];

  function _drawRevenueChart(canvas, rows) {
    if (_charts.revenue) { _charts.revenue.destroy(); }
    if (!rows?.length) return;
    const labels  = rows.map(r => { const d = new Date(r.day); return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); });
    const revenue = rows.map(r => Number(r.revenue || 0));
    _charts.revenue = _makeChart(canvas, {
      type: 'line',
      data: { labels, datasets: [{ label: 'Revenue (₹)', data: revenue, borderColor: '#2563EB', backgroundColor: 'rgba(37,99,235,.08)', borderWidth: 2, pointRadius: 3, tension: 0.3, fill: true }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#9CA3AF' } }, y: { grid: { color: '#F3F4F6' }, ticks: { font: { size: 11 }, color: '#9CA3AF', callback: v => '₹' + Number(v).toLocaleString('en-IN') } } } },
    });
  }

  function _drawChannelChart(canvas, rows) {
    if (_charts.channel) { _charts.channel.destroy(); }
    if (!rows?.length) return;
    const labels = rows.map(r => { const ft = { dine_in:'Dine-in', delivery:'Delivery', pickup:'Pickup', catering:'Catering' }; return ft[r.fulfillment_type] || r.fulfillment_type; });
    const data   = rows.map(r => Number(r.revenue));
    _charts.channel = _makeChart(canvas, {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: CHART_COLORS, borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { font: { size: 12 }, padding: 12 } } } },
    });
  }

  function _drawHourChart(canvas, rows) {
    if (_charts.hour) { _charts.hour.destroy(); }
    // Fill in all 24 hours
    const byHour = new Array(24).fill(0);
    (rows || []).forEach(r => { byHour[r.hour] = Number(r.order_count); });
    const labels = Array.from({ length: 24 }, (_, h) => {
      const p = h < 12 ? 'am' : 'pm';
      return `${h === 0 ? 12 : h > 12 ? h - 12 : h}${p}`;
    });
    _charts.hour = _makeChart(canvas, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Orders', data: byHour, backgroundColor: 'rgba(37,99,235,.7)', borderRadius: 4 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { font: { size: 10 }, color: '#9CA3AF' } }, y: { grid: { color: '#F3F4F6' }, ticks: { font: { size: 11 }, color: '#9CA3AF', stepSize: 1 } } } },
    });
  }

  function _topItemsTable(rows) {
    if (!rows?.length) return `<div class="empty-state" style="padding:var(--sp-6)"><div class="empty-state-title">No data yet</div></div>`;
    return `
      <div class="table-wrap">
        <table>
          <thead><tr><th>#</th><th>Item</th><th class="text-right">Qty sold</th><th class="text-right">Revenue</th></tr></thead>
          <tbody>
            ${rows.map((r, i) => `
              <tr>
                <td class="td-muted">${i + 1}</td>
                <td style="font-weight:500">${r.item_name}</td>
                <td class="text-right" style="font-weight:600">${_fmtNum(r.total_qty)}</td>
                <td class="text-right">${_fmt(r.total_revenue)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function _occupancyTable(rows, timings) {
    const diningMins = timings?.avg_dining_mins || 0;
    const prepMins   = timings?.avg_prep_mins   || 0;
    return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-3);margin-bottom:var(--sp-4)">
        <div class="stat-card" style="padding:var(--sp-4)">
          <div class="stat-label">Avg preparation time</div>
          <div class="stat-value" style="font-size:20px">${_fmtMins(prepMins)}</div>
          <div class="stat-sub">confirmed → ready</div>
        </div>
        <div class="stat-card" style="padding:var(--sp-4)">
          <div class="stat-label">Avg dining duration</div>
          <div class="stat-value" style="font-size:20px">${_fmtMins(diningMins)}</div>
          <div class="stat-sub">open → close</div>
        </div>
      </div>
      ${rows?.length ? `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Table</th><th class="text-right">Sessions</th><th class="text-right">Avg duration</th><th class="text-right">Revenue</th></tr></thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td style="font-weight:600">${r.table_name || '—'}</td>
                <td class="text-right">${_fmtNum(r.session_count)}</td>
                <td class="text-right">${_fmtMins(r.avg_duration_mins)}</td>
                <td class="text-right">${_fmt(r.total_revenue)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>` : `<div class="empty-state" style="padding:var(--sp-6)"><div class="empty-state-title">No table data yet</div></div>`}`;
  }

  async function _load(el, days) {
    if (!el.isConnected) return;

    el.querySelector('#insights-stats').innerHTML = `
      <div class="stat-grid">
        ${[1,2,3,4].map(() => `<div class="stat-card"><div class="skeleton skeleton-line short" style="height:28px"></div></div>`).join('')}
      </div>`;

    el.querySelector('#insights-chart-area').innerHTML  = `<div class="chart-wrap" style="display:flex;align-items:center;justify-content:center;color:var(--gray-300)">Loading…</div>`;
    el.querySelector('#insights-channel-area').innerHTML = `<div class="chart-wrap" style="display:flex;align-items:center;justify-content:center;color:var(--gray-300)">Loading…</div>`;
    el.querySelector('#insights-hour-area').innerHTML    = `<div class="chart-wrap" style="display:flex;align-items:center;justify-content:center;color:var(--gray-300)">Loading…</div>`;
    el.querySelector('#insights-items-area').innerHTML   = `<div class="text-sm text-muted" style="padding:var(--sp-4)">Loading…</div>`;
    el.querySelector('#insights-occupancy-area').innerHTML = `<div class="text-sm text-muted" style="padding:var(--sp-4)">Loading…</div>`;

    _destroyCharts();

    try {
      const [summary, chartData, channelData, hourData, topItems, occupancy, timings] = await Promise.all([
        Api.rGet('/insights/summary'),
        Api.rGet(`/insights/orders?days=${days}`),
        Api.rGet(`/insights/by-channel?days=${days}`),
        Api.rGet(`/insights/by-hour?days=${days}`),
        Api.rGet(`/insights/top-items?days=${days}&limit=15`),
        Api.rGet(`/insights/occupancy?days=${days}`),
        Api.rGet(`/insights/timings?days=${days}`),
      ]);

      if (!el.isConnected) return;

      const o         = summary.orders    || {};
      const leads     = summary.leads     || {};
      const customers = summary.customers || {};

      el.querySelector('#insights-stats').innerHTML = _statCards(o, leads, customers);

      // Revenue over time
      const chartRows = chartData.data || [];
      el.querySelector('#insights-chart-area').innerHTML = `<div class="chart-wrap"><canvas id="revenue-canvas"></canvas></div>`;
      const revCanvas = el.querySelector('#revenue-canvas');
      if (revCanvas && chartRows.length) {
        _drawRevenueChart(revCanvas, chartRows);
      } else if (revCanvas) {
        revCanvas.closest('.chart-wrap').innerHTML = DashUI.emptyState({ icon: '📊', title: 'No revenue data yet', body: 'Revenue will appear here once orders start coming in.' });
      }

      // Revenue by channel
      const chRows = channelData.data || [];
      el.querySelector('#insights-channel-area').innerHTML = `<div class="chart-wrap"><canvas id="channel-canvas"></canvas></div>`;
      const chCanvas = el.querySelector('#channel-canvas');
      if (chCanvas && chRows.length) {
        _drawChannelChart(chCanvas, chRows);
      } else if (chCanvas) {
        chCanvas.closest('.chart-wrap').innerHTML = DashUI.emptyState({ icon: '📊', title: 'No channel data yet' });
      }

      // Orders by hour
      const hrRows = hourData.data || [];
      el.querySelector('#insights-hour-area').innerHTML = `<div class="chart-wrap" style="height:180px"><canvas id="hour-canvas"></canvas></div>`;
      const hrCanvas = el.querySelector('#hour-canvas');
      if (hrCanvas) _drawHourChart(hrCanvas, hrRows);

      // Top items
      el.querySelector('#insights-items-area').innerHTML = _topItemsTable(topItems.data || []);

      // Occupancy + timings
      el.querySelector('#insights-occupancy-area').innerHTML = _occupancyTable(occupancy.data || [], timings.data);

    } catch (err) {
      if (!el.isConnected) return;
      el.querySelector('#insights-stats').innerHTML = DashUI.errorState(err.message);
    }
  }

  async function init(el) {
    let activeDays = 30;
    _destroyCharts();

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

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-5);margin-top:var(--sp-5)">

        <div class="card">
          <div class="card-header"><span class="card-title">Revenue over time</span></div>
          <div class="card-body" id="insights-chart-area">
            <div class="chart-wrap" style="display:flex;align-items:center;justify-content:center;color:var(--gray-300)">Loading Chart.js…</div>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><span class="card-title">Revenue by channel</span></div>
          <div class="card-body" id="insights-channel-area">
            <div class="chart-wrap" style="display:flex;align-items:center;justify-content:center;color:var(--gray-300)">Loading…</div>
          </div>
        </div>

      </div>

      <div class="card" style="margin-top:var(--sp-5)">
        <div class="card-header"><span class="card-title">Peak ordering hours</span></div>
        <div class="card-body" id="insights-hour-area">
          <div class="chart-wrap" style="height:180px;display:flex;align-items:center;justify-content:center;color:var(--gray-300)">Loading…</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-5);margin-top:var(--sp-5)">

        <div class="card">
          <div class="card-header"><span class="card-title">Top selling items</span></div>
          <div id="insights-items-area">
            <div class="text-sm text-muted" style="padding:var(--sp-4)">Loading…</div>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><span class="card-title">Table occupancy &amp; timing</span></div>
          <div class="card-body" id="insights-occupancy-area">
            <div class="text-sm text-muted">Loading…</div>
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

    // Load Chart.js if not already present
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
