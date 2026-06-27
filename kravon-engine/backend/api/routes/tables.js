'use strict';

const express  = require('express');
const { z }    = require('zod');
const diningRepo = require('../../domains/dining/repository');
const { requireRestaurantAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireRestaurantAuth);

const CreateTableSchema = z.object({
  name:     z.string().min(1).max(50),
  capacity: z.number().int().min(1).max(50).optional(),
  floor:    z.string().max(50).optional(),
});

const UpdateTableSchema = z.object({
  name:      z.string().min(1).max(50).optional(),
  capacity:  z.number().int().min(1).max(50).optional(),
  floor:     z.string().max(50).optional(),
  is_active: z.boolean().optional(),
});

router.get('/', async (req, res, next) => {
  try {
    const rows = await diningRepo.listTables(req.tenant.tenant_id);
    const tables = rows.map(r => ({
      id: r.id, name: r.name, capacity: r.capacity, floor: r.floor,
      status: r.status, qr_code: r.qr_code, is_active: r.is_active, created_at: r.created_at,
      staff_notify_at: r.staff_notify_at || null,
      session: r.session_id ? {
        id: r.session_id, opened_at: r.session_opened_at, covers: r.session_covers,
        total: Number(r.session_total), session_status: r.session_status,
        bill_owner: r.session_bill_owner, bill_requested: !!r.session_bill_requested_at,
        bill_requested_at: r.session_bill_requested_at,
      } : null,
    }));
    // Sort: guests waiting first, then occupied (open session), then the rest
    tables.sort((a, b) => {
      const rank = t => t.staff_notify_at ? 0 : t.session ? 1 : 2;
      return rank(a) - rank(b);
    });
    res.json({ ok: true, tables });
  } catch (err) { next(err); }
});

router.get('/sessions', async (req, res, next) => {
  try {
    const rows = await diningRepo.listOpenSessions(req.tenant.tenant_id);
    res.json({ ok: true, sessions: rows.map(r => ({ ...r, total: Number(r.total), order_count: Number(r.order_count) })) });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const parsed = CreateTableSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });

    const tenantId  = req.tenant.tenant_id;
    const locationId = await diningRepo.getLocationId(tenantId);
    if (!locationId) return res.status(400).json({ error: 'No active location found for this restaurant.' });

    const table  = await diningRepo.insertTable(tenantId, locationId, parsed.data);
    const qrCode = `${process.env.APP_BASE_URL || 'https://app.kravon.in'}/${req.tenant.slug}/tables?table_id=${table.id}`;
    await diningRepo.setTableQrCode(table.id, qrCode);

    res.status(201).json({ ok: true, table: { ...table, qr_code: qrCode } });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A table with this name already exists.' });
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const parsed = UpdateTableSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    if (!Object.keys(parsed.data).length) return res.status(400).json({ error: 'Nothing to update' });

    const table = await diningRepo.updateTable(req.tenant.tenant_id, req.params.id, parsed.data);
    if (!table) return res.status(404).json({ error: 'Table not found' });
    res.json({ ok: true, table });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A table with this name already exists.' });
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const open = await diningRepo.hasOpenSession(req.params.id);
    if (open) return res.status(409).json({ error: 'Cannot delete a table with an open session. Close the session first.' });

    const row = await diningRepo.softDeleteTable(req.tenant.tenant_id, req.params.id);
    if (!row) return res.status(404).json({ error: 'Table not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
