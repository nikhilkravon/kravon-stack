/* ═══════════════════════════════════════════════════════════
   KRAVON SHARED — KRAVON.JS
   Utilities shared across all three products.
   Loaded before product-specific scripts.

   Exposes:
     Kravon.scrollReveal()   — intersection observer for .reveal
     Kravon.renderDemoBanner(config)
     Kravon.renderUpgrade(config)
     Kravon.renderFooter(config)
     Kravon.buildWaLink(number, greeting) → string
     Kravon.setWaLinks(url)
   ═══════════════════════════════════════════════════════════ */

const Kravon = (function () {
  'use strict';

  /* ── Scroll reveal ────────────────────────────────────── */
  function scrollReveal() {
    const els = document.querySelectorAll('.reveal');
    if (!els.length) return;

    const observer = new IntersectionObserver(
      (entries) => entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          observer.unobserve(e.target);
        }
      }),
      { threshold: 0.08 }
    );

    els.forEach(el => observer.observe(el));
  }

  /* ── WhatsApp link builder ────────────────────────────── */
  function buildWaLink(number, greeting) {
    const text = encodeURIComponent(greeting || 'Hi!');
    return `https://wa.me/${number}?text=${text}`;
  }

  function setWaLinks(url) {
    document.querySelectorAll('[data-wa-link]').forEach(el => {
      el.href = url;
    });
  }

  /* ── Demo banner ─────────────────────────────────────── */
  function renderDemoBanner(demo) {
    const el = document.getElementById('demoBanner');
    if (!el) return;

    if (!demo || !demo.show) {
      el.style.display = 'none';
      return;
    }

    el.innerHTML = `
      <div class="demo-banner-left">
        <div class="demo-dot" aria-hidden="true"></div>
        <span class="demo-text">${demo.text || ''}</span>
      </div>
      <span class="demo-right">${demo.label || 'kravon.in'}</span>
    `;
  }

  /* ── Upgrade bridge ──────────────────────────────────── */
  function renderUpgrade(upgrade) {
    const el = document.getElementById('upgradeSection');
    if (!el) return;

    if (!upgrade || upgrade.show === false) {
      el.style.display = 'none';
      return;
    }

    el.innerHTML = `
      <div class="wrap">
        <div class="upgrade-inner">
          <div>
            <span class="upgrade-label">${upgrade.label || 'Kravon Products'}</span>
            <div class="upgrade-headline">${upgrade.headline || ''}</div>
          </div>
          <div class="upgrade-right">
            <span class="upgrade-product">${upgrade.productLine || ''}</span>
            <div class="upgrade-sep" aria-hidden="true"></div>
            <a class="upgrade-cta"
               href="${upgrade.ctaUrl || 'https://kravon.in'}"
               target="_blank" rel="noopener noreferrer">
              ${upgrade.ctaLabel || 'Learn more ↗'}
            </a>
          </div>
        </div>
      </div>
    `;
  }

  /* ── Footer ──────────────────────────────────────────── */
  function renderFooter(brand, contact, footer) {
    const left = document.getElementById('footerLeft');
    if (left) {
      left.innerHTML =
        `© ${brand.year || new Date().getFullYear()} ${brand.name}` +
        (contact && contact.city ? ` · ${contact.city}` : '') +
        (contact && contact.phone ? `<br>${contact.phone}` : '');
    }

    const kravon = document.getElementById('footerKravon');
    if (kravon && footer) {
      kravon.innerHTML =
        `${footer.poweredBy || 'Powered by'} ` +
        `<a href="${footer.poweredUrl || 'https://kravon.in'}" ` +
        `target="_blank" rel="noopener noreferrer">` +
        `${footer.poweredLabel || 'Kravon'}</a>`;
    }

    const note = document.getElementById('footerNote');
    if (note && footer && footer.privacyNote) {
      note.textContent = footer.privacyNote;
    }
  }

  /* ── Toast notification ──────────────────────────────── */
  function toast(msg, duration) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), duration || 2400);
  }

  /* ── Public API ──────────────────────────────────────── */
  return {
    scrollReveal,
    buildWaLink,
    setWaLinks,
    renderDemoBanner,
    renderUpgrade,
    renderFooter,
    toast,
  };

})();

window.Kravon = Kravon;
