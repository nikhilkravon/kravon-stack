/* ═══════════════════════════════════════════════════════════
   PRESENCE — BEHAVIOUR.JS
   Minimal interaction layer. No cart, no commerce.
   ═══════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  window.initBehaviour = function () {
    // Smooth-scroll for any in-page anchor clicks
    document.addEventListener('click', function (e) {
      const a = e.target.closest('a[href^="#"]');
      if (!a) return;
      const target = document.querySelector(a.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    // Mobile nav toggle: clone right-side CTAs into drawer and toggle visibility
    const body = document.body;
    const toggle = document.getElementById('pNavToggle');
    const drawer = document.getElementById('pNavDrawer');
    const backdrop = document.getElementById('pNavBackdrop');

    let _focusTrapHandler = null;

    function enableFocusTrap(container) {
      const focusable = Array.from(container.querySelectorAll('a,button,input,select,textarea,[tabindex]:not([tabindex="-1"])')).filter(Boolean);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      _focusTrapHandler = function (e) {
        if (e.key !== 'Tab') return;
        if (focusable.length === 0) { e.preventDefault(); return; }
        if (e.shiftKey) {
          if (document.activeElement === first) { e.preventDefault(); last.focus(); }
        } else {
          if (document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      };
      document.addEventListener('keydown', _focusTrapHandler);
    }

    function disableFocusTrap() {
      if (!_focusTrapHandler) return;
      document.removeEventListener('keydown', _focusTrapHandler);
      _focusTrapHandler = null;
    }

    function openDrawer() {
      body.classList.add('drawer-open');
      toggle.setAttribute('aria-expanded', 'true');
      drawer.setAttribute('aria-hidden', 'false');
      backdrop.setAttribute('aria-hidden', 'false');
      // populate drawer with nav-right content if empty
      if (drawer.innerHTML.trim() === '') {
        const right = document.querySelector('.p-nav-right');
        if (right) drawer.innerHTML = right.innerHTML;
      }
      // focus first focusable element inside drawer and enable trap
      const first = drawer.querySelector('a,button'); if (first) first.focus();
      enableFocusTrap(drawer);
    }

    function closeDrawer() {
      body.classList.remove('drawer-open');
      toggle.setAttribute('aria-expanded', 'false');
      drawer.setAttribute('aria-hidden', 'true');
      backdrop.setAttribute('aria-hidden', 'true');
      disableFocusTrap();
      toggle.focus();
    }

    if (toggle && drawer && backdrop) {
      toggle.addEventListener('click', function () {
        const expanded = toggle.getAttribute('aria-expanded') === 'true';
        if (expanded) closeDrawer(); else openDrawer();
      });

      backdrop.addEventListener('click', closeDrawer);

      // close on Esc
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && body.classList.contains('drawer-open')) {
          closeDrawer();
        }
      });

      // close drawer when a link inside it is clicked
      drawer.addEventListener('click', function (e) {
        const a = e.target.closest('a');
        if (a) closeDrawer();
      });
    }

    // Gallery lightbox: delegated handler and runtime lightbox node with keyboard nav
    (function setupLightbox() {
      const galleryRoot = document.querySelector('.p-gallery-grid');
      if (!galleryRoot) return;

      // gather images in order
      const galleryImgs = Array.from(galleryRoot.querySelectorAll('img')).map(i => i.src);

      // create lightbox element if not present
      let lb = document.getElementById('pLightbox');
      if (!lb) {
        lb = document.createElement('div');
        lb.id = 'pLightbox';
        lb.className = 'p-lightbox';
        lb.innerHTML = `
          <button class="p-lightbox-close" aria-label="Close">✕</button>
          <button class="p-lightbox-prev" aria-label="Previous">‹</button>
          <img src="" alt="" />
          <button class="p-lightbox-next" aria-label="Next">›</button>
        `;
        document.body.appendChild(lb);
      }

      const imgEl = lb.querySelector('img');
      const closeBtn = lb.querySelector('.p-lightbox-close');
      const prevBtn = lb.querySelector('.p-lightbox-prev');
      const nextBtn = lb.querySelector('.p-lightbox-next');
      let currentIndex = -1;

      function showByIndex(i) {
        if (i < 0 || i >= galleryImgs.length) return;
        currentIndex = i;
        imgEl.src = galleryImgs[i];
        imgEl.alt = '';
        lb.classList.add('open');
        lb.setAttribute('aria-hidden', 'false');
        closeBtn.focus();
      }

      function openLightbox(src) {
        const idx = galleryImgs.indexOf(src);
        if (idx >= 0) showByIndex(idx); else {
          // unknown image (dynamic), just show it
          currentIndex = -1;
          imgEl.src = src; lb.classList.add('open'); lb.setAttribute('aria-hidden', 'false'); closeBtn.focus();
        }
      }

      function closeLightbox() {
        lb.classList.remove('open');
        lb.setAttribute('aria-hidden', 'true');
        imgEl.src = '';
      }

      function prevImg() { if (galleryImgs.length) showByIndex((currentIndex - 1 + galleryImgs.length) % galleryImgs.length); }
      function nextImg() { if (galleryImgs.length) showByIndex((currentIndex + 1) % galleryImgs.length); }

      galleryRoot.addEventListener('click', function (e) {
        const item = e.target.closest('.p-gallery-item');
        if (!item) return;
        const img = item.querySelector('img');
        if (!img) return;
        openLightbox(img.src);
      });

      closeBtn.addEventListener('click', closeLightbox);
      if (prevBtn) prevBtn.addEventListener('click', prevImg);
      if (nextBtn) nextBtn.addEventListener('click', nextImg);
      lb.addEventListener('click', function (e) {
        if (e.target === lb) closeLightbox();
      });

      // click on image to advance/retreat depending on side clicked
      imgEl.addEventListener('click', function (e) {
        const rect = imgEl.getBoundingClientRect();
        if (e.clientX < rect.left + rect.width / 2) prevImg(); else nextImg();
      });

      // keyboard handlers for lightbox navigation and close
      document.addEventListener('keydown', function (e) {
        if (!lb.classList.contains('open')) return;
        if (e.key === 'Escape') return closeLightbox();
        if (e.key === 'ArrowLeft') return prevImg();
        if (e.key === 'ArrowRight') return nextImg();
      });
    })();

    // Sticky CTA: show a compact CTA when hero scrolls out of view
    (function setupStickyCta() {
      const hero = document.querySelector('.p-hero');
      const navRight = document.querySelector('.p-nav-right');
      if (!navRight) return;

      let sticky = document.getElementById('pStickyCta');
      if (!sticky) {
        sticky = document.createElement('div');
        sticky.id = 'pStickyCta';
        sticky.className = 'p-sticky-cta';
        const primary = navRight.querySelector('.p-btn-primary') || navRight.querySelector('.p-btn');
        sticky.innerHTML = primary ? primary.outerHTML : '';
        document.body.appendChild(sticky);
        sticky.addEventListener('click', function (e) {
          const a = e.target.closest('a'); if (a) a.click();
        });
      }

      if (hero && 'IntersectionObserver' in window) {
        const obs = new IntersectionObserver(entries => {
          entries.forEach(en => {
            if (!en.isIntersecting) sticky.classList.add('visible'); else sticky.classList.remove('visible');
          });
        }, { threshold: 0 });
        obs.observe(hero);
      } else {
        window.addEventListener('scroll', function () {
          if (window.scrollY > 200) sticky.classList.add('visible'); else sticky.classList.remove('visible');
        });
      }
    })();
  };

})();
