'use strict';

const express    = require('express');
const { z }      = require('zod');
const diningRepo = require('../../domains/dining/repository');
const events     = require('../../utils/events');

const router = express.Router();

const CreateReviewSchema = z.object({
  order_id:         z.string().uuid().optional(),
  session_id:       z.string().uuid().optional(),
  stars:            z.number().int().min(1).max(5),
  feedback:         z.string().max(1000).optional(),
  order_surface:    z.enum(['tables', 'orders']).optional(),
  table_identifier: z.string().max(20).optional(),
});

router.post('/', async (req, res, next) => {
  try {
    const parsed = CreateReviewSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const data = parsed.data;
    const r    = req.tenant;

    if (data.order_id) {
      const exists = await diningRepo.verifyOrderTenant(r.tenant_id, data.order_id);
      if (!exists) return res.status(400).json({ error: 'Order not found' });
    }

    await diningRepo.insertReview(r.tenant_id, {
      orderId:   data.order_id,
      sessionId: data.session_id,
      stars:     data.stars,
      feedback:  data.feedback,
    });

    events.emit('review.submitted', {
      tenantId: r.tenant_id,
      stars:    data.stars,
      orderId:  data.order_id ?? null,
    });

    const threshold      = r.review_threshold ?? 4;
    const aboveThreshold = data.stars >= threshold;

    res.status(201).json({
      ok:                true,
      above_threshold:   aboveThreshold,
      google_review_url: aboveThreshold ? (r.google_review_url || null) : null,
    });
  } catch (err) { next(err); }
});

module.exports = router;
