'use strict';

const StaffView = (() => {

  function _ago(iso) {
    if (!iso) return 'Never';
    const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (diff < 60)    return `${diff}s ago`;
    if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }

  function _roleBadge(roles) {
    const r = (roles || [])[0] || 'staff';
    const map = { manager: 'badge-preparing', kitchen: 'badge-placed', staff: 'badge-pending' };
    return `<span class="badge ${map[r] || 'badge-pending'}">${r}</span>`;
  }

  async function _load(el) {
    const tbody = el.querySelector('#staff-tbody');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="6"><div class="skeleton skeleton-line" style="margin:12px 0"></div></td></tr>`;

    try {
      const data  = await Api.rGet('/staff');
      const staff = data.staff || [];
      const me    = Auth.state().staff?.id;

      if (!staff.length) {
        tbody.innerHTML = `<tr><td colspan="6">${DashUI.emptyState({
          icon: '👥', title: 'No staff yet',
          body: 'Add your first team member to give them dashboard access.',
        })}</td></tr>`;
        return;
      }

      tbody.innerHTML = staff.map(s => `
        <tr>
          <td>
            <div style="font-weight:500">${s.name}</div>
            <div class="text-sm text-muted">${s.email || '—'}</div>
          </td>
          <td>${_roleBadge(s.roles)}</td>
          <td class="text-sm">${s.phone || '—'}</td>
          <td>${s.is_active
            ? '<span class="badge badge-delivered">Active</span>'
            : '<span class="badge badge-cancelled">Inactive</span>'}</td>
          <td class="td-muted">${_ago(s.last_login_at)}</td>
          <td>
            <div style="display:flex;gap:var(--sp-1)">
              <button class="btn btn-ghost btn-sm staff-edit" data-id="${s.id}">Edit</button>
              ${s.id !== me ? `
                <button class="btn btn-danger btn-sm staff-toggle" data-id="${s.id}" data-active="${s.is_active}">
                  ${s.is_active ? 'Deactivate' : 'Activate'}
                </button>` : '<span class="text-sm text-muted">(you)</span>'}
            </div>
          </td>
        </tr>`).join('');

      el.querySelectorAll('.staff-toggle').forEach(btn => {
        btn.addEventListener('click', async () => {
          const activate = btn.dataset.active === 'true' ? false : true;
          const action   = activate ? 'Activate' : 'Deactivate';
          const ok = await DashUI.confirm(
            `${action} this staff member?`,
            { title: `${action} staff`, confirmLabel: action, danger: !activate }
          );
          if (!ok) return;
          btn.disabled = true;
          try {
            await Api.rPatch(`/staff/${btn.dataset.id}`, { is_active: activate });
            DashUI.toast(`Staff member ${activate ? 'activated' : 'deactivated'}.`, 'success');
            _load(el);
          } catch (err) {
            DashUI.toast(err.message, 'error');
            btn.disabled = false;
          }
        });
      });

      el.querySelectorAll('.staff-edit').forEach(btn => {
        btn.addEventListener('click', () => {
          const s = staff.find(x => x.id === btn.dataset.id);
          if (s) _openStaffModal(s, el);
        });
      });

    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6">${DashUI.errorState(err.message)}</td></tr>`;
    }
  }

  function _openStaffModal(existing = null, el) {
    const isEdit = !!existing;
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal-overlay" id="staff-modal">
        <div class="modal" style="max-width:420px">
          <div class="modal-header">
            <span class="modal-title">${isEdit ? 'Edit staff' : 'Add staff member'}</span>
            <button class="modal-close" id="staff-modal-close">✕</button>
          </div>
          <form id="staff-form">
            <div class="modal-body">
              <div class="form-group">
                <label>Name</label>
                <input name="name" type="text" value="${existing?.name || ''}" required maxlength="120">
              </div>
              <div class="form-group">
                <label>Email</label>
                <input name="email" type="email" value="${existing?.email || ''}" ${isEdit ? 'disabled' : 'required'} maxlength="120">
              </div>
              <div class="form-group">
                <label>Phone <span class="text-muted">(optional)</span></label>
                <input name="phone" type="tel" value="${existing?.phone || ''}" maxlength="30">
              </div>
              <div class="form-group">
                <label>Role</label>
                <select name="role">
                  <option value="staff"    ${existing?.roles?.[0] === 'staff'    ? 'selected' : ''}>Staff</option>
                  <option value="manager"  ${existing?.roles?.[0] === 'manager'  ? 'selected' : ''}>Manager</option>
                  <option value="kitchen"  ${existing?.roles?.[0] === 'kitchen'  ? 'selected' : ''}>Kitchen</option>
                  <option value="cashier"  ${existing?.roles?.[0] === 'cashier'  ? 'selected' : ''}>Cashier</option>
                  <option value="host"     ${existing?.roles?.[0] === 'host'     ? 'selected' : ''}>Host</option>
                  <option value="catering" ${existing?.roles?.[0] === 'catering' ? 'selected' : ''}>Catering</option>
                </select>
              </div>
              ${!isEdit ? `
              <div class="form-group">
                <label>Password</label>
                <input name="password" type="password" required minlength="8" maxlength="200" placeholder="Min 8 characters">
              </div>` : `
              <div class="form-group">
                <label>New password <span class="text-muted">(leave blank to keep current)</span></label>
                <input name="password" type="password" minlength="8" maxlength="200" placeholder="Leave blank to keep">
              </div>`}
              <p id="staff-modal-error" class="form-error" hidden></p>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" id="staff-modal-cancel">Cancel</button>
              <button type="submit" class="btn btn-primary">${isEdit ? 'Save' : 'Add staff'}</button>
            </div>
          </form>
        </div>
      </div>`);

    const overlay = document.getElementById('staff-modal');
    const close   = () => overlay.remove();
    overlay.querySelector('#staff-modal-close').onclick  = close;
    overlay.querySelector('#staff-modal-cancel').onclick = close;
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    overlay.querySelector('#staff-form').onsubmit = async e => {
      e.preventDefault();
      const fd  = new FormData(e.target);
      const btn = overlay.querySelector('[type=submit]');
      const err = overlay.querySelector('#staff-modal-error');
      btn.disabled = true; btn.textContent = 'Saving…';
      err.hidden = true;

      const body = {};
      const name     = fd.get('name')?.trim();
      const phone    = fd.get('phone')?.trim();
      const password = fd.get('password')?.trim();
      const role     = fd.get('role');
      if (name)     body.name  = name;
      if (phone)    body.phone = phone;
      if (password) body.password = password;
      // Only send role if it changed (avoids redundant DELETE+INSERT on every edit)
      if (role && (!isEdit || role !== existing?.roles?.[0])) body.role = role;
      if (!isEdit) {
        body.email = fd.get('email')?.trim();
      }

      try {
        if (isEdit) {
          await Api.rPatch(`/staff/${existing.id}`, body);
        } else {
          await Api.rPost('/staff', body);
        }
        close();
        DashUI.toast(isEdit ? 'Staff updated.' : 'Staff member added.', 'success');
        _load(el);
      } catch (ex) {
        err.textContent = ex.message; err.hidden = false;
        btn.disabled = false; btn.textContent = isEdit ? 'Save' : 'Add staff';
      }
    };
  }

  function init(el) {
    el.innerHTML = `
      <div class="toolbar">
        <div class="toolbar-left"></div>
        <div class="toolbar-right">
          <button id="add-staff-btn" class="btn btn-primary">+ Add staff</button>
        </div>
      </div>
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Staff member</th><th>Role</th><th>Phone</th>
                <th>Status</th><th>Last login</th><th>Actions</th>
              </tr>
            </thead>
            <tbody id="staff-tbody"></tbody>
          </table>
        </div>
      </div>`;

    el.querySelector('#add-staff-btn').addEventListener('click', () => _openStaffModal(null, el));
    _load(el);
  }

  return { init };
})();
