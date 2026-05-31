# Kravon Single Source of Truth Refactor Plan

Audit date: 2026-05-30

This plan intentionally avoids new product features and framework changes. The refactor should be performed in phases, with each phase ending in a coherent single-owner state.

## Refactor Principles

1. v12 multi-schema is the canonical database model.
2. `GET /v1/restaurants/:slug/config` is the canonical public read contract.
3. `PATCH /v1/restaurants/:slug/config` is the canonical configuration write contract unless a domain-specific editor endpoint has a strong reason to exist.
4. Frontend modules consume contracts, not database-shaped assumptions.
5. No compatibility aliases remain after consumers are updated.
6. No concept remains in both first-class columns/tables and `tenant.restaurants.settings`.
7. Migrations must move data before removing obsolete fields.

## Phase 0: Freeze and Verify

Goal: prevent further drift before changing architecture.

Actions:

1. Mark `SCHEMA_AUDIT.md`, `DATA_OWNERSHIP.md`, and `REFACTOR_PLAN.md` as the active consolidation docs.
2. Confirm production/live DB shape with `information_schema` before writing destructive migrations.
3. Decide whether any live tenant still depends on flat public tables.
4. Add a temporary rule: no new config fields may be added outside the ownership map.

No code removal in this phase.

## Phase 1: Choose and Enforce the Canonical Schema

Problem:

- `db/migrate.js` runs `db/schema.js`, but the active backend largely expects `schema/kravon_schema_v12.sql`.
- Some routes still use flat public tables.

Required changes:

1. Replace `db/migrate.js` so it applies `db/schema/kravon_schema_v12.sql`.
2. Retire or quarantine `db/schema.js`.
3. Create a migration that moves any remaining flat public data into v12 tables.
4. Rewrite routes still using flat tables:
   - `api/middleware/cors.js`: read origins from v12 owner.
   - `api/routes/dine-in.js`: replace `orders`, `menu_items`, `rest_id`, `price_paise`, `items_json` with `orders.orders`, `orders.order_items`, `menu.menu_items`, `tenant_id`.
   - Any inspect/debug scripts that assume flat schema should be moved under `scripts/legacy` or removed.
5. Remove old flat-schema migrations after data is migrated and verified.

Migration requirements:

1. Map `restaurants.rest_id` to `tenant.restaurants.id` where possible.
2. Move flat `restaurants.domain` to `tenant.domains`.
3. Move flat restaurant contact columns to `tenant.locations` and `brand.contact_links`.
4. Move flat payment/webhook fields to `tenant.integrations` or `platform.webhooks`.
5. Move flat menu rows to `menu.*`.
6. Move flat order rows to `orders.orders` and `orders.order_items`, preserving historical snapshots.
7. Move flat reviews to the chosen review owner.
8. Drop flat public tables only after verification queries show zero unmigrated rows.

Acceptance criteria:

- No backend route queries `FROM restaurants`, `FROM orders`, `FROM menu_items`, or other flat public tables.
- `rg "rest_id|price_paise|items_json|allowed_origin"` shows only migration/docs/legacy references or intentionally retained fields.
- Fresh DB setup creates only the v12 intended model.

## Phase 2: Normalize Configuration Ownership

Problem:

- `tenant.restaurants.settings` is a shadow owner for contact, hours, payment, delivery, Presence, and catering content.

Fields to move out of `settings`:

| Settings key | Canonical destination | Migration action |
|---|---|---|
| `domain` | `tenant.domains.domain` | Insert or update primary domain |
| `phone` | `tenant.locations.phone` | Update primary location |
| `address` | `tenant.locations.address` | Update primary location |
| `city` | `tenant.locations.city` | Update primary location |
| `email` | chosen email owner: `brand.contact_links(platform='email')` or `tenant.locations.email` if added | Migrate after owner decision |
| `wa_number` | `brand.contact_links(platform='whatsapp')` | Build `https://wa.me/{digits}` |
| `razorpay_key_id` / `razorpay_key_secret` | `tenant.integrations(provider='razorpay').config` | Upsert integration config |
| `webhook_url` | chosen webhook owner: `platform.webhooks` preferred | Upsert webhook config |
| `hours_display` / `open_until` | `tenant.operating_hours` plus derived display | Migrate only if structured hours can be reconstructed; otherwise preserve as temporary display setting |
| `delivery_zone` | delivery service area owner required; temporary location metadata if needed | Decide schema before migration |
| `delivery_fee` / `free_delivery_above` | delivery/fulfillment config owner required; temporary allowed settings if no table exists | Decide schema before migration |
| `map_url` | `brand.contact_links(platform='maps')` | Upsert maps link |
| `google_review_url` | review config owner or `brand.contact_links(platform='google_review')` | Upsert chosen owner |
| `review_threshold` | review config owner or allowed settings key | Decide schema |
| `tagline`, `year` | dedicated brand copy owner or explicitly allowed settings keys | Decide schema |
| `story_*`, `timeline`, `signature_dishes` | Presence copy owner or explicitly allowed Presence settings | Decide schema |
| `catering` | catering page/content owner | Move to `catering.enquiry_forms`, `catering.packages`, and a dedicated content owner |

Allowed temporary settings keys after Phase 2:

- Only keys explicitly documented in `DATA_OWNERSHIP.md`.
- Each remaining key must have a type and consumer list.

Acceptance criteria:

- Tenant middleware no longer falls back to settings for fields with first-class owners.
- `/config` builder reads from canonical owners.
- Dashboard writes route to canonical owners.

## Phase 3: Formalize the `/config` Contract

Problem:

- `/config` mixes public data, UI copy, compatibility aliases, and product-specific details.

Required contract changes:

1. Replace stale `frontend/config/restaurant-config.schema.json` with the current `/config` schema.
2. Decide whether `config` response should be flat or grouped. Recommended top-level groups:
   - `tenant`
   - `brand`
   - `theme`
   - `contact`
   - `hours`
   - `capabilities`
   - `menu`
   - `presence`
   - `ordering`
   - `tables`
   - `catering`
   - `footer`
3. Remove compatibility aliases after frontend updates:
   - `rest_id`
   - `customisable`
   - `customise`
   - `products` if `capabilities` is retained
   - global `window.MENU`, `window.ADDONS`, `window.SPICE_LEVELS`
4. Move product UI copy out of hardcoded route code. Either:
   - keep static app copy in frontend when it is not tenant business data, or
   - store tenant-editable copy in the appropriate owner.
5. Ensure every `/config` field has a source owner listed in `DATA_OWNERSHIP.md`.

API changes:

- `GET /config`: return the formal contract.
- `PATCH /config`: accept only fields present in the formal editable contract and write them to canonical owners.
- Move `GET /config/items/:id` to `GET /menu/items/:id` or `GET /menu/items/:id/options`.

Acceptance criteria:

- Frontend schema and backend response match.
- No `/config` field exists without an owner.
- No compatibility aliases remain.

## Phase 4: Presence Refactor

Problem:

- Presence is now marketing, but content is split among restaurant name, SEO meta description, settings, assets, announcements, and locations.

Canonical Presence contract:

```json
{
  "presence": {
    "hero": {
      "headline": "string",
      "subheadline": "string",
      "image": { "url": "string", "alt": "string" }
    },
    "story": {
      "title": "string",
      "body": ["string"],
      "facts": []
    },
    "signatureDishes": [],
    "gallery": {
      "food": [],
      "ambience": [],
      "people": []
    },
    "featured": [],
    "timeline": [],
    "contact": {}
  }
}
```

Ownership decisions required before migration:

1. If hero headline is the restaurant name, keep owner as `tenant.restaurants.name`.
2. If hero headline is marketing copy independent of restaurant name, add a dedicated Presence copy owner.
3. If signature dishes are menu items, use curated `menu.menu_items`; if they are arbitrary marketing cards, create a dedicated marketing collection.
4. If timeline/story content remains JSONB, name the owner explicitly and constrain the shape.

Recommended implementation:

1. Keep hero image and gallery in `brand.assets`.
2. Keep featured promotions in `brand.announcements` only if they are truly announcements/promos.
3. Move maps/WhatsApp/contact links to `brand.contact_links`.
4. Stop reading tagline from `brand.seo.meta_description`.
5. Replace `GET/PATCH /presence` with either:
   - an editor facade that maps to the same `/config.presence` shape, or
   - `GET/PATCH /config` with a `presence` section.

Acceptance criteria:

- No duplicate hero fields.
- No duplicate gallery fields.
- No duplicate contact fields.
- Presence public renderer reads only `config.presence` plus shared `brand/contact/hours` where appropriate.

## Phase 5: Menu and Customization Cleanup

Problem:

- Frontend still expects old globals `ADDONS` and `SPICE_LEVELS`.
- `/config` returns empty arrays for these while item-specific customization APIs exist.
- Item customizability has three field names.

Required changes:

1. Use `menu.customization_groups` and `menu.customization_options` for addons/spice/customizations.
2. Remove `ADDONS` and `SPICE_LEVELS` globals.
3. Replace item aliases with `is_customizable`.
4. Ensure `has_variants` and `price` invariant is enforced consistently.
5. Decide one money unit:
   - v12 currently uses numeric rupees in menu/order service.
   - old flat schema uses paise.
   - Pick one and document it at API boundaries.

Acceptance criteria:

- Orders, Tables, and Presence customization modals fetch item options from one endpoint.
- No frontend references `customise` or `customisable`.
- No route returns empty arrays as compensation for removed tables.

## Phase 6: Orders, Dine-In, and Payments

Problem:

- Delivery/table order creation uses v12 `orders.orders`.
- Dine-in session order still uses flat `orders` and `menu_items`.
- Payment state is stored in order metadata/status while `payments.*` is unused.

Required changes:

1. Rewrite `POST /dine-in/order` to insert into:
   - `orders.orders`
   - `orders.order_items`
   - `orders.order_item_customizations`
2. Ensure `orders.orders.session_id` links to `dining.sessions.id`.
3. Rewrite kitchen/bill queries to use `orders.orders` and `orders.order_items`.
4. Write Razorpay create/webhook state to `payments.payments`.
5. Write raw webhook events to `payments.payment_events`.
6. Keep order `status` as fulfillment lifecycle, not payment lifecycle.

Acceptance criteria:

- No `orders.orders.metadata.razorpay_order_id` dependency.
- Payment dashboard/debug can be answered from `payments.*`.
- Dine-in and delivery orders share one order model.

## Phase 7: Reviews and Feedback Boundary

Problem:

- `dining.reviews`, `customer.feedback`, and old public `reviews` overlap.

Required decision:

Choose one of these:

1. `dining.reviews` owns all order/session reviews, and `customer.feedback` owns non-order feedback only.
2. `customer.feedback` owns all feedback/reviews, and `dining.reviews` is removed.

Recommended:

- Keep `dining.reviews` for order/session ratings.
- Keep `customer.feedback` for general NPS/contact feedback.
- Add clear enum values and docs.

Acceptance criteria:

- Review submission writes one canonical table.
- Insights reads from the chosen review source.
- Google review threshold/url has one owner.

## Phase 8: Catering Cleanup

Problem:

- Catering public page content is stored in `settings.catering`.
- `catering.enquiry_forms` and `catering.packages` exist but are not used by the frontend.

Required changes:

1. Move lead form fields and thank-you copy to `catering.enquiry_forms`.
2. Move package/menu package content to `catering.packages` and `catering.package_items`.
3. Decide owner for marketing sections like FAQs/process/testimonials. If they remain product CMS content, create a small `catering.content_sections` table or explicitly allowed JSONB owner.
4. Keep lead submissions in `catering.leads`.

Acceptance criteria:

- `settings.catering` is removed or reduced to documented non-business display preferences.
- Catering renderer receives content from canonical catering owners through `/config.catering`.

## Phase 9: Analytics, Events, and Notifications

Problem:

- Live insights routes compute directly from orders/leads.
- `insights.*`, `platform.events`, and `platform.event_outbox` are not clearly separated.
- Notify service sends without writing notification records.

Required decisions:

1. Use `platform.event_outbox` for operational event delivery.
2. Use `insights.events` for analytics events only.
3. Remove or clearly justify `platform.events`.
4. Write notifications to `platform.notifications`.
5. Decide whether insights dashboard uses live aggregation or materialized tables.

Acceptance criteria:

- An order-created event has one operational outbox path.
- An analytics event has one analytics path.
- Notification history is queryable.

## Phase 10: Delete Dead Code and Stale Docs

Remove only after phases above are complete and tests pass.

Deletion candidates:

1. `kravon-engine/backend/db/schema.js`
2. `kravon-engine/backend/db/fix_schema.js`
3. Flat-schema migrations after migration to v12 is complete:
   - `v9-tables.js`
   - `v10-domain.js`
   - `v10-column-rename.js`
   - `v11-story.js`
   - old parts of `v13-dine-in.js`
4. Flat-schema inspect scripts or move them to `legacy/`.
5. Stale `frontend/config/restaurant-config.schema.json`.
6. Static config snapshots if not generated artifacts.
7. Presence checkout/payment scripts that target unmounted routes.

Acceptance criteria:

- `rg` finds no active references to deleted files.
- Fresh setup and existing DB migration both work.
- Docs match current architecture.

## Test and Verification Plan

Backend:

1. Run migration on a copy of the live DB.
2. Verify row counts before/after for each migrated concept.
3. Exercise:
   - `GET /health`
   - `GET /v1/restaurants/:slug/config`
   - `PATCH /v1/restaurants/:slug/config`
   - auth login/refresh/logout
   - menu CRUD
   - order creation
   - dine-in session/order/bill flow
   - catering lead creation
   - review submission
   - insights summary
4. Add regression checks that no active route queries flat tables.

Frontend:

1. Load Presence, Orders, Tables, Catering, and Dashboard against the new `/config`.
2. Confirm no browser errors for missing aliases.
3. Confirm menu customizations still work without `ADDONS`/`SPICE_LEVELS`.
4. Confirm dashboard edits persist to canonical owners and refresh back correctly.

Data quality:

1. Query for duplicate domains, contacts, payment configs, and hours.
2. Query for settings keys that should have been migrated.
3. Confirm every `/config` field can be traced to `DATA_OWNERSHIP.md`.

## High-Risk Areas

1. Live DB may not match either schema file exactly.
2. `dine-in.js` currently mixes v12 and flat schema assumptions.
3. Money units are inconsistent between old paise model and v12 rupee numeric model.
4. Presence dashboard writes full content payloads and could overwrite unrelated sections.
5. `settings` cleanup can break frontend rendering if `/config` is not updated first.
6. Removing compatibility aliases requires coordinated frontend changes.

## Recommended First Implementation PR

Keep the first code PR narrow:

1. Make `kravon_schema_v12.sql` the only schema used by migrations.
2. Add a schema smoke test or script that verifies required v12 tables exist.
3. Update `cors.js` and `dine-in.js` away from flat tables.
4. Do not change public `/config` shape yet.

This gives the platform one database foundation before touching frontend contracts.

