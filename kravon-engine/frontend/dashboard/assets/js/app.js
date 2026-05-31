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
    overview:     OverviewView,
    orders:       OrdersView,
    menu:         MenuView,
    reservations: ReservationsView,
    catering:     CateringView,
    insights:     InsightsView,
    presence:     PresenceView,
    settings:     SettingsView,
  };

  const VIEW_TITLES = {
    overview:     'Overview',
    orders:       'Orders',
    menu:         'Menu',
    reservations: 'Reservations',
    catering:     'Catering',
    insights:     'Insights',
    presence:     'Personalisation',
    settings:     'Settings',
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

    // Load restaurant display name from config in background
    if (slug) {
      const base = window.KRAVON_API_BASE || 'http://localhost:3000';
      fetch(`${base}/v1/restaurants/${slug}/config`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (!d?.config) return;
          const name = d.config.brand?.name;
          const plan = d.config.capabilities?.plan || 'starter';
          if (name) $('dash-restaurant-name').textContent = name;
          const badge = $('dash-plan-badge');
          if (badge) {
            badge.dataset.plan   = plan;
            badge.textContent    = plan.charAt(0).toUpperCase() + plan.slice(1);
          }
        })
        .catch(() => {});
    }

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

    // Mobile sidebar toggle
    const sidebar  = document.querySelector('.dash-sidebar');
    const overlay  = $('dash-sidebar-overlay');
    const toggle   = $('dash-menu-toggle');
    if (toggle && sidebar && overlay) {
      const openSidebar  = () => { sidebar.classList.add('open'); overlay.classList.add('open'); };
      const closeSidebar = () => { sidebar.classList.remove('open'); overlay.classList.remove('open'); };
      toggle.addEventListener('click', openSidebar);
      overlay.addEventListener('click', closeSidebar);
      document.querySelectorAll('.dash-nav-item').forEach(a =>
        a.addEventListener('click', () => { if (window.innerWidth <= 768) closeSidebar(); })
      );
    }
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
