'use strict';

/**
 * Auth — token lifecycle management
 *
 * Access token (15 min): kept in memory only, never persisted.
 * Refresh token (30 day): stored in localStorage under 'krv_rt'.
 * Staff + slug stored in localStorage for sidebar display.
 *
 * getToken() is transparent: returns current AT, or silently refreshes,
 * or throws if the session is fully expired.
 */
const Auth = (() => {
  const BASE = () => window.KRAVON_API_BASE || 'http://localhost:3000';

  const K_RT    = 'krv_rt';
  const K_STAFF = 'krv_staff';
  const K_SLUG  = 'krv_slug';

  let _at    = null;  // access token string
  let _atExp = 0;     // unix seconds

  // ── JWT decode (no verify — trust the server) ─────────────────────────────
  function _decodeJwt(token) {
    try {
      const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(b64));
    } catch { return null; }
  }

  function _storeAt(token) {
    _at    = token;
    const payload = _decodeJwt(token);
    _atExp = payload?.exp || 0;
  }

  // ── Public ─────────────────────────────────────────────────────────────────
  async function login(slug, email, password) {
    const r = await fetch(`${BASE()}/v1/auth/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ slug, email, password }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Login failed');

    _storeAt(data.accessToken);
    localStorage.setItem(K_RT,    data.refreshToken);
    localStorage.setItem(K_SLUG,  slug);
    localStorage.setItem(K_STAFF, JSON.stringify(data.staff));
    return data;
  }

  async function refresh() {
    const rt = localStorage.getItem(K_RT);
    if (!rt) throw new Error('No refresh token');

    const r = await fetch(`${BASE()}/v1/auth/refresh`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ refreshToken: rt }),
    });
    if (!r.ok) {
      clear();
      throw new Error('Session expired');
    }
    const data = await r.json();
    _storeAt(data.accessToken);
    return data.accessToken;
  }

  async function logout() {
    if (_at) {
      fetch(`${BASE()}/v1/auth/logout`, {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${_at}` },
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
    return !!localStorage.getItem(K_RT);
  }

  function state() {
    const staff = JSON.parse(localStorage.getItem(K_STAFF) || 'null');
    const slug  = localStorage.getItem(K_SLUG);
    return { staff, slug };
  }

  function clear() {
    _at = null; _atExp = 0;
    localStorage.removeItem(K_RT);
    localStorage.removeItem(K_STAFF);
    localStorage.removeItem(K_SLUG);
  }

  return { login, refresh, logout, getToken, isLoggedIn, state, clear };
})();
