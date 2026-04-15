-- ============================================================
-- kravon_schema_v8.sql
-- Kravon Platform — Full Production Schema
-- Target: Railway · PostgreSQL 16
--
-- Idempotent via IF NOT EXISTS on schemas and extensions.
--
-- Changes from v7 → v8 (all v8 audit findings addressed):
--   [FIX-25] order_items.total_price CHECK corrected:
--            was (total_price >= unit_price * quantity),
--            now (total_price = base_price + addons_total) — exact equality
--   [FIX-26] orders.subtotal_amount / total_amount: status-conditional NOT NULL
--            CHECK added — terminal-status orders must have both amounts set
--   [FIX-27] loyalty_accounts.points_balance: CHECK (>= 0) added;
--            redemption advisory lock pattern documented
--   [FIX-28] catering.quotes.total_amount: status-conditional NOT NULL CHECK
--            added — 'sent' and 'accepted' quotes must carry a total
--   [FIX-29] tenant.staff: partial UNIQUE index on (tenant_id, email)
--            WHERE email IS NOT NULL AND deleted_at IS NULL — mirrors FIX-06
--   [FIX-30] payments.payments.amount: CHECK added — 'captured' and
--            'authorized' payments must have amount IS NOT NULL AND amount > 0
--   [FIX-31] platform.notification_engagement: inline UNIQUE replaced with
--            partial unique index WHERE provider_event_id IS NOT NULL;
--            NULL event IDs (untracked provider callbacks) documented as
--            intentionally non-unique
--   [FIX-32] catering.leads: CHECK enforces event_id IS NULL OR
--            status = 'converted' — prevents pipeline mis-count
--   [FIX-33] catering.lead_notes: CHECK requires at least one of staff_id or
--            author to be set; migration path to drop author in v9 documented
--   [FIX-34] menu.menu_items: CHECK enforces (has_variants = TRUE <-> price IS
--            NULL) — pricing invariant previously only app-enforced
--   [FIX-35] dining.sessions: partial UNIQUE index prevents two concurrent
--            open sessions on the same table
--   [FIX-36] insights.daily_metrics: computed_at updated explicitly on upsert;
--            comment updated to clarify it is not maintained by the trigger
--   [FIX-37] dining.reservations: CHECK requires reservation_time IS NOT NULL
--            for any status other than 'pending'
--   [FIX-38] brand.assets.url: NOT NULL enforced — asset without a URL is
--            operationally useless
--   [FIX-39] orders.order_discounts.amount_saved: NOT NULL DEFAULT 0
--   [FIX-40] platform.event_outbox.retry_count: CHECK (0 <= retry_count <= 25)
--   [FIX-41] tenant.tax_rules: partial UNIQUE index on (tenant_id, name)
--            WHERE deleted_at IS NULL
--   [FIX-42] platform.audit_log.actor_type: promoted to audit_actor_type ENUM;
--            values constrained to 'staff' | 'system' | 'customer'
--
-- Circular dependency resolution order (unchanged from v7):
--   Extensions → ENUMs → Schemas
--   → tenant (restaurants, locations, domains, operating_hours,
--              virtual_brands, integrations, roles, permissions,
--              staff, staff_roles, staff_locations, staff_sessions,
--              tax_rules, tax_rule_items[deferred FKs])
--   → brand
--   → menu (menus, categories, menu_items, item_variants,
--           customization_groups, customization_options,
--           item_availability, combos, combo_slots,
--           combo_slot_options, menu_schedules)
--   → [wire tax_rule_items deferred FKs to menu]
--   → customer (customers, addresses, loyalty_accounts,
--               loyalty_transactions[deferred order FK],
--               feedback[deferred notification FK],
--               interaction_log)
--   → orders (orders[deferred session FK], order_items,
--             order_item_customizations, order_taxes,
--             order_discounts, coupons, delivery_jobs)
--   → [wire loyalty_transactions → orders]
--   → payments
--   → dining (tables, sessions[deferred reservation FK],
--             reservations, [wire session→reservation],
--             waitlist, reviews)
--   → [wire orders → sessions]
--   → catering (enquiry_forms, leads[deferred event FK],
--               lead_notes, events, event_days,
--               [wire leads→events], quotes, quote_items,
--               packages, [wire quote_items→packages],
--               package_items)
--   → insights
--   → platform (event_outbox, webhooks, webhook_deliveries,
--               notification_templates, notifications,
--               notification_engagement, audit_log)
--   → [wire feedback → notifications]
--
-- Conventions
--   • UUID PKs via gen_random_uuid()
--   • tenant_id on every operational table
--   • soft-delete: deleted_at TIMESTAMPTZ
--   • audit: created_at, updated_at, created_by, updated_by
--   • TIMESTAMPTZ throughout
--   • JSONB for structural flexibility
--   • Partial indexes on soft-deleted tables (WHERE deleted_at IS NULL)
--   • ENUMs before first use
--
-- Redemption race-condition pattern (loyalty points):
--   UPDATE customer.loyalty_accounts
--      SET points_balance = points_balance - $pts
--    WHERE id = $id AND points_balance >= $pts
--   Verify rowcount = 1 before committing. For high-concurrency scenarios
--   (flash sales, batch redemptions) wrap in SELECT FOR UPDATE.
--
-- Coupon race-condition pattern:
--   UPDATE orders.coupons
--      SET used_count = used_count + 1
--    WHERE id = $id AND (usage_limit IS NULL OR used_count < usage_limit)
--   Verify rowcount = 1 before committing.
-- ============================================================


-- ── EXTENSIONS ────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";


-- ============================================================
-- ENUM TYPES
-- ============================================================

CREATE TYPE restaurant_plan AS ENUM (
    'presence',
    'orders',
    'catering',
    'insights',
    'full'
);

CREATE TYPE asset_type AS ENUM (
    'logo',
    'banner',
    'favicon',
    'og_image',
    'gallery',
    'other'
);

CREATE TYPE menu_type AS ENUM (
    'main',
    'breakfast',
    'lunch',
    'dinner',
    'weekend',
    'seasonal',
    'catering',
    'delivery',
    'dine_in',
    'takeaway',
    'other'
);

CREATE TYPE fssai_food_type AS ENUM (
    'veg',
    'non_veg',
    'egg',
    'vegan'
);

CREATE TYPE customization_group_type AS ENUM (
    'radio',
    'checkbox',
    'quantity'
);

CREATE TYPE loyalty_tier AS ENUM (
    'bronze',
    'silver',
    'gold',
    'platinum'
);

CREATE TYPE loyalty_transaction_type AS ENUM (
    'earn',
    'redeem',
    'expire',
    'adjust',
    'bonus',
    'refund'
);

CREATE TYPE order_channel AS ENUM (
    'web',
    'qr',
    'whatsapp',
    'phone',
    'pos',
    'aggregator',
    'catering'
);

CREATE TYPE fulfillment_type AS ENUM (
    'delivery',
    'pickup',
    'dine_in',
    'catering'
);

CREATE TYPE order_status AS ENUM (
    'pending',
    'confirmed',
    'preparing',
    'ready',
    'out_for_delivery',
    'delivered',
    'completed',
    'cancelled',
    'refunded'
);

CREATE TYPE discount_type AS ENUM (
    'flat',
    'percentage',
    'bogo',
    'free_item'
);

CREATE TYPE delivery_provider AS ENUM (
    'self',
    'dunzo',
    'porter',
    'shiprocket',
    'other'
);

CREATE TYPE delivery_job_status AS ENUM (
    'pending',
    'assigned',
    'picked_up',
    'delivered',
    'failed',
    'cancelled'
);

CREATE TYPE payment_status AS ENUM (
    'pending',
    'authorized',
    'captured',
    'failed',
    'refunded',
    'partial_refund',
    'disputed'
);

CREATE TYPE table_status AS ENUM (
    'available',
    'occupied',
    'reserved',
    'cleaning',
    'inactive'
);

CREATE TYPE reservation_status AS ENUM (
    'pending',
    'confirmed',
    'seated',
    'completed',
    'cancelled',
    'no_show'
);

CREATE TYPE catering_lead_status AS ENUM (
    'new',
    'contacted',
    'qualified',
    'proposal_sent',
    'negotiating',
    'converted',
    'lost',
    'on_hold'
);

CREATE TYPE catering_event_status AS ENUM (
    'confirmed',
    'in_progress',
    'completed',
    'cancelled',
    'postponed'
);

CREATE TYPE quote_status AS ENUM (
    'draft',
    'sent',
    'viewed',
    'accepted',
    'rejected',
    'expired',
    'revised'
);

CREATE TYPE notification_channel AS ENUM (
    'whatsapp',
    'sms',
    'email',
    'push'
);

CREATE TYPE notification_status AS ENUM (
    'queued',
    'sent',
    'delivered',
    'failed',
    'bounced',
    'opted_out'
);

CREATE TYPE notification_engagement_type AS ENUM (
    'opened',
    'clicked',
    'replied',
    'opted_out',
    'bounced',
    'complained'
);

CREATE TYPE outbox_status AS ENUM (
    'pending',
    'processing',
    'delivered',
    'failed',
    'dead'
);

CREATE TYPE insight_metric_type AS ENUM (
    'revenue',
    'order_count',
    'avg_order_value',
    'new_customers',
    'returning_customers',
    'cancellation_rate',
    'avg_prep_time',
    'loyalty_redemption_rate',
    'catering_pipeline_value',
    'review_avg'
);

CREATE TYPE feedback_entity_type AS ENUM (
    'order',
    'dining_session',
    'reservation',
    'catering_event',
    'delivery',
    'general'
);

CREATE TYPE interaction_type AS ENUM (
    'order_placed',
    'order_cancelled',
    'payment_made',
    'payment_failed',
    'review_submitted',
    'feedback_submitted',
    'reservation_made',
    'reservation_cancelled',
    'reservation_completed',
    'catering_lead_submitted',
    'catering_event_completed',
    'loyalty_earned',
    'loyalty_redeemed',
    'loyalty_tier_upgrade',
    'notification_sent',
    'notification_opened',
    'notification_clicked',
    'opted_out',
    'qr_scan',
    'menu_view',
    'account_created'
);

CREATE TYPE waitlist_status AS ENUM (
    'waiting',
    'notified',
    'seated',
    'cancelled',
    'no_show',
    'expired'
);

-- [FIX-42] New ENUM replacing TEXT DEFAULT 'staff' on audit_log.
-- Prevents free-text drift on a security-critical field.
CREATE TYPE audit_actor_type AS ENUM (
    'staff',

    'system',
    'customer'
);

-- ============================================================
-- SCHEMAS
-- ============================================================

CREATE SCHEMA IF NOT EXISTS tenant;
CREATE SCHEMA IF NOT EXISTS brand;
CREATE SCHEMA IF NOT EXISTS menu;
CREATE SCHEMA IF NOT EXISTS customer;
CREATE SCHEMA IF NOT EXISTS orders;
CREATE SCHEMA IF NOT EXISTS payments;
CREATE SCHEMA IF NOT EXISTS dining;
CREATE SCHEMA IF NOT EXISTS catering;
CREATE SCHEMA IF NOT EXISTS insights;
CREATE SCHEMA IF NOT EXISTS platform;


-- ============================================================
-- TENANT SCHEMA
-- ============================================================

-- Root tenant record. Every operational table has tenant_id → here.
CREATE TABLE tenant.restaurants (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                TEXT NOT NULL UNIQUE,
    name                TEXT NOT NULL,
    plan                restaurant_plan NOT NULL DEFAULT 'presence',
    status              TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','inactive','suspended')),
    has_presence        BOOLEAN NOT NULL DEFAULT FALSE,
    has_orders          BOOLEAN NOT NULL DEFAULT FALSE,
    has_tables          BOOLEAN NOT NULL DEFAULT FALSE,
    has_catering        BOOLEAN NOT NULL DEFAULT FALSE,
    has_insights        BOOLEAN NOT NULL DEFAULT FALSE,
    -- timezone, currency, locale live here
    settings            JSONB NOT NULL DEFAULT '{}',
    deleted_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by          UUID,
    updated_by          UUID
);

CREATE INDEX idx_restaurants_slug   ON tenant.restaurants(slug)   WHERE deleted_at IS NULL;
CREATE INDEX idx_restaurants_status ON tenant.restaurants(status) WHERE deleted_at IS NULL;


-- Physical or virtual (cloud kitchen) locations under a brand.
CREATE TABLE tenant.locations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    name            TEXT,
    address         TEXT,
    city            TEXT,
    state           TEXT,
    country         TEXT NOT NULL DEFAULT 'IN',
    pincode         TEXT,
    lat             NUMERIC(9,6),
    lng             NUMERIC(9,6),
    timezone        TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    phone           TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    metadata        JSONB NOT NULL DEFAULT '{}',
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX idx_locations_tenant ON tenant.locations(tenant_id) WHERE deleted_at IS NULL;


-- Custom domains per tenant.
CREATE TABLE tenant.domains (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    domain          TEXT NOT NULL UNIQUE,
    is_primary      BOOLEAN NOT NULL DEFAULT FALSE,
    verified_at     TIMESTAMPTZ,
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX idx_domains_tenant ON tenant.domains(tenant_id);
CREATE INDEX idx_domains_domain ON tenant.domains(domain);


-- Weekly operating schedule per location. day_of_week: 0=Sun … 6=Sat.
CREATE TABLE tenant.operating_hours (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    location_id     UUID NOT NULL,
    day_of_week     SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    opens_at        TIME NOT NULL,
    closes_at       TIME NOT NULL,
    is_closed       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (location_id, day_of_week),
    FOREIGN KEY (tenant_id)   REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (location_id) REFERENCES tenant.locations(id)   ON DELETE CASCADE
);

CREATE INDEX idx_operating_hours_location ON tenant.operating_hours(location_id);


-- Cloud kitchen: multiple storefronts sharing one physical kitchen.
CREATE TABLE tenant.virtual_brands (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL,
    kitchen_location_id     UUID NOT NULL,
    restaurant_id           UUID NOT NULL,
    display_name            TEXT,
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    deleted_at              TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)           REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (kitchen_location_id) REFERENCES tenant.locations(id),
    FOREIGN KEY (restaurant_id)       REFERENCES tenant.restaurants(id)
);

CREATE INDEX idx_virtual_brands_tenant ON tenant.virtual_brands(tenant_id);


-- Per-tenant integration credentials (AES-256-GCM encrypted at app layer).
CREATE TABLE tenant.integrations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    -- 'razorpay','twilio','gupshup','sendgrid','firebase'
    provider        TEXT NOT NULL,
    config          JSONB NOT NULL DEFAULT '{}',
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, provider),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX idx_integrations_tenant ON tenant.integrations(tenant_id);


-- Named RBAC roles per tenant. System roles seeded on tenant provisioning.
CREATE TABLE tenant.roles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    -- 'owner','manager','cashier','host','kitchen','catering'
    name            TEXT NOT NULL,
    display_name    TEXT,
    description     TEXT,
    is_system_role  BOOLEAN NOT NULL DEFAULT FALSE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by      UUID,
    UNIQUE (tenant_id, name),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX idx_roles_tenant ON tenant.roles(tenant_id);


-- Granular permission keys scoped to a role. Dot-notation: module.resource.action
-- Examples: orders.manage, menu.edit, customers.export, payments.refund
CREATE TABLE tenant.permissions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    role_id         UUID NOT NULL,
    permission_key  TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (role_id, permission_key),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (role_id)   REFERENCES tenant.roles(id)       ON DELETE CASCADE
);

CREATE INDEX idx_permissions_role   ON tenant.permissions(role_id);
CREATE INDEX idx_permissions_tenant ON tenant.permissions(tenant_id);


-- One row per human per tenant. Same person at two brands = two rows.
-- [FIX-29] Inline UNIQUE (tenant_id, email) removed. Replaced with a partial
--          unique index below that excludes NULL emails (phone-only staff) and
--          soft-deleted rows. This mirrors the pattern applied to
--          customer.customers in v7 (FIX-06).
CREATE TABLE tenant.staff (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    name            TEXT NOT NULL,
    email           TEXT,
    phone           TEXT,
    pin             TEXT,           -- bcrypt-hashed 4-6 digit POS PIN
    -- email|phone|google|sso
    auth_provider   TEXT NOT NULL DEFAULT 'email',
    auth_uid        TEXT,
    avatar_url      TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    metadata        JSONB NOT NULL DEFAULT '{}',
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by      UUID,
    updated_by      UUID,
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX idx_staff_tenant   ON tenant.staff(tenant_id);
CREATE INDEX idx_staff_email    ON tenant.staff(email)    WHERE deleted_at IS NULL;
CREATE INDEX idx_staff_auth_uid ON tenant.staff(auth_uid) WHERE auth_uid IS NOT NULL;
-- [FIX-29] Prevent two active staff members sharing the same email within a tenant.
CREATE UNIQUE INDEX idx_staff_email_unique
    ON tenant.staff(tenant_id, email)
    WHERE email IS NOT NULL AND deleted_at IS NULL;


-- M:N junction: staff ↔ roles.
CREATE TABLE tenant.staff_roles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL,
    staff_id    UUID NOT NULL,
    role_id     UUID NOT NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    assigned_by UUID,
    UNIQUE (staff_id, role_id),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (staff_id)  REFERENCES tenant.staff(id)       ON DELETE CASCADE,
    FOREIGN KEY (role_id)   REFERENCES tenant.roles(id)       ON DELETE CASCADE
);

CREATE INDEX idx_staff_roles_staff ON tenant.staff_roles(staff_id);
CREATE INDEX idx_staff_roles_role  ON tenant.staff_roles(role_id);


-- Scopes staff to specific locations. all_locations=TRUE bypasses row filter.
CREATE TABLE tenant.staff_locations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    staff_id        UUID NOT NULL,
    location_id     UUID NOT NULL,
    all_locations   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (staff_id, location_id),
    FOREIGN KEY (tenant_id)   REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (staff_id)    REFERENCES tenant.staff(id)       ON DELETE CASCADE,
    FOREIGN KEY (location_id) REFERENCES tenant.locations(id)   ON DELETE CASCADE
);

CREATE INDEX idx_staff_locations_staff ON tenant.staff_locations(staff_id);


-- Active session registry for token revocation and concurrent session control.
CREATE TABLE tenant.staff_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    staff_id        UUID NOT NULL,
    session_token   TEXT NOT NULL UNIQUE,   -- SHA-256 hashed bearer token
    device_info     JSONB NOT NULL DEFAULT '{}',
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (staff_id)  REFERENCES tenant.staff(id)       ON DELETE CASCADE
);

CREATE INDEX idx_staff_sessions_staff ON tenant.staff_sessions(staff_id);
CREATE INDEX idx_staff_sessions_token ON tenant.staff_sessions(session_token)
    WHERE revoked_at IS NULL;


-- Named tax definitions. India GST: components JSONB carries
-- CGST+SGST as [{"name":"CGST","rate":9},{"name":"SGST","rate":9}].
-- total_rate maintained by app (cannot SUM() JSONB in a PG16 stored expression).
CREATE TABLE tenant.tax_rules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    -- 'GST 5%', 'GST 18%', 'No Tax', 'Service Charge'
    name            TEXT NOT NULL,
    description     TEXT,
    components      JSONB NOT NULL DEFAULT '[]',
    total_rate      NUMERIC(5,2) NOT NULL DEFAULT 0,
    is_inclusive    BOOLEAN NOT NULL DEFAULT FALSE,
    is_default      BOOLEAN NOT NULL DEFAULT FALSE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by      UUID,
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX idx_tax_rules_tenant  ON tenant.tax_rules(tenant_id);
CREATE INDEX idx_tax_rules_default ON tenant.tax_rules(tenant_id)
    WHERE is_default = TRUE AND deleted_at IS NULL;
-- [FIX-41] Prevent duplicate tax rule names within a tenant.
-- Protects admin dropdowns and specificity resolution from ambiguous duplicates.
CREATE UNIQUE INDEX idx_tax_rules_name_unique
    ON tenant.tax_rules(tenant_id, name)
    WHERE deleted_at IS NULL;


-- Maps tax rule → item / category / combo.
-- Exactly ONE of menu_item_id, category_id, combo_id must be set (CHECK enforced).
-- Specificity (app-enforced): item > category > default rule.
-- Deferred FKs to menu tables wired after menu schema below.
CREATE TABLE tenant.tax_rule_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    tax_rule_id     UUID NOT NULL,
    menu_item_id    UUID,
    category_id     UUID,
    combo_id        UUID,
    CONSTRAINT chk_tax_target CHECK (
        (menu_item_id IS NOT NULL)::INT +
        (category_id  IS NOT NULL)::INT +
        (combo_id     IS NOT NULL)::INT = 1
    ),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)   REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (tax_rule_id) REFERENCES tenant.tax_rules(id)   ON DELETE CASCADE
);

CREATE INDEX idx_tax_rule_items_tenant   ON tenant.tax_rule_items(tenant_id);
CREATE INDEX idx_tax_rule_items_rule     ON tenant.tax_rule_items(tax_rule_id);
CREATE INDEX idx_tax_rule_items_item     ON tenant.tax_rule_items(menu_item_id)
    WHERE menu_item_id IS NOT NULL;
CREATE INDEX idx_tax_rule_items_category ON tenant.tax_rule_items(category_id)
    WHERE category_id IS NOT NULL;
CREATE INDEX idx_tax_rule_items_combo    ON tenant.tax_rule_items(combo_id)
    WHERE combo_id IS NOT NULL;


-- ============================================================
-- BRAND SCHEMA
-- ============================================================

-- Visual identity — one row per tenant (1:1).
CREATE TABLE brand.themes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL UNIQUE,
    primary_color   TEXT,
    secondary_color TEXT,
    accent_color    TEXT,
    font_heading    TEXT,
    font_body       TEXT,
    button_style    TEXT,
    card_style      TEXT,
    image_style     TEXT,
    custom_css      TEXT,
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);


-- Brand assets: logos, banners, OG images, gallery.
-- [FIX-38] url is NOT NULL — a row without a URL cannot be rendered by the
--          storefront. Assets should not be persisted until the URL is
--          confirmed from the storage layer (R2 / S3).
CREATE TABLE brand.assets (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL,
    type        asset_type,
    url         TEXT NOT NULL,    -- [FIX-38]
    alt_text    TEXT,
    metadata    JSONB NOT NULL DEFAULT '{}',
    deleted_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX idx_assets_tenant ON brand.assets(tenant_id) WHERE deleted_at IS NULL;


-- SEO / OG meta — one row per tenant (1:1).
CREATE TABLE brand.seo (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL UNIQUE,
    meta_title          TEXT,
    meta_description    TEXT,
    og_title            TEXT,
    og_description      TEXT,
    og_image_url        TEXT,
    twitter_handle      TEXT,
    canonical_url       TEXT,
    schema_org_json     JSONB,
    deleted_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);


-- Social / map / review platform links.
CREATE TABLE brand.contact_links (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    -- 'instagram','google_maps','zomato','whatsapp'
    platform        TEXT NOT NULL,
    url             TEXT NOT NULL,
    display_label   TEXT,
    position        SMALLINT NOT NULL DEFAULT 0,
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX idx_contact_links_tenant ON brand.contact_links(tenant_id) WHERE deleted_at IS NULL;


-- Time-bounded storefront banners / announcements.
CREATE TABLE brand.announcements (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL,
    title       TEXT,
    body        TEXT,
    cta_label   TEXT,
    cta_url     TEXT,
    starts_at   TIMESTAMPTZ,
    ends_at     TIMESTAMPTZ,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    deleted_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX idx_announcements_tenant_active ON brand.announcements(tenant_id)
    WHERE is_active = TRUE AND deleted_at IS NULL;


-- ============================================================
-- MENU SCHEMA
-- ============================================================

-- Menu containers per tenant / location.
-- Legacy available_from/until removed in v7. Use menu_schedules for all
-- time-based activation.
CREATE TABLE menu.menus (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL,
    location_id UUID,               -- NULL = applies to all locations
    name        TEXT,
    menu_type   menu_type NOT NULL DEFAULT 'main',
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    metadata    JSONB NOT NULL DEFAULT '{}',
    deleted_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)   REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (location_id) REFERENCES tenant.locations(id)
);

CREATE INDEX idx_menus_tenant   ON menu.menus(tenant_id)   WHERE deleted_at IS NULL;
CREATE INDEX idx_menus_location ON menu.menus(location_id) WHERE deleted_at IS NULL;


-- Menu sections / categories.
CREATE TABLE menu.categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL,
    menu_id     UUID NOT NULL,
    name        TEXT NOT NULL,
    description TEXT,
    image_url   TEXT,
    position    SMALLINT NOT NULL DEFAULT 0,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    deleted_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (menu_id)   REFERENCES menu.menus(id)         ON DELETE CASCADE
);

CREATE INDEX idx_categories_menu   ON menu.categories(menu_id)   WHERE deleted_at IS NULL;
CREATE INDEX idx_categories_tenant ON menu.categories(tenant_id);


-- Core dish record.
-- category_id is nullable: NULL = uncategorised item (valid for catering/import
-- workflows). Most storefront-facing items should have a category; the app layer
-- enforces this for public menus.
--
-- [FIX-34] Pricing invariant enforced at DB level:
--   has_variants = TRUE  → price IS NULL  (price lives on item_variants)
--   has_variants = FALSE → price IS NOT NULL
-- Previously only enforced by the app layer; direct inserts and migrations
-- could silently corrupt pricing state.
CREATE TABLE menu.menu_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    category_id     UUID,
    name            TEXT NOT NULL,
    description     TEXT,
    image_url       TEXT,
    food_type       fssai_food_type NOT NULL DEFAULT 'veg',
    price           NUMERIC(10,2),
    has_variants    BOOLEAN NOT NULL DEFAULT FALSE,
    is_customizable BOOLEAN NOT NULL DEFAULT FALSE,
    is_available    BOOLEAN NOT NULL DEFAULT TRUE,
    allergens       TEXT[],
    tags            TEXT[],
    prep_time_mins  SMALLINT,
    calories        SMALLINT,
    sort_order      SMALLINT NOT NULL DEFAULT 0,
    metadata        JSONB NOT NULL DEFAULT '{}',
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- [FIX-34]
    CONSTRAINT chk_item_pricing CHECK (
        (has_variants = TRUE  AND price IS NULL    ) OR
        (has_variants = FALSE AND price IS NOT NULL)
    ),
    FOREIGN KEY (tenant_id)   REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES menu.categories(id)
);

CREATE INDEX idx_menu_items_tenant    ON menu.menu_items(tenant_id)   WHERE deleted_at IS NULL;
CREATE INDEX idx_menu_items_category  ON menu.menu_items(category_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_menu_items_name_trgm ON menu.menu_items USING gin(name gin_trgm_ops)
    WHERE deleted_at IS NULL;


-- Size / portion variants. Price lives here when has_variants = TRUE on parent.
CREATE TABLE menu.item_variants (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL,
    menu_item_id UUID NOT NULL,
    -- 'Small','Medium','Large','Half','Full'
    name         TEXT NOT NULL,
    food_type    fssai_food_type,
    price        NUMERIC(10,2) NOT NULL,
    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order   SMALLINT NOT NULL DEFAULT 0,
    deleted_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)    REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (menu_item_id) REFERENCES menu.menu_items(id)    ON DELETE CASCADE
);

CREATE INDEX idx_item_variants_item ON menu.item_variants(menu_item_id) WHERE deleted_at IS NULL;


-- Add-on groups per item (e.g. Spice Level, Extras, Side Choice).
CREATE TABLE menu.customization_groups (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL,
    menu_item_id UUID NOT NULL,
    name         TEXT NOT NULL,
    group_type   customization_group_type NOT NULL DEFAULT 'checkbox',
    is_required  BOOLEAN NOT NULL DEFAULT FALSE,
    min_select   SMALLINT NOT NULL DEFAULT 0,
    max_select   SMALLINT NOT NULL DEFAULT 1,
    is_free      BOOLEAN NOT NULL DEFAULT FALSE,
    position     SMALLINT NOT NULL DEFAULT 0,
    deleted_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)    REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (menu_item_id) REFERENCES menu.menu_items(id)    ON DELETE CASCADE
);

CREATE INDEX idx_custom_groups_item ON menu.customization_groups(menu_item_id) WHERE deleted_at IS NULL;


-- Individual choices within a group. price_modifier = 0 → free.
CREATE TABLE menu.customization_options (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL,
    group_id       UUID NOT NULL,
    name           TEXT NOT NULL,
    price_modifier NUMERIC(10,2) NOT NULL DEFAULT 0,
    food_type      fssai_food_type,
    is_default     BOOLEAN NOT NULL DEFAULT FALSE,
    is_available   BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order     SMALLINT NOT NULL DEFAULT 0,
    deleted_at     TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id)        ON DELETE CASCADE,
    FOREIGN KEY (group_id)  REFERENCES menu.customization_groups(id) ON DELETE CASCADE
);

CREATE INDEX idx_custom_options_group ON menu.customization_options(group_id) WHERE deleted_at IS NULL;


-- Day / time availability overrides per item (e.g. breakfast items only before 11 am).
-- day_of_week = NULL means every day.
CREATE TABLE menu.item_availability (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    menu_item_id    UUID NOT NULL,
    day_of_week     SMALLINT CHECK (day_of_week BETWEEN 0 AND 6),
    available_from  TIME,
    available_until TIME,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)    REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (menu_item_id) REFERENCES menu.menu_items(id)    ON DELETE CASCADE
);

CREATE INDEX idx_item_availability_item ON menu.item_availability(menu_item_id);


-- Combo / meal deal header.
CREATE TABLE menu.combos (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL,
    category_id  UUID,
    name         TEXT NOT NULL,
    description  TEXT,
    image_url    TEXT,
    food_type    fssai_food_type NOT NULL DEFAULT 'veg',
    price        NUMERIC(10,2) NOT NULL,
    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    tags         TEXT[],
    sort_order   SMALLINT NOT NULL DEFAULT 0,
    deleted_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)   REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES menu.categories(id)
);

CREATE INDEX idx_combos_tenant   ON menu.combos(tenant_id)   WHERE deleted_at IS NULL;
CREATE INDEX idx_combos_category ON menu.combos(category_id) WHERE deleted_at IS NULL;


-- Selection slots within a combo (e.g. "Choose a Main", "Choose a Drink").
CREATE TABLE menu.combo_slots (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID NOT NULL,
    combo_id   UUID NOT NULL,
    name       TEXT,
    quantity   SMALLINT NOT NULL DEFAULT 1,
    position   SMALLINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (combo_id)  REFERENCES menu.combos(id)        ON DELETE CASCADE
);

CREATE INDEX idx_combo_slots_combo ON menu.combo_slots(combo_id);


-- Items eligible for each combo slot (N:N junction).
-- At least one of menu_item_id or variant_id must be set.
CREATE TABLE menu.combo_slot_options (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL,
    slot_id      UUID NOT NULL,
    menu_item_id UUID,
    variant_id   UUID,
    CONSTRAINT chk_combo_slot_target CHECK (
        menu_item_id IS NOT NULL OR variant_id IS NOT NULL
    ),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)    REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (slot_id)      REFERENCES menu.combo_slots(id)   ON DELETE CASCADE,
    FOREIGN KEY (menu_item_id) REFERENCES menu.menu_items(id),
    FOREIGN KEY (variant_id)   REFERENCES menu.item_variants(id)
);

CREATE INDEX idx_combo_slot_options_slot ON menu.combo_slot_options(slot_id);


-- Day-of-week + time-window auto-activation rules per menu.
-- days_of_week: 7-element BOOLEAN array, index 0=Sun … 6=Sat. NULL = every day.
-- priority: 10=default, 20=weekend, 30=seasonal override.
CREATE TABLE menu.menu_schedules (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL,
    menu_id      UUID NOT NULL,
    location_id  UUID,
    -- 'Weekday Lunch', 'Diwali Special'
    name         TEXT,
    days_of_week BOOLEAN[],     -- NULL = every day; if set, must be exactly 7 elements
    CONSTRAINT chk_days_of_week CHECK (
        days_of_week IS NULL OR array_length(days_of_week, 1) = 7
    ),
    time_from    TIME,          -- NULL = all day
    time_until   TIME,
    date_from    DATE,          -- NULL = no date restriction
    date_until   DATE,
    priority     SMALLINT NOT NULL DEFAULT 10,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    deleted_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by   UUID,
    FOREIGN KEY (tenant_id)   REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (menu_id)     REFERENCES menu.menus(id)         ON DELETE CASCADE,
    FOREIGN KEY (location_id) REFERENCES tenant.locations(id)
);

CREATE INDEX idx_menu_schedules_menu   ON menu.menu_schedules(menu_id);
CREATE INDEX idx_menu_schedules_active ON menu.menu_schedules(tenant_id, priority DESC)
    WHERE is_active = TRUE AND deleted_at IS NULL;


-- Wire deferred FKs on tenant.tax_rule_items now that menu tables exist.
ALTER TABLE tenant.tax_rule_items
    ADD CONSTRAINT fk_tri_menu_item FOREIGN KEY (menu_item_id)
        REFERENCES menu.menu_items(id)  ON DELETE CASCADE,
    ADD CONSTRAINT fk_tri_category  FOREIGN KEY (category_id)
        REFERENCES menu.categories(id) ON DELETE CASCADE,
    ADD CONSTRAINT fk_tri_combo     FOREIGN KEY (combo_id)
        REFERENCES menu.combos(id)     ON DELETE CASCADE;


-- ============================================================
-- CUSTOMER SCHEMA
-- ============================================================

-- Per-tenant CRM record.
-- Scoped per tenant — same phone/email at two restaurants = two rows (intentional).
-- phone UNIQUE: NULL rows excluded by PG semantics — intentional for walk-ins.
CREATE TABLE customer.customers (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL,
    name             TEXT,
    phone            TEXT,
    email            TEXT,
    preferred_name   TEXT,
    date_of_birth    DATE,
    anniversary      DATE,
    dietary_pref     TEXT[],
    tags             TEXT[],
    notes            TEXT,
    sms_consent      BOOLEAN NOT NULL DEFAULT FALSE,
    email_consent    BOOLEAN NOT NULL DEFAULT FALSE,
    whatsapp_consent BOOLEAN NOT NULL DEFAULT FALSE,
    metadata         JSONB NOT NULL DEFAULT '{}',
    deleted_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, phone),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX idx_customers_tenant ON customer.customers(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_customers_phone  ON customer.customers(tenant_id, phone)
    WHERE phone IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_customers_email  ON customer.customers(tenant_id, email)
    WHERE email IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX idx_customers_email_unique
    ON customer.customers(tenant_id, email)
    WHERE email IS NOT NULL AND deleted_at IS NULL;


-- Saved delivery addresses per customer.
CREATE TABLE customer.addresses (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL,
    customer_id   UUID NOT NULL,
    -- 'Home', 'Office', 'Other'
    label         TEXT,
    address_line1 TEXT,
    address_line2 TEXT,
    city          TEXT,
    state         TEXT,
    pincode       TEXT,
    lat           NUMERIC(9,6),
    lng           NUMERIC(9,6),
    is_default    BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)   REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES customer.customers(id) ON DELETE CASCADE
);

CREATE INDEX idx_addresses_customer ON customer.addresses(customer_id) WHERE deleted_at IS NULL;


-- Loyalty wallet — one per (tenant, customer).
-- [FIX-27] points_balance >= 0 enforced at DB level.
-- Redemption pattern — always use an atomic conditional UPDATE:
--   UPDATE customer.loyalty_accounts
--      SET points_balance = points_balance - $pts
--    WHERE id = $id AND points_balance >= $pts
--   Verify rowcount = 1. Use SELECT FOR UPDATE for high-concurrency paths.
CREATE TABLE customer.loyalty_accounts (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL,
    customer_id    UUID NOT NULL,
    points_balance INTEGER NOT NULL DEFAULT 0
                       CHECK (points_balance >= 0),   -- [FIX-27]
    tier           loyalty_tier NOT NULL DEFAULT 'bronze',
    lifetime_spend NUMERIC(12,2) NOT NULL DEFAULT 0,
    visit_count    INTEGER NOT NULL DEFAULT 0,
    last_visit_at  TIMESTAMPTZ,
    deleted_at     TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, customer_id),
    FOREIGN KEY (tenant_id)   REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES customer.customers(id) ON DELETE CASCADE
);

CREATE INDEX idx_loyalty_accounts_customer ON customer.loyalty_accounts(customer_id);
CREATE INDEX idx_loyalty_accounts_tenant   ON customer.loyalty_accounts(tenant_id);


-- Points earn / redeem / expire ledger. Append-only — never UPDATE or DELETE.
-- order_id FK wired after orders schema below.
CREATE TABLE customer.loyalty_transactions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL,
    loyalty_id  UUID NOT NULL,
    order_id    UUID,           -- NULL for manual adjustments
    txn_type    loyalty_transaction_type NOT NULL,
    -- positive = earn, negative = redeem/expire
    points      INTEGER NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)  REFERENCES tenant.restaurants(id)       ON DELETE CASCADE,
    FOREIGN KEY (loyalty_id) REFERENCES customer.loyalty_accounts(id)
);

CREATE INDEX idx_loyalty_txn_account ON customer.loyalty_transactions(loyalty_id);
CREATE INDEX idx_loyalty_txn_order   ON customer.loyalty_transactions(order_id)
    WHERE order_id IS NOT NULL;


-- Generalised post-interaction feedback. Polymorphic via entity_type + entity_id.
-- notification_id FK wired after platform schema below.
-- dining.reviews handles public-facing reviews with staff reply capability.
-- This table is the internal operational signal layer.
CREATE TABLE customer.feedback (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL,
    customer_id      UUID,         -- NULL for anonymous feedback
    entity_type      feedback_entity_type NOT NULL,
    entity_id        UUID NOT NULL,
    rating           SMALLINT CHECK (rating    BETWEEN 1 AND 5),
    nps_score        SMALLINT CHECK (nps_score BETWEEN 0 AND 10),
    comment          TEXT,
    tags             TEXT[],
    -- 'whatsapp','email','in_app','qr','sms'
    channel          TEXT,
    notification_id  UUID,      -- FK to platform.notifications (wired below)
    solicited_at     TIMESTAMPTZ,
    responded_at     TIMESTAMPTZ,
    is_public        BOOLEAN NOT NULL DEFAULT FALSE,
    metadata         JSONB NOT NULL DEFAULT '{}',
    deleted_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)   REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES customer.customers(id)
);

CREATE INDEX idx_feedback_tenant    ON customer.feedback(tenant_id, created_at DESC);
CREATE INDEX idx_feedback_customer  ON customer.feedback(customer_id);
CREATE INDEX idx_feedback_entity    ON customer.feedback(entity_type, entity_id);
CREATE INDEX idx_feedback_solicited ON customer.feedback(tenant_id)
    WHERE solicited_at IS NOT NULL AND responded_at IS NULL;


-- Structured CRM timeline of every meaningful customer touchpoint.
-- NOT the raw analytics stream (insights.events handles that).
-- Powers CRM views, cohort analysis, churn detection, re-engagement.
-- Append-only — never UPDATE or DELETE rows.
CREATE TABLE customer.interaction_log (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL,
    customer_id      UUID NOT NULL,
    interaction_type interaction_type NOT NULL,
    -- 'order','reservation','session','catering_event'
    entity_type      TEXT,
    entity_id        UUID,
    -- monetary value where applicable
    value            NUMERIC(12,2),
    -- loyalty points change where applicable
    points_delta     INTEGER,
    -- 'web','qr','whatsapp','pos'
    channel          TEXT,
    location_id      UUID,
    metadata         JSONB NOT NULL DEFAULT '{}',
    occurred_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)   REFERENCES tenant.restaurants(id),
    FOREIGN KEY (customer_id) REFERENCES customer.customers(id),
    FOREIGN KEY (location_id) REFERENCES tenant.locations(id)
);

CREATE INDEX idx_interaction_log_customer ON customer.interaction_log(tenant_id, customer_id, occurred_at DESC);
CREATE INDEX idx_interaction_log_tenant   ON customer.interaction_log(tenant_id, occurred_at DESC);
CREATE INDEX idx_interaction_log_type     ON customer.interaction_log(tenant_id, interaction_type);
CREATE INDEX idx_interaction_log_entity   ON customer.interaction_log(entity_type, entity_id);


-- ============================================================
-- ORDERS SCHEMA
-- ============================================================

-- Master order record. Partition-ready by created_at.
-- When monthly volume exceeds ~2M rows, add PARTITION BY RANGE (created_at).
-- session_id FK wired after dining schema below (circular dep resolution).
--
-- [FIX-26] Orders in a terminal status must have subtotal_amount and
--          total_amount set. 'pending' and 'cancelled' are exempt:
--          pending = still being assembled, cancelled-before-confirm may
--          never have had a total computed.
CREATE TABLE orders.orders (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID NOT NULL,
    location_id          UUID,
    customer_id          UUID,
    session_id           UUID,          -- dining session FK (wired post-dining)
    delivery_address_id  UUID,
    channel              order_channel    NOT NULL DEFAULT 'web',
    fulfillment_type     fulfillment_type NOT NULL DEFAULT 'delivery',
    status               order_status     NOT NULL DEFAULT 'pending',
    scheduled_at         TIMESTAMPTZ,    -- pre-orders
    subtotal_amount      NUMERIC(10,2),
    tax_amount           NUMERIC(10,2)   NOT NULL DEFAULT 0,
    discount_amount      NUMERIC(10,2)   NOT NULL DEFAULT 0,
    tip_amount           NUMERIC(10,2)   NOT NULL DEFAULT 0,
    packaging_charge     NUMERIC(10,2)   NOT NULL DEFAULT 0,
    delivery_charge      NUMERIC(10,2)   NOT NULL DEFAULT 0,
    total_amount         NUMERIC(10,2),
    -- [FIX-26] Terminal orders must carry both amounts
    CONSTRAINT chk_order_amounts_set CHECK (
        status IN ('pending','cancelled')
        OR (subtotal_amount IS NOT NULL AND total_amount IS NOT NULL)
    ),
    CONSTRAINT chk_order_total_positive CHECK (
        total_amount IS NULL OR total_amount >= 0
    ),
    special_instructions TEXT,
    token_number         TEXT,          -- kitchen display token
    source_ref           TEXT,          -- aggregator order ID if applicable
    metadata             JSONB NOT NULL DEFAULT '{}',
    deleted_at           TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)           REFERENCES tenant.restaurants(id),
    FOREIGN KEY (location_id)         REFERENCES tenant.locations(id),
    FOREIGN KEY (customer_id)         REFERENCES customer.customers(id),
    FOREIGN KEY (delivery_address_id) REFERENCES customer.addresses(id)
    -- session_id FK added post-dining schema below
);

CREATE INDEX idx_orders_tenant   ON orders.orders(tenant_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_orders_customer ON orders.orders(customer_id)                WHERE deleted_at IS NULL;
CREATE INDEX idx_orders_status   ON orders.orders(tenant_id, status)          WHERE deleted_at IS NULL;
CREATE INDEX idx_orders_location ON orders.orders(location_id, created_at DESC);


-- Line items with full price snapshot (immutable audit trail).
-- base_price = GENERATED ALWAYS AS (unit_price * quantity).
-- addons_total = app-supplied sum of price_modifier across customizations.
-- total_price must exactly equal base_price + addons_total.
--
-- [FIX-25] CHECK changed from >= to exact equality. The old check allowed
--          total_price to be set higher than base + addons (phantom revenue)
--          or lower with negative addons silently breaking the constraint.
CREATE TABLE orders.order_items (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL,
    order_id      UUID NOT NULL,
    menu_item_id  UUID,
    variant_id    UUID,
    combo_id      UUID,
    -- Snapshots — taken at order time, NEVER updated
    item_name     TEXT NOT NULL,
    variant_name  TEXT,
    unit_price    NUMERIC(10,2) NOT NULL,
    tax_rate      NUMERIC(5,2)  NOT NULL DEFAULT 0,
    quantity      INTEGER NOT NULL CHECK (quantity > 0),
    base_price    NUMERIC(10,2) GENERATED ALWAYS AS (unit_price * quantity) STORED,
    addons_total  NUMERIC(10,2) NOT NULL DEFAULT 0,
    total_price   NUMERIC(10,2) NOT NULL,
    -- [FIX-25] Exact equality: prevents both under and over-reporting
    CONSTRAINT chk_order_item_total CHECK (
        total_price = (unit_price * quantity) + addons_total
    ),
    special_note  TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)    REFERENCES tenant.restaurants(id),
    FOREIGN KEY (order_id)     REFERENCES orders.orders(id)      ON DELETE CASCADE,
    FOREIGN KEY (menu_item_id) REFERENCES menu.menu_items(id),
    FOREIGN KEY (variant_id)   REFERENCES menu.item_variants(id),
    FOREIGN KEY (combo_id)     REFERENCES menu.combos(id)
);

CREATE INDEX idx_order_items_order ON orders.order_items(order_id);


-- Customization selections per line item — prices snapshotted at order time.
-- Soft refs intentional: menu options can be deleted after an order is placed.
-- option_name and price_modifier are NOT NULL snapshots.
CREATE TABLE orders.order_item_customizations (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL,
    order_item_id  UUID NOT NULL,
    group_id       UUID,           -- soft ref to customization_groups
    option_id      UUID,           -- soft ref (option may be deleted post-order)
    option_name    TEXT NOT NULL,  -- snapshot — must be captured at order time
    price_modifier NUMERIC(10,2) NOT NULL DEFAULT 0,  -- snapshot
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)     REFERENCES tenant.restaurants(id),
    FOREIGN KEY (order_item_id) REFERENCES orders.order_items(id) ON DELETE CASCADE
);

CREATE INDEX idx_order_customizations_item ON orders.order_item_customizations(order_item_id);


-- Tax breakdown per order (CGST, SGST, VAT, Service Charge).
-- rate and amount are NOT NULL — a tax row with no value is meaningless.
CREATE TABLE orders.order_taxes (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID NOT NULL,
    order_id   UUID NOT NULL,
    tax_name   TEXT NOT NULL,
    rate       NUMERIC(5,2)  NOT NULL,
    amount     NUMERIC(10,2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id),
    FOREIGN KEY (order_id)  REFERENCES orders.orders(id) ON DELETE CASCADE
);

CREATE INDEX idx_order_taxes_order ON orders.order_taxes(order_id);


-- Discount / coupon application per order.
-- [FIX-39] amount_saved is NOT NULL DEFAULT 0. Required for revenue
--          reconciliation and audit — a discount row with no saved amount
--          cannot be used in financial reporting.
CREATE TABLE orders.order_discounts (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL,
    order_id       UUID NOT NULL,
    coupon_code    TEXT,
    discount_type  discount_type,
    discount_value NUMERIC(10,2),
    amount_saved   NUMERIC(10,2) NOT NULL DEFAULT 0,  -- [FIX-39]
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id),
    FOREIGN KEY (order_id)  REFERENCES orders.orders(id) ON DELETE CASCADE
);

CREATE INDEX idx_order_discounts_order ON orders.order_discounts(order_id);


-- Coupon definitions managed by the restaurant.
-- used_count race condition: see header for atomic UPDATE pattern.
CREATE TABLE orders.coupons (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    code            TEXT NOT NULL,
    description     TEXT,
    discount_type   discount_type NOT NULL,
    discount_value  NUMERIC(10,2) NOT NULL,
    min_order_value NUMERIC(10,2) NOT NULL DEFAULT 0,
    max_discount    NUMERIC(10,2),
    usage_limit     INTEGER,        -- NULL = unlimited
    used_count      INTEGER NOT NULL DEFAULT 0,
    valid_from      TIMESTAMPTZ,
    valid_until     TIMESTAMPTZ,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, code),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX idx_coupons_tenant ON orders.coupons(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_coupons_code   ON orders.coupons(tenant_id, code)
    WHERE is_active = TRUE AND deleted_at IS NULL;


-- Last-mile delivery job per order (1:1).
CREATE TABLE orders.delivery_jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    order_id        UUID NOT NULL UNIQUE,
    provider        delivery_provider   NOT NULL DEFAULT 'self',
    provider_job_id TEXT,
    tracking_url    TEXT,
    rider_name      TEXT,
    rider_phone     TEXT,
    estimated_time  TIMESTAMPTZ,
    picked_up_at    TIMESTAMPTZ,
    delivered_at    TIMESTAMPTZ,
    status          delivery_job_status NOT NULL DEFAULT 'pending',
    raw_webhook     JSONB,          -- raw provider webhook payload
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id),
    FOREIGN KEY (order_id)  REFERENCES orders.orders(id)
);

CREATE INDEX idx_delivery_jobs_order ON orders.delivery_jobs(order_id);


-- Wire order_id FK on loyalty_transactions now that orders exists.
ALTER TABLE customer.loyalty_transactions
    ADD CONSTRAINT fk_loyalty_txn_order
        FOREIGN KEY (order_id) REFERENCES orders.orders(id);


-- ============================================================
-- PAYMENTS SCHEMA
-- ============================================================

-- Razorpay payment records.
-- gateway_ref UNIQUE prevents double-capture on webhook retry.
-- [FIX-30] Authorized and captured payments must carry a positive amount.
CREATE TABLE payments.payments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    order_id        UUID,           -- NULL during payment init; set on capture
    amount          NUMERIC(10,2),
    tip_amount      NUMERIC(10,2) NOT NULL DEFAULT 0,
    tax_amount      NUMERIC(10,2) NOT NULL DEFAULT 0,
    -- 'upi','card','netbanking','cash','wallet'
    method          TEXT,
    -- 'razorpay'
    gateway         TEXT,
    transaction_ref TEXT,
    gateway_ref     TEXT,           -- Razorpay payment_id / order_id
    CONSTRAINT uq_payments_gateway_ref UNIQUE (gateway_ref),
    status          payment_status NOT NULL DEFAULT 'pending',
    -- [FIX-30] Captured/authorized payments must have a positive amount
    CONSTRAINT chk_payment_amount CHECK (
        status NOT IN ('authorized','captured')
        OR (amount IS NOT NULL AND amount > 0)
    ),
    refunded_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
    refunded_at     TIMESTAMPTZ,
    metadata        JSONB NOT NULL DEFAULT '{}',
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id),
    FOREIGN KEY (order_id)  REFERENCES orders.orders(id)
);

CREATE INDEX idx_payments_tenant  ON payments.payments(tenant_id, created_at DESC);
CREATE INDEX idx_payments_order   ON payments.payments(order_id);
CREATE INDEX idx_payments_status  ON payments.payments(tenant_id, status);
-- gateway_ref: UNIQUE constraint above creates a unique index.
-- Partial index provides fast IS NOT NULL filtered scans.
CREATE INDEX idx_payments_gateway ON payments.payments(gateway_ref)
    WHERE gateway_ref IS NOT NULL;


-- ============================================================
-- DINING SCHEMA
-- ============================================================

-- QR-coded physical tables.
CREATE TABLE dining.tables (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL,
    location_id UUID NOT NULL,
    -- 'T1', 'Window Table', 'Private Room'
    name        TEXT,
    capacity    INTEGER,
    floor       TEXT,
    position    TEXT,           -- JSON coordinate or label
    status      table_status NOT NULL DEFAULT 'available',
    qr_code     TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    deleted_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)   REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (location_id) REFERENCES tenant.locations(id)
);

CREATE INDEX idx_tables_location ON dining.tables(location_id) WHERE deleted_at IS NULL;


-- Live dining session opened when guests are seated.
-- reservation_id FK wired after dining.reservations below.
-- [FIX-35] Only one open (non-closed, non-deleted) session per table at a time.
CREATE TABLE dining.sessions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL,
    location_id    UUID,
    table_id       UUID NOT NULL,
    reservation_id UUID,        -- FK wired below
    covers         SMALLINT,    -- guest count
    opened_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at      TIMESTAMPTZ,
    total_billed   NUMERIC(10,2),
    metadata       JSONB NOT NULL DEFAULT '{}',
    deleted_at     TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)   REFERENCES tenant.restaurants(id),
    FOREIGN KEY (location_id) REFERENCES tenant.locations(id),
    FOREIGN KEY (table_id)    REFERENCES dining.tables(id)
    -- reservation_id FK added below after dining.reservations
);

CREATE INDEX idx_sessions_tenant ON dining.sessions(tenant_id, opened_at DESC);
CREATE INDEX idx_sessions_table  ON dining.sessions(table_id);
CREATE INDEX idx_sessions_open   ON dining.sessions(tenant_id)
    WHERE closed_at IS NULL AND deleted_at IS NULL;
-- [FIX-35] Prevent double-seating the same table simultaneously.
CREATE UNIQUE INDEX idx_sessions_table_open
    ON dining.sessions(table_id)
    WHERE closed_at IS NULL AND deleted_at IS NULL;


-- Pre-booked covers with deposit tracking.
-- [FIX-37] reservation_time is required once a reservation leaves 'pending'.
--          A confirmed/seated/completed reservation without a time breaks
--          reminder scheduling and the host dashboard.
CREATE TABLE dining.reservations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL,
    location_id         UUID,
    customer_id         UUID,
    table_id            UUID,
    party_size          INTEGER,
    reservation_time    TIMESTAMPTZ,
    status              reservation_status NOT NULL DEFAULT 'pending',
    -- [FIX-37]
    CONSTRAINT chk_reservation_time CHECK (
        status = 'pending' OR reservation_time IS NOT NULL
    ),
    -- 'web','phone','walk_in','whatsapp'
    source              TEXT,
    -- 'birthday','anniversary','business'
    occasion            TEXT,
    dietary_notes       TEXT,
    deposit_amount      NUMERIC(10,2) NOT NULL DEFAULT 0,
    deposit_paid        BOOLEAN NOT NULL DEFAULT FALSE,
    deposit_payment_id  UUID,
    confirmation_code   TEXT UNIQUE,
    reminder_sent       BOOLEAN NOT NULL DEFAULT FALSE,
    cancelled_at        TIMESTAMPTZ,
    cancellation_reason TEXT,
    metadata            JSONB NOT NULL DEFAULT '{}',
    deleted_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)          REFERENCES tenant.restaurants(id),
    FOREIGN KEY (location_id)        REFERENCES tenant.locations(id),
    FOREIGN KEY (customer_id)        REFERENCES customer.customers(id),
    FOREIGN KEY (table_id)           REFERENCES dining.tables(id),
    FOREIGN KEY (deposit_payment_id) REFERENCES payments.payments(id)
);

CREATE INDEX idx_reservations_tenant   ON dining.reservations(tenant_id, reservation_time DESC);
CREATE INDEX idx_reservations_customer ON dining.reservations(customer_id);
CREATE INDEX idx_reservations_status   ON dining.reservations(tenant_id, status);
CREATE INDEX idx_reservations_time     ON dining.reservations(tenant_id, reservation_time)
    WHERE deleted_at IS NULL;


-- Wire reservation_id FK on dining.sessions now that reservations exists.
ALTER TABLE dining.sessions
    ADD CONSTRAINT fk_session_reservation
        FOREIGN KEY (reservation_id) REFERENCES dining.reservations(id);


-- Walk-in waitlist.
CREATE TABLE dining.waitlist (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL,
    location_id UUID,
    customer_id UUID,
    party_size  INTEGER,
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    quoted_wait SMALLINT,       -- estimated wait in minutes
    notified_at TIMESTAMPTZ,
    seated_at   TIMESTAMPTZ,
    status      waitlist_status NOT NULL DEFAULT 'waiting',
    deleted_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)   REFERENCES tenant.restaurants(id),
    FOREIGN KEY (location_id) REFERENCES tenant.locations(id),
    FOREIGN KEY (customer_id) REFERENCES customer.customers(id)
);

CREATE INDEX idx_waitlist_tenant ON dining.waitlist(tenant_id, joined_at DESC);
CREATE INDEX idx_waitlist_active ON dining.waitlist(tenant_id)
    WHERE status = 'waiting' AND deleted_at IS NULL;


-- Customer reviews — public-facing, with staff reply capability.
-- Scoped to orders and/or dining sessions; sourced from review solicitation flow.
-- For internal/operational feedback use customer.feedback instead.
-- replied_by is a hard FK to tenant.staff.
CREATE TABLE dining.reviews (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL,
    order_id         UUID,
    session_id       UUID,
    customer_id      UUID,
    rating           SMALLINT CHECK (rating          BETWEEN 1 AND 5),
    food_rating      SMALLINT CHECK (food_rating     BETWEEN 1 AND 5),
    service_rating   SMALLINT CHECK (service_rating  BETWEEN 1 AND 5),
    ambience_rating  SMALLINT CHECK (ambience_rating BETWEEN 1 AND 5),
    delivery_rating  SMALLINT CHECK (delivery_rating BETWEEN 1 AND 5),
    comment          TEXT,
    -- 'platform','google','zomato'
    source           TEXT NOT NULL DEFAULT 'platform',
    is_published     BOOLEAN NOT NULL DEFAULT FALSE,
    reply            TEXT,
    replied_at       TIMESTAMPTZ,
    replied_by       UUID,
    deleted_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)   REFERENCES tenant.restaurants(id),
    FOREIGN KEY (order_id)    REFERENCES orders.orders(id),
    FOREIGN KEY (session_id)  REFERENCES dining.sessions(id),
    FOREIGN KEY (customer_id) REFERENCES customer.customers(id),
    FOREIGN KEY (replied_by)  REFERENCES tenant.staff(id)
);

CREATE INDEX idx_reviews_tenant    ON dining.reviews(tenant_id, created_at DESC);
CREATE INDEX idx_reviews_customer  ON dining.reviews(customer_id);
CREATE INDEX idx_reviews_published ON dining.reviews(tenant_id)
    WHERE is_published = TRUE AND deleted_at IS NULL;


-- Wire session_id FK on orders.orders now that dining.sessions exists.
ALTER TABLE orders.orders
    ADD CONSTRAINT fk_order_session
        FOREIGN KEY (session_id) REFERENCES dining.sessions(id);


-- ============================================================
-- CATERING SCHEMA
-- ============================================================

-- Per-restaurant public enquiry form configuration (1:1).
CREATE TABLE catering.enquiry_forms (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL UNIQUE,
    standard_fields   JSONB NOT NULL DEFAULT '{}',
    custom_fields     JSONB NOT NULL DEFAULT '[]',
    thank_you_message TEXT,
    notify_email      TEXT,
    notify_whatsapp   TEXT,
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    deleted_at        TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);


-- Stage 1 — raw enquiry / CRM pipeline.
-- assigned_to (legacy TEXT soft ref) removed in v7. Use assigned_staff_id.
-- event_id FK wired after catering.events below.
-- [FIX-32] event_id set implies converted status — enforced at DB level.
CREATE TABLE catering.leads (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL,
    contact_name        TEXT NOT NULL,
    contact_phone       TEXT NOT NULL,
    contact_email       TEXT,
    -- 'wedding','corporate','birthday','other'
    event_type          TEXT,
    guest_count_min     INTEGER,
    guest_count_max     INTEGER,
    preferred_date_from DATE,
    preferred_date_to   DATE,
    budget_min          NUMERIC(10,2),
    budget_max          NUMERIC(10,2),
    venue_preference    TEXT,
    notes               TEXT,
    custom_fields       JSONB NOT NULL DEFAULT '{}',
    status              catering_lead_status NOT NULL DEFAULT 'new',
    assigned_staff_id   UUID,
    follow_up_at        TIMESTAMPTZ,
    customer_id         UUID,
    event_id            UUID,  -- populated on conversion; FK wired after events
    -- [FIX-32] event_id set → must be converted
    CONSTRAINT chk_lead_conversion CHECK (
        event_id IS NULL OR status = 'converted'
    ),
    -- 'web','phone','referral','walk_in'
    source              TEXT NOT NULL DEFAULT 'web',
    utm_source          TEXT,
    utm_medium          TEXT,
    deleted_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)         REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id)       REFERENCES customer.customers(id),
    FOREIGN KEY (assigned_staff_id) REFERENCES tenant.staff(id)
    -- event_id FK added after catering.events
);

CREATE INDEX idx_leads_tenant   ON catering.leads(tenant_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_leads_status   ON catering.leads(tenant_id, status)          WHERE deleted_at IS NULL;
CREATE INDEX idx_leads_customer ON catering.leads(customer_id);
CREATE INDEX idx_leads_followup ON catering.leads(tenant_id, follow_up_at)
    WHERE follow_up_at IS NOT NULL AND status NOT IN ('converted','lost');


-- Staff follow-up activity log per lead.
-- staff_id = preferred attribution (hard FK to tenant.staff).
-- author = legacy TEXT fallback. Deprecated — will be dropped in v9.
--   v9 migration plan: backfill staff_id via name match on tenant.staff,
--   NULL out author on matched rows, then DROP COLUMN author in v9 migration.
-- [FIX-33] At least one attribution field must be populated.
CREATE TABLE catering.lead_notes (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL,
    lead_id      UUID NOT NULL,
    staff_id     UUID,
    author       TEXT,          -- deprecated — drop in v9
    note         TEXT NOT NULL,
    follow_up_at TIMESTAMPTZ,
    -- [FIX-33] At least one of staff_id or author must be set
    CONSTRAINT chk_note_attribution CHECK (
        staff_id IS NOT NULL OR author IS NOT NULL
    ),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (lead_id)   REFERENCES catering.leads(id)     ON DELETE CASCADE,
    FOREIGN KEY (staff_id)  REFERENCES tenant.staff(id)
);

CREATE INDEX idx_lead_notes_lead ON catering.lead_notes(lead_id);


-- Stage 2 — confirmed execution record.
-- event_date_from / event_date_to are NOT NULL (single-day: set from = to).
-- assigned_to TEXT removed in v7. Use assigned_staff_id.
CREATE TABLE catering.events (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL,
    location_id         UUID,
    customer_id         UUID NOT NULL,
    lead_id             UUID,
    event_name          TEXT,
    -- 'wedding','corporate','birthday','other'
    event_type          TEXT,
    guest_count         INTEGER,
    event_date_from     DATE NOT NULL,
    event_date_to       DATE NOT NULL,
    CONSTRAINT chk_event_date_range CHECK (event_date_to >= event_date_from),
    venue_address       TEXT,
    setup_time          TIMESTAMPTZ,
    start_time          TIMESTAMPTZ,
    end_time            TIMESTAMPTZ,
    status              catering_event_status NOT NULL DEFAULT 'confirmed',
    advance_amount      NUMERIC(10,2) NOT NULL DEFAULT 0,
    advance_paid        BOOLEAN NOT NULL DEFAULT FALSE,
    advance_payment_id  UUID,
    notes               TEXT,
    assigned_staff_id   UUID,
    metadata            JSONB NOT NULL DEFAULT '{}',
    deleted_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)          REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (location_id)        REFERENCES tenant.locations(id),
    FOREIGN KEY (customer_id)        REFERENCES customer.customers(id),
    FOREIGN KEY (lead_id)            REFERENCES catering.leads(id),
    FOREIGN KEY (advance_payment_id) REFERENCES payments.payments(id),
    FOREIGN KEY (assigned_staff_id)  REFERENCES tenant.staff(id)
);

CREATE INDEX idx_events_tenant   ON catering.events(tenant_id, event_date_from DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_events_customer ON catering.events(customer_id);
CREATE INDEX idx_events_status   ON catering.events(tenant_id, status);


-- Per-day operational record for multi-day catering events.
-- Single-day events have exactly 1 child row.
CREATE TABLE catering.event_days (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL,
    event_id          UUID NOT NULL,
    event_date        DATE NOT NULL,
    -- 'Mehendi', 'Sangeet', 'Wedding', 'Day 1'
    day_label         TEXT,
    guest_count       INTEGER,
    venue_address     TEXT,
    setup_time        TIMESTAMPTZ,
    start_time        TIMESTAMPTZ,
    end_time          TIMESTAMPTZ,
    notes             TEXT,
    assigned_staff_id UUID,
    status            catering_event_status NOT NULL DEFAULT 'confirmed',
    metadata          JSONB NOT NULL DEFAULT '{}',
    deleted_at        TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)         REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (event_id)          REFERENCES catering.events(id)    ON DELETE CASCADE,
    FOREIGN KEY (assigned_staff_id) REFERENCES tenant.staff(id)
);

CREATE INDEX idx_event_days_event ON catering.event_days(event_id);
CREATE INDEX idx_event_days_date  ON catering.event_days(tenant_id, event_date);
CREATE UNIQUE INDEX idx_event_days_unique_date
    ON catering.event_days(event_id, event_date)
    WHERE deleted_at IS NULL;


-- Wire deferred event_id FK on catering.leads now that catering.events exists.
ALTER TABLE catering.leads
    ADD CONSTRAINT fk_lead_event
        FOREIGN KEY (event_id) REFERENCES catering.events(id);


-- Versioned financial proposals per lead.
-- [FIX-28] Quotes in 'sent' or 'accepted' status must have total_amount set.
--          Draft / revised quotes may legitimately be NULL during construction.
CREATE TABLE catering.quotes (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL,
    lead_id        UUID NOT NULL,
    event_id       UUID,
    event_day_id   UUID,        -- optional: quote scoped to a specific day
    version        SMALLINT NOT NULL DEFAULT 1,
    status         quote_status NOT NULL DEFAULT 'draft',
    total_amount   NUMERIC(10,2),
    -- [FIX-28]
    CONSTRAINT chk_quote_total_set CHECK (
        status NOT IN ('sent','accepted')
        OR total_amount IS NOT NULL
    ),
    valid_until    DATE,
    advance_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
    terms_notes    TEXT,
    sent_at        TIMESTAMPTZ,
    accepted_at    TIMESTAMPTZ,
    deleted_at     TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)    REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (lead_id)      REFERENCES catering.leads(id),
    FOREIGN KEY (event_id)     REFERENCES catering.events(id),
    FOREIGN KEY (event_day_id) REFERENCES catering.event_days(id)
);

CREATE INDEX idx_quotes_lead   ON catering.quotes(lead_id);
CREATE INDEX idx_quotes_event  ON catering.quotes(event_id);
CREATE INDEX idx_quotes_status ON catering.quotes(tenant_id, status);


-- Quote line items. total_price is GENERATED ALWAYS (unit × qty).
-- package_id FK wired after catering.packages below.
CREATE TABLE catering.quote_items (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL,
    quote_id     UUID NOT NULL,
    description  TEXT NOT NULL,
    menu_item_id UUID,
    package_id   UUID,          -- FK wired after packages
    quantity     INTEGER NOT NULL DEFAULT 1,
    unit_price   NUMERIC(10,2) NOT NULL,
    total_price  NUMERIC(10,2) GENERATED ALWAYS AS (unit_price * quantity) STORED,
    notes        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)    REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (quote_id)     REFERENCES catering.quotes(id)    ON DELETE CASCADE,
    FOREIGN KEY (menu_item_id) REFERENCES menu.menu_items(id)
);

CREATE INDEX idx_quote_items_quote ON catering.quote_items(quote_id);


-- Reusable buffet / menu package templates.
CREATE TABLE catering.packages (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL,
    name           TEXT NOT NULL,
    description    TEXT,
    price_per_head NUMERIC(10,2) NOT NULL,
    min_guests     INTEGER,
    max_guests     INTEGER,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    deleted_at     TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX idx_packages_tenant ON catering.packages(tenant_id) WHERE deleted_at IS NULL;


-- Wire deferred package_id FK on catering.quote_items.
ALTER TABLE catering.quote_items
    ADD CONSTRAINT fk_quote_item_package
        FOREIGN KEY (package_id) REFERENCES catering.packages(id);


-- Menu items within a package with per-head quantity.
CREATE TABLE catering.package_items (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL,
    package_id          UUID NOT NULL,
    menu_item_id        UUID NOT NULL,
    quantity_per_head   NUMERIC(5,2) NOT NULL DEFAULT 1,
    unit_price_per_head NUMERIC(10,2),
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)    REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (package_id)   REFERENCES catering.packages(id)  ON DELETE CASCADE,
    FOREIGN KEY (menu_item_id) REFERENCES menu.menu_items(id)
);

CREATE INDEX idx_package_items_package ON catering.package_items(package_id);


-- ============================================================
-- INSIGHTS SCHEMA
-- ============================================================

-- Pre-aggregated daily KPIs per tenant / location.
-- Populated by background jobs — never query from hot path.
-- UNIQUE index uses COALESCE sentinel: NULL location_id (all-location aggregate)
-- gets a fixed sentinel UUID so PG NULL != NULL semantics don't allow duplicates.
--
-- [FIX-36] computed_at is NOT maintained by the set_updated_at() trigger
--          (this table has no updated_at column). Workers must explicitly
--          set computed_at = NOW() in ON CONFLICT DO UPDATE:
--
--   INSERT INTO insights.daily_metrics (tenant_id, location_id, metric_date,
--                                       metric_type, value, breakdown, computed_at)
--   VALUES ($1, $2, $3, $4, $5, $6, NOW())
--   ON CONFLICT ON CONSTRAINT idx_daily_metrics_unique DO UPDATE
--     SET value       = EXCLUDED.value,
--         breakdown   = EXCLUDED.breakdown,
--         computed_at = NOW();
CREATE TABLE insights.daily_metrics (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL,
    location_id  UUID,           -- NULL = all-location aggregate
    metric_date  DATE NOT NULL,
    metric_type  insight_metric_type NOT NULL,
    value        NUMERIC(14,4) NOT NULL,
    breakdown    JSONB,
    computed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)   REFERENCES tenant.restaurants(id),
    FOREIGN KEY (location_id) REFERENCES tenant.locations(id)
);

CREATE UNIQUE INDEX idx_daily_metrics_unique
    ON insights.daily_metrics (
        tenant_id,
        COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::UUID),
        metric_date,
        metric_type
    );
CREATE INDEX idx_daily_metrics_tenant ON insights.daily_metrics(tenant_id, metric_date DESC);


-- Per-item daily performance roll-up.
CREATE TABLE insights.item_performance (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL,
    menu_item_id  UUID NOT NULL,
    metric_date   DATE NOT NULL,
    units_sold    INTEGER NOT NULL DEFAULT 0,
    gross_revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
    refund_count  INTEGER NOT NULL DEFAULT 0,
    avg_rating    NUMERIC(3,2),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, menu_item_id, metric_date),
    FOREIGN KEY (tenant_id)    REFERENCES tenant.restaurants(id),
    FOREIGN KEY (menu_item_id) REFERENCES menu.menu_items(id)
);

CREATE INDEX idx_item_perf_tenant ON insights.item_performance(tenant_id, metric_date DESC);
CREATE INDEX idx_item_perf_item   ON insights.item_performance(menu_item_id);


-- Cached review aggregate — one row per restaurant (1:1).
-- Recomputed by background job on every new review.
CREATE TABLE insights.review_summary (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL UNIQUE,
    total_reviews INTEGER NOT NULL DEFAULT 0,
    avg_rating    NUMERIC(3,2),
    five_star     INTEGER NOT NULL DEFAULT 0,
    four_star     INTEGER NOT NULL DEFAULT 0,
    three_star    INTEGER NOT NULL DEFAULT 0,
    two_star      INTEGER NOT NULL DEFAULT 0,
    one_star      INTEGER NOT NULL DEFAULT 0,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id)
);


-- Raw analytics event stream. Append-only — never UPDATE or DELETE.
-- Source of truth for ad-hoc analytics and aggregation jobs.
-- Consumer: background workers → insights.daily_metrics.
-- Switch to BRIN at >1M rows:
--   DROP INDEX idx_insights_events_tenant;
--   CREATE INDEX idx_insights_events_tenant_brin
--       ON insights.events USING BRIN (tenant_id, created_at);
CREATE TABLE insights.events (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL,
    -- 'order','menu_item','customer','session'
    entity_type  TEXT NOT NULL,
    entity_id    UUID,
    -- 'qr_scan','menu_view','add_to_cart','order_placed'
    event_type   TEXT NOT NULL,
    payload      JSONB NOT NULL DEFAULT '{}',
    actor_id     UUID,           -- customer_id or staff_id
    session_ref  TEXT,           -- anonymous session token pre-auth
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id)
);

CREATE INDEX idx_insights_events_tenant ON insights.events(tenant_id, created_at DESC);
CREATE INDEX idx_insights_events_entity ON insights.events(entity_type, entity_id);
CREATE INDEX idx_insights_events_type   ON insights.events(tenant_id, event_type);


-- ============================================================
-- PLATFORM SCHEMA
-- ============================================================

-- Transactional outbox for at-least-once event delivery.
-- App writes to this table in the SAME DB transaction as the domain event.
-- Background worker polls and delivers.
-- [FIX-40] retry_count capped at 25. A worker bug cannot grow the count
--          unboundedly. At threshold, transition to 'dead' and stop retrying.
CREATE TABLE platform.event_outbox (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL,
    -- 'order.confirmed', 'reservation.reminder'
    event_type     TEXT NOT NULL,
    -- 'order','reservation','catering_event'
    aggregate_type TEXT NOT NULL,
    aggregate_id   UUID NOT NULL,
    payload        JSONB NOT NULL DEFAULT '{}',
    status         outbox_status NOT NULL DEFAULT 'pending',
    retry_count    SMALLINT NOT NULL DEFAULT 0
                       CHECK (retry_count >= 0 AND retry_count <= 25),  -- [FIX-40]
    error_detail   TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at   TIMESTAMPTZ,
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id)
);

-- retry_count in index allows worker to order by backoff priority.
CREATE INDEX idx_outbox_pending ON platform.event_outbox(created_at, retry_count)
    WHERE status IN ('pending','failed');
CREATE INDEX idx_outbox_tenant  ON platform.event_outbox(tenant_id, created_at DESC);


-- Registered webhook endpoints per tenant.
CREATE TABLE platform.webhooks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL,
    url         TEXT NOT NULL,
    secret      TEXT,           -- HMAC signing secret
    event_types TEXT[],         -- NULL = all events
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    deleted_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX idx_webhooks_tenant ON platform.webhooks(tenant_id) WHERE deleted_at IS NULL;


-- Webhook delivery attempt log per outbox event.
CREATE TABLE platform.webhook_deliveries (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    outbox_id     UUID NOT NULL,
    webhook_id    UUID NOT NULL,
    http_status   SMALLINT,
    response_body TEXT,
    attempt_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    duration_ms   INTEGER,
    FOREIGN KEY (outbox_id)  REFERENCES platform.event_outbox(id),
    FOREIGN KEY (webhook_id) REFERENCES platform.webhooks(id)
);

CREATE INDEX idx_webhook_deliveries_outbox ON platform.webhook_deliveries(outbox_id);


-- Template library for outbound notifications.
-- One template per (tenant, trigger_event, channel, language).
CREATE TABLE platform.notification_templates (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL,
    name                TEXT NOT NULL,
    -- 'order.confirmed','reservation.reminder','feedback.solicitation.order', etc.
    trigger_event       TEXT NOT NULL,
    channel             notification_channel NOT NULL,
    language            TEXT NOT NULL DEFAULT 'en',
    subject             TEXT,   -- email subject (NULL for whatsapp/sms)
    body_template       TEXT NOT NULL,  -- {{variable}} placeholder syntax
    -- WhatsApp Business API
    wa_template_name    TEXT,
    wa_template_lang    TEXT DEFAULT 'en',
    wa_component_params JSONB DEFAULT '[]',
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    is_system           BOOLEAN NOT NULL DEFAULT FALSE,
    preview_vars        JSONB NOT NULL DEFAULT '{}',
    deleted_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by          UUID,
    UNIQUE (tenant_id, trigger_event, channel, language),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX idx_notif_templates_tenant ON platform.notification_templates(tenant_id);
CREATE INDEX idx_notif_templates_event  ON platform.notification_templates(trigger_event);
CREATE INDEX idx_notif_templates_active ON platform.notification_templates(tenant_id, channel)
    WHERE is_active = TRUE AND deleted_at IS NULL;


-- Individual outbound notification dispatch record. Append-only.
CREATE TABLE platform.notifications (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID NOT NULL,
    template_id          UUID,
    customer_id          UUID,
    staff_id             UUID,
    recipient_phone      TEXT,
    recipient_email      TEXT,
    recipient_push_token TEXT,
    channel              notification_channel NOT NULL,
    subject              TEXT,
    body                 TEXT NOT NULL,
    trigger_event        TEXT,
    -- 'order','reservation','catering_event'
    entity_type          TEXT,
    entity_id            UUID,
    status               notification_status NOT NULL DEFAULT 'queued',
    -- 'twilio','gupshup','sendgrid','firebase'
    provider             TEXT,
    provider_msg_id      TEXT,
    sent_at              TIMESTAMPTZ,
    delivered_at         TIMESTAMPTZ,
    failed_at            TIMESTAMPTZ,
    failure_reason       TEXT,
    metadata             JSONB NOT NULL DEFAULT '{}',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)   REFERENCES tenant.restaurants(id),
    FOREIGN KEY (template_id) REFERENCES platform.notification_templates(id),
    FOREIGN KEY (customer_id) REFERENCES customer.customers(id),
    FOREIGN KEY (staff_id)    REFERENCES tenant.staff(id)
);

CREATE INDEX idx_notifications_tenant       ON platform.notifications(tenant_id, created_at DESC);
CREATE INDEX idx_notifications_customer     ON platform.notifications(customer_id);
CREATE INDEX idx_notifications_entity       ON platform.notifications(entity_type, entity_id);
CREATE INDEX idx_notifications_status       ON platform.notifications(status)
    WHERE status IN ('queued','failed');
CREATE INDEX idx_notifications_provider_msg ON platform.notifications(provider_msg_id)
    WHERE provider_msg_id IS NOT NULL;


-- Inbound engagement signals from outbound notifications.
-- Records opens, clicks, replies, opt-outs from provider webhooks. Append-only.
--
-- [FIX-31] Inline UNIQUE (provider, provider_event_id) replaced with a partial
--          unique index WHERE provider_event_id IS NOT NULL.
--          Rationale: providers that don't supply event IDs (or manually injected
--          rows) produce NULL provider_event_id. PG treats each NULL as distinct,
--          so the old UNIQUE allowed unlimited duplicates for NULL rows — no
--          dedup protection at all for that case, while technically having a
--          UNIQUE. The partial index gives clean dedup for providers that do
--          supply IDs, and intentionally allows multiple NULL rows.
CREATE TABLE platform.notification_engagement (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL,
    notification_id   UUID NOT NULL,
    customer_id       UUID,
    engagement_type   notification_engagement_type NOT NULL,
    link_url          TEXT,       -- for 'clicked': which link
    reply_body        TEXT,       -- for 'replied': reply content
    provider          TEXT,
    provider_event_id TEXT,
    raw_payload       JSONB NOT NULL DEFAULT '{}',
    occurred_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)       REFERENCES tenant.restaurants(id),
    FOREIGN KEY (notification_id) REFERENCES platform.notifications(id),
    FOREIGN KEY (customer_id)     REFERENCES customer.customers(id)
);

-- [FIX-31] Partial unique index: dedup provider callbacks with a real event ID.
CREATE UNIQUE INDEX idx_engagement_dedup
    ON platform.notification_engagement(provider, provider_event_id)
    WHERE provider_event_id IS NOT NULL;
CREATE INDEX idx_notif_engagement_notification ON platform.notification_engagement(notification_id);
CREATE INDEX idx_notif_engagement_customer     ON platform.notification_engagement(customer_id);
CREATE INDEX idx_notif_engagement_type         ON platform.notification_engagement(tenant_id, engagement_type);
CREATE INDEX idx_notif_engagement_occurred     ON platform.notification_engagement(tenant_id, occurred_at DESC);


-- Platform-level audit trail. Append-only.
-- Partition by created_at when row count exceeds ~5M. BRIN candidate:
--   CREATE INDEX idx_audit_log_created_brin ON platform.audit_log USING BRIN (created_at);
-- entity_type and entity_id must both be set or both be NULL (chk_audit_entity_pair).
-- Composite partial index for entity-level audit queries (chk_audit_entity_pair).
-- [FIX-42] actor_type uses audit_actor_type ENUM — replaces TEXT DEFAULT 'staff'.
CREATE TABLE platform.audit_log (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID,           -- NULL for platform-level actions
    actor_id     UUID,
    actor_type   audit_actor_type NOT NULL DEFAULT 'staff',  -- [FIX-42]
    -- 'order.update','menu_item.delete', etc.
    action       TEXT NOT NULL,
    entity_type  TEXT,
    entity_id    UUID,
    CONSTRAINT chk_audit_entity_pair CHECK (
        (entity_type IS NULL) = (entity_id IS NULL)
    ),
    before_state JSONB,
    after_state  JSONB,
    ip_address   TEXT,
    user_agent   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id)
);

CREATE INDEX idx_audit_log_tenant ON platform.audit_log(tenant_id, created_at DESC);
CREATE INDEX idx_audit_log_entity ON platform.audit_log(entity_type, entity_id, created_at DESC)
    WHERE entity_type IS NOT NULL;
CREATE INDEX idx_audit_log_actor  ON platform.audit_log(actor_id);


-- ============================================================
-- WIRE REMAINING DEFERRED FKs
-- ============================================================

-- customer.feedback → platform.notifications
ALTER TABLE customer.feedback
    ADD CONSTRAINT fk_feedback_notification
        FOREIGN KEY (notification_id) REFERENCES platform.notifications(id);


-- ============================================================
-- UPDATED_AT TRIGGER FUNCTION
-- Automatically sets updated_at = NOW() on every UPDATE.
-- Applied to all tables with an updated_at column.
-- Note: insights.daily_metrics has no updated_at column — workers must set
-- computed_at = NOW() explicitly in ON CONFLICT DO UPDATE clauses (see FIX-36).
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DO $$
DECLARE
    tbl RECORD;
BEGIN
    FOR tbl IN
        SELECT table_schema, table_name
        FROM information_schema.columns
        WHERE column_name = 'updated_at'
          AND table_schema IN (
              'tenant','brand','menu','customer','orders',
              'payments','dining','catering','insights','platform'
          )
        GROUP BY table_schema, table_name
    LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_updated_at
             BEFORE UPDATE ON %I.%I
             FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
            tbl.table_schema, tbl.table_name
        );
    END LOOP;
END;
$$;


-- ============================================================
-- SEED DATA — SYSTEM DEFAULTS
-- Run per-tenant at onboarding, not here. Documented for reference.
-- ============================================================

-- Default roles to seed per tenant:
-- INSERT INTO tenant.roles (tenant_id, name, display_name, is_system_role) VALUES
--   (:tid, 'owner',    'Owner',           TRUE),
--   (:tid, 'manager',  'Manager',         TRUE),
--   (:tid, 'cashier',  'Cashier',         TRUE),
--   (:tid, 'kitchen',  'Kitchen Staff',   TRUE),
--   (:tid, 'host',     'Host / Captain',  TRUE),
--   (:tid, 'catering', 'Catering Staff',  TRUE);

-- Default notification templates to seed per tenant:
-- feedback.solicitation.order          (whatsapp + email)
-- feedback.solicitation.catering_event (whatsapp + email)
-- order.confirmed                      (whatsapp)
-- order.delivered                      (whatsapp)
-- reservation.confirmed                (whatsapp + email)
-- reservation.reminder                 (whatsapp + sms)
-- loyalty.tier_upgrade                 (whatsapp)


-- ============================================================
-- SCHEMA SUMMARY
-- ============================================================
-- Schema     Table                          Notes
-- ─────────  ─────────────────────────────  ────────────────────────────────
-- tenant     restaurants                    Root tenant record
-- tenant     locations                      Physical/virtual locations
-- tenant     domains                        Custom domains
-- tenant     operating_hours                Weekly schedule per location
-- tenant     virtual_brands                 Cloud kitchen multi-brand
-- tenant     integrations                   Razorpay/Twilio/etc config
-- tenant     roles                          RBAC named roles
-- tenant     permissions                    Dot-notation permission keys
-- tenant     staff                          Human login accounts
-- tenant     staff_roles                    M:N staff ↔ roles
-- tenant     staff_locations                Location scope per staff
-- tenant     staff_sessions                 Token registry / revocation
-- tenant     tax_rules                      GST/VAT definitions
-- tenant     tax_rule_items                 Item/category → tax rule mapping
-- brand      themes                         Visual identity (1:1)
-- brand      assets                         Logos, banners, OG images
-- brand      seo                            Meta/OG tags (1:1)
-- brand      contact_links                  Social/map links
-- brand      announcements                  Time-bounded storefront banners
-- menu       menus                          Menu containers
-- menu       categories                     Menu sections
-- menu       menu_items                     Core dish records
-- menu       item_variants                  Size/portion variants
-- menu       customization_groups           Add-on groups per item
-- menu       customization_options          Choices within a group
-- menu       item_availability              Day/time overrides per item
-- menu       combos                         Meal deal headers
-- menu       combo_slots                    Selection slots in combos
-- menu       combo_slot_options             Items eligible per slot
-- menu       menu_schedules                 Day+time auto-activation rules
-- customer   customers                      CRM records
-- customer   addresses                      Saved delivery addresses
-- customer   loyalty_accounts               Points wallet per customer
-- customer   loyalty_transactions           Earn/redeem/expire ledger
-- customer   feedback                       Post-interaction signal (all types)
-- customer   interaction_log                CRM timeline per customer
-- orders     orders                         Master order record
-- orders     order_items                    Line items with price snapshot
-- orders     order_item_customizations      Chosen add-ons (snapshotted)
-- orders     order_taxes                    CGST/SGST breakdown per order
-- orders     order_discounts                Coupon application per order
-- orders     coupons                        Coupon definitions
-- orders     delivery_jobs                  Last-mile tracking (1:1 order)
-- payments   payments                       Razorpay payment records
-- dining     tables                         QR-coded physical tables
-- dining     sessions                       Live dine-in sessions
-- dining     reservations                   Pre-bookings with deposit
-- dining     waitlist                       Walk-in queue
-- dining     reviews                        Public reviews with staff reply
-- catering   enquiry_forms                  Public enquiry form config (1:1)
-- catering   leads                          Pipeline stage 1 (enquiry)
-- catering   lead_notes                     Staff follow-up activity log
-- catering   events                         Pipeline stage 2 (confirmed)
-- catering   event_days                     Per-day operational records
-- catering   quotes                         Versioned financial proposals
-- catering   quote_items                    Quote line items (GENERATED total)
-- catering   packages                       Reusable buffet templates
-- catering   package_items                  Items within a package
-- insights   daily_metrics                  Pre-aggregated KPIs
-- insights   item_performance               Per-item daily roll-up
-- insights   review_summary                 Cached rating aggregate (1:1)
-- insights   events                         Raw analytics stream
-- platform   event_outbox                   Transactional event outbox
-- platform   webhooks                       Registered webhook endpoints
-- platform   webhook_deliveries             Delivery attempt log
-- platform   notification_templates         Channel message templates
-- platform   notifications                  Outbound dispatch log
-- platform   notification_engagement        Inbound open/click/reply signal
-- platform   audit_log                      Admin action trail
-- ============================================================
-- Total: 52 tables across 10 schemas
-- v7 → v8: 18 constraint/index changes, 1 new ENUM (audit_actor_type)
--          No tables added or removed.
--          No column additions or removals.
--          catering.lead_notes.author retained (deprecated — drop in v9).
-- ============================================================
