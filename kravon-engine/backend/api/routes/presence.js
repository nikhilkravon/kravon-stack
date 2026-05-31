/**
 * ROUTE — presence.js
 * GET  /v1/restaurants/:slug/presence  — load personalisation editor content (admin)
 * PATCH /v1/restaurants/:slug/presence — save personalisation editor content (admin)
 *
 * Canonical owners per section:
 *   basics name/tagline/city/hours → tenant.restaurants + settings JSONB
 *   contact phone/address/wa/email → tenant.locations + brand.contact_links + settings
 *   social links                   → brand.contact_links (platform = instagram|google|zomato|swiggy|maps)
 *   hero image                     → brand.assets (type='banner')
 *   gallery                        → brand.assets (type='gallery', metadata.category=food|ambience|people)
 *   featured promos                → brand.announcements
 *   story/timeline/signature_dishes→ settings.presence JSONB
 */

'use strict';

const express  = require('express');
const { query, getClient } = require('../../db/pool');
const { requireRestaurantAuth } = require('../middleware/auth');
const { bustConfigCache } = require('./config');

const router = express.Router();

const SOCIAL_PLATFORMS = ['instagram', 'facebook', 'google', 'zomato', 'swiggy', 'tripadvisor', 'youtube', 'twitter'];

// ── GET / ─────────────────────────────────────────────────────────────────────
router.get('/', requireRestaurantAuth, async (req, res, next) => {
  try {
    const r    = req.tenant;
    const s    = r._settings  || {};
    const pres = s.presence   || {};
    const st   = pres.story   || {};

    // Load all social / contact links fresh (not in req.tenant)
    const linksRes = await query(
      `SELECT platform, url FROM brand.contact_links
       WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY position`,
      [r.tenant_id]
    );
    const links = linksRes.rows;
    const socialLinks = {};
    for (const platform of SOCIAL_PLATFORMS) {
      const row = links.find(l => l.platform === platform);
      socialLinks[platform] = row?.url || '';
    }

    res.json({
      ok: true,
      content: {
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
          logoUrl:  r.logo_url   || '',
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
        },
        gallery:         r.gallery          || { food: [], ambience: [], people: [] },
        featured:        r.featured         || [],
        signatureDishes: pres.signature_dishes || s.signature_dishes || [],
        timeline:        pres.timeline         || s.timeline         || [],
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── PATCH / ───────────────────────────────────────────────────────────────────
router.patch('/', requireRestaurantAuth, async (req, res, next) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(422).json({ error: 'Body must be a JSON object' });
  }

  const tenantId = req.tenant.tenant_id;

  try {
    const settingsRes = await query(
      'SELECT settings FROM tenant.restaurants WHERE id = $1 AND deleted_at IS NULL',
      [tenantId]
    );
    const currentSettings = settingsRes.rows[0]?.settings || {};
    const currentPresence = currentSettings.presence || {};

    const parallelOps = [];
    let   presencePatch = null;

    // ── Basics ────────────────────────────────────────────────────────────
    if (body.basics) {
      const b = body.basics;
      const restPatch = {};
      if (b.name         !== undefined) {
        parallelOps.push(query(
          `UPDATE tenant.restaurants SET name = $1, updated_at = NOW() WHERE id = $2`,
          [b.name, tenantId]
        ));
      }
      if (b.tagline      !== undefined) restPatch.tagline       = b.tagline;
      if (b.city         !== undefined) {
        // Update both settings and the primary location row
        restPatch.city = b.city;
        parallelOps.push(query(
          `UPDATE tenant.locations SET city = $1, updated_at = NOW()
           WHERE tenant_id = $2 AND is_active = TRUE AND deleted_at IS NULL`,
          [b.city, tenantId]
        ));
      }
      if (b.hours        !== undefined) restPatch.hours_display  = b.hours;
      if (b.deliveryZone !== undefined) restPatch.delivery_zone  = b.deliveryZone;

      if (Object.keys(restPatch).length) {
        parallelOps.push(query(
          `UPDATE tenant.restaurants SET settings = settings || $1::jsonb, updated_at = NOW() WHERE id = $2`,
          [JSON.stringify(restPatch), tenantId]
        ));
      }
    }

    // ── Contact ───────────────────────────────────────────────────────────
    if (body.contact) {
      const c = body.contact;

      if (c.phone !== undefined || c.address !== undefined) {
        const locPatch = {};
        if (c.phone   !== undefined) locPatch.phone   = c.phone;
        if (c.address !== undefined) locPatch.address = c.address;
        const sets = Object.keys(locPatch).map((k, i) => `${k} = $${i + 2}`).join(', ');
        parallelOps.push(query(
          `UPDATE tenant.locations SET ${sets}, updated_at = NOW()
           WHERE tenant_id = $1 AND is_active = TRUE AND deleted_at IS NULL`,
          [tenantId, ...Object.values(locPatch)]
        ));
      }

      if (c.whatsapp !== undefined) {
        const waUrl = c.whatsapp ? `https://wa.me/${c.whatsapp.replace(/\D/g, '')}` : null;
        parallelOps.push(
          query(`DELETE FROM brand.contact_links WHERE tenant_id = $1 AND platform = 'whatsapp'`, [tenantId])
            .then(() => {
              if (!waUrl) return;
              return query(
                `INSERT INTO brand.contact_links (id, tenant_id, platform, url, display_label, position)
                 VALUES (gen_random_uuid(), $1, 'whatsapp', $2, 'WhatsApp', 10)`,
                [tenantId, waUrl]
              );
            })
        );
      }

      const contactSettings = {};
      if (c.email         !== undefined) contactSettings.email   = c.email;
      if (c.googleMapsUrl !== undefined) contactSettings.map_url = c.googleMapsUrl;
      if (Object.keys(contactSettings).length) {
        parallelOps.push(query(
          `UPDATE tenant.restaurants SET settings = settings || $1::jsonb, updated_at = NOW() WHERE id = $2`,
          [JSON.stringify(contactSettings), tenantId]
        ));
      }
    }

    // ── Social links ──────────────────────────────────────────────────────
    if (body.social) {
      const entries = Object.entries(body.social)
        .filter(([platform]) => SOCIAL_PLATFORMS.includes(platform));

      for (const [platform, url] of entries) {
        const clean = (url || '').trim();
        parallelOps.push(
          query(`DELETE FROM brand.contact_links WHERE tenant_id = $1 AND platform = $2`, [tenantId, platform])
            .then(() => {
              if (!clean) return;
              return query(
                `INSERT INTO brand.contact_links (id, tenant_id, platform, url, display_label, position)
                 VALUES (gen_random_uuid(), $1, $2, $3, $2, $4)`,
                [tenantId, platform, clean, SOCIAL_PLATFORMS.indexOf(platform) + 20]
              );
            })
        );
      }
    }

    // ── Branding (logo + hero image) ──────────────────────────────────────
    if (body.branding) {
      const b = body.branding;

      if (b.logoUrl !== undefined) {
        parallelOps.push(
          query(`DELETE FROM brand.assets WHERE tenant_id = $1 AND type = 'logo'`, [tenantId])
            .then(() => {
              if (!b.logoUrl) return;
              return query(
                `INSERT INTO brand.assets (id, tenant_id, type, url, alt_text, metadata)
                 VALUES (gen_random_uuid(), $1, 'logo', $2, $3, '{}')`,
                [tenantId, b.logoUrl, `${req.tenant.name} logo`]
              );
            })
        );
      }

      if (b.heroImage !== undefined) {
        parallelOps.push(
          query(`DELETE FROM brand.assets WHERE tenant_id = $1 AND type = 'banner'`, [tenantId])
            .then(() => {
              if (!b.heroImage) return;
              return query(
                `INSERT INTO brand.assets (id, tenant_id, type, url, alt_text, metadata)
                 VALUES (gen_random_uuid(), $1, 'banner', $2, $3, '{}')`,
                [tenantId, b.heroImage, `${req.tenant.name} hero image`]
              );
            })
        );
      }
    }

    // ── Hero ──────────────────────────────────────────────────────────────
    if (body.hero) {
      const h = body.hero;

      if (h.headline !== undefined) {
        parallelOps.push(query(
          `UPDATE tenant.restaurants SET name = $1, updated_at = NOW() WHERE id = $2`,
          [h.headline, tenantId]
        ));
      }
      if (h.subheadline !== undefined) {
        parallelOps.push(query(
          `UPDATE tenant.restaurants SET settings = settings || $1::jsonb, updated_at = NOW() WHERE id = $2`,
          [JSON.stringify({ tagline: h.subheadline }), tenantId]
        ));
      }
      if (h.heroImage !== undefined) {
        parallelOps.push(
          query(`DELETE FROM brand.assets WHERE tenant_id = $1 AND type = 'banner'`, [tenantId])
            .then(() => {
              if (!h.heroImage) return;
              return query(
                `INSERT INTO brand.assets (id, tenant_id, type, url, alt_text, metadata)
                 VALUES (gen_random_uuid(), $1, 'banner', $2, $3, '{}')`,
                [tenantId, h.heroImage, `${req.tenant.name} hero image`]
              );
            })
        );
      }
    }

    // ── Story → settings.presence.story ──────────────────────────────────
    if (body.story) {
      const stIn = body.story;
      const currentStory  = currentPresence.story || {};
      const updatedStory  = { ...currentStory };
      if (stIn.title !== undefined) updatedStory.headline = stIn.title;
      if (stIn.body  !== undefined) {
        updatedStory.body = stIn.body.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
      }
      presencePatch = { ...(presencePatch || currentPresence), story: updatedStory };
    }

    // ── Gallery ───────────────────────────────────────────────────────────
    if (body.gallery) {
      const g = body.gallery;
      parallelOps.push(
        query(`UPDATE brand.assets SET deleted_at = NOW() WHERE tenant_id = $1 AND type = 'gallery'`, [tenantId])
          .then(() => {
            const inserts = [];
            for (const cat of ['food', 'ambience', 'people']) {
              for (const url of (g[cat] || []).filter(Boolean)) {
                inserts.push(query(
                  `INSERT INTO brand.assets (id, tenant_id, type, url, alt_text, metadata)
                   VALUES (gen_random_uuid(), $1, 'gallery', $2, '', $3::jsonb)`,
                  [tenantId, url, JSON.stringify({ category: cat })]
                ));
              }
            }
            return Promise.all(inserts);
          })
      );
    }

    // ── Featured → brand.announcements ───────────────────────────────────
    if (body.featured) {
      parallelOps.push(
        query(`UPDATE brand.announcements SET deleted_at = NOW() WHERE tenant_id = $1 AND deleted_at IS NULL`, [tenantId])
          .then(() => Promise.all(
            (body.featured || []).map(f => query(
              `INSERT INTO brand.announcements
                 (id, tenant_id, title, body, image_url, cta_label, cta_url, is_active, starts_at, ends_at)
               VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW(), NULL)`,
              [tenantId, f.title || '', f.description || '', f.image || null,
               f.ctaLabel || null, f.ctaUrl || null, f.active !== false]
            ))
          ))
      );
    }

    // ── Signature Dishes + Timeline → settings.presence ──────────────────
    if (body.signatureDishes !== undefined || body.timeline !== undefined) {
      const base = presencePatch || currentPresence;
      presencePatch = { ...base };
      if (body.signatureDishes !== undefined) presencePatch.signature_dishes = body.signatureDishes;
      if (body.timeline        !== undefined) presencePatch.timeline         = body.timeline;
    }

    // ── Flush presence patch ──────────────────────────────────────────────
    if (presencePatch !== null) {
      parallelOps.push(query(
        `UPDATE tenant.restaurants SET settings = settings || $1::jsonb, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify({ presence: presencePatch }), tenantId]
      ));
    }

    await Promise.all(parallelOps);
    bustConfigCache(tenantId);
    res.json({ ok: true });

  } catch (err) {
    next(err);
  }
});

module.exports = router;
