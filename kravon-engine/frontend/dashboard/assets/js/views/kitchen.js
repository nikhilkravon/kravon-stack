'use strict';

const KitchenView = (() => {

  let _pollTimer    = null;
  let _tickTimer    = null;
  let _lastLoadedAt = null;

  function _dur(isoDate) {
    if (!isoDate) return '—';
    const mins = Math.floor((Date.now() - new Date(isoDate)) / 60000);
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }

  function _orderAge(isoDate) {
    if (!isoDate) return '';
    const mins = Math.floor((Date.now() - new Date(isoDate)) / 60000);
    const secs = Math.floor((Date.now() - new Date(isoDate)) / 1000) % 60;
    if (mins === 0) return `${secs}s`;
    return `${mins}m ago`;
  }

  function _orderAgeClass(isoDate, status) {
    if (!isoDate) return '';
    const mins = Math.floor((Date.now() - new Date(isoDate)) / 60000);
    if (status === 'confirmed' && mins >= 10) return 'order-age--urgent';
    if (status === 'preparing' && mins >= 20) return 'order-age--urgent';
    if (mins >= 5) return 'order-age--warn';
    return '';
  }

  const STATUS_BADGE = {
    confirmed: '<span class="badge badge-placed">Confirmed</span>',
    preparing: '<span class="badge badge-preparing">Preparing</span>',
    pending:   '<span class="badge badge-pending">Pending</span>',
  };

  const CHANNEL_LABEL = {
    dine_in:  'Dine-in',
    delivery: 'Delivery',
    pickup:   'Pickup',
  };

  // Kitchen owns confirmed→preparing→ready on Order.status
  const KITCHEN_NEXT = {
    confirmed: { status: 'preparing', label: 'Start Preparing' },
    preparing: { status: 'ready',     label: 'Mark Ready' },
  };

  // Queue handoff: ready delivery → out_for_delivery; ready pickup → completed
  const QUEUE_READY_NEXT = {
    delivery: { status: 'out_for_delivery', label: 'Hand to Rider →' },
    pickup:   { status: 'completed',        label: 'Collected ✓' },
  };

  async function _updateOrderStatus(orderId, status, cardEl) {
    try {
      await Api.rPatch(`/orders/${orderId}`, { status });
      // Optimistic: immediately refresh
      const gridEl = document.getElementById('kitchen-grid');
      if (gridEl) _load(document.getElementById('kitchen-grid').closest('[id]') || document.body);
    } catch (err) {
      DashUI.toast('Could not update order: ' + err.message, 'error');
    }
  }

  function _allergenTags(allergens) {
    if (!allergens || !allergens.length) return '';
    const ICONS = { gluten: '🌾', dairy: '🥛', nuts: '🥜', egg: '🥚', soy: '🫘', shellfish: '🦐', fish: '🐟' };
    return allergens.map(a => {
      const icon = ICONS[a.toLowerCase()] || '⚠';
      return `<span style="display:inline-flex;align-items:center;gap:2px;font-size:10px;font-weight:600;padding:1px 5px;border-radius:4px;background:var(--red-50);color:var(--red-600);border:1px solid var(--red-100)">${icon} ${a}</span>`;
    }).join(' ');
  }

  function _orderCard(o, queueMode = false) {
    const ageClass   = _orderAgeClass(o.created_at, o.status);
    const ageLabel   = _orderAge(o.created_at);
    const next       = queueMode && o.status === 'ready'
      ? (QUEUE_READY_NEXT[o.fulfillment_type] || null)
      : KITCHEN_NEXT[o.status];
    const chLabel    = CHANNEL_LABEL[o.fulfillment_type] || o.fulfillment_type || '';

    const items = (o.items || []).map(i => {
      const allergens = _allergenTags(i.allergens);
      return `
        <div class="order-item-line" style="flex-direction:column;align-items:flex-start;gap:2px">
          <div style="display:flex;align-items:baseline;gap:var(--sp-2)">
            <span class="order-item-name" style="font-weight:600">${i.name} × ${i.qty}</span>
            ${i.note ? `<em style="color:var(--amber-600);font-size:12px">${i.note}</em>` : ''}
          </div>
          ${allergens ? `<div style="margin-top:2px;display:flex;flex-wrap:wrap;gap:3px">${allergens}</div>` : ''}
        </div>`;
    }).join('');

    const orderNotes = o.notes || o.special_instructions;

    return `
      <div class="kitchen-order-card" data-order-id="${o.order_id}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--sp-2)">
          <div style="display:flex;align-items:center;gap:var(--sp-2)">
            <span class="text-sm text-muted">#${o.order_id.slice(-6).toUpperCase()}</span>
            ${chLabel ? `<span class="text-sm" style="color:var(--gray-500);font-size:11px;text-transform:uppercase;letter-spacing:.04em">${chLabel}</span>` : ''}
          </div>
          <div style="display:flex;align-items:center;gap:var(--sp-2)">
            <span class="text-sm ${ageClass}" style="font-weight:600">${ageLabel}</span>
            ${STATUS_BADGE[o.status] || ''}
          </div>
        </div>
        ${items}
        ${orderNotes ? `
          <div style="margin-top:var(--sp-2);padding:6px 8px;background:var(--amber-50);border-radius:4px;border-left:3px solid var(--amber-600)">
            <span style="font-size:11px;font-weight:700;color:var(--amber-600);text-transform:uppercase;letter-spacing:.04em">Note</span>
            <p style="font-size:12px;color:var(--gray-700);margin-top:2px">${orderNotes}</p>
          </div>` : ''}
        ${next ? `
          <div style="margin-top:var(--sp-3)">
            <button class="btn btn-primary btn-sm kitchen-order-action"
              data-order-id="${o.order_id}" data-next-status="${next.status}">
              ${next.label}
            </button>
          </div>` : ''}
      </div>`;
  }

  function _tableCard(t) {
    const orders    = t.orders || [];
    const orderHtml = orders.length
      ? orders.map(o => _orderCard(o)).join('')
      : `<div class="text-sm text-muted" style="padding:var(--sp-2) 0">No active orders</div>`;
    const billBadge = t.bill_requested_at
      ? `<span class="badge badge-bill-requested" title="Bill requested ${_orderAge(t.bill_requested_at)}">Bill Requested</span>`
      : '';

    return `
      <div class="kitchen-card${t.bill_requested_at ? ' kitchen-card--bill' : ''}">
        <div class="kitchen-card-header">
          <span class="kitchen-table-name">${t.table_name}</span>
          <div style="display:flex;align-items:center;gap:var(--sp-2)">
            ${t.covers ? `<span class="text-sm text-muted">${t.covers} pax</span>` : ''}
            ${billBadge}
            <span class="badge badge-placed">${_dur(t.opened_at)}</span>
          </div>
        </div>
        <div class="kitchen-orders">${orderHtml}</div>
      </div>`;
  }

  async function _load(el) {
    const grid     = el.querySelector('#kitchen-grid');
    const lastSync = el.querySelector('#kitchen-sync');
    if (!grid) return;

    try {
      const data   = await Api.rGet('/dine-in/kitchen');
      const tables = data.tables || [];
      const queue  = data.queue  || [];

      _lastLoadedAt = Date.now();

      const dot = el.querySelector('#kitchen-live-dot');
      if (dot) {
        dot.classList.remove('kitchen-dot--pulse');
        void dot.offsetWidth;
        dot.classList.add('kitchen-dot--pulse');
      }
      if (lastSync) lastSync.textContent = 'Just now';

      if (!tables.length && !queue.length) {
        grid.innerHTML = DashUI.emptyState({
          icon:  '🍽',
          title: 'Nothing in the kitchen',
          body:  'Confirmed orders will appear here when they need preparing.',
        });
        return;
      }

      const queueSection = queue.length ? `
        <div class="kitchen-section-header" style="grid-column:1/-1;margin-top:var(--sp-4)">
          <span class="text-sm" style="font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--gray-500)">
            Delivery & Pickup (${queue.length})
          </span>
        </div>
        ${queue.map(o => `
          <div class="kitchen-card">
            <div class="kitchen-card-header">
              <span class="kitchen-table-name">${o.fulfillment_type === 'delivery' ? 'Delivery' : 'Pickup'}</span>
              <span class="text-sm text-muted">${o.customer_name || ''}</span>
            </div>
            <div class="kitchen-orders">${_orderCard(o, true)}</div>
          </div>`).join('')}` : '';

      grid.innerHTML = tables.map(_tableCard).join('') + queueSection;

      // Kitchen action buttons — status changes without leaving this view
      grid.querySelectorAll('.kitchen-order-action').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled    = true;
          btn.textContent = 'Updating…';
          try {
            await Api.rPatch(`/orders/${btn.dataset.orderId}`, { status: btn.dataset.nextStatus });
            _load(el);
          } catch (err) {
            DashUI.toast('Could not update order: ' + err.message, 'error');
            btn.disabled    = false;
            btn.textContent = btn.dataset.nextStatus === 'preparing' ? 'Start Preparing' : 'Mark Ready';
          }
        });
      });

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

    _tickTimer = setInterval(() => {
      if (!_lastLoadedAt) return;
      const secs  = Math.floor((Date.now() - _lastLoadedAt) / 1000);
      const syncEl = el.querySelector('#kitchen-sync');
      if (syncEl) {
        if (secs < 5)       syncEl.textContent = 'Just refreshed';
        else if (secs < 60) syncEl.textContent = `Refreshed ${secs}s ago`;
        else                syncEl.textContent = `Refreshed ${Math.floor(secs / 60)}m ago`;
      }
    }, 1000);

    _load(el);
    _pollTimer = setInterval(() => _load(el), 10000);

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
