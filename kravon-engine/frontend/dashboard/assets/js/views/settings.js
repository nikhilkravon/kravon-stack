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

  async function init(el) {
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
        <div class="card">
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

        <!-- Reviews -->
        <div class="card">
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
        <div class="card">
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
        <div class="card">
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
        <div class="card">
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
  }

  return { init };
})();
