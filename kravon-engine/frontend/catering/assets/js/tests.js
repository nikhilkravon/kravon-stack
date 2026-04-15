/* ═══════════════════════════════════════════════════════════
   TESTS.JS — Unit test suite.
   Activate by appending ?test=1 to the URL.
   Tests config integrity, DOM rendering, button targets,
   form interactions, and accessibility attributes.
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  if (window.location.search.indexOf('test=1') === -1) return;

  var results = [];
  var passed  = 0;
  var failed  = 0;

  /* ── ASSERT HELPERS ── */
  function assert(name, condition, detail) {
    var ok = !!condition;
    results.push({ name: name, ok: ok, detail: detail || '' });
    if (ok) passed++; else failed++;
  }

  function assertExists(name, selector) {
    var el = document.querySelector(selector);
    assert(name, !!el, el ? '' : 'Selector not found: ' + selector);
    return el;
  }

  function assertCount(name, selector, expected) {
    var n = document.querySelectorAll(selector).length;
    assert(name, n === expected,
      'Expected ' + expected + ', got ' + n + ' (' + selector + ')');
  }

  /* ── CONFIG INTEGRITY ── */
  function testConfig() {
    assert('CONFIG exists',           typeof CONFIG === 'object', '');
    assert('CONFIG.brand exists',     typeof CONFIG.brand === 'object', '');
    assert('CONFIG.hero exists',      typeof CONFIG.hero === 'object', '');
    assert('CONFIG.packages exists',  typeof CONFIG.packages === 'object', '');
    assert('CONFIG.process exists',   typeof CONFIG.process === 'object', '');
    assert('CONFIG.capacity exists',  typeof CONFIG.capacity === 'object', '');
    assert('CONFIG.menu exists',      typeof CONFIG.menu === 'object', '');
    assert('CONFIG.testimonials exists', typeof CONFIG.testimonials === 'object', '');
    assert('CONFIG.form exists',      typeof CONFIG.form === 'object', '');
    assert('CONFIG.faq exists',       typeof CONFIG.faq === 'object', '');
    assert('CONFIG.credBar exists',   typeof CONFIG.credBar === 'object', '');

    assert('Brand has name',   !!CONFIG.brand.name,   '');
    assert('Brand has email',  !!CONFIG.brand.email,  '');
    assert('Brand has phone',  !!CONFIG.brand.phone,  '');
    assert('Brand has gst',    !!CONFIG.brand.gst,    '');
    assert('Brand has fssai',  !!CONFIG.brand.fssai,  '');

    assert('Hero has headline array', Array.isArray(CONFIG.hero.headline), '');
    assert('Hero headline not empty', CONFIG.hero.headline.length > 0, '');
    assert('Hero has stats array',    Array.isArray(CONFIG.hero.stats), '');
    assert('Hero stats count >= 4',   CONFIG.hero.stats.length >= 4, '');

    assert('CONFIG.trustedBy is array',  Array.isArray(CONFIG.trustedBy), '');
    assert('Has 8 trusted brands',       CONFIG.trustedBy.length === 8, '');

    assert('Packages has tiers array',   Array.isArray(CONFIG.packages.tiers), '');
    assert('Each package tier has name',
      CONFIG.packages.tiers.every(function (t) { return !!t.name; }), '');
    assert('Each package tier has includes array',
      CONFIG.packages.tiers.every(function (t) {
        return Array.isArray(t.includes) && t.includes.length > 0;
      }), '');
    assert('Exactly one featured package',
      CONFIG.packages.tiers.filter(function (t) { return t.featured; }).length === 1, '');

    assert('Process has steps array',    Array.isArray(CONFIG.process.steps), '');
    assert('Each process step has timing',
      CONFIG.process.steps.every(function (s) { return !!s.timing; }), '');

    assert('Capacity has cells array',   Array.isArray(CONFIG.capacity.cells), '');
    assert('Each capacity cell has target number',
      CONFIG.capacity.cells.every(function (c) { return typeof c.target === 'number'; }), '');

    assert('Menu has tabs array',        Array.isArray(CONFIG.menu.tabs), '');

    assert('Testimonials has items array', Array.isArray(CONFIG.testimonials.items), '');

    assert('Form has engagementTypes',   Array.isArray(CONFIG.form.engagementTypes), '');
    assert('Form has paxOptions',        Array.isArray(CONFIG.form.paxOptions), '');
    assert('Form has budgetOptions',     Array.isArray(CONFIG.form.budgetOptions), '');
    assert('One budget option is redirect',
      CONFIG.form.budgetOptions.some(function (b) { return b.redirect === true; }), '');

    assert('FAQ has items array',        Array.isArray(CONFIG.faq.items), '');
    assert('CredBar has items array',    Array.isArray(CONFIG.credBar.items), '');
  }

  /* ── RENDERING ── */
  function testRendering() {
    assertExists('Cred bar rendered',     '.cred-bar');
    assertExists('Nav rendered',          '.nav');
    assertExists('Hero rendered',         '.hero');
    assertExists('Trusted by rendered',   '.trusted');
    assertExists('Position rendered',     '.position');
    assertExists('Packages rendered',     '#packages');
    assertExists('Process rendered',      '.process');
    assertExists('Capacity rendered',     '.capacity');
    assertExists('Menu rendered',         '.menu');
    assertExists('Testimonials rendered', '.testi');
    assertExists('Form rendered',         '#proposal');
    assertExists('FAQ rendered',          '.faq');
    assertExists('Footer rendered',       'footer');
    assertExists('Mob CTA rendered',      '.mob-cta');

    assertCount('Cred bar items',      '.cred-item',    CONFIG.credBar.items.length);
    assertCount('Hero stats',          '.h-stat',       CONFIG.hero.stats.length);
    assertCount('Trusted companies',   '.trusted-co',   CONFIG.trustedBy.length * 2);
    assertCount('Package tiers',       '.pkg',          CONFIG.packages.tiers.length);
    assertCount('Process steps',       '.process-row',  CONFIG.process.steps.length);
    assertCount('Capacity cells',      '.cap-cell',     CONFIG.capacity.cells.length);
    assertCount('Compliance items',    '.comp-item',    CONFIG.capacity.compliance.length);
    assertCount('Menu tabs',           '.menu-tab',     CONFIG.menu.tabs.length);
    assertCount('Menu panels',         '.menu-panel',   CONFIG.menu.tabs.length);
    assertCount('Testimonial cards',   '.testi-card',   CONFIG.testimonials.items.length);
    assertCount('FAQ items',           '.faq-item',     CONFIG.faq.items.length);
    assertCount('FAQ questions',       '.faq-q',        CONFIG.faq.items.length);

    assert('Hero headline rendered',
      document.querySelector('.hero-h1') &&
      document.querySelector('.hero-h1').textContent.trim().length > 0, '');
    assert('Hero eyebrow matches config',
      document.querySelector('.hero-eyebrow') &&
      document.querySelector('.hero-eyebrow').textContent === CONFIG.hero.eyebrow, '');
    assert('Position text rendered',
      document.querySelector('.position-text') &&
      document.querySelector('.position-text').textContent.length > 50, '');
    assert('Brand name in nav',
      document.querySelector('.nav-name') &&
      document.querySelector('.nav-name').textContent === CONFIG.brand.name, '');
    assert('Brand division in nav',
      document.querySelector('.nav-category') &&
      document.querySelector('.nav-category').textContent === CONFIG.brand.division, '');
    assert('Footer brand name',
      document.querySelector('.footer-brand') &&
      document.querySelector('.footer-brand').textContent.indexOf(CONFIG.brand.name) > -1, '');
    assert('Email in cred bar right',
      document.querySelector('.cred-right') &&
      document.querySelector('.cred-right').textContent.indexOf(CONFIG.brand.email) > -1, '');
    assert('Email in footer',
      Array.from(document.querySelectorAll('.footer-contact a')).some(function (a) {
        return a.href.indexOf(CONFIG.brand.email) > -1;
      }), '');
    assert('Featured package has stamp',
      (function () {
        var featured = document.querySelector('.pkg-featured');
        if (!featured) return false;
        var tier = CONFIG.packages.tiers.filter(function (t) { return t.featured; })[0];
        return tier.stamp ? !!featured.querySelector('.pkg-stamp') : true;
      })(), '');
  }

  /* ── BUTTON TARGETS ── */
  function testButtons() {
    assert('Nav CTA exists',
      !!document.getElementById('nav-cta'), '');
    assert('Nav CTA has data-action=scroll-proposal',
      document.getElementById('nav-cta') &&
      document.getElementById('nav-cta').dataset.action === 'scroll-proposal', '');
    assert('Hero primary CTA exists',
      !!document.getElementById('hero-cta-primary'), '');
    assert('Hero primary CTA has data-action=scroll-proposal',
      document.getElementById('hero-cta-primary') &&
      document.getElementById('hero-cta-primary').dataset.action === 'scroll-proposal', '');
    assert('Hero secondary CTA has data-action=scroll-packages',
      document.getElementById('hero-cta-secondary') &&
      document.getElementById('hero-cta-secondary').dataset.action === 'scroll-packages', '');
    assert('Package buttons have data-action=scroll-proposal',
      Array.from(document.querySelectorAll('.pkg-btn')).every(function (b) {
        return b.dataset.action === 'scroll-proposal';
      }), '');
    assert('Submit button has data-action=submit-form',
      document.getElementById('form-submit-btn') &&
      document.getElementById('form-submit-btn').dataset.action === 'submit-form', '');
    assert('Mob CTA button exists',
      !!document.getElementById('mob-cta-btn'), '');
    assert('Mob CTA has data-action=scroll-proposal',
      document.getElementById('mob-cta-btn') &&
      document.getElementById('mob-cta-btn').dataset.action === 'scroll-proposal', '');
    assert('FAQ buttons have data-action=toggle-faq',
      Array.from(document.querySelectorAll('.faq-q')).every(function (b) {
        return b.dataset.action === 'toggle-faq';
      }), '');
    assert('Menu tabs have data-action=switch-menu',
      Array.from(document.querySelectorAll('.menu-tab')).every(function (b) {
        return b.dataset.action === 'switch-menu';
      }), '');
  }

  /* ── INTERACTIONS ── */
  function testInteractions() {
    /* Menu tab switching */
    var tabs = document.querySelectorAll('.menu-tab');
    if (tabs.length >= 2) {
      tabs[1].click();
      assert('Menu tab switch activates tab',
        tabs[1].classList.contains('active'), '');
      assert('Menu tab switch deactivates previous',
        !tabs[0].classList.contains('active'), '');
      /* Reset */
      tabs[0].click();
    }

    /* FAQ toggle */
    var faqBtn = document.querySelector('.faq-q');
    if (faqBtn) {
      faqBtn.click();
      assert('FAQ toggle opens item',
        faqBtn.closest('.faq-item').classList.contains('open'), '');
      faqBtn.click();
      assert('FAQ toggle closes item',
        !faqBtn.closest('.faq-item').classList.contains('open'), '');
    }

    /* Form: submit with empty fields → no state change */
    var engine = document.getElementById('formEngine');
    if (engine) {
      var initialState = engine.dataset.state || '';
      window.submitForm();
      assert('Empty form does not advance state',
        (engine.dataset.state || '') === initialState, '');
    }

    /* Form pax radio renders */
    assert('Pax radios rendered',
      document.querySelectorAll('input[name="pax"]').length === CONFIG.form.paxOptions.length, '');
    assert('Budget radios rendered',
      document.querySelectorAll('input[name="budget"]').length === CONFIG.form.budgetOptions.length, '');
    assert('Type radios rendered',
      document.querySelectorAll('input[name="type"]').length === CONFIG.form.engagementTypes.length, '');

    /* Date picker: start picker exists */
    assert('Start date picker exists',   !!document.getElementById('feventstart'), '');
    assert('End date picker exists',     !!document.getElementById('feventend'), '');
    assert('End date initially disabled',
      document.getElementById('feventend') &&
      document.getElementById('feventend').disabled === true, '');

    /* Config integrity checks relevant to form */
    assert('One budget option is redirect',
      CONFIG.form.budgetOptions.some(function (b) { return b.redirect === true; }), '');
  }

  /* ── ACCESSIBILITY ── */
  function testA11y() {
    assert('Nav has nav element',   !!document.querySelector('nav'), '');
    assert('Hero has h1',           !!document.querySelector('h1'), '');
    assert('Only one h1',           document.querySelectorAll('h1').length === 1, '');
    assert('Menu tabs have role=tab',
      Array.from(document.querySelectorAll('.menu-tab')).every(function (b) {
        return b.getAttribute('role') === 'tab';
      }), '');
    assert('Trusted by has aria-label',
      document.querySelector('.trusted') &&
      document.querySelector('.trusted').getAttribute('aria-label') === 'Contracted by', '');
    assert('Hero glow has aria-hidden',
      document.querySelector('.hero-glow') &&
      document.querySelector('.hero-glow').getAttribute('aria-hidden') === 'true', '');
    assert('Testi marks have aria-hidden',
      Array.from(document.querySelectorAll('.testi-mark')).every(function (el) {
        return el.getAttribute('aria-hidden') === 'true';
      }), '');
    assert('Email links use mailto',
      Array.from(document.querySelectorAll('a[href^="mailto:"]')).length >= 2, '');
    assert('Date input has type=date',
      !!document.querySelector('input[type="date"]'), '');
    assert('All radio inputs have labels',
      Array.from(document.querySelectorAll('input[type="radio"]')).every(function (inp) {
        return !!document.querySelector('label[for="' + inp.id + '"]');
      }), '');
    assert('No inline onclick handlers',
      Array.from(document.querySelectorAll('[onclick]')).length === 0, '');
    assert('All data-action buttons are buttons or have cursor',
      Array.from(document.querySelectorAll('[data-action]')).every(function (el) {
        return el.tagName === 'BUTTON' || el.tagName === 'A';
      }), '');
  }

  /* ── RUN ALL ── */
  function run() {
    testConfig();
    testRendering();
    testButtons();
    testInteractions();
    testA11y();
    renderTestUI();
  }

  /* ── TEST UI ── */
  function renderTestUI() {
    var style = document.createElement('style');
    style.textContent = [
      '#kravon-tests{position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;',
      'background:#0a0a0a;color:#e8e6e0;font-family:"DM Mono",monospace;font-size:13px;',
      'overflow-y:auto;padding:0;}',
      '#kravon-tests-header{background:#111;border-bottom:1px solid #2a2a2a;',
      'padding:20px 32px;display:flex;align-items:center;justify-content:space-between;',
      'position:sticky;top:0;z-index:1;}',
      '#kravon-tests-header h2{font-size:14px;font-weight:400;letter-spacing:2px;',
      'text-transform:uppercase;color:#e8e6e0;margin:0;}',
      '.test-summary{display:flex;gap:32px;}',
      '.test-pass-count{color:#5a9e6f;font-size:13px;letter-spacing:1px;}',
      '.test-fail-count{color:#c0392b;font-size:13px;letter-spacing:1px;}',
      '#kravon-tests-body{padding:24px 32px;}',
      '.test-group{margin-bottom:32px;}',
      '.test-group-title{font-size:10px;letter-spacing:3px;text-transform:uppercase;',
      'color:#666;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #1e1e1e;}',
      '.test-row{display:flex;align-items:flex-start;gap:16px;padding:7px 0;',
      'border-bottom:1px solid #141414;}',
      '.test-row:last-child{border-bottom:none;}',
      '.test-icon{flex-shrink:0;width:16px;font-size:12px;}',
      '.test-icon.pass{color:#5a9e6f;} .test-icon.fail{color:#c0392b;}',
      '.test-name{flex:1;color:#bbb;}',
      '.test-name.fail{color:#e8e6e0;}',
      '.test-detail{font-size:11px;color:#555;margin-top:2px;}',
      '.test-detail.fail{color:#e05555;}',
      '#kravon-tests-close{background:#222;border:1px solid #333;color:#888;',
      'padding:8px 20px;cursor:pointer;font-family:inherit;font-size:11px;',
      'letter-spacing:2px;text-transform:uppercase;}',
      '#kravon-tests-close:hover{color:#e8e6e0;border-color:#555;}',
      '.all-pass-banner{background:#1a3a24;border:1px solid #2d5a3a;color:#5a9e6f;',
      'padding:16px 24px;margin-bottom:24px;font-size:12px;letter-spacing:1px;}',
      '.has-fail-banner{background:#3a1a1a;border:1px solid #5a2a2a;color:#e05555;',
      'padding:16px 24px;margin-bottom:24px;font-size:12px;letter-spacing:1px;}'
    ].join('');
    document.head.appendChild(style);

    var panel = document.createElement('div');
    panel.id  = 'kravon-tests';

    var hdr = document.createElement('div');
    hdr.id  = 'kravon-tests-header';
    var h2  = document.createElement('h2');
    h2.textContent = 'Unit Tests · Kravon Catering (Modular)';
    var summ = document.createElement('div');
    summ.className = 'test-summary';
    summ.innerHTML =
      '<span class="test-pass-count">&#10003; ' + passed + ' passed</span>' +
      (failed ? '<span class="test-fail-count">&#10007; ' + failed + ' failed</span>' : '');
    var closeBtn = document.createElement('button');
    closeBtn.id = 'kravon-tests-close';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', function () { panel.remove(); });
    hdr.appendChild(h2);
    hdr.appendChild(summ);
    hdr.appendChild(closeBtn);
    panel.appendChild(hdr);

    var body = document.createElement('div');
    body.id  = 'kravon-tests-body';

    var banner = document.createElement('div');
    banner.className = failed === 0 ? 'all-pass-banner' : 'has-fail-banner';
    banner.textContent = failed === 0
      ? '✓ All ' + passed + ' tests passed.'
      : '✗ ' + failed + ' test' + (failed > 1 ? 's' : '') + ' failed. ' + passed + ' passed.';
    body.appendChild(banner);

    /* Group results */
    var groups     = {};
    var groupOrder = [];
    results.forEach(function (r) {
      var grp = 'Other';
      if      (r.name.indexOf('CONFIG') === 0)  grp = 'Config';
      else if (r.name.match(/^(Brand|Hero|Packages|Process|Capacity|Menu|Testimonials|FAQ|Form|One budget|CredBar)/))
        grp = 'Config';
      else if (r.name.match(/^(Cred|Nav|Hero rendered|Trusted|Position|Packages rendered|Process rendered|Capacity|Menu rendered|Testimonials|Form rendered|FAQ rendered|Footer|Mob CTA|Email in|Brand name|Brand division|Featured)/))
        grp = 'Rendering';
      else if (r.name.match(/^(Nav CTA|Hero primary|Hero secondary|Package|Submit|Mob CTA has|FAQ buttons|Menu tabs have data)/))
        grp = 'Buttons';
      else if (r.name.match(/^(Menu tab|FAQ toggle|Empty form|Pax|Budget|Type|Start date|End date|Date picker|Config integrity)/))
        grp = 'Interactions';
      else if (r.name.match(/^(Nav has|Hero has|Only one|Menu tabs have role|Trusted by|Hero glow|Testi|Email links|Date input|All radio|No inline|All data)/))
        grp = 'Accessibility';

      if (!groups[grp]) { groups[grp] = []; groupOrder.push(grp); }
      groups[grp].push(r);
    });

    groupOrder.forEach(function (grp) {
      var section = document.createElement('div');
      section.className = 'test-group';
      var title = document.createElement('div');
      title.className = 'test-group-title';
      var gPass = groups[grp].filter(function (r) { return r.ok; }).length;
      var gFail = groups[grp].filter(function (r) { return !r.ok; }).length;
      title.textContent = grp + ' — ' + gPass + ' passed' + (gFail ? ', ' + gFail + ' failed' : '');
      section.appendChild(title);

      groups[grp].forEach(function (r) {
        var row  = document.createElement('div');
        row.className = 'test-row';
        var icon = document.createElement('div');
        icon.className = 'test-icon ' + (r.ok ? 'pass' : 'fail');
        icon.textContent = r.ok ? '✓' : '✗';
        var nameDiv = document.createElement('div');
        nameDiv.style.flex = '1';
        var nameEl  = document.createElement('div');
        nameEl.className = 'test-name' + (r.ok ? '' : ' fail');
        nameEl.textContent = r.name;
        nameDiv.appendChild(nameEl);
        if (r.detail) {
          var det = document.createElement('div');
          det.className = 'test-detail' + (r.ok ? '' : ' fail');
          det.textContent = r.detail;
          nameDiv.appendChild(det);
        }
        row.appendChild(icon);
        row.appendChild(nameDiv);
        section.appendChild(row);
      });
      body.appendChild(section);
    });

    panel.appendChild(body);
    document.body.appendChild(panel);

    console.log('[Kravon Tests] ' + passed + ' passed, ' + failed + ' failed');
  }

  /* Run after renderer has mounted */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(run, 150); });
  } else {
    setTimeout(run, 150);
  }

})();
