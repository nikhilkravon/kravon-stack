'use strict';

/**
 * Settlement Calculation Engine
 *
 * All amounts are INTEGER PAISE internally (100 paise = ₹1).
 * Inputs from the DB are stored as paise integers.
 * Outputs are paise integers.
 * Rounding: Math.round() for percentage-derived values — deterministic,
 * never accumulates float drift.
 *
 * External display layer converts to rupees: paise / 100.
 *
 * This module is PURE — no DB calls, no side effects.
 * Feed it lines, get back totals. Reusable across dine-in, delivery, catering.
 */

const LINE = {
  ORDER_ITEM:         'ORDER_ITEM',
  MANUAL_ITEM:        'MANUAL_ITEM',
  PRICE_OVERRIDE:     'PRICE_OVERRIDE',
  DISCOUNT:           'DISCOUNT',
  COMPLIMENTARY_ITEM: 'COMPLIMENTARY_ITEM',
  SERVICE_CHARGE:     'SERVICE_CHARGE',
  DELIVERY_CHARGE:    'DELIVERY_CHARGE',
  PACKAGING:          'PACKAGING',
  TAX:                'TAX',
  ROUND_OFF:          'ROUND_OFF',
  TIP:                'TIP',
  ADJUSTMENT:         'ADJUSTMENT',
};

const ITEM_TYPES = new Set([
  LINE.ORDER_ITEM, LINE.MANUAL_ITEM, LINE.PRICE_OVERRIDE, LINE.COMPLIMENTARY_ITEM,
]);
const CHARGE_TYPES = new Set([
  LINE.SERVICE_CHARGE, LINE.DELIVERY_CHARGE, LINE.ADJUSTMENT,
]);
const DISCOUNT_TYPES = new Set([LINE.DISCOUNT]);
const TAX_TYPES      = new Set([LINE.TAX]);

/**
 * paise(n) — convert a rupee float/string to integer paise safely.
 * Only used at the boundary where external input enters the system.
 */
function paise(rupeesOrPaise) {
  return Math.round(Number(rupeesOrPaise) * 100);
}

/**
 * toRupees(p) — display helper.
 */
function toRupees(p) {
  return p / 100;
}

/**
 * calculate(lines)
 *
 * Lines: array of settlement_lines rows (deleted_at must already be filtered out).
 * Each line must have: { line_type, amount_paise, is_comp, percent, applies_to }
 *
 * Returns:
 *   { subtotal_paise, discount_paise, charge_paise, tax_paise,
 *     tip_paise, round_off_paise, total_paise }
 *
 * Calculation order:
 *   1. Sum all item lines (ORDER_ITEM, MANUAL_ITEM, PRICE_OVERRIDE, COMPLIMENTARY_ITEM)
 *      → subtotal (comped items = 0 contribution)
 *   2. Apply DISCOUNT lines (fixed or percent of subtotal)
 *   3. Apply CHARGE lines (SERVICE_CHARGE, DELIVERY_CHARGE, PACKAGING, ADJUSTMENT)
 *   4. Apply TAX lines (percent of taxable base = subtotal - discounts + charges)
 *   5. Apply TIP
 *   6. Apply ROUND_OFF
 *   7. total = subtotal - discounts + charges + tax + tip + round_off
 *
 * IMPORTANT: amount_paise on each line is the STORED value.
 *   For percentage lines: amount_paise is pre-computed and stored when the line is
 *   saved. The engine trusts stored amounts — it does NOT re-derive from percent
 *   at read time, which keeps the engine deterministic after finalization.
 *   When creating/editing a percentage line, the service layer computes amount_paise
 *   from the current subtotal and stores it. This is correct.
 */
function calculate(lines) {
  let subtotal_paise   = 0;
  let discount_paise   = 0;
  let charge_paise     = 0;   // service + delivery + adjustment
  let packaging_paise  = 0;
  let tax_paise        = 0;
  let tip_paise        = 0;
  let round_off_paise  = 0;

  for (const line of lines) {
    if (line.deleted_at) continue;
    const amt = Math.round(Number(line.amount_paise));

    if (ITEM_TYPES.has(line.line_type)) {
      if (!line.is_comp) subtotal_paise += amt;
    } else if (DISCOUNT_TYPES.has(line.line_type)) {
      discount_paise += Math.abs(amt);
    } else if (CHARGE_TYPES.has(line.line_type)) {
      charge_paise += amt;
    } else if (line.line_type === LINE.PACKAGING) {
      packaging_paise += amt;
    } else if (TAX_TYPES.has(line.line_type)) {
      tax_paise += amt;
    } else if (line.line_type === LINE.TIP) {
      tip_paise += amt;
    } else if (line.line_type === LINE.ROUND_OFF) {
      round_off_paise += amt;
    }
  }

  const total_paise = Math.max(
    0,
    subtotal_paise - discount_paise + charge_paise + packaging_paise + tax_paise + tip_paise + round_off_paise,
  );

  return {
    subtotal_paise,
    discount_paise,
    charge_paise,
    packaging_paise,
    tax_paise,
    tip_paise,
    round_off_paise,
    total_paise,
  };
}

/**
 * computeGst(subtotal_paise, cgst_rate, sgst_rate, inclusive)
 *
 * Returns { cgst_paise, sgst_paise, total_tax_paise, taxable_paise }
 * cgst_rate and sgst_rate are decimal fractions (e.g. 0.09 for 9%).
 *
 * inclusive=true: tax is extracted from the amount (tax-inclusive pricing)
 * inclusive=false: tax is added on top (tax-exclusive pricing)
 */
function computeGst(subtotal_paise, cgst_rate, sgst_rate, inclusive) {
  const total_rate = cgst_rate + sgst_rate;
  let taxable_paise, total_tax_paise;

  if (inclusive) {
    // Extract tax from price: taxable = price / (1 + rate)
    taxable_paise   = Math.round(subtotal_paise / (1 + total_rate));
    total_tax_paise = subtotal_paise - taxable_paise;
  } else {
    taxable_paise   = subtotal_paise;
    total_tax_paise = Math.round(subtotal_paise * total_rate);
  }

  // Split CGST / SGST proportionally
  const cgst_paise = total_rate > 0
    ? Math.round(total_tax_paise * cgst_rate / total_rate)
    : 0;
  const sgst_paise = total_tax_paise - cgst_paise;

  return { cgst_paise, sgst_paise, total_tax_paise, taxable_paise };
}

/**
 * buildGstLines(subtotal_paise, gst_snapshot)
 *
 * Produces the TAX lines that should be inserted when a settlement is created
 * or when GST is re-applied. Returns array of partial line objects (no IDs).
 */
function buildGstLines(subtotal_paise, gst_snapshot) {
  if (!gst_snapshot || (!gst_snapshot.cgst_rate && !gst_snapshot.sgst_rate)) return [];

  const { cgst_rate = 0, sgst_rate = 0, inclusive = false } = gst_snapshot;
  const { cgst_paise, sgst_paise } = computeGst(subtotal_paise, cgst_rate, sgst_rate, inclusive);

  const lines = [];
  if (cgst_paise) {
    lines.push({
      line_type:    LINE.TAX,
      description:  `CGST @ ${(cgst_rate * 100).toFixed(1)}%`,
      quantity:     1,
      amount_paise: cgst_paise,
      percent:      cgst_rate,
      tax_name:     'CGST',
      tax_rate:     cgst_rate,
    });
  }
  if (sgst_paise) {
    lines.push({
      line_type:    LINE.TAX,
      description:  `SGST @ ${(sgst_rate * 100).toFixed(1)}%`,
      quantity:     1,
      amount_paise: sgst_paise,
      percent:      sgst_rate,
      tax_name:     'SGST',
      tax_rate:     sgst_rate,
    });
  }
  return lines;
}

/**
 * computeRoundOff(total_paise)
 * Returns paise adjustment to round total to nearest rupee.
 * e.g. total_paise = 10345 → round_off = -45 (round down) → ₹103.00
 *      total_paise = 10350 → round_off =  50 (round up)   → ₹104.00
 *      total_paise = 10365 → round_off =  35 (round up)   → ₹104.00
 * Convention: 0.50 rounds UP (standard restaurant practice).
 */
function computeRoundOff(total_paise) {
  const remainder = total_paise % 100;
  if (remainder === 0) return 0;
  return remainder < 50 ? -remainder : (100 - remainder);
}

module.exports = { LINE, paise, toRupees, calculate, computeGst, buildGstLines, computeRoundOff };
