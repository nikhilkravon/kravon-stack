/**
 * ROUTE — customers.js
 * GET  /v1/restaurants/:slug/customers               — paginated customer list with order stats
 * GET  /v1/restaurants/:slug/customers/:id           — single customer + order history
 * PATCH /v1/restaurants/:slug/customers/:id          — update notes / tags
 * GET  /v1/restaurants/:slug/customers/:id/export    — full customer data export (owner/admin)
 * POST /v1/restaurants/:slug/customers/:id/delete-request — DPDP deletion workflow (owner/admin)
 * POST /v1/restaurants/:slug/customers/:id/correct   — correct personal data (owner/admin)
 */

'use strict';

const express          = require('express');
const { z }            = require('zod');
const { query }        = require('../../db/pool');
const customerService  = require('../../domains/customer/service');
const customerRepo     = require('../../domains/customer/repository');
const { requireRestaurantAuth, requireRole } = require('../middleware/auth');
const audit  = require('../../utils/audit');
const events = require('../../utils/events');

const router = express.Router();
router.use(requireRestaurantAuth);

/* ── GET /customers ──────────────────────────────────────────────────────── */
router.get('/', async (req, res, next) => {
  try {
    const page  = Math.min(10000, Math.max(1, parseInt(req.query.page,  10) || 1));
    const limit = Math.min(100,   Math.max(1, parseInt(req.query.limit, 10) || 25));
    const { customers, total } = await customerRepo.listPaginated(req.tenant.tenant_id, {
      page, limit, search: req.query.search || null,
    });
    res.json({ ok: true, customers, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) { next(err); }
});

/* ── GET /customers/:id ──────────────────────────────────────────────────── */
router.get('/:id', async (req, res, next) => {
  try {
    const profile = await customerService.getProfile(req.tenant.tenant_id, req.params.id);
    if (!profile) return res.status(404).json({ error: 'Customer not found' });
    const { orders, ...customer } = profile;
    res.json({ ok: true, customer, orders });
  } catch (err) { next(err); }
});

/* ── PATCH /customers/:id ────────────────────────────────────────────────── */
const UpdateCustomerSchema = z.object({
  notes: z.string().max(2000).optional(),
  tags:  z.array(z.string().max(50)).max(20).optional(),
});

router.patch('/:id', async (req, res, next) => {
  try {
    const parsed = UpdateCustomerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    if (!Object.keys(parsed.data).length) return res.status(400).json({ error: 'Nothing to update' });

    const customer = await customerRepo.updateNotes(req.tenant.tenant_id, req.params.id, parsed.data);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    res.json({ ok: true, customer });
  } catch (err) { next(err); }
});

/* ── GET /customers/:id/export ───────────────────────────────────────────── */
router.get('/:id/export', requireRole('owner', 'admin'), async (req, res, next) => {
  try {
    const tenantId    = req.tenant.tenant_id;
    const customerId  = req.params.id;

    const [profileRes, ordersRes, reservationsRes, consentRes] = await Promise.all([
      query(
        `SELECT id, name, phone, email, preferred_name, date_of_birth, anniversary,
                dietary_pref, tags, notes, sms_consent, email_consent, whatsapp_consent,
                created_at
         FROM customer.customers
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [customerId, tenantId]
      ),
      query(
        `SELECT id, channel, fulfillment_type, status, total_amount, created_at
         FROM orders.orders
         WHERE customer_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
         ORDER BY created_at DESC`,
        [customerId, tenantId]
      ),
      query(
        `SELECT id, party_size, reservation_date, reservation_time, status, notes, created_at
         FROM dining.reservations
         WHERE customer_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
         ORDER BY reservation_date DESC`,
        [customerId, tenantId]
      ),
      query(
        `SELECT id, consent_type, granted, source, created_at
         FROM customer.consent_history
         WHERE customer_id = $1 AND tenant_id = $2
         ORDER BY created_at DESC`,
        [customerId, tenantId]
      ),
    ]);

    if (!profileRes.rows.length) return res.status(404).json({ error: 'Customer not found' });

    audit.log(null, {
      tenantId,
      actorId:    req.auth.staffId,
      actorType:  'staff',
      action:     'customer.export',
      entityType: 'customer.customers',
      entityId:   customerId,
      req,
    });

    events.emit('customer.export_requested', { tenantId, customerId, actorId: req.auth.staffId });

    res.json({
      ok:              true,
      exportedAt:      new Date().toISOString(),
      profile:         profileRes.rows[0],
      orders:          ordersRes.rows.map(r => ({ ...r, total_amount: Number(r.total_amount) })),
      reservations:    reservationsRes.rows,
      consent_history: consentRes.rows,
    });
  } catch (err) { next(err); }
});

/* ── POST /customers/:id/delete-request ──────────────────────────────────── */
router.post('/:id/delete-request', requireRole('owner', 'admin'), async (req, res, next) => {
  try {
    const tenantId   = req.tenant.tenant_id;
    const customerId = req.params.id;

    // Verify customer belongs to this tenant
    const check = await query(
      `SELECT id FROM customer.customers WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [customerId, tenantId]
    );
    if (!check.rows.length) return res.status(404).json({ error: 'Customer not found' });

    const result = await query(
      `INSERT INTO platform.customer_data_requests
         (customer_id, tenant_id, request_type, status)
       VALUES ($1, $2, 'DELETE', 'pending')
       RETURNING id`,
      [customerId, tenantId]
    );
    const requestId = result.rows[0].id;

    audit.log(null, {
      tenantId,
      actorId:    req.auth.staffId,
      actorType:  'staff',
      action:     'customer.delete_request',
      entityType: 'customer.customers',
      entityId:   customerId,
      req,
    });

    events.emit('customer.delete_requested', { tenantId, customerId, actorId: req.auth.staffId });

    res.json({ ok: true, requestId });
  } catch (err) { next(err); }
});

/* ── POST /customers/:id/correct ─────────────────────────────────────────── */
const CorrectCustomerSchema = z.object({
  name:         z.string().min(1).max(120).optional(),
  phone:        z.string().max(20).optional(),
  email:        z.string().email().optional(),
  dietary_pref: z.array(z.string().max(50)).max(10).optional(),
});

router.post('/:id/correct', requireRole('owner', 'admin'), async (req, res, next) => {
  try {
    const parsed = CorrectCustomerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const d          = parsed.data;
    const tenantId   = req.tenant.tenant_id;
    const customerId = req.params.id;

    const before = await query(
      `SELECT name, phone, email, dietary_pref FROM customer.customers
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [customerId, tenantId]
    );
    if (!before.rows.length) return res.status(404).json({ error: 'Customer not found' });

    const sets   = [];
    const values = [];
    let   idx    = 1;

    if (d.name         !== undefined) { sets.push(`name = $${idx++}`);          values.push(d.name); }
    if (d.phone        !== undefined) { sets.push(`phone = $${idx++}`);         values.push(d.phone); }
    if (d.email        !== undefined) { sets.push(`email = $${idx++}`);         values.push(d.email); }
    if (d.dietary_pref !== undefined) { sets.push(`dietary_pref = $${idx++}`);  values.push(d.dietary_pref); }

    if (!sets.length) return res.status(400).json({ error: 'Nothing to correct' });

    sets.push('updated_at = NOW()');
    values.push(customerId, tenantId);

    const result = await query(
      `UPDATE customer.customers SET ${sets.join(', ')}
       WHERE id = $${idx} AND tenant_id = $${idx + 1} AND deleted_at IS NULL
       RETURNING id, name, phone, email, dietary_pref, updated_at`,
      values
    );

    // Log DPDP correction request
    await query(
      `INSERT INTO platform.customer_data_requests
         (customer_id, tenant_id, request_type, status, completed_at)
       VALUES ($1, $2, 'CORRECT', 'done', NOW())`,
      [customerId, tenantId]
    );

    audit.log(null, {
      tenantId,
      actorId:    req.auth.staffId,
      actorType:  'staff',
      action:     'customer.correct',
      entityType: 'customer.customers',
      entityId:   customerId,
      oldValue:   before.rows[0],
      newValue:   result.rows[0],
      req,
    });

    events.emit('customer.correct_requested', { tenantId, customerId, actorId: req.auth.staffId });

    res.json({ ok: true, customer: result.rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
