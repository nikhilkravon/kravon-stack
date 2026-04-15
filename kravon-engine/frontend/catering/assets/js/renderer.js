/* ═══════════════════════════════════════════════════════════
   RENDERER.JS — Builds and mounts the entire DOM from CONFIG.
   No content is hardcoded here. All text comes from config.js.
   Depends on: config/config.js
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── SVG helper ── */
  var SVG_ARROW =
    '<svg viewBox="0 0 16 16"><path d="M8 1l7 7-7 7-1.4-1.4 4.6-4.6H1V8h10.2L6.6 3.4z"/></svg>';

  var SVG_WA =
    '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">' +
    '<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15' +
    '-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475' +
    '-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52' +
    '.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207' +
    '-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372' +
    '-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487' +
    '.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413' +
    '.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>' +
    '<path d="M12 0C5.373 0 0 5.373 0 12c0 2.136.561 4.14 1.535 5.874L0 24l6.335-1.51' +
    'A11.955 11.955 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0z' +
    'm0 22c-1.885 0-3.65-.49-5.19-1.348l-.37-.219-3.762.897.938-3.667-.24-.378' +
    'A9.96 9.96 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>';

  /* ── DOM helper ── */
  function h(tag, cls, html, attrs) {
    var el = document.createElement(tag);
    if (cls)              el.className = cls;
    if (html !== undefined) el.innerHTML = html;
    if (attrs) Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    return el;
  }

  /* Expose for behaviour.js scrollTo */
  window.scrollToSection = function (id) {
    var el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  /* ── DEMO BANNER ── */
  function renderDemoBanner(position) {
    var banner = h('div', 'demo-banner ' + position);
    banner.setAttribute('role', 'banner');
    banner.setAttribute('aria-label', 'Demo page notice');
    var inner = h('div', 'demo-banner-inner');
    inner.innerHTML =
      '<span class="demo-badge">' + CONFIG.demo.badge + '</span>' +
      '<span class="demo-text">' + CONFIG.demo.text + '</span>' +
      '<span class="demo-sep"></span>' +
      '<div class="demo-chips">' +
      CONFIG.demo.chips.map(function (c) {
        return '<span class="demo-chip">' + c + '</span>';
      }).join('') +
      '</div>';
    banner.appendChild(inner);
    return banner;
  }

  /* ── CREDENTIAL BAR ── */
  function renderCredBar() {
    var bar  = h('div', 'cred-bar');
    var left = h('div', 'cred-left');
    CONFIG.credBar.items.forEach(function (txt) {
      left.appendChild(h('div', 'cred-item', txt));
    });
    var right = h('div', 'cred-right',
      'Proposals: <a href="mailto:' + CONFIG.contact.email + '">' +
      CONFIG.contact.email + '</a>');
    bar.appendChild(left);
    bar.appendChild(right);
    return bar;
  }

  /* ── NAV ── */
  function renderNav() {
    var nav   = h('nav', 'nav');
    var brand = h('div', 'nav-brand',
      '<div class="nav-name">'     + CONFIG.brand.name     + '</div>' +
      '<div class="nav-rule"></div>' +
      '<div class="nav-category">' + CONFIG.brand.division + '</div>');
    var btn = h('button', 'btn btn-gold', SVG_ARROW + ' Start a Proposal');
    btn.id = 'nav-cta';
    btn.dataset.action = 'scroll-proposal';
    nav.appendChild(brand);
    nav.appendChild(btn);
    return nav;
  }

  /* ── HERO ── */
  function renderHero() {
    var sec   = h('section', 'hero');
    sec.appendChild(h('div', 'hero-glow', '', { 'aria-hidden': 'true' }));

    var wrap  = h('div', 'wrap');
    var inner = h('div', 'hero-inner');
    var copy  = h('div', 'hero-copy');

    copy.appendChild(h('span', 'hero-eyebrow', CONFIG.hero.eyebrow));
    copy.appendChild(h('h1', 'hero-h1',
      CONFIG.hero.headline.map(function (l) { return l + '<br>'; }).join('')));
    copy.appendChild(h('p', 'hero-sub', CONFIG.hero.sub));

    var actions = h('div', 'hero-actions');
    var btnP = h('button', 'btn btn-gold', SVG_ARROW + ' ' + CONFIG.hero.ctaPrimary);
    btnP.id = 'hero-cta-primary';
    btnP.dataset.action = 'scroll-proposal';
    var btnS = h('button', 'btn btn-ghost', CONFIG.hero.ctaSecondary);
    btnS.id = 'hero-cta-secondary';
    btnS.dataset.action = 'scroll-packages';
    actions.appendChild(btnP);
    actions.appendChild(btnS);
    copy.appendChild(actions);
    inner.appendChild(copy);
    wrap.appendChild(inner);
    sec.appendChild(wrap);

    var panel = h('div', 'hero-panel');
    CONFIG.hero.stats.forEach(function (s) {
      var stat = h('div', 'h-stat');
      stat.appendChild(h('span', 'h-stat-n' + (s.gold ? ' gold' : ''), s.value));
      stat.appendChild(h('span', 'h-stat-lbl', s.label.replace('\n', '<br>')));
      panel.appendChild(stat);
    });
    panel.appendChild(h('div', 'h-panel-note', CONFIG.hero.panelNote));
    sec.appendChild(panel);
    return sec;
  }

  /* ── TRUSTED BY ── */
  function renderTrusted() {
    var div   = h('div', 'trusted', '', { 'aria-label': 'Contracted by' });
    var wrap  = h('div', 'wrap');
    var inner = h('div', 'trusted-inner');
    inner.appendChild(h('span', 'trusted-tag', 'Contracted by'));
    inner.appendChild(h('div', 'trusted-vr', '', { 'aria-hidden': 'true' }));
    var trackWrap = h('div', 'trusted-track-wrap');
    var track     = h('div', 'trusted-track', '', { 'aria-hidden': 'true' });
    [1, 2].forEach(function () {
      CONFIG.trustedBy.forEach(function (co) {
        track.appendChild(h('span', 'trusted-co', co));
        track.appendChild(h('span', 'trusted-pip'));
      });
    });
    trackWrap.appendChild(track);
    inner.appendChild(trackWrap);
    wrap.appendChild(inner);
    div.appendChild(wrap);
    return div;
  }

  /* ── POSITION ── */
  function renderPosition() {
    var sec   = h('section', 'position');
    var wrap  = h('div', 'wrap');
    var inner = h('div', 'position-inner');
    var lbl   = h('div', 'position-lbl',
      '<span class="label label-gold">' + CONFIG.position.label + '</span>');
    var text  = h('p', 'position-text', CONFIG.position.body);
    inner.appendChild(lbl);
    inner.appendChild(text);
    wrap.appendChild(inner);
    sec.appendChild(wrap);
    return sec;
  }

  /* ── PACKAGES ── */
  function renderPackages() {
    var sec  = h('section', 'packages');
    sec.id   = 'packages';
    var wrap = h('div', 'wrap');

    var head = h('div', 'sec-head r');
    var row  = h('div', 'sec-head-row');
    var left = h('div', '',
      '<span class="label label-gold">' + CONFIG.packages.label + '</span>' +
      '<div class="sec-title">'         + CONFIG.packages.title.join('<br>') + '</div>');
    var ann  = h('div', 'sec-annotation',
      CONFIG.packages.annotation.replace(/\n/g, '<br>'));
    row.appendChild(left);
    row.appendChild(ann);
    head.appendChild(row);
    wrap.appendChild(head);

    var grid = h('div', 'pkg-grid');
    CONFIG.packages.tiers.forEach(function (tier, i) {
      var card = h('div', 'pkg' + (tier.featured ? ' pkg-featured' : '') + ' r d' + (i + 1));
      if (tier.stamp) card.appendChild(h('div', 'pkg-stamp', tier.stamp));

      card.appendChild(h('div', 'pkg-head',
        '<span class="pkg-tier">'  + tier.num   + '</span>' +
        '<div class="pkg-name">'   + tier.name  + '</div>' +
        '<div class="pkg-scope">'  + tier.scope + '</div>'));

      card.appendChild(h('div', 'pkg-price-block',
        '<span class="pkg-price-lbl">Starting from</span>' +
        '<div><span class="pkg-price">' + tier.price +
        '</span><span class="pkg-price-unit"> / engagement</span></div>' +
        '<div class="pkg-range-note">Typical: ' + tier.typical + '</div>'));

      card.appendChild(h('div', 'pkg-body',
        '<span class="pkg-incl-lbl">What\'s included</span>' +
        '<ul class="pkg-list">' +
        tier.includes.map(function (it) { return '<li>' + it + '</li>'; }).join('') +
        '</ul>'));

      var foot = h('div', 'pkg-foot');
      var btn  = h('button', 'pkg-btn', 'Request Proposal →');
      btn.dataset.action = 'scroll-proposal';
      foot.appendChild(btn);
      card.appendChild(foot);
      grid.appendChild(card);
    });
    wrap.appendChild(grid);
    sec.appendChild(wrap);
    return sec;
  }

  /* ── PROCESS ── */
  function renderProcess() {
    var sec   = h('section', 'process');
    var wrap  = h('div', 'wrap');
    var inner = h('div', 'process-inner');

    inner.appendChild(h('div', 'process-lede',
      '<span class="label label-gold">'  + CONFIG.process.label + '</span>' +
      '<div class="process-lede-title">' + CONFIG.process.title.join('<br>') + '</div>' +
      '<p class="process-lede-body">'    + CONFIG.process.lede + '</p>'));

    var rows = h('div', 'process-rows');
    CONFIG.process.steps.forEach(function (s, i) {
      var row = h('div', 'process-row r' + (i > 0 ? ' d' + i : ''));
      row.appendChild(h('div', 'process-n', s.n));
      row.appendChild(h('div', '',
        '<div class="process-title">' + s.title + '</div>' +
        '<div class="process-body">'  + s.body  + '</div>'));
      row.appendChild(h('div', 'process-timing', s.timing));
      rows.appendChild(row);
    });
    inner.appendChild(rows);
    wrap.appendChild(inner);
    sec.appendChild(wrap);
    return sec;
  }

  /* ── CAPACITY ── */
  function renderCapacity() {
    var sec  = h('section', 'capacity');
    var wrap = h('div', 'wrap');

    var head = h('div', 'sec-head r');
    var row  = h('div', 'sec-head-row');
    row.appendChild(h('div', '',
      '<span class="label label-gold">' + CONFIG.capacity.label + '</span>' +
      '<div class="sec-title">'         + CONFIG.capacity.title.join('<br>') + '</div>'));
    row.appendChild(h('div', 'sec-annotation',
      CONFIG.capacity.annotation.replace(/\n/g, '<br>')));
    head.appendChild(row);
    wrap.appendChild(head);

    var grid = h('div', 'cap-grid');
    CONFIG.capacity.cells.forEach(function (c, i) {
      var cell = h('div', 'cap-cell r d' + (i + 1));
      var n    = h('span', 'cap-n');
      var count = h('span', '', c.value);
      count.dataset.target = String(c.target);
      n.appendChild(count);
      if (c.unit) n.appendChild(h('span', 'cap-unit', c.unit));
      cell.appendChild(n);
      cell.appendChild(h('span', 'cap-lbl', c.label));
      cell.appendChild(h('p',    'cap-sub', c.sub));
      grid.appendChild(cell);
    });
    wrap.appendChild(grid);

    var comp = h('div', 'compliance r');
    CONFIG.capacity.compliance.forEach(function (c) {
      comp.appendChild(h('div', 'comp-item',
        '<div class="comp-pip"></div>' +
        '<span class="comp-lbl">' + c.label + '</span>' +
        '<span class="comp-val">' + c.value + '</span>'));
    });
    wrap.appendChild(comp);
    sec.appendChild(wrap);
    return sec;
  }

  /* ── MENU SHOWCASE ── */
  function renderMenu() {
    var sec  = h('section', 'menu');
    var wrap = h('div', 'wrap');

    var head = h('div', 'sec-head r');
    var row  = h('div', 'sec-head-row');
    row.appendChild(h('div', '',
      '<span class="label label-gold">' + CONFIG.menu.label + '</span>' +
      '<div class="sec-title">'         + CONFIG.menu.title.join('<br>') + '</div>'));
    row.appendChild(h('div', 'sec-annotation',
      CONFIG.menu.annotation.replace(/\n/g, '<br>')));
    head.appendChild(row);
    wrap.appendChild(head);

    var tabs = h('div', 'menu-tabs', '', { role: 'tablist' });
    CONFIG.menu.tabs.forEach(function (tab, i) {
      var btn = h('button', 'menu-tab' + (i === 0 ? ' active' : ''), tab.label,
        { role: 'tab' });
      btn.dataset.menuId = tab.id;
      btn.dataset.action = 'switch-menu';
      tabs.appendChild(btn);
    });
    wrap.appendChild(tabs);

    CONFIG.menu.tabs.forEach(function (tab, i) {
      var panel = h('div', 'menu-panel' + (i === 0 ? ' active' : ''));
      panel.id = 'menu-' + tab.id;
      tab.cols.forEach(function (col) {
        var mc = h('div', 'menu-col');
        mc.appendChild(h('span', 'menu-col-lbl', col.heading));
        var items = h('div', 'menu-items');
        col.items.forEach(function (it) {
          items.appendChild(h('div', 'menu-row',
            '<span class="menu-pip"></span>' +
            '<div><span class="menu-dish">' + it.dish + '</span>' +
            '<span class="menu-note">'      + it.note + '</span></div>'));
        });
        mc.appendChild(items);
        panel.appendChild(mc);
      });
      wrap.appendChild(panel);
    });

    wrap.appendChild(h('div', 'menu-foot',
      CONFIG.menu.footNotes.map(function (n) {
        return '<span>' + n + '</span>';
      }).join('')));
    sec.appendChild(wrap);
    return sec;
  }

  /* ── TESTIMONIALS ── */
  function renderTestimonials() {
    var sec  = h('section', 'testi');
    var wrap = h('div', 'wrap');
    wrap.appendChild(h('div', 'sec-head r',
      '<span class="label label-gold">' + CONFIG.testimonials.label + '</span>' +
      '<div class="sec-title">'         + CONFIG.testimonials.title.join('<br>') + '</div>'));

    var grid = h('div', 'testi-grid');
    CONFIG.testimonials.items.forEach(function (t, i) {
      var card = h('div', 'testi-card r d' + (i + 1));
      card.appendChild(h('div', 'testi-mark', '"', { 'aria-hidden': 'true' }));
      card.appendChild(h('p',   'testi-quote', t.quote));
      card.appendChild(h('div', 'testi-byline',
        '<span class="testi-name">' + t.name + '</span>' +
        '<span class="testi-role">' + t.role + '</span>' +
        '<span class="testi-deal">' + t.deal + '</span>'));
      grid.appendChild(card);
    });
    wrap.appendChild(grid);
    sec.appendChild(wrap);
    return sec;
  }

  /* ── PROPOSAL FORM ── */
  function renderForm() {
    var sec  = h('section', 'form-sec');
    sec.id   = 'proposal';
    var wrap = h('div', 'wrap');
    var layout = h('div', 'form-layout');

    /* Left context column */
    var ctx = h('div', '',
      '<span class="label label-gold form-intro-lbl">' + CONFIG.form.label + '</span>' +
      '<div class="form-intro-title">'  + CONFIG.form.title.join('<br>') + '</div>' +
      '<p class="form-intro-body">'     + CONFIG.form.intro + '</p>');
    var steps = h('div', 'form-steps');
    CONFIG.form.steps.forEach(function (s) {
      steps.appendChild(h('div', 'form-step',
        '<span class="form-step-n">'   + s.n   + '</span>' +
        '<span class="form-step-txt">' + s.txt + '</span>'));
    });
    ctx.appendChild(steps);
    layout.appendChild(ctx);

    /* Right: form engine */
    var engine = h('div', 'form-engine');
    engine.id  = 'formEngine';
    var main   = h('div', 'f-main');

    /* Engagement type */
    var b1 = h('div', 'f-block');
    b1.appendChild(h('span', 'f-lbl', 'Type of engagement'));
    var p1 = h('div', 'pills');
    CONFIG.form.engagementTypes.forEach(function (o) {
      p1.innerHTML +=
        '<div class="pill"><input type="radio" name="type" id="' + o.id +
        '" value="' + o.value + '"><label for="' + o.id + '">' + o.label + '</label></div>';
    });
    b1.appendChild(p1);
    main.appendChild(b1);

    /* Pax */
    var b2 = h('div', 'f-block');
    b2.appendChild(h('span', 'f-lbl', 'Expected headcount'));
    var p2 = h('div', 'pills');
    CONFIG.form.paxOptions.forEach(function (o) {
      p2.innerHTML +=
        '<div class="pill"><input type="radio" name="pax" id="' + o.id +
        '" value="' + o.value + '"><label for="' + o.id + '">' + o.label + '</label></div>';
    });
    b2.appendChild(p2);
    main.appendChild(b2);

    /* Date range */
    var b3 = h('div', 'f-block');
    b3.appendChild(h('span', 'f-lbl',
      'Event date range <span class="f-lbl-note">— from / to</span>'));
    b3.innerHTML +=
      '<div class="date-pair">' +
        '<div class="date-field">' +
          '<span class="date-field-lbl">From</span>' +
          '<input type="date" id="feventstart" autocomplete="off">' +
        '</div>' +
        '<div class="date-field">' +
          '<span class="date-field-lbl">To</span>' +
          '<input type="date" id="feventend" autocomplete="off" disabled>' +
        '</div>' +
      '</div>' +
      '<div class="date-duration" id="fduration"></div>';
    main.appendChild(b3);

    /* Budget */
    var b4 = h('div', 'f-block');
    b4.appendChild(h('span', 'f-lbl', 'Approximate budget'));
    var p4 = h('div', 'pills');
    CONFIG.form.budgetOptions.forEach(function (o) {
      p4.innerHTML +=
        '<div class="pill"><input type="radio" name="budget" id="' + o.id +
        '" value="' + o.value + '"><label for="' + o.id + '">' + o.label + '</label></div>';
    });
    b4.appendChild(p4);
    main.appendChild(b4);

    /* Contact fields */
    var b5 = h('div', 'f-block');
    b5.innerHTML =
      '<div class="field-row" style="margin-bottom:1px;">' +
        '<div class="field" id="ff-name">' +
          '<label for="fname">Your Name <span class="req-star" aria-hidden="true">*</span></label>' +
          '<input type="text" id="fname" autocomplete="name" placeholder="Ananya Sharma" required aria-required="true">' +
        '</div>' +
        '<div class="field" id="ff-company">' +
          '<label for="fcompany">Company <span class="req-star" aria-hidden="true">*</span></label>' +
          '<input type="text" id="fcompany" autocomplete="organization" placeholder="Acme Corp Pvt. Ltd." required aria-required="true">' +
        '</div>' +
      '</div>' +
      '<div class="field-row" style="margin-bottom:1px;">' +
        '<div class="field" id="ff-phone">' +
          '<label for="fphone">Mobile <span class="req-star" aria-hidden="true">*</span></label>' +
          '<input type="tel" id="fphone" autocomplete="tel" placeholder="+91 98765 43210" required aria-required="true">' +
        '</div>' +
        '<div class="field" id="ff-email">' +
          '<label for="femail">Work Email <span class="req-star" aria-hidden="true">*</span></label>' +
          '<input type="email" id="femail" autocomplete="email" placeholder="ananya@acmecorp.com" required aria-required="true">' +
        '</div>' +
      '</div>' +
      '<div class="field-row single">' +
        '<div class="field">' +
          '<label for="fnotes">Additional notes ' +
            '<span style="opacity:0.3;font-style:italic;text-transform:none;letter-spacing:0;">— optional</span>' +
          '</label>' +
          '<textarea id="fnotes" placeholder="Venue, dietary requirements, anything else relevant…"></textarea>' +
        '</div>' +
      '</div>';
    main.appendChild(b5);

    /* Submit */
    var b6  = h('div', 'f-block');
    var row = h('div', 'f-submit');
    var note = h('span', 'f-submit-note',
      CONFIG.form.submitNote.replace('\n', '<br>'));
    var subBtn = h('button', 'btn btn-gold',
      SVG_ARROW + ' ' + CONFIG.form.submitLabel);
    subBtn.id = 'form-submit-btn';
    subBtn.dataset.action = 'submit-form';
    row.appendChild(note);
    row.appendChild(subBtn);
    b6.appendChild(row);
    main.appendChild(b6);
    engine.appendChild(main);

    /* Confirm state */
    var conf = h('div', 'f-confirm',
      '<span class="confirm-ref" id="confirmRef">Ref —</span>' +
      '<div class="confirm-tier-row">' +
        '<span class="confirm-tier" id="confirmTier"></span>' +
        '<span class="confirm-sla"  id="confirmSla"></span>' +
      '</div>' +
      '<div class="confirm-h">' + CONFIG.form.confirmTitle.join('<br>') + '</div>' +
      '<p class="confirm-body">'  + CONFIG.form.confirmBody + '</p>' +
      '<div class="confirm-steps">' +
        '<span class="confirm-steps-lbl">What happens next</span>' +
        '<div class="confirm-step-list">' +
        CONFIG.form.confirmSteps.map(function (s) {
          return '<div class="confirm-step">' + s + '</div>';
        }).join('') +
        '</div></div>' +
      '<a class="confirm-wa" id="confirmWa" href="#" target="_blank" rel="noopener" style="display:none;">' +
        SVG_WA + ' Notify owner on WhatsApp' +
      '</a>');
    engine.appendChild(conf);

    /* Redirect state */
    var redir = h('div', 'f-redirect',
      '<div class="redirect-h">'  + CONFIG.form.redirectTitle + '</div>' +
      '<p class="redirect-body">' + CONFIG.form.redirectBody  + '</p>' +
      '<a class="redirect-lnk" href="' + CONFIG.brand.redirectUrl + '">' +
        CONFIG.form.redirectLabel + '</a>');
    engine.appendChild(redir);

    layout.appendChild(engine);
    wrap.appendChild(layout);
    sec.appendChild(wrap);
    return sec;
  }

  /* ── FAQ ── */
  function renderFaq() {
    var sec   = h('section', 'faq');
    var wrap  = h('div', 'wrap');
    var inner = h('div', 'faq-inner');

    inner.appendChild(h('div', '',
      '<span class="label label-gold">' + CONFIG.faq.label + '</span>' +
      '<div class="faq-lede-title">'    + CONFIG.faq.title.join('<br>') + '</div>' +
      '<p class="faq-lede-body">'       + CONFIG.faq.ledeBody + '</p>'));

    var list = h('div', 'faq-list');
    CONFIG.faq.items.forEach(function (item) {
      var fi  = h('div', 'faq-item');
      var btn = h('button', 'faq-q',
        '<span class="faq-q-txt">' + item.q + '</span>' +
        '<span class="faq-icon" aria-hidden="true">+</span>');
      btn.dataset.action = 'toggle-faq';
      var ans = h('div', 'faq-a',
        '<div class="faq-a-inner">' + item.a + '</div>');
      fi.appendChild(btn);
      fi.appendChild(ans);
      list.appendChild(fi);
    });
    inner.appendChild(list);
    wrap.appendChild(inner);
    sec.appendChild(wrap);
    return sec;
  }

  /* ── FOOTER ── */
  function renderFooter() {
    var b  = CONFIG.brand;
    var ft = h('footer');
    ft.appendChild(h('div', '',
      '<div class="footer-brand">' + b.name + ' — Catering Division</div>' +
      '<div class="footer-reg">' +
        b.name + ' Catering Pvt. Ltd. · CIN: ' + b.cin + ' · GST: ' + b.gst + '<br>' +
        'FSSAI Licence No. ' + b.fssai + ' · Registered: ' + b.address + '<br>' +
        '&copy; 2025 ' + b.name + '. All rights reserved.' +
      '</div>'));
    ft.appendChild(h('div', 'footer-contact',
      'Proposals: <a href="mailto:' + b.email    + '">' + b.email    + '</a><br>' +
      'Operations: <a href="mailto:' + b.emailOps + '">' + b.emailOps + '</a><br>' +
      'Contracts: ' + b.phone + '<br>' +
      'Operations: ' + b.phoneOps));
    return ft;
  }

  /* ── MOBILE CTA BAR ── */
  function renderMobCta() {
    var div  = h('div', 'mob-cta', '', { 'aria-hidden': 'true' });
    var info = h('div', 'mob-cta-info',
      'Corporate catering<br>Contracts from ' + CONFIG.brand.minContract);
    var btn = h('button', 'btn btn-gold', 'Request Proposal →');
    btn.id = 'mob-cta-btn';
    btn.dataset.action = 'scroll-proposal';
    div.appendChild(info);
    div.appendChild(btn);
    return div;
  }

  /* ── SET PAGE META ── */
  function setMeta() {
    var t = document.getElementById('pageTitle');
    if (t) t.textContent =
      CONFIG.meta.title;
    var d = document.getElementById('pageDescription');
    if (d) d.setAttribute('content', CONFIG.meta.description);
  }

  /* ── MOUNT ALL ── */
  function mount() {
    var body = document.body;
    setMeta();

    if (CONFIG.demo && CONFIG.demo.show) {
      body.classList.add('has-demo-banners');
      body.appendChild(renderDemoBanner('top'));
    }

    body.appendChild(renderCredBar());
    body.appendChild(renderNav());
    body.appendChild(renderHero());
    body.appendChild(renderTrusted());
    body.appendChild(renderPosition());
    body.appendChild(renderPackages());
    body.appendChild(renderProcess());
    body.appendChild(renderCapacity());
    body.appendChild(renderMenu());
    body.appendChild(renderTestimonials());
    body.appendChild(renderForm());
    body.appendChild(renderFaq());
    body.appendChild(renderFooter());
    body.appendChild(renderMobCta());

    if (CONFIG.demo && CONFIG.demo.show) {
      body.appendChild(renderDemoBanner('bottom'));
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

})();
