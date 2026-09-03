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

  // Views grouped by domain — add future views here when their modules are built
  const VIEWS = {
    // Operations
    overview:       OverviewView,
    orders:         OrdersView,
    tables:         TablesView,
    kitchen:        KitchenView,
    reservations:   ReservationsView,
    'bill-history': BillHistoryView,
    // Customers & Sales
    customers:      CustomersView,
    catering:       CateringView,
    insights:       InsightsView,
    // Digital Experience
    presence:       PresenceView,
    menu:           MenuView,
    // Administration
    settings:       SettingsView,
    'audit-log':    AuditLogView,
    'settlement':   SettlementView,
  };

  const VIEW_TITLES = {
    overview:       'Home',
    orders:         'Orders',
    tables:         'Tables',
    kitchen:        'Kitchen',
    reservations:   'Reservations',
    'bill-history': 'Bills',
    customers:      'Customers',
    catering:       'Catering Leads',
    insights:       'Insights',
    presence:       'Website & Brand',
    menu:           'Menu',
    settings:       'Settings',
    'audit-log':    'Audit Log',
    'settlement':   'Bill',
  };

  let _currentView = null;

  // ── Shell elements ─────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);

  function _showAuth() {
    $('auth-gate').hidden = false;
    $('dashboard').hidden = true;
    _bindAuthForms();
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
          const logoUrl = d.config.brand?.logoUrl;
          const plan = d.config.capabilities?.plan || 'starter';
          if (name) $('dash-restaurant-name').textContent = name;
          const logoEl = $('dash-restaurant-logo');
          if (logoEl && logoUrl) {
            logoEl.src = logoUrl;
            logoEl.alt = name ? `${name} logo` : '';
            logoEl.hidden = false;
            logoEl.onerror = () => { logoEl.hidden = true; };
          }
          const badge = $('dash-plan-badge');
          if (badge) {
            badge.dataset.plan   = plan;
            badge.textContent    = plan.charAt(0).toUpperCase() + plan.slice(1);
          }
        })
        .catch(() => {});
    }

    // Notification bell
    if (typeof NotifBell !== 'undefined') NotifBell.init();

    // hash-based routing — strip query params before view lookup
    function _hashView() { return (location.hash.slice(1) || 'overview').split('?')[0]; }
    navigate(_hashView() in VIEWS ? _hashView() : 'overview');

    window.addEventListener('hashchange', () => {
      const v = _hashView();
      if (v in VIEWS && v !== _currentView) navigate(v);
    });

    // Direct nav-item clicks — handles case where hash is already set
    // (hashchange won't fire if the hash doesn't change)
    document.querySelectorAll('.dash-nav-item[data-view], .dash-brand[data-view]').forEach(a => {
      a.addEventListener('click', (e) => {
        const v = a.dataset.view;
        if (v in VIEWS) { e.preventDefault(); navigate(v); }
      });
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

    // Nav group collapse toggles (mobile-first, but available on all sizes)
    document.querySelectorAll('.dash-nav-group-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.closest('.dash-nav-group').classList.toggle('collapsed');
      });
    });
  }

  // ── Auth forms ─────────────────────────────────────────────────────────────
  function _authPanel(show) {
    $('auth-login').hidden  = show !== 'login';
    $('auth-forgot').hidden = show !== 'forgot';
    $('auth-reset').hidden  = show !== 'reset';
  }

  function _bindAuthForms() {
    // Deduplicate — only bind once
    if (document.getElementById('login-form')?._bound) return;

    const BASE = () => window.KRAVON_API_BASE || 'http://localhost:3000';

    // Check URL for reset token — show reset panel immediately if present
    const params     = new URLSearchParams(location.search);
    const resetToken = params.get('reset');
    const resetSlug  = params.get('slug');
    if (resetToken && resetSlug) {
      _authPanel('reset');
    } else {
      _authPanel('login');
    }

    // ── Login ──────────────────────────────────────────────────────────────
    const loginForm = document.getElementById('login-form');
    loginForm._bound = true;
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd  = new FormData(loginForm);
      const btn = $('login-btn');
      const err = $('login-error');
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

    // ── Forgot password link ───────────────────────────────────────────────
    $('forgot-link').addEventListener('click', (e) => {
      e.preventDefault();
      // Pre-fill slug/email from login form if already typed
      const loginSlug  = $('login-slug')?.value.trim();
      const loginEmail = $('login-email')?.value.trim();
      if (loginSlug)  $('forgot-slug').value  = loginSlug;
      if (loginEmail) $('forgot-email').value = loginEmail;
      _authPanel('forgot');
    });

    $('back-to-login').addEventListener('click', (e) => {
      e.preventDefault();
      _authPanel('login');
    });

    // ── Forgot form ────────────────────────────────────────────────────────
    const forgotForm = document.getElementById('forgot-form');
    forgotForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd      = new FormData(forgotForm);
      const btn     = $('forgot-btn');
      const err     = $('forgot-error');
      const success = $('forgot-success');
      err.hidden = true;
      success.style.display = 'none';
      btn.disabled = true; btn.textContent = 'Sending…';

      try {
        const res = await fetch(`${BASE()}/v1/auth/forgot-password`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ slug: fd.get('slug'), email: fd.get('email') }),
        });
        // Always show success — never reveal whether the account exists
        success.style.display = 'block';
        forgotForm.reset();
      } catch {
        success.style.display = 'block'; // same message even on network error
      } finally {
        btn.disabled = false; btn.textContent = 'Send reset link';
      }
    });

    // ── Reset password form ────────────────────────────────────────────────
    const resetForm = document.getElementById('reset-form');
    resetForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd  = new FormData(resetForm);
      const btn = $('reset-btn');
      const err = $('reset-error');
      err.hidden = true;

      const newPw  = fd.get('new_password');
      const confirm = fd.get('confirm_password');
      if (newPw !== confirm) {
        err.textContent = 'Passwords do not match.';
        err.hidden = false;
        return;
      }

      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        const res = await fetch(`${BASE()}/v1/auth/reset-password`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ token: resetToken, new_password: newPw }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not reset password.');

        // Clear token from URL, show login with success message
        history.replaceState(null, '', location.pathname);
        _authPanel('login');
        const loginErr = $('login-error');
        loginErr.textContent = 'Password updated. Please sign in.';
        loginErr.style.color = 'var(--green-700)';
        loginErr.hidden = false;
        if (resetSlug) $('login-slug').value = resetSlug;
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
        btn.disabled = false; btn.textContent = 'Set new password';
      }
    });
  }

  // ── View router ────────────────────────────────────────────────────────────
  function navigate(viewName) {
    const view = VIEWS[viewName];
    if (!view) return;

    const isInitialLoad = _currentView === null;
    _currentView = viewName;

    // Settlement is a full-screen POS page — no sidebar/header while it's active.
    $('dashboard')?.classList.toggle('dash-layout--pos', viewName === 'settlement');

    // Sidebar active state — mark item, expand its group if collapsed
    document.querySelectorAll('.dash-nav-item').forEach(a => {
      const isActive = a.dataset.view === viewName;
      a.classList.toggle('active', isActive);
      if (isActive) {
        const group = a.closest('.dash-nav-group');
        if (group) group.classList.remove('collapsed');
      }
    });

    // Page title
    const titleEl = $('dash-view-title');
    if (titleEl) titleEl.textContent = VIEW_TITLES[viewName] || viewName;

    // Sync hash without re-firing hashchange. Push a history entry when the
    // view actually changes so browser Back/Forward can step between views;
    // replace when it's just the initial load syncing to the current hash.
    if ((location.hash.slice(1) || '').split('?')[0] !== viewName) {
      history[isInitialLoad ? 'replaceState' : 'pushState'](null, '', `#${viewName}`);
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

  // Lets a view's late-resolving async work (e.g. an API call in init()) check
  // whether the user has already navigated elsewhere before writing to the
  // shared #dash-content element — otherwise a slow response can silently
  // overwrite whatever view the user moved to next.
  function isCurrentView(viewName) { return _currentView === viewName; }

  return { navigate, sessionExpired, isCurrentView, get slug() { return Auth.state().slug; } };
})();
