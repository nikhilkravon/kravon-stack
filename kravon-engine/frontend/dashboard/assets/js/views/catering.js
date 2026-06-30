'use strict';

const CateringView = (() => {

  let _state = { tab: 'all', page: 1 };

  const PIPELINE = ['new', 'contacted', 'proposal_sent', 'negotiating', 'confirmed', 'lost'];

  const STATUS_LABELS = {
    new:           'New',
    contacted:     'Contacted',
    proposal_sent: 'Proposal Sent',
    negotiating:   'Negotiating',
    confirmed:     'Confirmed',
    lost:          'Lost',
    on_hold:       'On Hold',
  };

  // Catering-specific badge classes — semantically correct, not re-using order colours
  const STATUS_BADGE = {
    new:           'badge-placed',
    contacted:     'badge-preparing',
    proposal_sent: 'badge-preparing',
    negotiating:   'badge-ready',
    confirmed:     'badge-delivered',
    lost:          'badge-cancelled',
    on_hold:       'badge-placed',
  };

  const ADVANCE_LABELS = {
    contacted:     'Mark Contacted',
    proposal_sent: 'Send Quote',
    negotiating:   'Negotiating',
    confirmed:     'Confirm',
  };

  function _badge(status) {
    const cls   = STATUS_BADGE[status]  || 'badge-placed';
    const label = STATUS_LABELS[status] || status;
    return `<span class="badge ${cls}">${label}</span>`;
  }

  function _ago(iso) {
    const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (diff < 60)    return `${diff}s ago`;
    if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }

  function _eventDate(lead) {
    if (!lead.preferred_date_from) return '—';
    const from = new Date(lead.preferred_date_from).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    if (!lead.preferred_date_to) return from;
    const to   = new Date(lead.preferred_date_to).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    return `${from} – ${to}`;
  }

  function _cf(lead, key) {
    try {
      const obj = typeof lead.custom_fields === 'string'
        ? JSON.parse(lead.custom_fields)
        : (lead.custom_fields || {});
      return obj[key] || null;
    } catch { return null; }
  }

  function _nextStatus(status) {
    const idx = PIPELINE.indexOf(status);
    if (idx < 0 || status === 'confirmed' || status === 'lost') return null;
    const next = PIPELINE[idx + 1];
    return next === 'lost' ? null : next;
  }

  function _actionButtons(lead) {
    const btns = [];
    const next = _nextStatus(lead.status);

    if (next) {
      btns.push(`<button class="btn btn-primary btn-sm lead-advance"
        data-id="${lead.id}" data-status="${next}">${ADVANCE_LABELS[next] || next}</button>`);
    }

    if (lead.status === 'confirmed') {
      btns.push(`<button class="btn btn-secondary btn-sm lead-create-settlement"
        data-id="${lead.id}">Create Settlement →</button>`);
    }

    if (lead.status !== 'confirmed' && lead.status !== 'lost') {
      btns.push(`<button class="btn btn-danger btn-sm lead-advance"
        data-id="${lead.id}" data-status="lost">Reject</button>`);
    }

    return btns.join(' ');
  }

  function _buildUrl(tab, page) {
    const params = new URLSearchParams({ page, limit: 25 });
    const statusMap = { new: 'new', confirmed: 'confirmed', lost: 'lost' };
    if (tab !== 'all' && tab !== 'active' && statusMap[tab]) {
      params.set('status', statusMap[tab]);
    }
    return `/leads?${params}`;
  }

  async function _load(el) {
    const tbody = el.querySelector('#leads-tbody');
    const info  = el.querySelector('#leads-page-info');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="7"><div class="skeleton skeleton-line" style="margin:12px 0"></div></td></tr>`;

    try {
      const data = await Api.rGet(_buildUrl(_state.tab, _state.page));
      let leads  = data.leads || [];

      if (_state.tab === 'active') {
        leads = leads.filter(l => ['contacted', 'proposal_sent', 'negotiating'].includes(l.status));
      }

      if (!leads.length) {
        tbody.innerHTML = `
          <tr><td colspan="7">
            ${DashUI.emptyState({
              icon:  '📋',
              title: 'No catering leads yet',
              body:  'Enquiries submitted through your catering form will appear here.',
            })}
          </td></tr>`;
      } else {
        tbody.innerHTML = leads.map(lead => {
          const company = _cf(lead, 'company');
          const ref     = _cf(lead, 'ref');
          return `
          <tr class="lead-main-row" style="cursor:pointer" data-lead-id="${lead.id}">
            <td class="text-sm text-muted">${ref || lead.id.slice(-6).toUpperCase()}</td>
            <td>
              <div class="lead-contact-name">${lead.contact_name}</div>
              ${company ? `<div class="text-sm text-muted">${company}</div>` : ''}
            </td>
            <td class="text-sm">${lead.event_type || '—'}</td>
            <td class="text-sm">${_eventDate(lead)}</td>
            <td>${_badge(lead.status)}</td>
            <td class="text-sm text-muted">${_ago(lead.created_at)}</td>
            <td>
              <div class="lead-actions-inline">${_actionButtons(lead)}</div>
            </td>
          </tr>
          <tr class="lead-detail-row" data-for="${lead.id}">
            <td colspan="7">
              <div class="lead-detail">
                <div class="lead-detail-grid">
                  <div><span class="detail-label">Phone</span> ${lead.contact_phone || '—'}</div>
                  ${lead.contact_email ? `<div><span class="detail-label">Email</span> ${lead.contact_email}</div>` : ''}
                  ${(lead.custom_fields?.headcount || lead.guest_count_min) ? `<div><span class="detail-label">Guests</span> ${lead.custom_fields?.headcount || lead.guest_count_min}</div>` : ''}
                  ${(lead.custom_fields?.budget || lead.budget_min) ? `<div><span class="detail-label">Budget</span> ${lead.custom_fields?.budget || ('₹' + Number(lead.budget_min).toLocaleString('en-IN'))}</div>` : ''}
                  ${_cf(lead,'tier') ? `<div><span class="detail-label">Tier</span> ${_cf(lead,'tier').charAt(0).toUpperCase()+_cf(lead,'tier').slice(1)}</div>` : ''}
                  <div><span class="detail-label">Source</span> ${lead.source || '—'}</div>
                  <div><span class="detail-label">Received</span> ${_ago(lead.created_at)}</div>
                </div>
                ${lead.notes ? `<div class="lead-notes"><span class="detail-label">Notes</span> ${lead.notes}</div>` : ''}
              </div>
            </td>
          </tr>`;
        }).join('');
      }

      const total = data.total || 0;
      if (info) info.textContent = `${total} lead${total !== 1 ? 's' : ''}`;
      const prevBtn = el.querySelector('#leads-prev');
      const nextBtn = el.querySelector('#leads-next');
      if (prevBtn) prevBtn.disabled = _state.page <= 1;
      if (nextBtn) nextBtn.disabled = _state.page >= (data.pages || 1);

      // Expand detail row
      el.querySelectorAll('.lead-main-row').forEach(row => {
        row.addEventListener('click', (e) => {
          if (e.target.closest('button')) return;
          const id        = row.dataset.leadId;
          const detailRow = el.querySelector(`.lead-detail-row[data-for="${id}"]`);
          if (!detailRow) return;
          const isOpen = detailRow.classList.contains('open');
          el.querySelectorAll('.lead-detail-row').forEach(r => r.classList.remove('open'));
          if (!isOpen) detailRow.classList.add('open');
        });
      });

      // Status advance / reject
      el.querySelectorAll('.lead-advance').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          btn.disabled = true;
          try {
            await Api.rPatch(`/leads/${btn.dataset.id}`, { status: btn.dataset.status });
            _load(el);
          } catch (err) {
            DashUI.toast('Could not update lead status. Please try again.', 'error');
            btn.disabled = false;
          }
        });
      });

      // Create settlement from confirmed lead
      el.querySelectorAll('.lead-create-settlement').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          btn.disabled = true; btn.textContent = 'Creating…';
          try {
            const data = await Api.rPost('/settlements/from-catering', { lead_id: btn.dataset.id });
            const sid  = data.settlement?.id || data.settlement_id;
            if (sid && typeof sid === 'string' && sid.length > 0) {
              history.pushState(null, '', `#settlement?id=${sid}`);
              App.navigate('settlement');
            } else {
              DashUI.toast('Settlement created.', 'success');
              _load(el);
            }
          } catch (err) {
            DashUI.toast('Could not create settlement: ' + err.message, 'error');
            btn.disabled = false; btn.textContent = 'Create Settlement →';
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
        <button class="tab" data-tab="new">New</button>
        <button class="tab" data-tab="active">In Progress</button>
        <button class="tab" data-tab="confirmed">Confirmed</button>
        <button class="tab" data-tab="lost">Lost</button>
      </div>
      <div class="card">
        <div class="card-header">
          <span class="card-title">Catering Leads</span>
          <span id="leads-page-info" class="text-sm text-muted"></span>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Ref</th><th>Contact</th><th>Event</th>
                <th>Date</th><th>Status</th><th>Received</th><th>Actions</th>
              </tr>
            </thead>
            <tbody id="leads-tbody"></tbody>
          </table>
        </div>
        <div class="pagination">
          <span></span>
          <div class="pagination-btns">
            <button id="leads-prev" class="btn btn-secondary btn-sm">← Prev</button>
            <button id="leads-next" class="btn btn-secondary btn-sm">Next →</button>
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

    el.querySelector('#leads-prev').addEventListener('click', () => { _state.page--; _load(el); });
    el.querySelector('#leads-next').addEventListener('click', () => { _state.page++; _load(el); });

    _load(el);
  }

  return { init };
})();
