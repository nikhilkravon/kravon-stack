/**
 * ROUTE — settings.js
 * POST /v1/restaurants/:slug/settings/export  — full tenant data export (owner/admin only)
 *
 * Returns structured JSON containing all restaurant-owned data:
 * customers, orders, reservations, catering leads, menu, settings.
 * Explicitly excludes: platform benchmarks, cross-tenant data, recommendation models.
 *
 * Export is synchronous and inline (JSON response). Async/email delivery is a future upgrade.
 */

'use strict';

const express = require('express');
const { query } = require('../../db/pool');
const { requireRestaurantAuth, requireRole } = require('../middleware/auth');
const audit  = require('../../utils/audit');
const events = require('../../utils/events');

const router = express.Router();
router.use(requireRestaurantAuth);

/* ── POST /settings/export ───────────────────────────────────────────────── */
router.post('/export', requireRole('owner', 'admin'), async (req, res, next) => {
  const tenantId = req.tenant.tenant_id;
  const staffId  = req.auth.staffId;
  let jobId;

  try {
    // Record the export job
    const jobRes = await query(
      `INSERT INTO platform.export_jobs (tenant_id, export_type, status, requested_by)
       VALUES ($1, 'full', 'processing', $2)
       RETURNING id`,
      [tenantId, staffId]
    );
    jobId = jobRes.rows[0].id;

    // Run all export queries in parallel
    const [
      customersRes,
      ordersRes,
      reservationsRes,
      cateringRes,
      menuCategoriesRes,
      menuItemsRes,
      settingsRes,
      brandRes,
    ] = await Promise.all([
      query(
        `SELECT id, name, phone, email, preferred_name, date_of_birth, anniversary,
                dietary_pref, tags, notes, sms_consent, email_consent, whatsapp_consent,
                created_at
         FROM customer.customers
         WHERE tenant_id = $1 AND deleted_at IS NULL
         ORDER BY created_at DESC
         LIMIT 10000`,
        [tenantId]
      ),
      query(
        `SELECT o.id, o.channel, o.fulfillment_type, o.status, o.total_amount,
                o.created_at, c.name AS customer_name, c.phone AS customer_phone
         FROM orders.orders o
         LEFT JOIN customer.customers c ON c.id = o.customer_id
         WHERE o.tenant_id = $1 AND o.deleted_at IS NULL
         ORDER BY o.created_at DESC
         LIMIT 50000`,
        [tenantId]
      ),
      query(
        `SELECT id, customer_id, party_size, reservation_time,
                status, occasion, dietary_notes, notes, created_at
         FROM dining.reservations
         WHERE tenant_id = $1 AND deleted_at IS NULL
         ORDER BY reservation_time DESC`,
        [tenantId]
      ),
      query(
        `SELECT id, contact_name, contact_phone, contact_email, event_type,
                guest_count_min, guest_count_max, preferred_date_from,
                preferred_date_to, status, created_at
         FROM catering.leads
         WHERE tenant_id = $1 AND deleted_at IS NULL
         ORDER BY created_at DESC`,
        [tenantId]
      ),
      query(
        `SELECT id, name, description, sort_order, is_active
         FROM menu.categories
         WHERE tenant_id = $1 AND deleted_at IS NULL
         ORDER BY sort_order`,
        [tenantId]
      ),
      query(
        `SELECT i.id, i.category_id, i.name, i.description, i.price,
                i.food_type, i.is_available, i.sort_order
         FROM menu.menu_items i
         JOIN menu.categories c ON c.id = i.category_id
         WHERE i.tenant_id = $1 AND i.deleted_at IS NULL
         ORDER BY i.sort_order`,
        [tenantId]
      ),
      query(
        `SELECT name, slug, settings, plan, has_orders, has_tables,
                has_catering, has_insights, created_at
         FROM tenant.restaurants
         WHERE id = $1`,
        [tenantId]
      ),
      query(
        `SELECT
           (SELECT url FROM brand.assets WHERE tenant_id = $1 AND type = 'logo' AND deleted_at IS NULL LIMIT 1) AS logo_url,
           (SELECT url FROM brand.assets WHERE tenant_id = $1 AND type = 'banner' AND deleted_at IS NULL LIMIT 1) AS banner_url,
           t.primary_color, t.accent_color, t.font_heading, t.font_body
         FROM brand.themes t WHERE t.tenant_id = $1`,
        [tenantId]
      ),
    ]);

    // Build structured menu with items nested under categories
    const itemsByCategory = {};
    for (const item of menuItemsRes.rows) {
      (itemsByCategory[item.category_id] ||= []).push(item);
    }
    const menu = menuCategoriesRes.rows.map(cat => ({
      ...cat,
      items: itemsByCategory[cat.id] || [],
    }));

    // Mark job done
    await query(
      `UPDATE platform.export_jobs
       SET status = 'done', completed_at = NOW()
       WHERE id = $1`,
      [jobId]
    );

    audit.log(null, {
      tenantId,
      actorId: staffId,
      actorType: 'staff',
      action: 'settings.export',
      entityType: 'platform.export_jobs',
      entityId: jobId,
      req,
    });

    events.emit('settings.exported', { tenantId, jobId, actorId: staffId });

    const tenant = settingsRes.rows[0];
    res.json({
      ok:          true,
      jobId,
      generatedAt: new Date().toISOString(),
      tenant:      tenant?.slug || null,
      exportType:  'full',
      version:     1,
      ownership:   'restaurant',
      data: {
        customers:    customersRes.rows,
        orders:       ordersRes.rows.map(r => ({ ...r, total_amount: Number(r.total_amount) })),
        reservations: reservationsRes.rows,
        catering:     cateringRes.rows,
        menu,
        settings:     tenant || null,
        brand:        brandRes.rows[0] || null,
      },
    });
  } catch (err) {
    // Mark job failed if it was created
    if (jobId) {
      query(
        `UPDATE platform.export_jobs SET status = 'failed', completed_at = NOW() WHERE id = $1`,
        [jobId]
      ).catch(() => {});
    }
    next(err);
  }
});

module.exports = router;
