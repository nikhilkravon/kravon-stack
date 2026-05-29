/**
 * ROUTE — reviews.js
 * POST /v1/restaurants/:slug/reviews
 *
 * Captures post-order star ratings from the Tables product.
 * Private below threshold, routes to Google above threshold.
 * Uses v12 schema: dining.reviews.
 */

'use strict';

const express = require('express');
const { z }   = require('zod');
const { query } = require('../../db/pool');

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

    // Verify order belongs to this tenant if supplied
    if (data.order_id) {
      const check = await query(
        'SELECT id FROM orders.orders WHERE id=$1::uuid AND tenant_id=$2',
        [data.order_id, r.tenant_id]
      );
      if (!check.rows.length) {
        return res.status(400).json({ error: 'Order not found' });
      }
    }

    await query(`
      INSERT INTO dining.reviews (tenant_id, order_id, session_id, rating, comment, source)
      VALUES ($1, $2, $3, $4, $5, 'web')
    `, [
      r.tenant_id,
      data.order_id   || null,
      data.session_id || null,
      data.stars,
      data.feedback   || null,
    ]);

    const threshold     = r.review_threshold ?? 4;
    const aboveThreshold = data.stars >= threshold;

    res.status(201).json({
      ok:                true,
      above_threshold:   aboveThreshold,
      google_review_url: aboveThreshold ? (r.google_review_url || null) : null,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
