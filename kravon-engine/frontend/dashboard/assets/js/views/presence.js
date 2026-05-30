'use strict';

const PresenceView = (() => {

  // Local copy of the presence content; updated as the user edits.
  let _content = {};

  // ── Helpers ───────────────────────────────────────────────────────────────
  function _esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function _get(path) {
    return path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : ''), _content);
  }

  function _set(path, value) {
    const keys = path.split('.');
    let obj = _content;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!obj[keys[i]] || typeof obj[keys[i]] !== 'object') obj[keys[i]] = {};
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
  }

  // ── Save helpers ──────────────────────────────────────────────────────────
  async function _saveSection(sectionKey, btn, errEl, okEl) {
    btn.disabled = true; btn.textContent = 'Saving…';
    errEl.hidden = true; okEl.hidden = true;
    try {
      await Api.rPatch('/presence', _content);
      okEl.hidden = false;
      setTimeout(() => { okEl.hidden = true; }, 2500);
    } catch (ex) {
      errEl.textContent = ex.message; errEl.hidden = false;
    } finally {
      btn.disabled = false; btn.textContent = 'Save';
    }
  }

  function _cardFooter(sectionKey) {
    return `
      <div class="card-footer" style="display:flex;align-items:center;justify-content:flex-end;gap:var(--sp-3);padding:12px 20px;border-top:1px solid var(--gray-100)">
        <p class="form-error" id="${sectionKey}-err" hidden></p>
        <p class="text-sm" style="color:var(--green-600)" id="${sectionKey}-ok" hidden>Saved.</p>
        <button class="btn btn-primary" id="${sectionKey}-save">Save</button>
      </div>`;
  }

  function _bindSave(el, sectionKey) {
    const btn = el.querySelector(`#${sectionKey}-save`);
    const err = el.querySelector(`#${sectionKey}-err`);
    const ok  = el.querySelector(`#${sectionKey}-ok`);
    if (btn) btn.addEventListener('click', () => _saveSection(sectionKey, btn, err, ok));
  }

  // ── Section renderers ─────────────────────────────────────────────────────

  function _renderHero(el) {
    const h = _content.hero || {};
    el.insertAdjacentHTML('beforeend', `
      <div class="card" style="margin-bottom:var(--sp-5)">
        <div class="card-header"><span class="card-title">Hero</span></div>
        <div class="card-body">
          <div class="form-group">
            <label>Headline</label>
            <input id="hero-headline" type="text" value="${_esc(h.headline)}" maxlength="120" placeholder="e.g. The flavours of India, reimagined">
          </div>
          <div class="form-group">
            <label>Subheadline</label>
            <input id="hero-subheadline" type="text" value="${_esc(h.subheadline)}" maxlength="200" placeholder="One line that makes them hungry">
          </div>
          <div class="form-group">
            <label>Hero image URL</label>
            <input id="hero-image" type="url" value="${_esc(h.heroImage)}" placeholder="https://…">
          </div>
        </div>
        ${_cardFooter('hero')}
      </div>`);

    el.querySelector('#hero-headline').addEventListener('input',    e => _set('hero.headline',    e.target.value));
    el.querySelector('#hero-subheadline').addEventListener('input', e => _set('hero.subheadline', e.target.value));
    el.querySelector('#hero-image').addEventListener('input',       e => _set('hero.heroImage',   e.target.value));
    _bindSave(el, 'hero');
  }

  function _renderStory(el) {
    const s = _content.story || {};
    el.insertAdjacentHTML('beforeend', `
      <div class="card" style="margin-bottom:var(--sp-5)">
        <div class="card-header"><span class="card-title">Story</span></div>
        <div class="card-body">
          <div class="form-group">
            <label>Title</label>
            <input id="story-title" type="text" value="${_esc(s.title)}" maxlength="120" placeholder="e.g. Born in a Mumbai kitchen">
          </div>
          <div class="form-group">
            <label>Body</label>
            <textarea id="story-body" rows="6" placeholder="Separate paragraphs with a blank line…" style="resize:vertical">${_esc(s.body)}</textarea>
          </div>
        </div>
        ${_cardFooter('story')}
      </div>`);

    el.querySelector('#story-title').addEventListener('input', e => _set('story.title', e.target.value));
    el.querySelector('#story-body').addEventListener('input',  e => _set('story.body',  e.target.value));
    _bindSave(el, 'story');
  }

  function _renderGallery(el) {
    const g = _content.gallery || { food: [], ambience: [], people: [] };
    const groups = [
      { key: 'food',     label: 'Food' },
      { key: 'ambience', label: 'Ambience' },
      { key: 'people',   label: 'People' },
    ];

    const groupHtml = groups.map(({ key, label }) => {
      const urls = (g[key] || []);
      const rows = urls.map((url, i) => `
        <div class="gallery-row" style="display:flex;gap:var(--sp-2);margin-bottom:var(--sp-2)" data-group="${key}" data-idx="${i}">
          <input type="url" class="gallery-url" value="${_esc(url)}" placeholder="https://…" style="flex:1">
          <button class="btn btn-ghost btn-sm gallery-remove" data-group="${key}" data-idx="${i}" title="Remove">✕</button>
        </div>`).join('');
      return `
        <div style="margin-bottom:var(--sp-5)">
          <label style="font-weight:600;margin-bottom:var(--sp-2);display:block">${label}</label>
          <div id="gallery-${key}-list">${rows}</div>
          <button class="btn btn-ghost btn-sm gallery-add" data-group="${key}" style="margin-top:var(--sp-2)">+ Add image</button>
        </div>`;
    }).join('');

    el.insertAdjacentHTML('beforeend', `
      <div class="card" style="margin-bottom:var(--sp-5)">
        <div class="card-header"><span class="card-title">Gallery</span></div>
        <div class="card-body" id="gallery-card-body">${groupHtml}</div>
        ${_cardFooter('gallery')}
      </div>`);

    const cardBody = el.querySelector('#gallery-card-body');

    function _syncGalleryFromDOM() {
      groups.forEach(({ key }) => {
        const urls = [...cardBody.querySelectorAll(`.gallery-url[data-group="${key}"]`)]
          .map(i => i.value.trim()).filter(Boolean);
        if (!_content.gallery) _content.gallery = {};
        _content.gallery[key] = urls;
      });
    }

    // Delegated events on card body
    cardBody.addEventListener('input', e => {
      if (e.target.classList.contains('gallery-url')) {
        const { group, idx } = e.target.closest('[data-group]').dataset;
        if (!_content.gallery) _content.gallery = {};
        if (!_content.gallery[group]) _content.gallery[group] = [];
        _content.gallery[group][Number(idx)] = e.target.value;
      }
    });

    cardBody.addEventListener('click', e => {
      const addBtn = e.target.closest('.gallery-add');
      if (addBtn) {
        const group = addBtn.dataset.group;
        const list  = cardBody.querySelector(`#gallery-${group}-list`);
        const idx   = list.querySelectorAll('.gallery-row').length;
        list.insertAdjacentHTML('beforeend', `
          <div class="gallery-row" style="display:flex;gap:var(--sp-2);margin-bottom:var(--sp-2)" data-group="${group}" data-idx="${idx}">
            <input type="url" class="gallery-url" data-group="${group}" data-idx="${idx}" value="" placeholder="https://…" style="flex:1">
            <button class="btn btn-ghost btn-sm gallery-remove" data-group="${group}" data-idx="${idx}" title="Remove">✕</button>
          </div>`);
        if (!_content.gallery) _content.gallery = {};
        if (!_content.gallery[group]) _content.gallery[group] = [];
        _content.gallery[group].push('');
        return;
      }

      const removeBtn = e.target.closest('.gallery-remove');
      if (removeBtn) {
        const group = removeBtn.dataset.group;
        _syncGalleryFromDOM();
        const row = removeBtn.closest('.gallery-row');
        row.remove();
        _syncGalleryFromDOM();
        // Re-index data-idx attributes
        cardBody.querySelectorAll(`#gallery-${group}-list .gallery-row`).forEach((r, i) => {
          r.dataset.idx = i;
          r.querySelector('.gallery-url').dataset.idx  = i;
          r.querySelector('.gallery-remove').dataset.idx = i;
        });
      }
    });

    _bindSave(el, 'gallery');
  }

  function _renderSignatureDishes(el) {
    const dishes = _content.signatureDishes || [];

    function _dishRow(d, i) {
      return `
        <div class="dish-row" data-idx="${i}" style="border:1px solid var(--gray-100);border-radius:8px;padding:var(--sp-3);margin-bottom:var(--sp-3)">
          <div class="form-row" style="gap:var(--sp-3)">
            <div class="form-group" style="flex:1">
              <label>Name</label>
              <input type="text" class="dish-name" data-idx="${i}" value="${_esc(d.name || '')}" maxlength="100">
            </div>
            <div class="form-group" style="flex:2">
              <label>Description</label>
              <input type="text" class="dish-desc" data-idx="${i}" value="${_esc(d.description || '')}" maxlength="200">
            </div>
          </div>
          <div class="form-group">
            <label>Image URL</label>
            <input type="url" class="dish-img" data-idx="${i}" value="${_esc(d.image || '')}" placeholder="https://…">
          </div>
          <button class="btn btn-ghost btn-sm dish-remove" data-idx="${i}" style="color:var(--red-500)">Remove</button>
        </div>`;
    }

    el.insertAdjacentHTML('beforeend', `
      <div class="card" style="margin-bottom:var(--sp-5)">
        <div class="card-header"><span class="card-title">Signature Dishes</span></div>
        <div class="card-body">
          <div id="dishes-list">${dishes.map(_dishRow).join('')}</div>
          <button class="btn btn-ghost btn-sm" id="dish-add">+ Add dish</button>
        </div>
        ${_cardFooter('dishes')}
      </div>`);

    const list = el.querySelector('#dishes-list');

    function _syncDishes() {
      _content.signatureDishes = [...list.querySelectorAll('.dish-row')].map(row => ({
        name:        row.querySelector('.dish-name')?.value || '',
        description: row.querySelector('.dish-desc')?.value || '',
        image:       row.querySelector('.dish-img')?.value  || '',
      }));
    }

    list.addEventListener('input', _syncDishes);
    list.addEventListener('click', e => {
      if (e.target.classList.contains('dish-remove')) {
        e.target.closest('.dish-row').remove();
        _syncDishes();
      }
    });

    el.querySelector('#dish-add').addEventListener('click', () => {
      const idx = list.querySelectorAll('.dish-row').length;
      list.insertAdjacentHTML('beforeend', _dishRow({ name: '', description: '', image: '' }, idx));
    });

    _bindSave(el, 'dishes');
  }

  function _renderFeatured(el) {
    const items = _content.featured || [];

    function _featRow(f, i) {
      return `
        <div class="feat-row" data-idx="${i}" style="border:1px solid var(--gray-100);border-radius:8px;padding:var(--sp-3);margin-bottom:var(--sp-3)">
          <div class="form-row" style="gap:var(--sp-3)">
            <div class="form-group" style="flex:2">
              <label>Title</label>
              <input type="text" class="feat-title" data-idx="${i}" value="${_esc(f.title || '')}" maxlength="120">
            </div>
            <div class="form-group" style="flex:0 0 auto;display:flex;align-items:flex-end;gap:var(--sp-2)">
              <label style="margin:0">Active</label>
              <input type="checkbox" class="feat-active" data-idx="${i}" ${f.active !== false ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer">
            </div>
          </div>
          <div class="form-group">
            <label>Description</label>
            <textarea class="feat-desc" data-idx="${i}" rows="2" style="resize:vertical">${_esc(f.description || '')}</textarea>
          </div>
          <div class="form-group">
            <label>Image URL</label>
            <input type="url" class="feat-img" data-idx="${i}" value="${_esc(f.image || '')}" placeholder="https://…">
          </div>
          <div class="form-row" style="gap:var(--sp-3)">
            <div class="form-group" style="flex:1">
              <label>CTA label</label>
              <input type="text" class="feat-cta-label" data-idx="${i}" value="${_esc(f.ctaLabel || '')}" maxlength="60" placeholder="e.g. Book a Table">
            </div>
            <div class="form-group" style="flex:2">
              <label>CTA URL</label>
              <input type="text" class="feat-cta-url" data-idx="${i}" value="${_esc(f.ctaUrl || '')}" maxlength="300" placeholder="/tables or https://…">
            </div>
          </div>
          <button class="btn btn-ghost btn-sm feat-remove" data-idx="${i}" style="color:var(--red-500)">Remove</button>
        </div>`;
    }

    el.insertAdjacentHTML('beforeend', `
      <div class="card" style="margin-bottom:var(--sp-5)">
        <div class="card-header"><span class="card-title">Featured</span><span class="text-sm text-muted">Promotions, events, seasonal specials</span></div>
        <div class="card-body">
          <div id="featured-list">${items.map(_featRow).join('')}</div>
          <button class="btn btn-ghost btn-sm" id="feat-add">+ Add item</button>
        </div>
        ${_cardFooter('featured')}
      </div>`);

    const list = el.querySelector('#featured-list');

    function _syncFeatured() {
      _content.featured = [...list.querySelectorAll('.feat-row')].map(row => ({
        title:       row.querySelector('.feat-title')?.value    || '',
        description: row.querySelector('.feat-desc')?.value     || '',
        image:       row.querySelector('.feat-img')?.value      || '',
        ctaLabel:    row.querySelector('.feat-cta-label')?.value || '',
        ctaUrl:      row.querySelector('.feat-cta-url')?.value   || '',
        active:      row.querySelector('.feat-active')?.checked  ?? true,
      }));
    }

    list.addEventListener('input',  _syncFeatured);
    list.addEventListener('change', _syncFeatured);
    list.addEventListener('click', e => {
      if (e.target.classList.contains('feat-remove')) {
        e.target.closest('.feat-row').remove();
        _syncFeatured();
      }
    });

    el.querySelector('#feat-add').addEventListener('click', () => {
      const idx = list.querySelectorAll('.feat-row').length;
      list.insertAdjacentHTML('beforeend', _featRow({ title: '', description: '', image: '', active: true }, idx));
    });

    _bindSave(el, 'featured');
  }

  function _renderTimeline(el) {
    const items = _content.timeline || [];

    function _timeRow(t, i) {
      return `
        <div class="time-row" data-idx="${i}" style="display:flex;gap:var(--sp-3);align-items:flex-start;margin-bottom:var(--sp-3)">
          <input type="text" class="time-year" data-idx="${i}" value="${_esc(String(t.year || ''))}" placeholder="Year" maxlength="10" style="width:80px">
          <input type="text" class="time-event" data-idx="${i}" value="${_esc(t.event || '')}" placeholder="What happened" maxlength="200" style="flex:1">
          <button class="btn btn-ghost btn-sm time-remove" data-idx="${i}" style="color:var(--red-500)">✕</button>
        </div>`;
    }

    el.insertAdjacentHTML('beforeend', `
      <div class="card" style="margin-bottom:var(--sp-5)">
        <div class="card-header"><span class="card-title">Timeline</span></div>
        <div class="card-body">
          <div id="timeline-list">${items.map(_timeRow).join('')}</div>
          <button class="btn btn-ghost btn-sm" id="time-add">+ Add milestone</button>
        </div>
        ${_cardFooter('timeline')}
      </div>`);

    const list = el.querySelector('#timeline-list');

    function _syncTimeline() {
      _content.timeline = [...list.querySelectorAll('.time-row')].map(row => ({
        year:  row.querySelector('.time-year')?.value  || '',
        event: row.querySelector('.time-event')?.value || '',
      }));
    }

    list.addEventListener('input', _syncTimeline);
    list.addEventListener('click', e => {
      if (e.target.classList.contains('time-remove')) {
        e.target.closest('.time-row').remove();
        _syncTimeline();
      }
    });

    el.querySelector('#time-add').addEventListener('click', () => {
      const idx = list.querySelectorAll('.time-row').length;
      list.insertAdjacentHTML('beforeend', _timeRow({ year: '', event: '' }, idx));
    });

    _bindSave(el, 'timeline');
  }

  function _renderContact(el) {
    const c = _content.contact || {};
    el.insertAdjacentHTML('beforeend', `
      <div class="card" style="margin-bottom:var(--sp-5)">
        <div class="card-header"><span class="card-title">Contact</span></div>
        <div class="card-body">
          <div class="form-row">
            <div class="form-group">
              <label>Phone</label>
              <input id="c-phone" type="tel" value="${_esc(c.phone)}" placeholder="+91 …">
            </div>
            <div class="form-group">
              <label>WhatsApp number</label>
              <input id="c-wa" type="tel" value="${_esc(c.whatsapp)}" placeholder="9112345678">
            </div>
          </div>
          <div class="form-group">
            <label>Email</label>
            <input id="c-email" type="email" value="${_esc(c.email)}" placeholder="hello@restaurant.com">
          </div>
          <div class="form-group">
            <label>Address</label>
            <input id="c-address" type="text" value="${_esc(c.address)}" maxlength="300">
          </div>
          <div class="form-group">
            <label>Google Maps URL</label>
            <input id="c-maps" type="url" value="${_esc(c.googleMapsUrl)}" placeholder="https://maps.google.com/…">
          </div>
        </div>
        ${_cardFooter('contact')}
      </div>`);

    const fields = { phone: '#c-phone', whatsapp: '#c-wa', email: '#c-email', address: '#c-address', googleMapsUrl: '#c-maps' };
    for (const [key, sel] of Object.entries(fields)) {
      el.querySelector(sel).addEventListener('input', e => _set(`contact.${key}`, e.target.value));
    }
    _bindSave(el, 'contact');
  }

  // ── Main init ─────────────────────────────────────────────────────────────
  async function init(el) {
    el.innerHTML = `<div class="skeleton skeleton-line wide" style="height:200px;margin-bottom:var(--sp-4)"></div>
                    <div class="skeleton skeleton-line wide" style="height:200px"></div>`;

    try {
      const data = await Api.rGet('/presence');
      _content = data.content || {};
    } catch (err) {
      el.innerHTML = `<div class="empty-state">Failed to load presence content: ${err.message}</div>`;
      return;
    }

    el.innerHTML = `<div style="max-width:700px" id="presence-editor"></div>`;
    const editor = el.querySelector('#presence-editor');

    _renderHero(editor);
    _renderStory(editor);
    _renderGallery(editor);
    _renderSignatureDishes(editor);
    _renderFeatured(editor);
    _renderTimeline(editor);
    _renderContact(editor);
  }

  return { init };
})();
