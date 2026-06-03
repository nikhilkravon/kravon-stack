# KRAVON Platform State Report
**Audit Date:** 2026-06-03
**Platform Migration Version:** v18 (v19 untracked/pending)
**Auditor:** Claude Code (claude-sonnet-4-6)

---

## Section 1 — Executive Summary

### Platform Totals

| Category | Count |
|---|---|
| DB Schemas | 11 (tenant, brand, menu, customer, orders, payments, dining, catering, insights, platform, inventory) |
| Total Tables (v12 canonical schema) | ~65+ across all schemas |
| Total Route Files | 16 |
| Total Routes (individual endpoints) | ~65 |
| Total Services | 5 (notify, order, lead, notification, notification.listeners) |
| Total Integrations | 4 (razorpay, whatsapp, webhook, email) |
| Total Middleware | 5 (auth, tenant, feature, error, cors) |
| Total Frontend Views (dashboard) | 13 (overview, orders, menu, reservations, tables, kitchen, catering, insights, customers, staff, presence, settings, notifications) |
| Total Migrations | 11 files (v9, v10-column-rename, v10-domain, v11, v13, v14, v15, v16, v17, v18, v19) |

### Health Scores

| Dimension | Score | Rationale |
|---|---|---|
| Database | 7/10 | v12 schema is excellent, but there is severe drift between what the schema defines and what migrations have actually applied; v19 exists as a file but has not been tracked; schema.js is retired but referenced by habit. |
| API | 7/10 | Routes are thin and delegate well; Zod validation throughout; serious gaps in audit logging on mutation routes. |
| Security | 6/10 | JWT + refresh token pattern is solid; bcrypt with cost 12; AES-256-GCM for secrets; BUT the .env contains production DB credentials, JWT secret, and API key in plaintext committed to the repository, which is a critical failure. |
| Governance | 8/10 | DPDP export, delete-request, correct, and consent-history routes all exist and are wired; audit log fires on key actions; export job tracking in platform.export_jobs. |
| Maintainability | 6/10 | Significant duplication of Razorpay upsert logic across admin.js and config.js; presence PATCH is monolithic at 350 lines; settings export queries columns that do not exist in the canonical v12 schema (price_paise, party_name, party_phone). |
| Scalability | 5/10 | In-process Node EventEmitter for the event bus will not survive horizontal scaling; in-memory caches (_cache, _configCache) are per-process and stale immediately on multi-instance deployments; insights cache is in-memory with no invalidation on write. |

---

## Section 2 — Database Audit

### Schema: tenant

| Table | Purpose | Row Ownership | Notes |
|---|---|---|---|
| tenant.restaurants | Root tenant record; capability flags, plan, settings JSONB | Platform | settings JSONB is overloaded with transitional fields (razorpay keys, domain, wa_number). |
| tenant.locations | Physical/virtual locations per tenant | Restaurant | Only one location per restaurant is used in practice; multi-location not yet exercised. |
| tenant.domains | Custom domain per tenant | Platform | UNUSED — domain resolution uses settings->>'domain' instead. This table is never queried in any route or middleware. |
| tenant.operating_hours | Weekly schedule per location | Restaurant | UNUSED — no routes read or write this table. |
| tenant.virtual_brands | Cloud kitchen multiple storefronts | Platform | UNUSED — no routes touch this table. |
| tenant.integrations | Per-tenant encrypted credentials | Restaurant | Used for Razorpay; webhook provider not inserted through current routes. |
| tenant.roles | Named RBAC roles | Restaurant | Partially used — roles are seeded at staff creation but no route reads permission_key. |
| tenant.permissions | Granular permission keys per role | Restaurant | UNUSED — no route ever queries tenant.permissions; requireRole() checks JWT roles array only. |
| tenant.staff | Human operators | Restaurant | password_hash added via v14; pin column exists but is never set through current routes. |
| tenant.staff_roles | M:N junction staff ↔ roles | Restaurant | Used. |
| tenant.staff_locations | Staff location scoping | Restaurant | UNUSED — no route scopes queries by staff location. |
| tenant.staff_sessions | Refresh token registry | Restaurant | Used and correct. |
| tenant.tax_rules | GST / VAT rule definitions | Restaurant | UNUSED — no route reads or writes tax_rules. |
| tenant.tax_rule_items | Tax rule → menu item mapping | Restaurant | UNUSED. |
| tenant.subscriptions | SaaS billing subscription | Platform | UNUSED — plan is stored on tenant.restaurants; no billing integration. |
| tenant.feature_flags | Per-tenant feature overrides | Platform | UNUSED — feature gating uses tenant.restaurants.has_* boolean columns. |
| tenant.notification_preferences | Per-tenant notification on/off toggles | Restaurant | Used by notification.service.js. |

### Schema: brand

| Table | Purpose | Row Ownership | Notes |
|---|---|---|---|
| brand.themes | Visual identity colours, fonts | Restaurant | brand.themes.font_family is referenced in settings.js export query — SUSPICIOUS because the column in v12 schema is font_heading/font_body, not font_family. Export query will fail at runtime. |
| brand.assets | Logos, banners, gallery, story images | Restaurant | Used. |
| brand.seo | OG meta per tenant | Restaurant | Used. |
| brand.contact_links | Social/map/WhatsApp links | Restaurant | Used. |
| brand.announcements | Featured promos (storefront banners) | Restaurant | Used. image_url added by v16. |

### Schema: menu

| Table | Purpose | Row Ownership | Notes |
|---|---|---|---|
| menu.menus | Menu containers per tenant | Restaurant | Auto-created by getOrCreateMenu() helper. |
| menu.categories | Menu sections | Restaurant | Used. |
| menu.menu_items | Dishes | Restaurant | Used. config.js queries has_variants which is in v12 schema; correct. |
| menu.item_variants | Size/portion variants | Restaurant | Routes exist; used for variant-priced items. |
| menu.customization_groups | Add-on groups | Restaurant | Routes exist and used. |
| menu.customization_options | Individual add-on choices | Restaurant | Used. |
| menu.item_availability | Day/time availability overrides | Restaurant | UNUSED — no route reads or writes this table. |
| menu.combos | Combo / meal deal header | Restaurant | UNUSED — no combo routes exist. |
| menu.combo_slots | Slots within a combo | Restaurant | UNUSED. |
| menu.combo_slot_options | Items eligible for a combo slot | Restaurant | UNUSED. |
| menu.menu_schedules | Auto-activation rules per menu | Restaurant | UNUSED — no route reads or writes menu_schedules. |

### Schema: customer

| Table | Purpose | Row Ownership | Notes |
|---|---|---|---|
| customer.customers | CRM record per tenant | Restaurant | Used. Upserted on every order and reservation. |
| customer.addresses | Saved delivery addresses | Customer | UNUSED — delivery address is stored in orders.orders.metadata JSONB, not here. |
| customer.loyalty_accounts | Points wallet | Customer | UNUSED — no loyalty routes or service exist. |
| customer.loyalty_transactions | Points ledger | Customer | UNUSED. |
| customer.feedback | Generalised post-interaction feedback | Customer | UNUSED — reviews go to dining.reviews; this table is never queried. DUPLICATE risk with dining.reviews. |
| customer.interaction_log | CRM timeline | Customer | UNUSED — no route writes to interaction_log. |
| customer.identities | Identity graph | Customer | UNUSED. |
| customer.consent_history | DPDP consent event log | Platform | Used — queried in customers.js export endpoint; consent history is read-only append. |

### Schema: orders

| Table | Purpose | Row Ownership | Notes |
|---|---|---|---|
| orders.orders | Master order record | Restaurant | Used. |
| orders.order_items | Line items | Restaurant | Used. |
| orders.order_item_customizations | Customization selections | Restaurant | UNUSED — customizations are stored in orders.order_items.metadata JSONB, not here. |
| orders.order_taxes | Tax breakdown per order | Restaurant | UNUSED — tax_amount is always 0 in current routes. |
| orders.order_discounts | Coupon applications | Restaurant | UNUSED — no coupon routes exist. |
| orders.coupons | Coupon definitions | Restaurant | UNUSED. |
| orders.delivery_jobs | Last-mile delivery | Restaurant | UNUSED — no delivery integration. |
| orders.order_events | Order lifecycle log | Restaurant | UNUSED — status changes go straight to orders.orders.status with no event log row. |

### Schema: payments

| Table | Purpose | Row Ownership | Notes |
|---|---|---|---|
| payments.payments | Payment record | Restaurant | UNUSED — Razorpay capture is stored in orders.orders.metadata JSONB; no payment row is created. |
| payments.payment_events | Payment provider event log | Restaurant | UNUSED. |

### Schema: dining

| Table | Purpose | Row Ownership | Notes |
|---|---|---|---|
| dining.tables | Physical tables | Restaurant | Used. |
| dining.sessions | Live dining session | Restaurant | Used. |
| dining.reservations | Pre-booked covers | Restaurant | Used. |
| dining.waitlist | Walk-in waitlist | Restaurant | UNUSED — no waitlist routes exist. |
| dining.reviews | Customer reviews | Restaurant | Used for new reviews; legacy reviews may exist in public.reviews (v9 table). |

### Schema: catering

| Table | Purpose | Row Ownership | Notes |
|---|---|---|---|
| catering.leads | Enquiry/CRM pipeline | Restaurant | Used. |
| catering.lead_notes | Follow-up activity log | Restaurant | UNUSED — no lead notes routes exist. |
| catering.events | Confirmed event execution | Restaurant | UNUSED — no event routes exist; leads stay in pipeline. |
| catering.event_days | Per-day operational records | Restaurant | UNUSED. |
| catering.enquiry_forms | Per-restaurant form config | Restaurant | UNUSED — leads route uses hardcoded Zod schema, not this table. |
| catering.quotes | Event quotation | Restaurant | UNUSED. |
| catering.quote_items | Line items for quotes | Restaurant | UNUSED. |
| catering.packages | Catering packages | Restaurant | UNUSED. |
| catering.package_items | Package line items | Restaurant | UNUSED. |

### Schema: insights

All insights tables (daily_metrics, item_performance, review_summary, events, menu_views, customer_segments, customer_events) are **UNUSED** — the insights.js route aggregates directly from orders and leads at query time with no pre-aggregation.

### Schema: platform

| Table | Purpose | Row Ownership | Notes |
|---|---|---|---|
| platform.audit_log | Audit trail | Platform | Used — writes from audit.js utility. |
| platform.export_jobs | Export request tracker | Platform | Used — written in settings.js and customers.js. |
| platform.customer_data_requests | DPDP compliance workflow | Platform | Used — written in customers.js delete-request and correct endpoints. |
| platform.benchmarks | Cross-tenant aggregated intelligence | Platform | UNUSED — no routes read or write benchmarks. |
| platform.notifications (v12 schema) | Platform notification store | Platform | SUPERSEDED — v19 creates notifications.notifications in its own schema. Conflict risk if both schemas are applied. |
| platform.event_outbox | Reliable event delivery | Platform | UNUSED — events use in-process Node EventEmitter, not this outbox. |
| platform.webhooks | Webhook endpoint registry | Platform | UNUSED — webhook_url lives in tenant.restaurants.settings JSONB. |
| platform.webhook_deliveries | Webhook delivery log | Platform | UNUSED. |
| platform.notification_templates | Notification message templates | Platform | UNUSED — notification.service.js writes literal strings. |
| platform.notification_engagement | Engagement tracking | Platform | UNUSED. |
| platform.events | Internal event bus (V9) | Platform | UNUSED — superseded by utils/events.js in-process EventEmitter. |
| platform.usage_events / usage_ledger | Usage metering | Platform | UNUSED. |
| platform.api_keys | API key registry | Platform | UNUSED — admin key is a single shared env var. |

### Schema: inventory

All inventory tables (items, movements) and the stock_levels view are **UNUSED** — no inventory routes or services exist.

### Schema: notifications (v19)

| Table | Purpose | Row Ownership | Notes |
|---|---|---|---|
| notifications.notifications | In-app notification store | Restaurant | Used — written by notification.service.js, read by notifications.js route. |
| tenant.notification_preferences | Per-tenant notification toggles | Restaurant | Used — checked before each notification write. |

---

## Section 3 — Migration Audit

### Migration Inventory

| File | Version | Purpose | Status |
|---|---|---|---|
| v9-tables.js | V9 | Add has_tables, reviews table, order_surface to public schema | SUPERSEDED — public schema tables were migrated to multi-schema in v12; column names differ (restaurant_id vs rest_id vs tenant_id). |
| v10-column-rename.js | V10 | Rename id→rest_id, price→price_paise across public tables | SUPERSEDED — v12 uses UUID PKs and tenant_id; price column is named price (NUMERIC) not price_paise. |
| v10-domain.js | V10 | Add domain column to restaurants | SUPERSEDED — domain moved to settings JSONB and tenant.domains table. |
| v11-story.js | V11 | Add story_headline, story_body, story_facts, map_url to restaurants | SUPERSEDED — these columns exist as transitional fields; in v12 story content lives in settings.presence JSONB. |
| v13-dine-in.js | V13 | Add session_id, deleted_at to public.orders | SUPERSEDED — v12 uses orders.orders with these columns natively. |
| v14-staff-password.js | V14 | Add password_hash to tenant.staff | APPLIED — v12 schema does not include password_hash in the CREATE TABLE, only added via this migration. SCHEMA DRIFT: the canonical schema is missing this column. |
| v15-plan.js | V15 | Convert plan from enum to VARCHAR | PARTIALLY APPLICABLE — v12 still uses restaurant_plan enum; v15 tries to cast it. If v12 was applied fresh, this migration is a no-op or conflicts. |
| v16-presence-content.js | V16 | Drop presence_content blob, add image_url to announcements | APPLIED — brand.announcements.image_url exists in practice but is missing from v12 SQL CREATE TABLE definition. SCHEMA DRIFT. |
| v17-razorpay-idempotency.js | V17 | Unique index on razorpay_order_id in metadata JSONB | References orders.orders schema — correct table. Safe to apply. |
| v18-governance.js | V18 | Create customer.consent_history, platform.export_jobs, platform.customer_data_requests, platform.benchmarks | APPLIED — these tables are used in routes. In sync with code. |
| v19-notifications.js | V19 | Create notifications schema and tables | UNTRACKED — this file is in ?? status (git untracked). Migration may or may not have been run. Routes require these tables; if not run, all notification endpoints will fail. |

### Critical Schema Drift Issues

1. **tenant.staff.password_hash** — Added by v14 migration, absent from kravon_schema_v12.sql. Fresh deployments will fail at login because the column does not exist.

2. **brand.announcements.image_url** — Added by v16 migration, absent from v12 SQL. Presence editor save will fail for featured items with images on fresh deployments.

3. **platform.notifications** — v12 schema defines this table in the platform schema. v19 creates a new notifications.notifications table in a separate schema. Both may exist simultaneously causing query confusion.

4. **v10-column-rename.js** renames `id` to `rest_id` on the old public.restaurants table. But v12 uses UUID PKs named `id`. If any deployment ran v10 before v12, these renames are on a schema that no longer exists. The migration runner has no version tracking.

5. **No migration runner with version tracking** — db/migrate.js exists but migrations are numbered by filename, not tracked in a schema_migrations table. There is no way to know which migrations have been applied to a given database.

6. **settings.js export query** references columns that do not exist in v12 schema:
   - `menu.menu_items.price_paise` — v12 uses `price` (NUMERIC)
   - `dining.reservations.party_name`, `party_phone`, `party_email` — v12 uses `customer_id` FK, not inline columns
   - `catering.leads.event_date`, `guest_count` — v12 uses `preferred_date_from`, `guest_count_min`/`guest_count_max`
   - `brand.themes.font_family` — v12 uses `font_heading`, `font_body`
   - These will cause `ERROR: column does not exist` at runtime for every full data export.

### Migrations That Should Be Consolidated

Migrations v9 through v13 all target the flat public schema that no longer exists in v12. These should be retired/archived and replaced with a single v20-backfill migration that establishes the authoritative state.

---

## Section 4 — API Audit

### Route: admin.js (prefix: /v1/admin)

| Route | Method | Auth Required | Tenant Scoped | Audit Logged | Event Emitted | Flags |
|---|---|---|---|---|---|---|
| /restaurants | GET | ADMIN_API_KEY | No (lists all) | No | No | MISSING_AUDIT |
| /restaurants | POST | ADMIN_API_KEY | No (creates) | No | No | MISSING_AUDIT, MISSING_EVENT |
| /restaurants/:slug | PUT | ADMIN_API_KEY | By slug | No | No | MISSING_AUDIT, MISSING_EVENT |
| /staff | POST | ADMIN_API_KEY | By slug in body | No | No | MISSING_AUDIT, MISSING_EVENT |

### Route: auth.js (prefix: /v1/auth)

| Route | Method | Auth Required | Tenant Scoped | Audit Logged | Event Emitted | Flags |
|---|---|---|---|---|---|---|
| /login | POST | None (rate-limited) | By slug in body | No | No | MISSING_AUDIT — failed logins not logged |
| /refresh | POST | None (cookie) | By token | No | No | MISSING_AUDIT |
| /change-password | POST | JWT | By staffId in JWT | No | No | MISSING_AUDIT — password change not logged |
| /logout | POST | JWT | By staffId in JWT | No | No | MISSING_AUDIT |

### Route: config.js (prefix: /v1/restaurants/:slug/config)

| Route | Method | Auth Required | Tenant Scoped | Audit Logged | Event Emitted | Flags |
|---|---|---|---|---|---|---|
| / | GET | None (public) | Yes (req.tenant) | No | No | — (intentionally public) |
| / | PATCH | JWT | Yes | Yes (audit.log) | No | MISSING_EVENT |
| /items/:id | GET | None (public) | Yes | No | No | — |

**Note:** PATCH /config handles Razorpay key updates. The Razorpay key secret is a sensitive credential. While audit.log fires, the newValue logged includes the raw key_id (not the secret). This is acceptable but should be documented.

### Route: presence.js (prefix: /v1/restaurants/:slug/presence)

| Route | Method | Auth Required | Tenant Scoped | Audit Logged | Event Emitted | Flags |
|---|---|---|---|---|---|---|
| / | GET | JWT | Yes | No | No | MISSING_AUDIT |
| / | PATCH | JWT | Yes | No | No | MISSING_AUDIT, MISSING_EVENT |

### Route: menu.js (prefix: /v1/restaurants/:slug/menu)

| Route | Method | Auth Required | Tenant Scoped | Audit Logged | Event Emitted | Flags |
|---|---|---|---|---|---|---|
| /categories | GET | None (public) | Yes | No | No | — |
| /categories | POST | JWT | Yes | No | No | MISSING_AUDIT, MISSING_EVENT |
| /categories/:id | PUT | JWT | Yes | No | No | MISSING_AUDIT, MISSING_EVENT |
| /categories/:id | DELETE | JWT | Yes | No | No | MISSING_AUDIT, MISSING_EVENT |
| /items | POST | JWT | Yes | No | No | MISSING_AUDIT, MISSING_EVENT |
| /items/:id | PUT | JWT | Yes | No | No | MISSING_AUDIT, MISSING_EVENT |
| /items/:id | DELETE | JWT | Yes | No | No | MISSING_AUDIT, MISSING_EVENT |
| /items/:id/availability | PATCH | JWT | Yes | No | No | MISSING_AUDIT, MISSING_EVENT |
| /items/:id/variants | GET | JWT | Yes | No | No | — |
| /items/:id/variants | POST | JWT | Yes | No | No | MISSING_AUDIT, MISSING_EVENT |
| /items/:id/variants/:vid | PUT | JWT | Yes | No | No | MISSING_AUDIT, MISSING_EVENT |
| /items/:id/variants/:vid | DELETE | JWT | Yes | No | No | MISSING_AUDIT, MISSING_EVENT |
| /items/:id/customizations | GET | JWT | Yes | No | No | — |
| /items/:id/customizations/groups | POST | JWT | Yes | No | No | MISSING_AUDIT, MISSING_EVENT |
| /items/:id/customizations/groups/:gid | DELETE | JWT | Yes | No | No | MISSING_AUDIT, MISSING_EVENT |
| /items/:id/customizations/groups/:gid/options | POST | JWT | Yes | No | No | MISSING_AUDIT, MISSING_EVENT |
| /items/:id/customizations/options/:oid | DELETE | JWT | Yes | No | No | MISSING_AUDIT, MISSING_EVENT |

**The entire menu mutation surface has zero audit logging.** A staff member can add, edit, or delete menu items and there is no record of who did it.

### Route: orders.js (prefix: /v1/restaurants/:slug/orders)

| Route | Method | Auth Required | Tenant Scoped | Audit Logged | Event Emitted | Flags |
|---|---|---|---|---|---|---|
| / | POST | None (public) | Yes | No | Yes (order.created) | MISSING_AUDIT |
| / | GET | JWT | Yes | No | No | MISSING_AUDIT |
| /:id | GET | JWT | Yes | No | No | — |
| /:id/items | GET | JWT | Yes | No | No | — |
| /:id | PATCH | JWT | Yes | Yes (audit.log) | Yes (order.status_updated) | — |

### Route: customers.js (prefix: /v1/restaurants/:slug/customers)

| Route | Method | Auth Required | Tenant Scoped | Audit Logged | Event Emitted | Flags |
|---|---|---|---|---|---|---|
| / | GET | JWT | Yes | No | No | — |
| /:id | GET | JWT | Yes | No | No | — |
| /:id | PATCH | JWT | Yes | No | No | MISSING_AUDIT — notes/tags update not logged |
| /:id/export | GET | JWT + requireRole(owner,admin) | Yes | Yes | Yes | — |
| /:id/delete-request | POST | JWT + requireRole(owner,admin) | Yes | Yes | Yes | — |
| /:id/correct | POST | JWT + requireRole(owner,admin) | Yes | Yes | Yes | — |

### Route: leads.js (prefix: /v1/restaurants/:slug/leads)

| Route | Method | Auth Required | Tenant Scoped | Audit Logged | Event Emitted | Flags |
|---|---|---|---|---|---|---|
| / | POST | None (public) | Yes | No | Yes (lead.created) | MISSING_AUDIT |
| / | GET | JWT | Yes | No | No | — |
| /:id | PATCH | JWT | Yes | No | Yes (lead.status_updated) | MISSING_AUDIT |

### Route: reviews.js (prefix: /v1/restaurants/:slug/reviews)

| Route | Method | Auth Required | Tenant Scoped | Audit Logged | Event Emitted | Flags |
|---|---|---|---|---|---|---|
| / | POST | None (public) | Yes | No | Yes (review.submitted) | MISSING_AUDIT |

### Route: staff.js (prefix: /v1/restaurants/:slug/staff)

| Route | Method | Auth Required | Tenant Scoped | Audit Logged | Event Emitted | Flags |
|---|---|---|---|---|---|---|
| / | GET | JWT | Yes | No | No | — |
| / | POST | JWT | Yes | No | No | MISSING_AUDIT, MISSING_EVENT |
| /:id | PATCH | JWT | Yes | No | No | MISSING_AUDIT, MISSING_EVENT — password changes by another staff not logged |
| /:id | DELETE | JWT | Yes | No | No | MISSING_AUDIT, MISSING_EVENT |

**Staff management has no audit logging.** A manager can create, deactivate, or delete staff accounts without any record.

### Route: dine-in.js (prefix: /v1/restaurants/:slug/dine-in)

| Route | Method | Auth Required | Tenant Scoped | Audit Logged | Event Emitted | Flags |
|---|---|---|---|---|---|---|
| /session/open | POST | JWT | Yes | Yes (audit.log) | Yes (session.opened) | — |
| /session/close | POST | JWT | Yes | Yes (audit.log) | Yes (session.closed) | — |
| /session/status | GET | None (rate-limited) | Yes | No | No | — |
| /order | POST | None (rate-limited) | Yes | No | Yes (dine_in.order_created) | MISSING_AUDIT |
| /reservations | POST | None (public) | Yes | No | Yes (reservation.created) | MISSING_AUDIT |
| /reservations | GET | JWT | Yes | No | No | — |
| /reservations/:id | PATCH | JWT | Yes | No | Yes (reservation.status_updated) | MISSING_AUDIT |
| /kitchen | GET | JWT | Yes | No | No | — |
| /bill | GET | JWT | Yes | No | No | — |

### Route: tables.js (prefix: /v1/restaurants/:slug/tables)

| Route | Method | Auth Required | Tenant Scoped | Audit Logged | Event Emitted | Flags |
|---|---|---|---|---|---|---|
| / | GET | JWT | Yes | No | No | — |
| /sessions | GET | JWT | Yes | No | No | — |
| / | POST | JWT | Yes | No | No | MISSING_AUDIT, MISSING_EVENT |
| /:id | PUT | JWT | Yes | No | No | MISSING_AUDIT, MISSING_EVENT |
| /:id | DELETE | JWT | Yes | No | No | MISSING_AUDIT, MISSING_EVENT |

### Route: insights.js (prefix: /v1/restaurants/:slug/insights)

| Route | Method | Auth Required | Tenant Scoped | Audit Logged | Event Emitted | Flags |
|---|---|---|---|---|---|---|
| /summary | GET | JWT | Yes | No | No | — |
| /orders | GET | JWT | Yes | No | No | — |

### Route: notifications.js (prefix: /v1/restaurants/:slug/notifications)

| Route | Method | Auth Required | Tenant Scoped | Audit Logged | Event Emitted | Flags |
|---|---|---|---|---|---|---|
| / | GET | JWT | Yes | No | No | — |
| /read-all | POST | JWT | Yes | No | No | — |
| /:id/read | POST | JWT | Yes | No | No | — |

### Route: settings.js (prefix: /v1/restaurants/:slug/settings)

| Route | Method | Auth Required | Tenant Scoped | Audit Logged | Event Emitted | Flags |
|---|---|---|---|---|---|---|
| /export | POST | JWT + requireRole(owner,admin) | Yes | Yes | Yes (settings.exported) | — (but will FAIL at runtime — wrong column names) |

### Route: webhooks.js (prefix: /v1/webhooks)

| Route | Method | Auth Required | Tenant Scoped | Audit Logged | Event Emitted | Flags |
|---|---|---|---|---|---|---|
| /razorpay | POST | HMAC signature | No (resolves from order) | No | No | MISSING_AUDIT |

---

## Section 5 — Permission Audit

### Role → Permissions → Routes

| Role | Where Checked | Routes Controlled |
|---|---|---|
| Any authenticated staff | requireRestaurantAuth | All admin routes |
| owner, admin | requireRole('owner', 'admin') | customers/:id/export, customers/:id/delete-request, customers/:id/correct, settings/export |

### Critical Permission Gaps

1. **tenant.permissions table is NEVER QUERIED.** The schema defines granular permission keys (e.g. `orders.read`, `menu.write`) but zero code reads from this table. Authorization is binary: either the JWT matches the tenant (requireRestaurantAuth) or it checks for the 'owner'/'admin' role. Fine-grained permissions defined in the DB are dead weight.

2. **Staff CRUD routes have no role restriction.** Any authenticated staff member can create, edit, deactivate, or delete other staff members. A staff-level employee can create another admin or delete the owner's account.
   - File: `kravon-engine/backend/api/routes/staff.js`, all handlers
   - Risk: Privilege escalation — a lower-privileged staff can promote themselves.

3. **Menu write routes have no role restriction.** Any staff member can add, edit, or delete menu items and categories.
   - File: `kravon-engine/backend/api/routes/menu.js`, all mutation handlers
   - Risk: Unauthorized menu manipulation.

4. **Config PATCH has no role restriction.** Any authenticated staff member can update Razorpay keys, delivery fees, and Google Review URL.
   - File: `kravon-engine/backend/api/routes/config.js`, PATCH /
   - Risk: A kitchen staff member can remove payment credentials.

5. **requireRole() does not verify that the role is in the correct tenant's role set.** It only checks `req.auth.roles` which comes from the JWT. If a JWT is created with forged roles, the check passes. However, JWT is server-signed so this is only exploitable if JWT_SECRET is compromised.

6. **Orphan permissions:** The `tenant.roles` table has rows created during staff creation (via staff.js), but no permission keys are ever inserted into `tenant.permissions`. The roles system exists in schema but has no actual permissions attached.

---

## Section 6 — Governance Audit

### What Exists

- `customer.consent_history` table: created, indexed, queried in customer export endpoint.
- `platform.customer_data_requests` table: created, written on delete-request and correct operations.
- `platform.export_jobs` table: created, written on full data export.
- `platform.audit_log` table: written by audit.js utility on select operations.
- Customer export endpoint (GET /:id/export): returns profile, orders, reservations, consent_history.
- Tenant full export (POST /settings/export): returns all customer, order, menu, settings data.

### Governance Gaps

1. **Customer delete-request creates a platform.customer_data_requests row but does NOT actually delete the customer.** The actual deletion must be performed manually by the platform operator. There is no automated deletion workflow, no status update endpoint, and no TTL enforcement. A deletion request can be submitted and then silently ignored forever.
   - File: `kravon-engine/backend/api/routes/customers.js`, POST /:id/delete-request (lines 215–249)
   - Risk: DPDP non-compliance — the law requires deletion within a reasonable period.

2. **Consent history is read-only (append-only audit log) but no routes WRITE to consent_history.** There is no endpoint to record when a customer grants or revokes consent. The table exists but is never populated by current code; therefore the export will always return an empty consent_history array.
   - Risk: Consent history cannot be defended in a DPDP audit without actual consent capture.

3. **Audit log does not cover:** menu writes, staff creation/deletion, reservation creation, table creation, all auth events (login, logout, password change). This is a large surface of unlogged mutations.

4. **settings/export queries non-existent columns** (price_paise, party_name, party_phone, party_email, event_date, guest_count, font_family). This route will throw a PostgreSQL error on every invocation, making the export system completely non-functional.
   - File: `kravon-engine/backend/api/routes/settings.js`, lines 94–115

5. **No data retention policy enforcement.** notifications.notifications has a 90-day TTL in expires_at but there is no background job to purge expired rows. The index on expires_at exists but no scheduler calls DELETE WHERE expires_at < NOW().

6. **Webhook outbound payload uses rest_id (integer)** in webhook.js (lines 65, 72, 80, 87) but tenant_id is now a UUID. The `tenant.rest_id` field does not exist; it will send `undefined` in every webhook payload.
   - File: `kravon-engine/backend/integrations/webhook.js`, lines 65–87

---

## Section 7 — Notification Readiness

### Routes That Currently Emit Events

| Event | Emitted From | Listeners |
|---|---|---|
| order.created | orders.js POST / | notification.listeners → notif.create |
| order.status_updated | orders.js PATCH /:id | notification.listeners → notif.create |
| dine_in.order_created | dine-in.js POST /order | notification.listeners → notif.create |
| session.opened | dine-in.js POST /session/open | notification.listeners → notif.create |
| session.closed | dine-in.js POST /session/close | notification.listeners → notif.create |
| reservation.created | dine-in.js POST /reservations | notification.listeners → notif.create |
| reservation.status_updated | dine-in.js PATCH /reservations/:id | notification.listeners → notif.create |
| lead.created | leads.js POST / | notification.listeners → notif.create |
| lead.status_updated | leads.js PATCH /:id | notification.listeners → notif.create |
| review.submitted | reviews.js POST / | notification.listeners → notif.create |
| customer.export_requested | customers.js GET /:id/export | notification.listeners → notif.create |
| customer.delete_requested | customers.js POST /:id/delete-request | notification.listeners → notif.create |
| customer.correct_requested | customers.js POST /:id/correct | notification.listeners → notif.create |
| settings.exported | settings.js POST /export | notification.listeners → notif.create |

### Routes That Should Emit Events But Don't

| Missing Event | Route | Business Impact |
|---|---|---|
| menu.item_created | menu.js POST /items | Can't notify on new menu item |
| menu.item_updated | menu.js PUT /items/:id | No audit trail for menu changes |
| menu.item_availability_changed | menu.js PATCH /items/:id/availability | Availability changes are silent |
| menu.category_deleted | menu.js DELETE /categories/:id | Silent destruction of a category with all items |
| config.updated | config.js PATCH / | Settings changes (including payment keys) are silent |
| staff.created | staff.js POST / | No notification when new staff added |
| staff.deactivated | staff.js PATCH /:id (is_active=false) | No alert when a staff account is disabled |
| staff.deleted | staff.js DELETE /:id | No notification for staff deletion |
| table.created | tables.js POST / | Silent table creation |
| table.deleted | tables.js DELETE /:id | Silent table deletion |
| customer.notes_updated | customers.js PATCH /:id | CRM annotation changes are untracked |
| review.moderated (future) | — | No review management workflow yet |
| payment.received | webhooks.js | Razorpay webhook does not emit platform event |
| payment.failed | webhooks.js | Payment failures are silent to the notification system |

### Ideal Event Catalogue

Events that should exist but currently only appear in notification.listeners as no-op stubs:
- `payment.received` — Razorpay payment.captured webhook confirmed an order
- `payment.failed` — Razorpay payment failed (no current detection)
- `subscription.expiring` — 7 days before plan expiry
- `subscription.expired` — plan has lapsed
- `customer.first_order` — customer's first order with this restaurant
- `customer.repeat_visit` — customer returning after N days
- `menu.item_out_of_stock` — triggered by availability toggle
- `staff.created` — new team member added
- `staff.invited` — invitation sent (not yet implemented)

---

## Section 8 — Tenant Isolation Audit

Every route must filter by `tenant_id` from `req.tenant.tenant_id` (injected by resolveRestaurant middleware). The following is an exhaustive review.

### SAFE Routes (tenant_id filter confirmed in every query)

- orders.js: All queries filter `tenant_id = req.tenant.tenant_id` ✓
- customers.js: All queries filter `tenant_id = req.tenant.tenant_id` ✓
- menu.js: All writes filter `tenant_id = req.tenant.tenant_id` ✓
- leads.js: All queries filter `tenant_id = req.tenant.tenant_id` ✓
- staff.js: All queries filter `tenant_id = req.tenant.tenant_id` ✓
- tables.js: All queries filter `tenant_id = req.tenant.tenant_id` ✓
- dine-in.js: All session and order queries filter by tenant_id ✓
- insights.js: Both queries filter `tenant_id = $1` ✓
- notifications.js: All queries filter `tenant_id = $1` ✓
- reviews.js: Order ownership check uses `tenant_id = r.tenant_id` ✓

### RISK: requireRestaurantAuth JWT-to-Tenant Check

`requireRestaurantAuth` (auth.js line 32) checks:
```js
if (req.auth.tenantId !== req.tenant.tenant_id) {
  return res.status(403).json({ error: 'Forbidden' });
}
```
This is correct — it prevents staff from Restaurant A reading data from Restaurant B. However:

**ISSUE:** `req.auth.tenantId` (from the JWT) is a string, and `req.tenant.tenant_id` (from the DB query result via pg) is also a string (UUID). The strict inequality `!==` is safe here. This check is solid.

### RISK: webhooks.js — No Tenant Isolation Check

`POST /v1/webhooks/razorpay` does not go through `resolveRestaurant`. It resolves the tenant by looking up `metadata->>'razorpay_order_id'` in orders.orders. The UPDATE query at lines 95–107 updates **any** order matching the razorpay_order_id without a tenant_id filter:

```sql
UPDATE orders.orders
SET status = 'confirmed', metadata = metadata || $1, updated_at = NOW()
WHERE metadata->>'razorpay_order_id' = $2
  AND status = 'pending'
RETURNING *
```

This is acceptable because razorpay_order_id is globally unique (enforced by v17 index) and the update is bounded by the unique index. The intent is safe but lacks an explicit tenant_id guard. If two tenants somehow shared a Razorpay order ID (which the unique index prevents), one could confirm the other's order.

### RISK: dine-in.js /session/status and /order — Public Routes

These routes go through `resolveRestaurant` (tenant resolved from slug in URL) but have **no auth**. A customer can query any table's session status knowing only the slug and table_id UUID. This is intentional (QR scan workflow), but the table_id must be a UUID which is sufficiently opaque.

**RISK:** The session/status query (lines 198–228) correctly filters `s.tenant_id = $2`. Safe.

**RISK:** The /order handler (dine-in.js line 241) correctly verifies session belongs to tenant. Safe.

### CRITICAL: staff.js DELETE Does Not Filter by Tenant on Sessions Revoke

```js
await query(
  `UPDATE tenant.staff_sessions SET revoked_at = NOW()
   WHERE staff_id = $1 AND revoked_at IS NULL`,
  [req.params.id]
);
```
This is at `kravon-engine/backend/api/routes/staff.js` line 158. The sessions revoke does NOT include a `tenant_id` filter. If a staff_id UUID were guessable or somehow collided with a staff member at another tenant, their sessions could be revoked. In practice, UUID v4 IDs make collision impossible, but the missing filter is a code quality issue that should be fixed.

### CRITICAL: config.js /items/:id — Public Route with No Tenant Auth Check on Item Existence

```js
router.get('/items/:id', async (req, res, next) => {
  const itemRes = await query(`
    SELECT id, name, price, ...
    FROM menu.menu_items
    WHERE id = $1 AND tenant_id = $2 AND is_available = TRUE AND deleted_at IS NULL
  `, [itemId, tenantId]);
```
The tenant_id filter is present. Safe.

### OVERALL TENANT ISOLATION VERDICT

No cross-tenant data leakage pathways identified. The architecture of resolveRestaurant + requireRestaurantAuth provides correct tenant scoping. The staff sessions revoke missing filter is a minor hardening gap, not an exploitable leak.

---

## Section 9 — Performance Audit

### CRITICAL Priority

1. **Insights routes run full table scans on large tables on every request.**
   - `insights.js GET /summary` runs three uncached-on-DB COUNT/SUM queries over `orders.orders` and `catering.leads` with a 30-day window filter.
   - The in-memory cache (`_cache`) is per-process and lost on restart. On Railway with multiple dynos, every dyno runs its own cache; parallel requests all hit the DB.
   - **Missing index:** `orders.orders` has `idx_orders_tenant(tenant_id, created_at DESC)` but the summary query also filters `status IN ('completed', 'delivered')`. No composite index on `(tenant_id, status, created_at)`.
   - Priority: **CRITICAL** for tenants with > 10,000 orders.

2. **resolveRestaurant fires 6 parallel queries on every cache miss.**
   - `tenant.js` executes: restaurants lookup + locations + integrations + contact_links + seo + assets + announcements — 7 total queries per uncached request.
   - Cache TTL is 60 seconds. At low traffic this is fine. At high traffic with many tenants, the cache will frequently miss.
   - Priority: **HIGH**

### HIGH Priority

3. **Customization loading in config.js /items/:id uses N+1 pattern.**
   - `config.js` lines 499–523: For each customization group, fires a separate `SELECT FROM menu.customization_options WHERE group_id = $1` query inside a `Promise.all(groupsRes.rows.map(async (group) => ...))`.
   - This is N+1 on the number of customization groups. A menu item with 5 groups fires 5 sequential queries.
   - File: `kravon-engine/backend/api/routes/config.js`, lines 499–523
   - Priority: **HIGH** — Fix with a single `WHERE group_id = ANY($1)` query.

4. **tables.js GET / fires a correlated subquery per table row.**
   ```sql
   COALESCE(
     (SELECT SUM(o.total_amount) FROM orders.orders o
      WHERE o.session_id = s.id AND ...),
     0
   ) AS session_total
   ```
   - File: `kravon-engine/backend/api/routes/tables.js`, lines 33–38
   - This is an N+1 equivalent inside a single SQL query (correlated subquery executed per table row).
   - Priority: **HIGH** — Replace with a LEFT JOIN and GROUP BY.

5. **tables.js GET /sessions also uses a correlated subquery.**
   - Same pattern at lines 76–82 and 83–86.
   - Priority: **HIGH**

### MEDIUM Priority

6. **Missing index on orders.orders (tenant_id, channel).**
   - `orders.js GET /` accepts a `channel` filter. There is no composite index on `(tenant_id, channel)`. Full tenant scan on channel filter.
   - Priority: **MEDIUM**

7. **settings.js POST /export loads ALL customer and order rows into Node.js memory.**
   - No LIMIT or pagination on the export queries. For a large restaurant with 100,000 customers and 500,000 orders, this will cause an OOM crash.
   - File: `kravon-engine/backend/api/routes/settings.js`, lines 42–115
   - Priority: **MEDIUM** — Add streaming or paginated export.

8. **customers.js GET / uses a large JOIN aggregation without index on total_spent.**
   - The query joins `orders.orders` via `customer_id` and aggregates `COUNT`, `SUM`, `MAX`. The index `idx_orders_customer` exists and will be used.
   - Priority: **LOW** for now; watch as order volume grows.

9. **menu.js GET /categories returns all items flat and pivots in Node.js.**
   - This is fine at menu scale but the JOIN returns O(categories × items) rows and processes them in a JavaScript Map. For a menu with 50 categories and 500 items, this returns 500 rows — acceptable.
   - Priority: **LOW**

### LOW Priority

10. **In-memory insights cache has no size cap and grows unbounded.**
    - `_cache` in insights.js line 31 allows `_cache.size > 200` before eviction but the eviction is a single delete per set operation.
    - Priority: **LOW**

---

## Section 10 — Dead Code Audit

### Unused Services

- `kravon-engine/backend/services/notify.service.js` — NOT dead; called from order.service.js, lead.service.js, and webhooks.js.
- `kravon-engine/backend/services/notification.listeners.js` — NOT dead; registered at server boot.
- `kravon-engine/backend/services/notification.service.js` — NOT dead; called by listeners.
- `kravon-engine/backend/integrations/email.js` — **LIKELY DEAD** — it is listed in the integrations directory but is NOT imported by any service, route, or server file. The email integration was set up but never connected.
  - Recommend: Verify and delete if unused, or wire to a notification channel.

### Unused Utilities

- All three utilities (audit.js, events.js, crypto.js) are actively used. None are dead.

### Unused Routes (registered but frontend never calls)

The dashboard app.js VIEWS object has 12 views but does NOT include a 'notifications' view. The `NotifBell` component accesses `/notifications` via `Api.rGet('/notifications')` but the notifications view is not a navigable page. The `/notifications` API route exists and is called, but there is no standalone notifications view in the app. This is by design (bell dropdown), not dead code.

**DEAD ROUTE CANDIDATE:** `config.js GET /items/:id` — This route is mounted under `/v1/restaurants/:slug/config/items/:id` which is inconsistent with the menu routes under `/v1/restaurants/:slug/menu/items/:id`. The frontend uses `Api.rGet('/config/items/:id')` indirectly through presence frontend JS. Verify actual call paths.

### Unused Frontend Files

Review of the frontend views in app.js VIEWS map:
- `OverviewView`, `OrdersView`, `MenuView`, `ReservationsView`, `TablesView`, `KitchenView`, `CateringView`, `InsightsView`, `CustomersView`, `StaffView`, `PresenceView`, `SettingsView` — all registered and navigable.

**NOT IN VIEWS MAP but loaded as script:** `notifications.js` (NotifBell) — correct, it's a bell widget not a full view.

### Unused DB Seeds (dead files, not code)

- `kravon-engine/backend/db/seeds/fetch-assets.js` — fetches Unsplash images; dev utility only.
- `kravon-engine/backend/db/seeds/verify-dummy-presence-restaurant.js` — verification script, not application code.

### Dead Schema Objects

The following tables are defined in v12 schema but have ZERO references in any route, service, or migration:
- `tenant.domains`, `tenant.operating_hours`, `tenant.virtual_brands`, `tenant.staff_locations`
- `tenant.tax_rules`, `tenant.tax_rule_items`, `tenant.subscriptions`, `tenant.feature_flags`
- `customer.addresses`, `customer.loyalty_accounts`, `customer.loyalty_transactions`
- `customer.feedback`, `customer.interaction_log`, `customer.identities`
- `orders.order_item_customizations`, `orders.order_taxes`, `orders.order_discounts`
- `orders.coupons`, `orders.delivery_jobs`, `orders.order_events`
- `payments.payments`, `payments.payment_events`
- `dining.waitlist`
- `catering.lead_notes`, `catering.events`, `catering.event_days`, `catering.enquiry_forms`
- `catering.quotes`, `catering.quote_items`, `catering.packages`, `catering.package_items`
- All of `insights` schema
- `platform.event_outbox`, `platform.webhooks`, `platform.webhook_deliveries`
- `platform.notification_templates`, `platform.notification_engagement`
- `platform.events`, `platform.usage_events`, `platform.usage_ledger`, `platform.api_keys`
- All of `inventory` schema

These represent roughly 40+ tables that consume DB resources, inflate schema complexity, and create maintenance burden with zero current business value.

---

## Section 11 — Architecture Review

### Tight Coupling Issues

1. **Razorpay integration upsert logic is duplicated in admin.js (lines 142–149, 276–298) and config.js (lines 422–444).** Both blocks perform the same read-existing → encrypt → insert/update pattern on `tenant.integrations`. Any change to Razorpay key handling must be made in two places. Extract to a shared `integrations.service.js`.

2. **Tenant resolution (tenant.js) is tightly coupled to the DB schema.** The `buildTenant()` function assembles a large flat object from 7 tables. Adding a new field to the tenant object requires modifying this function even if the field is only used by one route. Consider a lighter tenant object with lazy loading for rarely-used fields.

3. **Presence PATCH (presence.js lines 94–357) is a 260-line mega-handler** that directly writes to 7 different tables in a single request. No transaction wraps all the writes, which means partial failures leave the data in a half-applied state. If `brand.assets` write succeeds but the `tenant.restaurants settings` update fails, the gallery is saved but the presence config reference is not.
   - File: `kravon-engine/backend/api/routes/presence.js`, PATCH /

4. **notify.service.js is called directly from order.service.js and lead.service.js** rather than emitting events. The `order.service.js` calls `notifyService.orderConfirmed()` directly (line 186) for offline/COD orders. The webhook route also calls it directly (line 139). This bypasses the event bus and makes the notification channel untestable in isolation. Switch to `events.emit('order.confirmed', ...)` and add a listener in notification.listeners.js.

### Duplicated Business Logic

1. **Customer upsert logic** appears in `order.service.js` (line 76) and `dine-in.js` /reservations handler (line 370). Both use the same ON CONFLICT pattern. Extract to `customer.service.js`.

2. **Delivery fee calculation** is duplicated between `order.service.js` (lines 57–65) and `config.js` (where deliveryStandard/Express are returned in config). The frontend receives config pricing and the backend recalculates independently — the only real protection against manipulation — but the logic is written twice.

### Future Scaling Bottlenecks

1. **In-process EventEmitter** (`utils/events.js`) is the entire event bus. It is synchronous and in-process. When the platform runs on multiple instances (Railway, Fly.io, Kubernetes), events emitted on instance A are invisible to listeners on instance B. The order.created event fires the notification insert only on the instance that handled the request. On the other instance, the bell count will be stale until the next poll.
   - Migration path: Replace EventEmitter with a Redis pub/sub, BullMQ, or PostgreSQL LISTEN/NOTIFY.

2. **In-memory caches** (tenant.js, config.js, insights.js) are per-process. In multi-instance deployments, each instance has its own cache. A PATCH /config on one instance updates the DB and busts that instance's cache, but all other instances keep serving the stale config for up to 60 seconds.
   - Migration path: Redis for shared cache with event-driven invalidation.

3. **Export endpoint is synchronous and blocking.** `POST /settings/export` runs 8 parallel DB queries, assembles all results in memory, and returns a potentially multi-megabyte JSON response. For large tenants this will: (a) time out at the HTTP layer, (b) exhaust Node.js heap, (c) block the event loop during JSON.stringify.
   - Migration path: Async export → S3 → presigned URL; track progress via platform.export_jobs (which already exists).

4. **insights.js is a read-query-aggregation route with no pre-computed materialized views.** At 100,000+ orders, a COUNT/SUM/GROUP BY over the full table will take multiple seconds per request. The in-memory cache helps but is not durable.

### Single Points of Failure

1. **JWT_SECRET is a single key with no rotation mechanism.** Rotating the JWT secret requires a deployment that invalidates all existing access tokens instantly. No key rotation infrastructure exists.

2. **ADMIN_API_KEY is a single shared secret.** All admin operations (restaurant creation, staff creation) use this one key. There is no per-operator admin key, no key rotation, and no audit of which admin operation was performed by whom.

3. **ENCRYPTION_KEY is a single key for all Razorpay secrets.** Key rotation would require re-encrypting all stored credentials. No rotation mechanism exists.

4. **.env file contains production credentials.** The DATABASE_URL, JWT_SECRET, ADMIN_API_KEY, and ENCRYPTION_KEY are committed to the repository in plaintext. Any repository access (including CI/CD logs, git history) exposes full platform compromise.
   - **This is the single highest-severity finding in this audit.**

---

## Section 12 — Next Migration Recommendations

### Migration 20: Fix Critical Schema Drift (Highest Impact)

**Name:** v20-schema-sync

**Purpose:** Bring the live database in sync with what the application code actually expects, and add columns the v12 SQL CREATE TABLE definition is missing.

**Tables/Columns Affected:**
- `tenant.staff`: Add `password_hash TEXT` (added by v14 but absent from v12 DDL)
- `brand.announcements`: Add `image_url TEXT` (added by v16 but absent from v12 DDL)
- `notifications` schema: Confirm v19 has been applied; if not, apply it
- Add `schema_migrations` table to track migration state going forward

**Why This is the Right Next Step:**
Fresh deployments of the platform from the canonical v12.sql will fail at login (missing password_hash) and at featured item saving (missing image_url). These are silent production failures that only manifest under specific user actions. This migration makes the canonical schema match the live production schema and prevents future deployments from being broken out of the box.

**SQL sketch:**
```sql
-- Safe re-run with IF NOT EXISTS guards
ALTER TABLE tenant.staff ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE brand.announcements ADD COLUMN IF NOT EXISTS image_url TEXT;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO schema_migrations (version) VALUES
  ('v9'),('v10-column-rename'),('v10-domain'),('v11'),
  ('v13'),('v14'),('v15'),('v16'),('v17'),('v18'),('v19')
ON CONFLICT DO NOTHING;
```

---

### Migration 21: Fix settings/export Column Names (High Impact)

**Name:** v21-export-column-aliases

**Purpose:** Fix the settings.js full data export route so it doesn't crash on every execution due to referencing v9-era column names that don't exist in v12.

**Tables/Columns Affected:**
- No DDL changes required — the fix is in application code (settings.js), not the schema.
- However, this migration should also add missing indexes that the export queries rely on:
  - `CREATE INDEX IF NOT EXISTS idx_reservations_tenant_export ON dining.reservations(tenant_id, deleted_at) WHERE deleted_at IS NULL`
  - `CREATE INDEX IF NOT EXISTS idx_catering_leads_tenant_export ON catering.leads(tenant_id, deleted_at) WHERE deleted_at IS NULL`

**Code changes required in addition to SQL:**
- `settings.js` line 93: Change `price_paise` → `price`
- `settings.js` lines 69–76: Change `party_name, party_phone, party_email, reservation_date, reservation_time` to match v12 dining.reservations schema (uses customer_id FK and `reservation_time TIMESTAMPTZ`)
- `settings.js` lines 78–85: Change `event_date, guest_count` to `preferred_date_from, guest_count_min`
- `settings.js` lines 108–115: Change `font_family` to `font_heading`

**Why This is the Right Next Step:**
The full data export is the centrepiece of DPDP compliance. It is broken today. Every owner/admin who tries to export their data gets a 500 error. Fixing this is both a legal obligation and a trust signal.

---

### Migration 22: Introduce Audit Coverage for Menu and Staff (Medium-High Impact)

**Name:** v22-audit-expansion

**Purpose:** Ensure all destructive operations (menu edits, staff changes, config updates) are covered by the audit log.

**Tables/Columns Affected:**
- `platform.audit_log` already exists; no DDL changes needed.
- Application code changes across menu.js, staff.js, config.js (PATCH /), presence.js (PATCH /).

**Why This is the Right Next Step:**
Without audit coverage on menu and staff operations, there is no forensic trail when something goes wrong (menu items deleted by mistake, unauthorized price changes, staff accounts tampered with). This is the minimum required for an operator-grade SaaS product. The infrastructure (audit.log utility) already exists — it just needs to be called in the missing routes.

---

*End of KRAVON Platform State Report*
*Generated: 2026-06-03*
*Auditor: Claude Code (Anthropic)*
