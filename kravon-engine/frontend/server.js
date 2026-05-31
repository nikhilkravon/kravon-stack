const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');

const BACKEND_URL      = process.env.BACKEND_URL      || 'http://localhost:3000';
const FRONTEND_URL     = process.env.FRONTEND_URL     || 'http://localhost:8000';
const RESTAURANT_SLUG  = process.env.RESTAURANT_SLUG  || '';

const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'text/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
  '.woff': 'font/woff',
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
  let pathname = url.parse(req.url).pathname;

  if (REDIRECTS[pathname]) {
    res.writeHead(301, { 'Location': REDIRECTS[pathname] });
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
      data = data.replace(/%%RESTAURANT_SLUG%%/g,     RESTAURANT_SLUG);
    }

    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`Frontend listening on :${PORT}`);
  console.log(`Backend API: ${BACKEND_URL}`);
});
