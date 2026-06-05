/* ═══════════════════════════════════════════════════════════
   PRESENCE — RENDERER.JS
   Pure marketing site. No cart, no checkout, no order state.
   Sections: Hero → Story → Signature Dishes → Gallery →
             Featured → Timeline → Contact → Footer
   ═══════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  let C;
  const $  = id => document.getElementById(id);
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls)             e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  };

  /* ── Feature-aware CTAs ──────────────────────────────────
     Returns an array of CTA anchor/button strings based on
     which products the tenant has enabled.
  ────────────────────────────────────────────────────────── */
  function buildCtAs(sizeCls, navMode) {
    const cap  = C.capabilities || C.products || {};
    const sc   = sizeCls ? ` ${sizeCls}` : '';
    const slug = C.slug || '';
    const ctas = [];

    // View Menu — links to orders page if ordering is enabled, else scrolls to #menu section
    if (cap.orderManagement || cap.orders) {
      ctas.push(`<a href="/orders/?slug=${encodeURIComponent(slug)}" class="p-btn p-btn-primary${sc}">View Menu</a>`);
    } else {
      ctas.push(`<a href="#menu" class="p-btn p-btn-primary${sc}">View Menu</a>`);
    }

    if (cap.tables) {
      ctas.push(`<a href="/tables/?slug=${encodeURIComponent(slug)}" class="p-btn p-btn-secondary${sc}">Order at Table</a>`);
      // Reserve a Table: hero only — too many buttons for nav
      if (!navMode) {
        ctas.push(`<a href="/presence/reservation.html?slug=${encodeURIComponent(slug)}" class="p-btn p-btn-secondary${sc}">Reserve a Table</a>`);
      }
    }

    if (cap.catering && !navMode) {
      ctas.push(`<a href="/catering/?slug=${encodeURIComponent(slug)}" class="p-btn p-btn-secondary${sc}">Plan Event</a>`);
    }

    if (C.contact?.waNumber) {
      const waHref = Kravon.buildWaLink(C.contact.waNumber, C.contact.waGreeting);
      const waIcon = `<svg aria-hidden="true" focusable="false" width="16" height="16"><use href="#icon-wa"/></svg>`;
      ctas.push(`<a href="${waHref}" target="_blank" rel="noopener noreferrer" class="p-btn p-btn-wa${sc}">${waIcon} WhatsApp</a>`);
    } else if (C.contact?.phone) {
      ctas.push(`<a href="tel:${Kravon.esc(C.contact.phone)}" class="p-btn p-btn-secondary${sc}">Call Us</a>`);
    }

    // Nav: show only first CTA (View Menu / Order Online) + WhatsApp to avoid cramping
    if (navMode && ctas.length > 2) {
      return [ctas[0], ctas[ctas.length - 1]].join('\n');
    }

    return ctas.join('\n');
  }

  /* ── NAV ──────────────────────────────────────────────── */
  function renderNav() {
    const nav = el('nav', 'p-nav');
    nav.setAttribute('aria-label', 'Main navigation');
    nav.innerHTML = `
      <div class="p-nav-inner">
          <div class="p-nav-brand">
            ${C.brand.logoUrl ? `<img src="${Kravon.esc(C.brand.logoUrl)}" alt="${Kravon.esc(C.brand.name)} logo" class="p-nav-logo">` : ''}
            <div>
              <div class="p-nav-name">${Kravon.esc(C.brand.name)}</div>
              <div class="p-nav-tagline">${Kravon.esc(C.brand.tagline)}</div>
            </div>
          </div>
          <div class="p-nav-center">
            <div class="p-nav-hours" aria-label="Opening hours">
              <div class="p-nav-hours-dot" aria-hidden="true"></div>
              ${Kravon.esc(C.hours.navBadge || 'Open Now')}
            </div>
          </div>
          <div class="p-nav-right">
            ${buildCtAs('', true)}
          </div>
      </div>`;

    window.addEventListener('scroll', () => {
      nav.classList.toggle('p-nav--scrolled', window.scrollY > 20);
    }, { passive: true });

    return nav;
  }

  /* ── HERO ─────────────────────────────────────────────── */
  function renderHero() {
    const headline = C.hero?.headline || C.brand.name  || '';
    const sub      = C.hero?.sub      || C.brand.tagline || '';
    const heroImg  = C.hero?.image    || 'assets/images/hero-bg.svg';

    // Build slideshow from hero folder images; fall back to single hero image
    const slideshowImgs = (C.hero?.images?.length ? C.hero.images : [heroImg]).filter(Boolean);

    const statsHtml = (C.hero?.stats || []).map(s => `
      <div class="p-hero-stat">
        <span class="p-hero-stat-num${s.className ? ' ' + s.className : ''}">${s.num}</span>
        <span class="p-hero-stat-label">${s.label}</span>
      </div>`).join('');

    const slidesHtml = slideshowImgs.map((src, i) => `
      <div class="p-hero-slide${i === 0 ? ' active' : ''}" aria-hidden="true">
        <img src="${Kravon.esc(src)}" alt="" loading="${i === 0 ? 'eager' : 'lazy'}">
      </div>`).join('');

    const section = el('section', 'p-hero');
    section.setAttribute('aria-labelledby', 'hero-heading');
    section.innerHTML = `
      <div class="p-hero-bg" aria-hidden="true">
        ${slidesHtml}
        <div class="p-hero-overlay"></div>
      </div>
      <div class="p-hero-content p-container">
        <div class="p-hero-text">
          <span class="p-eyebrow">${Kravon.esc(C.brand.eyebrow || '')}</span>
          <h1 class="p-hero-headline" id="hero-heading">${Kravon.esc(headline)}</h1>
          <p class="p-hero-sub">${Kravon.esc(sub)}</p>
          <div class="p-hero-ctas">
            ${buildCtAs('p-btn-lg')}
          </div>
        </div>
        ${statsHtml ? `<div class="p-hero-stats" aria-label="Key highlights">${statsHtml}</div>` : ''}
      </div>
      <div class="p-hero-scroll" aria-hidden="true">
        <span class="p-hero-scroll-label">Scroll</span>
        <div class="p-hero-scroll-line"></div>
      </div>`;

    // Auto-rotate slides every 5s
    if (slideshowImgs.length > 1) {
      const slides = section.querySelectorAll('.p-hero-slide');
      let cur = 0;
      setInterval(() => {
        slides[cur].classList.remove('active');
        cur = (cur + 1) % slides.length;
        slides[cur].classList.add('active');
      }, 5000);
    }

    return section;
  }

  /* ── STORY ───────────────────────────────────────────── */
  function renderStory() {
    const title = C.story?.headline || `About ${C.brand.name}`;
    const body  = Array.isArray(C.story?.body) ? C.story.body.join('\n\n') : (C.story?.body || '');
    if (!body && !title) return null;

    const bodyHtml = body
      ? body.split('\n\n').filter(Boolean).map(p => `<p>${Kravon.esc(p)}</p>`).join('')
      : '';
    const factsHtml = (C.story?.facts || []).map(f => `
      <div class="p-sfact">
        <span class="p-sfact-icon" aria-hidden="true">${Kravon.esc(f.icon)}</span>
        <div class="p-sfact-title">${Kravon.esc(f.title)}</div>
        <div class="p-sfact-body">${Kravon.esc(f.body)}</div>
      </div>`).join('');

    const section = el('section', 'p-story p-section');
    section.setAttribute('aria-labelledby', 'story-heading');
    section.innerHTML = `
      <div class="p-container">
        <div class="p-story-grid">
          <div class="p-story-text">
            <span class="p-eyebrow">Our Story</span>
            <h2 class="p-headline" id="story-heading">${Kravon.esc(title)}</h2>
            <div class="p-story-body">${bodyHtml}</div>
            ${factsHtml ? `<div class="p-story-facts">${factsHtml}</div>` : ''}
          </div>
          <div class="p-story-image reveal">
            <img src="${Kravon.esc(C.story?.image || C.hero?.image || 'assets/images/about.svg')}" alt="Restaurant interior — ${Kravon.esc(C.brand.name)}" loading="lazy">
          </div>
        </div>
      </div>`;
    return section;
  }

  /* ── SIGNATURE DISHES ────────────────────────────────── */
  function renderSignatureDishes() {
    const dishes = C.signatureDishes || [];
    if (!dishes.length) return null;

    const cardsHtml = dishes.map(d => `
      <article class="p-mcard reveal" aria-label="${Kravon.esc(d.name || '')}">
        ${d.image ? `<div class="p-mcard-image-wrap">
          <img src="${Kravon.esc(d.image)}" alt="${Kravon.esc(d.name || '')}" loading="lazy"
               onerror="this.parentElement.style.display='none'">
        </div>` : ''}
        <div class="p-mcard-body">
          <h3 class="p-mcard-name">${Kravon.esc(d.name || '')}</h3>
          <p class="p-mcard-desc">${Kravon.esc(d.description || '')}</p>
        </div>
      </article>`).join('');

    const section = el('section', 'p-menu p-section');
    section.id = 'menu';
    section.setAttribute('aria-labelledby', 'menu-heading');
    section.innerHTML = `
      <div class="p-container">
        <div class="p-menu-header">
          <div>
            <span class="p-eyebrow">Menu</span>
            <h2 class="p-headline" id="menu-heading">What we serve</h2>
          </div>
        </div>
        <div class="p-menu-grid" role="list" aria-label="Signature dishes">
          ${cardsHtml}
        </div>
      </div>`;
    return section;
  }

  /* ── GALLERY ─────────────────────────────────────────── */
  function renderGallery() {
    const gallery = C.gallery || {};
    const cats = [
      { key: 'all',     label: 'All' },
      { key: 'food',     label: 'Food' },
      { key: 'ambience', label: 'Ambience' },
      { key: 'people',   label: 'People' },
    ];

    const tagged = [
      ...(gallery.food     || []).map(u => ({ url: u, cat: 'food' })),
      ...(gallery.ambience || []).map(u => ({ url: u, cat: 'ambience' })),
      ...(gallery.people   || []).map(u => ({ url: u, cat: 'people' })),
    ].filter(Boolean);
    if (!tagged.length) return null;

    // Only show tabs for categories that have images
    const activeCats = cats.filter(c =>
      c.key === 'all' || tagged.some(t => t.cat === c.key)
    );

    const tabsHtml = activeCats.map(c => `
      <button class="p-gallery-tab${c.key === 'all' ? ' active' : ''}" data-cat="${c.key}">${c.label}</button>`
    ).join('');

    const imgsHtml = tagged.map((item, i) => `
      <div class="p-gallery-item reveal" data-cat="${item.cat}">
        <img src="${Kravon.esc(item.url)}" alt="Gallery photo ${i + 1}" loading="lazy">
      </div>`).join('');

    const section = el('section', 'p-gallery p-section');
    section.setAttribute('aria-labelledby', 'gallery-heading');
    section.innerHTML = `
      <div class="p-container">
        <span class="p-eyebrow">Gallery</span>
        <h2 class="p-headline" id="gallery-heading">See for yourself</h2>
        <div class="p-gallery-tabs" role="tablist">${tabsHtml}</div>
        <div class="p-gallery-grid">${imgsHtml}</div>
      </div>`;

    // Tab filter logic
    const tabs  = section.querySelectorAll('.p-gallery-tab');
    const items = section.querySelectorAll('.p-gallery-item');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const cat = tab.dataset.cat;
        items.forEach(item => {
          const show = cat === 'all' || item.dataset.cat === cat;
          item.style.display = show ? '' : 'none';
        });
      });
    });

    return section;
  }

  /* ── FEATURED ────────────────────────────────────────── */
  function renderFeatured() {
    const items = (C.featured || []).filter(f => f.active !== false);
    if (!items.length) return null;

    const cardsHtml = items.map(f => `
      <article class="p-rcard reveal">
        ${f.image ? `<img src="${Kravon.esc(f.image)}" alt="${Kravon.esc(f.title || '')}" loading="lazy" style="width:100%;border-radius:8px;margin-bottom:var(--sp-3)">` : ''}
        <div class="p-rcard-name" style="font-size:15px;font-weight:600">${Kravon.esc(f.title || '')}</div>
        <blockquote class="p-rcard-text">${Kravon.esc(f.description || '')}</blockquote>
        ${f.ctaLabel && f.ctaUrl ? `<a href="${Kravon.esc(f.ctaUrl)}?slug=${encodeURIComponent(C.slug || '')}" class="p-btn p-btn-secondary" style="margin-top:var(--sp-3)">${Kravon.esc(f.ctaLabel)}</a>` : ''}
      </article>`).join('');

    const section = el('section', 'p-reviews p-section');
    section.setAttribute('aria-labelledby', 'featured-heading');
    section.innerHTML = `
      <div class="p-container">
        <div class="p-reviews-header">
          <span class="p-eyebrow">Featured</span>
          <h2 class="p-headline" id="featured-heading">What's on</h2>
        </div>
        <div class="p-reviews-grid">${cardsHtml}</div>
      </div>`;
    return section;
  }

  /* ── TIMELINE ────────────────────────────────────────── */
  function renderTimeline() {
    const items = C.timeline || [];
    if (!items.length) return null;

    const rowsHtml = items.map(t => `
      <div class="p-how-step">
        <div class="p-how-num" aria-hidden="true">${Kravon.esc(String(t.year || ''))}</div>
        <div>
          <div class="p-how-step-title">${Kravon.esc(t.event || '')}</div>
        </div>
      </div>`).join('');

    const section = el('section', 'p-how p-section');
    section.setAttribute('aria-labelledby', 'timeline-heading');
    section.innerHTML = `
      <div class="p-container">
        <span class="p-eyebrow">Our Journey</span>
        <h2 class="p-headline" id="timeline-heading" style="margin-bottom:var(--sp-8)">The story so far</h2>
        <div class="p-how-steps" style="max-width:560px">${rowsHtml}</div>
      </div>`;
    return section;
  }


  /* ── CONTACT ─────────────────────────────────────────── */
  function renderContact() {
    const pc  = {};
    const loc = C.location || {};

    const phone    = pc.phone    || C.contact?.phone    || '';
    const whatsapp = pc.whatsapp || C.contact?.waNumber || '';
    const email    = pc.email    || C.contact?.email    || '';
    const address  = pc.address  || C.contact?.address  || '';
    const mapUrl   = pc.googleMapsUrl || loc.mapUrl     || null;

    const rows = [
      address  ? { icon: '📍', label: 'Address',   val: address,                        href: mapUrl || null         } : null,
      phone    ? { icon: '📞', label: 'Phone',      val: phone,                          href: `tel:${phone}`         } : null,
      whatsapp ? { icon: '💬', label: 'WhatsApp',   val: whatsapp,                       href: Kravon.buildWaLink(whatsapp, C.contact?.waGreeting || '') } : null,
      email    ? { icon: '✉️',  label: 'Email',      val: email,                          href: `mailto:${email}`      } : null,
      C.hours?.display ? { icon: '🕐', label: 'Hours', val: C.hours.display, href: null } : null,
    ].filter(Boolean);

    if (!rows.length) return null;

    const rowsHtml = rows.map(r => `
      <div class="p-location-row">
        <span class="p-location-row-icon" aria-hidden="true">${r.icon}</span>
        <div>
          <div class="p-location-row-title">${Kravon.esc(r.label)}</div>
          <div class="p-location-row-body">
            ${r.href
              ? `<a href="${Kravon.esc(r.href)}" target="${r.href.startsWith('http') ? '_blank' : '_self'}" rel="noopener noreferrer">${Kravon.esc(r.val)}</a>`
              : Kravon.esc(r.val)}
          </div>
        </div>
      </div>`).join('');

    const section = el('section', 'p-location p-section');
    section.setAttribute('aria-labelledby', 'contact-heading');
    section.innerHTML = `
      <div class="p-container">
        <div class="p-location-grid">
          <div class="p-location-map reveal">
            ${(() => {
              // Use coords from config if provided, otherwise fall back to city-level geocode
              const lat  = loc.lat  || C.contact?.lat  || null;
              const lon  = loc.lon  || C.contact?.lon  || null;
              const link = mapUrl || '#';

              if (lat && lon) {
                const dLon = 0.006;  // ~550m east-west
                const dLat = 0.005;  // ~550m north-south, pin sits upper-third
                const bbox = `${lon - dLon},${lat - dLat * 1.4},${lon + dLon},${lat + dLat * 0.6}`;
                const osmSrc = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lon}`;
                return `
                  <a class="p-location-map-link" href="${Kravon.esc(link)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${Kravon.esc(C.brand.name)} location in maps">
                    <iframe
                      class="p-location-map-iframe"
                      src="${osmSrc}"
                      loading="lazy"
                      title="${Kravon.esc(C.brand.name)} on map"
                      aria-hidden="true"
                      tabindex="-1">
                    </iframe>
                    <div class="p-location-map-overlay">
                      <span class="p-location-map-cta">Open in Maps ↗</span>
                    </div>
                  </a>`;
              }
              // No coords — fall back to CSS placeholder
              return `
                <div class="p-location-map-grid" aria-hidden="true"></div>
                <div class="p-location-pin">
                  <div class="p-location-pin-pulse" aria-hidden="true">📍</div>
                  <div class="p-location-pin-name">${Kravon.esc(C.brand.name)}</div>
                  <div class="p-location-pin-sub">${Kravon.esc(C.contact?.city || '')}</div>
                </div>`;
            })()}
          </div>
          <div class="p-location-info">
            <div>
              <span class="p-eyebrow">Find Us</span>
              <h2 class="p-headline" id="contact-heading">Visit ${Kravon.esc(C.brand.name)}</h2>
            </div>
            <div class="p-location-rows">${rowsHtml}</div>
            <div style="margin-top:var(--sp-5);display:flex;gap:var(--sp-3);flex-wrap:wrap">
              ${buildCtAs()}
            </div>
          </div>
        </div>
      </div>`;
    return section;
  }

  /* ── MOUNT ───────────────────────────────────────────── */
  function mount() {
    document.title = C.meta?.title || C.brand.name;
    $('pageDescription')?.setAttribute('content', C.meta?.description || '');

    const app = $('app');
    const sections = [
      renderNav(),
      renderHero(),
      renderStory(),
      renderSignatureDishes(),
      renderGallery(),
      renderFeatured(),
      renderTimeline(),
      renderContact(),
    ];

    sections.filter(Boolean).forEach(s => app.appendChild(s));

    Kravon.renderDemoBanner(C.demo);
    Kravon.renderUpgrade(C.upgrade);
    Kravon.renderFooter(C.brand, C.contact, C.footer);
    if (C.contact?.waNumber) {
      Kravon.setWaLinks(Kravon.buildWaLink(C.contact.waNumber, C.contact.waGreeting));
    }
    Kravon.scrollReveal();
  }

  window.initRenderer = function () {
    C = window.CONFIG;
    mount();
  };

})();
