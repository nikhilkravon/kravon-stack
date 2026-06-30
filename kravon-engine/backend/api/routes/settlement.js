'use strict';

/**
 * ROUTE — settlement.js
 *
 * HTTP layer for the Settlement Engine.
 * All business logic lives in domains/billing/service.js.
 *
 * Mounted at: /v1/restaurants/:slug/settlements
 * Gate:       requireFeature('has_tables') — settlements are a dine-in feature
 *
 * All routes require requireRestaurantAuth.
 * Capability checks are performed inside the service layer (not here),
 * so a future capability-DB migration requires no route changes.
 *
 * Endpoints:
 *   POST   /from-session          — create settlement from a dining session
 *   GET    /by-session/:sessionId — fetch settlement for a session
 *   GET    /:id                   — fetch settlement + lines + payments
 *   POST   /:id/lines             — add a line
 *   PATCH  /:id/lines/:lineId     — edit a line
 *   DELETE /:id/lines/:lineId     — remove a line
 *   POST   /:id/finalize          — lock settlement
 *   POST   /:id/void              — void settlement
 *   POST   /:id/payments          — record a payment
 *   POST   /:id/invoice           — generate invoice (must be finalized)
 *   GET    /:id/invoice/:invoiceId — fetch invoice snapshot
 *   GET    /:id/revisions          — full audit trail for this settlement
 */

const express = require('express');
const { z }   = require('zod');

const svc = require('../../domains/billing/service');
const { requireRestaurantAuth } = require('../middleware/auth');
const repo = require('../../domains/billing/repository');
const { query } = require('../../db/pool');

const router = express.Router();
router.use(requireRestaurantAuth);

const LINE_TYPES = [
  'ORDER_ITEM','MANUAL_ITEM','PRICE_OVERRIDE','DISCOUNT','COMPLIMENTARY_ITEM',
  'SERVICE_CHARGE','DELIVERY_CHARGE','PACKAGING','TAX','ROUND_OFF','TIP','ADJUSTMENT',
];
const PAYMENT_METHODS = ['cash','card','upi','wallet','advance','other'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function _validUuid(id) { return id && UUID_RE.test(id); }

function _roles(req) { return req.auth?.roles || []; }
function _staff(req) { return req.auth?.staffId || null; }

function sendResult(res, result, successStatus = 200) {
  if (result.error) return res.status(result.status || 500).json({ error: result.error });
  res.status(successStatus).json({ ok: true, ...result });
}

/* ── GET / — invoice list ────────────────────────────────────────────────── */
router.get('/', async (req, res, next) => {
  try {
    const page       = Math.max(1, parseInt(req.query.page, 10)  || 1);
    const limit      = Math.min(100, parseInt(req.query.limit, 10) || 50);
    const status     = ['draft','open','finalized','voided'].includes(req.query.status) ? req.query.status : null;
    const source     = ['dine_in','order','catering','manual'].includes(req.query.source) ? req.query.source : null;
    const search     = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : null;
    const date_from  = req.query.date_from || null;
    const date_to    = req.query.date_to   ? req.query.date_to + 'T23:59:59Z' : null;
    const result = await svc.listSettlements(req.tenant.tenant_id, {
      page, limit, status, source, search, date_from, date_to,
    });
    res.json({ ok: true, ...result });
  } catch (err) { next(err); }
});

/* ── POST /from-order ────────────────────────────────────────────────────── */
const FromOrderSchema = z.object({ order_id: z.string().uuid() });

router.post('/from-order', async (req, res, next) => {
  const parsed = FromOrderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  try {
    const result = await svc.createFromOrder(req.tenant, parsed.data.order_id, _staff(req));
    sendResult(res, result, 201);
  } catch (err) { next(err); }
});

/* ── POST /from-catering ─────────────────────────────────────────────────── */
const FromCateringSchema = z.object({ lead_id: z.string().uuid() });

router.post('/from-catering', async (req, res, next) => {
  const parsed = FromCateringSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  try {
    const result = await svc.createFromCatering(req.tenant, parsed.data.lead_id, _staff(req));
    sendResult(res, result, 201);
  } catch (err) { next(err); }
});

/* ── POST /manual ────────────────────────────────────────────────────────── */
const ManualSchema = z.object({
  notes:        z.string().max(500).optional().default(''),
  internal_ref: z.string().max(100).optional(),
});

router.post('/manual', async (req, res, next) => {
  const parsed = ManualSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  try {
    const result = await svc.createManual(req.tenant, parsed.data, _staff(req));
    sendResult(res, result, 201);
  } catch (err) { next(err); }
});

/* ── POST /from-session ─────────────────────────────────────────────────── */
const FromSessionSchema = z.object({ session_id: z.string().uuid() });

router.post('/from-session', async (req, res, next) => {
  const parsed = FromSessionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  try {
    const result = await svc.createFromSession(req.tenant, parsed.data.session_id, _staff(req));
    sendResult(res, result, 201);
  } catch (err) { next(err); }
});

/* ── GET /by-session/:sessionId ─────────────────────────────────────────── */
router.get('/by-session/:sessionId', async (req, res, next) => {
  const { sessionId } = req.params;
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return res.status(400).json({ error: 'Invalid session ID' });
  try {
    const result = await svc.getSettlementBySession(req.tenant.tenant_id, sessionId, req.tenant);
    sendResult(res, result);
  } catch (err) { next(err); }
});

/* ── GET /eod-report ─────────────────────────────────────────────────────── */
router.get('/eod-report', async (req, res, next) => {
  try {
    const date     = req.query.date || new Date().toISOString().slice(0, 10);
    const tenantId = req.tenant.tenant_id;

    const [methodRows, summaryRow, discountRow] = await Promise.all([
      query(
        `SELECT sp.method,
                COUNT(sp.id)::int        AS payment_count,
                SUM(sp.amount_paise)::bigint AS total_paise
         FROM billing.payments sp
         JOIN billing.settlements s ON s.id = sp.settlement_id
         WHERE s.tenant_id = $1
           AND s.status = 'finalized'
           AND s.finalized_at::date = $2::date
           AND s.deleted_at IS NULL
           AND sp.deleted_at IS NULL
         GROUP BY sp.method
         ORDER BY total_paise DESC`,
        [tenantId, date],
      ),
      query(
        `SELECT COUNT(id)::int                       AS settlements_count,
                COALESCE(SUM(total_paise),0)::bigint AS total_revenue_paise
         FROM billing.settlements
         WHERE tenant_id = $1
           AND status = 'finalized'
           AND finalized_at::date = $2::date
           AND deleted_at IS NULL`,
        [tenantId, date],
      ),
      query(
        `SELECT COALESCE(SUM(ABS(sl.amount_paise)),0)::bigint AS total_discount_paise,
                COALESCE(SUM(CASE WHEN sl.is_comp THEN ABS(sl.amount_paise) ELSE 0 END),0)::bigint AS total_comp_paise
         FROM billing.settlement_lines sl
         JOIN billing.settlements s ON s.id = sl.settlement_id
         WHERE s.tenant_id = $1
           AND s.status = 'finalized'
           AND s.finalized_at::date = $2::date
           AND s.deleted_at IS NULL
           AND sl.deleted_at IS NULL
           AND (sl.line_type = 'DISCOUNT' OR sl.is_comp = true)`,
        [tenantId, date],
      ),
    ]);

    const { settlements_count, total_revenue_paise } = summaryRow.rows[0];
    const { total_discount_paise, total_comp_paise }  = discountRow.rows[0];

    res.json({
      ok: true,
      date,
      settlements_count,
      total_revenue_paise:  Number(total_revenue_paise),
      total_discount_paise: Number(total_discount_paise),
      total_comp_paise:     Number(total_comp_paise),
      by_method: methodRows.rows.map(r => ({
        method:        r.method,
        payment_count: r.payment_count,
        total_paise:   Number(r.total_paise),
      })),
    });
  } catch (err) { next(err); }
});

/* ── GET /:id ────────────────────────────────────────────────────────────── */
router.get('/:id', async (req, res, next) => {
  if (!_validUuid(req.params.id)) return res.status(400).json({ error: 'Invalid settlement ID' });
  try {
    const result = await svc.getSettlement(req.tenant.tenant_id, req.params.id);
    sendResult(res, result);
  } catch (err) { next(err); }
});

/* ── PATCH /:id — update notes ───────────────────────────────────────────── */
const UpdateNotesSchema = z.object({ notes: z.string().max(1000).optional().default('') });

router.patch('/:id', async (req, res, next) => {
  if (!_validUuid(req.params.id)) return res.status(400).json({ error: 'Invalid settlement ID' });
  const parsed = UpdateNotesSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  try {
    const updated = await repo.updateSettlementNotes(
      null, req.tenant.tenant_id, req.params.id, parsed.data.notes,
    );
    if (!updated) return res.status(404).json({ error: 'Settlement not found.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ── POST /:id/lines ─────────────────────────────────────────────────────── */
const AddLineSchema = z.object({
  line_type:        z.enum(LINE_TYPES),
  description:      z.string().min(1).max(255),
  quantity:         z.number().positive().default(1),
  unit_price_paise: z.number().int().nonnegative().optional(),
  amount_paise:     z.number().int(),   // can be negative for discounts
  percent:          z.number().min(0).max(1).optional(),
  applies_to:       z.string().optional(),
  tax_name:         z.string().optional(),
  tax_rate:         z.number().min(0).max(1).optional(),
  is_comp:          z.boolean().default(false),
  comp_reason:      z.string().max(255).optional(),
  sort_order:       z.number().int().default(0),
  reason:           z.string().max(500).optional(),
});

router.post('/:id/lines', async (req, res, next) => {
  if (!_validUuid(req.params.id)) return res.status(400).json({ error: 'Invalid settlement ID' });
  const parsed = AddLineSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  try {
    const result = await svc.addLine(req.tenant, req.params.id, parsed.data, _staff(req), _roles(req));
    sendResult(res, result, 201);
  } catch (err) { next(err); }
});

/* ── PATCH /:id/lines/:lineId ────────────────────────────────────────────── */
const EditLineSchema = z.object({
  description:      z.string().min(1).max(255).optional(),
  quantity:         z.number().positive().optional(),
  unit_price_paise: z.number().int().nonnegative().optional(),
  amount_paise:     z.number().int().optional(),
  is_comp:          z.boolean().optional(),
  comp_reason:      z.string().max(255).optional(),
  sort_order:       z.number().int().optional(),
  reason:           z.string().max(500).optional(),
}).refine(d => Object.keys(d).length > 0, { message: 'At least one field required' });

router.patch('/:id/lines/:lineId', async (req, res, next) => {
  if (!_validUuid(req.params.id) || !_validUuid(req.params.lineId)) return res.status(400).json({ error: 'Invalid ID' });
  const parsed = EditLineSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  try {
    const result = await svc.editLine(req.tenant, req.params.id, req.params.lineId, parsed.data, _staff(req), _roles(req));
    sendResult(res, result);
  } catch (err) { next(err); }
});

/* ── DELETE /:id/lines/:lineId ───────────────────────────────────────────── */
router.delete('/:id/lines/:lineId', async (req, res, next) => {
  if (!_validUuid(req.params.id) || !_validUuid(req.params.lineId)) return res.status(400).json({ error: 'Invalid ID' });
  // Reason passed as query param (DELETE body is unreliable across proxies)
  const reason = typeof req.query.reason === 'string' ? req.query.reason.slice(0, 500) : undefined;
  try {
    const result = await svc.removeLine(req.tenant, req.params.id, req.params.lineId, _staff(req), _roles(req), reason);
    sendResult(res, result);
  } catch (err) { next(err); }
});

/* ── POST /:id/finalize ──────────────────────────────────────────────────── */
const FinalizeSchema = z.object({
  gst_snapshot: z.object({
    cgst_rate:  z.number().min(0).max(0.5),
    sgst_rate:  z.number().min(0).max(0.5),
    inclusive:  z.boolean().default(false),
    gstin:      z.string().optional(),
  }).optional(),
});

router.post('/:id/finalize', async (req, res, next) => {
  const parsed = FinalizeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  try {
    const result = await svc.finalizeSettlement(req.tenant, req.params.id, _staff(req), _roles(req), parsed.data.gst_snapshot);
    sendResult(res, result);
  } catch (err) { next(err); }
});

/* ── POST /:id/void ──────────────────────────────────────────────────────── */
const VoidSchema = z.object({ void_reason: z.string().min(1).max(500) });

router.post('/:id/void', async (req, res, next) => {
  const parsed = VoidSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  try {
    const result = await svc.voidSettlement(req.tenant, req.params.id, _staff(req), _roles(req), parsed.data.void_reason);
    sendResult(res, result);
  } catch (err) { next(err); }
});

/* ── POST /:id/payments ──────────────────────────────────────────────────── */
const PaymentSchema = z.object({
  method:       z.enum(PAYMENT_METHODS),
  amount_paise: z.number().int().refine(n => n !== 0, 'Amount cannot be zero'),
  is_refund:    z.boolean().default(false),
  reference:    z.string().max(255).optional(),
  notes:        z.string().max(500).optional(),
}).refine(
  d => d.is_refund ? d.amount_paise < 0 : d.amount_paise > 0,
  { message: 'Refunds must have a negative amount; payments must have a positive amount.' }
);

router.post('/:id/payments', async (req, res, next) => {
  const parsed = PaymentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  try {
    const result = await svc.recordPayment(req.tenant, req.params.id, parsed.data, _staff(req), _roles(req));
    sendResult(res, result, 201);
  } catch (err) { next(err); }
});

/* ── POST /:id/invoice ───────────────────────────────────────────────────── */
router.post('/:id/invoice', async (req, res, next) => {
  try {
    const result = await svc.generateInvoice(req.tenant, req.params.id, _staff(req), _roles(req));
    sendResult(res, result, 201);
  } catch (err) { next(err); }
});

/* ── GET /:id/invoice/:invoiceId/render — printable GST invoice ─────────── */
router.get('/:id/invoice/:invoiceId/render', async (req, res, next) => {
  try {
    const renderer = require('../../services/bill.renderer');

    const [inv, restaurantRes] = await Promise.all([
      repo.getInvoice(req.tenant.tenant_id, req.params.invoiceId),
      query(
        `SELECT r.name, r.settings, l.address, l.city, l.phone
         FROM tenant.restaurants r
         LEFT JOIN tenant.locations l ON l.tenant_id = r.id AND l.is_active = TRUE
         WHERE r.id = $1 LIMIT 1`,
        [req.tenant.tenant_id]
      ),
    ]);

    if (!inv) return res.status(404).json({ error: 'Invoice not found.' });
    if (inv.settlement_id !== req.params.id) return res.status(404).json({ error: 'Invoice not found.' });

    // Merge restaurant location into the snapshot for the renderer
    const row = restaurantRes.rows[0] || {};
    const snapshot = {
      ...inv.snapshot,
      restaurant_name: inv.snapshot?.restaurant_name || row.name,
      gstin: inv.snapshot?.gstin || row.settings?.gst?.gstin || null,
    };

    const html = renderer.renderInvoiceSnapshot(snapshot, inv.invoice_number, inv.generated_at);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) { next(err); }
});

/* ── GET /:id/invoice/:invoiceId ─────────────────────────────────────────── */
router.get('/:id/invoice/:invoiceId', async (req, res, next) => {
  try {
    const inv = await repo.getInvoice(req.tenant.tenant_id, req.params.invoiceId);
    if (!inv) return res.status(404).json({ error: 'Invoice not found.' });
    if (inv.settlement_id !== req.params.id) return res.status(404).json({ error: 'Invoice not found.' });
    res.json({ ok: true, invoice: inv });
  } catch (err) { next(err); }
});

/* ── GET /:id/revisions ──────────────────────────────────────────────────── */
router.get('/:id/revisions', async (req, res, next) => {
  try {
    const result = await svc.getRevisions(req.tenant.tenant_id, req.params.id);
    sendResult(res, result);
  } catch (err) { next(err); }
});

module.exports = router;
