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
    if (tab !== 'all') params.set('status', tab);
    return `/dine-in/reservations?${params}`;
  }

  function _actionButtons(res) {
    const btns = [];
    if (res.status === 'pending') {
      btns.push(`<button class="btn btn-primary btn-sm res-action" data-id="${res.id}" data-status="confirmed">Confirm</button>`);
      btns.push(`<button class="btn btn-ghost btn-sm res-action" data-id="${res.id}" data-status="cancelled">Cancel</button>`);
    } else if (res.status === 'confirmed') {
      btns.push(`<button class="btn btn-primary btn-sm res-action" data-id="${res.id}" data-status="seated">Seat</button>`);
      btns.push(`<button class="btn btn-ghost btn-sm res-action" data-id="${res.id}" data-status="no_show">No-show</button>`);
      btns.push(`<button class="btn btn-ghost btn-sm res-action" data-id="${res.id}" data-status="cancelled">Cancel</button>`);
    } else if (res.status === 'seated') {
      btns.push(`<button class="btn btn-primary btn-sm res-action" data-id="${res.id}" data-status="completed">Complete</button>`);
    }
    return btns.join(' ');
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
          btn.disabled = true;
          try {
            await Api.rPatch(`/dine-in/reservations/${btn.dataset.id}`, { status: btn.dataset.status });
            _load(el);
          } catch (err) {
            DashUI.toast('Could not update reservation. Please try again.', 'error');
            btn.disabled = false;
          }
        });
      });

    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7">${DashUI.errorState(err.message)}</td></tr>`;
    }
  }

  function init(el) {
    _state = { tab: 'upcoming', page: 1 };

    el.innerHTML = `
      <div class="tab-bar">
        <button class="tab active" data-tab="upcoming">Upcoming</button>
        <button class="tab" data-tab="confirmed">Confirmed</button>
        <button class="tab" data-tab="pending">Pending</button>
        <button class="tab" data-tab="cancelled">Cancelled</button>
        <button class="tab" data-tab="all">All</button>
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
