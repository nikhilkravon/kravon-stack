# KRAVON V20 Schema Consolidation Report
**Date:** 2026-06-03
**Production state entering V20:** Migrations v1–v19 applied
**Canonical baseline file:** kravon_schema_v20.sql
**Production upgrade file:** v20-foundation.js

---

## 1. Executive Summary

V20 is the permanent production baseline. It supersedes all incremental migrations v9–v19 and resolves every known source of schema drift, ambiguity, and maintenance burden.

### What V20 changes vs current production

| Category | Change |
|----------|--------|
| Schema drift | `tenant.staff.password_hash` (v14) and `brand.announcements.image_url` (v16) — present in prod via migrations, absent from kravon_schema_v12.sql — now in canonical file |
| Enum replacement | `restaurant_plan` ENUM dropped; `plan` is now `VARCHAR(20)` with CHECK constraint (v15 did this in prod; v20 makes it the baseline) |
| New schema | `notifications` schema with `notifications.notifications` and `tenant.notification_preferences` (v19) |
| New governance tables | `customer.consent_history`, `platform.export_jobs`, `platform.customer_data_requests`, `platform.benchmarks` (v18) |
| Migration tracking | `platform.schema_migrations` NEW — eliminates the "did v19 run?" class of production incidents |
| Razorpay indexes | Both functional indexes from v17 now in canonical file |
| Notification clarity | `platform.notifications` (outbound to customers) and `notifications.notifications` (in-app staff dashboard feed) are declared authoritative for different purposes — documented, not conflated |

### Health improvements
- Fresh installs from one file work completely — no secondary migrations needed
- Migration state is tracked in `platform.schema_migrations`
- Schema drift between SQL file and production is zero
- Notification dual-namespace is intentional and documented

### Deferred to V21+
- Missing composite indexes on hot query paths (`orders.orders` tenant+status, `catering.leads` tenant+created_at) — performance, not correctness
- `settings/export` column name bugs (`price_paise`, `party_name`, etc.) — application code fix, no schema change
- Wiring `tenant.permissions` to auth middleware — closes privilege escalation gap
- Rename `platform.notifications` to `platform.outbound_messages` for clarity (requires app code change)

---

## 2. Table Classification

### tenant schema

| Table | Classification | Notes |
|-------|---------------|-------|
| restaurants | ACTIVE | Root record. Every request hits this via slug lookup |
| locations | ACTIVE | dine-in, orders, reservations |
| domains | ACTIVE | Custom domain resolution in middleware |
| operating_hours | PLANNED | No route reads it. Needed for ordering-hours enforcement |
| virtual_brands | PLANNED | Cloud kitchen design. No route. Legitimate future use |
| integrations | ACTIVE | Razorpay config stored here |
| roles | PLANNED | RBAC tables exist; not wired to middleware |
| permissions | PLANNED | Same |
| staff | ACTIVE | Auth, dine-in session management, all authenticated routes |
| staff_roles | PLANNED | RBAC junction. Structurally required, behaviorally inert |
| staff_locations | PLANNED | Location scoping. No route uses it |
| staff_sessions | PLANNED | Token revocation registry. Auth middleware does not check it |
| tax_rules | PLANNED | No route reads it |
| tax_rule_items | PLANNED | Same |
| subscriptions | PLANNED | No route reads it. Plan derived from boolean flags on restaurants row |
| feature_flags | PLANNED | No route reads it. Feature gates use boolean columns on restaurants |
| notification_preferences | ACTIVE | notification.service.js checks this on every notification create |

### brand schema

| Table | Classification | Notes |
|-------|---------------|-------|
| themes | ACTIVE | Presence/config routes |
| assets | ACTIVE | Presence routes |
| seo | ACTIVE | Presence routes |
| contact_links | ACTIVE | Presence routes |
| announcements | ACTIVE | Presence routes. `image_url` (v16) now in canonical schema |

### menu schema

| Table | Classification | Notes |
|-------|---------------|-------|
| menus | ACTIVE | Menu routes |
| categories | ACTIVE | Menu routes |
| menu_items | ACTIVE | Menu routes, orders |
| item_variants | ACTIVE | Orders use variants |
| customization_groups | ACTIVE | Orders |
| customization_options | ACTIVE | Orders |
| item_availability | PLANNED | No route enforces time-based availability |
| combos | PLANNED | No current order route handles combos |
| combo_slots | PLANNED | Same |
| combo_slot_options | PLANNED | Same |
| menu_schedules | PLANNED | No route reads schedule switching |

### customer schema

| Table | Classification | Notes |
|-------|---------------|-------|
| customers | ACTIVE | CRM routes, orders |
| addresses | ACTIVE | Orders (delivery_address_id FK) |
| loyalty_accounts | PLANNED | No route reads or writes loyalty |
| loyalty_transactions | PLANNED | Same |
| feedback | PLANNED | Not queried by any current route |
| interaction_log | PLANNED | Not written by any current route |
| identities | PLANNED | Identity graph. No current route |
| consent_history | ACTIVE | Written by customers.js governance routes |

### orders schema

| Table | Classification | Notes |
|-------|---------------|-------|
| orders | ACTIVE | Core operational table |
| order_items | ACTIVE | Orders route |
| order_item_customizations | ACTIVE | Orders route |
| order_taxes | PLANNED | Not written by current order creation path |
| order_discounts | PLANNED | Same |
| coupons | PLANNED | No coupon management route |
| delivery_jobs | PLANNED | No delivery tracking route |
| order_events | PLANNED | Not written by any current route |

### payments schema

| Table | Classification | Notes |
|-------|---------------|-------|
| payments | ACTIVE | Razorpay webhook writes here |
| payment_events | PLANNED | Not written by current webhook handler |

### dining schema

| Table | Classification | Notes |
|-------|---------------|-------|
| tables | ACTIVE | dine-in routes |
| sessions | ACTIVE | dine-in routes |
| reservations | ACTIVE | dine-in routes |
| waitlist | PLANNED | No current route writes to it |
| reviews | ACTIVE | reviews.js route |

### catering schema

| Table | Classification | Notes |
|-------|---------------|-------|
| enquiry_forms | PLANNED | leads route does not read form config |
| leads | ACTIVE | leads.js route |
| lead_notes | PLANNED | No current route creates notes |
| events | PLANNED | Stage 2 pipeline. No current route |
| event_days | PLANNED | Same |
| quotes | PLANNED | Same |
| quote_items | PLANNED | Same |
| packages | PLANNED | Same |
| package_items | PLANNED | Same |

### insights schema (all PLANNED)

All 7 tables: `daily_metrics`, `item_performance`, `review_summary`, `events`, `menu_views`, `customer_segments`, `customer_events`. No aggregation job runs. No route writes to any of them. Schema is complete and correct — retained for when the analytics pipeline is built.

### platform schema

| Table | Classification | Notes |
|-------|---------------|-------|
| event_outbox | PLANNED | Nothing writes to it |
| events | PLANNED | Platform event bus. Nothing writes to it |
| webhooks | PLANNED | No webhook management route |
| webhook_deliveries | PLANNED | Same |
| notification_templates | PLANNED | No template management route |
| notifications | ACTIVE | Outbound dispatch log. notification.service.js writes here for outbound comms |
| notification_engagement | PLANNED | No engagement signal route |
| audit_log | ACTIVE | audit.js writes here |
| usage_events | PLANNED | No metering instrumented |
| usage_ledger | PLANNED | No billing pipeline |
| api_keys | PLANNED | No API key management route |
| export_jobs | ACTIVE | settings.js export route (v18) |
| customer_data_requests | ACTIVE | customers.js governance routes (v18) |
| benchmarks | PLANNED | No aggregation job |
| schema_migrations | NEW | Added by V20 |

### inventory schema (all PLANNED)

`items`, `movements`, `stock_levels` view. No inventory route exists. Retained.

### notifications schema

| Table | Classification | Notes |
|-------|---------------|-------|
| notifications | ACTIVE | notifications.js route reads this. notification.service.js writes here |

---

## 3. Notifications Decision

Two notification tables exist. They serve entirely different purposes and are NOT duplicates.

| Table | Purpose | Audience | Key columns |
|-------|---------|----------|-------------|
| `platform.notifications` | Outbound customer communications — WhatsApp, SMS, email dispatch records | Customers (external) | `channel`, `recipient_phone`, `recipient_email`, `provider`, `provider_msg_id`, `status` (queued/sent/delivered/failed) |
| `notifications.notifications` | In-app staff dashboard alerts | Restaurant staff (internal) | `type`, `priority`, `title`, `body`, `read_at`, `expires_at` |

**Decision: both tables are retained in V20.**

The naming is confusing but semantically correct. A V21 rename of `platform.notifications` to `platform.outbound_messages` would eliminate the confusion but requires an application code change. Deferred.

**What notification.service.js does:** Writes in-app staff alerts to `notifications.notifications`. It does not touch `platform.notifications`.

**What `platform.notifications` is for:** Future outbound customer messaging pipeline (WhatsApp/SMS integration). Currently defined, no route actively creates rows.

---

## 4. Permission Model Decision

**Current state:** `tenant.roles`, `tenant.permissions`, `tenant.staff_roles` are defined but behaviorally inert. Authorization is JWT-only:

```js
// auth.js
requireRole('owner', 'manager')  // checks req.auth.roles array from JWT — never queries DB
```

The permission tables are never queried at runtime. Any permission granted in the database has zero effect on access control. This is the root cause of the privilege escalation gap (any authenticated staff can create other staff accounts with any role).

**Decision: KEEP all three tables.** The data model is correct. Wiring them to middleware is V21 work.

**V21 action:** Add a middleware step that validates `req.auth.roles` against `tenant.permissions` using a short-lived per-tenant cache. This closes the privilege escalation gap without any schema change.

---

## 5. Schema Drift Resolved in V20

Every column and table present in production (via migrations) but absent from kravon_schema_v12.sql is now in kravon_schema_v20.sql:

| Object | Location | Added by | In v12 SQL | In v20 SQL |
|--------|----------|----------|-----------|-----------|
| `password_hash TEXT` | `tenant.staff` | v14 | MISSING | PRESENT |
| `image_url TEXT` | `brand.announcements` | v16 | MISSING | PRESENT |
| `plan VARCHAR(20)` with CHECK | `tenant.restaurants` | v15 | ENUM (wrong) | VARCHAR(20)+CHECK |
| `idx_restaurants_plan` | `tenant.restaurants` | v15 | MISSING | PRESENT |
| `idx_orders_razorpay_order_id` | `orders.orders` | v17 | MISSING | PRESENT |
| `idx_orders_razorpay_payment_id` | `orders.orders` | v17 | MISSING | PRESENT |
| `customer.consent_history` | customer schema | v18 | MISSING | PRESENT |
| `platform.export_jobs` | platform schema | v18 | MISSING | PRESENT |
| `platform.customer_data_requests` | platform schema | v18 | MISSING | PRESENT |
| `platform.benchmarks` | platform schema | v18 | MISSING | PRESENT |
| `notifications` schema | — | v19 | MISSING | PRESENT |
| `notifications.notifications` | notifications schema | v19 | MISSING | PRESENT |
| `tenant.notification_preferences` | tenant schema | v19 | MISSING | PRESENT |
| `platform.schema_migrations` | platform schema | v20 NEW | MISSING | PRESENT |

---

## 6. Migration Retirement Plan

After V20 is the installed baseline, the following files are historical and must not be applied to a V20+ database.

**Action:** Move to `kravon-engine/backend/db/migrations/archive/`

| File | Changes absorbed into V20 |
|------|--------------------------|
| v9-tables.js | reviews table, has_tables/delivery columns on restaurants, order_surface |
| v10-column-rename.js | All renames reflected in v20 column names |
| v10-domain.js | tenant.domains table |
| v11-story.js | story_* columns in restaurants.settings JSONB |
| v13-dine-in.js | session_id FK on orders, deleted_at on orders |
| v14-staff-password.js | password_hash on tenant.staff |
| v15-plan.js | VARCHAR(20) plan with CHECK constraint |
| v16-presence-content.js | image_url on brand.announcements |
| v17-razorpay-idempotency.js | Both functional indexes on orders.orders |
| v18-governance.js | Four governance tables |
| v19-notifications.js | notifications schema, two tables |

Only `v20-foundation.js` and future V21+ migrations belong in the active `migrations/` directory.

---

## 7. Production Upgrade Plan

### Pre-upgrade validation

```sql
-- Confirm v14 applied (password_hash exists)
SELECT 1 FROM information_schema.columns
WHERE table_schema='tenant' AND table_name='staff' AND column_name='password_hash';

-- Confirm v16 applied (image_url exists)
SELECT 1 FROM information_schema.columns
WHERE table_schema='brand' AND table_name='announcements' AND column_name='image_url';

-- Confirm v19 applied (notifications schema exists)
SELECT 1 FROM information_schema.schemata WHERE schema_name='notifications';

-- Confirm plan column is already varchar (v15 applied)
SELECT data_type FROM information_schema.columns
WHERE table_schema='tenant' AND table_name='restaurants' AND column_name='plan';

-- Baseline counts for post-migration comparison
SELECT COUNT(*) FROM orders.orders;
SELECT COUNT(*) FROM tenant.restaurants;
```

### Upgrade execution

```bash
node kravon-engine/backend/db/migrations/v20-foundation.js
```

Runs in a single transaction. Any failure rolls back completely. Safe to re-run.

### Post-upgrade validation

```sql
-- Migration tracker populated
SELECT version, name, applied_at FROM platform.schema_migrations ORDER BY id;
-- Expected: 20 rows

-- All schemas present
SELECT schema_name FROM information_schema.schemata
WHERE schema_name IN (
  'tenant','brand','menu','customer','orders','payments',
  'dining','catering','insights','platform','inventory','notifications'
) ORDER BY schema_name;
-- Expected: 12 rows

-- No data loss
SELECT COUNT(*) FROM orders.orders;
SELECT COUNT(*) FROM tenant.restaurants;

-- Plan values valid
SELECT DISTINCT plan FROM tenant.restaurants;
-- Expected: only values in {starter, growth, pro, enterprise}
```

### Rollback

v20-foundation.js is entirely additive — it only adds columns, tables, and indexes. It drops nothing.

Rollback is a no-op in all normal cases. The transaction guarantees the DB is unchanged on failure. Fix the issue, re-run. Safe.

---

## 8. Fresh Install Checklist

`kravon_schema_v20.sql` on a blank database must fully support:

| Capability | Key tables | In V20 |
|------------|-----------|--------|
| Authentication | `tenant.restaurants`, `tenant.staff` (with password_hash) | Yes |
| Presence storefront | `brand.*` (themes, assets, seo, contact_links, announcements with image_url) | Yes |
| Menu | `menu.menus` through `menu.customization_options` | Yes |
| Orders | `orders.orders`, `orders.order_items`, `orders.order_item_customizations` | Yes |
| Dine-in | `dining.tables`, `dining.sessions`, session_id FK on orders | Yes |
| Reservations | `dining.reservations` | Yes |
| Catering leads | `catering.leads` | Yes |
| In-app notifications | `notifications.notifications`, `tenant.notification_preferences` | Yes |
| Governance / DPDP | `customer.consent_history`, `platform.export_jobs`, `platform.customer_data_requests` | Yes |
| Audit trail | `platform.audit_log` | Yes |
| Migration tracking | `platform.schema_migrations` | Yes (NEW) |

**PostgreSQL version:** 14+ required (`CREATE OR REPLACE TRIGGER`). Target: PostgreSQL 17.
**Extensions:** `pgcrypto`, `pg_trgm` — both created at top of schema file.

---

## 9. Next Migration Recommendations

### V21 — Performance + export fix (HIGH priority)

1. Add composite index: `CREATE INDEX idx_orders_tenant_status ON orders.orders(tenant_id, status) WHERE deleted_at IS NULL` — hot query in orders.js filters by both but no combined index exists
2. Fix `settings/export` route column names in application code (`price_paise` does not exist — column is `price`; `party_name/phone/email` do not exist — catering leads use `contact_name/phone/email`; `guest_count` does not exist — column is `guest_count_min`)
3. Add `CREATE INDEX IF NOT EXISTS idx_notifications_tenant_unread` if missing after v19

### V22 — RBAC wiring (HIGH priority)

1. Seed default roles (`owner`, `manager`, `cashier`, `kitchen`, `host`, `catering`) for all existing tenants
2. Seed default permissions per role into `tenant.permissions`
3. Application code: wire `requireRole` to validate against `tenant.permissions` via cached lookup — closes the privilege escalation gap

### V23 — Audit coverage expansion (MEDIUM priority)

Add `platform.audit_log` writes to routes that currently skip it:
- Menu item create / update / delete
- Staff create / update / delete (critical — paper trail for the escalation gap)
- Reservation status changes
- Catering lead status changes
