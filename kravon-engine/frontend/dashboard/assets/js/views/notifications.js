/**
 * notifications.js — Dashboard notification bell.
 *
 * Exposes: NotifBell.init(), NotifBell.loadUnreadCount()
 * Polling: unread count refreshed every 60s after init.
 */

const NotifBell = (() => {
  const bell     = () => document.getElementById('notif-bell');
  const badge    = () => document.getElementById('notif-badge');
  const dropdown = () => document.getElementById('notif-dropdown');

  function esc(str) {
    if (str == null) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function relativeTime(iso) {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60)   return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  let _pollTimer = null;

  async function loadUnreadCount() {
    try {
      const res = await Api.rGet('/notifications?unread=true&limit=1');
      const count = res.unread_count || 0;
      const b = badge();
      if (!b) return;
      if (count > 0) {
        b.textContent = count > 99 ? '99+' : count;
        b.style.display = 'flex';
      } else {
        b.style.display = 'none';
      }
    } catch (_) {
      // If the session is gone (refresh failed and Auth cleared itself),
      // stop polling and drop to the login gate — otherwise this interval
      // hammers /auth/refresh with 400s every 15s forever while the
      // operator stares at a silently frozen dashboard.
      if (typeof Auth !== 'undefined' && !Auth.isLoggedIn()) {
        if (_pollTimer) clearInterval(_pollTimer);
        location.reload();
      }
    }
  }

  async function openDropdown() {
    const dd = dropdown();
    if (!dd) return;

    dd.innerHTML = '<div class="notif-empty">Loading…</div>';
    dd.style.display = 'block';

    try {
      const res = await Api.rGet('/notifications?limit=20');
      const items = res.notifications || [];

      if (!items.length) {
        dd.innerHTML = `
          <div class="notif-dropdown-header">
            <span>Notifications</span>
          </div>
          <div class="notif-empty">No notifications yet</div>`;
        return;
      }

      dd.innerHTML = `
        <div class="notif-dropdown-header">
          <span>Notifications</span>
          <button class="notif-mark-all-btn" id="notif-mark-all">Mark all read</button>
        </div>
        ${items.map(n => `
          <div class="notif-item ${n.read_at ? '' : 'unread'}" data-id="${n.id}">
            <span class="notif-dot priority-${n.priority}"></span>
            <div class="notif-content">
              <div class="notif-title">${esc(n.title)}</div>
              ${n.body ? `<div class="notif-body">${esc(n.body)}</div>` : ''}
              <div class="notif-time">${relativeTime(n.created_at)}</div>
            </div>
          </div>`).join('')}`;

      dd.querySelector('#notif-mark-all')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        await markAllRead();
      });

      dd.querySelectorAll('.notif-item[data-id]').forEach(el => {
        el.addEventListener('click', async () => {
          const id = el.dataset.id;
          if (!el.classList.contains('unread')) return;
          el.classList.remove('unread');
          await Api.rPost(`/notifications/${id}/read`, {});
          await loadUnreadCount();
        });
      });
    } catch (_) {
      dd.innerHTML = '<div class="notif-empty">Failed to load notifications</div>';
    }
  }

  async function markAllRead() {
    try {
      await Api.rPost('/notifications/read-all', {});
      await loadUnreadCount();
      closeDropdown();
    } catch (_) {}
  }

  function closeDropdown() {
    const dd = dropdown();
    if (dd) dd.style.display = 'none';
  }

  let _initialized = false;

  function init() {
    const b = bell();
    if (!b || _initialized) return;
    _initialized = true;

    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const dd = dropdown();
      if (!dd) return;
      if (dd.style.display === 'none') {
        openDropdown();
      } else {
        closeDropdown();
      }
    });

    document.addEventListener('click', (e) => {
      const wrap = document.querySelector('.notif-bell-wrap');
      if (wrap && !wrap.contains(e.target)) closeDropdown();
    });

    loadUnreadCount();
    _pollTimer = setInterval(loadUnreadCount, 15_000);
  }

  return { init, loadUnreadCount };
})();
