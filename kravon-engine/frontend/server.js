const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url);
  let pathname = parsedUrl.pathname;

  // Default to index.html for root requests
  if (pathname === '/') {
    pathname = '/index.html';
  }

  // Handle tables route - redirect to tables/index.html
  if (pathname === '/tables' || pathname === '/tables/') {
    pathname = '/tables/index.html';
  }

  const filePath = path.join(__dirname, pathname);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('File not found');
      return;
    }

    // Set content type based on file extension
    const ext = path.extname(filePath);
    let contentType = 'text/html';
    switch (ext) {
      case '.css': contentType = 'text/css'; break;
      case '.js': contentType = 'text/javascript'; break;
      case '.json': contentType = 'application/json'; break;
      case '.png': contentType = 'image/png'; break;
      case '.jpg': contentType = 'image/jpeg'; break;
    }

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

const PORT = 8000;
server.listen(PORT, () => {
  console.log(`Frontend server running at http://localhost:${PORT}`);
  console.log(`Tables page: http://localhost:${PORT}/tables/index.html`);
  console.log(`QR codes point to: http://localhost:${PORT}/tables?table=T1`);
});