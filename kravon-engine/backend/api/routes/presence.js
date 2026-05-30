/**
 * ROUTE — presence.js
 * GET  /v1/restaurants/:slug/presence  — load presence editor content (admin)
 * PATCH /v1/restaurants/:slug/presence — save presence editor content (admin)
 *
 * No new tables. Data is stored in the existing brand schema:
 *   hero image      → brand.assets        (type = 'banner')
 *   gallery         → brand.assets        (type = 'gallery', metadata.category = food|ambience|people)
 *   featured        → brand.announcements (title, body, image_url, cta_label, cta_url, is_active)
 *   story           → tenant.restaurants.settings (story_headline, story_body)
 *   timeline        → tenant.restaurants.settings.timeline    (JSON array)
 *   signatureDishes → tenant.restaurants.settings.signature_dishes (JSON array)
 *   contact.phone + address → tenant.locations (primary row)
 *   contact.whatsapp        → brand.contact_links (platform = 'whatsapp')
 *   contact.email + maps    → tenant.restaurants.settings
 *
 * Both methods require restaurant-scoped JWT auth.
 * Public Presence frontend reads from GET /config, not this route.
 */

'use strict';

const express = require('express');
const { query } = require('../../db/pool');
const { requireRestaurantAuth } = require('../middleware/auth');

const router = express.Router();

// ── GET / ─────────────────────────────────────────────────────────────────────
// Returns the structured content needed by the dashboard editor.
router.get('/', requireRestaurantAuth, async (req, res, next) => {
  try {
    const r  = req.tenant;
    const s  = r._settings || {};

    res.json({
      ok: true,
      content: {
        hero: {
          headline:    r.name       || '',
          subheadline: r.tagline    || '',
          heroImage:   r.hero_image || '',
        },
        story: {
          title: s.story_headline || '',
          body:  Array.isArray(s.story_body) ? s.story_body.join('\n\n') : (s.story_body || ''),
        },
        gallery:         r.gallery          || { food: [], ambience: [], people: [] },
        featured:        r.featured         || [],
        signatureDishes: r.signature_dishes || [],
        timeline:        r.timeline         || [],
        contact: {
          phone:         r.phone     || '',
          whatsapp:      r.wa_number || '',
          email:         r.email     || '',
          address:       r.address   || '',
          googleMapsUrl: s.map_url   || '',
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── PATCH / ───────────────────────────────────────────────────────────────────
// Accepts the full presence content object and routes each section to its table.
router.patch('/', requireRestaurantAuth, async (req, res, next) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(422).json({ error: 'Body must be a JSON object' });
  }

  const tenantId = req.tenant.tenant_id;

  try {
    const ops = [];

    // ── Hero ──────────────────────────────────────────────────────────────
    if (body.hero) {
      const h = body.hero;

      if (h.headline !== undefined) {
        ops.push(query(
          `UPDATE tenant.restaurants SET name = $1, updated_at = NOW() WHERE id = $2`,
          [h.headline, tenantId]
        ));
      }

      if (h.subheadline !== undefined) {
        ops.push(query(
          `UPDATE tenant.restaurants SET settings = settings || $1::jsonb, updated_at = NOW() WHERE id = $2`,
          [JSON.stringify({ tagline: h.subheadline }), tenantId]
        ));
      }

      if (h.heroImage !== undefined) {
        // UPSERT: delete any existing banner for this tenant, then insert if non-empty
        ops.push(
          query(`DELETE FROM brand.assets WHERE tenant_id = $1 AND type = 'banner'`, [tenantId])
            .then(() => {
              if (!h.heroImage) return;
              return query(
                `INSERT INTO brand.assets (id, tenant_id, type, url, alt_text, metadata)
                 VALUES (gen_random_uuid(), $1, 'banner', $2, $3, '{}')`,
                [tenantId, h.heroImage, req.tenant.name + ' hero image']
              );
            })
        );
      }
    }

    // ── Story ─────────────────────────────────────────────────────────────
    if (body.story) {
      const st = body.story;
      const patch = {};
      if (st.title !== undefined) patch.story_headline = st.title;
      if (st.body  !== undefined) {
        // Store as array of paragraphs (split on blank lines)
        patch.story_body = st.body.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
      }
      if (Object.keys(patch).length) {
        ops.push(query(
          `UPDATE tenant.restaurants SET settings = settings || $1::jsonb, updated_at = NOW() WHERE id = $2`,
          [JSON.stringify(patch), tenantId]
        ));
      }
    }

    // ── Gallery ───────────────────────────────────────────────────────────
    if (body.gallery) {
      const g = body.gallery;
      // Soft-delete existing gallery assets then re-insert
      ops.push(
        query(`UPDATE brand.assets SET deleted_at = NOW() WHERE tenant_id = $1 AND type = 'gallery'`, [tenantId])
          .then(() => {
            const categories = ['food', 'ambience', 'people'];
            const inserts = [];
            for (const cat of categories) {
              const urls = (g[cat] || []).filter(Boolean);
              for (const url of urls) {
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

    // ── Featured ──────────────────────────────────────────────────────────
    if (body.featured) {
      ops.push(
        query(`UPDATE brand.announcements SET deleted_at = NOW() WHERE tenant_id = $1 AND deleted_at IS NULL`, [tenantId])
          .then(() => {
            const inserts = (body.featured || []).map(f => query(
              `INSERT INTO brand.announcements
                 (id, tenant_id, title, body, image_url, cta_label, cta_url, is_active, starts_at, ends_at)
               VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW(), NULL)`,
              [tenantId, f.title || '', f.description || '', f.image || null, f.ctaLabel || null, f.ctaUrl || null, f.active !== false]
            ));
            return Promise.all(inserts);
          })
      );
    }

    // ── Signature Dishes + Timeline ───────────────────────────────────────
    const settingsPatch = {};
    if (body.signatureDishes !== undefined) settingsPatch.signature_dishes = body.signatureDishes;
    if (body.timeline        !== undefined) settingsPatch.timeline         = body.timeline;
    if (Object.keys(settingsPatch).length) {
      ops.push(query(
        `UPDATE tenant.restaurants SET settings = settings || $1::jsonb, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(settingsPatch), tenantId]
      ));
    }

    // ── Contact ───────────────────────────────────────────────────────────
    if (body.contact) {
      const c = body.contact;

      // Location row — phone + address
      if (c.phone !== undefined || c.address !== undefined) {
        const locPatch = {};
        if (c.phone   !== undefined) locPatch.phone   = c.phone;
        if (c.address !== undefined) locPatch.address = c.address;
        const sets   = Object.keys(locPatch).map((k, i) => `${k} = $${i + 2}`).join(', ');
        const vals   = Object.values(locPatch);
        ops.push(query(
          `UPDATE tenant.locations SET ${sets}, updated_at = NOW()
           WHERE tenant_id = $1 AND is_active = TRUE AND deleted_at IS NULL`,
          [tenantId, ...vals]
        ));
      }

      // WhatsApp contact link
      if (c.whatsapp !== undefined) {
        const waUrl = c.whatsapp ? `https://wa.me/${c.whatsapp.replace(/\D/g, '')}` : null;
        ops.push(
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

      // Email + maps URL live in settings
      const contactSettings = {};
      if (c.email         !== undefined) contactSettings.email   = c.email;
      if (c.googleMapsUrl !== undefined) contactSettings.map_url = c.googleMapsUrl;
      if (Object.keys(contactSettings).length) {
        ops.push(query(
          `UPDATE tenant.restaurants SET settings = settings || $1::jsonb, updated_at = NOW() WHERE id = $2`,
          [JSON.stringify(contactSettings), tenantId]
        ));
      }
    }

    await Promise.all(ops);
    res.json({ ok: true });

  } catch (err) {
    next(err);
  }
});

module.exports = router;
