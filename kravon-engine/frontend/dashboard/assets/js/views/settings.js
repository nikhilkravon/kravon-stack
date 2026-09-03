'use strict';

const SettingsView = (() => {

  function _esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function _cap(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  }

  function _productRow(label, enabled) {
    const color = enabled ? 'var(--green-600)' : 'var(--gray-400)';
    return `<div style="display:flex;align-items:center;gap:var(--sp-3)">
      <span style="color:${color};font-weight:700;font-size:16px">${enabled ? '✓' : '✕'}</span>
      <span style="font-size:13px;color:${enabled ? 'var(--gray-800)' : 'var(--gray-400)'}">${label}</span>
    </div>`;
  }

  // ── General / Payments / Security tab content ─────────────────────────────
  // All markup and bind logic below is unchanged from before the tab merge —
  // only the outer container and tab shell are new.
  async function _initConfigTabs(el) {
    el.innerHTML = `<div class="skeleton skeleton-line wide" style="height:300px"></div>`;

    let config;
    try {
      const data = await Api.rGet('/config');
      config = data.config || {};
    } catch (err) {
      el.innerHTML = DashUI.errorState(err.message);
      return;
    }

    const caps = config.capabilities || {};
    const plan = caps.plan || 'starter';

    el.innerHTML = `
      <div style="max-width:600px;display:flex;flex-direction:column;gap:var(--sp-5)">

        <!-- Delivery pricing -->
        <div class="card" data-settings-group="general">
          <div class="card-header"><span class="card-title">Delivery pricing</span></div>
          <form id="settings-delivery">
            <div class="card-body">
              <div class="form-row">
                <div class="form-group">
                  <label>Delivery fee (₹)</label>
                  <input name="delivery_fee" type="number" min="0" step="1" value="${config.order?.deliveryFee ?? ''}">
                </div>
                <div class="form-group">
                  <label>Free delivery above (₹)</label>
                  <input name="free_delivery_above" type="number" min="0" step="1" value="${config.order?.freeDeliveryAbove ?? ''}">
                </div>
              </div>
            </div>
            <div style="display:flex;justify-content:flex-end;padding:12px 20px;border-top:1px solid var(--gray-100)">
              <button type="submit" class="btn btn-primary" id="delivery-save">Save</button>
            </div>
          </form>
        </div>

        <!-- GST -->
        <div class="card" data-settings-group="general">
          <div class="card-header"><span class="card-title">GST</span></div>
          <form id="settings-gst">
            <div class="card-body">
              <div class="form-group">
                <label style="display:flex;align-items:center;gap:var(--sp-2);cursor:pointer">
                  <input type="checkbox" name="gst_enabled" id="gst-enabled-toggle" ${config.gst?.enabled ? 'checked' : ''}>
                  <span>GST enabled</span>
                </label>
              </div>
              <div id="gst-fields" style="display:${config.gst?.enabled ? 'block' : 'none'}">
                <div class="form-group">
                  <label>GSTIN</label>
                  <input name="gstin" type="text" value="${_esc(config.gst?.gstin || '')}" maxlength="15" placeholder="27ABCDE1234F1Z5" style="text-transform:uppercase">
                  <span class="text-sm text-muted" style="margin-top:4px">15-character GST Identification Number</span>
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label>CGST rate (%)</label>
                    <input name="cgst_rate" type="number" min="0" max="14" step="0.5" value="${config.gst?.cgst_rate ?? 2.5}" placeholder="2.5">
                  </div>
                  <div class="form-group">
                    <label>SGST rate (%)</label>
                    <input name="sgst_rate" type="number" min="0" max="14" step="0.5" value="${config.gst?.sgst_rate ?? 2.5}" placeholder="2.5">
                  </div>
                </div>
                <div class="form-group">
                  <label style="display:flex;align-items:center;gap:var(--sp-2);cursor:pointer">
                    <input type="radio" name="gst_mode" value="inclusive" ${config.gst?.inclusive !== false ? 'checked' : ''}>
                    <span>Inclusive — menu prices already include GST</span>
                  </label>
                  <label style="display:flex;align-items:center;gap:var(--sp-2);cursor:pointer;margin-top:var(--sp-2)">
                    <input type="radio" name="gst_mode" value="exclusive" ${config.gst?.inclusive === false ? 'checked' : ''}>
                    <span>Exclusive — GST added on top of menu prices</span>
                  </label>
                  <span class="text-sm text-muted" style="margin-top:var(--sp-2);display:block">Inclusive is standard for Indian restaurants.</span>
                </div>
              </div>
              <p id="gst-error" class="form-error" hidden></p>
            </div>
            <div style="display:flex;justify-content:flex-end;padding:12px 20px;border-top:1px solid var(--gray-100)">
              <button type="submit" class="btn btn-primary" id="gst-save">Save</button>
            </div>
          </form>
        </div>

        <!-- Ordering switch -->
        <div class="card" data-settings-group="general">
          <div class="card-header"><span class="card-title">Ordering</span></div>
          <div class="card-body">
            <label style="display:flex;align-items:center;gap:var(--sp-3);cursor:pointer">
              <input type="checkbox" id="accepts-orders-toggle" ${config.hours?.acceptsOrders !== false ? 'checked' : ''}>
              <span>Accepting orders</span>
            </label>
            <p class="text-sm text-muted" style="margin-top:8px">
              Uncheck to close ordering for all customers (Orders and Tables products). They will see a "We're closed" screen.
            </p>
            <p id="accepts-orders-status" class="text-sm" style="margin-top:8px"></p>
          </div>
        </div>

        <!-- Reservations -->
        <div class="card" id="res-settings-card" data-settings-group="general">
          <div class="card-header">
            <span class="card-title">Reservations</span>
            <label style="display:flex;align-items:center;gap:var(--sp-2);cursor:pointer;font-size:13px">
              <input type="checkbox" id="res-open-toggle" ${config.reservations?.acceptsReservations !== false ? 'checked' : ''}>
              <span id="res-open-label">${config.reservations?.acceptsReservations !== false ? 'Open' : 'Closed'}</span>
            </label>
          </div>
          <div class="card-body">
            <div class="form-row" style="margin-bottom:var(--sp-4)">
              <div class="form-group">
                <label>Max advance booking <span class="text-muted">(days)</span></label>
                <input id="res-max-advance" type="number" min="1" max="365" value="${config.reservations?.maxAdvanceDays ?? 30}">
              </div>
              <div class="form-group">
                <label>Min lead time <span class="text-muted">(hours)</span></label>
                <input id="res-min-lead" type="number" min="0" max="168" step="0.5" value="${config.reservations?.minAdvanceHours ?? 2}">
              </div>
              <div class="form-group">
                <label>Max party size</label>
                <input id="res-max-party" type="number" min="1" max="100" value="${config.reservations?.maxPartySize ?? 12}">
              </div>
            </div>

            <div style="margin-bottom:var(--sp-3)">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-3)">
                <span class="text-sm" style="font-weight:600">Available slots</span>
                <button type="button" class="btn btn-secondary btn-sm" id="res-add-slot">+ Add slot</button>
              </div>
              <div style="font-size:11px;color:var(--gray-400);margin-bottom:var(--sp-3)">
                Define which days and times guests can book. Leave empty to allow any time within operating hours.
              </div>
              <div id="res-slots-list"></div>
            </div>

            <p id="res-save-status" class="text-sm" style="margin-bottom:var(--sp-3)"></p>
          </div>
          <div style="display:flex;justify-content:flex-end;padding:12px 20px;border-top:1px solid var(--gray-100)">
            <button class="btn btn-primary" id="res-save">Save reservations</button>
          </div>
        </div>

        <!-- Reviews -->
        <div class="card" data-settings-group="general">
          <div class="card-header"><span class="card-title">Reviews</span></div>
          <form id="settings-reviews">
            <div class="card-body">
              <div class="form-row">
                <div class="form-group">
                  <label>Review threshold <span class="text-muted">(stars to trigger Google redirect)</span></label>
                  <select name="review_threshold">
                    ${[1,2,3,4,5].map(n => `<option value="${n}" ${(config.tables?.reviewThreshold ?? 4) === n ? 'selected' : ''}>${n} star${n>1?'s':''}</option>`).join('')}
                  </select>
                </div>
                <div class="form-group">
                  <label>Google review URL</label>
                  <input name="google_review_url" type="url" value="${_esc(config.tables?.googleReviewUrl || '')}" maxlength="300" placeholder="https://g.page/r/…">
                </div>
              </div>
            </div>
            <div style="display:flex;justify-content:flex-end;padding:12px 20px;border-top:1px solid var(--gray-100)">
              <button type="submit" class="btn btn-primary" id="reviews-save">Save</button>
            </div>
          </form>
        </div>

        <!-- Payments -->
        <div class="card" data-settings-group="payments">
          <div class="card-header">
            <span class="card-title">Razorpay payments</span>
            ${config.capabilities?.payments
              ? '<span class="badge badge-delivered">Configured</span>'
              : '<span class="badge badge-cancelled">Not configured</span>'}
          </div>
          <form id="settings-payments">
            <div class="card-body">
              <div class="form-group">
                <label>Key ID <span class="text-muted">(public)</span></label>
                <input name="razorpay_key_id" type="text" value="${_esc(config.tables?.razorpayKeyId || '')}" maxlength="40" placeholder="rzp_live_…">
              </div>
              <div class="form-group">
                <label>Key Secret</label>
                <input name="razorpay_key_secret" type="password" value="" maxlength="200" placeholder="Leave blank to keep current">
                <span class="text-sm text-muted" style="margin-top:4px">Secret is write-only — leave blank to keep current value.</span>
              </div>
            </div>
            <div style="display:flex;justify-content:flex-end;padding:12px 20px;border-top:1px solid var(--gray-100)">
              <button type="submit" class="btn btn-primary" id="payments-save">Save</button>
            </div>
          </form>
        </div>

        <!-- Plan & products -->
        <div class="card" data-settings-group="payments">
          <div class="card-header">
            <span class="card-title">Products enabled</span>
            <span class="plan-badge" data-plan="${plan}">${_cap(plan)}</span>
          </div>
          <div class="card-body">
            <div style="display:flex;flex-direction:column;gap:var(--sp-3)">
              ${_productRow('Presence',       caps.website)}
              ${_productRow('Online Orders',  caps.orderManagement)}
              ${_productRow('Tables',         caps.tables)}
              ${_productRow('Catering',       caps.catering)}
              ${_productRow('Insights',       caps.analytics)}
            </div>
            <p class="text-sm text-muted" style="margin-top:var(--sp-4)">
              Products are managed per your subscription plan. Contact support to change.
            </p>
          </div>
        </div>

        <!-- Security -->
        <div class="card" data-settings-group="security">
          <div class="card-header"><span class="card-title">Security</span></div>
          <form id="settings-security">
            <div class="card-body">
              <div class="form-group">
                <label>Current password</label>
                <input name="current_password" type="password" maxlength="200" autocomplete="current-password">
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label>New password</label>
                  <input name="new_password" type="password" minlength="8" maxlength="200" autocomplete="new-password" placeholder="Min 8 characters">
                </div>
                <div class="form-group">
                  <label>Confirm new password</label>
                  <input name="confirm_password" type="password" maxlength="200" autocomplete="new-password">
                </div>
              </div>
              <p id="security-error" class="form-error" hidden></p>
            </div>
            <div style="display:flex;justify-content:flex-end;padding:12px 20px;border-top:1px solid var(--gray-100)">
              <button type="submit" class="btn btn-primary" id="security-save">Change password</button>
            </div>
          </form>
        </div>

      </div>`;

    // Generic form submit helper
    function _bindForm(formId, btnId, fields) {
      const form = el.querySelector(`#${formId}`);
      const btn  = el.querySelector(`#${btnId}`);
      if (!form || !btn) return;

      form.addEventListener('submit', async e => {
        e.preventDefault();
        const fd   = new FormData(form);
        const body = {};
        for (const f of fields) {
          const v = fd.get(f);
          if (v === null || v === '') continue;
          if (f === 'delivery_fee' || f === 'free_delivery_above') body[f] = Number(v);
          else if (f === 'review_threshold') body[f] = parseInt(v, 10);
          else body[f] = v;
        }
        if (!Object.keys(body).length) {
          DashUI.toast('Nothing to save.', 'info');
          return;
        }
        btn.disabled = true; btn.textContent = 'Saving…';
        try {
          await Api.rPatch('/config', body);
          DashUI.toast('Saved successfully.', 'success');
        } catch (ex) {
          DashUI.toast(ex.message || 'Could not save.', 'error');
        } finally {
          btn.disabled = false; btn.textContent = 'Save';
        }
      });
    }

    _bindForm('settings-delivery', 'delivery-save', ['delivery_fee','free_delivery_above']);
    _bindForm('settings-reviews',  'reviews-save',  ['review_threshold','google_review_url']);

    // Accepts orders toggle — saves immediately on change
    const acceptsOrdersToggle = el.querySelector('#accepts-orders-toggle');
    const acceptsOrdersStatus = el.querySelector('#accepts-orders-status');
    if (acceptsOrdersToggle) {
      acceptsOrdersToggle.addEventListener('change', async (e) => {
        const willDisable = !e.target.checked;
        if (willDisable) {
          const ok = await DashUI.confirm(
            'Stop accepting new orders? Customers will see the restaurant as closed.',
            { title: 'Close ordering', confirmLabel: 'Yes, close ordering', danger: true }
          );
          if (!ok) { e.target.checked = true; return; }
        }
        const val = e.target.checked;
        try {
          await Api.rPatch('/config', { accepts_orders: val });
          if (acceptsOrdersStatus) {
            acceptsOrdersStatus.textContent = val ? '✓ Ordering is now open' : '✕ Ordering is now closed';
            acceptsOrdersStatus.style.color = val ? 'var(--green-600)' : 'var(--red-600, #c0392b)';
          }
        } catch (ex) {
          DashUI.toast(ex.message || 'Could not update ordering status.', 'error');
          e.target.checked = !val;
        }
      });
    }

    // ── Reservations settings ────────────────────────────────────────────
    const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

    function _resSlotRow(slot) {
      return `
        <div class="res-slot-row" style="display:grid;grid-template-columns:140px 90px 90px 80px auto;gap:var(--sp-2);align-items:center;margin-bottom:var(--sp-2)">
          <select class="slot-day">
            ${DAY_NAMES.map((d, i) => `<option value="${i}" ${slot?.day === i ? 'selected' : ''}>${d}</option>`).join('')}
          </select>
          <input class="slot-open"  type="time" value="${slot?.open  || '12:00'}">
          <input class="slot-close" type="time" value="${slot?.close || '22:00'}">
          <input class="slot-covers" type="number" min="0" max="999" placeholder="Covers" title="Max covers (0 = unlimited)" value="${slot?.max_covers ?? ''}">
          <button type="button" class="btn btn-ghost btn-sm slot-remove" style="padding:4px 8px">✕</button>
        </div>`;
    }

    const slotsList = el.querySelector('#res-slots-list');
    const initSlots = config.reservations?.slots || [];

    function _renderSlots(slots) {
      slotsList.innerHTML = slots.length
        ? `<div style="display:grid;grid-template-columns:140px 90px 90px 80px auto;gap:var(--sp-2);margin-bottom:var(--sp-1)">
            <span class="text-sm text-muted">Day</span><span class="text-sm text-muted">Open</span>
            <span class="text-sm text-muted">Close</span><span class="text-sm text-muted">Max covers</span><span></span>
           </div>` + slots.map(_resSlotRow).join('')
        : '<p class="text-sm text-muted">No slots configured — all times accepted.</p>';
      slotsList.querySelectorAll('.slot-remove').forEach(btn => {
        btn.addEventListener('click', () => btn.closest('.res-slot-row').remove());
      });
    }

    _renderSlots(initSlots);

    el.querySelector('#res-add-slot').addEventListener('click', () => {
      const row = document.createElement('div');
      row.innerHTML = _resSlotRow(null);
      const newRow = row.firstElementChild;
      newRow.querySelector('.slot-remove').addEventListener('click', () => newRow.remove());
      if (!slotsList.querySelector('.res-slot-row')) slotsList.innerHTML = '';
      slotsList.appendChild(newRow);
      // Ensure header exists
      if (!slotsList.querySelector('.text-muted')) {
        const header = document.createElement('div');
        header.style.cssText = 'display:grid;grid-template-columns:140px 90px 90px 80px auto;gap:var(--sp-2);margin-bottom:var(--sp-1)';
        header.innerHTML = `<span class="text-sm text-muted">Day</span><span class="text-sm text-muted">Open</span>
          <span class="text-sm text-muted">Close</span><span class="text-sm text-muted">Max covers</span><span></span>`;
        slotsList.insertBefore(header, slotsList.firstChild);
      }
    });

    // Open/closed toggle — updates label immediately
    const resOpenToggle = el.querySelector('#res-open-toggle');
    const resOpenLabel  = el.querySelector('#res-open-label');
    if (resOpenToggle) {
      resOpenToggle.addEventListener('change', () => {
        resOpenLabel.textContent = resOpenToggle.checked ? 'Open' : 'Closed';
      });
    }

    el.querySelector('#res-save').addEventListener('click', async () => {
      const btn       = el.querySelector('#res-save');
      const statusEl  = el.querySelector('#res-save-status');
      const maxAdv    = parseInt(el.querySelector('#res-max-advance').value, 10) || 30;
      const minLead   = parseFloat(el.querySelector('#res-min-lead').value)      || 2;
      const maxParty  = parseInt(el.querySelector('#res-max-party').value, 10)   || 12;
      const accepting = resOpenToggle ? resOpenToggle.checked : true;

      const slots = [];
      slotsList.querySelectorAll('.res-slot-row').forEach(row => {
        const day    = parseInt(row.querySelector('.slot-day').value, 10);
        const open   = row.querySelector('.slot-open').value;
        const close  = row.querySelector('.slot-close').value;
        const covers = parseInt(row.querySelector('.slot-covers').value, 10);
        if (open && close && open < close) {
          slots.push({ day, open, close, ...(covers > 0 ? { max_covers: covers } : {}) });
        }
      });

      btn.disabled = true; btn.textContent = 'Saving…';
      statusEl.textContent = '';
      try {
        await Api.rPatch('/config', {
          reservations: {
            accepts_reservations: accepting,
            max_advance_days:     maxAdv,
            min_advance_hours:    minLead,
            max_party_size:       maxParty,
            slots,
          },
        });
        statusEl.textContent = '✓ Saved';
        statusEl.style.color = 'var(--green-600)';
        DashUI.toast('Reservation settings saved.', 'success');
      } catch (ex) {
        statusEl.textContent = ex.message || 'Could not save.';
        statusEl.style.color = 'var(--red-600, #c0392b)';
      } finally {
        btn.disabled = false; btn.textContent = 'Save reservations';
      }
    });

    // GST — toggle show/hide fields
    const gstToggle = el.querySelector('#gst-enabled-toggle');
    const gstFields = el.querySelector('#gst-fields');
    if (gstToggle && gstFields) {
      gstToggle.addEventListener('change', () => {
        gstFields.style.display = gstToggle.checked ? 'block' : 'none';
      });
    }

    // GST form submit
    el.querySelector('#settings-gst').addEventListener('submit', async e => {
      e.preventDefault();
      const fd    = new FormData(e.target);
      const btn   = el.querySelector('#gst-save');
      const errEl = el.querySelector('#gst-error');
      errEl.hidden = true;

      const enabled   = gstToggle.checked;
      const gstin     = fd.get('gstin')?.trim().toUpperCase() || null;
      const cgst_rate = parseFloat(fd.get('cgst_rate'));
      const sgst_rate = parseFloat(fd.get('sgst_rate'));
      const inclusive = fd.get('gst_mode') === 'inclusive';

      if (enabled) {
        if (gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstin)) {
          errEl.textContent = 'Invalid GSTIN format. Must be 15 characters (e.g. 27ABCDE1234F1Z5).';
          errEl.hidden = false;
          return;
        }
        if (isNaN(cgst_rate) || isNaN(sgst_rate)) {
          errEl.textContent = 'Enter valid CGST and SGST rates.';
          errEl.hidden = false;
          return;
        }
      }

      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        await Api.rPatch('/config', {
          gst: { enabled, gstin: gstin || null, cgst_rate: cgst_rate || 0, sgst_rate: sgst_rate || 0, inclusive },
        });
        DashUI.toast('GST settings saved.', 'success');
      } catch (ex) {
        errEl.textContent = ex.message || 'Could not save GST settings.';
        errEl.hidden = false;
      } finally {
        btn.disabled = false; btn.textContent = 'Save';
      }
    });

    // Security — change password
    el.querySelector('#settings-security').addEventListener('submit', async e => {
      e.preventDefault();
      const fd      = new FormData(e.target);
      const btn     = el.querySelector('#security-save');
      const errEl   = el.querySelector('#security-error');
      const current = fd.get('current_password')?.trim();
      const next    = fd.get('new_password')?.trim();
      const confirm = fd.get('confirm_password')?.trim();

      errEl.hidden = true;
      if (!current || !next) { errEl.textContent = 'Please fill in all fields.'; errEl.hidden = false; return; }
      if (next !== confirm)  { errEl.textContent = 'New passwords do not match.'; errEl.hidden = false; return; }

      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        const base  = window.KRAVON_API_BASE || 'http://localhost:3000';
        const token = await Auth.getToken();
        const res   = await fetch(`${base}/v1/auth/change-password`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body:    JSON.stringify({ current_password: current, new_password: next }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not change password.');
        DashUI.toast('Password changed. Please log in again.', 'success');
        e.target.reset();
        setTimeout(() => { Auth.clear(); location.reload(); }, 1500);
      } catch (ex) {
        errEl.textContent = ex.message; errEl.hidden = false;
      } finally {
        btn.disabled = false; btn.textContent = 'Change password';
      }
    });

    // Payments form — only send key_secret if filled
    el.querySelector('#settings-payments').addEventListener('submit', async e => {
      e.preventDefault();
      const fd  = new FormData(e.target);
      const btn = el.querySelector('#payments-save');
      const body = {};
      const keyId     = fd.get('razorpay_key_id')?.trim();
      const keySecret = fd.get('razorpay_key_secret')?.trim();
      if (keyId)     body.razorpay_key_id     = keyId;
      if (keySecret) body.razorpay_key_secret  = keySecret;
      if (!Object.keys(body).length) {
        DashUI.toast('Enter at least a Key ID to save.', 'info');
        return;
      }
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        await Api.rPatch('/config', body);
        DashUI.toast('Payment credentials saved.', 'success');
        // Clear the secret field
        el.querySelector('[name="razorpay_key_secret"]').value = '';
      } catch (ex) {
        DashUI.toast(ex.message || 'Could not save.', 'error');
      } finally {
        btn.disabled = false; btn.textContent = 'Save';
      }
    });

    _showConfigGroup(el, _activeConfigGroup);
  }

  // Shows only the cards belonging to one tab (general/payments/security).
  // All cards for all three groups are rendered together by _initConfigTabs
  // in one pass (they share one /config fetch) — switching tabs is just a
  // visibility toggle, not a re-render, so no data is re-fetched.
  let _activeConfigGroup = 'general';
  function _showConfigGroup(el, group) {
    _activeConfigGroup = group;
    el.querySelectorAll('[data-settings-group]').forEach(card => {
      card.hidden = card.dataset.settingsGroup !== group;
    });
  }

  // ── Tab shell ───────────────────────────────────────────────────────────
  // "Settings" is one nav destination covering configuration, staff, payments,
  // and security (per the target IA) — General/Payments/Security tabs render
  // via _initConfigTabs (unchanged forms above); Staff delegates straight to
  // StaffView.init(), which owns its own table/modal and is not duplicated here.
  const TABS = [
    { key: 'general',  label: 'General' },
    { key: 'staff',    label: 'Staff' },
    { key: 'payments', label: 'Payments' },
    { key: 'security', label: 'Security' },
  ];

  async function init(el) {
    _activeConfigGroup = 'general';
    el.innerHTML = `
      <div class="tab-bar">
        ${TABS.map(t => `<button class="tab${t.key === 'general' ? ' active' : ''}" data-settings-tab="${t.key}">${t.label}</button>`).join('')}
      </div>
      <div id="settings-tab-body"></div>`;

    const body = el.querySelector('#settings-tab-body');
    let configLoaded = false;

    async function _showTab(tab) {
      el.querySelectorAll('[data-settings-tab]').forEach(b => b.classList.toggle('active', b.dataset.settingsTab === tab));

      if (tab === 'staff') {
        // StaffView.init() replaces body's entire innerHTML, wiping out the
        // General/Payments/Security cards — force a re-render next time one
        // of those tabs is selected, rather than toggling visibility on
        // elements that no longer exist.
        configLoaded = false;
        await StaffView.init(body);
        return;
      }

      // general/payments/security all live in the same rendered set of cards
      // (one /config fetch) — render once, then just toggle visibility,
      // unless the Staff tab wiped the container since the last render.
      if (!configLoaded) {
        await _initConfigTabs(body);
        configLoaded = true;
      }
      _showConfigGroup(body, tab);
    }

    el.querySelectorAll('[data-settings-tab]').forEach(btn => {
      btn.addEventListener('click', () => _showTab(btn.dataset.settingsTab));
    });

    await _showTab('general');
  }

  return { init };
})();
