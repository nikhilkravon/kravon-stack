/* ═══════════════════════════════════════════════════════════
   BEHAVIOUR.JS — All interactive logic.
   Depends on: config/config.js (for form config + brand)
   Depends on: renderer.js (DOM must be mounted first)
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ─────────────────────────────────────────────────────────
     SCROLL HELPERS
  ───────────────────────────────────────────────────────── */
  function scrollTo(id) {
    var el = document.getElementById(id);
    if (!el) return;
    /* Offset for sticky nav (56px) + cred-bar (~38px) + 6px air = ~100px */
    var offset = 100;
    var top = el.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top: top, behavior: 'smooth' });
  }

  /* ─────────────────────────────────────────────────────────
     DELEGATED CLICK HANDLER
     Single listener on document — handles all data-action attrs.
     No inline onclick anywhere in the codebase.
  ───────────────────────────────────────────────────────── */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.dataset.action;

    switch (action) {
      case 'scroll-proposal':
        scrollTo('proposal');
        break;
      case 'scroll-packages':
        scrollTo('packages');
        break;
      case 'switch-menu':
        switchMenu(btn.dataset.menuId, btn);
        break;
      case 'toggle-faq':
        toggleFaq(btn);
        break;
      case 'submit-form':
        submitForm();
        break;
    }
  });

  /* ─────────────────────────────────────────────────────────
     MENU TABS
     Exposed on window because the <head> script in the original
     source referenced it globally; kept for parity.
  ───────────────────────────────────────────────────────── */
  function switchMenu(id, btn) {
    document.querySelectorAll('.menu-panel').forEach(function (p) {
      p.classList.remove('active');
    });
    document.querySelectorAll('.menu-tab').forEach(function (t) {
      t.classList.remove('active');
    });
    var panel = document.getElementById('menu-' + id);
    if (panel) panel.classList.add('active');
    if (btn) btn.classList.add('active');
  }
  /* switchMenu is used only via data-action delegation above — no window export needed */

  /* ─────────────────────────────────────────────────────────
     FAQ ACCORDION
  ───────────────────────────────────────────────────────── */
  function toggleFaq(btn) {
    var item   = btn.closest('.faq-item');
    var isOpen = item.classList.contains('open');
    document.querySelectorAll('.faq-item.open').forEach(function (el) {
      el.classList.remove('open');
    });
    if (!isOpen) item.classList.add('open');
  }
  window.toggleFaq = toggleFaq;

  /* ─────────────────────────────────────────────────────────
     FORM STATE MACHINE
  ───────────────────────────────────────────────────────── */
  function setFormState(state) {
    var engine = document.getElementById('formEngine');
    if (!engine) return;
    engine.dataset.state = state;
    setTimeout(function () {
      engine.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
  }

  function markError(fieldId) {
    var el = document.getElementById(fieldId);
    if (!el) return;
    el.classList.add('has-error');
    setTimeout(function () { el.classList.remove('has-error'); }, 2500);
  }

  /* ─────────────────────────────────────────────────────────
     LEAD SCORING
     Hot  (8–10) → priority badge + fast SLA
     Warm (5–7)  → standard confirmation
     Cool (1–4)  → polite confirm, longer SLA note
  ───────────────────────────────────────────────────────── */
  function scoreLead(budgetVal, paxVal, typeVal) {
    var score = 0;
    var bpts = { 'below-1L': 0, '1-2.5L': 2, '2.5-5L': 3, '5L+': 4 };
    var ppts = { '50-150': 1, '150-300': 2, '300-500': 3, '500+': 3 };
    var tpts = { 'daily-office': 3, 'conference': 3, 'corporate-offsite': 2, 'product-launch': 2, 'other': 1 };
    score += (bpts[budgetVal] || 0);
    score += (ppts[paxVal]    || 0);
    score += (tpts[typeVal]   || 1);
    return score;
  }

  function scoreTier(score) {
    if (score >= 8) return 'hot';
    if (score >= 5) return 'warm';
    return 'cool';
  }

  /* ─────────────────────────────────────────────────────────
     FORM SUBMIT
  ───────────────────────────────────────────────────────── */
  /* ═══════════════════════════════════════════════════════════
     SUBMIT FORM — V7 → V8 MIGRATION
     Before: wrote lead to localStorage + opened WhatsApp deep-link
     After:  POSTs to kravon-core API (primary store),
             then opens WhatsApp deep-link (secondary notification)
     The confirmation screen logic is UNCHANGED.
     ═══════════════════════════════════════════════════════════ */
  function submitForm() {
    var name    = (document.getElementById('fname').value    || '').trim();
    var company = (document.getElementById('fcompany').value || '').trim();
    var email   = (document.getElementById('femail').value   || '').trim();
    var phone   = (document.getElementById('fphone').value   || '').trim();
    var budget  = document.querySelector('input[name="budget"]:checked');
    var pax     = document.querySelector('input[name="pax"]:checked');
    var type    = document.querySelector('input[name="type"]:checked');
    var dateS   = (document.getElementById('feventstart').value || '');
    var dateE   = (document.getElementById('feventend').value   || '');
    var notes   = (document.getElementById('fnotes').value || '').trim();

    /* Validate required contact fields */
    var valid = true;
    [['ff-name', name], ['ff-company', company], ['ff-email', email], ['ff-phone', phone]]
      .forEach(function (f) {
        if (!f[1]) { valid = false; markError(f[0]); }
      });
    if (!valid) return;

    /* Budget redirect check */
    if (budget) {
      var budgetCfg = (CONFIG.form.budgetOptions || []).filter(function (b) {
        return b.value === budget.value;
      })[0];
      if (budgetCfg && budgetCfg.redirect) {
        setFormState('redirect');
        return;
      }
    }

    var budgetVal = budget ? budget.value : '';
    var paxVal    = pax    ? pax.value    : '';
    var typeVal   = type   ? type.value   : '';

    /* Disable submit button during API call */
    var submitBtn = document.querySelector('[data-action="submit-form"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Sending…'; }

    /* POST to kravon-core API */
    KravonAPI.submitLead({
      name:       name,
      company:    company,
      email:      email,
      phone:      phone,
      budget:     budgetVal  || undefined,
      pax:        paxVal     || undefined,
      event_type: typeVal    || undefined,
      date_start: dateS      || undefined,
      date_end:   dateE      || undefined,
      notes:      notes      || undefined,
    }).then(function(result) {
      /* result = { ref, tier } from the API */
      var ref  = result.ref;
      var tier = result.tier;

      /* Update confirmation UI — same as V7 */
      var refEl  = document.getElementById('confirmRef');
      var tierEl = document.getElementById('confirmTier');
      var slaEl  = document.getElementById('confirmSla');
      var waBtn  = document.getElementById('confirmWa');

      if (refEl)  refEl.textContent = 'Ref · ' + ref;

      if (tierEl) {
        var tierLabels = { hot: '🔥 Hot lead', warm: '◎ Warm lead', cool: '○ Standard' };
        tierEl.textContent  = tierLabels[tier] || tier;
        tierEl.dataset.tier = tier;
      }

      if (slaEl) {
        var slaText = {
          hot:  'Priority queue · Proposal within 4 business hours',
          warm: 'Proposal within 24–48 business hours',
          cool: 'Under review · Proposal within 48 hours'
        };
        slaEl.textContent = slaText[tier] || '';
      }

      /* WhatsApp deep-link — secondary notification (restaurant owner view) */
      if (waBtn) {
        var waNum = (CONFIG.brand.phone || CONFIG.contact.waNumber || '').replace(/\D/g, '');
        var lines = [
          '📋 *New Catering Lead · ' + ref + '*',
          '*From:* ' + CONFIG.brand.name,
          '',
          '*Name:* '    + name,
          '*Company:* ' + company,
          '*Phone:* '   + phone,
          '*Email:* '   + email,
          '',
          '*Type:* '    + (typeVal   || '—'),
          '*Pax:* '     + (paxVal    || '—'),
          '*Budget:* '  + (budgetVal || '—'),
          '*Tier:* '    + tier.toUpperCase(),
          notes ? '*Notes:* ' + notes : ''
        ].filter(Boolean).join('\n');
        waBtn.href         = 'https://wa.me/' + waNum + '?text=' + encodeURIComponent(lines);
        waBtn.style.display = 'inline-flex';
      }

      setFormState('confirm');

    }).catch(function(err) {
      console.error('[catering] submitLead failed:', err.message);
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = CONFIG.form.submitLabel || 'Send'; }
      /* Show a toast if UI module available, otherwise alert */
      if (typeof UI !== 'undefined' && UI.showToast) {
        UI.showToast('Submission failed. Please try again.');
      } else {
        alert('Submission failed. Please try again.');
      }
    });
  }
  

  /* ─────────────────────────────────────────────────────────
     DATE RANGE PICKERS
  ───────────────────────────────────────────────────────── */
  function initDatePickers() {
    var startEl = document.getElementById('feventstart');
    var endEl   = document.getElementById('feventend');
    var durEl   = document.getElementById('fduration');
    if (!startEl || !endEl) return;

    var today    = new Date();
    var todayStr = today.toISOString().slice(0, 10);
    startEl.setAttribute('min', todayStr);

    startEl.addEventListener('change', function () {
      var val = startEl.value;
      if (!val) {
        endEl.value = '';
        endEl.disabled = true;
        endEl.removeAttribute('min');
        if (durEl) { durEl.textContent = ''; durEl.classList.remove('visible'); }
        return;
      }
      var minEnd = new Date(val);
      minEnd.setDate(minEnd.getDate() + 1);
      endEl.setAttribute('min', minEnd.toISOString().slice(0, 10));
      endEl.disabled = false;
      if (endEl.value && endEl.value <= val) {
        endEl.value = '';
        if (durEl) { durEl.textContent = ''; durEl.classList.remove('visible'); }
      } else if (endEl.value) {
        updateDuration();
      }
    });

    endEl.addEventListener('change', updateDuration);

    function updateDuration() {
      if (!startEl.value || !endEl.value || !durEl) return;
      var ms   = new Date(endEl.value) - new Date(startEl.value);
      var days = Math.round(ms / 86400000);
      if (days > 0) {
        durEl.textContent = days === 1 ? '1 day' : days + ' days';
        durEl.classList.add('visible');
      }
    }
  }

  /* ─────────────────────────────────────────────────────────
     SCROLL REVEAL
  ───────────────────────────────────────────────────────── */
  function initReveal() {
    var revealEls = Array.from(document.querySelectorAll('.r'));

    function showEl(el) { el.classList.add('vis'); }

    function checkViewport() {
      var vh = window.innerHeight;
      revealEls.forEach(function (el) {
        if (!el.classList.contains('vis')) {
          var rect = el.getBoundingClientRect();
          if (rect.top < vh + 80) showEl(el);
        }
      });
    }

    if ('IntersectionObserver' in window) {
      var obs = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { showEl(e.target); obs.unobserve(e.target); }
        });
      }, { threshold: 0, rootMargin: '0px 0px -20px 0px' });
      revealEls.forEach(function (el) { obs.observe(el); });
    }
    window.addEventListener('scroll', checkViewport, { passive: true });
    [60, 250, 700].forEach(function (t) { setTimeout(checkViewport, t); });
  }

  /* ─────────────────────────────────────────────────────────
     COUNTER ANIMATION
  ───────────────────────────────────────────────────────── */
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  function animateCount(el, target) {
    var duration = 1200, start = null;
    function frame(ts) {
      if (!start) start = ts;
      var progress = Math.min((ts - start) / duration, 1);
      el.textContent = Math.round(easeOut(progress) * target);
      if (progress < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function initCounters() {
    if (!('IntersectionObserver' in window)) return;
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          var target = parseInt(e.target.getAttribute('data-target'), 10);
          if (!isNaN(target)) animateCount(e.target, target);
          obs.unobserve(e.target);
        }
      });
    }, { threshold: 0.5 });
    document.querySelectorAll('[data-target]').forEach(function (el) { obs.observe(el); });
  }

  /* ─────────────────────────────────────────────────────────
     INIT — called by main.js after renderer has mounted DOM
  ───────────────────────────────────────────────────────── */
  window.initBehaviour = function () {
    initReveal();
    initCounters();
    initDatePickers();
  };

})();
