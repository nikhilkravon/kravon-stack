'use strict';

const { query, getClient } = require('../../db/pool');

const SOCIAL_PLATFORMS = ['instagram', 'facebook', 'google', 'zomato', 'swiggy', 'tripadvisor', 'youtube', 'twitter'];

async function getContent(tenant) {
  const r    = tenant;
  const s    = r._settings  || {};
  const pres = s.presence   || {};
  const st   = pres.story   || {};

  const linksRes = await query(
    `SELECT platform, url FROM brand.contact_links
     WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY position`,
    [r.tenant_id]
  );

  const socialLinks = {};
  for (const platform of SOCIAL_PLATFORMS) {
    const row = linksRes.rows.find(l => l.platform === platform);
    socialLinks[platform] = row?.url || '';
  }

  return {
    basics: {
      name:         r.name          || '',
      tagline:      r.tagline       || '',
      city:         r.city          || '',
      hours:        s.hours_display || '',
      deliveryZone: s.delivery_zone || '',
    },
    contact: {
      phone:         r.phone     || '',
      whatsapp:      r.wa_number || '',
      email:         r.email     || '',
      address:       r.address   || '',
      googleMapsUrl: s.map_url   || '',
    },
    social: socialLinks,
    branding: {
      logoUrl:   r.logo_url   || '',
      heroImage: r.hero_image || '',
    },
    hero: {
      headline:    r.name       || '',
      subheadline: r.tagline    || '',
      heroImage:   r.hero_image || '',
    },
    story: {
      title: st.headline || s.story_headline || '',
      body:  Array.isArray(st.body || s.story_body)
        ? (st.body || s.story_body || []).join('\n\n')
        : '',
      image: r.story_image || '',
    },
    gallery:         r.gallery          || { food: [], ambience: [], people: [] },
    featured:        r.featured         || [],
    signatureDishes: pres.signature_dishes || s.signature_dishes || [],
    timeline:        pres.timeline         || s.timeline         || [],
  };
}

async function updateContent(tenantId, body) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await _updateContentTx(client, tenantId, body);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function _updateContentTx(client, tenantId, body) {
  // Alias so all existing query() calls work with the transaction client
  const q = (sql, params) => client.query(sql, params);

  const settingsRes = await q(
    'SELECT settings FROM tenant.restaurants WHERE id = $1 AND deleted_at IS NULL',
    [tenantId]
  );
  const currentSettings = settingsRes.rows[0]?.settings || {};
  const currentPresence = currentSettings.presence || {};

  const parallelOps   = [];
  let   presencePatch = null;

  if (body.basics) {
    const b = body.basics;
    if (b.name !== undefined) {
      parallelOps.push(q(
        `UPDATE tenant.restaurants SET name = $1, updated_at = NOW() WHERE id = $2`,
        [b.name, tenantId]
      ));
    }
    const restPatch = {};
    if (b.tagline      !== undefined) restPatch.tagline       = b.tagline;
    if (b.hours        !== undefined) restPatch.hours_display  = b.hours;
    if (b.deliveryZone !== undefined) restPatch.delivery_zone  = b.deliveryZone;
    if (b.city         !== undefined) {
      restPatch.city = b.city;
      parallelOps.push(q(
        `UPDATE tenant.locations SET city = $1, updated_at = NOW()
         WHERE tenant_id = $2 AND is_active = TRUE AND deleted_at IS NULL`,
        [b.city, tenantId]
      ));
    }
    if (Object.keys(restPatch).length) {
      parallelOps.push(q(
        `UPDATE tenant.restaurants SET settings = settings || $1::jsonb, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(restPatch), tenantId]
      ));
    }
  }

  if (body.contact) {
    const c = body.contact;
    if (c.phone !== undefined || c.address !== undefined) {
      const locPatch = {};
      if (c.phone   !== undefined) locPatch.phone   = c.phone;
      if (c.address !== undefined) locPatch.address = c.address;
      const sets = Object.keys(locPatch).map((k, i) => `${k} = $${i + 2}`).join(', ');
      parallelOps.push(q(
        `UPDATE tenant.locations SET ${sets}, updated_at = NOW()
         WHERE tenant_id = $1 AND is_active = TRUE AND deleted_at IS NULL`,
        [tenantId, ...Object.values(locPatch)]
      ));
    }
    if (c.whatsapp !== undefined) {
      const waUrl = c.whatsapp ? `https://wa.me/${c.whatsapp.replace(/\D/g, '')}` : null;
      await q(`DELETE FROM brand.contact_links WHERE tenant_id = $1 AND platform = 'whatsapp'`, [tenantId]);
      if (waUrl) {
        parallelOps.push(q(
          `INSERT INTO brand.contact_links (id, tenant_id, platform, url, display_label, position)
           VALUES (gen_random_uuid(), $1, 'whatsapp', $2, 'WhatsApp', 10)`,
          [tenantId, waUrl]
        ));
      }
    }
    const contactSettings = {};
    if (c.email         !== undefined) contactSettings.email   = c.email;
    if (c.googleMapsUrl !== undefined) contactSettings.map_url = c.googleMapsUrl;
    if (Object.keys(contactSettings).length) {
      parallelOps.push(q(
        `UPDATE tenant.restaurants SET settings = settings || $1::jsonb, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(contactSettings), tenantId]
      ));
    }
  }

  if (body.social) {
    const entries = Object.entries(body.social)
      .filter(([platform]) => SOCIAL_PLATFORMS.includes(platform));
    for (const [platform, url] of entries) {
      const clean = (url || '').trim();
      await q(`DELETE FROM brand.contact_links WHERE tenant_id = $1 AND platform = $2`, [tenantId, platform]);
      if (clean) {
        parallelOps.push(q(
          `INSERT INTO brand.contact_links (id, tenant_id, platform, url, display_label, position)
           VALUES (gen_random_uuid(), $1, $2, $3, $2, $4)`,
          [tenantId, platform, clean, SOCIAL_PLATFORMS.indexOf(platform) + 20]
        ));
      }
    }
  }

  if (body.branding) {
    const b = body.branding;
    if (b.logoUrl !== undefined) {
      await q(`DELETE FROM brand.assets WHERE tenant_id = $1 AND type = 'logo'`, [tenantId]);
      if (b.logoUrl) {
        parallelOps.push(q(
          `INSERT INTO brand.assets (id, tenant_id, type, url, alt_text, metadata)
           VALUES (gen_random_uuid(), $1, 'logo', $2, $3, '{}')`,
          [tenantId, b.logoUrl, 'logo']
        ));
      }
    }
    if (b.heroImage !== undefined) {
      await q(`DELETE FROM brand.assets WHERE tenant_id = $1 AND type = 'banner'`, [tenantId]);
      if (b.heroImage) {
        parallelOps.push(q(
          `INSERT INTO brand.assets (id, tenant_id, type, url, alt_text, metadata)
           VALUES (gen_random_uuid(), $1, 'banner', $2, $3, '{}')`,
          [tenantId, b.heroImage, 'hero image']
        ));
      }
    }
  }

  if (body.hero) {
    const h = body.hero;
    if (h.headline !== undefined) {
      parallelOps.push(q(
        `UPDATE tenant.restaurants SET name = $1, updated_at = NOW() WHERE id = $2`,
        [h.headline, tenantId]
      ));
    }
    if (h.subheadline !== undefined) {
      parallelOps.push(q(
        `UPDATE tenant.restaurants SET settings = settings || $1::jsonb, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify({ tagline: h.subheadline }), tenantId]
      ));
    }
    if (h.heroImage !== undefined) {
      await q(`DELETE FROM brand.assets WHERE tenant_id = $1 AND type = 'banner'`, [tenantId]);
      if (h.heroImage) {
        parallelOps.push(q(
          `INSERT INTO brand.assets (id, tenant_id, type, url, alt_text, metadata)
           VALUES (gen_random_uuid(), $1, 'banner', $2, $3, '{}')`,
          [tenantId, h.heroImage, 'hero image']
        ));
      }
    }
  }

  if (body.story) {
    const stIn        = body.story;
    const currentStory  = currentPresence.story || {};
    const updatedStory  = { ...currentStory };
    if (stIn.title !== undefined) updatedStory.headline = stIn.title;
    if (stIn.body  !== undefined) {
      updatedStory.body = stIn.body.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
    }
    presencePatch = { ...(presencePatch || currentPresence), story: updatedStory };
    if (stIn.image !== undefined) {
      await q(`DELETE FROM brand.assets WHERE tenant_id = $1 AND type = 'story'`, [tenantId]);
      if (stIn.image) {
        parallelOps.push(q(
          `INSERT INTO brand.assets (id, tenant_id, type, url, alt_text, metadata)
           VALUES (gen_random_uuid(), $1, 'story', $2, $3, '{}')`,
          [tenantId, stIn.image, 'story image']
        ));
      }
    }
  }

  if (body.gallery) {
    const g = body.gallery;
    await q(`UPDATE brand.assets SET deleted_at = NOW() WHERE tenant_id = $1 AND type = 'gallery'`, [tenantId]);
    for (const cat of ['food', 'ambience', 'people']) {
      for (const url of (g[cat] || []).filter(Boolean)) {
        parallelOps.push(q(
          `INSERT INTO brand.assets (id, tenant_id, type, url, alt_text, metadata)
           VALUES (gen_random_uuid(), $1, 'gallery', $2, '', $3::jsonb)`,
          [tenantId, url, JSON.stringify({ category: cat })]
        ));
      }
    }
  }

  if (body.featured) {
    await q(`UPDATE brand.announcements SET deleted_at = NOW() WHERE tenant_id = $1 AND deleted_at IS NULL`, [tenantId]);
    for (const f of body.featured) {
      parallelOps.push(q(
        `INSERT INTO brand.announcements
           (id, tenant_id, title, body, image_url, cta_label, cta_url, is_active, starts_at, ends_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW(), NULL)`,
        [tenantId, f.title || '', f.description || '', f.image || null,
         f.ctaLabel || null, f.ctaUrl || null, f.active !== false]
      ));
    }
  }

  if (body.signatureDishes !== undefined || body.timeline !== undefined) {
    const base = presencePatch || currentPresence;
    presencePatch = { ...base };
    if (body.signatureDishes !== undefined) presencePatch.signature_dishes = body.signatureDishes;
    if (body.timeline        !== undefined) presencePatch.timeline         = body.timeline;
  }

  if (presencePatch !== null) {
    parallelOps.push(q(
      `UPDATE tenant.restaurants SET settings = settings || $1::jsonb, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify({ presence: presencePatch }), tenantId]
    ));
  }

  await Promise.all(parallelOps);
}

module.exports = { getContent, updateContent, SOCIAL_PLATFORMS };
