'use strict';

const ReservationsView = (() => {

  let _state = { tab: 'upcoming', page: 1 };

  // Reservation-specific badge classes (not re-using order colours)
  const STATUS_BADGE = {
    pending:   'badge-placed',
    confirmed: 'badge-preparing',
    seated:    'badge-ready',
    completed: 'badge-delivered',
    cancelled: 'badge-cancelled',
    no_show:   'badge-cancelled',
  };

  const STATUS_LABEL = {
    pending:   'Pending',
    confirmed: 'Confirmed',
    seated:    'Seated',
    completed: 'Completed',
    cancelled: 'Cancelled',
    no_show:   'No-show',
  };

  function _badge(status) {
    const cls   = STATUS_BADGE[status] || 'badge-placed';
    const label = STATUS_LABEL[status] || status.replace(/_/g, ' ');
    return `<span class="badge ${cls}">${label}</span>`;
  }

  function _fmt(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  function _ago(iso) {
    const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (diff < 60)    return `${diff}s ago`;
    if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }

  function _buildUrl(tab, page) {
    const params = new URLSearchParams({ page, limit: 25 });
    if (tab === 'upcoming') {
      params.set('upcoming_only', 'true');
    } else if (tab !== 'all') {
      params.set('status', tab);
    }
    return `/dine-in/reservations?${params}`;
  }

  function _actionButtons(res) {
    const btns = [];
    if (res.status === 'pending') {
      btns.push(`<button class="btn btn-primary btn-sm res-action" data-id="${res.id}" data-status="confirmed">Confirm</button>`);
      btns.push(`<button class="btn btn-ghost btn-sm res-action" data-id="${res.id}" data-status="cancelled">Cancel</button>`);
    } else if (res.status === 'confirmed') {
      btns.push(`<button class="btn btn-primary btn-sm res-action" data-id="${res.id}" data-status="seated" data-party-size="${res.party_size || ''}" data-table-id="${res.table_id || ''}">Seat</button>`);
      btns.push(`<button class="btn btn-ghost btn-sm res-action" data-id="${res.id}" data-status="no_show">No-show</button>`);
      btns.push(`<button class="btn btn-ghost btn-sm res-action" data-id="${res.id}" data-status="cancelled">Cancel</button>`);
    } else if (res.status === 'seated') {
      btns.push(`<button class="btn btn-primary btn-sm res-action" data-id="${res.id}" data-status="completed">Complete</button>`);
    }
    return btns.join(' ');
  }

  async function _seatReservation(el, btn) {
    btn.disabled = true;
    btn.textContent = 'Loading…';

    let tables;
    try {
      const data = await Api.rGet('/tables');
      tables = (data.tables || []).filter(t => t.status === 'available');
    } catch (err) {
      DashUI.toast('Could not load tables. Please try again.', 'error');
      btn.disabled = false;
      btn.textContent = 'Seat';
      return;
    }

    const resId    = btn.dataset.id;
    const covers   = parseInt(btn.dataset.partySize, 10) || null;
    const preselId = btn.dataset.tableId || null;

    if (!tables.length) {
      DashUI.toast('No available tables right now.', 'error');
      btn.disabled = false;
      btn.textContent = 'Seat';
      return;
    }

    // Build picker modal
    const optionsHtml = tables.map(t => {
      const cap     = t.capacity ? ` · ${t.capacity} pax` : '';
      const floor   = t.floor    ? ` · ${t.floor}`        : '';
      const sel     = t.id === preselId ? ' selected' : '';
      return `<option value="${t.id}"${sel}>${t.name}${cap}${floor}</option>`;
    }).join('');

    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal-overlay" id="seat-modal">
        <div class="modal" style="max-width:360px">
          <div class="modal-header">
            <span class="modal-title">Select table</span>
            <button class="modal-close" id="seat-modal-close">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label>Available tables</label>
              <select id="seat-table-select" style="width:100%">${optionsHtml}</select>
            </div>
            <p id="seat-modal-error" class="form-error" hidden></p>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" id="seat-modal-cancel">Cancel</button>
            <button class="btn btn-primary" id="seat-modal-confirm">Seat guest</button>
          </div>
        </div>
      </div>`);

    const overlay   = document.getElementById('seat-modal');
    const errEl     = overlay.querySelector('#seat-modal-error');
    const confirmEl = overlay.querySelector('#seat-modal-confirm');
    const close     = () => {
      overlay.remove();
      btn.disabled    = false;
      btn.textContent = 'Seat';
    };

    overlay.querySelector('#seat-modal-close').onclick  = close;
    overlay.querySelector('#seat-modal-cancel').onclick = close;
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    confirmEl.addEventListener('click', async () => {
      const tableId = overlay.querySelector('#seat-table-select').value;
      if (!tableId) return;

      confirmEl.disabled    = true;
      confirmEl.textContent = 'Seating…';
      errEl.hidden          = true;

      try {
        const result = await Api.rPatch(`/dine-in/reservations/${resId}`, { status: 'seated', table_id: tableId });
        overlay.remove();
        if (result.session?.error) {
          DashUI.toast(`Guest marked seated — but session could not open: ${result.session.error}`, 'warn');
        } else {
          DashUI.toast('Guest seated and session opened.', 'success');
        }
        _load(el);
      } catch (err) {
        errEl.textContent     = err.message || 'Could not seat guest. Please try again.';
        errEl.hidden          = false;
        confirmEl.disabled    = false;
        confirmEl.textContent = 'Seat guest';
      }
    });
  }

  async function _load(el) {
    const tbody = el.querySelector('#res-tbody');
    const info  = el.querySelector('#res-page-info');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="7"><div class="skeleton skeleton-line" style="margin:12px 0"></div></td></tr>`;

    try {
      const data = await Api.rGet(_buildUrl(_state.tab, _state.page));
      const list = data.reservations || [];

      if (!list.length) {
        tbody.innerHTML = `
          <tr><td colspan="7">
            ${DashUI.emptyState({
              icon:  '📅',
              title: 'No reservations found',
              body:  'Reservations submitted through your presence page will appear here.',
            })}
          </td></tr>`;
      } else {
        tbody.innerHTML = list.map(r => `
          <tr>
            <td class="text-sm text-muted">${r.confirmation_code || r.id.slice(-6).toUpperCase()}</td>
            <td>
              <div class="lead-contact-name">${r.customer_name || '—'}</div>
              ${r.customer_phone ? `<div class="text-sm text-muted">${r.customer_phone}</div>` : ''}
            </td>
            <td class="text-sm">${r.party_size || '—'} pax</td>
            <td class="text-sm">${_fmt(r.reservation_time)}</td>
            <td class="text-sm">${r.table_label || '—'}</td>
            <td>${_badge(r.status)}</td>
            <td><div class="res-actions">${_actionButtons(r)}</div></td>
          </tr>
          <tr class="lead-detail-row" data-res-id="${r.id}">
            <td colspan="7">
              <div class="lead-detail">
                <div class="lead-detail-grid">
                  ${r.customer_email ? `<div><span class="detail-label">Email</span> ${r.customer_email}</div>` : ''}
                  ${r.occasion       ? `<div><span class="detail-label">Occasion</span> ${r.occasion}</div>` : ''}
                  ${r.dietary_notes  ? `<div><span class="detail-label">Dietary notes</span> ${r.dietary_notes}</div>` : ''}
                  <div><span class="detail-label">Source</span> ${r.source || '—'}</div>
                  <div><span class="detail-label">Received</span> ${_ago(r.created_at)}</div>
                </div>
              </div>
            </td>
          </tr>`).join('');
      }

      const total = data.total || 0;
      if (info) info.textContent = `${total} reservation${total !== 1 ? 's' : ''}`;
      const prevBtn = el.querySelector('#res-prev');
      const nextBtn = el.querySelector('#res-next');
      if (prevBtn) prevBtn.disabled = _state.page <= 1;
      if (nextBtn) nextBtn.disabled = _state.page >= (data.pages || 1);

      // Expand detail row on click
      el.querySelectorAll('#res-tbody tr:not(.lead-detail-row)').forEach((row, i) => {
        const detail = el.querySelectorAll('#res-tbody .lead-detail-row')[i];
        if (!detail) return;
        row.style.cursor = 'pointer';
        row.addEventListener('click', (e) => {
          if (e.target.closest('button')) return;
          const isOpen = detail.classList.contains('open');
          el.querySelectorAll('.lead-detail-row').forEach(r => r.classList.remove('open'));
          if (!isOpen) detail.classList.add('open');
        });
      });

      // Action buttons
      el.querySelectorAll('.res-action').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (btn.dataset.status === 'seated') {
            await _seatReservation(el, btn);
          } else {
            btn.disabled = true;
            try {
              await Api.rPatch(`/dine-in/reservations/${btn.dataset.id}`, { status: btn.dataset.status });
              _load(el);
            } catch (err) {
              DashUI.toast('Could not update reservation. Please try again.', 'error');
              btn.disabled = false;
            }
          }
        });
      });

    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7">${DashUI.errorState(err.message)}</td></tr>`;
    }
  }

  function init(el) {
    _state = { tab: 'all', page: 1 };

    el.innerHTML = `
      <div class="tab-bar">
        <button class="tab active" data-tab="all">All</button>
        <button class="tab" data-tab="upcoming">Upcoming</button>
        <button class="tab" data-tab="confirmed">Confirmed</button>
        <button class="tab" data-tab="pending">Pending</button>
        <button class="tab" data-tab="cancelled">Cancelled</button>
      </div>
      <div class="card">
        <div class="card-header">
          <span class="card-title">Reservations</span>
          <span id="res-page-info" class="text-sm text-muted"></span>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Code</th><th>Guest</th><th>Party</th>
                <th>Date &amp; Time</th><th>Table</th><th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody id="res-tbody"></tbody>
          </table>
        </div>
        <div class="pagination">
          <span></span>
          <div class="pagination-btns">
            <button id="res-prev" class="btn btn-secondary btn-sm">← Prev</button>
            <button id="res-next" class="btn btn-secondary btn-sm">Next →</button>
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

    el.querySelector('#res-prev').addEventListener('click', () => { _state.page--; _load(el); });
    el.querySelector('#res-next').addEventListener('click', () => { _state.page++; _load(el); });

    _load(el);
  }

  return { init };
})();
