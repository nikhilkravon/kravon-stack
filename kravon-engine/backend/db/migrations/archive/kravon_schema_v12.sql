-- ============================================================
-- kravon_schema_v12.sql
-- Kravon Platform — Consolidated Production Schema
-- Target: PostgreSQL 17
--
-- Consolidated from:
--   V8  — Full core platform (52 tables, 10 schemas)
--   V9  — SaaS infrastructure, event architecture, inventory, AI layer
--   V10 — Enterprise: billing ledger, event versioning, behavioral analytics,
--          inventory stock view, performance indexes, API key hardening
--   V11 — Schema unification, deferred FK resolution, column normalisation
--
-- V12 changes vs V11 (bug fixes only):
--   [V12-01] trg_updated_at DO block: CREATE TRIGGER → CREATE OR REPLACE TRIGGER
--            Prevents "trigger already exists" error on schema re-run (PG 14+).
--   [V12-02] customer.customers: UNIQUE (tenant_id, phone) inline constraint
--            replaced with partial unique index WHERE phone IS NOT NULL AND
--            deleted_at IS NULL — consistent with idx_staff_email_unique pattern.
--   [V12-03] customer.loyalty_transactions: added sign CHECK constraint per
--            transaction type so earn/bonus/refund must be positive,
--            redeem/expire must be negative, adjust allows either sign.
--   [V12-04] insights.review_summary: added missing created_at TIMESTAMPTZ
--            column for audit trail consistency across all operational tables.
--
-- V11 changes (retained):
--   [V11-01] inventory.items.current_stock REMOVED — stock is now exclusively
--            derived from inventory.movements via the stock_levels view.
--   [V11-02] insights.events (V8 raw analytics stream) and platform.events (V9
--            event bus) are DISTINCT tables.
--   [V11-03] catering.lead_notes.author column DROPPED.
--   [V11-04] platform.usage_events and platform.usage_ledger UNIFIED.
--   [V11-05] platform.events gains event_version, processed, processed_at natively.
--   [V11-06] tenant.subscriptions gains updated_at.
--   [V11-07] customer.identities gains updated_at and index on identity_value.
--   [V11-08] platform.api_keys gains UNIQUE constraint on key_hash.
--   [V11-09] insights.customer_segments gains updated_at.
--   [V11-10] inventory schema added to updated_at trigger loop.
--   [V11-11] Updated_at trigger loop extended to cover inventory, insights, tenant.
--   [V11-12] All IF NOT EXISTS guards retained on V9/V10 tables for idempotency.
--
-- Circular dependency resolution order:
--   Extensions → ENUMs → Schemas
--   → tenant (restaurants, locations, domains, operating_hours,
--              virtual_brands, integrations, roles, permissions,
--              staff, staff_roles, staff_locations, staff_sessions,
--              tax_rules, tax_rule_items[deferred FKs],
--              subscriptions, feature_flags)
--   → brand
--   → menu (menus, categories, menu_items, item_variants,
--           customization_groups, customization_options,
--           item_availability, combos, combo_slots,
--           combo_slot_options, menu_schedules)
--   → [wire tax_rule_items deferred FKs to menu]
--   → customer (customers, addresses, loyalty_accounts,
--               loyalty_transactions[deferred order FK],
--               feedback[deferred notification FK],
--               interaction_log, identities)
--   → orders (orders[deferred session FK], order_items,
--             order_item_customizations, order_taxes,
--             order_discounts, coupons, delivery_jobs,
--             order_events)
--   → [wire loyalty_transactions → orders]
--   → payments (payments, payment_events)
--   → dining (tables, sessions[deferred reservation FK],
--             reservations, [wire session→reservation],
--             waitlist, reviews)
--   → [wire orders → sessions]
--   → catering (enquiry_forms, leads[deferred event FK],
--               lead_notes, events, event_days,
--               [wire leads→events], quotes, quote_items,
--               packages, [wire quote_items→packages],
--               package_items)
--   → insights (daily_metrics, item_performance, review_summary,
--               events, menu_views, customer_segments,
--               customer_events)
--   → platform (event_outbox, webhooks, webhook_deliveries,
--               notification_templates, notifications,
--               notification_engagement, audit_log,
--               events, usage_events, usage_ledger, api_keys)
--   → [wire feedback → notifications]
--   → inventory (items, movements, stock_levels view)
--
-- Conventions:
--   • UUID PKs via gen_random_uuid()
--   • tenant_id on every operational table
--   • soft-delete: deleted_at TIMESTAMPTZ
--   • audit: created_at, updated_at (where applicable), created_by, updated_by
--   • TIMESTAMPTZ throughout
--   • JSONB for structural flexibility
--   • Partial indexes on soft-deleted tables (WHERE deleted_at IS NULL)
--   • ENUMs before first use
--   • IF NOT EXISTS on all V9/V10 additions for safe re-run
--
-- Race-condition patterns:
--   Loyalty redemption:
--     UPDATE customer.loyalty_accounts
--        SET points_balance = points_balance - $pts
--      WHERE id = $id AND points_balance >= $pts
--     Verify rowcount = 1 before committing.
--     Use SELECT FOR UPDATE for high-concurrency paths.
--   Coupon redemption:
--     UPDATE orders.coupons
--        SET used_count = used_count + 1
--      WHERE id = $id AND (usage_limit IS NULL OR used_count < usage_limit)
--     Verify rowcount = 1 before committing.
-- ============================================================


-- ============================================================
-- EXTENSIONS
-- ============================================================

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

-- [FIX-42] Prevents free-text drift on the security-critical audit_log field.
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
CREATE SCHEMA IF NOT EXISTS inventory;


-- ============================================================
-- TENANT SCHEMA
-- ============================================================

-- Root tenant record. Every operational table references this via tenant_id.
CREATE TABLE tenant.restaurants (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug          TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    plan          restaurant_plan NOT NULL DEFAULT 'presence',
    status        TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','inactive','suspended')),
    has_presence  BOOLEAN NOT NULL DEFAULT FALSE,
    has_orders    BOOLEAN NOT NULL DEFAULT FALSE,
    has_tables    BOOLEAN NOT NULL DEFAULT FALSE,
    has_catering  BOOLEAN NOT NULL DEFAULT FALSE,
    has_insights  BOOLEAN NOT NULL DEFAULT FALSE,
    settings      JSONB NOT NULL DEFAULT '{}',
    deleted_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by    UUID,
    updated_by    UUID
);

CREATE INDEX idx_restaurants_slug   ON tenant.restaurants(slug)   WHERE deleted_at IS NULL;
CREATE INDEX idx_restaurants_status ON tenant.restaurants(status) WHERE deleted_at IS NULL;


-- Physical or virtual (cloud kitchen) locations under a brand.
CREATE TABLE tenant.locations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL,
    name        TEXT,
    address     TEXT,
    city        TEXT,
    state       TEXT,
    country     TEXT NOT NULL DEFAULT 'IN',
    pincode     TEXT,
    lat         NUMERIC(9,6),
    lng         NUMERIC(9,6),
    timezone    TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    phone       TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    metadata    JSONB NOT NULL DEFAULT '{}',
    deleted_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX idx_locations_tenant ON tenant.locations(tenant_id) WHERE deleted_at IS NULL;


-- Custom domains per tenant.
CREATE TABLE tenant.domains (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL,
    domain      TEXT NOT NULL UNIQUE,
    is_primary  BOOLEAN NOT NULL DEFAULT FALSE,
    verified_at TIMESTAMPTZ,
    deleted_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX idx_domains_tenant ON tenant.domains(tenant_id);
CREATE INDEX idx_domains_domain ON tenant.domains(domain);


-- Weekly operating schedule per location. day_of_week: 0=Sun … 6=Sat.
CREATE TABLE tenant.operating_hours (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL,
    location_id UUID NOT NULL,
    day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    opens_at    TIME NOT NULL,
    closes_at   TIME NOT NULL,
    is_closed   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (location_id, day_of_week),
    FOREIGN KEY (tenant_id)   REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (location_id) REFERENCES tenant.locations(id)   ON DELETE CASCADE
);

CREATE INDEX idx_operating_hours_location ON tenant.operating_hours(location_id);


-- Cloud kitchen: multiple storefronts sharing one physical kitchen.
CREATE TABLE tenant.virtual_brands (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL,
    kitchen_location_id UUID NOT NULL,
    restaurant_id       UUID NOT NULL,
    display_name        TEXT,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    deleted_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)           REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (kitchen_location_id) REFERENCES tenant.locations(id),
    FOREIGN KEY (restaurant_id)       REFERENCES tenant.restaurants(id)
);

CREATE INDEX idx_virtual_brands_tenant ON tenant.virtual_brands(tenant_id);


-- Per-tenant integration credentials (AES-256-GCM encrypted at app layer).
CREATE TABLE tenant.integrations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL,
    -- 'razorpay','twilio','gupshup','sendgrid','firebase'
    provider    TEXT NOT NULL,
    config      JSONB NOT NULL DEFAULT '{}',
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    deleted_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, provider),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX idx_integrations_tenant ON tenant.integrations(tenant_id);


-- Named RBAC roles per tenant. System roles seeded on tenant provisioning.
CREATE TABLE tenant.roles (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL,
    name           TEXT NOT NULL,
    display_name   TEXT,
    description    TEXT,
    is_system_role BOOLEAN NOT NULL DEFAULT FALSE,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    deleted_at     TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by     UUID,
    UNIQUE (tenant_id, name),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX idx_roles_tenant ON tenant.roles(tenant_id);


-- Granular permission keys scoped to a role. Dot-notation: module.resource.action
CREATE TABLE tenant.permissions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL,
    role_id        UUID NOT NULL,
    permission_key TEXT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (role_id, permission_key),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (role_id)   REFERENCES tenant.roles(id)       ON DELETE CASCADE
);

CREATE INDEX idx_permissions_role   ON tenant.permissions(role_id);
CREATE INDEX idx_permissions_tenant ON tenant.permissions(tenant_id);


-- One row per human per tenant.
-- [FIX-29] Partial UNIQUE index on (tenant_id, email) WHERE email IS NOT NULL
--          AND deleted_at IS NULL.
CREATE TABLE tenant.staff (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL,
    name          TEXT NOT NULL,
    email         TEXT,
    phone         TEXT,
    pin           TEXT,           -- bcrypt-hashed 4-6 digit POS PIN
    auth_provider TEXT NOT NULL DEFAULT 'email',
    auth_uid      TEXT,
    avatar_url    TEXT,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    metadata      JSONB NOT NULL DEFAULT '{}',
    deleted_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by    UUID,
    updated_by    UUID,
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX idx_staff_tenant   ON tenant.staff(tenant_id);
CREATE INDEX idx_staff_email    ON tenant.staff(email)    WHERE deleted_at IS NULL;
CREATE INDEX idx_staff_auth_uid ON tenant.staff(auth_uid) WHERE auth_uid IS NOT NULL;
-- [FIX-29]
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
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL,
    staff_id      UUID NOT NULL,
    location_id   UUID NOT NULL,
    all_locations BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (staff_id, location_id),
    FOREIGN KEY (tenant_id)   REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (staff_id)    REFERENCES tenant.staff(id)       ON DELETE CASCADE,
    FOREIGN KEY (location_id) REFERENCES tenant.locations(id)   ON DELETE CASCADE
);

CREATE INDEX idx_staff_locations_staff ON tenant.staff_locations(staff_id);


-- Active session registry for token revocation and concurrent session control.
CREATE TABLE tenant.staff_sessions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL,
    staff_id      UUID NOT NULL,
    session_token TEXT NOT NULL UNIQUE,   -- SHA-256 hashed bearer token
    device_info   JSONB NOT NULL DEFAULT '{}',
    expires_at    TIMESTAMPTZ NOT NULL,
    revoked_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (staff_id)  REFERENCES tenant.staff(id)       ON DELETE CASCADE
);

CREATE INDEX idx_staff_sessions_staff ON tenant.staff_sessions(staff_id);
CREATE INDEX idx_staff_sessions_token ON tenant.staff_sessions(session_token)
    WHERE revoked_at IS NULL;


-- Named tax definitions. India GST: components JSONB carries
-- CGST+SGST as [{"name":"CGST","rate":9},{"name":"SGST","rate":9}].
-- total_rate maintained by app.
-- [FIX-41] Partial UNIQUE on (tenant_id, name) WHERE deleted_at IS NULL.
CREATE TABLE tenant.tax_rules (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL,
    name         TEXT NOT NULL,
    description  TEXT,
    components   JSONB NOT NULL DEFAULT '[]',
    total_rate   NUMERIC(5,2) NOT NULL DEFAULT 0,
    is_inclusive BOOLEAN NOT NULL DEFAULT FALSE,
    is_default   BOOLEAN NOT NULL DEFAULT FALSE,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    deleted_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by   UUID,
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX idx_tax_rules_tenant  ON tenant.tax_rules(tenant_id);
CREATE INDEX idx_tax_rules_default ON tenant.tax_rules(tenant_id)
    WHERE is_default = TRUE AND deleted_at IS NULL;
-- [FIX-41]
CREATE UNIQUE INDEX idx_tax_rules_name_unique
    ON tenant.tax_rules(tenant_id, name)
    WHERE deleted_at IS NULL;


-- Maps tax rule → item / category / combo.
-- Exactly ONE of menu_item_id, category_id, combo_id must be set.
-- Specificity (app-enforced): item > category > default rule.
-- Deferred FKs to menu tables wired after menu schema.
CREATE TABLE tenant.tax_rule_items (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL,
    tax_rule_id  UUID NOT NULL,
    menu_item_id UUID,
    category_id  UUID,
    combo_id     UUID,
    CONSTRAINT chk_tax_target CHECK (
        (menu_item_id IS NOT NULL)::INT +
        (category_id  IS NOT NULL)::INT +
        (combo_id     IS NOT NULL)::INT = 1
    ),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
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


-- ── SAAS BILLING LAYER ──────────────────────────────────────────
-- Subscription record per tenant.
-- [V11-06] Added updated_at for full audit trail consistency.
CREATE TABLE IF NOT EXISTS tenant.subscriptions (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                UUID NOT NULL,
    plan                     restaurant_plan NOT NULL,
    billing_provider         TEXT,
    provider_subscription_id TEXT,
    status                   TEXT NOT NULL
                                 CHECK (status IN ('trial','active','past_due','cancelled','paused')),
    trial_ends_at            TIMESTAMPTZ,
    current_period_start     TIMESTAMPTZ,
    current_period_end       TIMESTAMPTZ,
    cancel_at_period_end     BOOLEAN NOT NULL DEFAULT FALSE,
    metadata                 JSONB NOT NULL DEFAULT '{}',
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),   -- [V11-06]
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant
    ON tenant.subscriptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status
    ON tenant.subscriptions(tenant_id, status);


-- Per-tenant feature flag overrides.
CREATE TABLE IF NOT EXISTS tenant.feature_flags (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL,
    feature_key TEXT NOT NULL,
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    config      JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, feature_key),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_feature_flags_tenant
    ON tenant.feature_flags(tenant_id);


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
-- [FIX-38] url NOT NULL — asset without a URL cannot be rendered.
CREATE TABLE brand.assets (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID NOT NULL,
    type       asset_type,
    url        TEXT NOT NULL,    -- [FIX-38]
    alt_text   TEXT,
    metadata   JSONB NOT NULL DEFAULT '{}',
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX idx_assets_tenant ON brand.assets(tenant_id) WHERE deleted_at IS NULL;


-- SEO / OG meta — one row per tenant (1:1).
CREATE TABLE brand.seo (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL UNIQUE,
    meta_title       TEXT,
    meta_description TEXT,
    og_title         TEXT,
    og_description   TEXT,
    og_image_url     TEXT,
    twitter_handle   TEXT,
    canonical_url    TEXT,
    schema_org_json  JSONB,
    deleted_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);


-- Social / map / review platform links.
CREATE TABLE brand.contact_links (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL,
    platform      TEXT NOT NULL,
    url           TEXT NOT NULL,
    display_label TEXT,
    position      SMALLINT NOT NULL DEFAULT 0,
    deleted_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX idx_contact_links_tenant ON brand.contact_links(tenant_id) WHERE deleted_at IS NULL;


-- Time-bounded storefront banners / announcements.
CREATE TABLE brand.announcements (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID NOT NULL,
    title      TEXT,
    body       TEXT,
    cta_label  TEXT,
    cta_url    TEXT,
    starts_at  TIMESTAMPTZ,
    ends_at    TIMESTAMPTZ,
    is_active  BOOLEAN NOT NULL DEFAULT TRUE,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX idx_announcements_tenant_active ON brand.announcements(tenant_id)
    WHERE is_active = TRUE AND deleted_at IS NULL;


-- ============================================================
-- MENU SCHEMA
-- ============================================================

-- Menu containers per tenant / location.
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
-- [FIX-34] Pricing invariant: has_variants=TRUE → price IS NULL (lives on variants).
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


-- Day / time availability overrides per item.
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


-- Selection slots within a combo.
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
CREATE TABLE menu.menu_schedules (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL,
    menu_id      UUID NOT NULL,
    location_id  UUID,
    name         TEXT,
    days_of_week BOOLEAN[],
    CONSTRAINT chk_days_of_week CHECK (
        days_of_week IS NULL OR array_length(days_of_week, 1) = 7
    ),
    time_from    TIME,
    time_until   TIME,
    date_from    DATE,
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
-- [V12-02] Removed inline UNIQUE (tenant_id, phone) — replaced below with partial
--          unique index to exclude NULLs and soft-deleted rows consistently.
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
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX idx_customers_tenant ON customer.customers(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_customers_phone  ON customer.customers(tenant_id, phone)
    WHERE phone IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_customers_email  ON customer.customers(tenant_id, email)
    WHERE email IS NOT NULL AND deleted_at IS NULL;
-- [V12-02] Partial unique indexes matching the staff email pattern.
--          NULL phone rows are excluded — multiple customers may have NULL phone per tenant.
--          Soft-deleted rows are excluded — allows re-use of phone/email after deletion.
CREATE UNIQUE INDEX idx_customers_phone_unique
    ON customer.customers(tenant_id, phone)
    WHERE phone IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX idx_customers_email_unique
    ON customer.customers(tenant_id, email)
    WHERE email IS NOT NULL AND deleted_at IS NULL;


-- Saved delivery addresses per customer.
CREATE TABLE customer.addresses (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL,
    customer_id   UUID NOT NULL,
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


-- Points earn / redeem / expire ledger. Append-only.
-- order_id FK wired after orders schema.
-- [V12-03] Added sign CHECK per transaction type.
--          earn/bonus/refund must be positive (points entering the wallet).
--          redeem/expire must be negative (points leaving the wallet).
--          adjust allows either sign (manual correction by staff).
CREATE TABLE customer.loyalty_transactions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL,
    loyalty_id  UUID NOT NULL,
    order_id    UUID,           -- NULL for manual adjustments; FK wired below
    txn_type    loyalty_transaction_type NOT NULL,
    points      INTEGER NOT NULL,
    -- [V12-03]
    CONSTRAINT chk_loyalty_points_sign CHECK (
        (txn_type IN ('earn', 'bonus', 'refund') AND points > 0) OR
        (txn_type IN ('redeem', 'expire')        AND points < 0) OR
        (txn_type = 'adjust')
    ),
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)  REFERENCES tenant.restaurants(id)       ON DELETE CASCADE,
    FOREIGN KEY (loyalty_id) REFERENCES customer.loyalty_accounts(id)
);

CREATE INDEX idx_loyalty_txn_account ON customer.loyalty_transactions(loyalty_id);
CREATE INDEX idx_loyalty_txn_order   ON customer.loyalty_transactions(order_id)
    WHERE order_id IS NOT NULL;


-- Generalised post-interaction feedback. Polymorphic via entity_type + entity_id.
-- notification_id FK wired after platform schema.
CREATE TABLE customer.feedback (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    customer_id     UUID,
    entity_type     feedback_entity_type NOT NULL,
    entity_id       UUID NOT NULL,
    rating          SMALLINT CHECK (rating    BETWEEN 1 AND 5),
    nps_score       SMALLINT CHECK (nps_score BETWEEN 0 AND 10),
    comment         TEXT,
    tags            TEXT[],
    channel         TEXT,
    notification_id UUID,      -- FK wired after platform.notifications
    solicited_at    TIMESTAMPTZ,
    responded_at    TIMESTAMPTZ,
    is_public       BOOLEAN NOT NULL DEFAULT FALSE,
    metadata        JSONB NOT NULL DEFAULT '{}',
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)   REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES customer.customers(id)
);

CREATE INDEX idx_feedback_tenant    ON customer.feedback(tenant_id, created_at DESC);
CREATE INDEX idx_feedback_customer  ON customer.feedback(customer_id);
CREATE INDEX idx_feedback_entity    ON customer.feedback(entity_type, entity_id);
CREATE INDEX idx_feedback_solicited ON customer.feedback(tenant_id)
    WHERE solicited_at IS NOT NULL AND responded_at IS NULL;


-- Structured CRM timeline per customer. Append-only.
-- Powers CRM views, cohort analysis, churn detection, re-engagement.
CREATE TABLE customer.interaction_log (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL,
    customer_id      UUID NOT NULL,
    interaction_type interaction_type NOT NULL,
    entity_type      TEXT,
    entity_id        UUID,
    value            NUMERIC(12,2),
    points_delta     INTEGER,
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


-- Customer identity graph: email, phone, google_id, etc.
-- [V11-07] Added updated_at for audit trail; added index on identity_value for lookups.
CREATE TABLE IF NOT EXISTS customer.identities (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL,
    customer_id    UUID NOT NULL,
    identity_type  TEXT NOT NULL,
    identity_value TEXT NOT NULL,
    verified       BOOLEAN NOT NULL DEFAULT FALSE,
    metadata       JSONB NOT NULL DEFAULT '{}',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),   -- [V11-07]
    UNIQUE (tenant_id, identity_type, identity_value),
    FOREIGN KEY (tenant_id)   REFERENCES tenant.restaurants(id),
    FOREIGN KEY (customer_id) REFERENCES customer.customers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_customer_identities_customer
    ON customer.identities(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_identities_value
    ON customer.identities(identity_type, identity_value);    -- [V11-07]


-- ============================================================
-- ORDERS SCHEMA
-- ============================================================

-- Master order record. Partition-ready by created_at.
-- session_id FK wired after dining schema.
-- [FIX-26] Terminal orders must have subtotal_amount and total_amount set.
CREATE TABLE orders.orders (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID NOT NULL,
    location_id          UUID,
    customer_id          UUID,
    session_id           UUID,          -- FK wired after dining.sessions
    delivery_address_id  UUID,
    channel              order_channel    NOT NULL DEFAULT 'web',
    fulfillment_type     fulfillment_type NOT NULL DEFAULT 'delivery',
    status               order_status     NOT NULL DEFAULT 'pending',
    scheduled_at         TIMESTAMPTZ,
    subtotal_amount      NUMERIC(10,2),
    tax_amount           NUMERIC(10,2)   NOT NULL DEFAULT 0,
    discount_amount      NUMERIC(10,2)   NOT NULL DEFAULT 0,
    tip_amount           NUMERIC(10,2)   NOT NULL DEFAULT 0,
    packaging_charge     NUMERIC(10,2)   NOT NULL DEFAULT 0,
    delivery_charge      NUMERIC(10,2)   NOT NULL DEFAULT 0,
    total_amount         NUMERIC(10,2),
    -- [FIX-26]
    CONSTRAINT chk_order_amounts_set CHECK (
        status IN ('pending','cancelled')
        OR (subtotal_amount IS NOT NULL AND total_amount IS NOT NULL)
    ),
    CONSTRAINT chk_order_total_positive CHECK (
        total_amount IS NULL OR total_amount >= 0
    ),
    special_instructions TEXT,
    token_number         TEXT,
    source_ref           TEXT,
    metadata             JSONB NOT NULL DEFAULT '{}',
    deleted_at           TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)           REFERENCES tenant.restaurants(id),
    FOREIGN KEY (location_id)         REFERENCES tenant.locations(id),
    FOREIGN KEY (customer_id)         REFERENCES customer.customers(id),
    FOREIGN KEY (delivery_address_id) REFERENCES customer.addresses(id)
    -- session_id FK added after dining schema
);

CREATE INDEX idx_orders_tenant   ON orders.orders(tenant_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_orders_customer ON orders.orders(customer_id)                WHERE deleted_at IS NULL;
CREATE INDEX idx_orders_status   ON orders.orders(tenant_id, status)          WHERE deleted_at IS NULL;
CREATE INDEX idx_orders_location ON orders.orders(location_id, created_at DESC);


-- Line items with full price snapshot (immutable audit trail).
-- [FIX-25] total_price must exactly equal base_price + addons_total.
CREATE TABLE orders.order_items (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL,
    order_id     UUID NOT NULL,
    menu_item_id UUID,
    variant_id   UUID,
    combo_id     UUID,
    item_name    TEXT NOT NULL,
    variant_name TEXT,
    unit_price   NUMERIC(10,2) NOT NULL,
    tax_rate     NUMERIC(5,2)  NOT NULL DEFAULT 0,
    quantity     INTEGER NOT NULL CHECK (quantity > 0),
    base_price   NUMERIC(10,2) GENERATED ALWAYS AS (unit_price * quantity) STORED,
    addons_total NUMERIC(10,2) NOT NULL DEFAULT 0,
    total_price  NUMERIC(10,2) NOT NULL,
    -- [FIX-25]
    CONSTRAINT chk_order_item_total CHECK (
        total_price = (unit_price * quantity) + addons_total
    ),
    special_note TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)    REFERENCES tenant.restaurants(id),
    FOREIGN KEY (order_id)     REFERENCES orders.orders(id)      ON DELETE CASCADE,
    FOREIGN KEY (menu_item_id) REFERENCES menu.menu_items(id),
    FOREIGN KEY (variant_id)   REFERENCES menu.item_variants(id),
    FOREIGN KEY (combo_id)     REFERENCES menu.combos(id)
);

CREATE INDEX idx_order_items_order ON orders.order_items(order_id);


-- Customization selections per line item — prices snapshotted at order time.
CREATE TABLE orders.order_item_customizations (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL,
    order_item_id  UUID NOT NULL,
    group_id       UUID,           -- soft ref to customization_groups
    option_id      UUID,           -- soft ref
    option_name    TEXT NOT NULL,  -- snapshot
    price_modifier NUMERIC(10,2) NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)     REFERENCES tenant.restaurants(id),
    FOREIGN KEY (order_item_id) REFERENCES orders.order_items(id) ON DELETE CASCADE
);

CREATE INDEX idx_order_customizations_item ON orders.order_item_customizations(order_item_id);


-- Tax breakdown per order (CGST, SGST, VAT, Service Charge).
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
-- [FIX-39] amount_saved NOT NULL DEFAULT 0.
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
CREATE TABLE orders.coupons (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    code            TEXT NOT NULL,
    description     TEXT,
    discount_type   discount_type NOT NULL,
    discount_value  NUMERIC(10,2) NOT NULL,
    min_order_value NUMERIC(10,2) NOT NULL DEFAULT 0,
    max_discount    NUMERIC(10,2),
    usage_limit     INTEGER,
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
    raw_webhook     JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id),
    FOREIGN KEY (order_id)  REFERENCES orders.orders(id)
);

CREATE INDEX idx_delivery_jobs_order ON orders.delivery_jobs(order_id);


-- Order lifecycle event log. Append-only.
-- Unified from V9 order_events — uses audit_actor_type ENUM (consistent with audit_log).
CREATE TABLE IF NOT EXISTS orders.order_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL,
    order_id    UUID NOT NULL,
    event_type  TEXT NOT NULL,
    status_from order_status,
    status_to   order_status,
    actor_type  audit_actor_type,
    actor_id    UUID,
    metadata    JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id),
    FOREIGN KEY (order_id)  REFERENCES orders.orders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_order_events_order  ON orders.order_events(order_id);
CREATE INDEX IF NOT EXISTS idx_order_events_tenant ON orders.order_events(tenant_id, created_at DESC);


-- Wire order_id FK on loyalty_transactions now that orders exists.
ALTER TABLE customer.loyalty_transactions
    ADD CONSTRAINT fk_loyalty_txn_order
        FOREIGN KEY (order_id) REFERENCES orders.orders(id);


-- ============================================================
-- PAYMENTS SCHEMA
-- ============================================================

-- [FIX-30] Authorized and captured payments must carry a positive amount.
CREATE TABLE payments.payments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    order_id        UUID,
    amount          NUMERIC(10,2),
    tip_amount      NUMERIC(10,2) NOT NULL DEFAULT 0,
    tax_amount      NUMERIC(10,2) NOT NULL DEFAULT 0,
    method          TEXT,
    gateway         TEXT,
    transaction_ref TEXT,
    gateway_ref     TEXT,
    CONSTRAINT uq_payments_gateway_ref UNIQUE (gateway_ref),
    status          payment_status NOT NULL DEFAULT 'pending',
    -- [FIX-30]
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
CREATE INDEX idx_payments_gateway ON payments.payments(gateway_ref)
    WHERE gateway_ref IS NOT NULL;


-- Payment provider event log. Append-only.
CREATE TABLE IF NOT EXISTS payments.payment_events (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL,
    payment_id        UUID NOT NULL,
    event_type        TEXT NOT NULL,
    provider          TEXT,
    provider_event_id TEXT,
    payload           JSONB NOT NULL DEFAULT '{}',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)  REFERENCES tenant.restaurants(id),
    FOREIGN KEY (payment_id) REFERENCES payments.payments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_payment_events_payment ON payments.payment_events(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_events_tenant  ON payments.payment_events(tenant_id, created_at DESC);


-- ============================================================
-- DINING SCHEMA
-- ============================================================

-- QR-coded physical tables.
CREATE TABLE dining.tables (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL,
    location_id UUID NOT NULL,
    name        TEXT,
    capacity    INTEGER,
    floor       TEXT,
    position    TEXT,
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
-- [FIX-35] Partial UNIQUE index prevents two open sessions on same table.
CREATE TABLE dining.sessions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL,
    location_id    UUID,
    table_id       UUID NOT NULL,
    reservation_id UUID,        -- FK wired after dining.reservations
    covers         SMALLINT,
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
);

CREATE INDEX idx_sessions_tenant ON dining.sessions(tenant_id, opened_at DESC);
CREATE INDEX idx_sessions_table  ON dining.sessions(table_id);
CREATE INDEX idx_sessions_open   ON dining.sessions(tenant_id)
    WHERE closed_at IS NULL AND deleted_at IS NULL;
-- [FIX-35]
CREATE UNIQUE INDEX idx_sessions_table_open
    ON dining.sessions(table_id)
    WHERE closed_at IS NULL AND deleted_at IS NULL;


-- Pre-booked covers with deposit tracking.
-- [FIX-37] reservation_time required once status leaves 'pending'.
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
    source              TEXT,
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


-- Wire reservation_id FK on dining.sessions.
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
    quoted_wait SMALLINT,
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
CREATE TABLE dining.reviews (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    order_id        UUID,
    session_id      UUID,
    customer_id     UUID,
    rating          SMALLINT CHECK (rating          BETWEEN 1 AND 5),
    food_rating     SMALLINT CHECK (food_rating     BETWEEN 1 AND 5),
    service_rating  SMALLINT CHECK (service_rating  BETWEEN 1 AND 5),
    ambience_rating SMALLINT CHECK (ambience_rating BETWEEN 1 AND 5),
    delivery_rating SMALLINT CHECK (delivery_rating BETWEEN 1 AND 5),
    comment         TEXT,
    source          TEXT NOT NULL DEFAULT 'platform',
    is_published    BOOLEAN NOT NULL DEFAULT FALSE,
    reply           TEXT,
    replied_at      TIMESTAMPTZ,
    replied_by      UUID,
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
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
-- [FIX-32] event_id set → status must be 'converted'.
CREATE TABLE catering.leads (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL,
    contact_name        TEXT NOT NULL,
    contact_phone       TEXT NOT NULL,
    contact_email       TEXT,
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
    event_id            UUID,  -- FK wired after catering.events
    -- [FIX-32]
    CONSTRAINT chk_lead_conversion CHECK (
        event_id IS NULL OR status = 'converted'
    ),
    source              TEXT NOT NULL DEFAULT 'web',
    utm_source          TEXT,
    utm_medium          TEXT,
    deleted_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)         REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id)       REFERENCES customer.customers(id),
    FOREIGN KEY (assigned_staff_id) REFERENCES tenant.staff(id)
);

CREATE INDEX idx_leads_tenant   ON catering.leads(tenant_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_leads_status   ON catering.leads(tenant_id, status)          WHERE deleted_at IS NULL;
CREATE INDEX idx_leads_customer ON catering.leads(customer_id);
CREATE INDEX idx_leads_followup ON catering.leads(tenant_id, follow_up_at)
    WHERE follow_up_at IS NOT NULL AND status NOT IN ('converted','lost');


-- Staff follow-up activity log per lead.
-- [FIX-33] At least one of staff_id or author must be set.
-- [V11-03] author column DROPPED (deprecated since V8, migration completed in V11).
--          All rows must have staff_id set before this schema is applied.
--          V8/V9 → V11 migration: UPDATE catering.lead_notes SET staff_id = ...
--          for any NULL staff_id rows, then DROP COLUMN author.
CREATE TABLE catering.lead_notes (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL,
    lead_id      UUID NOT NULL,
    staff_id     UUID NOT NULL,  -- [V11-03] now NOT NULL; author column removed
    note         TEXT NOT NULL,
    follow_up_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (lead_id)   REFERENCES catering.leads(id)     ON DELETE CASCADE,
    FOREIGN KEY (staff_id)  REFERENCES tenant.staff(id)
);

CREATE INDEX idx_lead_notes_lead ON catering.lead_notes(lead_id);


-- Stage 2 — confirmed execution record.
CREATE TABLE catering.events (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID NOT NULL,
    location_id        UUID,
    customer_id        UUID NOT NULL,
    lead_id            UUID,
    event_name         TEXT,
    event_type         TEXT,
    guest_count        INTEGER,
    event_date_from    DATE NOT NULL,
    event_date_to      DATE NOT NULL,
    CONSTRAINT chk_event_date_range CHECK (event_date_to >= event_date_from),
    venue_address      TEXT,
    setup_time         TIMESTAMPTZ,
    start_time         TIMESTAMPTZ,
    end_time           TIMESTAMPTZ,
    status             catering_event_status NOT NULL DEFAULT 'confirmed',
    advance_amount     NUMERIC(10,2) NOT NULL DEFAULT 0,
    advance_paid       BOOLEAN NOT NULL DEFAULT FALSE,
    advance_payment_id UUID,
    notes              TEXT,
    assigned_staff_id  UUID,
    metadata           JSONB NOT NULL DEFAULT '{}',
    deleted_at         TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
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
CREATE TABLE catering.event_days (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL,
    event_id          UUID NOT NULL,
    event_date        DATE NOT NULL,
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


-- Wire deferred event_id FK on catering.leads.
ALTER TABLE catering.leads
    ADD CONSTRAINT fk_lead_event
        FOREIGN KEY (event_id) REFERENCES catering.events(id);


-- Versioned financial proposals per lead.
-- [FIX-28] Sent/accepted quotes must have total_amount set.
CREATE TABLE catering.quotes (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL,
    lead_id        UUID NOT NULL,
    event_id       UUID,
    event_day_id   UUID,
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

-- Pre-aggregated daily KPIs per tenant / location. Populated by background jobs.
-- [FIX-36] computed_at must be set explicitly in ON CONFLICT DO UPDATE clauses.
-- Note: daily_metrics intentionally has NO updated_at — workers must set
--       computed_at = NOW() explicitly. See trigger loop exclusion comment below.
CREATE TABLE insights.daily_metrics (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL,
    location_id UUID,
    metric_date DATE NOT NULL,
    metric_type insight_metric_type NOT NULL,
    value       NUMERIC(14,4) NOT NULL,
    breakdown   JSONB,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
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
-- [V12-04] Added created_at for audit trail consistency.
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
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),   -- [V12-04]
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id)
);


-- Raw analytics event stream. Append-only.
-- V8 origin: powers daily_metrics aggregation jobs.
-- Distinct from platform.events (the integration/webhook event bus).
-- BRIN index candidate at >1M rows:
--   DROP INDEX idx_insights_events_tenant;
--   CREATE INDEX idx_insights_events_tenant_brin
--       ON insights.events USING BRIN (tenant_id, created_at);
CREATE TABLE insights.events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id   UUID,
    event_type  TEXT NOT NULL,
    payload     JSONB NOT NULL DEFAULT '{}',
    actor_id    UUID,
    session_ref TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id)
);

CREATE INDEX idx_insights_events_tenant ON insights.events(tenant_id, created_at DESC);
CREATE INDEX idx_insights_events_entity ON insights.events(entity_type, entity_id);
CREATE INDEX idx_insights_events_type   ON insights.events(tenant_id, event_type);


-- Menu view tracking for AI recommendation and conversion analytics.
CREATE TABLE IF NOT EXISTS insights.menu_views (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL,
    menu_item_id UUID,
    customer_id  UUID,
    source       TEXT,
    session_id   UUID,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)    REFERENCES tenant.restaurants(id),
    FOREIGN KEY (menu_item_id) REFERENCES menu.menu_items(id),
    FOREIGN KEY (customer_id)  REFERENCES customer.customers(id)
);

CREATE INDEX IF NOT EXISTS idx_menu_views_tenant  ON insights.menu_views(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_menu_views_session ON insights.menu_views(session_id);
CREATE INDEX IF NOT EXISTS idx_menu_views_item    ON insights.menu_views(menu_item_id);


-- Customer segment scores (AI-computed). One row per (tenant, customer, segment).
-- [V11-09] Added updated_at for trigger coverage.
CREATE TABLE IF NOT EXISTS insights.customer_segments (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL,
    customer_id  UUID NOT NULL,
    segment_key  TEXT NOT NULL,
    score        NUMERIC(10,4),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),   -- [V11-09]
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, customer_id, segment_key),
    FOREIGN KEY (tenant_id)   REFERENCES tenant.restaurants(id),
    FOREIGN KEY (customer_id) REFERENCES customer.customers(id)
);

CREATE INDEX IF NOT EXISTS idx_customer_segments_tenant   ON insights.customer_segments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_customer_segments_customer ON insights.customer_segments(customer_id);


-- Behavioral analytics stream. Append-only. Higher-fidelity than insights.events.
-- Consumer: ML models, real-time segmentation pipelines.
CREATE TABLE IF NOT EXISTS insights.customer_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL,
    customer_id UUID,
    event_type  TEXT NOT NULL,
    event_value NUMERIC,
    metadata    JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)   REFERENCES tenant.restaurants(id),
    FOREIGN KEY (customer_id) REFERENCES customer.customers(id)
);

CREATE INDEX IF NOT EXISTS idx_customer_events_tenant   ON insights.customer_events(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_events_customer ON insights.customer_events(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_events_type     ON insights.customer_events(tenant_id, event_type);


-- ============================================================
-- PLATFORM SCHEMA
-- ============================================================

-- Transactional outbox for at-least-once event delivery.
-- [FIX-40] retry_count capped at 25.
CREATE TABLE platform.event_outbox (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL,
    event_type     TEXT NOT NULL,
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

CREATE INDEX idx_outbox_pending ON platform.event_outbox(created_at, retry_count)
    WHERE status IN ('pending','failed');
CREATE INDEX idx_outbox_tenant  ON platform.event_outbox(tenant_id, created_at DESC);


-- Platform event bus. Append-only.
-- Distinct from insights.events (analytics stream) and platform.event_outbox
-- (transactional delivery). This table powers integrations and real-time webhooks.
-- [V11-05] event_version, processed, processed_at added natively (from V10).
CREATE TABLE IF NOT EXISTS platform.events (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL,
    event_type    TEXT NOT NULL,
    event_version INT NOT NULL DEFAULT 1,       -- [V11-05]
    entity_type   TEXT,
    entity_id     UUID,
    payload       JSONB NOT NULL DEFAULT '{}',
    processed     BOOLEAN NOT NULL DEFAULT FALSE,   -- [V11-05]
    processed_at  TIMESTAMPTZ,                       -- [V11-05]
    occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id)
);

CREATE INDEX IF NOT EXISTS idx_platform_events_tenant  ON platform.events(tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_events_type    ON platform.events(event_type);
CREATE INDEX IF NOT EXISTS idx_platform_events_entity  ON platform.events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_platform_events_pending ON platform.events(tenant_id)
    WHERE processed = FALSE;


-- Registered webhook endpoints per tenant.
CREATE TABLE platform.webhooks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL,
    url         TEXT NOT NULL,
    secret      TEXT,
    event_types TEXT[],
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
CREATE TABLE platform.notification_templates (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL,
    name                TEXT NOT NULL,
    trigger_event       TEXT NOT NULL,
    channel             notification_channel NOT NULL,
    language            TEXT NOT NULL DEFAULT 'en',
    subject             TEXT,
    body_template       TEXT NOT NULL,
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
    entity_type          TEXT,
    entity_id            UUID,
    status               notification_status NOT NULL DEFAULT 'queued',
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


-- Inbound engagement signals from outbound notifications. Append-only.
-- [FIX-31] Partial unique index WHERE provider_event_id IS NOT NULL for dedup.
CREATE TABLE platform.notification_engagement (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL,
    notification_id   UUID NOT NULL,
    customer_id       UUID,
    engagement_type   notification_engagement_type NOT NULL,
    link_url          TEXT,
    reply_body        TEXT,
    provider          TEXT,
    provider_event_id TEXT,
    raw_payload       JSONB NOT NULL DEFAULT '{}',
    occurred_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)       REFERENCES tenant.restaurants(id),
    FOREIGN KEY (notification_id) REFERENCES platform.notifications(id),
    FOREIGN KEY (customer_id)     REFERENCES customer.customers(id)
);

-- [FIX-31]
CREATE UNIQUE INDEX idx_engagement_dedup
    ON platform.notification_engagement(provider, provider_event_id)
    WHERE provider_event_id IS NOT NULL;
CREATE INDEX idx_notif_engagement_notification ON platform.notification_engagement(notification_id);
CREATE INDEX idx_notif_engagement_customer     ON platform.notification_engagement(customer_id);
CREATE INDEX idx_notif_engagement_type         ON platform.notification_engagement(tenant_id, engagement_type);
CREATE INDEX idx_notif_engagement_occurred     ON platform.notification_engagement(tenant_id, occurred_at DESC);


-- Platform-level audit trail. Append-only.
-- Partition by created_at when row count exceeds ~5M.
-- BRIN candidate: CREATE INDEX ... USING BRIN (created_at);
-- [FIX-42] actor_type uses audit_actor_type ENUM.
CREATE TABLE platform.audit_log (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID,           -- NULL for platform-level actions
    actor_id     UUID,
    actor_type   audit_actor_type NOT NULL DEFAULT 'staff',  -- [FIX-42]
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


-- Platform usage metering. Raw metered events per tenant.
-- Distinct from platform.usage_ledger (rolled-up billing periods).
CREATE TABLE IF NOT EXISTS platform.usage_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL,
    metric_key  TEXT NOT NULL,
    quantity    INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    entity_type TEXT,
    entity_id   UUID,
    metadata    JSONB NOT NULL DEFAULT '{}',
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id)
);

CREATE INDEX IF NOT EXISTS idx_usage_events_tenant ON platform.usage_events(tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_events_metric ON platform.usage_events(metric_key);


-- Billing usage ledger. Rolled-up billing periods per tenant, used for invoicing.
-- [V11-04] Normalised from V10 — quantity is BIGINT (aggregated), billed NOT NULL.
CREATE TABLE IF NOT EXISTS platform.usage_ledger (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL,
    metric_key   TEXT NOT NULL,
    period_start DATE NOT NULL,
    period_end   DATE NOT NULL,
    quantity     BIGINT NOT NULL DEFAULT 0,
    billed       BOOLEAN NOT NULL DEFAULT FALSE,
    metadata     JSONB NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_usage_period CHECK (period_end >= period_start),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id)
);

CREATE INDEX IF NOT EXISTS idx_usage_ledger_tenant_period
    ON platform.usage_ledger(tenant_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_usage_ledger_unbilled
    ON platform.usage_ledger(tenant_id)
    WHERE billed = FALSE;


-- Platform API keys per tenant.
-- [V11-08] UNIQUE constraint on key_hash prevents accidental duplicate registration.
CREATE TABLE IF NOT EXISTS platform.api_keys (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL,
    key_hash    TEXT NOT NULL,
    name        TEXT,
    permissions TEXT[],
    revoked_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_api_key_hash UNIQUE (key_hash),   -- [V11-08]
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON platform.api_keys(tenant_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON platform.api_keys(tenant_id)
    WHERE revoked_at IS NULL;


-- ============================================================
-- WIRE REMAINING DEFERRED FKs
-- ============================================================

-- customer.feedback → platform.notifications
ALTER TABLE customer.feedback
    ADD CONSTRAINT fk_feedback_notification
        FOREIGN KEY (notification_id) REFERENCES platform.notifications(id);


-- ============================================================
-- INVENTORY SCHEMA
-- ============================================================
-- [V11-01] current_stock column removed from inventory.items.
-- Stock is exclusively derived from inventory.movements via the stock_levels view.
-- This eliminates the write-conflict between direct field mutation and the
-- movements ledger, which was introduced when V9 added both patterns.

-- Inventory item catalogue per tenant.
CREATE TABLE IF NOT EXISTS inventory.items (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL,
    name                TEXT NOT NULL,
    unit                TEXT,           -- 'kg','litre','piece','portion'
    low_stock_threshold NUMERIC(12,3),  -- alert threshold in the same unit
    metadata            JSONB NOT NULL DEFAULT '{}',
    deleted_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_inventory_items_tenant ON inventory.items(tenant_id)
    WHERE deleted_at IS NULL;


-- Inventory movements ledger. Append-only.
-- movement_type: 'purchase','consumption','waste','adjustment','opening'
-- Positive quantity = stock in, negative = stock out.
-- reference_type / reference_id link to orders, catering events, etc.
CREATE TABLE IF NOT EXISTS inventory.movements (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL,
    inventory_item_id UUID NOT NULL,
    movement_type     TEXT NOT NULL,
    quantity          NUMERIC(12,3) NOT NULL,   -- positive = in, negative = out
    reference_type    TEXT,
    reference_id      UUID,
    notes             TEXT,
    metadata          JSONB NOT NULL DEFAULT '{}',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)         REFERENCES tenant.restaurants(id),
    FOREIGN KEY (inventory_item_id) REFERENCES inventory.items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_item    ON inventory.movements(inventory_item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_tenant  ON inventory.movements(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_ref     ON inventory.movements(reference_type, reference_id)
    WHERE reference_id IS NOT NULL;


-- Derived stock level view. The authoritative current stock quantity.
-- [V11-01] SUM(quantity) from movements is the ONLY stock representation.
CREATE OR REPLACE VIEW inventory.stock_levels AS
SELECT
    i.id                                          AS inventory_item_id,
    i.tenant_id,
    i.name,
    i.unit,
    i.low_stock_threshold,
    COALESCE(SUM(m.quantity), 0)                  AS current_stock,
    CASE
        WHEN i.low_stock_threshold IS NOT NULL
         AND COALESCE(SUM(m.quantity), 0) <= i.low_stock_threshold
        THEN TRUE
        ELSE FALSE
    END                                           AS is_low_stock,
    MAX(m.created_at)                             AS last_movement_at
FROM inventory.items i
LEFT JOIN inventory.movements m ON m.inventory_item_id = i.id
WHERE i.deleted_at IS NULL
GROUP BY i.id, i.tenant_id, i.name, i.unit, i.low_stock_threshold;


-- ============================================================
-- UPDATED_AT TRIGGER FUNCTION
-- Automatically sets updated_at = NOW() on every UPDATE.
-- Applied to all tables with an updated_at column across all schemas.
-- Note: insights.daily_metrics has no updated_at — workers must set
-- computed_at = NOW() explicitly in ON CONFLICT DO UPDATE (FIX-36).
--
-- [V12-01] Changed CREATE TRIGGER → CREATE OR REPLACE TRIGGER.
--          Prevents "trigger already exists" error on schema re-run.
--          Safe to run idempotently on PG 14+ (including target PG 17).
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
              'payments','dining','catering','insights','platform',
              'inventory'
          )
        GROUP BY table_schema, table_name
    LOOP
        EXECUTE format(
            'CREATE OR REPLACE TRIGGER trg_updated_at
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
-- SCHEMA SUMMARY — V12
-- ============================================================
-- Schema      Table                          Notes
-- ──────────  ─────────────────────────────  ──────────────────────────────────
-- tenant      restaurants                    Root tenant record
-- tenant      locations                      Physical/virtual locations
-- tenant      domains                        Custom domains
-- tenant      operating_hours                Weekly schedule per location
-- tenant      virtual_brands                 Cloud kitchen multi-brand
-- tenant      integrations                   Razorpay/Twilio/etc config
-- tenant      roles                          RBAC named roles
-- tenant      permissions                    Dot-notation permission keys
-- tenant      staff                          Human login accounts
-- tenant      staff_roles                    M:N staff ↔ roles
-- tenant      staff_locations                Location scope per staff
-- tenant      staff_sessions                 Token registry / revocation
-- tenant      tax_rules                      GST/VAT definitions
-- tenant      tax_rule_items                 Item/category → tax rule mapping
-- tenant      subscriptions                  SaaS billing subscription
-- tenant      feature_flags                  Per-tenant feature overrides
-- brand       themes                         Visual identity (1:1)
-- brand       assets                         Logos, banners, OG images
-- brand       seo                            Meta/OG tags (1:1)
-- brand       contact_links                  Social/map links
-- brand       announcements                  Time-bounded storefront banners
-- menu        menus                          Menu containers
-- menu        categories                     Menu sections
-- menu        menu_items                     Core dish records
-- menu        item_variants                  Size/portion variants
-- menu        customization_groups           Add-on groups per item
-- menu        customization_options          Choices within a group
-- menu        item_availability              Day/time overrides per item
-- menu        combos                         Meal deal headers
-- menu        combo_slots                    Selection slots in combos
-- menu        combo_slot_options             Items eligible per slot
-- menu        menu_schedules                 Day+time auto-activation rules
-- customer    customers                      CRM records
-- customer    addresses                      Saved delivery addresses
-- customer    loyalty_accounts               Points wallet per customer
-- customer    loyalty_transactions           Earn/redeem/expire ledger [V12-03]
-- customer    feedback                       Post-interaction signal
-- customer    interaction_log                CRM timeline per customer
-- customer    identities                     Identity graph (email/phone/sso)
-- orders      orders                         Master order record
-- orders      order_items                    Line items with price snapshot
-- orders      order_item_customizations      Chosen add-ons (snapshotted)
-- orders      order_taxes                    CGST/SGST breakdown per order
-- orders      order_discounts                Coupon application per order
-- orders      coupons                        Coupon definitions
-- orders      delivery_jobs                  Last-mile tracking (1:1 order)
-- orders      order_events                   Order lifecycle event log
-- payments    payments                       Razorpay payment records
-- payments    payment_events                 Payment provider event log
-- dining      tables                         QR-coded physical tables
-- dining      sessions                       Live dine-in sessions
-- dining      reservations                   Pre-bookings with deposit
-- dining      waitlist                       Walk-in queue
-- dining      reviews                        Public reviews with staff reply
-- catering    enquiry_forms                  Public enquiry form config (1:1)
-- catering    leads                          Pipeline stage 1 (enquiry)
-- catering    lead_notes                     Staff follow-up activity log
-- catering    events                         Pipeline stage 2 (confirmed)
-- catering    event_days                     Per-day operational records
-- catering    quotes                         Versioned financial proposals
-- catering    quote_items                    Quote line items (GENERATED total)
-- catering    packages                       Reusable buffet templates
-- catering    package_items                  Items within a package
-- insights    daily_metrics                  Pre-aggregated KPIs
-- insights    item_performance               Per-item daily roll-up
-- insights    review_summary                 Cached rating aggregate [V12-04]
-- insights    events                         Raw analytics stream (V8)
-- insights    menu_views                     Menu item view tracking
-- insights    customer_segments              AI-computed segment scores
-- insights    customer_events                Behavioral analytics stream
-- platform    event_outbox                   Transactional event outbox
-- platform    events                         Integration/webhook event bus
-- platform    webhooks                       Registered webhook endpoints
-- platform    webhook_deliveries             Delivery attempt log
-- platform    notification_templates         Channel message templates
-- platform    notifications                  Outbound dispatch log
-- platform    notification_engagement        Inbound open/click/reply signal
-- platform    audit_log                      Admin action trail
-- platform    usage_events                   Raw metered usage events
-- platform    usage_ledger                   Rolled-up billing periods
-- platform    api_keys                       Tenant API key registry
-- inventory   items                          Ingredient/stock item catalogue
-- inventory   movements                      Movements ledger (append-only)
-- inventory   stock_levels                   VIEW — derived current stock
-- ============================================================
-- Total: 72 tables + 1 view across 11 schemas
-- V12-01: trigger loop idempotent via CREATE OR REPLACE TRIGGER
-- V12-02: customer.customers phone uniqueness via partial unique index
-- V12-03: loyalty_transactions.points sign CHECK per txn_type
-- V12-04: insights.review_summary gains created_at
-- ============================================================
