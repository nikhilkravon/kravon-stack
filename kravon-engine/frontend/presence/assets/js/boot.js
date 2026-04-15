/**
 * BOOT — presence/boot.js
 * Replaces config/config.js script tag.
 *
 * Loads restaurant config from the API, then initialises
 * the renderer and behaviour modules.
 *
 * WHAT CHANGED FROM V7:
 *   Before: <script src="config/config.js"> set window.CONFIG synchronously
 *   After:  boot.js fetches config async, then calls the same renderer/behaviour
 *           functions. renderer.js and behaviour.js are UNCHANGED.
 */

(async () => {
  'use strict';

  // Show skeleton while loading
  const body = document.body;
  body.setAttribute('data-loading', 'true');

  try {
    await KravonAPI.loadConfig();
    // window.CONFIG, window.MENU, window.ADDONS are now populated

    // Initialise presence (same call sequence as V7 main.js equivalent)
    if (typeof window.initRenderer === 'function') window.initRenderer();
    if (typeof window.initBehaviour === 'function') window.initBehaviour();

    body.removeAttribute('data-loading');
  } catch (err) {
    console.error('[kravon] Failed to load config:', err.message);
    body.setAttribute('data-error', 'true');
  }
})();
