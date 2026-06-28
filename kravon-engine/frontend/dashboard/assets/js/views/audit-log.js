'use strict';

const AuditLogView = (() => {

  const _state = {
    page:        1,
    limit:       50,
    action:      '',
    actor_search:'',
    date_from:   '',
    date_to:     '',
    entity_type: '',
  };

  let _debounceTimer = null;
  let _el            = null;

  function _debounce(fn, ms = 350) {
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(fn, ms);
  }

  function _buildUrl() {
    const p = new URLSearchParams({ page: _state.page, limit: _state.limit });
    if (_state.action)       p.set('action',      _state.action);
    if (_state.actor_search) p.set('search',      _state.actor_search);
    if (_state.date_from)    p.set('date_from',   _state.date_from);
    if (_state.date_to)      p.set('date_to',     _state.date_to + 'T23:59:59');
    if (_state.entity_type)  p.set('entity_type', _state.entity_type);
    return `/audit-log?${p}`;
  }

  function _fmtTs(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function _entityLabel(type) {
    const m = { order: 'Order', session: 'Session', menu_item: 'Menu Item', staff: 'Staff', settings: 'Settings', lead: 'Lead', customer: 'Customer', reservation: 'Reservation' };
    return m[type] || (type ? type.replace(/_/g, ' ') : '—');
  }

  function _actionBadge(action) {
    const dot = action?.includes('delete') || action?.includes('cancel') || action?.includes('reject')
      ? '<span style="color:var(--red-500)">●</span>'
      : action?.includes('create') || action?.includes('open') || action?.includes('confirm')
      ? '<span style="color:var(--green-500)">●</span>'
      : '<span style="color:var(--blue-400)">●</span>';
    return dot;
  }

  function _rowHtml(log, actionLabels) {
    const label    = actionLabels?.[log.action] || log.action || '—';
    const actor    = log.actor_name ? `${log.actor_name}` : (log.actor_id ? `Staff #${log.actor_id.slice(-6)}` : 'System');
    const email    = log.actor_email ? `<span class="text-sm text-muted">${log.actor_email}</span>` : '';
    const entity   = log.entity_type ? `<span class="badge" style="font-size:10px;background:var(--gray-100);color:var(--gray-600)">${_entityLabel(log.entity_type)}</span>` : '';
    const entityId = log.entity_id ? `<span class="text-sm text-muted" style="font-family:monospace;font-size:10px">${String(log.entity_id).slice(-8)}</span>` : '';
    const hasDiff  = log.before || log.after;

    return `
      <tr class="audit-row${hasDiff ? ' audit-row--expandable' : ''}" data-log-id="${log.id}">
        <td style="white-space:nowrap">${_fmtTs(log.created_at)}</td>
        <td style="white-space:nowrap">
          ${_actionBadge(log.action)}
          <span style="margin-left:4px">${label}</span>
        </td>
        <td>
          <div style="font-weight:500">${actor}</div>
          ${email}
        </td>
        <td style="white-space:nowrap">
          ${entity}
          ${entityId}
        </td>
        <td style="text-align:right;width:24px">
          ${hasDiff ? `<button class="audit-expand-btn text-sm text-muted" data-log-id="${log.id}" title="Show changes">▸</button>` : ''}
        </td>
      </tr>
      ${hasDiff ? `<tr class="audit-detail-row" id="audit-detail-${log.id}" style="display:none">
        <td colspan="5" style="padding:0">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-3);padding:var(--sp-3);background:var(--gray-50);border-bottom:1px solid var(--gray-200)">
            ${log.before ? `<div><div class="text-sm" style="font-weight:600;color:var(--red-600);margin-bottom:4px">Before</div><pre style="font-size:11px;background:var(--gray-100);border-radius:4px;padding:var(--sp-2);overflow:auto;max-height:160px;white-space:pre-wrap">${JSON.stringify(log.before, null, 2)}</pre></div>` : '<div></div>'}
            ${log.after  ? `<div><div class="text-sm" style="font-weight:600;color:var(--green-600);margin-bottom:4px">After</div><pre style="font-size:11px;background:var(--gray-100);border-radius:4px;padding:var(--sp-2);overflow:auto;max-height:160px;white-space:pre-wrap">${JSON.stringify(log.after, null, 2)}</pre></div>` : '<div></div>'}
          </div>
        </td>
      </tr>` : ''}`;
  }

  function _pagerHtml(page, pages) {
    if (pages <= 1) return '';
    return `
      <div class="pagination" style="display:flex;align-items:center;justify-content:flex-end;gap:var(--sp-2);padding:var(--sp-3) 0">
        <button class="btn btn-secondary btn-sm" id="al-prev" ${page <= 1 ? 'disabled' : ''}>← Prev</button>
        <span class="text-sm text-muted">Page ${page} of ${pages}</span>
        <button class="btn btn-secondary btn-sm" id="al-next" ${page >= pages ? 'disabled' : ''}>Next →</button>
      </div>`;
  }

  async function _render() {
    const table    = _el.querySelector('#al-table-body');
    const pagerTop = _el.querySelector('#al-pager-top');
    const pagerBot = _el.querySelector('#al-pager-bot');
    if (!table) return;

    table.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:var(--sp-6);color:var(--gray-400)">Loading…</td></tr>`;
    if (pagerTop) pagerTop.innerHTML = '';
    if (pagerBot) pagerBot.innerHTML = '';

    try {
      const data       = await Api.rGet(_buildUrl());
      const logs       = data.logs        || [];
      const total      = data.total       || 0;
      const pages      = data.pages       || 1;
      const page       = data.page        || 1;
      const actionLabels = data.action_labels || {};

      const countEl = _el.querySelector('#al-count');
      if (countEl) countEl.textContent = `${total.toLocaleString('en-IN')} events`;

      if (!logs.length) {
        table.innerHTML = `<tr><td colspan="5">${DashUI.emptyState({ icon: '🔍', title: 'No events found', body: 'Try adjusting your filters.' })}</td></tr>`;
        return;
      }

      table.innerHTML = logs.map(l => _rowHtml(l, actionLabels)).join('');

      const pager = _pagerHtml(page, pages);
      if (pagerTop) pagerTop.innerHTML = pager;
      if (pagerBot) pagerBot.innerHTML = pager;

      // Expand/collapse diff rows
      _el.querySelectorAll('.audit-expand-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const detailRow = _el.querySelector(`#audit-detail-${btn.dataset.logId}`);
          if (!detailRow) return;
          const open = detailRow.style.display !== 'none';
          detailRow.style.display = open ? 'none' : '';
          btn.textContent = open ? '▸' : '▾';
        });
      });

      // Pagination
      _el.querySelectorAll('#al-prev').forEach(b => b.addEventListener('click', () => {
        if (_state.page > 1) { _state.page--; _render(); window.scrollTo(0, 0); }
      }));
      _el.querySelectorAll('#al-next').forEach(b => b.addEventListener('click', () => {
        if (_state.page < pages) { _state.page++; _render(); window.scrollTo(0, 0); }
      }));

    } catch (err) {
      table.innerHTML = `<tr><td colspan="5">${DashUI.errorState(err.message)}</td></tr>`;
    }
  }

  async function _loadActionFilter() {
    try {
      const data = await Api.rGet('/audit-log/actions');
      const sel  = _el.querySelector('#al-action-filter');
      if (!sel || !data.actions) return;
      const labels = data.action_labels || {};
      (data.actions || []).forEach(a => {
        const opt    = document.createElement('option');
        opt.value    = a;
        opt.textContent = labels[a] || a;
        sel.appendChild(opt);
      });
    } catch (_) {}
  }

  async function init(el) {
    _el = el;
    Object.assign(_state, { page: 1, action: '', actor_search: '', date_from: '', date_to: '', entity_type: '' });

    el.innerHTML = `
      <div class="toolbar" style="flex-wrap:wrap;gap:var(--sp-2)">
        <div class="toolbar-left" style="flex-wrap:wrap;gap:var(--sp-2)">

          <input id="al-actor-search" type="search" class="input input-sm"
            placeholder="Search actor or email…" style="width:200px"
            value="${_state.actor_search}" />

          <select id="al-action-filter" class="input input-sm" style="width:180px">
            <option value="">All actions</option>
          </select>

          <input id="al-date-from" type="date" class="input input-sm" title="From date" />
          <input id="al-date-to"   type="date" class="input input-sm" title="To date" />

        </div>
        <div class="toolbar-right">
          <span id="al-count" class="text-sm text-muted"></span>
        </div>
      </div>

      <div id="al-pager-top"></div>

      <div class="table-wrap" style="margin-top:var(--sp-3)">
        <table>
          <thead>
            <tr>
              <th style="white-space:nowrap">Time</th>
              <th>Action</th>
              <th>Actor</th>
              <th>Entity</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="al-table-body">
            <tr><td colspan="5" style="text-align:center;padding:var(--sp-6);color:var(--gray-400)">Loading…</td></tr>
          </tbody>
        </table>
      </div>

      <div id="al-pager-bot"></div>`;

    // Bind filters
    el.querySelector('#al-actor-search').addEventListener('input', e => {
      _debounce(() => { _state.actor_search = e.target.value.trim(); _state.page = 1; _render(); });
    });

    el.querySelector('#al-action-filter').addEventListener('change', e => {
      _state.action = e.target.value; _state.page = 1; _render();
    });

    el.querySelector('#al-date-from').addEventListener('change', e => {
      _state.date_from = e.target.value; _state.page = 1; _render();
    });

    el.querySelector('#al-date-to').addEventListener('change', e => {
      _state.date_to = e.target.value; _state.page = 1; _render();
    });

    await Promise.all([_loadActionFilter(), _render()]);
  }

  return { init };
})();
