/**
 * ROUTE — admin.js
 * POST /v1/admin/restaurants         — onboard new restaurant
 * PUT  /v1/admin/restaurants/:slug   — update restaurant
 * GET  /v1/admin/restaurants         — list all restaurants
 * POST /v1/admin/staff               — create staff member with email+password
 *
 * Protected by a single ADMIN_API_KEY header.
 * Uses v12 schema: tenant.restaurants + tenant.locations + tenant.integrations + brand.*
 */

'use strict';

const express    = require('express');
const bcrypt     = require('bcryptjs');
const { z }      = require('zod');
const { query, getClient }  = require('../../db/pool');
const { encrypt } = require('../../utils/crypto');
const { validateSettingsPatch } = require('../../db/settingsSchema');

const router = express.Router();

function requireAdminKey(req, res, next) {
  const key = req.headers['x-kravon-admin-key'];
  if (!key || key !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

router.use(requireAdminKey);

const SlugSchema = z.string()
  .min(2).max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be lowercase alphanumeric with hyphens only');

const CreateRestaurantSchema = z.object({
  slug:               SlugSchema,
  name:               z.string().min(1).max(120),
  tagline:            z.string().max(300).optional(),
  year:               z.string().max(4).optional(),
  phone:              z.string().max(30).optional(),
  wa_number:          z.string().regex(/^\d{10,15}$/, 'wa_number must be digits only, 10–15 chars').optional(),
  email:              z.string().email().max(120).optional(),
  address:            z.string().max(500).optional(),
  city:               z.string().max(100).optional(),
  delivery_zone:      z.string().max(200).optional(),
  hours_display:      z.string().max(100).optional(),
  open_until:         z.string().max(40).optional(),
  accepts_orders:     z.boolean().optional(),
  has_presence:       z.boolean().optional(),
  has_tables:         z.boolean().optional(),
  has_orders:         z.boolean().optional(),
  has_catering:       z.boolean().optional(),
  has_insights:       z.boolean().optional(),
  razorpay_key_id:    z.string().max(40).optional(),
  razorpay_key_secret:z.string().max(200).optional(),
  review_threshold:   z.number().int().min(1).max(5).optional(),
  google_review_url:  z.string().url().max(300).optional(),
  webhook_url:        z.string().url().max(300).optional(),
  delivery_fee:       z.number().min(0).optional(),          // rupees
  free_delivery_above:z.number().min(0).optional(),          // rupees
  domain:             z.string().max(200).optional(),
  map_url:            z.string().url().max(500).optional(),
  plan:               z.enum(['starter', 'growth', 'pro', 'enterprise']).optional(),
});

const UpdateRestaurantSchema = CreateRestaurantSchema.partial().omit({ slug: true });

/* ── GET /restaurants ────────────────────────────────────────────────────── */
router.get('/restaurants', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, slug, name,
              has_presence, has_tables, has_orders, has_catering, has_insights,
              plan, status, created_at
       FROM tenant.restaurants
       WHERE deleted_at IS NULL
       ORDER BY created_at`
    );
    res.json({ ok: true, restaurants: result.rows });
  } catch (err) { next(err); }
});

/* ── POST /restaurants ───────────────────────────────────────────────────── */
router.post('/restaurants', async (req, res, next) => {
  const client = await getClient();
  try {
    const parsed = CreateRestaurantSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const d = parsed.data;
    await client.query('BEGIN');

    // Build settings JSONB for operational fields without dedicated columns
    const settings = {
      ...(d.tagline            && { tagline:            d.tagline            }),
      ...(d.year               && { year:               d.year               }),
      ...(d.email              && { email:              d.email              }),
      ...(d.delivery_zone      && { delivery_zone:      d.delivery_zone      }),
      ...(d.hours_display      && { hours_display:      d.hours_display      }),
      ...(d.open_until         && { open_until:         d.open_until         }),
      ...(d.review_threshold   != null && { review_threshold:   d.review_threshold   }),
      ...(d.google_review_url  && { google_review_url:  d.google_review_url  }),
      ...(d.delivery_fee       != null && { delivery_fee:       d.delivery_fee       }),
      ...(d.free_delivery_above!= null && { free_delivery_above:d.free_delivery_above }),
      ...(d.domain             && { domain:             d.domain             }),
      ...(d.map_url            && { map_url:            d.map_url            }),
      ...(d.webhook_url        && { webhook_url:        d.webhook_url        }),
    };

    // Insert into tenant.restaurants
    const tenantRes = await client.query(`
      INSERT INTO tenant.restaurants (
        slug, name, plan, status,
        has_presence, has_tables, has_orders, has_catering, has_insights,
        settings
      ) VALUES ($1,$2,$3,'active',$4,$5,$6,$7,$8,$9)
      RETURNING id, slug
    `, [
      d.slug, d.name,
      d.plan      ?? 'presence',
      d.has_presence ?? true,
      d.has_tables   ?? false,
      d.has_orders   ?? false,
      d.has_catering ?? false,
      d.has_insights ?? false,
      JSON.stringify(settings),
    ]);

    const tenantId = tenantRes.rows[0].id;

    // Seed the six system roles for this tenant
    const SYSTEM_ROLES = [
      { name: 'owner',    display_name: 'Owner',         description: 'Full platform access. Can manage staff, billing, and all settings.' },
      { name: 'manager',  display_name: 'Manager',        description: 'Operational access. Cannot manage staff or billing.' },
      { name: 'cashier',  display_name: 'Cashier',        description: 'Order management and payment view.' },
      { name: 'kitchen',  display_name: 'Kitchen Staff',  description: 'Kitchen display view. Can update order status.' },
      { name: 'host',     display_name: 'Host / Captain', description: 'Reservations, tables, and dine-in sessions.' },
      { name: 'catering', display_name: 'Catering Staff', description: 'Catering leads and events only.' },
    ];
    for (const role of SYSTEM_ROLES) {
      await client.query(
        `INSERT INTO tenant.roles (tenant_id, name, display_name, description, is_system_role, is_active)
         VALUES ($1, $2, $3, $4, TRUE, TRUE)
         ON CONFLICT (tenant_id, name) DO NOTHING`,
        [tenantId, role.name, role.display_name, role.description]
      );
    }

    // Insert location if any contact fields provided
    if (d.phone || d.address || d.city) {
      await client.query(`
        INSERT INTO tenant.locations (tenant_id, name, address, city, phone, is_active)
        VALUES ($1, 'Main', $2, $3, $4, true)
      `, [tenantId, d.address ?? null, d.city ?? null, d.phone ?? null]);
    }

    // Insert Razorpay integration if keys provided
    if (d.razorpay_key_id && d.razorpay_key_secret) {
      const encryptedSecret = encrypt(d.razorpay_key_secret);
      await client.query(`
        INSERT INTO tenant.integrations (tenant_id, provider, config, is_active)
        VALUES ($1, 'razorpay', $2, true)
      `, [tenantId, JSON.stringify({ key_id: d.razorpay_key_id, key_secret: encryptedSecret })]);
    }

    // Insert WhatsApp contact link if wa_number provided
    if (d.wa_number) {
      await client.query(`
        INSERT INTO brand.contact_links (tenant_id, platform, url, display_label, position)
        VALUES ($1, 'whatsapp', $2, 'WhatsApp', 1)
      `, [tenantId, `https://wa.me/${d.wa_number}`]);
    }

    // Insert SEO row with tagline as meta_description
    if (d.tagline) {
      await client.query(`
        INSERT INTO brand.seo (tenant_id, meta_title, meta_description)
        VALUES ($1, $2, $3)
      `, [tenantId, d.name, d.tagline]);
    }

    await client.query('COMMIT');
    res.status(201).json({ ok: true, restaurant: { id: tenantId, slug: d.slug } });

  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A restaurant with this slug already exists.' });
    }
    next(err);
  } finally {
    client.release();
  }
});

/* ── PUT /restaurants/:slug ──────────────────────────────────────────────── */
router.put('/restaurants/:slug', async (req, res, next) => {
  try {
    const slug   = req.params.slug;
    const parsed = UpdateRestaurantSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const d = parsed.data;
    if (Object.keys(d).length === 0) {
      return res.status(400).json({ error: 'No fields provided to update.' });
    }

    const tenantRes = await query(
      'SELECT id, settings FROM tenant.restaurants WHERE slug = $1 AND deleted_at IS NULL LIMIT 1',
      [slug]
    );
    if (!tenantRes.rows.length) {
      return res.status(404).json({ error: 'Restaurant not found.' });
    }

    const tenantId       = tenantRes.rows[0].id;
    const existingSettings = tenantRes.rows[0].settings || {};

    // Merge new settings fields
    const settingsPatch = {};
    const SETTINGS_FIELDS = [
      'tagline','year','email','delivery_zone','hours_display','open_until','accepts_orders',
      'review_threshold','google_review_url',
      'delivery_fee','free_delivery_above','domain','map_url','webhook_url',
    ];
    for (const f of SETTINGS_FIELDS) {
      if (d[f] !== undefined) settingsPatch[f] = d[f];
    }

    // Update tenant.restaurants flags/name/plan
    const sets   = [];
    const values = [];
    let   idx    = 1;
    if (d.name         !== undefined) { sets.push(`name = $${idx++}`);         values.push(d.name); }
    if (d.has_presence !== undefined) { sets.push(`has_presence = $${idx++}`); values.push(d.has_presence); }
    if (d.has_tables   !== undefined) { sets.push(`has_tables = $${idx++}`);   values.push(d.has_tables); }
    if (d.has_orders   !== undefined) { sets.push(`has_orders = $${idx++}`);   values.push(d.has_orders); }
    if (d.has_catering !== undefined) { sets.push(`has_catering = $${idx++}`); values.push(d.has_catering); }
    if (d.has_insights !== undefined) { sets.push(`has_insights = $${idx++}`); values.push(d.has_insights); }
    if (d.plan         !== undefined) { sets.push(`plan = $${idx++}`);         values.push(d.plan); }

    if (Object.keys(settingsPatch).length) {
      const unknown = validateSettingsPatch(settingsPatch);
      if (unknown.length) {
        return res.status(422).json({ error: `Unknown settings keys: ${unknown.join(', ')}` });
      }
      sets.push(`settings = settings || $${idx++}`);
      values.push(JSON.stringify(settingsPatch));
    }

    if (sets.length) {
      sets.push(`updated_at = NOW()`);
      values.push(tenantId);
      await query(
        `UPDATE tenant.restaurants SET ${sets.join(', ')} WHERE id = $${idx}`,
        values
      );
    }

    // Update location if contact fields changed
    if (d.phone !== undefined || d.address !== undefined || d.city !== undefined) {
      const locRes = await query(
        'SELECT id FROM tenant.locations WHERE tenant_id = $1 AND is_active = TRUE LIMIT 1',
        [tenantId]
      );
      if (locRes.rows.length) {
        const locSets   = [];
        const locValues = [];
        let   li        = 1;
        if (d.phone   !== undefined) { locSets.push(`phone = $${li++}`);   locValues.push(d.phone); }
        if (d.address !== undefined) { locSets.push(`address = $${li++}`); locValues.push(d.address); }
        if (d.city    !== undefined) { locSets.push(`city = $${li++}`);    locValues.push(d.city); }
        locValues.push(locRes.rows[0].id);
        await query(
          `UPDATE tenant.locations SET ${locSets.join(', ')}, updated_at = NOW() WHERE id = $${li}`,
          locValues
        );
      } else {
        await query(
          `INSERT INTO tenant.locations (tenant_id, name, address, city, phone, is_active)
           VALUES ($1, 'Main', $2, $3, $4, true)`,
          [tenantId, d.address ?? null, d.city ?? null, d.phone ?? null]
        );
      }
    }

    // Upsert Razorpay integration if keys changed
    if (d.razorpay_key_id !== undefined || d.razorpay_key_secret !== undefined) {
      const existingInteg = await query(
        `SELECT id, config FROM tenant.integrations
         WHERE tenant_id = $1 AND provider = 'razorpay' AND deleted_at IS NULL LIMIT 1`,
        [tenantId]
      );
      const keyId     = d.razorpay_key_id     ?? existingInteg.rows[0]?.config?.key_id;
      const rawSecret = d.razorpay_key_secret ?? null;
      const keySecret = rawSecret ? encrypt(rawSecret) : existingInteg.rows[0]?.config?.key_secret;

      if (keyId && keySecret) {
        if (existingInteg.rows.length) {
          await query(
            `UPDATE tenant.integrations SET config = $1, updated_at = NOW() WHERE id = $2`,
            [JSON.stringify({ key_id: keyId, key_secret: keySecret }), existingInteg.rows[0].id]
          );
        } else {
          await query(
            `INSERT INTO tenant.integrations (tenant_id, provider, config, is_active)
             VALUES ($1, 'razorpay', $2, true)`,
            [tenantId, JSON.stringify({ key_id: keyId, key_secret: keySecret })]
          );
        }
      }
    }

    res.json({ ok: true, restaurant: { id: tenantId, slug } });
  } catch (err) { next(err); }
});

/* ── POST /staff ─────────────────────────────────────────────────────────── */
const CreateStaffSchema = z.object({
  slug:     z.string().min(2).max(80),
  name:     z.string().min(1).max(120),
  email:    z.string().email().max(120),
  password: z.string().min(8).max(200),
  phone:    z.string().max(30).optional(),
});

router.post('/staff', async (req, res, next) => {
  try {
    const parsed = CreateStaffSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const { slug, name, email, password, phone } = parsed.data;

    const tenantResult = await query(
      'SELECT id FROM tenant.restaurants WHERE slug = $1 AND deleted_at IS NULL LIMIT 1',
      [slug]
    );
    if (!tenantResult.rows.length) {
      return res.status(404).json({ error: 'Restaurant not found.' });
    }
    const tenantId = tenantResult.rows[0].id;

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await query(
      `INSERT INTO tenant.staff (tenant_id, name, email, phone, password_hash, auth_provider, is_active)
       VALUES ($1, $2, $3, $4, $5, 'email', true)
       RETURNING id, name, email`,
      [tenantId, name, email, phone ?? null, passwordHash]
    );

    const staffId = result.rows[0].id;

    // Assign owner role — admin-created staff are always owners
    const ownerRoleRes = await query(
      `SELECT id FROM tenant.roles WHERE tenant_id = $1 AND name = 'owner' LIMIT 1`,
      [tenantId]
    );
    if (ownerRoleRes.rows.length) {
      await query(
        `INSERT INTO tenant.staff_roles (tenant_id, staff_id, role_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (staff_id, role_id) DO NOTHING`,
        [tenantId, staffId, ownerRoleRes.rows[0].id]
      );
    }

    res.status(201).json({ ok: true, staff: { ...result.rows[0], roles: ['owner'] } });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A staff member with this email already exists for this restaurant.' });
    }
    next(err);
  }
});

module.exports = router;
