'use strict';

/**
 * DashUI — shared UI utilities for the owner dashboard.
 *
 * Replaces:
 *   alert(msg)              → DashUI.toast(msg, 'error')
 *   confirm('Delete…?')     → DashUI.confirm('Delete…?').then(ok => { if (ok) … })
 *
 * Also provides:
 *   DashUI.emptyState(opts) → returns an HTML string for empty states
 *   DashUI.errorState(msg)  → returns an HTML string for load error states
 */
const DashUI = (() => {

  // ── Toast ──────────────────────────────────────────────────────────────────
  function _ensureContainer() {
    let c = document.getElementById('dash-toast-container');
    if (!c) {
      c = document.createElement('div');
      c.id = 'dash-toast-container';
      document.body.appendChild(c);
    }
    return c;
  }

  /**
   * toast(message, type, duration)
   * @param {string} message
   * @param {'success'|'error'|'info'} [type='info']
   * @param {number} [duration=3500]
   */
  function toast(message, type = 'info', duration = 3500) {
    const container = _ensureContainer();
    const el = document.createElement('div');
    el.className = `dash-toast toast-${type}`;
    el.textContent = message;
    container.appendChild(el);

    const remove = () => {
      el.classList.add('toast-out');
      el.addEventListener('animationend', () => el.remove(), { once: true });
    };
    const timer = setTimeout(remove, duration);
    el.addEventListener('click', () => { clearTimeout(timer); remove(); });
  }

  // ── Confirm modal ──────────────────────────────────────────────────────────
  /**
   * confirm(message, options) → Promise<boolean>
   * @param {string} message
   * @param {{ title?: string, confirmLabel?: string, cancelLabel?: string, danger?: boolean }} opts
   */
  function confirm(message, {
    title        = 'Are you sure?',
    confirmLabel = 'Confirm',
    cancelLabel  = 'Cancel',
    danger       = false,
  } = {}) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal" style="max-width:380px">
          <div class="modal-header">
            <span class="modal-title">${title}</span>
          </div>
          <div class="confirm-modal-body">${message}</div>
          <div class="modal-footer">
            <button class="btn btn-secondary" id="confirm-cancel">${cancelLabel}</button>
            <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="confirm-ok">${confirmLabel}</button>
          </div>
        </div>`;

      document.body.appendChild(overlay);

      const cleanup = (result) => {
        overlay.remove();
        resolve(result);
      };

      overlay.querySelector('#confirm-ok').addEventListener('click',     () => cleanup(true));
      overlay.querySelector('#confirm-cancel').addEventListener('click',  () => cleanup(false));
      overlay.addEventListener('click', e => { if (e.target === overlay) cleanup(false); });
    });
  }

  // ── Empty state ────────────────────────────────────────────────────────────
  /**
   * emptyState(opts) → HTML string
   * @param {{ icon?: string, title: string, body?: string, cta?: string, ctaHref?: string }}
   */
  function emptyState({ icon = '📭', title, body = '', cta = '', ctaHref = '' } = {}) {
    return `
      <div class="empty-state">
        <div class="empty-state-icon">${icon}</div>
        <div class="empty-state-title">${title}</div>
        ${body ? `<div class="empty-state-body">${body}</div>` : ''}
        ${cta  ? (ctaHref
          ? `<a href="${ctaHref}" class="btn btn-secondary btn-sm">${cta}</a>`
          : `<button class="btn btn-secondary btn-sm" onclick="this.closest('.empty-state').dispatchEvent(new CustomEvent('cta',{bubbles:true}))">${cta}</button>`)
          : ''}
      </div>`;
  }

  // ── Error state ────────────────────────────────────────────────────────────
  /**
   * errorState(message) → HTML string
   * Shows a friendly error with a retry hint. Never shows raw API errors.
   * @param {string} [technicalMsg] — logged to console only
   */
  function errorState(technicalMsg = '') {
    if (technicalMsg) console.error('[dashboard]', technicalMsg);
    return emptyState({
      icon:  '⚠️',
      title: 'Something went wrong',
      body:  'Couldn\'t load this data. Try refreshing the page.',
    });
  }

  return { toast, confirm, emptyState, errorState };
})();
