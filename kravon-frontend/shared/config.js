// Runtime configuration injected from window.__KRAVON_CONFIG__ (set by the
// server or a config script in index.html), falling back to localhost for dev.
//
// In production: add a <script> before app.js that sets:
//   window.__KRAVON_CONFIG__ = { API_BASE: 'https://api.yourdomain.com/api' };
//
// Or serve this file as a template with the value substituted at deploy time.

const cfg = (typeof window !== 'undefined' && window.__KRAVON_CONFIG__) || {};

export const API_BASE = cfg.API_BASE || 'http://localhost:3002/api';
