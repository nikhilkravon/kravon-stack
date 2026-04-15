#!/usr/bin/env node
/**
 * QR GENERATOR — generate-qr.js
 * Generates a print-ready HTML file with one QR code per table.
 * Each QR encodes the table URL: domain/order?table=T1
 *
 * Usage:
 *   node scripts/generate-qr.js \
 *     --domain https://burgerhouse.in \
 *     --tables 12 \
 *     --name "Burger House" \
 *     --out ./qr-tables.html
 *
 * Options:
 *   --domain    Restaurant domain (required)
 *   --tables    Number of tables (default: 10)
 *   --name      Restaurant name for print header (default: "Restaurant")
 *   --accent    Accent hex colour without # (default: c2d62a)
 *   --out       Output file path (default: ./qr-tables.html)
 *   --prefix    Table label prefix (default: T)
 *
 * Output:
 *   A single self-contained HTML file. Print directly from browser.
 *   Each page contains one table QR, formatted for laminated cards (A6 / 10×15cm).
 *   No external dependencies — QR generation via qrcode.js CDN at print time.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

/* ── Parse args ─────────────────────────────────────────────────────────────── */
function arg(name, def) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : def;
}

const domain     = arg('domain', '');
const tableCount = parseInt(arg('tables', '10'), 10);
const name       = arg('name', 'Restaurant');
const accent     = arg('accent', 'c2d62a').replace('#', '');
const outPath    = arg('out', './qr-tables.html');
const prefix     = arg('prefix', 'T');

if (!domain) {
  console.error('Error: --domain is required. Example: --domain https://burgerhouse.in');
  process.exit(1);
}

if (isNaN(tableCount) || tableCount < 1 || tableCount > 200) {
  console.error('Error: --tables must be a number between 1 and 200');
  process.exit(1);
}

/* ── Build table entries ─────────────────────────────────────────────────────── */
const tables = Array.from({ length: tableCount }, (_, i) => {
  const label = `${prefix}${i + 1}`;
  const url   = `${domain}/order?table=${label}`;
  return { label, url };
});

/* ── HTML output ─────────────────────────────────────────────────────────────── */
const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escHtml(name)} — Table QR Codes</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Helvetica Neue', Arial, sans-serif;
      background: #f0f0f0;
    }

    /* Print instructions (screen only) */
    .print-instructions {
      background: #222;
      color: #fff;
      padding: 16px 24px;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    @media print { .print-instructions { display: none; } }
    .print-btn {
      background: #${accent};
      border: none;
      border-radius: 6px;
      padding: 8px 20px;
      font-size: 13px;
      font-weight: 700;
      color: #111;
      cursor: pointer;
      white-space: nowrap;
    }

    /* Pages */
    .qr-page {
      width: 148mm;  /* A6 */
      height: 105mm;
      background: #fff;
      margin: 16px auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12mm 10mm;
      gap: 8mm;
      border: 1px solid #ddd;
    }

    @media print {
      body { background: #fff; }
      .qr-page {
        margin: 0;
        border: none;
        page-break-after: always;
        page-break-inside: avoid;
        width: 100%;
        height: 100vh;
      }
    }

    .qr-left {
      display: flex;
      flex-direction: column;
      gap: 6mm;
      flex: 1;
      min-width: 0;
    }
    .qr-brand {
      font-size: 11pt;
      font-weight: 800;
      color: #111;
      letter-spacing: -0.02em;
    }
    .qr-table-label {
      font-size: 28pt;
      font-weight: 900;
      color: #${accent};
      letter-spacing: -0.04em;
      line-height: 1;
    }
    .qr-instruction {
      font-size: 9pt;
      color: #666;
      line-height: 1.4;
    }
    .qr-instruction strong {
      display: block;
      color: #111;
      font-size: 10pt;
      margin-bottom: 2px;
    }
    .qr-url {
      font-size: 7pt;
      color: #aaa;
      word-break: break-all;
      font-family: 'Courier New', monospace;
    }

    .qr-right {
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4mm;
    }
    .qr-right canvas,
    .qr-right img { display: block; }
    .qr-scan-label {
      font-size: 8pt;
      color: #999;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="print-instructions">
    <span>
      <strong>${escHtml(name)}</strong> — ${tableCount} table QR codes.
      Print at actual size. Recommended: cut to A6 and laminate.
    </span>
    <button class="print-btn" onclick="window.print()">🖨 Print All</button>
  </div>

${tables.map(t => `  <div class="qr-page" id="page_${escHtml(t.label)}">
    <div class="qr-left">
      <div class="qr-brand">${escHtml(name)}</div>
      <div class="qr-table-label">Table<br>${escHtml(t.label)}</div>
      <div class="qr-instruction">
        <strong>Scan to order</strong>
        Point your phone camera at the QR code to start your order directly.
      </div>
      <div class="qr-url">${escHtml(t.url)}</div>
    </div>
    <div class="qr-right">
      <div id="qr_${escHtml(t.label)}"></div>
      <div class="qr-scan-label">Scan to order</div>
    </div>
  </div>`).join('\n')}

  <script>
    const tables = ${JSON.stringify(tables)};
    tables.forEach(function(t) {
      new QRCode(document.getElementById('qr_' + t.label), {
        text:         t.url,
        width:        160,
        height:       160,
        colorDark:    '#111111',
        colorLight:   '#ffffff',
        correctLevel: QRCode.CorrectLevel.H,
      });
    });
  <\/script>
</body>
</html>`;

/* ── Escape helper ────────────────────────────────────────────────────────────── */
function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ── Write output ─────────────────────────────────────────────────────────────── */
const absOut = path.resolve(outPath);
fs.writeFileSync(absOut, html, 'utf8');
console.log(`\n✓ Generated ${tableCount} table QR codes`);
console.log(`  Output: ${absOut}`);
console.log(`\n  To print: open the file in a browser, then File → Print`);
console.log(`  Tip: set page size to A6 (148mm × 105mm) for laminated cards\n`);
