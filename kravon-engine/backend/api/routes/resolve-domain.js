/**
 * ROUTE — resolve-domain.js
 * GET /v1/resolve-domain?host=<subdomain-or-hostname>
 *
 * Public, unauthenticated lookup used by the static frontend server to map
 * a branded *.kravon.in subdomain to a tenant slug, so a bare custom-domain
 * request can redirect to the right Presence page without the frontend
 * needing its own copy of tenant data.
 *
 * Matches by exact slug first, then by a normalized (lowercased, hyphens/
 * spaces stripped) comparison — e.g. "cafebodhitree" matches slug
 * "cafe-bodhi-tree". Normalized matching is a substring compare, not an
 * index, so it's O(n) over active tenants; fine at current scale.
 */

'use strict';

const express = require('express');
const { query } = require('../../db/pool');

const router = express.Router();

function normalize(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

router.get('/', async (req, res, next) => {
  try {
    const host = (req.query.host || '').toString().trim().toLowerCase();
    if (!host) return res.status(400).json({ error: 'host query param required' });

    const exact = await query(
      `SELECT slug FROM tenant.restaurants WHERE slug = $1 AND deleted_at IS NULL LIMIT 1`,
      [host]
    );
    if (exact.rows[0]) return res.json({ ok: true, slug: exact.rows[0].slug });

    const target = normalize(host);
    const all = await query(
      `SELECT slug FROM tenant.restaurants WHERE deleted_at IS NULL`
    );
    const match = all.rows.find(r => normalize(r.slug) === target);
    if (match) return res.json({ ok: true, slug: match.slug });

    return res.status(404).json({ error: 'No tenant matches this domain.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
