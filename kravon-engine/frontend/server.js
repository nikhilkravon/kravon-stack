require('dotenv').config();
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const url    = require('url');
const zlib   = require('zlib');

const BACKEND_URL      = process.env.BACKEND_URL      || 'http://localhost:3000';
const FRONTEND_URL     = process.env.FRONTEND_URL     || 'http://localhost:8000';
const RESTAURANT_SLUG  = process.env.RESTAURANT_SLUG  || '';

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

// Cache durations
const CACHE = {
  '.html': 'no-cache',                        // always revalidate HTML (has injected env vars)
  '.css':  'public, max-age=31536000',         // 1 year — filenames should be versioned or cache-bust on deploy
  '.js':   'public, max-age=31536000',
  '.woff2':'public, max-age=31536000',
  '.woff': 'public, max-age=31536000',
  '.png':  'public, max-age=604800',           // 1 week
  '.jpg':  'public, max-age=604800',
  '.jpeg': 'public, max-age=604800',
  '.webp': 'public, max-age=604800',
  '.svg':  'public, max-age=604800',
  '.ico':  'public, max-age=604800',
};

const REDIRECTS = {
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
  const parsed   = url.parse(req.url, true);
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
      data = data.replace(/%%KRAVON_API_URL%%/g,      BACKEND_URL);
      data = data.replace(/%%KRAVON_FRONTEND_URL%%/g, FRONTEND_URL);
      data = data.replace(/%%RESTAURANT_SLUG%%/g,     slug);
    }

    const mime        = MIME[ext] || 'application/octet-stream';
    const cacheHeader = CACHE[ext] || 'public, max-age=3600';
    const acceptEnc   = req.headers['accept-encoding'] || '';
    const canGzip     = GZIP_EXTS.has(ext) && acceptEnc.includes('gzip');

    const headers = {
      'Content-Type':  mime,
      'Cache-Control': cacheHeader,
      'Vary':          'Accept-Encoding',
    };

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
});
