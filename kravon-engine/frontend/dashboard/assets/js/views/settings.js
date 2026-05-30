'use strict';

const SettingsView = (() => {

  async function init(el) {
    el.innerHTML = `<div class="skeleton skeleton-line wide" style="height:300px"></div>`;

    let config;
    try {
      const slug = Auth.state().slug;
      const data = await fetch(`${window.KRAVON_API_BASE || 'http://localhost:3000'}/v1/restaurants/${slug}/config`);
      const json = await data.json();
      config = json.config || {};
    } catch (err) {
      el.innerHTML = `<div class="empty-state">Failed to load config: ${err.message}</div>`;
      return;
    }

    const caps = config.capabilities || {};

    el.innerHTML = `
      <div style="max-width:560px">
        <div class="card" style="margin-bottom:var(--sp-5)">
          <div class="card-header"><span class="card-title">Restaurant details</span></div>
          <form id="settings-form">
            <div class="card-body">
              <div class="form-group">
                <label>Restaurant name</label>
                <input name="name" type="text" value="${_esc(config.brand?.name || '')}" maxlength="150">
              </div>
              <div class="form-group">
                <label>Tagline</label>
                <input name="tagline" type="text" value="${_esc(config.brand?.tagline || '')}" maxlength="300">
              </div>
              <div class="form-group">
                <label>Email</label>
                <input name="email" type="email" value="${_esc(config.contact?.email || '')}" maxlength="150">
              </div>
              <div class="form-group">
                <label>Hours display</label>
                <input name="hours_display" type="text" placeholder="e.g. Mon–Sat 11 AM – 11 PM" value="${_esc(config.hours?.display || '')}" maxlength="100">
              </div>
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
              <p id="settings-error"   class="form-error" hidden></p>
              <p id="settings-success" class="text-sm" style="color:var(--green-600)" hidden>Saved successfully.</p>
            </div>
            <div style="display:flex;justify-content:flex-end;padding:12px 20px;border-top:1px solid var(--gray-100)">
              <button type="submit" class="btn btn-primary" id="settings-save">Save changes</button>
            </div>
          </form>
        </div>

        <div class="card">
          <div class="card-header"><span class="card-title">Products enabled</span></div>
          <div class="card-body">
            <div style="display:flex;flex-direction:column;gap:var(--sp-3)">
              ${_productRow('Presence',       caps.website)}
              ${_productRow('Online Orders',  caps.orderManagement)}
              ${_productRow('Tables',         caps.tables)}
              ${_productRow('Catering',       caps.catering)}
              ${_productRow('Insights',       caps.analytics)}
            </div>
            <p class="text-sm text-muted" style="margin-top:var(--sp-4)">Products are controlled by your plan. Contact support to change.</p>
          </div>
          <div class="card-header" style="border-top:1px solid var(--gray-100);border-bottom:none">
            <span class="card-title">Plan</span>
            <span class="plan-badge" data-plan="${caps.plan || 'starter'}" style="font-size:13px;padding:3px 10px">${caps.plan || 'starter'}</span>
          </div>
        </div>
      </div>`;

    el.querySelector('#settings-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd  = new FormData(e.target);
      const btn = el.querySelector('#settings-save');
      const err = el.querySelector('#settings-error');
      const ok  = el.querySelector('#settings-success');
      err.hidden = true; ok.hidden = true;
      btn.disabled = true; btn.textContent = 'Saving…';

      const body = {};
      const name         = fd.get('name')?.trim();
      const tagline      = fd.get('tagline')?.trim();
      const email        = fd.get('email')?.trim();
      const hours        = fd.get('hours_display')?.trim();
      const deliveryFee  = fd.get('delivery_fee');
      const freeAbove    = fd.get('free_delivery_above');

      if (name)    body.name         = name;
      if (tagline) body.tagline       = tagline;
      if (email)   body.email         = email;
      if (hours)   body.hours_display = hours;
      if (deliveryFee !== '')  body.delivery_fee         = Number(deliveryFee);
      if (freeAbove   !== '')  body.free_delivery_above  = Number(freeAbove);

      try {
        await Api.rPatch('/config', body);
        ok.hidden = false;
        setTimeout(() => { ok.hidden = true; }, 3000);
      } catch (ex) {
        err.textContent = ex.message; err.hidden = false;
      } finally {
        btn.disabled = false; btn.textContent = 'Save changes';
      }
    });
  }

  function _productRow(label, enabled) {
    const icon  = enabled ? '✓' : '✕';
    const color = enabled ? 'var(--green-600)' : 'var(--gray-400)';
    return `<div style="display:flex;align-items:center;gap:var(--sp-3)">
      <span style="color:${color};font-weight:700;width:16px;text-align:center">${icon}</span>
      <span style="font-size:13px;color:${enabled ? 'var(--gray-800)' : 'var(--gray-400)'}">${label}</span>
    </div>`;
  }

  function _esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return { init };
})();
