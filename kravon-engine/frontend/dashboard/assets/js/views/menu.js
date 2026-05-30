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
          <button class="btn btn-ghost btn-sm" data-action="edit-item" data-item-id="${item.id}" data-cat-id="${catId}">✏</button>
          <button class="btn btn-danger btn-sm" data-action="delete-item" data-item-id="${item.id}">🗑</button>
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
            <button class="btn btn-ghost btn-sm" data-action="edit-cat" data-cat-id="${cat.id}">✏</button>
            <button class="btn btn-danger btn-sm" data-action="delete-cat" data-cat-id="${cat.id}">🗑</button>
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
    const isEdit = !!item;
    const cats   = _categories;
    const catOpts = cats.map(c => `<option value="${c.id}" ${c.id === catId ? 'selected' : ''}>${_esc(c.name)}</option>`).join('');
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal-overlay" id="item-modal">
        <div class="modal">
          <div class="modal-header">
            <span class="modal-title">${isEdit ? 'Edit item' : 'Add item'}</span>
            <button class="modal-close" id="item-modal-close">✕</button>
          </div>
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
                  <input name="price" type="number" min="0" step="0.01" value="${item?.price ?? ''}" required>
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label>Food type</label>
                  <select name="food_type">
                    ${['veg','non_veg','egg','vegan'].map(v => `<option value="${v}" ${(item?.food_type||'veg')===v?'selected':''}>${v}</option>`).join('')}
                  </select>
                </div>
                <div class="form-group">
                  <label>Available?</label>
                  <select name="is_available">
                    <option value="true"  ${(item?.is_available !== false) ? 'selected' : ''}>Yes</option>
                    <option value="false" ${(item?.is_available === false)  ? 'selected' : ''}>No (86'd)</option>
                  </select>
                </div>
              </div>
              <div class="form-group">
                <label>Description <span class="text-muted">(optional)</span></label>
                <input name="description" type="text" value="${_esc(item?.description || '')}" maxlength="500">
              </div>
              <p id="item-modal-error" class="form-error" hidden></p>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" id="item-modal-cancel">Cancel</button>
              <button type="submit" class="btn btn-primary" id="item-modal-save">Save</button>
            </div>
          </form>
        </div>
      </div>`);

    const overlay = document.getElementById('item-modal');
    const close   = () => overlay.remove();
    overlay.querySelector('#item-modal-close').onclick  = close;
    overlay.querySelector('#item-modal-cancel').onclick = close;

    overlay.querySelector('#item-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd   = new FormData(e.target);
      const body = {
        category_id:  fd.get('category_id'),
        name:         fd.get('name'),
        price:        Number(fd.get('price')),
        food_type:    fd.get('food_type'),
        is_available: fd.get('is_available') === 'true',
        description:  fd.get('description') || null,
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

  // ── Data + render ─────────────────────────────────────────────────────────
  let _el = null;

  async function _reload() {
    if (!_el) return;
    try {
      const data    = await Api.rGet('/menu/categories');
      _categories   = data.categories || [];
      _renderList(_el);
    } catch (err) {
      _el.querySelector('#menu-list').innerHTML = `<div class="empty-state">Error: ${err.message}</div>`;
    }
  }

  function _renderList(el) {
    const listEl = el.querySelector('#menu-list');
    if (!listEl) return;
    if (!_categories.length) {
      listEl.innerHTML = `<div class="empty-state">No categories yet. Add one to get started.</div>`;
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
        if (!confirm('Delete this category and all its items?')) return;
        try { await Api.rDel(`/menu/categories/${catId}`); await _reload(); }
        catch (ex) { alert(ex.message); }
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
        if (!confirm('Delete this item?')) return;
        try { await Api.rDel(`/menu/items/${itemId}`); await _reload(); }
        catch (ex) { alert(ex.message); }
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
          alert(ex.message);
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
