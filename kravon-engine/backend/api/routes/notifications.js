'use strict';

const express            = require('express');
const notificationsRepo  = require('../../domains/notifications/repository');
const { requireRestaurantAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireRestaurantAuth);

router.get('/', async (req, res, next) => {
  try {
    const page      = Math.min(10000, Math.max(1, parseInt(req.query.page,  10) || 1));
    const limit     = Math.min(100,   Math.max(1, parseInt(req.query.limit, 10) || 20));
    const unreadOnly = req.query.unread === 'true';

    const { notifications, total, unread_count } = await notificationsRepo.list(
      req.tenant.tenant_id, { page, limit, unreadOnly }
    );

    res.json({
      ok: true, notifications, total, unread_count, page, limit,
      pages: Math.ceil(total / limit),
    });
  } catch (err) { next(err); }
});

router.post('/read-all', async (req, res, next) => {
  try {
    const count = await notificationsRepo.markAllRead(req.tenant.tenant_id);
    res.json({ ok: true, count });
  } catch (err) { next(err); }
});

router.post('/:id/read', async (req, res, next) => {
  try {
    const found = await notificationsRepo.markRead(req.tenant.tenant_id, req.params.id);
    if (!found) return res.status(404).json({ error: 'Notification not found or already read' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
