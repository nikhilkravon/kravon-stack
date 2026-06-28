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
    const result = await svc.getSettlementBySession(req.tenant.tenant_id, sessionId);
    sendResult(res, result);
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
    const updated = await require('../../domains/billing/repository').updateSettlementNotes(
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
  amount_paise: z.number().int().positive(),
  reference:    z.string().max(255).optional(),
  notes:        z.string().max(500).optional(),
});

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
