/**
 * ROUTE — inventory.js
 * GET    /v1/restaurants/:slug/inventory                    — list stock items
 * POST   /v1/restaurants/:slug/inventory                    — create stock item
 * PUT    /v1/restaurants/:slug/inventory/:id                — update stock item
 * DELETE /v1/restaurants/:slug/inventory/:id                — soft-delete stock item
 * GET    /v1/restaurants/:slug/inventory/:id/movements       — paginated movement ledger
 * POST   /v1/restaurants/:slug/inventory/:id/movements       — record a movement
 * GET    /v1/restaurants/:slug/inventory/vendors             — list vendors
 * POST   /v1/restaurants/:slug/inventory/vendors             — create vendor
 * PUT    /v1/restaurants/:slug/inventory/vendors/:id         — update vendor
 * DELETE /v1/restaurants/:slug/inventory/vendors/:id         — soft-delete vendor
 *
 * Operator-only surface — every route requires staff auth. Mounted behind
 * requireFeature('has_inventory') in server.js.
 *
 * /vendors routes are declared before /:id so Express doesn't match
 * "vendors" as an item id.
 *
 * Manual stock tracking + FIFO costing. No recipe/BOM link to menu items,
 * no auto-depletion on order creation, no purchase orders. See the
 * approved plans for scope.
 */

'use strict';

const express = require('express');
const { z }   = require('zod');
const inventoryService = require('../../domains/inventory/service');
const { requireRestaurantAuth } = require('../middleware/auth');
const calc = require('../../domains/billing/calculator');

const router = express.Router();
router.use(requireRestaurantAuth);

/* ── Zod schemas ──────────────────────────────────────────────────────────── */

const ItemCreateSchema = z.object({
  name:                z.string().min(1).max(150),
  unit:                z.string().max(30).nullable().optional(),
  low_stock_threshold: z.number().min(0).nullable().optional(),
});

const ItemUpdateSchema = z.object({
  name:                z.string().min(1).max(150).optional(),
  unit:                z.string().max(30).nullable().optional(),
  low_stock_threshold: z.number().min(0).nullable().optional(),
});

// inventory.movements.quantity is NUMERIC(12,3) — round to 3dp here so the
// value the service layer validates against (negative-stock guard, FIFO
// consumption) exactly matches what Postgres will actually store. Without
// this, a client-supplied value like 1.23456789 gets silently rounded to
// 1.235 on INSERT, but the pre-insert guard check would have run against
// the untruncated number — a narrow but real mismatch between what was
// validated and what was persisted.
//
// unit_cost is in rupees at the API boundary — converted to unit_cost_paise
// before reaching the service layer, per the paise invariant
// (domains/billing/calculator.js). Only meaningful for purchase/positive
// adjustment; ignored otherwise (see route handler).
const MovementSchema = z.object({
  movement_type: z.enum(inventoryService.MOVEMENT_TYPES),
  quantity:      z.number()
                   .transform(n => Math.round(n * 1000) / 1000)
                   .refine(n => n !== 0, 'Quantity cannot be zero.'),
  notes:         z.string().max(500).nullable().optional(),
  unit_cost:     z.number().min(0).nullable().optional(),
  vendor_id:     z.string().uuid().nullable().optional(),
});

const VendorCreateSchema = z.object({
  name:  z.string().min(1).max(150),
  phone: z.string().max(30).nullable().optional(),
  email: z.string().email().max(150).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

const VendorUpdateSchema = VendorCreateSchema.partial();

function fail(res, parsed) {
  return res.status(422).json({
    error:  'Validation failed',
    issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
  });
}

/* ══════════════════════════════════════════════════════════
   VENDORS — declared before /:id so "vendors" doesn't match as an item id
   ══════════════════════════════════════════════════════════ */

router.get('/vendors', async (req, res, next) => {
  try {
    const vendors = await inventoryService.listVendors(req.tenant.tenant_id);
    res.json({ ok: true, vendors });
  } catch (err) { next(err); }
});

router.post('/vendors', async (req, res, next) => {
  const parsed = VendorCreateSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, parsed);
  try {
    const vendor = await inventoryService.createVendor(req.tenant.tenant_id, parsed.data);
    res.status(201).json({ ok: true, vendor });
  } catch (err) { next(err); }
});

router.put('/vendors/:id', async (req, res, next) => {
  const parsed = VendorUpdateSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, parsed);
  if (Object.keys(parsed.data).length === 0) {
    return res.status(422).json({ error: 'No fields provided' });
  }
  try {
    const vendor = await inventoryService.updateVendor(req.tenant.tenant_id, req.params.id, parsed.data);
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
    res.json({ ok: true, vendor });
  } catch (err) { next(err); }
});

router.delete('/vendors/:id', async (req, res, next) => {
  try {
    const row = await inventoryService.deleteVendor(req.tenant.tenant_id, req.params.id);
    if (!row) return res.status(404).json({ error: 'Vendor not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ══════════════════════════════════════════════════════════
   ITEMS
   ══════════════════════════════════════════════════════════ */

router.get('/', async (req, res, next) => {
  try {
    const items = await inventoryService.listItems(req.tenant.tenant_id);
    res.json({ ok: true, items });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  const parsed = ItemCreateSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, parsed);
  try {
    const item = await inventoryService.createItem(req.tenant.tenant_id, parsed.data);
    res.status(201).json({ ok: true, item });
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  const parsed = ItemUpdateSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, parsed);
  if (Object.keys(parsed.data).length === 0) {
    return res.status(422).json({ error: 'No fields provided' });
  }
  try {
    const item = await inventoryService.updateItem(req.tenant.tenant_id, req.params.id, parsed.data);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json({ ok: true, item });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const row = await inventoryService.deleteItem(req.tenant.tenant_id, req.params.id);
    if (!row) return res.status(404).json({ error: 'Item not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ══════════════════════════════════════════════════════════
   MOVEMENTS
   ══════════════════════════════════════════════════════════ */

router.get('/:id/movements', async (req, res, next) => {
  try {
    const limit  = Math.min(Number(req.query.limit) || 50, 200);
    const cursor = req.query.cursor || null;
    const movements = await inventoryService.listMovements(req.tenant.tenant_id, req.params.id, { limit, cursor });
    res.json({ ok: true, movements });
  } catch (err) { next(err); }
});

router.post('/:id/movements', async (req, res, next) => {
  const parsed = MovementSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, parsed);

  const { movement_type, quantity, notes, unit_cost, vendor_id } = parsed.data;
  if (movement_type === 'purchase' && quantity <= 0) {
    return res.status(422).json({ error: 'Purchase quantity must be positive.' });
  }
  if (['wastage', 'correction'].includes(movement_type) && quantity >= 0) {
    return res.status(422).json({ error: `${movement_type} quantity must be negative.` });
  }

  // unit_cost/vendor only apply to movements that open a FIFO lot (purchase,
  // or a positive adjustment) — silently ignored otherwise rather than
  // erroring, since the frontend only shows these fields in that case.
  const opensLot = movement_type === 'purchase' || (movement_type === 'adjustment' && quantity > 0);

  try {
    const movement = await inventoryService.recordMovement(req.tenant.tenant_id, req.params.id, {
      movement_type, quantity, notes,
      unit_cost_paise: opensLot && unit_cost != null ? calc.paise(unit_cost) : null,
      vendor_id: opensLot ? (vendor_id ?? null) : null,
    });
    if (!movement) return res.status(404).json({ error: 'Item not found' });
    res.status(201).json({ ok: true, movement });
  } catch (err) { next(err); }
});

module.exports = router;
