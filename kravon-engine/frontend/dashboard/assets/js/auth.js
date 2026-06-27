'use strict';

/**
 * Auth — token lifecycle management
 *
 * Access token (15 min): kept in memory + sessionStorage (survives page refresh, cleared on tab close).
 * Refresh token (30 day): stored in an HttpOnly cookie set by the server.
 *   The frontend never reads or stores the RT — it's invisible to JS.
 *   All auth requests use credentials:'include' so the cookie is sent automatically.
 * Staff + slug stored in localStorage for sidebar display only (non-sensitive).
 *
 * getToken() is transparent: returns current AT, or silently refreshes,
 * or throws if the session is fully expired.
 */
const Auth = (() => {
  const BASE = () => window.KRAVON_API_BASE || 'http://localhost:3000';

  const K_STAFF = 'krv_staff';
  const K_SLUG  = 'krv_slug';

  const K_AT = 'krv_at';

  // ── JWT decode (no verify — trust the server) ─────────────────────────────
  function _decodeJwt(token) {
    try {
      const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(b64));
    } catch { return null; }
  }

  // Access token: short-lived (15 min), stored in sessionStorage so page refresh
  // doesn't force re-login. sessionStorage is tab-scoped and cleared when the tab
  // closes — not persisted across browser sessions like localStorage.
  let _at    = sessionStorage.getItem(K_AT) || null;
  let _atExp = _at ? (_decodeJwt(_at)?.exp || 0) : 0;

  function _storeAt(token) {
    _at    = token;
    const payload = _decodeJwt(token);
    _atExp = payload?.exp || 0;
    sessionStorage.setItem(K_AT, token);
  }

  // ── Public ─────────────────────────────────────────────────────────────────
  async function login(slug, email, password) {
    const r = await fetch(`${BASE()}/v1/auth/login`, {
      method:      'POST',
      credentials: 'include',   // receive HttpOnly RT cookie from server
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify({ slug, email, password }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Login failed');

    _storeAt(data.accessToken);
    // RT is now in an HttpOnly cookie — do not store it here.
    localStorage.setItem(K_SLUG,  slug);
    localStorage.setItem(K_STAFF, JSON.stringify(data.staff));
    return data;
  }

  async function refresh() {
    // RT is sent automatically via the HttpOnly cookie — no body needed.
    const r = await fetch(`${BASE()}/v1/auth/refresh`, {
      method:      'POST',
      credentials: 'include',
      headers:     { 'Content-Type': 'application/json' },
    });
    if (!r.ok) {
      clear();
      throw new Error('Session expired');
    }
    const data = await r.json();
    _storeAt(data.accessToken);

    // Restore slug and staff from the JWT payload so Api._slug() works
    // after a cookie-based refresh (localStorage may have been cleared).
    const payload = _decodeJwt(data.accessToken);
    if (payload?.slug && !localStorage.getItem(K_SLUG)) {
      localStorage.setItem(K_SLUG, payload.slug);
    }
    if (payload && !localStorage.getItem(K_STAFF)) {
      localStorage.setItem(K_STAFF, JSON.stringify({
        id: payload.staffId, roles: payload.roles,
      }));
    }

    return data.accessToken;
  }

  async function logout() {
    if (_at) {
      fetch(`${BASE()}/v1/auth/logout`, {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Authorization': `Bearer ${_at}` },
      }).catch(() => {});
    }
    clear();
  }

  // Returns a valid access token — refreshes silently if within 60 s of expiry
  async function getToken() {
    const nowSec = Math.floor(Date.now() / 1000);
    if (_at && _atExp - nowSec > 60) return _at;
    return refresh();
  }

  function isLoggedIn() {
    return !!_at || !!localStorage.getItem(K_STAFF);
  }

  function state() {
    const staff = JSON.parse(localStorage.getItem(K_STAFF) || 'null');
    const slug  = localStorage.getItem(K_SLUG);
    return { staff, slug };
  }

  function clear() {
    _at = null; _atExp = 0;
    sessionStorage.removeItem(K_AT);
    localStorage.removeItem(K_STAFF);
    localStorage.removeItem(K_SLUG);
  }

  return { login, refresh, logout, getToken, isLoggedIn, state, clear };
})();
