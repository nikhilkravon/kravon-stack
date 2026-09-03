'use strict';

const PresenceView = (() => {

  let _content = {};

  function _esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Image upload helper ───────────────────────────────────────────────────
  // Attaches a hidden file input + "Upload image" button next to a URL input.
  // On upload success the URL input is populated and _set() is called.
  function _attachUpload(el, inputId, contentPath) {
    const urlInput = el.querySelector(`#${inputId}`);
    if (!urlInput) return;

    const fileInputId = `${inputId}-file`;
    urlInput.insertAdjacentHTML('afterend', `
      <div style="display:flex;align-items:center;gap:var(--sp-2);margin-top:4px">
        <input type="file" id="${fileInputId}" accept="image/*" style="display:none">
        <button class="btn btn-ghost btn-sm" id="${inputId}-upload-btn" type="button">
          ↑ Upload image
        </button>
        <span id="${inputId}-upload-status" class="text-sm text-muted"></span>
      </div>`);

    const btn    = el.querySelector(`#${inputId}-upload-btn`);
    const fileEl = el.querySelector(`#${fileInputId}`);
    const status = el.querySelector(`#${inputId}-upload-status`);

    btn.addEventListener('click', () => fileEl.click());

    fileEl.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      btn.disabled = true;
      btn.textContent = 'Uploading…';
      status.textContent = '';
      try {
        const url = await Api.rUploadImage(file);
        urlInput.value = url;
        _set(contentPath, url);
        status.textContent = 'Uploaded ✓';
        setTimeout(() => { status.textContent = ''; }, 3000);
      } catch (ex) {
        DashUI.toast(ex.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = '↑ Upload image';
        fileEl.value = '';
      }
    });
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
    _markDirty(keys[0]);
  }

  // ── Dirty tracking — a section shows "Unsaved changes" from the moment a
  // field is edited until that section's own Save succeeds. Each card saves
  // independently (matches the backend's per-section PATCH), so dirty state
  // is tracked per section, not page-wide.
  let _dirty = {};

  function _markDirty(sectionKey) {
    _dirty[sectionKey] = true;
    const flag = document.getElementById(`${sectionKey}-dirty`);
    if (flag) flag.hidden = false;
  }

  function _clearDirty(sectionKey) {
    _dirty[sectionKey] = false;
    const flag = document.getElementById(`${sectionKey}-dirty`);
    if (flag) flag.hidden = true;
  }

  // ── Save one section ──────────────────────────────────────────────────────
  async function _saveSection(sectionKey, btn, errEl, okEl) {
    btn.disabled = true; btn.textContent = 'Saving…';
    errEl.hidden = true; okEl.hidden = true;
    try {
      // Only send the relevant top-level key so backend merges cleanly
      const payload = { [sectionKey]: _content[sectionKey] };
      await Api.rPatch('/presence', payload);
      okEl.hidden = false;
      _clearDirty(sectionKey);
      setTimeout(() => { okEl.hidden = true; }, 2500);
    } catch (ex) {
      errEl.textContent = ex.message; errEl.hidden = false;
    } finally {
      btn.disabled = false; btn.textContent = 'Save';
    }
  }

  function _cardFooter(sectionKey) {
    return `
      <div style="display:flex;align-items:center;justify-content:flex-end;gap:var(--sp-3);
                  padding:12px 20px;border-top:1px solid var(--gray-100)">
        <span class="text-sm text-muted" id="${sectionKey}-dirty" hidden>Unsaved changes</span>
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

  function _sectionHeader(title, subtitle) {
    return `<div class="card-header">
      <span class="card-title">${title}</span>
      ${subtitle ? `<span class="text-sm text-muted">${subtitle}</span>` : ''}
    </div>`;
  }

  // ── BRANDING ──────────────────────────────────────────────────────────────
  function _renderBranding(el) {
    const b = _content.branding || {};
    el.insertAdjacentHTML('beforeend', `
      <div class="card" style="margin-bottom:var(--sp-5)">
        ${_sectionHeader('Branding', 'Logo and hero image shown on your presence page')}
        <div class="card-body">
          <div class="form-group">
            <label>Logo URL</label>
            <input id="br-logo" type="url" value="${_esc(b.logoUrl)}" placeholder="https://…/logo.png">
            <span class="text-sm text-muted" style="margin-top:4px">Displayed in the nav bar. Recommended: square, at least 88×88px.</span>
          </div>
          <div class="form-group">
            <label>Hero image URL</label>
            <input id="br-hero" type="url" value="${_esc(b.heroImage)}" placeholder="https://…/hero.jpg">
            <span class="text-sm text-muted" style="margin-top:4px">Full-width banner at the top of your page. Recommended: 1600×900px.</span>
          </div>
        </div>
        ${_cardFooter('branding')}
      </div>`);

    el.querySelector('#br-logo').addEventListener('input', e => _set('branding.logoUrl',  e.target.value));
    el.querySelector('#br-hero').addEventListener('input', e => _set('branding.heroImage', e.target.value));
    _attachUpload(el, 'br-logo', 'branding.logoUrl');
    _attachUpload(el, 'br-hero', 'branding.heroImage');
    _bindSave(el, 'branding');
  }

  // ── BASICS ────────────────────────────────────────────────────────────────
  function _renderBasics(el) {
    const b = _content.basics || {};
    el.insertAdjacentHTML('beforeend', `
      <div class="card" style="margin-bottom:var(--sp-5)">
        ${_sectionHeader('Basics', 'Name, tagline and location details shown on your page')}
        <div class="card-body">
          <div class="form-group">
            <label>Restaurant name</label>
            <input id="b-name" type="text" value="${_esc(b.name)}" maxlength="120" placeholder="e.g. Avartana">
          </div>
          <div class="form-group">
            <label>Tagline</label>
            <input id="b-tagline" type="text" value="${_esc(b.tagline)}" maxlength="200" placeholder="One line that captures who you are">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>City</label>
              <input id="b-city" type="text" value="${_esc(b.city)}" maxlength="80" placeholder="Chennai">
            </div>
            <div class="form-group">
              <label>Opening hours (display text)</label>
              <input id="b-hours" type="text" value="${_esc(b.hours)}" maxlength="100" placeholder="Mon–Sat 12–10 PM, Sun 12–3 PM">
            </div>
          </div>
          <div class="form-group">
            <label>Delivery zone</label>
            <input id="b-zone" type="text" value="${_esc(b.deliveryZone)}" maxlength="150" placeholder="e.g. within 5 km of Alwarpet">
          </div>
        </div>
        ${_cardFooter('basics')}
      </div>`);

    el.querySelector('#b-name').addEventListener('input',    e => _set('basics.name',         e.target.value));
    el.querySelector('#b-tagline').addEventListener('input', e => _set('basics.tagline',      e.target.value));
    el.querySelector('#b-city').addEventListener('input',    e => _set('basics.city',         e.target.value));
    el.querySelector('#b-hours').addEventListener('input',   e => _set('basics.hours',        e.target.value));
    el.querySelector('#b-zone').addEventListener('input',    e => _set('basics.deliveryZone', e.target.value));
    _bindSave(el, 'basics');
  }

  // ── CONTACT & HOURS ───────────────────────────────────────────────────────
  function _renderContact(el) {
    const c = _content.contact || {};
    el.insertAdjacentHTML('beforeend', `
      <div class="card" style="margin-bottom:var(--sp-5)">
        ${_sectionHeader('Contact', 'Phone, email, address and WhatsApp shown to guests')}
        <div class="card-body">
          <div class="form-row">
            <div class="form-group">
              <label>Phone number</label>
              <input id="c-phone" type="tel" value="${_esc(c.phone)}" placeholder="+91 98800 00000">
            </div>
            <div class="form-group">
              <label>WhatsApp number <span class="text-muted text-sm">(digits only, with country code)</span></label>
              <input id="c-wa" type="tel" value="${_esc(c.whatsapp)}" placeholder="919884201001">
            </div>
          </div>
          <div class="form-group">
            <label>Email</label>
            <input id="c-email" type="email" value="${_esc(c.email)}" placeholder="hello@yourrestaurant.com">
          </div>
          <div class="form-group">
            <label>Address</label>
            <input id="c-address" type="text" value="${_esc(c.address)}" maxlength="300" placeholder="Full street address">
          </div>
          <div class="form-group">
            <label>Google Maps URL</label>
            <input id="c-maps" type="url" value="${_esc(c.googleMapsUrl)}" placeholder="https://maps.google.com/…">
          </div>
        </div>
        ${_cardFooter('contact')}
      </div>`);

    el.querySelector('#c-phone').addEventListener('input',   e => _set('contact.phone',         e.target.value));
    el.querySelector('#c-wa').addEventListener('input',      e => _set('contact.whatsapp',      e.target.value));
    el.querySelector('#c-email').addEventListener('input',   e => _set('contact.email',         e.target.value));
    el.querySelector('#c-address').addEventListener('input', e => _set('contact.address',       e.target.value));
    el.querySelector('#c-maps').addEventListener('input',    e => _set('contact.googleMapsUrl', e.target.value));
    _bindSave(el, 'contact');
  }

  // ── SOCIAL LINKS ──────────────────────────────────────────────────────────
  function _renderSocial(el) {
    const s = _content.social || {};
    const platforms = [
      { key: 'instagram',   label: 'Instagram',   ph: 'https://instagram.com/yourrestaurant' },
      { key: 'facebook',    label: 'Facebook',     ph: 'https://facebook.com/yourrestaurant' },
      { key: 'google',      label: 'Google Business', ph: 'https://g.page/yourrestaurant' },
      { key: 'zomato',      label: 'Zomato',       ph: 'https://zomato.com/…' },
      { key: 'swiggy',      label: 'Swiggy',       ph: 'https://swiggy.com/…' },
      { key: 'tripadvisor', label: 'TripAdvisor',  ph: 'https://tripadvisor.com/…' },
    ];

    const fieldsHtml = platforms.map(p => `
      <div class="form-group">
        <label>${p.label}</label>
        <input id="s-${p.key}" type="url" value="${_esc(s[p.key])}" placeholder="${p.ph}">
      </div>`).join('');

    el.insertAdjacentHTML('beforeend', `
      <div class="card" style="margin-bottom:var(--sp-5)">
        ${_sectionHeader('Social & Listings', 'Links shown in the footer and contact section of your page')}
        <div class="card-body">
          <div class="form-row">${fieldsHtml}</div>
        </div>
        ${_cardFooter('social')}
      </div>`);

    platforms.forEach(p => {
      el.querySelector(`#s-${p.key}`).addEventListener('input', e => _set(`social.${p.key}`, e.target.value));
    });
    _bindSave(el, 'social');
  }

  // ── HERO ──────────────────────────────────────────────────────────────────
  function _renderHero(el) {
    const h = _content.hero || {};
    el.insertAdjacentHTML('beforeend', `
      <div class="card" style="margin-bottom:var(--sp-5)">
        ${_sectionHeader('Hero Text', 'Headline and subheadline overlaid on your hero image')}
        <div class="card-body">
          <div class="form-group">
            <label>Headline</label>
            <input id="hero-headline" type="text" value="${_esc(h.headline)}" maxlength="120" placeholder="e.g. The flavours of India, reimagined">
          </div>
          <div class="form-group">
            <label>Subheadline</label>
            <input id="hero-subheadline" type="text" value="${_esc(h.subheadline)}" maxlength="200" placeholder="One line that makes them hungry">
          </div>
        </div>
        ${_cardFooter('hero')}
      </div>`);

    el.querySelector('#hero-headline').addEventListener('input',    e => _set('hero.headline',    e.target.value));
    el.querySelector('#hero-subheadline').addEventListener('input', e => _set('hero.subheadline', e.target.value));
    _bindSave(el, 'hero');
  }

  // ── STORY ─────────────────────────────────────────────────────────────────
  function _renderStory(el) {
    const s = _content.story || {};
    el.insertAdjacentHTML('beforeend', `
      <div class="card" style="margin-bottom:var(--sp-5)">
        ${_sectionHeader('Our Story', 'The "About us" section on your page')}
        <div class="card-body">
          <div class="form-group">
            <label>Section title</label>
            <input id="story-title" type="text" value="${_esc(s.title)}" maxlength="120" placeholder="e.g. Born in a Mumbai kitchen">
          </div>
          <div class="form-group">
            <label>Body <span class="text-muted text-sm">(separate paragraphs with a blank line)</span></label>
            <textarea id="story-body" rows="6" style="resize:vertical">${_esc(s.body)}</textarea>
          </div>
          <div class="form-group">
            <label>Story image URL</label>
            <input id="story-image" type="url" value="${_esc(s.image)}" placeholder="https://…/story.jpg">
            <span class="text-sm text-muted" style="margin-top:4px">Shown beside your story text. Recommended: 4:3 ratio.</span>
          </div>
        </div>
        ${_cardFooter('story')}
      </div>`);

    el.querySelector('#story-title').addEventListener('input', e => _set('story.title', e.target.value));
    el.querySelector('#story-body').addEventListener('input',  e => _set('story.body',  e.target.value));
    el.querySelector('#story-image').addEventListener('input', e => _set('story.image', e.target.value));
    _attachUpload(el, 'story-image', 'story.image');
    _bindSave(el, 'story');
  }

  // ── SIGNATURE DISHES ──────────────────────────────────────────────────────
  function _renderSignatureDishes(el) {
    const dishes = _content.signatureDishes || [];

    function _dishRow(d, i) {
      return `
        <div class="dish-row" data-idx="${i}" style="border:1px solid var(--gray-100);border-radius:8px;padding:var(--sp-3);margin-bottom:var(--sp-3)">
          <div class="form-row">
            <div class="form-group" style="flex:1">
              <label>Dish name</label>
              <input type="text" class="dish-name" value="${_esc(d.name || '')}" maxlength="100">
            </div>
            <div class="form-group" style="flex:2">
              <label>Description</label>
              <input type="text" class="dish-desc" value="${_esc(d.description || '')}" maxlength="200">
            </div>
          </div>
          <div class="form-group">
            <label>Image URL</label>
            <div style="display:flex;gap:var(--sp-2);align-items:center">
              <input type="url" class="dish-img" value="${_esc(d.image || '')}" placeholder="https://…" style="flex:1">
              <button class="btn btn-ghost btn-sm dish-img-upload" type="button">↑ Upload</button>
            </div>
          </div>
          <button class="btn btn-ghost btn-sm dish-remove" style="color:var(--red-500)">Remove</button>
        </div>`;
    }

    el.insertAdjacentHTML('beforeend', `
      <div class="card" style="margin-bottom:var(--sp-5)">
        ${_sectionHeader('Signature Dishes', 'Highlighted dishes shown in a featured strip')}
        <div class="card-body">
          <div id="dishes-list">${dishes.map(_dishRow).join('')}</div>
          <button class="btn btn-ghost btn-sm" id="dish-add">+ Add dish</button>
        </div>
        ${_cardFooter('signatureDishes')}
      </div>`);

    const list = el.querySelector('#dishes-list');
    function _syncDishes() {
      _content.signatureDishes = [...list.querySelectorAll('.dish-row')].map(row => ({
        name:        row.querySelector('.dish-name')?.value || '',
        description: row.querySelector('.dish-desc')?.value || '',
        image:       row.querySelector('.dish-img')?.value  || '',
      }));
      _markDirty('signatureDishes');
    }
    list.addEventListener('input', _syncDishes);
    list.addEventListener('click', e => {
      if (e.target.classList.contains('dish-remove')) {
        e.target.closest('.dish-row').remove(); _syncDishes();
        return;
      }
      if (e.target.classList.contains('dish-img-upload')) {
        const row = e.target.closest('.dish-row');
        const imgInput = row.querySelector('.dish-img');
        const fi = document.createElement('input');
        fi.type = 'file'; fi.accept = 'image/*';
        fi.addEventListener('change', async () => {
          const file = fi.files[0]; if (!file) return;
          const btn = e.target;
          btn.disabled = true; btn.textContent = 'Uploading…';
          try {
            imgInput.value = await Api.rUploadImage(file);
            _syncDishes();
          } catch (ex) { DashUI.toast(ex.message, 'error'); }
          finally { btn.disabled = false; btn.textContent = '↑ Upload'; }
        });
        fi.click();
      }
    });
    el.querySelector('#dish-add').addEventListener('click', () => {
      const idx = list.querySelectorAll('.dish-row').length;
      list.insertAdjacentHTML('beforeend', _dishRow({}, idx));
    });
    _bindSave(el, 'signatureDishes');
  }

  // ── GALLERY ───────────────────────────────────────────────────────────────
  function _renderGallery(el) {
    const g = _content.gallery || { food: [], ambience: [], people: [] };
    const groups = [
      { key: 'food',     label: 'Food photos' },
      { key: 'ambience', label: 'Ambience' },
      { key: 'people',   label: 'Team & guests' },
    ];

    const groupHtml = groups.map(({ key, label }) => {
      const rows = (g[key] || []).map((url, i) => `
        <div class="gallery-row" style="display:flex;gap:var(--sp-2);margin-bottom:var(--sp-2)" data-group="${key}" data-idx="${i}">
          <input type="url" class="gallery-url" data-group="${key}" data-idx="${i}" value="${_esc(url)}" placeholder="https://…" style="flex:1">
          <button class="btn btn-ghost btn-sm gallery-upload" data-group="${key}" title="Upload image" type="button">↑</button>
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
        ${_sectionHeader('Gallery', 'Photo grid on your presence page')}
        <div class="card-body" id="gallery-card-body">${groupHtml}</div>
        ${_cardFooter('gallery')}
      </div>`);

    const cardBody = el.querySelector('#gallery-card-body');

    function _syncGallery() {
      groups.forEach(({ key }) => {
        const urls = [...cardBody.querySelectorAll(`.gallery-url[data-group="${key}"]`)]
          .map(i => i.value.trim()).filter(Boolean);
        if (!_content.gallery) _content.gallery = {};
        _content.gallery[key] = urls;
      });
      _markDirty('gallery');
    }

    cardBody.addEventListener('input', e => {
      if (e.target.classList.contains('gallery-url')) _syncGallery();
    });

    cardBody.addEventListener('click', e => {
      const uploadBtn = e.target.closest('.gallery-upload');
      if (uploadBtn) {
        const row     = uploadBtn.closest('.gallery-row');
        const urlInp  = row.querySelector('.gallery-url');
        const fi = document.createElement('input');
        fi.type = 'file'; fi.accept = 'image/*';
        fi.addEventListener('change', async () => {
          const file = fi.files[0]; if (!file) return;
          uploadBtn.disabled = true; uploadBtn.textContent = '…';
          try {
            urlInp.value = await Api.rUploadImage(file);
            _syncGallery();
          } catch (ex) { DashUI.toast(ex.message, 'error'); }
          finally { uploadBtn.disabled = false; uploadBtn.textContent = '↑'; }
        });
        fi.click();
        return;
      }

      const addBtn = e.target.closest('.gallery-add');
      if (addBtn) {
        const group = addBtn.dataset.group;
        const list  = cardBody.querySelector(`#gallery-${group}-list`);
        const idx   = list.querySelectorAll('.gallery-row').length;
        list.insertAdjacentHTML('beforeend', `
          <div class="gallery-row" style="display:flex;gap:var(--sp-2);margin-bottom:var(--sp-2)" data-group="${group}" data-idx="${idx}">
            <input type="url" class="gallery-url" data-group="${group}" data-idx="${idx}" value="" placeholder="https://…" style="flex:1">
            <button class="btn btn-ghost btn-sm gallery-upload" data-group="${group}" title="Upload image" type="button">↑</button>
            <button class="btn btn-ghost btn-sm gallery-remove" data-group="${group}" data-idx="${idx}" title="Remove">✕</button>
          </div>`);
        if (!_content.gallery) _content.gallery = {};
        if (!_content.gallery[group]) _content.gallery[group] = [];
        _content.gallery[group].push('');
        return;
      }
      const removeBtn = e.target.closest('.gallery-remove');
      if (removeBtn) {
        removeBtn.closest('.gallery-row').remove();
        _syncGallery();
      }
    });

    _bindSave(el, 'gallery');
  }

  // ── FEATURED / PROMOS ─────────────────────────────────────────────────────
  function _renderFeatured(el) {
    const items = _content.featured || [];

    function _featRow(f, i) {
      return `
        <div class="feat-row" data-idx="${i}" style="border:1px solid var(--gray-100);border-radius:8px;padding:var(--sp-3);margin-bottom:var(--sp-3)">
          <div class="form-row">
            <div class="form-group" style="flex:2">
              <label>Title</label>
              <input type="text" class="feat-title" value="${_esc(f.title || '')}" maxlength="120">
            </div>
            <div class="form-group" style="flex:0 0 auto;display:flex;align-items:flex-end;gap:var(--sp-2)">
              <label style="margin:0">Active</label>
              <input type="checkbox" class="feat-active" ${f.active !== false ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer">
            </div>
          </div>
          <div class="form-group">
            <label>Description</label>
            <textarea class="feat-desc" rows="2" style="resize:vertical">${_esc(f.description || '')}</textarea>
          </div>
          <div class="form-group">
            <label>Image URL</label>
            <div style="display:flex;gap:var(--sp-2);align-items:center">
              <input type="url" class="feat-img" value="${_esc(f.image || '')}" placeholder="https://…" style="flex:1">
              <button class="btn btn-ghost btn-sm feat-img-upload" type="button">↑ Upload</button>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group" style="flex:1">
              <label>CTA label</label>
              <input type="text" class="feat-cta-label" value="${_esc(f.ctaLabel || '')}" maxlength="60" placeholder="e.g. Book a Table">
            </div>
            <div class="form-group" style="flex:2">
              <label>CTA URL</label>
              <input type="text" class="feat-cta-url" value="${_esc(f.ctaUrl || '')}" maxlength="300" placeholder="/tables or https://…">
            </div>
          </div>
          <button class="btn btn-ghost btn-sm feat-remove" style="color:var(--red-500)">Remove</button>
        </div>`;
    }

    el.insertAdjacentHTML('beforeend', `
      <div class="card" style="margin-bottom:var(--sp-5)">
        ${_sectionHeader('Promotions & Features', 'Seasonal specials, events, or anything you want to spotlight')}
        <div class="card-body">
          <div id="featured-list">${items.map(_featRow).join('')}</div>
          <button class="btn btn-ghost btn-sm" id="feat-add">+ Add promotion</button>
        </div>
        ${_cardFooter('featured')}
      </div>`);

    const list = el.querySelector('#featured-list');
    function _syncFeatured() {
      _content.featured = [...list.querySelectorAll('.feat-row')].map(row => ({
        title:       row.querySelector('.feat-title')?.value     || '',
        description: row.querySelector('.feat-desc')?.value      || '',
        image:       row.querySelector('.feat-img')?.value       || '',
        ctaLabel:    row.querySelector('.feat-cta-label')?.value || '',
        ctaUrl:      row.querySelector('.feat-cta-url')?.value   || '',
        active:      row.querySelector('.feat-active')?.checked  ?? true,
      }));
      _markDirty('featured');
    }
    list.addEventListener('input',  _syncFeatured);
    list.addEventListener('change', _syncFeatured);
    list.addEventListener('click', e => {
      if (e.target.classList.contains('feat-remove')) {
        e.target.closest('.feat-row').remove(); _syncFeatured();
        return;
      }
      if (e.target.classList.contains('feat-img-upload')) {
        const row = e.target.closest('.feat-row');
        const imgInput = row.querySelector('.feat-img');
        const fi = document.createElement('input');
        fi.type = 'file'; fi.accept = 'image/*';
        fi.addEventListener('change', async () => {
          const file = fi.files[0]; if (!file) return;
          const btn = e.target;
          btn.disabled = true; btn.textContent = 'Uploading…';
          try {
            imgInput.value = await Api.rUploadImage(file);
            _syncFeatured();
          } catch (ex) { DashUI.toast(ex.message, 'error'); }
          finally { btn.disabled = false; btn.textContent = '↑ Upload'; }
        });
        fi.click();
      }
    });
    el.querySelector('#feat-add').addEventListener('click', () => {
      list.insertAdjacentHTML('beforeend', _featRow({ active: true }, list.querySelectorAll('.feat-row').length));
    });
    _bindSave(el, 'featured');
  }

  // ── TIMELINE ──────────────────────────────────────────────────────────────
  function _renderTimeline(el) {
    const items = _content.timeline || [];

    function _timeRow(t, i) {
      return `
        <div class="time-row" style="display:flex;gap:var(--sp-3);align-items:center;margin-bottom:var(--sp-2)">
          <input type="text" class="time-year" value="${_esc(String(t.year || ''))}" placeholder="Year" maxlength="10" style="width:80px">
          <input type="text" class="time-event" value="${_esc(t.event || '')}" placeholder="What happened" maxlength="200" style="flex:1">
          <button class="btn btn-ghost btn-sm time-remove" style="color:var(--red-500)">✕</button>
        </div>`;
    }

    el.insertAdjacentHTML('beforeend', `
      <div class="card" style="margin-bottom:var(--sp-5)">
        ${_sectionHeader('Milestones', 'Key moments in your restaurant\'s history')}
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
      _markDirty('timeline');
    }
    list.addEventListener('input', _syncTimeline);
    list.addEventListener('click', e => {
      if (e.target.classList.contains('time-remove')) {
        e.target.closest('.time-row').remove(); _syncTimeline();
      }
    });
    el.querySelector('#time-add').addEventListener('click', () => {
      list.insertAdjacentHTML('beforeend', _timeRow({}, list.querySelectorAll('.time-row').length));
    });
    _bindSave(el, 'timeline');
  }

  // ── MAIN INIT ─────────────────────────────────────────────────────────────
  async function init(el) {
    _dirty = {};
    el.innerHTML = `
      <div class="skeleton skeleton-line wide" style="height:120px;margin-bottom:var(--sp-4)"></div>
      <div class="skeleton skeleton-line wide" style="height:200px"></div>`;

    try {
      const data = await Api.rGet('/presence');
      _content = data.content || {};
    } catch (err) {
      el.innerHTML = DashUI.errorState(err.message);
      return;
    }

    const slug = Auth.state()?.slug;
    const base = window.KRAVON_FRONTEND_BASE || 'http://localhost:8000';
    const pageUrl = `${base}/presence/?slug=${encodeURIComponent(slug || '')}`;

    el.innerHTML = `
      <div class="toolbar">
        <div class="toolbar-left">
          <span class="text-sm text-muted">What customers see when they visit your page</span>
        </div>
        <div class="toolbar-right">
          <a href="${pageUrl}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">View my page →</a>
        </div>
      </div>
      <div style="max-width:720px" id="pers-editor"></div>`;
    const editor = el.querySelector('#pers-editor');

    _renderBranding(editor);
    _renderBasics(editor);
    _renderContact(editor);
    _renderSocial(editor);
    _renderStory(editor);
    _renderSignatureDishes(editor);
    _renderGallery(editor);
    _renderFeatured(editor);
    _renderTimeline(editor);
  }

  return { init };
})();
