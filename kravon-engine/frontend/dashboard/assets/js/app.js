'use strict';

/**
 * App — bootstrapper and view router
 *
 * On load: check Auth.isLoggedIn(). If yes, show dashboard and boot the
 * view matching the URL hash (defaults to overview). If no, show the login gate.
 *
 * Views are plain objects with an init(el) method.
 * Navigating to a view calls view.init(contentEl), which owns rendering.
 */
const App = (() => {

  const VIEWS = {
    overview: OverviewView,
    orders:   OrdersView,
    menu:     MenuView,
    insights: InsightsView,
    presence: PresenceView,
    settings: SettingsView,
  };

  const VIEW_TITLES = {
    overview: 'Overview',
    orders:   'Orders',
    menu:     'Menu',
    insights: 'Insights',
    presence: 'Presence',
    settings: 'Settings',
  };

  let _currentView = null;

  // ── Shell elements ─────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);

  function _showAuth() {
    $('auth-gate').hidden  = false;
    $('dashboard').hidden  = true;
    _bindLoginForm();
  }

  function _showDashboard() {
    $('auth-gate').hidden  = true;
    $('dashboard').hidden  = false;

    const { staff, slug } = Auth.state();
    $('dash-restaurant-name').textContent = slug || '—';
    $('dash-staff-name').textContent  = staff?.name  || '—';
    $('dash-staff-email').textContent = staff?.email || '—';

    const planBadge = $('dash-plan-badge');
    // plan comes from config; we don't load it here — leave as-is until settings loads
    // hash-based routing
    const hash = location.hash.slice(1) || 'overview';
    navigate(hash in VIEWS ? hash : 'overview');

    window.addEventListener('hashchange', () => {
      const v = location.hash.slice(1);
      if (v in VIEWS && v !== _currentView) navigate(v);
    });

    $('dash-logout').addEventListener('click', async () => {
      await Auth.logout();
      location.reload();
    });
  }

  // ── Login form ─────────────────────────────────────────────────────────────
  function _bindLoginForm() {
    const form = document.getElementById('login-form');
    if (!form || form._bound) return;
    form._bound = true;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd  = new FormData(form);
      const btn = document.getElementById('login-btn');
      const err = document.getElementById('login-error');
      err.hidden = true;
      btn.disabled = true; btn.textContent = 'Signing in…';

      try {
        await Auth.login(fd.get('slug'), fd.get('email'), fd.get('password'));
        _showDashboard();
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
        btn.disabled = false; btn.textContent = 'Sign in';
      }
    });
  }

  // ── View router ────────────────────────────────────────────────────────────
  function navigate(viewName) {
    const view = VIEWS[viewName];
    if (!view) return;

    _currentView = viewName;

    // Sidebar active state
    document.querySelectorAll('.dash-nav-item').forEach(a => {
      a.classList.toggle('active', a.dataset.view === viewName);
    });

    // Page title
    const titleEl = $('dash-view-title');
    if (titleEl) titleEl.textContent = VIEW_TITLES[viewName] || viewName;

    // Sync hash without re-firing hashchange
    if (location.hash.slice(1) !== viewName) {
      history.replaceState(null, '', `#${viewName}`);
    }

    // Render view
    const content = $('dash-content');
    if (content) view.init(content);
  }

  // Called by api.js when a refresh fails mid-session
  function sessionExpired() {
    Auth.clear();
    _showAuth();
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  function start() {
    if (Auth.isLoggedIn()) {
      _showDashboard();
    } else {
      _showAuth();
    }
  }

  document.addEventListener('DOMContentLoaded', start);

  return { navigate, sessionExpired, get slug() { return Auth.state().slug; } };
})();
