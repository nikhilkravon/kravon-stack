'use strict';

const bcrypt             = require('bcryptjs');
const { query, getClient } = require('../../db/pool');
const { encrypt }        = require('../../utils/crypto');

const SYSTEM_ROLES = [
  { name: 'owner',    display_name: 'Owner',         description: 'Full platform access. Can manage staff, billing, and all settings.' },
  { name: 'manager',  display_name: 'Manager',        description: 'Operational access. Cannot manage staff or billing.' },
  { name: 'cashier',  display_name: 'Cashier',        description: 'Order management and payment view.' },
  { name: 'kitchen',  display_name: 'Kitchen Staff',  description: 'Kitchen display view. Can update order status.' },
  { name: 'host',     display_name: 'Host / Captain', description: 'Reservations, tables, and dine-in sessions.' },
  { name: 'catering', display_name: 'Catering Staff', description: 'Catering leads and events only.' },
];

async function listRestaurants() {
  const res = await query(
    `SELECT id, slug, name,
            has_presence, has_tables, has_orders, has_catering, has_insights,
            plan, status, created_at
     FROM tenant.restaurants
     WHERE deleted_at IS NULL
     ORDER BY created_at`
  );
  return res.rows;
}

async function createRestaurant(d) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const settings = {
      ...(d.tagline             && { tagline:             d.tagline             }),
      ...(d.year                && { year:                d.year                }),
      ...(d.email               && { email:               d.email               }),
      ...(d.delivery_zone       && { delivery_zone:       d.delivery_zone       }),
      ...(d.hours_display       && { hours_display:       d.hours_display       }),
      ...(d.open_until          && { open_until:          d.open_until          }),
      ...(d.review_threshold    != null && { review_threshold:    d.review_threshold    }),
      ...(d.google_review_url   && { google_review_url:   d.google_review_url   }),
      ...(d.delivery_fee        != null && { delivery_fee:        d.delivery_fee        }),
      ...(d.free_delivery_above != null && { free_delivery_above: d.free_delivery_above }),
      ...(d.domain              && { domain:              d.domain              }),
      ...(d.map_url             && { map_url:             d.map_url             }),
      ...(d.webhook_url         && { webhook_url:         d.webhook_url         }),
    };

    const tenantRes = await client.query(`
      INSERT INTO tenant.restaurants (
        slug, name, plan, status,
        has_presence, has_tables, has_orders, has_catering, has_insights,
        settings
      ) VALUES ($1,$2,$3,'active',$4,$5,$6,$7,$8,$9)
      RETURNING id, slug
    `, [
      d.slug, d.name,
      d.plan         ?? 'presence',
      d.has_presence ?? true,
      d.has_tables   ?? false,
      d.has_orders   ?? false,
      d.has_catering ?? false,
      d.has_insights ?? false,
      JSON.stringify(settings),
    ]);

    const tenantId = tenantRes.rows[0].id;

    for (const role of SYSTEM_ROLES) {
      await client.query(
        `INSERT INTO tenant.roles (tenant_id, name, display_name, description, is_system_role, is_active)
         VALUES ($1, $2, $3, $4, TRUE, TRUE)
         ON CONFLICT (tenant_id, name) DO NOTHING`,
        [tenantId, role.name, role.display_name, role.description]
      );
    }

    if (d.phone || d.address || d.city) {
      await client.query(
        `INSERT INTO tenant.locations (tenant_id, name, address, city, phone, is_active)
         VALUES ($1, 'Main', $2, $3, $4, true)`,
        [tenantId, d.address ?? null, d.city ?? null, d.phone ?? null]
      );
    }

    if (d.razorpay_key_id && d.razorpay_key_secret) {
      await client.query(
        `INSERT INTO tenant.integrations (tenant_id, provider, config, is_active)
         VALUES ($1, 'razorpay', $2, true)`,
        [tenantId, JSON.stringify({ key_id: d.razorpay_key_id, key_secret: encrypt(d.razorpay_key_secret) })]
      );
    }

    if (d.wa_number) {
      await client.query(
        `INSERT INTO brand.contact_links (tenant_id, platform, url, display_label, position)
         VALUES ($1, 'whatsapp', $2, 'WhatsApp', 1)`,
        [tenantId, `https://wa.me/${d.wa_number}`]
      );
    }

    if (d.tagline) {
      await client.query(
        `INSERT INTO brand.seo (tenant_id, meta_title, meta_description) VALUES ($1, $2, $3)`,
        [tenantId, d.name, d.tagline]
      );
    }

    await client.query('COMMIT');
    return { id: tenantId, slug: d.slug };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function updateRestaurant(slug, d) {
  const tenantRes = await query(
    'SELECT id, settings FROM tenant.restaurants WHERE slug = $1 AND deleted_at IS NULL LIMIT 1',
    [slug]
  );
  if (!tenantRes.rows.length) return null;

  const tenantId = tenantRes.rows[0].id;

  const SETTINGS_FIELDS = [
    'tagline','year','email','delivery_zone','hours_display','open_until','accepts_orders',
    'review_threshold','google_review_url',
    'delivery_fee','free_delivery_above','domain','map_url','webhook_url',
  ];
  const settingsPatch = {};
  for (const f of SETTINGS_FIELDS) {
    if (d[f] !== undefined) settingsPatch[f] = d[f];
  }

  const sets = []; const values = []; let idx = 1;
  if (d.name         !== undefined) { sets.push(`name = $${idx++}`);         values.push(d.name); }
  if (d.has_presence !== undefined) { sets.push(`has_presence = $${idx++}`); values.push(d.has_presence); }
  if (d.has_tables   !== undefined) { sets.push(`has_tables = $${idx++}`);   values.push(d.has_tables); }
  if (d.has_orders   !== undefined) { sets.push(`has_orders = $${idx++}`);   values.push(d.has_orders); }
  if (d.has_catering !== undefined) { sets.push(`has_catering = $${idx++}`); values.push(d.has_catering); }
  if (d.has_insights !== undefined) { sets.push(`has_insights = $${idx++}`); values.push(d.has_insights); }
  if (d.plan         !== undefined) { sets.push(`plan = $${idx++}`);         values.push(d.plan); }
  if (Object.keys(settingsPatch).length) {
    sets.push(`settings = settings || $${idx++}`);
    values.push(JSON.stringify(settingsPatch));
  }

  if (sets.length) {
    sets.push('updated_at = NOW()');
    values.push(tenantId);
    await query(`UPDATE tenant.restaurants SET ${sets.join(', ')} WHERE id = $${idx}`, values);
  }

  if (d.phone !== undefined || d.address !== undefined || d.city !== undefined) {
    const locRes = await query(
      'SELECT id FROM tenant.locations WHERE tenant_id = $1 AND is_active = TRUE LIMIT 1',
      [tenantId]
    );
    if (locRes.rows.length) {
      const locSets = []; const locValues = []; let li = 1;
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
        `INSERT INTO tenant.locations (tenant_id, name, address, city, phone, is_active) VALUES ($1,'Main',$2,$3,$4,true)`,
        [tenantId, d.address ?? null, d.city ?? null, d.phone ?? null]
      );
    }
  }

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
          `INSERT INTO tenant.integrations (tenant_id, provider, config, is_active) VALUES ($1,'razorpay',$2,true)`,
          [tenantId, JSON.stringify({ key_id: keyId, key_secret: keySecret })]
        );
      }
    }
  }

  return { id: tenantId, slug };
}

async function createOwnerStaff(slug, { name, email, password, phone }) {
  const tenantRes = await query(
    'SELECT id FROM tenant.restaurants WHERE slug = $1 AND deleted_at IS NULL LIMIT 1',
    [slug]
  );
  if (!tenantRes.rows.length) return null;

  const tenantId     = tenantRes.rows[0].id;
  const passwordHash = await bcrypt.hash(password, 12);

  const staffRes = await query(
    `INSERT INTO tenant.staff (tenant_id, name, email, phone, password_hash, auth_provider, is_active)
     VALUES ($1, $2, $3, $4, $5, 'email', true)
     RETURNING id, name, email`,
    [tenantId, name, email, phone ?? null, passwordHash]
  );
  const staffId = staffRes.rows[0].id;

  const ownerRoleRes = await query(
    `SELECT id FROM tenant.roles WHERE tenant_id = $1 AND name = 'owner' LIMIT 1`,
    [tenantId]
  );
  if (ownerRoleRes.rows.length) {
    await query(
      `INSERT INTO tenant.staff_roles (tenant_id, staff_id, role_id) VALUES ($1,$2,$3)
       ON CONFLICT (staff_id, role_id) DO NOTHING`,
      [tenantId, staffId, ownerRoleRes.rows[0].id]
    );
  }

  return { ...staffRes.rows[0], roles: ['owner'] };
}

async function updateSettings(tenantId, d) {
  const { name, phone, address, city, wa_number, razorpay_key_id, razorpay_key_secret, ...settingsFields } = d;

  const setClauses = []; const values = []; let idx = 1;
  if (name !== undefined) {
    setClauses.push(`name = $${idx++}`);
    values.push(name);
  }
  if (Object.keys(settingsFields).length) {
    setClauses.push(`settings = settings || $${idx++}::jsonb`);
    values.push(JSON.stringify(settingsFields));
  }
  if (setClauses.length) {
    setClauses.push('updated_at = NOW()');
    values.push(tenantId);
    await query(
      `UPDATE tenant.restaurants SET ${setClauses.join(', ')} WHERE id = $${idx} AND deleted_at IS NULL`,
      values
    );
  }

  if (phone !== undefined || address !== undefined || city !== undefined) {
    const locRes = await query(
      'SELECT id FROM tenant.locations WHERE tenant_id = $1 AND is_active = TRUE LIMIT 1',
      [tenantId]
    );
    const locSets = []; const locVals = []; let li = 1;
    if (phone   !== undefined) { locSets.push(`phone = $${li++}`);   locVals.push(phone); }
    if (address !== undefined) { locSets.push(`address = $${li++}`); locVals.push(address); }
    if (city    !== undefined) { locSets.push(`city = $${li++}`);    locVals.push(city); }
    if (locRes.rows.length) {
      locVals.push(locRes.rows[0].id);
      await query(
        `UPDATE tenant.locations SET ${locSets.join(', ')}, updated_at = NOW() WHERE id = $${li}`,
        locVals
      );
    } else {
      await query(
        `INSERT INTO tenant.locations (tenant_id, name, address, city, phone, is_active) VALUES ($1,'Main',$2,$3,$4,true)`,
        [tenantId, address ?? null, city ?? null, phone ?? null]
      );
    }
  }

  if (wa_number !== undefined) {
    const waUrl = `https://wa.me/${wa_number}`;
    const existing = await query(
      `SELECT id FROM brand.contact_links WHERE tenant_id = $1 AND platform = 'whatsapp' AND deleted_at IS NULL LIMIT 1`,
      [tenantId]
    );
    if (existing.rows.length) {
      await query(
        `UPDATE brand.contact_links SET url = $1, updated_at = NOW() WHERE id = $2`,
        [waUrl, existing.rows[0].id]
      );
    } else {
      await query(
        `INSERT INTO brand.contact_links (tenant_id, platform, url, display_label, position) VALUES ($1,'whatsapp',$2,'WhatsApp',1)`,
        [tenantId, waUrl]
      );
    }
  }

  if (razorpay_key_id !== undefined || razorpay_key_secret !== undefined) {
    const existingInteg = await query(
      `SELECT id, config FROM tenant.integrations WHERE tenant_id = $1 AND provider = 'razorpay' AND deleted_at IS NULL LIMIT 1`,
      [tenantId]
    );
    const keyId     = razorpay_key_id     ?? existingInteg.rows[0]?.config?.key_id;
    const rawSecret = razorpay_key_secret ?? null;
    const keySecret = rawSecret ? encrypt(rawSecret) : existingInteg.rows[0]?.config?.key_secret;
    if (keyId && keySecret) {
      if (existingInteg.rows.length) {
        await query(
          `UPDATE tenant.integrations SET config = $1, updated_at = NOW() WHERE id = $2`,
          [JSON.stringify({ key_id: keyId, key_secret: keySecret }), existingInteg.rows[0].id]
        );
      } else {
        await query(
          `INSERT INTO tenant.integrations (tenant_id, provider, config, is_active) VALUES ($1,'razorpay',$2,true)`,
          [tenantId, JSON.stringify({ key_id: keyId, key_secret: keySecret })]
        );
      }
    }
  }
}

async function updateLocationCoords(tenantId, lat, lng) {
  const locRow = await query(
    'SELECT id FROM tenant.locations WHERE tenant_id = $1 AND is_active = TRUE LIMIT 1',
    [tenantId]
  );
  if (locRow.rows.length) {
    await query(
      'UPDATE tenant.locations SET lat = $1, lng = $2, updated_at = NOW() WHERE id = $3',
      [lat, lng, locRow.rows[0].id]
    );
  } else {
    await query(
      'INSERT INTO tenant.locations (tenant_id, name, lat, lng, is_active) VALUES ($1, $2, $3, $4, true)',
      [tenantId, 'Main', lat, lng]
    );
  }
}

module.exports = {
  listRestaurants, createRestaurant, updateRestaurant,
  createOwnerStaff, updateSettings, updateLocationCoords,
};
