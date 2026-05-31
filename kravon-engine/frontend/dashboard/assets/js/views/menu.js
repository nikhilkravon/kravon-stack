'use strict';

const MenuView = (() => {

  let _categories = [];

  // ── Render helpers ──────────────────────────────────────────────────────────
  function _foodDot(type) {
    const cls = { veg: 'dot-veg', non_veg: 'dot-non_veg', egg: 'dot-egg', vegan: 'dot-vegan' }[type] || 'dot-veg';
    return `<span class="menu-item-dot ${cls}" title="${type || 'veg'}"></span>`;
  }

  function _itemRow(item, catId) {
    return `
      <div class="menu-item-row ${item.is_available ? '' : 'menu-item-unavailable'}" data-item-id="${item.id}">
        <div class="menu-item-info">
          ${_foodDot(item.food_type)}
          <span class="menu-item-name">${_esc(item.name)}</span>
          <span class="menu-item-price">₹ ${Number(item.price).toLocaleString('en-IN')}</span>
        </div>
        <div class="menu-item-actions">
          <label class="toggle" title="${item.is_available ? 'Mark 86\'d' : 'Mark available'}">
            <input type="checkbox" class="item-toggle" data-item-id="${item.id}" ${item.is_available ? 'checked' : ''}>
            <span class="toggle-track"></span>
            <span class="toggle-thumb"></span>
          </label>
          <button class="btn btn-ghost btn-sm" data-action="edit-item" data-item-id="${item.id}" data-cat-id="${catId}" aria-label="Edit ${_esc(item.name)}">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M9.5 1.5l3 3L4 13H1v-3L9.5 1.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
          </button>
          <button class="btn btn-danger btn-sm" data-action="delete-item" data-item-id="${item.id}" aria-label="Delete ${_esc(item.name)}">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2 3.5h10M5.5 3.5V2h3v1.5M5.5 6v4.5M8.5 6v4.5M3 3.5l.7 8h6.6l.7-8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </div>`;
  }

  function _categoryBlock(cat, open = false) {
    const items = (cat.items || []).map(i => _itemRow(i, cat.id)).join('');
    return `
      <div class="category-block" data-cat-id="${cat.id}">
        <div class="category-header">
          <div class="category-header-left">
            <span class="category-chevron ${open ? 'open' : ''}">▶</span>
            <span>${_esc(cat.name)}</span>
            <span class="text-muted text-sm">(${(cat.items || []).length})</span>
          </div>
          <div class="category-header-actions" onclick="event.stopPropagation()">
            <button class="btn btn-ghost btn-sm" data-action="edit-cat" data-cat-id="${cat.id}" aria-label="Edit category ${_esc(cat.name)}">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M9.5 1.5l3 3L4 13H1v-3L9.5 1.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
            </button>
            <button class="btn btn-danger btn-sm" data-action="delete-cat" data-cat-id="${cat.id}" aria-label="Delete category ${_esc(cat.name)}">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2 3.5h10M5.5 3.5V2h3v1.5M5.5 6v4.5M8.5 6v4.5M3 3.5l.7 8h6.6l.7-8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
        </div>
        <div class="category-items ${open ? 'open' : ''}">
          ${items}
          <div style="padding:12px 16px;border-top:1px solid var(--gray-100)">
            <button class="btn btn-secondary btn-sm" data-action="add-item" data-cat-id="${cat.id}">+ Add item</button>
          </div>
        </div>
      </div>`;
  }

  function _esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Modal ─────────────────────────────────────────────────────────────────
  function _openCategoryModal(cat = null) {
    const isEdit = !!cat;
    const title  = isEdit ? 'Edit category' : 'Add category';
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal-overlay" id="cat-modal">
        <div class="modal">
          <div class="modal-header">
            <span class="modal-title">${title}</span>
            <button class="modal-close" id="cat-modal-close">✕</button>
          </div>
          <form id="cat-form">
            <div class="modal-body">
              <div class="form-group">
                <label>Name</label>
                <input name="name" type="text" value="${_esc(cat?.name || '')}" required maxlength="150">
              </div>
              <div class="form-group">
                <label>Description <span class="text-muted">(optional)</span></label>
                <input name="description" type="text" value="${_esc(cat?.description || '')}" maxlength="500">
              </div>
              <p id="cat-modal-error" class="form-error" hidden></p>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" id="cat-modal-cancel">Cancel</button>
              <button type="submit" class="btn btn-primary" id="cat-modal-save">Save</button>
            </div>
          </form>
        </div>
      </div>`);

    const overlay = document.getElementById('cat-modal');
    const close   = () => overlay.remove();
    overlay.querySelector('#cat-modal-close').onclick  = close;
    overlay.querySelector('#cat-modal-cancel').onclick = close;

    overlay.querySelector('#cat-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd   = new FormData(e.target);
      const body = { name: fd.get('name'), description: fd.get('description') || null };
      const btn  = overlay.querySelector('#cat-modal-save');
      const err  = overlay.querySelector('#cat-modal-error');
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        if (isEdit) await Api.rPut(`/menu/categories/${cat.id}`, body);
        else        await Api.rPost('/menu/categories', body);
        close();
        await _reload();
      } catch (ex) {
        err.textContent = ex.message; err.hidden = false;
        btn.disabled = false; btn.textContent = 'Save';
      }
    };
  }

  function _openItemModal(catId, item = null) {
    const isEdit  = !!item;
    const cats    = _categories;
    const catOpts = cats.map(c => `<option value="${c.id}" ${c.id === catId ? 'selected' : ''}>${_esc(c.name)}</option>`).join('');

    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal-overlay" id="item-modal">
        <div class="modal" style="max-width:560px">
          <div class="modal-header">
            <span class="modal-title">${isEdit ? 'Edit item' : 'Add item'}</span>
            <button class="modal-close" id="item-modal-close">✕</button>
          </div>
          ${isEdit ? `
          <div class="tab-bar" style="padding:0 var(--sp-5);margin-bottom:0;border-bottom:1px solid var(--gray-200)">
            <button class="tab active" data-tab="details">Details</button>
            <button class="tab" data-tab="variants">Variants</button>
            <button class="tab" data-tab="customizations">Add-ons</button>
          </div>` : ''}
          <div id="item-tab-details">
            <form id="item-form">
              <div class="modal-body">
                <div class="form-group">
                  <label>Category</label>
                  <select name="category_id">${catOpts}</select>
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label>Name</label>
                    <input name="name" type="text" value="${_esc(item?.name || '')}" required maxlength="150">
                  </div>
                  <div class="form-group">
                    <label>Price (₹)</label>
                    <input name="price" type="number" min="0" step="0.01" value="${item?.price ?? ''}">
                  </div>
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label>Food type</label>
                    <select name="food_type">
                      ${['veg','non_veg','egg','vegan'].map(v => `<option value="${v}" ${(item?.food_type||'veg')===v?'selected':''}>${v.replace('_',' ')}</option>`).join('')}
                    </select>
                  </div>
                  <div class="form-group">
                    <label>Available</label>
                    <select name="is_available">
                      <option value="true"  ${item?.is_available !== false ? 'selected' : ''}>Yes</option>
                      <option value="false" ${item?.is_available === false  ? 'selected' : ''}>No (86'd)</option>
                    </select>
                  </div>
                </div>
                <div class="form-group">
                  <label>Description</label>
                  <input name="description" type="text" value="${_esc(item?.description || '')}" maxlength="500">
                </div>
                <div class="form-group">
                  <label>Image URL</label>
                  <input name="image_url" type="url" value="${_esc(item?.image_url || '')}" maxlength="500" placeholder="https://…">
                </div>
                <p id="item-modal-error" class="form-error" hidden></p>
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-secondary" id="item-modal-cancel">Cancel</button>
                <button type="submit" class="btn btn-primary" id="item-modal-save">Save</button>
              </div>
            </form>
          </div>
          ${isEdit ? `
          <div id="item-tab-variants" style="display:none">
            <div class="modal-body" style="min-height:200px">
              <div id="variants-list"></div>
              <button class="btn btn-secondary btn-sm" id="add-variant-btn" style="margin-top:var(--sp-3)">+ Add variant</button>
            </div>
          </div>
          <div id="item-tab-customizations" style="display:none">
            <div class="modal-body" style="min-height:200px">
              <div id="custom-groups-list"></div>
              <button class="btn btn-secondary btn-sm" id="add-group-btn" style="margin-top:var(--sp-3)">+ Add group</button>
            </div>
          </div>` : ''}
        </div>
      </div>`);

    const overlay = document.getElementById('item-modal');
    const close   = () => overlay.remove();
    overlay.querySelector('#item-modal-close').onclick  = close;
    overlay.querySelector('#item-modal-cancel')?.addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    // Tab switching
    if (isEdit) {
      overlay.querySelectorAll('.tab[data-tab]').forEach(tab => {
        tab.addEventListener('click', () => {
          overlay.querySelectorAll('.tab[data-tab]').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          ['details','variants','customizations'].forEach(t => {
            overlay.querySelector(`#item-tab-${t}`).style.display = tab.dataset.tab === t ? '' : 'none';
          });
          if (tab.dataset.tab === 'variants')       _loadVariants(overlay, item.id);
          if (tab.dataset.tab === 'customizations') _loadCustomizations(overlay, item.id);
        });
      });
    }

    // Details form submit
    overlay.querySelector('#item-form').onsubmit = async e => {
      e.preventDefault();
      const fd   = new FormData(e.target);
      const body = {
        category_id:  fd.get('category_id'),
        name:         fd.get('name'),
        price:        Number(fd.get('price')),
        food_type:    fd.get('food_type'),
        is_available: fd.get('is_available') === 'true',
        description:  fd.get('description') || null,
        image_url:    fd.get('image_url') || null,
      };
      const btn = overlay.querySelector('#item-modal-save');
      const err = overlay.querySelector('#item-modal-error');
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        if (isEdit) await Api.rPut(`/menu/items/${item.id}`, body);
        else        await Api.rPost('/menu/items', body);
        close();
        await _reload();
      } catch (ex) {
        err.textContent = ex.message; err.hidden = false;
        btn.disabled = false; btn.textContent = 'Save';
      }
    };
  }

  // ── Variants panel ────────────────────────────────────────────────────────
  async function _loadVariants(overlay, itemId) {
    const list = overlay.querySelector('#variants-list');
    list.innerHTML = '<div class="skeleton skeleton-line"></div>';
    try {
      const data     = await Api.rGet(`/menu/items/${itemId}/variants`);
      const variants = data.variants || [];
      list.innerHTML = variants.length
        ? variants.map(v => `
            <div class="menu-item-row" data-vid="${v.id}">
              <div class="menu-item-info">
                <span class="menu-item-name">${_esc(v.name)}</span>
                <span class="menu-item-price">₹ ${Number(v.price).toLocaleString('en-IN')}</span>
              </div>
              <div class="menu-item-actions">
                <button class="btn btn-danger btn-sm del-variant" data-vid="${v.id}">Remove</button>
              </div>
            </div>`).join('')
        : '<div class="text-sm text-muted">No variants yet.</div>';

      list.querySelectorAll('.del-variant').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            await Api.rDel(`/menu/items/${itemId}/variants/${btn.dataset.vid}`);
            _loadVariants(overlay, itemId);
          } catch { btn.disabled = false; }
        });
      });
    } catch (err) {
      list.innerHTML = `<div class="text-sm text-muted">Could not load variants.</div>`;
    }

    const addBtn = overlay.querySelector('#add-variant-btn');
    addBtn.onclick = () => {
      // Replace button with inline add form
      addBtn.style.display = 'none';
      const form = document.createElement('div');
      form.className = 'inline-add-form';
      form.innerHTML = `
        <div class="form-row" style="margin-bottom:0">
          <div class="form-group" style="margin-bottom:0">
            <input id="v-name" type="text" placeholder="Variant name (e.g. Small)" maxlength="150" autofocus>
          </div>
          <div class="form-group" style="margin-bottom:0">
            <input id="v-price" type="number" min="0" step="0.01" placeholder="Price ₹">
          </div>
        </div>
        <div style="display:flex;gap:var(--sp-2);margin-top:var(--sp-2)">
          <button class="btn btn-primary btn-sm" id="v-save">Add variant</button>
          <button class="btn btn-ghost btn-sm" id="v-cancel">Cancel</button>
        </div>
        <p class="form-error" id="v-err" hidden></p>`;
      addBtn.parentNode.insertBefore(form, addBtn.nextSibling);

      form.querySelector('#v-cancel').onclick = () => { form.remove(); addBtn.style.display = ''; };
      form.querySelector('#v-save').onclick = async () => {
        const name  = form.querySelector('#v-name').value.trim();
        const price = form.querySelector('#v-price').value;
        const err   = form.querySelector('#v-err');
        if (!name) { err.textContent = 'Name is required.'; err.hidden = false; return; }
        if (!price) { err.textContent = 'Price is required.'; err.hidden = false; return; }
        const saveBtn = form.querySelector('#v-save');
        saveBtn.disabled = true; saveBtn.textContent = 'Adding…';
        try {
          await Api.rPost(`/menu/items/${itemId}/variants`, { name, price: Number(price) });
          form.remove(); addBtn.style.display = '';
          _loadVariants(overlay, itemId);
        } catch (ex) {
          err.textContent = ex.message; err.hidden = false;
          saveBtn.disabled = false; saveBtn.textContent = 'Add variant';
        }
      };
    };
  }

  // ── Customizations panel ──────────────────────────────────────────────────
  async function _loadCustomizations(overlay, itemId) {
    const list = overlay.querySelector('#custom-groups-list');
    list.innerHTML = '<div class="skeleton skeleton-line"></div>';
    try {
      const data   = await Api.rGet(`/menu/items/${itemId}/customizations`);
      const groups = data.groups || [];

      list.innerHTML = groups.length
        ? groups.map(g => `
            <div class="category-block" style="margin-bottom:var(--sp-3)" data-gid="${g.id}">
              <div class="category-header" style="cursor:default">
                <div class="category-header-left">
                  <span style="font-weight:600">${_esc(g.name)}</span>
                  <span class="text-sm text-muted">${g.group_type} · ${g.is_required ? 'Required' : 'Optional'}</span>
                </div>
                <div class="category-header-actions">
                  <button class="btn btn-danger btn-sm del-group" data-gid="${g.id}">Remove group</button>
                </div>
              </div>
              <div class="category-items open" style="padding:var(--sp-3)">
                ${(g.options || []).map(o => `
                  <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0">
                    <span class="text-sm">${_esc(o.name)}${o.price_modifier > 0 ? ` (+₹${o.price_modifier})` : ''}</span>
                    <button class="btn btn-ghost btn-sm del-option" data-oid="${o.id}" style="color:var(--red-500)">✕</button>
                  </div>`).join('')}
                <button class="btn btn-ghost btn-sm add-option" data-gid="${g.id}" style="margin-top:var(--sp-2)">+ Add option</button>
              </div>
            </div>`).join('')
        : '<div class="text-sm text-muted">No add-on groups yet.</div>';

      list.querySelectorAll('.del-group').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            await Api.rDel(`/menu/items/${itemId}/customizations/groups/${btn.dataset.gid}`);
            _loadCustomizations(overlay, itemId);
          } catch { btn.disabled = false; }
        });
      });

      list.querySelectorAll('.del-option').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            await Api.rDel(`/menu/items/${itemId}/customizations/options/${btn.dataset.oid}`);
            _loadCustomizations(overlay, itemId);
          } catch { btn.disabled = false; }
        });
      });

      list.querySelectorAll('.add-option').forEach(btn => {
        btn.addEventListener('click', () => {
          btn.style.display = 'none';
          const form = document.createElement('div');
          form.className = 'inline-add-form';
          form.style.marginTop = 'var(--sp-2)';
          form.innerHTML = `
            <div class="form-row" style="margin-bottom:0">
              <div class="form-group" style="margin-bottom:0">
                <input class="opt-name" type="text" placeholder="Option name (e.g. Mild)" maxlength="100">
              </div>
              <div class="form-group" style="margin-bottom:0">
                <input class="opt-price" type="number" min="0" step="0.01" placeholder="Extra ₹ (0 = free)">
              </div>
            </div>
            <div style="display:flex;gap:var(--sp-2);margin-top:var(--sp-2)">
              <button class="btn btn-primary btn-sm opt-save">Add option</button>
              <button class="btn btn-ghost btn-sm opt-cancel">Cancel</button>
            </div>
            <p class="form-error opt-err" hidden></p>`;
          btn.parentNode.insertBefore(form, btn.nextSibling);

          form.querySelector('.opt-cancel').onclick = () => { form.remove(); btn.style.display = ''; };
          form.querySelector('.opt-save').onclick = async () => {
            const name  = form.querySelector('.opt-name').value.trim();
            const price = form.querySelector('.opt-price').value || '0';
            const err   = form.querySelector('.opt-err');
            if (!name) { err.textContent = 'Name is required.'; err.hidden = false; return; }
            const saveBtn = form.querySelector('.opt-save');
            saveBtn.disabled = true; saveBtn.textContent = 'Adding…';
            try {
              await Api.rPost(`/menu/items/${itemId}/customizations/groups/${btn.dataset.gid}/options`, {
                name, price_modifier: Number(price),
              });
              form.remove(); btn.style.display = '';
              _loadCustomizations(overlay, itemId);
            } catch (ex) {
              err.textContent = ex.message; err.hidden = false;
              saveBtn.disabled = false; saveBtn.textContent = 'Add option';
            }
          };
        });
      });

    } catch {
      list.innerHTML = `<div class="text-sm text-muted">Could not load customizations.</div>`;
    }

    const addGroupBtn = overlay.querySelector('#add-group-btn');
    addGroupBtn.onclick = () => {
      addGroupBtn.style.display = 'none';
      const form = document.createElement('div');
      form.className = 'inline-add-form';
      form.innerHTML = `
        <div class="form-group">
          <label>Group name</label>
          <input id="g-name" type="text" placeholder="e.g. Spice Level, Extras, Side choice" maxlength="100">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Type</label>
            <select id="g-type">
              <option value="radio">Single select (radio)</option>
              <option value="checkbox">Multi-select (checkbox)</option>
            </select>
          </div>
          <div class="form-group">
            <label>Required?</label>
            <select id="g-required">
              <option value="false">Optional</option>
              <option value="true">Required</option>
            </select>
          </div>
        </div>
        <div style="display:flex;gap:var(--sp-2)">
          <button class="btn btn-primary btn-sm" id="g-save">Add group</button>
          <button class="btn btn-ghost btn-sm" id="g-cancel">Cancel</button>
        </div>
        <p class="form-error" id="g-err" hidden></p>`;
      addGroupBtn.parentNode.insertBefore(form, addGroupBtn.nextSibling);

      form.querySelector('#g-cancel').onclick = () => { form.remove(); addGroupBtn.style.display = ''; };
      form.querySelector('#g-save').onclick = async () => {
        const name = form.querySelector('#g-name').value.trim();
        const type = form.querySelector('#g-type').value;
        const req  = form.querySelector('#g-required').value === 'true';
        const err  = form.querySelector('#g-err');
        if (!name) { err.textContent = 'Name is required.'; err.hidden = false; return; }
        const saveBtn = form.querySelector('#g-save');
        saveBtn.disabled = true; saveBtn.textContent = 'Adding…';
        try {
          await Api.rPost(`/menu/items/${itemId}/customizations/groups`, {
            name, group_type: type, is_required: req,
          });
          form.remove(); addGroupBtn.style.display = '';
          _loadCustomizations(overlay, itemId);
        } catch (ex) {
          err.textContent = ex.message; err.hidden = false;
          saveBtn.disabled = false; saveBtn.textContent = 'Add group';
        }
      };
    };
  }

  // ── Data + render ─────────────────────────────────────────────────────────
  let _el = null;

  async function _reload() {
    if (!_el) return;
    try {
      const data    = await Api.rGet('/menu/categories');
      _categories   = data.categories || [];
      _renderList(_el);
    } catch (err) {
      const listEl = _el.querySelector('#menu-list');
      if (listEl) listEl.innerHTML = DashUI.errorState(err.message);
    }
  }

  function _renderList(el) {
    const listEl = el.querySelector('#menu-list');
    if (!listEl) return;
    if (!_categories.length) {
      listEl.innerHTML = DashUI.emptyState({
        icon:  '🍽',
        title: 'No menu categories yet',
        body:  'Add your first category to start building your menu.',
      });
      return;
    }
    listEl.innerHTML = _categories.map((c, i) => _categoryBlock(c, i === 0)).join('');

    // Accordion toggles
    listEl.querySelectorAll('.category-header').forEach(h => {
      h.addEventListener('click', () => {
        const items   = h.nextElementSibling;
        const chevron = h.querySelector('.category-chevron');
        items.classList.toggle('open');
        chevron.classList.toggle('open');
      });
    });

    // Category actions
    listEl.addEventListener('click', async e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      e.stopPropagation();

      const action = btn.dataset.action;
      const catId  = btn.dataset.catId;
      const itemId = btn.dataset.itemId;

      if (action === 'edit-cat') {
        const cat = _categories.find(c => c.id === catId);
        _openCategoryModal(cat);
      }
      if (action === 'delete-cat') {
        const cat = _categories.find(c => c.id === catId);
        const ok  = await DashUI.confirm(
          `Delete <strong>${_esc(cat?.name || 'this category')}</strong> and all its items? This cannot be undone.`,
          { title: 'Delete category', confirmLabel: 'Delete', danger: true }
        );
        if (!ok) return;
        try { await Api.rDel(`/menu/categories/${catId}`); await _reload(); }
        catch (ex) { DashUI.toast('Could not delete category. Please try again.', 'error'); }
      }
      if (action === 'add-item') {
        _openItemModal(catId);
      }
      if (action === 'edit-item') {
        const cat  = _categories.find(c => c.id === btn.dataset.catId);
        const item = cat?.items.find(i => i.id === itemId);
        _openItemModal(catId, item);
      }
      if (action === 'delete-item') {
        const cat  = _categories.find(c => c.id === btn.dataset.catId);
        const item = cat?.items.find(i => i.id === itemId);
        const ok   = await DashUI.confirm(
          `Delete <strong>${_esc(item?.name || 'this item')}</strong>? This cannot be undone.`,
          { title: 'Delete item', confirmLabel: 'Delete', danger: true }
        );
        if (!ok) return;
        try { await Api.rDel(`/menu/items/${itemId}`); await _reload(); }
        catch (ex) { DashUI.toast('Could not delete item. Please try again.', 'error'); }
      }
    });

    // Availability toggles
    listEl.querySelectorAll('.item-toggle').forEach(chk => {
      chk.addEventListener('change', async () => {
        try {
          await Api.rPatch(`/menu/items/${chk.dataset.itemId}/availability`, { is_available: chk.checked });
          const row = listEl.querySelector(`[data-item-id="${chk.dataset.itemId}"]`);
          if (row) row.classList.toggle('menu-item-unavailable', !chk.checked);
        } catch (ex) {
          chk.checked = !chk.checked;
          DashUI.toast('Could not update availability. Please try again.', 'error');
        }
      });
    });
  }

  async function init(el) {
    _el = el;
    el.innerHTML = `
      <div class="toolbar">
        <div class="toolbar-left"></div>
        <div class="toolbar-right">
          <button id="add-cat-btn" class="btn btn-primary">+ Add category</button>
        </div>
      </div>
      <div id="menu-list"><div class="skeleton skeleton-line wide" style="height:48px;margin-bottom:8px"></div><div class="skeleton skeleton-line wide" style="height:48px;margin-bottom:8px"></div></div>`;

    el.querySelector('#add-cat-btn').addEventListener('click', () => _openCategoryModal());

    await _reload();
  }

  return { init };
})();
