'use strict';

/**
 * bill.renderer.js — GST-compliant HTML bill renderer.
 *
 * Produces a self-contained, print-optimised HTML page from either:
 *   - a session bill  (from sessions.getBill)
 *   - an invoice snapshot (from billing.invoices.snapshot)
 *
 * No external dependencies. The HTML is sent as text/html.
 * Staff open it in a browser tab and hit Cmd/Ctrl+P to print.
 *
 * Two exported functions, same HTML template:
 *   renderSessionBill(bill, restaurant)   — dine-in / session path
 *   renderInvoiceSnapshot(snapshot)       — finalized settlement invoice path
 */

/* ── helpers ─────────────────────────────────────────────────────────────── */

function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function rs(paise) {
  return '₹' + (paise / 100).toFixed(2);
}

function rsF(rupees) {
  return '₹' + Number(rupees).toFixed(2);
}

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
    timeZone: 'Asia/Kolkata',
  });
}

/* ── shared HTML shell ───────────────────────────────────────────────────── */

function _css() {
  return `
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: 'Courier New', monospace;
        font-size: 12px;
        color: #111;
        background: #fff;
        max-width: 320px;
        margin: 0 auto;
        padding: 16px 12px;
      }
      .header { text-align: center; margin-bottom: 10px; }
      .header h1 { font-size: 16px; font-weight: 700; letter-spacing: 0.5px; }
      .header p  { font-size: 11px; color: #444; margin-top: 2px; }
      .divider   { border: none; border-top: 1px dashed #aaa; margin: 8px 0; }
      .divider-solid { border: none; border-top: 1px solid #111; margin: 8px 0; }
      .meta      { font-size: 11px; color: #444; margin-bottom: 4px; }
      .meta strong { color: #111; }
      table      { width: 100%; border-collapse: collapse; }
      th         { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;
                   border-bottom: 1px solid #ccc; padding-bottom: 3px; text-align: left; }
      td         { padding: 3px 0; vertical-align: top; }
      .r         { text-align: right; }
      .items-table td { font-size: 12px; }
      .totals-table td { font-size: 12px; }
      .totals-table .label { color: #444; }
      .grand-row td  { font-weight: 700; font-size: 13px; border-top: 1px solid #111; padding-top: 4px; }
      .gst-block { margin-top: 6px; }
      .gst-block .gst-title { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #666; margin-bottom: 3px; }
      .payments-block { margin-top: 6px; }
      .footer { text-align: center; font-size: 10px; color: #888; margin-top: 12px; }
      .badge { display: inline-block; font-size: 10px; padding: 1px 6px;
               border: 1px solid #ccc; border-radius: 3px; color: #555; }
      @media print {
        body { max-width: 100%; padding: 0; }
        .no-print { display: none; }
      }
    </style>`;
}

function _shell(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  ${_css()}
</head>
<body>
  <div class="no-print" style="margin-bottom:12px;text-align:center">
    <button onclick="window.print()" style="padding:6px 16px;font-size:12px;cursor:pointer">
      🖨 Print
    </button>
  </div>
  ${body}
</body>
</html>`;
}

/* ── restaurant header block ─────────────────────────────────────────────── */

function _restaurantHeader(restaurant) {
  const gst = restaurant.settings?.gst || {};
  const loc  = restaurant.location || {};
  const lines = [
    `<h1>${esc(restaurant.name)}</h1>`,
    loc.address ? `<p>${esc(loc.address)}${loc.city ? ', ' + esc(loc.city) : ''}</p>` : '',
    loc.phone   ? `<p>Ph: ${esc(loc.phone)}</p>` : '',
    gst.gstin   ? `<p>GSTIN: ${esc(gst.gstin)}</p>` : '',
  ].filter(Boolean);
  return `<div class="header">${lines.join('\n')}</div>`;
}

/* ── item rows ───────────────────────────────────────────────────────────── */

function _itemRows(items) {
  if (!items || !items.length) return '<tr><td colspan="3" style="color:#888">No items</td></tr>';
  return items.map(i => {
    const qty   = Number(i.qty || i.quantity || 1);
    const price = Number(i.price || i.unit_price || 0);
    return `
      <tr>
        <td>${esc(i.name || i.item_name)}</td>
        <td class="r">${qty}</td>
        <td class="r">${rsF(price * qty)}</td>
      </tr>`;
  }).join('');
}

/* ── totals block ────────────────────────────────────────────────────────── */

function _totalsRow(label, value, grand = false) {
  const cls = grand ? 'grand-row' : '';
  return `<tr class="${cls}"><td class="label">${label}</td><td class="r">${value}</td></tr>`;
}

/* ──────────────────────────────────────────────────────────────────────────
   renderSessionBill
   Input: bill from sessions.getBill(), restaurant from tenant.restaurants + location
   ────────────────────────────────────────────────────────────────────────── */

function renderSessionBill(bill, restaurant) {
  const gst = bill.gst_snapshot;

  // Flatten all items across orders
  const allItems = (bill.orders || []).flatMap(o => o.items || []);

  const itemRows = allItems.length
    ? allItems.map(i => {
        const qty   = Number(i.qty || 1);
        const price = Number(i.price || 0);
        return `
          <tr>
            <td>${esc(i.name)}</td>
            <td class="r">${qty}</td>
            <td class="r">${rsF(price * qty)}</td>
          </tr>`;
      }).join('')
    : '<tr><td colspan="3" style="color:#888">No items</td></tr>';

  const subtotalLine   = _totalsRow('Subtotal', rsF(bill.subtotal));
  const taxableLabel   = gst?.inclusive ? 'Taxable Amount' : null;
  const taxableLine    = taxableLabel ? _totalsRow(taxableLabel, rsF(bill.taxable_amount)) : '';
  const cgstLine       = bill.cgst_amount > 0
    ? _totalsRow(`CGST @ ${gst?.cgst_rate != null ? (gst.cgst_rate * 100).toFixed(1) : ''}%`, rsF(bill.cgst_amount))
    : '';
  const sgstLine       = bill.sgst_amount > 0
    ? _totalsRow(`SGST @ ${gst?.sgst_rate != null ? (gst.sgst_rate * 100).toFixed(1) : ''}%`, rsF(bill.sgst_amount))
    : '';
  const grandLine      = _totalsRow('TOTAL', rsF(bill.grand_total), true);

  const inconsistentWarning = bill.gst_inconsistent
    ? `<p style="color:#c00;font-size:10px;margin-top:4px">⚠ GST rates varied across orders — please verify.</p>`
    : '';

  const body = `
    ${_restaurantHeader(restaurant)}
    <hr class="divider">

    <p class="meta"><strong>Table:</strong> ${esc(bill.table_name)}</p>
    ${bill.covers ? `<p class="meta"><strong>Covers:</strong> ${bill.covers}</p>` : ''}
    <p class="meta"><strong>Opened:</strong> ${fmtDate(bill.opened_at)}</p>
    ${bill.closed_at ? `<p class="meta"><strong>Closed:</strong> ${fmtDate(bill.closed_at)}</p>` : ''}

    <hr class="divider">

    <table class="items-table">
      <thead>
        <tr><th>Item</th><th class="r">Qty</th><th class="r">Amount</th></tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>

    <hr class="divider">

    <table class="totals-table">
      <tbody>
        ${subtotalLine}
        ${taxableLine}
        ${cgstLine}
        ${sgstLine}
        ${grandLine}
      </tbody>
    </table>
    ${inconsistentWarning}

    ${!gst ? '<p class="meta" style="margin-top:6px;color:#888">No GST applied</p>' : ''}

    <hr class="divider-solid">
    <div class="footer">
      <p>Thank you for dining with us!</p>
      <p style="margin-top:4px">Printed ${fmtDate(new Date().toISOString())}</p>
    </div>`;

  return _shell(`Bill — ${bill.table_name}`, body);
}

/* ──────────────────────────────────────────────────────────────────────────
   renderInvoiceSnapshot
   Input: invoice.snapshot from billing.invoices (generated by billing/service.js)
   ────────────────────────────────────────────────────────────────────────── */

function renderInvoiceSnapshot(snapshot, invoiceNumber, generatedAt) {
  const gst = snapshot.gst_snapshot || {};

  // Separate item lines from tax/round-off lines
  const ITEM_TYPES = new Set(['ORDER_ITEM', 'MANUAL_ITEM', 'PRICE_OVERRIDE', 'COMPLIMENTARY_ITEM']);
  const TAX_TYPES  = new Set(['TAX']);
  const items    = (snapshot.lines || []).filter(l => ITEM_TYPES.has(l.line_type) && !l.deleted_at);
  const discounts= (snapshot.lines || []).filter(l => l.line_type === 'DISCOUNT' && !l.deleted_at);
  const charges  = (snapshot.lines || []).filter(l => ['SERVICE_CHARGE','DELIVERY_CHARGE','PACKAGING','ADJUSTMENT'].includes(l.line_type) && !l.deleted_at);
  const taxes    = (snapshot.lines || []).filter(l => TAX_TYPES.has(l.line_type) && !l.deleted_at);
  const roundOff = (snapshot.lines || []).find(l => l.line_type === 'ROUND_OFF' && !l.deleted_at);
  const tip      = (snapshot.lines || []).find(l => l.line_type === 'TIP' && !l.deleted_at);

  const itemRows = items.map(l => `
    <tr>
      <td>${esc(l.description)}${l.is_comp ? ' <span class="badge">Comp</span>' : ''}</td>
      <td class="r">${l.quantity || 1}</td>
      <td class="r">${rs(l.amount_paise)}</td>
    </tr>`).join('') || '<tr><td colspan="3" style="color:#888">No items</td></tr>';

  const discountRows = discounts.map(l =>
    _totalsRow(esc(l.description || 'Discount'), `−${rs(Math.abs(l.amount_paise))}`)
  ).join('');

  const chargeRows = charges.map(l =>
    _totalsRow(esc(l.description || l.line_type), rs(l.amount_paise))
  ).join('');

  const taxRows = taxes.map(l =>
    _totalsRow(esc(l.description || l.tax_name || 'Tax'), rs(l.amount_paise))
  ).join('');

  const roundRow = roundOff
    ? _totalsRow('Round Off', (roundOff.amount_paise >= 0 ? '+' : '') + rs(roundOff.amount_paise))
    : '';

  const tipRow = tip ? _totalsRow('Tip', rs(tip.amount_paise)) : '';

  const grandRow = _totalsRow('TOTAL', rs(snapshot.total_paise), true);

  const paidRows = (snapshot.payments || []).map(p =>
    _totalsRow(
      `Paid (${esc(p.method)})${p.is_refund ? ' — Refund' : ''}`,
      (p.is_refund ? '−' : '') + rs(Math.abs(p.amount_paise))
    )
  ).join('');

  const balancePaise = Math.max(0, snapshot.total_paise - Math.max(0, snapshot.paid_paise));
  const balanceRow   = balancePaise > 0 ? _totalsRow('Balance Due', rs(balancePaise)) : '';

  const restaurant = {
    name: snapshot.restaurant_name,
    settings: { gst: { gstin: snapshot.gstin } },
    location: {},
  };

  const body = `
    ${_restaurantHeader(restaurant)}
    <hr class="divider">

    <p class="meta"><strong>Invoice No:</strong> ${esc(invoiceNumber || snapshot.invoice_number || '—')}</p>
    <p class="meta"><strong>Date:</strong> ${fmtDate(generatedAt || snapshot.generated_at)}</p>
    ${snapshot.settlement_id ? `<p class="meta"><strong>Ref:</strong> ${esc(snapshot.settlement_id.slice(-8).toUpperCase())}</p>` : ''}

    <hr class="divider">

    <table class="items-table">
      <thead>
        <tr><th>Item</th><th class="r">Qty</th><th class="r">Amount</th></tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>

    <hr class="divider">

    <table class="totals-table">
      <tbody>
        ${_totalsRow('Subtotal', rs(snapshot.subtotal_paise))}
        ${discountRows}
        ${chargeRows}
        ${taxRows}
        ${tipRow}
        ${roundRow}
        ${grandRow}
      </tbody>
    </table>

    ${paidRows || balanceRow ? `
    <hr class="divider">
    <table class="totals-table payments-block">
      <tbody>
        ${paidRows}
        ${balanceRow}
      </tbody>
    </table>` : ''}

    ${gst.gstin ? `
    <hr class="divider">
    <div class="gst-block">
      <div class="gst-title">GST Details</div>
      <p class="meta">GSTIN: ${esc(gst.gstin)}</p>
      ${taxes.map(t => `<p class="meta">${esc(t.description)}: ${rs(t.amount_paise)}</p>`).join('')}
    </div>` : ''}

    <hr class="divider-solid">
    <div class="footer">
      <p>Thank you for your business!</p>
      <p style="margin-top:4px">This is a computer-generated invoice.</p>
    </div>`;

  return _shell(`Invoice ${invoiceNumber || ''}`, body);
}

module.exports = { renderSessionBill, renderInvoiceSnapshot };
