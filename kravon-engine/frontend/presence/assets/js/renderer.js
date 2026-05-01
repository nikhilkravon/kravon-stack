/* ═══════════════════════════════════════════════════════════
   PRESENCE — RENDERER.JS  (Premium Redesign)
   Builds the entire page DOM from CONFIG + MENU.
   No content lives in index.html.
   ═══════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  let C, M;
  const $  = id => document.getElementById(id);
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls)  e.className   = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  };

  /* ── Helpers ─────────────────────────────────────────── */
  function esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function waLink() {
    return Kravon.buildWaLink(C.contact.waNumber, C.contact.waGreeting);
  }

  function waIcon(size) {
    const s = size || 16;
    return `<svg aria-hidden="true" focusable="false" width="${s}" height="${s}"><use href="#icon-wa"/></svg>`;
  }

  function currency(n) {
    return `${C.order.currency}${n}`;
  }

  /* Image cycling for menu items */
  function foodImg(index) {
    const n = String((index % 6) + 1).padStart(2, '0');
    return `assets/images/food-${n}.svg`;
  }

  /* ── NAV ─────────────────────────────────────────────── */
  function renderNav() {
    const reserveBtn = C.products?.tables
      ? `<a href="reservation.html" class="p-btn p-btn-secondary" aria-label="Reserve a table">Reserve Table</a>`
      : '';

    const nav = el('nav', 'p-nav');
    nav.setAttribute('aria-label', 'Main navigation');
    nav.innerHTML = `
      <div class="p-container">
        <div class="p-nav-inner">
          <div class="p-nav-brand">
            <div class="p-nav-name">${esc(C.brand.name)}</div>
            <div class="p-nav-tagline">${esc(C.brand.tagline)}</div>
          </div>
          <div class="p-nav-center">
            <div class="p-nav-hours" aria-label="Opening hours">
              <div class="p-nav-hours-dot" aria-hidden="true"></div>
              ${C.hours.navBadge}
            </div>
          </div>
          ${reserveBtn}
          <a href="${waLink()}" target="_blank" rel="noopener noreferrer"
             class="p-btn p-btn-wa" data-wa-link aria-label="Order on WhatsApp">
            ${waIcon()} Order on WhatsApp
          </a>
        </div>
      </div>
    `;

    /* Scroll behaviour — add class when page is scrolled */
    window.addEventListener('scroll', () => {
      nav.classList.toggle('p-nav--scrolled', window.scrollY > 20);
    }, { passive: true });

    return nav;
  }

  /* ── HERO ─────────────────────────────────────────────── */
  function renderHero() {
    const statsHtml = C.hero.stats.map(s => `
      <div class="p-hero-stat">
        <span class="p-hero-stat-num${s.className ? ' ' + s.className : ''}">${s.num}</span>
        <span class="p-hero-stat-label">${s.label.replace('\n', ' ')}</span>
      </div>`).join('');

    const reserveHeroCta = C.products?.tables
      ? `<a href="reservation.html" class="p-btn p-btn-secondary p-btn-lg" aria-label="Reserve a table">Reserve Table</a>`
      : '';

    const section = el('section', 'p-hero');
    section.setAttribute('aria-labelledby', 'hero-heading');
    section.innerHTML = `
      <div class="p-hero-bg" aria-hidden="true">
        <img src="assets/images/hero-bg.svg" alt="" loading="eager">
        <div class="p-hero-overlay"></div>
      </div>
      <div class="p-hero-content p-container">
        <div class="p-hero-text">
          <span class="p-eyebrow">${esc(C.brand.eyebrow)}</span>
          <h1 class="p-hero-headline" id="hero-heading">${esc(C.hero.headline)}</h1>
          <p class="p-hero-sub">${esc(C.hero.sub)}</p>
          <div class="p-hero-ctas">
            <a href="#menu" class="p-btn p-btn-primary p-btn-lg" aria-label="Browse the menu">
              Browse Menu
            </a>
            ${reserveHeroCta}
            <a href="${waLink()}" target="_blank" rel="noopener noreferrer"
               class="p-btn p-btn-wa p-btn-lg" data-wa-link aria-label="Order on WhatsApp">
              ${waIcon(18)} ${esc(C.hero.ctaLabel)}
            </a>
          </div>
          <span class="p-hero-note">${esc(C.hero.footnote)}</span>
        </div>
        <div class="p-hero-stats" aria-label="Key highlights">
          ${statsHtml}
        </div>
      </div>
      <div class="p-hero-scroll" aria-hidden="true">
        <span class="p-hero-scroll-label">Scroll</span>
        <div class="p-hero-scroll-line"></div>
      </div>
    `;
    return section;
  }

  /* ── STORY ───────────────────────────────────────────── */
  function renderStory() {
    const bodyHtml = C.story.body.map(p => `<p>${esc(p)}</p>`).join('');
    const factsHtml = C.story.facts.map(f => `
      <div class="p-sfact">
        <span class="p-sfact-icon" aria-hidden="true">${esc(f.icon)}</span>
        <div class="p-sfact-title">${esc(f.title)}</div>
        <div class="p-sfact-body">${esc(f.body)}</div>
      </div>`).join('');

    const section = el('section', 'p-story p-section');
    section.setAttribute('aria-labelledby', 'story-heading');
    section.innerHTML = `
      <div class="p-container">
        <div class="p-story-grid">
          <div class="p-story-text">
            <span class="p-eyebrow">${esc(C.story.label)}</span>
            <h2 class="p-headline" id="story-heading">${esc(C.story.headline)}</h2>
            <div class="p-story-body">${bodyHtml}</div>
            <div class="p-story-facts">
              ${factsHtml}
            </div>
          </div>
          <div class="p-story-image reveal">
            <img src="assets/images/about.svg" alt="Restaurant interior — ${C.brand.name}" loading="lazy">
          </div>
        </div>
      </div>
    `;
    return section;
  }

  /* ── MENU ────────────────────────────────────────────── */
  function renderMenuCtrl(id) {
    const item = M.find(m => String(m.id) === id);
    // Count qty from EnhancedCart
    const cartItems = EnhancedCart.items().filter(ci => String(ci.menuItemId) === String(id));
    const qty = cartItems.reduce((sum, ci) => sum + ci.quantity, 0);
    
    // All items can be customized via modal (show Customize button)
    const customizeBtn = `<button class="customize-btn" data-action="customize" data-id="${id}" aria-label="Customize ${item.name}">Customize</button>`;
    if (qty === 0) {
      return customizeBtn;
    }
    // Show customize button + quantity indicator
    return `
      <div class="customize-with-qty">
        ${customizeBtn}
        <div class="qty-badge" aria-label="${qty} item(s) in cart">${qty}</div>
      </div>`;
  }

  function renderMenuGrid() {
    return M.map((item, index) => {
      const badgeHtml = item.badge
        ? `<span class="p-badge p-mcard-badge ${item.badgeClass}">${item.badge}</span>` : '';
      return `
        <article class="p-mcard reveal" aria-label="${esc(item.name)}">
          <div class="p-mcard-image-wrap">
            <img src="${foodImg(index)}" alt="${esc(item.name)}" loading="lazy">
            ${badgeHtml}
          </div>
          <div class="p-mcard-body">
            <h3 class="p-mcard-name">${esc(item.name)}</h3>
            <p class="p-mcard-desc">${esc(item.desc)}</p>
            <div class="p-mcard-footer">
              <div class="p-mcard-price">${currency(item.price)}</div>
              <div id="ctrl-${item.id}">${renderMenuCtrl(item.id)}</div>
            </div>
          </div>
        </article>`;
    }).join('');
  }

  function renderMenu() {
    const section = el('section', 'p-menu p-section');
    section.id = 'menu';
    section.setAttribute('aria-labelledby', 'menu-heading');
    section.innerHTML = `
      <div class="p-container">
        <div class="p-menu-header">
          <div>
            <span class="p-eyebrow">${esc(C.menu.label)}</span>
            <h2 class="p-headline" id="menu-heading">${esc(C.menu.headline)}</h2>
          </div>
          <div class="p-menu-note" aria-hidden="true">${esc(C.menu.waNote)}</div>
        </div>
        <div class="p-menu-grid" id="menuGrid" role="list" aria-label="Menu items">
          ${renderMenuGrid()}
        </div>
        <p class="p-menu-footnote">${esc(C.order.footnote)}</p>
      </div>
    `;
    return section;
  }

  /* ── HOW IT WORKS ────────────────────────────────────── */
  function renderHow() {
    const stepsHtml = C.how.steps.map((s, i) => `
      <li class="p-how-step">
        <div class="p-how-num" aria-hidden="true">${String(i + 1).padStart(2, '0')}</div>
        <div>
          <div class="p-how-step-title">${esc(s.title)}</div>
          <div class="p-how-step-body">${esc(s.body)}</div>
        </div>
      </li>`).join('');

    const benefitsHtml = C.how.benefits
      .map(b => `<li class="p-how-benefit">${esc(b)}</li>`).join('');

    const section = el('section', 'p-how p-section');
    section.setAttribute('aria-labelledby', 'how-heading');
    section.innerHTML = `
      <div class="p-container">
        <div class="p-how-grid">
          <div>
            <span class="p-eyebrow">${esc(C.how.label)}</span>
            <h2 class="p-headline" id="how-heading">${esc(C.how.headline)}</h2>
            <ol class="p-how-steps" aria-label="Ordering steps">${stepsHtml}</ol>
          </div>
          <div>
            <div class="p-how-wa-card">
              <span class="p-how-wa-icon" aria-hidden="true">${esc(C.how.waCard.icon)}</span>
              <div class="p-how-wa-title">${esc(C.how.waCard.title)}</div>
              <p class="p-how-wa-sub">${esc(C.hours.kitchenNote)}</p>
              <a href="${waLink()}" target="_blank" rel="noopener noreferrer"
                 class="p-btn p-btn-wa p-btn-lg" data-wa-link aria-label="Start order on WhatsApp">
                ${waIcon(18)} ${esc(C.how.waCard.ctaLabel)}
              </a>
            </div>
            <ul class="p-how-benefits" aria-label="Order benefits">${benefitsHtml}</ul>
          </div>
        </div>
      </div>
    `;
    return section;
  }

  /* ── REVIEWS ─────────────────────────────────────────── */
  function renderReviews() {
    const cardsHtml = C.reviews.items.map(r => {
      const stars = '★'.repeat(r.stars) + '☆'.repeat(5 - r.stars);
      return `
        <article class="p-rcard reveal">
          <span class="p-rcard-stars" aria-label="${r.stars} out of 5 stars">${stars}</span>
          <blockquote class="p-rcard-text">"${esc(r.text)}"</blockquote>
          <div class="p-rcard-author">
            <div class="p-rcard-avatar" aria-hidden="true">${esc(r.avatar)}</div>
            <div>
              <div class="p-rcard-name">${esc(r.name)}</div>
              <div class="p-rcard-source">${esc(r.source)}</div>
            </div>
          </div>
        </article>`;
    }).join('');

    const section = el('section', 'p-reviews p-section');
    section.setAttribute('aria-labelledby', 'reviews-heading');
    section.innerHTML = `
      <div class="p-container">
        <div class="p-reviews-header">
          <span class="p-eyebrow">${esc(C.reviews.label)}</span>
          <h2 class="p-headline" id="reviews-heading">${esc(C.reviews.headline)}</h2>
        </div>
        <div class="p-reviews-grid">${cardsHtml}</div>
      </div>
    `;
    return section;
  }

  /* ── LOCATION ────────────────────────────────────────── */
  function renderLocation() {
    const rowsHtml = C.location.rows.map(row => {
      const bodyCls = row.highlight
        ? 'p-location-row-body p-location-row-body--hl'
        : 'p-location-row-body';
      return `
        <div class="p-location-row">
          <span class="p-location-row-icon" aria-hidden="true">${esc(row.icon)}</span>
          <div>
            <div class="p-location-row-title">${esc(row.title)}</div>
            <div class="${bodyCls}">${esc(row.body)}</div>
          </div>
        </div>`;
    }).join('');

    const section = el('section', 'p-location p-section');
    section.setAttribute('aria-labelledby', 'location-heading');
    section.innerHTML = `
      <div class="p-container">
        <div class="p-location-grid">
          <div class="p-location-map reveal" role="img" aria-label="${esc(C.location.mapLabel)}">
            <div class="p-location-map-grid" aria-hidden="true"></div>
            <div class="p-location-pin">
              <div class="p-location-pin-pulse" aria-hidden="true">📍</div>
              <div class="p-location-pin-name">${esc(C.location.pinName)}</div>
              <div class="p-location-pin-sub">${esc(C.location.pinSub)}</div>
            </div>
          </div>
          <div class="p-location-info">
            <div>
              <span class="p-eyebrow">Find Us</span>
              <h2 class="p-headline" id="location-heading">${esc(C.location.label)}</h2>
            </div>
            <div class="p-location-rows">${rowsHtml}</div>
            <a href="${waLink()}" target="_blank" rel="noopener noreferrer"
               class="p-btn p-btn-wa" data-wa-link aria-label="Order on WhatsApp">
              ${waIcon()} Order on WhatsApp
            </a>
          </div>
        </div>
      </div>
    `;
    return section;
  }

  /* ── MOUNT ───────────────────────────────────────────── */
  function mount() {
    document.title = C.meta.title;
    document.getElementById('pageDescription').setAttribute('content', C.meta.description);

    const app = $('app');
    app.appendChild(renderNav());
    app.appendChild(renderHero());
    app.appendChild(renderStory());
    app.appendChild(renderMenu());
    app.appendChild(renderHow());
    app.appendChild(renderReviews());
    app.appendChild(renderLocation());

    Kravon.renderDemoBanner(C.demo);
    Kravon.renderUpgrade(C.upgrade);
    Kravon.renderFooter(C.brand, C.contact, C.footer);
    Kravon.setWaLinks(Kravon.buildWaLink(C.contact.waNumber, C.contact.waGreeting));
    Kravon.scrollReveal();
  }

  window.initRenderer = function () {
    C = window.CONFIG;
    M = window.MENU;
    mount();
  };

  window.PresenceRenderer = {
    updateMenuCtrl: function (id) {
      const ctrl = document.getElementById(`ctrl-${id}`);
      if (ctrl) ctrl.innerHTML = renderMenuCtrl(id);
    }
  };

})();
