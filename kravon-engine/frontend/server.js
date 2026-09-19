require('dotenv').config();
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const url    = require('url');
const zlib   = require('zlib');

const BACKEND_URL      = process.env.BACKEND_URL      || 'http://localhost:3000';
const FRONTEND_URL     = process.env.FRONTEND_URL     || 'http://localhost:8000';
const RESTAURANT_SLUG  = process.env.RESTAURANT_SLUG  || '';

// ── Custom tenant subdomains ───────────────────────────────────────────────
// Maps a branded Host header straight to a tenant's page + query params —
// served in-place (no visible redirect), so the address bar stays on the
// tenant's own subdomain instead of leaking the Railway URL.
const CUSTOM_DOMAINS = {
  'cafebodhitree.kravon.in': { path: '/presence/', query: { slug: 'cafe-bodhi-tree' } },
};

// ── Deploy build id — drives asset cache-busting ──────────────────────────────
// HTML is served uncached and rewritten per request (below), so we can stamp a
// deploy-scoped ?v=<BUILD_ID> onto every local .js / .css reference. The assets
// themselves are then served `immutable` with a long max-age: safe, because the
// URL changes on every deploy. Railway restarts this process on each deploy, so
// any of these env vars — or, failing all of them, the process start time —
// yields a fresh id per release.
const BUILD_ID = (
  process.env.ASSET_VERSION ||
  process.env.RAILWAY_GIT_COMMIT_SHA ||
  process.env.RAILWAY_DEPLOYMENT_ID ||
  process.env.SOURCE_VERSION ||
  process.env.RENDER_GIT_COMMIT ||
  String(Date.now())
).slice(0, 40).replace(/[^A-Za-z0-9._-]/g, '');

// Rewrites src="…" / href="…" for LOCAL .js / .css references only. Absolute
// (http(s)://…), protocol-relative (//…) and data: URLs are left untouched.
// A pre-existing query string on the ref is preserved and ?v / &v is merged in.
const ASSET_REF_RE = /(\b(?:src|href)=)(["'])([^"']+?\.(?:js|css))((?:\?[^"']*)?)\2/gi;
function stampAssetVersions(html) {
  return html.replace(ASSET_REF_RE, (match, attr, quote, urlPart, existingQs) => {
    if (/^(?:https?:)?\/\//i.test(urlPart) || urlPart.startsWith('data:')) return match;
    let qs;
    if (!existingQs || existingQs === '?') {
      qs = `?v=${BUILD_ID}`;
    } else if (/[?&]v=/.test(existingQs)) {
      qs = existingQs; // already versioned — leave it
    } else {
      qs = `${existingQs}&v=${BUILD_ID}`;
    }
    return `${attr}${quote}${urlPart}${qs}${quote}`;
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
  '.woff': 'font/woff',
};

// Extensions we gzip (text-based)
const GZIP_EXTS = new Set(['.html', '.css', '.js', '.json', '.svg']);

// Cache durations.
// HTML: never cached — it is rewritten per request (env vars + ?v= asset stamps).
// JS/CSS: long-lived + immutable, but ONLY when the request carries the current
//   ?v=<BUILD_ID> stamp (see cacheFor() below). A stale/absent/mismatched stamp
//   falls back to a short, revalidated cache so a client on old HTML recovers
//   within minutes instead of staying stuck for a year.
// Fonts: long-lived — content is stable and filenames don't change.
const CACHE = {
  '.html': 'no-cache',
  '.css':  'public, max-age=300, must-revalidate',   // fallback when ?v= is missing/stale
  '.js':   'public, max-age=300, must-revalidate',
  '.woff2':'public, max-age=31536000, immutable',
  '.woff': 'public, max-age=31536000, immutable',
  '.png':  'public, max-age=604800',                 // 1 week
  '.jpg':  'public, max-age=604800',
  '.jpeg': 'public, max-age=604800',
  '.webp': 'public, max-age=604800',
  '.svg':  'public, max-age=604800',
  '.ico':  'public, max-age=604800',
};

const VERSIONED_EXTS = new Set(['.js', '.css']);

// Resolve the Cache-Control value for one response.
function cacheFor(ext, query) {
  if (process.env.DEV_NO_CACHE) return 'no-store';
  if (VERSIONED_EXTS.has(ext) && query && query.v === BUILD_ID) {
    // URL is stamped with THIS deploy's id — safe to cache hard.
    return 'public, max-age=31536000, immutable';
  }
  return CACHE[ext] || 'public, max-age=3600';
}

const REDIRECTS = {
  '/':          '/presence/',
  '/presence':  '/presence/',
  '/tables':    '/tables/',
  '/orders':    '/orders/',
  '/catering':  '/catering/',
  '/dashboard': '/dashboard/',
};

const INDEX_MAP = {
  '/':           '/index.html',
  '/presence/':  '/presence/index.html',
  '/tables/':    '/tables/index.html',
  '/orders/':    '/orders/index.html',
  '/catering/':  '/catering/index.html',
  '/dashboard/': '/dashboard/index.html',
};

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);

  // Custom domain: 301 the root request to the mapped tenant page. A real
  // redirect (not an in-place rewrite) is required here — the tenant pages
  // use paths relative to their own directory (assets/js/boot.js, etc.),
  // which only resolve correctly once the browser's address bar itself
  // carries that directory.
  const host   = (req.headers.host || '').split(':')[0].toLowerCase();
  const custom = CUSTOM_DOMAINS[host];
  if (custom && parsed.pathname === '/') {
    const qs = new URLSearchParams(custom.query).toString();
    res.writeHead(301, { 'Location': `${custom.path}${qs ? '?' + qs : ''}` });
    res.end();
    return;
  }

  const pathname = parsed.pathname;
  const slug     = parsed.query.slug || RESTAURANT_SLUG;

  if (REDIRECTS[pathname]) {
    const qs = parsed.query.slug ? `?slug=${parsed.query.slug}` : '';
    res.writeHead(301, { 'Location': REDIRECTS[pathname] + qs });
    res.end();
    return;
  }

  const filePath = path.join(__dirname, INDEX_MAP[pathname] || pathname);
  const ext      = path.extname(filePath);
  const isHtml   = ext === '.html';

  fs.readFile(filePath, isHtml ? 'utf8' : null, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }

    if (isHtml) {
      data = data.replace(/%%FORCE_MENU_ONLY%%/g,     custom?.query.menu === '1' ? '1' : '0');
      data = data.replace(/%%KRAVON_API_URL%%/g,      BACKEND_URL);
      data = data.replace(/%%KRAVON_FRONTEND_URL%%/g, FRONTEND_URL);
      data = data.replace(/%%RESTAURANT_SLUG%%/g,     slug);
      // Stamp ?v=<BUILD_ID> onto local .js/.css refs so every deploy busts them.
      data = stampAssetVersions(data);
    }

    const mime        = MIME[ext] || 'application/octet-stream';
    // Long immutable cache for versioned .js/.css hits (?v matches this deploy);
    // short revalidated cache otherwise. DEV_NO_CACHE=1 forces no-store locally.
    const cacheHeader = cacheFor(ext, parsed.query);
    const acceptEnc   = req.headers['accept-encoding'] || '';
    const canGzip     = GZIP_EXTS.has(ext) && acceptEnc.includes('gzip');

    const headers = {
      'Content-Type':  mime,
      'Cache-Control': cacheHeader,
      'Vary':          'Accept-Encoding',
    };

    // Security headers — HTML documents only. Static assets are untouched.
    if (isHtml) {
      headers['X-Content-Type-Options'] = 'nosniff';
      headers['X-Frame-Options']        = 'SAMEORIGIN';
      headers['Referrer-Policy']        = 'strict-origin-when-cross-origin';
      // Report-Only for now: logs violations in the console, enforces nothing.
      // Widen/flip to `Content-Security-Policy` once reports are confirmed clean
      // across index.html, checkout.html and reservation.html (Razorpay, the
      // OpenStreetMap iframe and Google Fonts are the things to watch).
      headers['Content-Security-Policy-Report-Only'] = [
        "default-src 'self'",
        "img-src 'self' data: https:",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "script-src 'self' 'unsafe-inline' https://checkout.razorpay.com",
        "connect-src 'self' https://*.up.railway.app https://*.kravon.in",
        "frame-src https://www.openstreetmap.org https://api.razorpay.com https://checkout.razorpay.com",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; ');
    }

    if (!canGzip) {
      res.writeHead(200, headers);
      res.end(data);
      return;
    }

    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    zlib.gzip(buf, (gzipErr, compressed) => {
      if (gzipErr) {
        res.writeHead(200, headers);
        res.end(data);
        return;
      }
      headers['Content-Encoding'] = 'gzip';
      res.writeHead(200, headers);
      res.end(compressed);
    });
  });
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`Frontend listening on :${PORT}`);
  console.log(`Backend API: ${BACKEND_URL}`);
  console.log(`Asset build id: ${BUILD_ID}`);
});
