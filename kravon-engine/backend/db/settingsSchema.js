/**
 * SETTINGS REGISTRY — settingsSchema.js
 *
 * Single source of truth for which keys are allowed in
 * tenant.restaurants.settings (JSONB).
 *
 * Rule: any write to settings must pass validateSettingsPatch().
 * A key not in this set must first have an owner declared in DATA_OWNERSHIP.md.
 *
 * Keys marked "transitional" should be migrated to their canonical owners
 * per the refactor plan and then removed from this registry.
 */

'use strict';

const ALLOWED_SETTINGS_KEYS = new Set([
  // ── Tenant operational ──────────────────────────────────────────────────
  'domain',              // transitional → tenant.domains
  'hours_display',       // display string (e.g. "Mon–Sat 11am–11pm")
  'open_until',          // short open-until string
  'delivery_zone',       // delivery area description

  // ── Brand copy ──────────────────────────────────────────────────────────
  'tagline',             // hero/footer tagline
  'year',                // founding year

  // ── Contact (transitional → canonical owners below) ─────────────────────
  'email',               // transitional → tenant.locations or brand.contact_links
  'wa_number',           // transitional → brand.contact_links(platform='whatsapp')
  'map_url',             // transitional → brand.contact_links(platform='maps')

  // ── Payment (transitional → tenant.integrations) ────────────────────────
  'razorpay_key_id',
  'razorpay_key_secret',
  'webhook_url',         // transitional → platform.webhooks

  // ── Pricing ─────────────────────────────────────────────────────────────
  'delivery_fee',        // rupees
  'free_delivery_above', // rupees

  // ── Reviews ─────────────────────────────────────────────────────────────
  'review_threshold',    // star gate (integer 1–5)
  'google_review_url',   // redirect URL after positive review

  // ── Presence content (Phase 5 consolidated owner) ───────────────────────
  // Shape: { story: { headline, body[], facts[] }, timeline[], signature_dishes[] }
  'presence',

  // ── Catering content (transitional → catering.enquiry_forms / catering.packages) ─
  'catering',
]);

/**
 * Returns an array of unknown keys found in patch.
 * Empty array means the patch is clean.
 */
function validateSettingsPatch(patch) {
  return Object.keys(patch).filter(k => !ALLOWED_SETTINGS_KEYS.has(k));
}

module.exports = { ALLOWED_SETTINGS_KEYS, validateSettingsPatch };
