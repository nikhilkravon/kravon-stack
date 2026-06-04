'use strict';

const KitchenView = (() => {

  let _pollTimer      = null;
  let _tickTimer      = null;
  let _lastLoadedAt   = null;

  function _dur(isoDate) {
    if (!isoDate) return '—';
    const mins = Math.floor((Date.now() - new Date(isoDate)) / 60000);
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }

  const STATUS_BADGE = {
    confirmed: '<span class="badge badge-placed">Confirmed</span>',
    preparing: '<span class="badge badge-preparing">Preparing</span>',
    pending:   '<span class="badge badge-pending">Pending</span>',
  };

  function _tableCard(t) {
    const orders = t.orders || [];
    const orderHtml = orders.length ? orders.map(o => {
      const items = (o.items || []).map(i => `
        <div class="order-item-line">
          <span class="order-item-name">${i.name} × ${i.qty}${i.note ? ` <em style="color:var(--amber-600)">(${i.note})</em>` : ''}</span>
          ${STATUS_BADGE[o.status] || ''}
        </div>`).join('');
      return `
        <div style="margin-bottom:var(--sp-3);padding-bottom:var(--sp-3);border-bottom:1px solid var(--gray-100)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--sp-2)">
            <span class="text-sm text-muted">#${o.order_id.slice(-6).toUpperCase()}</span>
            ${STATUS_BADGE[o.status] || ''}
          </div>
          ${items}
        </div>`;
    }).join('') : `<div class="text-sm text-muted" style="padding:var(--sp-2) 0">No active orders</div>`;

    return `
      <div class="kitchen-card">
        <div class="kitchen-card-header">
          <span class="kitchen-table-name">${t.table_name}</span>
          <div style="display:flex;align-items:center;gap:var(--sp-2)">
            ${t.covers ? `<span class="text-sm text-muted">${t.covers} pax</span>` : ''}
            <span class="badge badge-placed">${_dur(t.opened_at)}</span>
          </div>
        </div>
        <div class="kitchen-orders">${orderHtml}</div>
      </div>`;
  }

  async function _load(el) {
    const grid      = el.querySelector('#kitchen-grid');
    const lastSync  = el.querySelector('#kitchen-sync');
    if (!grid) return;

    try {
      const data   = await Api.rGet('/dine-in/kitchen');
      const tables = data.tables || [];

      _lastLoadedAt = Date.now();
      // Pulse the live dot on successful refresh
      const dot = el.querySelector('#kitchen-live-dot');
      if (dot) {
        dot.classList.remove('kitchen-dot--pulse');
        void dot.offsetWidth;
        dot.classList.add('kitchen-dot--pulse');
      }
      if (lastSync) lastSync.textContent = 'Just now';

      if (!tables.length) {
        grid.innerHTML = DashUI.emptyState({
          icon:  '🍽',
          title: 'No open tables',
          body:  'Active dine-in sessions with pending orders will appear here.',
        });
        return;
      }

      grid.innerHTML = tables.map(_tableCard).join('');

    } catch (err) {
      grid.innerHTML = DashUI.errorState(err.message);
    }
  }

  function init(el) {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
    if (_tickTimer) { clearInterval(_tickTimer); _tickTimer = null; }
    _lastLoadedAt = null;

    el.innerHTML = `
      <div class="toolbar">
        <div class="toolbar-left" style="display:flex;align-items:center;gap:var(--sp-3)">
          <span id="kitchen-live-dot" class="kitchen-live-dot"></span>
          <span id="kitchen-sync" class="text-sm text-muted">Loading…</span>
        </div>
        <div class="toolbar-right">
          <button id="kitchen-refresh" class="btn btn-secondary btn-sm">↻ Refresh</button>
        </div>
      </div>
      <div id="kitchen-grid" class="kitchen-grid"></div>`;

    el.querySelector('#kitchen-refresh').addEventListener('click', () => _load(el));

    // Live "X seconds ago" counter
    _tickTimer = setInterval(() => {
      if (!_lastLoadedAt) return;
      const secs = Math.floor((Date.now() - _lastLoadedAt) / 1000);
      const syncEl = el.querySelector('#kitchen-sync');
      if (syncEl) {
        if (secs < 5)       syncEl.textContent = 'Just refreshed';
        else if (secs < 60) syncEl.textContent = `Refreshed ${secs}s ago`;
        else                syncEl.textContent = `Refreshed ${Math.floor(secs / 60)}m ago`;
      }
    }, 1000);

    _load(el);
    // Auto-refresh every 30 seconds
    _pollTimer = setInterval(() => _load(el), 30000);

    // Stop polling when navigating away
    const observer = new MutationObserver(() => {
      if (!document.getElementById('kitchen-grid')) {
        clearInterval(_pollTimer); _pollTimer = null;
        clearInterval(_tickTimer); _tickTimer = null;
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  return { init };
})();
