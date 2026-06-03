/* ═══════════════════════════════════════════════════════════
   REVIEW PAGE — review.js
   Standalone post-experience review page.

   URL params:
     slug        — restaurant slug (required)
     order       — order UUID (optional)
     session     — dining session UUID (optional)
     reservation — reservation UUID (optional)
     source      — 'order' | 'reservation' | 'catering' | 'link' (optional)
     api         — API base URL override (optional)

   Flow:
     1. Boot: resolve slug, load config
     2. Show star rating
     3a. Stars >= threshold → Google review nudge
     3b. Stars < threshold → private feedback textarea
     4. Thank you screen
   ═══════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  /* ── Query params ───────────────────────────────────────── */
  const q    = new URLSearchParams(window.location.search);
  const slug = RESTAURANT_SLUG_ENV || q.get('slug');
  const api  = (KRAVON_API_URL || '').replace(/\/$/, '');

  const orderId      = q.get('order')       || null;
  const sessionId    = q.get('session')     || null;
  const reservId     = q.get('reservation') || null;
  const source       = q.get('source')      || 'link';

  /* ── State ──────────────────────────────────────────────── */
  let _config        = null;
  let _selectedStars = 0;
  let _submitted     = false;

  /* ── DOM refs ───────────────────────────────────────────── */
  const $ = id => document.getElementById(id);

  /* ── Step navigation ────────────────────────────────────── */
  function showStep(id) {
    ['rvStepRate','rvStepFeedback','rvStepGoogle','rvStepThanks','rvStepError'].forEach(s => {
      const el = $(s);
      if (el) el.style.display = s === id ? '' : 'none';
    });
  }

  /* ── Subheading copy by source ──────────────────────────── */
  function sourceSubheading() {
    switch (source) {
      case 'order':       return 'How was your delivery?';
      case 'reservation': return 'How was your dining experience?';
      case 'catering':    return 'How did the catering go?';
      default:            return 'We\'d love to hear from you.';
    }
  }

  /* ── API helpers ────────────────────────────────────────── */
  async function fetchConfig() {
    const res = await fetch(`${api}/v1/restaurants/${slug}/config`);
    if (!res.ok) throw new Error('Config fetch failed');
    return res.json();
  }

  async function postReview(payload) {
    const res = await fetch(`${api}/v1/restaurants/${slug}/reviews`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Review submission failed');
    }
    return res.json();
  }

  /* ── Boot ───────────────────────────────────────────────── */
  async function boot() {
    if (!slug) {
      $('rvLoading').style.display = 'none';
      $('rvCard').style.display = '';
      showStep('rvStepError');
      return;
    }

    try {
      const data = await fetchConfig();
      _config = data;

      // Populate brand
      const brand = data.brand || {};
      $('pageTitle').textContent = `Rate ${brand.name || 'your experience'}`;
      $('rvBrandName').textContent = brand.name || '';

      // Logo if available
      if (brand.logo_url) {
        const img = document.createElement('img');
        img.src       = brand.logo_url;
        img.alt       = brand.name || '';
        img.className = 'rv-brand-logo';
        $('rvBrand').insertBefore(img, $('rvBrandName'));
      }

      // Source-aware subheading
      $('rvSubheading').textContent = sourceSubheading();

      // Wire star buttons
      document.querySelectorAll('.rv-star').forEach(btn => {
        btn.addEventListener('click', () => handleRating(parseInt(btn.dataset.stars, 10)));
      });

      // Wire feedback submit
      $('rvSubmitFeedback').addEventListener('click', submitFeedback);
      $('rvSkipFeedback').addEventListener('click', () => showThanks(false));
      $('rvSkipGoogle').addEventListener('click', () => showThanks(true));

      // Show card
      $('rvLoading').style.display = 'none';
      $('rvCard').style.display = '';
      showStep('rvStepRate');

    } catch (err) {
      console.error('[review] boot failed:', err.message);
      $('rvLoading').style.display = 'none';
      $('rvCard').style.display = '';
      showStep('rvStepError');
    }
  }

  /* ── Handle star tap ────────────────────────────────────── */
  async function handleRating(stars) {
    if (_submitted) return;
    _selectedStars = stars;

    // Update star visuals
    document.querySelectorAll('.rv-star').forEach(btn => {
      const n = parseInt(btn.dataset.stars, 10);
      btn.classList.toggle('active', n <= stars);
      btn.setAttribute('aria-pressed', n <= stars ? 'true' : 'false');
    });

    // Disable stars while submitting
    document.querySelectorAll('.rv-star').forEach(b => b.disabled = true);

    try {
      const result = await postReview({
        order_id:      orderId   || undefined,
        session_id:    sessionId || undefined,
        stars,
      });

      const threshold    = _config?.tables?.reviewThreshold ?? 4;
      const aboveThresh  = result.above_threshold ?? (stars >= threshold);
      const googleUrl    = result.google_review_url || null;

      if (aboveThresh && googleUrl) {
        $('rvGoogleLink').href = googleUrl;
        showStep('rvStepGoogle');
      } else {
        showStep('rvStepFeedback');
      }

    } catch (err) {
      console.error('[review] handleRating failed:', err.message);
      // Still show feedback as fallback — don't leave user stuck
      showStep('rvStepFeedback');
    }
  }

  /* ── Submit written feedback ────────────────────────────── */
  async function submitFeedback() {
    if (_submitted) return;
    const text = $('rvFeedbackText').value.trim();
    const btn  = $('rvSubmitFeedback');

    btn.disabled    = true;
    btn.textContent = 'Sending…';

    try {
      if (text && _selectedStars) {
        await postReview({
          order_id:   orderId   || undefined,
          session_id: sessionId || undefined,
          stars:      _selectedStars,
          feedback:   text,
        });
      }
    } catch (err) {
      console.error('[review] submitFeedback failed:', err.message);
      // Silent — thank the user regardless
    }

    showThanks(false);
  }

  /* ── Thank you screen ───────────────────────────────────── */
  function showThanks(wasGoogle) {
    _submitted = true;
    $('rvThanksMsg').textContent = wasGoogle
      ? 'We really appreciate you sharing your experience.'
      : 'Your feedback goes directly to the team. We\'ll keep improving.';
    showStep('rvStepThanks');
  }

  /* ── Init ───────────────────────────────────────────────── */
  boot();

})();
