-- ============================================================
-- kravon_schema_v20.sql
-- KRAVON Platform — Authoritative Production Schema
-- Target: PostgreSQL 14+ (PostgreSQL 17 recommended)
--
-- This file is the SINGLE SOURCE OF TRUTH for all future deployments.
-- It supersedes kravon_schema_v12.sql and all incremental migrations v9–v19.
--
-- Changes vs v12 canonical:
--   [V20-01] tenant.staff gains password_hash TEXT (was added by v14, now canonical)
--   [V20-02] brand.announcements gains image_url TEXT (was added by v16, now canonical)
--   [V20-03] tenant.restaurants.plan is VARCHAR(20) with CHECK, not restaurant_plan ENUM
--            restaurant_plan ENUM is NOT created — it no longer exists in production
--   [V20-04] idx_restaurants_plan added (v15)
--   [V20-05] idx_orders_razorpay_order_id + idx_orders_razorpay_payment_id added (v17)
--   [V20-06] customer.consent_history added (v18)
--   [V20-07] platform.export_jobs added (v18)
--   [V20-08] platform.customer_data_requests added (v18)
--   [V20-09] platform.benchmarks added (v18)
--   [V20-10] notifications schema + notifications.notifications added (v19)
--   [V20-11] tenant.notification_preferences added (v19)
--   [V20-12] platform.schema_migrations added (NEW — migration state tracking)
--
-- Creation order (dependency-safe):
--   Extensions → ENUMs → Schemas
--   → platform.schema_migrations (standalone, no FKs)
--   → tenant → brand → menu
--   → [wire tax_rule_items deferred FKs to menu]
--   → customer → orders
--   → [wire loyalty_transactions → orders]
--   → payments → dining
--   → [wire orders → sessions, sessions → reservations]
--   → catering
--   → [wire leads → events]
--   → insights → platform (remaining tables)
--   → [wire feedback → notifications]
--   → inventory → notifications schema
--   → updated_at trigger
-- ============================================================


-- ============================================================
-- EXTENSIONS
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";


-- ============================================================
-- ENUM TYPES
-- NOTE: restaurant_plan ENUM is intentionally NOT defined here.
--       tenant.restaurants.plan is VARCHAR(20) with a CHECK constraint (v15).
-- ============================================================

CREATE TYPE asset_type AS ENUM (
    'logo', 'banner', 'favicon', 'og_image', 'gallery', 'other'
);

CREATE TYPE menu_type AS ENUM (
    'main', 'breakfast', 'lunch', 'dinner', 'weekend', 'seasonal',
    'catering', 'delivery', 'dine_in', 'takeaway', 'other'
);

CREATE TYPE fssai_food_type AS ENUM (
    'veg', 'non_veg', 'egg', 'vegan'
);

CREATE TYPE customization_group_type AS ENUM (
    'radio', 'checkbox', 'quantity'
);

CREATE TYPE loyalty_tier AS ENUM (
    'bronze', 'silver', 'gold', 'platinum'
);

CREATE TYPE loyalty_transaction_type AS ENUM (
    'earn', 'redeem', 'expire', 'adjust', 'bonus', 'refund'
);

CREATE TYPE order_channel AS ENUM (
    'web', 'qr', 'whatsapp', 'phone', 'pos', 'aggregator', 'catering'
);

CREATE TYPE fulfillment_type AS ENUM (
    'delivery', 'pickup', 'dine_in', 'catering'
);

CREATE TYPE order_status AS ENUM (
    'pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery',
    'delivered', 'completed', 'cancelled', 'refunded'
);

CREATE TYPE discount_type AS ENUM (
    'flat', 'percentage', 'bogo', 'free_item'
);

CREATE TYPE delivery_provider AS ENUM (
    'self', 'dunzo', 'porter', 'shiprocket', 'other'
);

CREATE TYPE delivery_job_status AS ENUM (
    'pending', 'assigned', 'picked_up', 'delivered', 'failed', 'cancelled'
);

CREATE TYPE payment_status AS ENUM (
    'pending', 'authorized', 'captured', 'failed', 'refunded',
    'partial_refund', 'disputed'
);

CREATE TYPE table_status AS ENUM (
    'available', 'occupied', 'reserved', 'cleaning', 'inactive'
);

CREATE TYPE reservation_status AS ENUM (
    'pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show'
);

CREATE TYPE catering_lead_status AS ENUM (
    'new', 'contacted', 'qualified', 'proposal_sent', 'negotiating',
    'converted', 'lost', 'on_hold'
);

CREATE TYPE catering_event_status AS ENUM (
    'confirmed', 'in_progress', 'completed', 'cancelled', 'postponed'
);

CREATE TYPE quote_status AS ENUM (
    'draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired', 'revised'
);

CREATE TYPE notification_channel AS ENUM (
    'whatsapp', 'sms', 'email', 'push'
);

CREATE TYPE notification_status AS ENUM (
    'queued', 'sent', 'delivered', 'failed', 'bounced', 'opted_out'
);

CREATE TYPE notification_engagement_type AS ENUM (
    'opened', 'clicked', 'replied', 'opted_out', 'bounced', 'complained'
);

CREATE TYPE outbox_status AS ENUM (
    'pending', 'processing', 'delivered', 'failed', 'dead'
);

CREATE TYPE insight_metric_type AS ENUM (
    'revenue', 'order_count', 'avg_order_value', 'new_customers',
    'returning_customers', 'cancellation_rate', 'avg_prep_time',
    'loyalty_redemption_rate', 'catering_pipeline_value', 'review_avg'
);

CREATE TYPE feedback_entity_type AS ENUM (
    'order', 'dining_session', 'reservation', 'catering_event', 'delivery', 'general'
);

CREATE TYPE interaction_type AS ENUM (
    'order_placed', 'order_cancelled', 'payment_made', 'payment_failed',
    'review_submitted', 'feedback_submitted', 'reservation_made',
    'reservation_cancelled', 'reservation_completed', 'catering_lead_submitted',
    'catering_event_completed', 'loyalty_earned', 'loyalty_redeemed',
    'loyalty_tier_upgrade', 'notification_sent', 'notification_opened',
    'notification_clicked', 'opted_out', 'qr_scan', 'menu_view', 'account_created'
);

CREATE TYPE waitlist_status AS ENUM (
    'waiting', 'notified', 'seated', 'cancelled', 'no_show', 'expired'
);

CREATE TYPE audit_actor_type AS ENUM (
    'staff', 'system', 'customer'
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
CREATE SCHEMA IF NOT EXISTS notifications;


-- ============================================================
-- PLATFORM.SCHEMA_MIGRATIONS  [V20-12]
-- Created first — no FK dependencies. Tracks applied migrations.
-- ============================================================

CREATE TABLE IF NOT EXISTS platform.schema_migrations (
    id         SERIAL      PRIMARY KEY,
    version    TEXT        NOT NULL UNIQUE,
    name       TEXT        NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schema_migrations_version
    ON platform.schema_migrations(version);


-- ============================================================
-- TENANT SCHEMA
-- ============================================================

-- Root tenant record. Every operational table references this via tenant_id.
-- [V20-03] plan is VARCHAR(20) with CHECK — restaurant_plan ENUM is gone.
CREATE TABLE tenant.restaurants (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    slug          TEXT        NOT NULL UNIQUE,
    name          TEXT        NOT NULL,
    plan          VARCHAR(20) NOT NULL DEFAULT 'starter'
                      CHECK (plan IN ('starter', 'growth', 'pro', 'enterprise')),
    status        TEXT        NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'inactive', 'suspended')),
    has_presence  BOOLEAN     NOT NULL DEFAULT FALSE,
    has_orders    BOOLEAN     NOT NULL DEFAULT FALSE,
    has_tables    BOOLEAN     NOT NULL DEFAULT FALSE,
    has_catering  BOOLEAN     NOT NULL DEFAULT FALSE,
    has_insights  BOOLEAN     NOT NULL DEFAULT FALSE,
    settings      JSONB       NOT NULL DEFAULT '{}',
    deleted_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by    UUID,
    updated_by    UUID
);

CREATE INDEX idx_restaurants_slug   ON tenant.restaurants(slug)   WHERE deleted_at IS NULL;
CREATE INDEX idx_restaurants_status ON tenant.restaurants(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_restaurants_plan   ON tenant.restaurants(plan);  -- [V20-04]


CREATE TABLE tenant.locations (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    name        TEXT,
    address     TEXT,
    city        TEXT,
    state       TEXT,
    country     TEXT        NOT NULL DEFAULT 'IN',
    pincode     TEXT,
    lat         NUMERIC(9,6),
    lng         NUMERIC(9,6),
    timezone    TEXT        NOT NULL DEFAULT 'Asia/Kolkata',
    phone       TEXT,
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    metadata    JSONB       NOT NULL DEFAULT '{}',
    deleted_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX idx_locations_tenant ON tenant.locations(tenant_id) WHERE deleted_at IS NULL;


CREATE TABLE tenant.domains (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    domain      TEXT        NOT NULL UNIQUE,
    is_primary  BOOLEAN     NOT NULL DEFAULT FALSE,
    verified_at TIMESTAMPTZ,
    deleted_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX idx_domains_tenant ON tenant.domains(tenant_id);
CREATE INDEX idx_domains_domain ON tenant.domains(domain);


-- day_of_week: 0=Sun … 6=Sat
CREATE TABLE tenant.operating_hours (
    id          UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID     NOT NULL,
    location_id UUID     NOT NULL,
    day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    opens_at    TIME     NOT NULL,
    closes_at   TIME     NOT NULL,
    is_closed   BOOLEAN  NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (location_id, day_of_week),
    FOREIGN KEY (tenant_id)   REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (location_id) REFERENCES tenant.locations(id)   ON DELETE CASCADE
);

CREATE INDEX idx_operating_hours_location ON tenant.operating_hours(location_id);


CREATE TABLE tenant.virtual_brands (
    id                  UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID    NOT NULL,
    kitchen_location_id UUID    NOT NULL,
    restaurant_id       UUID    NOT NULL,
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


CREATE TABLE tenant.integrations (
    id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID    NOT NULL,
    provider    TEXT    NOT NULL,
    config      JSONB   NOT NULL DEFAULT '{}',
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    deleted_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, provider),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX idx_integrations_tenant ON tenant.integrations(tenant_id);


CREATE TABLE tenant.roles (
    id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID    NOT NULL,
    name           TEXT    NOT NULL,
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


-- Granular permission keys per role. Dot-notation: module.resource.action.
-- Not yet wired to middleware — see V22 recommendation.
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


-- [V20-01] password_hash TEXT added — was missing from v12 canonical, added by v14.
CREATE TABLE tenant.staff (
    id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID    NOT NULL,
    name          TEXT    NOT NULL,
    email         TEXT,
    phone         TEXT,
    pin           TEXT,
    password_hash TEXT,                    -- [V20-01] email+password login (v14)
    auth_provider TEXT    NOT NULL DEFAULT 'email',
    auth_uid      TEXT,
    avatar_url    TEXT,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    metadata      JSONB   NOT NULL DEFAULT '{}',
    deleted_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by    UUID,
    updated_by    UUID,
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX idx_staff_tenant        ON tenant.staff(tenant_id);
CREATE INDEX idx_staff_tenant_active ON tenant.staff(tenant_id, is_active) WHERE deleted_at IS NULL;
CREATE INDEX idx_staff_email         ON tenant.staff(email) WHERE deleted_at IS NULL;
CREATE INDEX idx_staff_auth_uid ON tenant.staff(auth_uid) WHERE auth_uid IS NOT NULL;
CREATE UNIQUE INDEX idx_staff_email_unique
    ON tenant.staff(tenant_id, email)
    WHERE email IS NOT NULL AND deleted_at IS NULL;


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


CREATE TABLE tenant.staff_locations (
    id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID    NOT NULL,
    staff_id      UUID    NOT NULL,
    location_id   UUID    NOT NULL,
    all_locations BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (staff_id, location_id),
    FOREIGN KEY (tenant_id)   REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (staff_id)    REFERENCES tenant.staff(id)       ON DELETE CASCADE,
    FOREIGN KEY (location_id) REFERENCES tenant.locations(id)   ON DELETE CASCADE
);

CREATE INDEX idx_staff_locations_staff ON tenant.staff_locations(staff_id);


CREATE TABLE tenant.staff_sessions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL,
    staff_id      UUID NOT NULL,
    session_token TEXT NOT NULL UNIQUE,
    device_info   JSONB       NOT NULL DEFAULT '{}',
    expires_at    TIMESTAMPTZ NOT NULL,
    revoked_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (staff_id)  REFERENCES tenant.staff(id)       ON DELETE CASCADE
);

CREATE INDEX idx_staff_sessions_staff ON tenant.staff_sessions(staff_id);
CREATE INDEX idx_staff_sessions_token ON tenant.staff_sessions(session_token)
    WHERE revoked_at IS NULL;


CREATE TABLE tenant.tax_rules (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID         NOT NULL,
    name         TEXT         NOT NULL,
    description  TEXT,
    components   JSONB        NOT NULL DEFAULT '[]',
    total_rate   NUMERIC(5,2) NOT NULL DEFAULT 0,
    is_inclusive BOOLEAN      NOT NULL DEFAULT FALSE,
    is_default   BOOLEAN      NOT NULL DEFAULT FALSE,
    is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
    deleted_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    created_by   UUID,
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX idx_tax_rules_tenant  ON tenant.tax_rules(tenant_id);
CREATE INDEX idx_tax_rules_default ON tenant.tax_rules(tenant_id)
    WHERE is_default = TRUE AND deleted_at IS NULL;
CREATE UNIQUE INDEX idx_tax_rules_name_unique
    ON tenant.tax_rules(tenant_id, name)
    WHERE deleted_at IS NULL;


-- Deferred FKs to menu tables wired after menu schema.
-- Exactly ONE of menu_item_id, category_id, combo_id must be set.
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


CREATE TABLE IF NOT EXISTS tenant.subscriptions (
    id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                UUID        NOT NULL,
    plan                     VARCHAR(20) NOT NULL,
    billing_provider         TEXT,
    provider_subscription_id TEXT,
    status                   TEXT        NOT NULL
                                 CHECK (status IN ('trial','active','past_due','cancelled','paused')),
    trial_ends_at            TIMESTAMPTZ,
    current_period_start     TIMESTAMPTZ,
    current_period_end       TIMESTAMPTZ,
    cancel_at_period_end     BOOLEAN     NOT NULL DEFAULT FALSE,
    metadata                 JSONB       NOT NULL DEFAULT '{}',
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant
    ON tenant.subscriptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status
    ON tenant.subscriptions(tenant_id, status);


CREATE TABLE IF NOT EXISTS tenant.feature_flags (
    id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID    NOT NULL,
    feature_key TEXT    NOT NULL,
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    config      JSONB   NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, feature_key),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_feature_flags_tenant
    ON tenant.feature_flags(tenant_id);


-- [V20-11] Per-tenant on/off toggles for in-app notification types (v19).
CREATE TABLE IF NOT EXISTS tenant.notification_preferences (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL UNIQUE,
    preferences JSONB       NOT NULL DEFAULT '{}',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);


-- ============================================================
-- BRAND SCHEMA
-- ============================================================

CREATE TABLE brand.themes (
    id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID    NOT NULL UNIQUE,
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


CREATE TABLE brand.assets (
    id         UUID       PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID       NOT NULL,
    type       asset_type,
    url        TEXT       NOT NULL,
    alt_text   TEXT,
    metadata   JSONB      NOT NULL DEFAULT '{}',
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX idx_assets_tenant ON brand.assets(tenant_id) WHERE deleted_at IS NULL;


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


CREATE TABLE brand.contact_links (
    id            UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID     NOT NULL,
    platform      TEXT     NOT NULL,
    url           TEXT     NOT NULL,
    display_label TEXT,
    position      SMALLINT NOT NULL DEFAULT 0,
    deleted_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX idx_contact_links_tenant ON brand.contact_links(tenant_id) WHERE deleted_at IS NULL;


-- [V20-02] image_url TEXT added — was missing from v12 canonical, added by v16.
CREATE TABLE brand.announcements (
    id         UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID    NOT NULL,
    title      TEXT,
    body       TEXT,
    image_url  TEXT,                       -- [V20-02]
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

CREATE TABLE menu.menus (
    id          UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID      NOT NULL,
    location_id UUID,
    name        TEXT,
    menu_type   menu_type NOT NULL DEFAULT 'main',
    is_active   BOOLEAN   NOT NULL DEFAULT TRUE,
    metadata    JSONB     NOT NULL DEFAULT '{}',
    deleted_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)   REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (location_id) REFERENCES tenant.locations(id)
);

CREATE INDEX idx_menus_tenant   ON menu.menus(tenant_id)   WHERE deleted_at IS NULL;
CREATE INDEX idx_menus_location ON menu.menus(location_id) WHERE deleted_at IS NULL;


CREATE TABLE menu.categories (
    id          UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID     NOT NULL,
    menu_id     UUID     NOT NULL,
    name        TEXT     NOT NULL,
    description TEXT,
    image_url   TEXT,
    position    SMALLINT NOT NULL DEFAULT 0,
    is_active   BOOLEAN  NOT NULL DEFAULT TRUE,
    deleted_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (menu_id)   REFERENCES menu.menus(id)         ON DELETE CASCADE
);

CREATE INDEX idx_categories_menu   ON menu.categories(menu_id)   WHERE deleted_at IS NULL;
CREATE INDEX idx_categories_tenant ON menu.categories(tenant_id);


CREATE TABLE menu.menu_items (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID            NOT NULL,
    category_id     UUID,
    name            TEXT            NOT NULL,
    description     TEXT,
    image_url       TEXT,
    food_type       fssai_food_type NOT NULL DEFAULT 'veg',
    price           NUMERIC(10,2),
    has_variants    BOOLEAN         NOT NULL DEFAULT FALSE,
    is_customizable BOOLEAN         NOT NULL DEFAULT FALSE,
    is_available    BOOLEAN         NOT NULL DEFAULT TRUE,
    allergens       TEXT[],
    tags            TEXT[],
    prep_time_mins  SMALLINT,
    calories        SMALLINT,
    sort_order      SMALLINT        NOT NULL DEFAULT 0,
    metadata        JSONB           NOT NULL DEFAULT '{}',
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_item_pricing CHECK (
        (has_variants = TRUE  AND price IS NULL    ) OR
        (has_variants = FALSE AND price IS NOT NULL)
    ),
    FOREIGN KEY (tenant_id)   REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES menu.categories(id)
);

CREATE INDEX idx_menu_items_tenant    ON menu.menu_items(tenant_id)             WHERE deleted_at IS NULL;
CREATE INDEX idx_menu_items_available ON menu.menu_items(tenant_id, is_available) WHERE deleted_at IS NULL;
CREATE INDEX idx_menu_items_category  ON menu.menu_items(category_id)            WHERE deleted_at IS NULL;
CREATE INDEX idx_menu_items_name_trgm ON menu.menu_items USING gin(name gin_trgm_ops)
    WHERE deleted_at IS NULL;


CREATE TABLE menu.item_variants (
    id           UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID            NOT NULL,
    menu_item_id UUID            NOT NULL,
    name         TEXT            NOT NULL,
    food_type    fssai_food_type,
    price        NUMERIC(10,2)   NOT NULL,
    is_available BOOLEAN         NOT NULL DEFAULT TRUE,
    sort_order   SMALLINT        NOT NULL DEFAULT 0,
    deleted_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)    REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (menu_item_id) REFERENCES menu.menu_items(id)    ON DELETE CASCADE
);

CREATE INDEX idx_item_variants_item ON menu.item_variants(menu_item_id) WHERE deleted_at IS NULL;


CREATE TABLE menu.customization_groups (
    id           UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID                     NOT NULL,
    menu_item_id UUID                     NOT NULL,
    name         TEXT                     NOT NULL,
    group_type   customization_group_type NOT NULL DEFAULT 'checkbox',
    is_required  BOOLEAN                  NOT NULL DEFAULT FALSE,
    min_select   SMALLINT                 NOT NULL DEFAULT 0,
    max_select   SMALLINT                 NOT NULL DEFAULT 1,
    is_free      BOOLEAN                  NOT NULL DEFAULT FALSE,
    position     SMALLINT                 NOT NULL DEFAULT 0,
    deleted_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ              NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ              NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)    REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (menu_item_id) REFERENCES menu.menu_items(id)    ON DELETE CASCADE
);

CREATE INDEX idx_custom_groups_item ON menu.customization_groups(menu_item_id) WHERE deleted_at IS NULL;


CREATE TABLE menu.customization_options (
    id             UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID            NOT NULL,
    group_id       UUID            NOT NULL,
    name           TEXT            NOT NULL,
    price_modifier NUMERIC(10,2)   NOT NULL DEFAULT 0,
    food_type      fssai_food_type,
    is_default     BOOLEAN         NOT NULL DEFAULT FALSE,
    is_available   BOOLEAN         NOT NULL DEFAULT TRUE,
    sort_order     SMALLINT        NOT NULL DEFAULT 0,
    deleted_at     TIMESTAMPTZ,
    created_at     TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id)        ON DELETE CASCADE,
    FOREIGN KEY (group_id)  REFERENCES menu.customization_groups(id) ON DELETE CASCADE
);

CREATE INDEX idx_custom_options_group ON menu.customization_options(group_id) WHERE deleted_at IS NULL;


CREATE TABLE menu.item_availability (
    id              UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID     NOT NULL,
    menu_item_id    UUID     NOT NULL,
    day_of_week     SMALLINT CHECK (day_of_week BETWEEN 0 AND 6),
    available_from  TIME,
    available_until TIME,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)    REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (menu_item_id) REFERENCES menu.menu_items(id)    ON DELETE CASCADE
);

CREATE INDEX idx_item_availability_item ON menu.item_availability(menu_item_id);


CREATE TABLE menu.combos (
    id           UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID            NOT NULL,
    category_id  UUID,
    name         TEXT            NOT NULL,
    description  TEXT,
    image_url    TEXT,
    food_type    fssai_food_type NOT NULL DEFAULT 'veg',
    price        NUMERIC(10,2)   NOT NULL,
    is_available BOOLEAN         NOT NULL DEFAULT TRUE,
    tags         TEXT[],
    sort_order   SMALLINT        NOT NULL DEFAULT 0,
    deleted_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)   REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES menu.categories(id)
);

CREATE INDEX idx_combos_tenant   ON menu.combos(tenant_id)   WHERE deleted_at IS NULL;
CREATE INDEX idx_combos_category ON menu.combos(category_id) WHERE deleted_at IS NULL;


CREATE TABLE menu.combo_slots (
    id         UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID     NOT NULL,
    combo_id   UUID     NOT NULL,
    name       TEXT,
    quantity   SMALLINT NOT NULL DEFAULT 1,
    position   SMALLINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (combo_id)  REFERENCES menu.combos(id)        ON DELETE CASCADE
);

CREATE INDEX idx_combo_slots_combo ON menu.combo_slots(combo_id);


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


CREATE TABLE menu.menu_schedules (
    id           UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID     NOT NULL,
    menu_id      UUID     NOT NULL,
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
    priority     SMALLINT    NOT NULL DEFAULT 10,
    is_active    BOOLEAN     NOT NULL DEFAULT TRUE,
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

CREATE TABLE customer.customers (
    id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID    NOT NULL,
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
    metadata         JSONB   NOT NULL DEFAULT '{}',
    deleted_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX idx_customers_tenant      ON customer.customers(tenant_id)                WHERE deleted_at IS NULL;
CREATE INDEX idx_customers_tenant_time ON customer.customers(tenant_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_customers_phone  ON customer.customers(tenant_id, phone)
    WHERE phone IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_customers_email  ON customer.customers(tenant_id, email)
    WHERE email IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX idx_customers_phone_unique
    ON customer.customers(tenant_id, phone)
    WHERE phone IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX idx_customers_email_unique
    ON customer.customers(tenant_id, email)
    WHERE email IS NOT NULL AND deleted_at IS NULL;


CREATE TABLE customer.addresses (
    id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID    NOT NULL,
    customer_id   UUID    NOT NULL,
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


CREATE TABLE customer.loyalty_accounts (
    id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID    NOT NULL,
    customer_id    UUID    NOT NULL,
    points_balance INTEGER NOT NULL DEFAULT 0 CHECK (points_balance >= 0),
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


-- order_id FK wired after orders schema.
CREATE TABLE customer.loyalty_transactions (
    id         UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID                     NOT NULL,
    loyalty_id UUID                     NOT NULL,
    order_id   UUID,
    txn_type   loyalty_transaction_type NOT NULL,
    points     INTEGER                  NOT NULL,
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


-- notification_id FK wired after platform schema.
CREATE TABLE customer.feedback (
    id              UUID                 PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID                 NOT NULL,
    customer_id     UUID,
    entity_type     feedback_entity_type NOT NULL,
    entity_id       UUID                 NOT NULL,
    rating          SMALLINT CHECK (rating    BETWEEN 1 AND 5),
    nps_score       SMALLINT CHECK (nps_score BETWEEN 0 AND 10),
    comment         TEXT,
    tags            TEXT[],
    channel         TEXT,
    notification_id UUID,
    solicited_at    TIMESTAMPTZ,
    responded_at    TIMESTAMPTZ,
    is_public       BOOLEAN     NOT NULL DEFAULT FALSE,
    metadata        JSONB       NOT NULL DEFAULT '{}',
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


CREATE TABLE customer.interaction_log (
    id               UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID             NOT NULL,
    customer_id      UUID             NOT NULL,
    interaction_type interaction_type NOT NULL,
    entity_type      TEXT,
    entity_id        UUID,
    value            NUMERIC(12,2),
    points_delta     INTEGER,
    channel          TEXT,
    location_id      UUID,
    metadata         JSONB            NOT NULL DEFAULT '{}',
    occurred_at      TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    created_at       TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)   REFERENCES tenant.restaurants(id),
    FOREIGN KEY (customer_id) REFERENCES customer.customers(id),
    FOREIGN KEY (location_id) REFERENCES tenant.locations(id)
);

CREATE INDEX idx_interaction_log_customer ON customer.interaction_log(tenant_id, customer_id, occurred_at DESC);
CREATE INDEX idx_interaction_log_tenant   ON customer.interaction_log(tenant_id, occurred_at DESC);
CREATE INDEX idx_interaction_log_type     ON customer.interaction_log(tenant_id, interaction_type);
CREATE INDEX idx_interaction_log_entity   ON customer.interaction_log(entity_type, entity_id);


CREATE TABLE IF NOT EXISTS customer.identities (
    id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID    NOT NULL,
    customer_id    UUID    NOT NULL,
    identity_type  TEXT    NOT NULL,
    identity_value TEXT    NOT NULL,
    verified       BOOLEAN NOT NULL DEFAULT FALSE,
    metadata       JSONB   NOT NULL DEFAULT '{}',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, identity_type, identity_value),
    FOREIGN KEY (tenant_id)   REFERENCES tenant.restaurants(id),
    FOREIGN KEY (customer_id) REFERENCES customer.customers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_customer_identities_customer
    ON customer.identities(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_identities_value
    ON customer.identities(identity_type, identity_value);


-- [V20-06] Append-only consent event log (DPDP Act compliance).
CREATE TABLE IF NOT EXISTS customer.consent_history (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id  UUID        NOT NULL REFERENCES customer.customers(id),
    tenant_id    UUID        NOT NULL REFERENCES tenant.restaurants(id),
    consent_type TEXT        NOT NULL,
    granted      BOOLEAN     NOT NULL,
    source       TEXT        NOT NULL,
    ip_address   TEXT,
    user_agent   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consent_history_customer
    ON customer.consent_history(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consent_history_tenant
    ON customer.consent_history(tenant_id, created_at DESC);


-- ============================================================
-- ORDERS SCHEMA
-- ============================================================

-- session_id FK wired after dining schema.
CREATE TABLE orders.orders (
    id                  UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID             NOT NULL,
    location_id         UUID,
    customer_id         UUID,
    session_id          UUID,
    delivery_address_id UUID,
    channel             order_channel    NOT NULL DEFAULT 'web',
    fulfillment_type    fulfillment_type NOT NULL DEFAULT 'delivery',
    status              order_status     NOT NULL DEFAULT 'pending',
    scheduled_at        TIMESTAMPTZ,
    subtotal_amount     NUMERIC(10,2),
    tax_amount          NUMERIC(10,2)    NOT NULL DEFAULT 0,
    discount_amount     NUMERIC(10,2)    NOT NULL DEFAULT 0,
    tip_amount          NUMERIC(10,2)    NOT NULL DEFAULT 0,
    packaging_charge    NUMERIC(10,2)    NOT NULL DEFAULT 0,
    delivery_charge     NUMERIC(10,2)    NOT NULL DEFAULT 0,
    total_amount        NUMERIC(10,2),
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
    metadata             JSONB       NOT NULL DEFAULT '{}',
    deleted_at           TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)           REFERENCES tenant.restaurants(id),
    FOREIGN KEY (location_id)         REFERENCES tenant.locations(id),
    FOREIGN KEY (customer_id)         REFERENCES customer.customers(id),
    FOREIGN KEY (delivery_address_id) REFERENCES customer.addresses(id)
);

CREATE INDEX idx_orders_tenant         ON orders.orders(tenant_id, created_at DESC)         WHERE deleted_at IS NULL;
CREATE INDEX idx_orders_customer       ON orders.orders(customer_id)                         WHERE deleted_at IS NULL;
CREATE INDEX idx_orders_status         ON orders.orders(tenant_id, status)                   WHERE deleted_at IS NULL;
CREATE INDEX idx_orders_location       ON orders.orders(location_id, created_at DESC);
CREATE INDEX idx_orders_tenant_status_time  ON orders.orders(tenant_id, status, created_at DESC)  WHERE deleted_at IS NULL;
CREATE INDEX idx_orders_tenant_channel_time ON orders.orders(tenant_id, channel, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_orders_session        ON orders.orders(session_id)                          WHERE session_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_orders_customer_tenant ON orders.orders(customer_id, tenant_id)             WHERE deleted_at IS NULL AND customer_id IS NOT NULL;

-- [V20-05] Razorpay idempotency indexes (v17).
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_razorpay_order_id
    ON orders.orders ((metadata->>'razorpay_order_id'))
    WHERE metadata->>'razorpay_order_id' IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_razorpay_payment_id
    ON orders.orders ((metadata->>'razorpay_payment_id'))
    WHERE metadata->>'razorpay_payment_id' IS NOT NULL;


CREATE TABLE orders.order_items (
    id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID          NOT NULL,
    order_id     UUID          NOT NULL,
    menu_item_id UUID,
    variant_id   UUID,
    combo_id     UUID,
    item_name    TEXT          NOT NULL,
    variant_name TEXT,
    unit_price   NUMERIC(10,2) NOT NULL,
    tax_rate     NUMERIC(5,2)  NOT NULL DEFAULT 0,
    quantity     INTEGER       NOT NULL CHECK (quantity > 0),
    base_price   NUMERIC(10,2) GENERATED ALWAYS AS (unit_price * quantity) STORED,
    addons_total NUMERIC(10,2) NOT NULL DEFAULT 0,
    total_price  NUMERIC(10,2) NOT NULL,
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


CREATE TABLE orders.order_item_customizations (
    id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID          NOT NULL,
    order_item_id  UUID          NOT NULL,
    group_id       UUID,
    option_id      UUID,
    option_name    TEXT          NOT NULL,
    price_modifier NUMERIC(10,2) NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)     REFERENCES tenant.restaurants(id),
    FOREIGN KEY (order_item_id) REFERENCES orders.order_items(id) ON DELETE CASCADE
);

CREATE INDEX idx_order_customizations_item ON orders.order_item_customizations(order_item_id);


CREATE TABLE orders.order_taxes (
    id         UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID          NOT NULL,
    order_id   UUID          NOT NULL,
    tax_name   TEXT          NOT NULL,
    rate       NUMERIC(5,2)  NOT NULL,
    amount     NUMERIC(10,2) NOT NULL,
    created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id),
    FOREIGN KEY (order_id)  REFERENCES orders.orders(id) ON DELETE CASCADE
);

CREATE INDEX idx_order_taxes_order ON orders.order_taxes(order_id);


CREATE TABLE orders.order_discounts (
    id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID          NOT NULL,
    order_id       UUID          NOT NULL,
    coupon_code    TEXT,
    discount_type  discount_type,
    discount_value NUMERIC(10,2),
    amount_saved   NUMERIC(10,2) NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id),
    FOREIGN KEY (order_id)  REFERENCES orders.orders(id) ON DELETE CASCADE
);

CREATE INDEX idx_order_discounts_order ON orders.order_discounts(order_id);


CREATE TABLE orders.coupons (
    id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID          NOT NULL,
    code            TEXT          NOT NULL,
    description     TEXT,
    discount_type   discount_type NOT NULL,
    discount_value  NUMERIC(10,2) NOT NULL,
    min_order_value NUMERIC(10,2) NOT NULL DEFAULT 0,
    max_discount    NUMERIC(10,2),
    usage_limit     INTEGER,
    used_count      INTEGER       NOT NULL DEFAULT 0,
    valid_from      TIMESTAMPTZ,
    valid_until     TIMESTAMPTZ,
    is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, code),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX idx_coupons_tenant ON orders.coupons(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_coupons_code   ON orders.coupons(tenant_id, code)
    WHERE is_active = TRUE AND deleted_at IS NULL;


CREATE TABLE orders.delivery_jobs (
    id              UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID                NOT NULL,
    order_id        UUID                NOT NULL UNIQUE,
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
    created_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id),
    FOREIGN KEY (order_id)  REFERENCES orders.orders(id)
);

CREATE INDEX idx_delivery_jobs_order ON orders.delivery_jobs(order_id);


CREATE TABLE IF NOT EXISTS orders.order_events (
    id          UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID             NOT NULL,
    order_id    UUID             NOT NULL,
    event_type  TEXT             NOT NULL,
    status_from order_status,
    status_to   order_status,
    actor_type  audit_actor_type,
    actor_id    UUID,
    metadata    JSONB            NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id),
    FOREIGN KEY (order_id)  REFERENCES orders.orders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_order_events_order  ON orders.order_events(order_id);
CREATE INDEX IF NOT EXISTS idx_order_events_tenant ON orders.order_events(tenant_id, created_at DESC);


-- Wire loyalty_transactions → orders now that orders exists.
ALTER TABLE customer.loyalty_transactions
    ADD CONSTRAINT fk_loyalty_txn_order
        FOREIGN KEY (order_id) REFERENCES orders.orders(id);


-- ============================================================
-- PAYMENTS SCHEMA
-- ============================================================

CREATE TABLE payments.payments (
    id              UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID           NOT NULL,
    order_id        UUID,
    amount          NUMERIC(10,2),
    tip_amount      NUMERIC(10,2)  NOT NULL DEFAULT 0,
    tax_amount      NUMERIC(10,2)  NOT NULL DEFAULT 0,
    method          TEXT,
    gateway         TEXT,
    transaction_ref TEXT,
    gateway_ref     TEXT,
    CONSTRAINT uq_payments_gateway_ref UNIQUE (gateway_ref),
    status          payment_status NOT NULL DEFAULT 'pending',
    CONSTRAINT chk_payment_amount CHECK (
        status NOT IN ('authorized','captured')
        OR (amount IS NOT NULL AND amount > 0)
    ),
    refunded_amount NUMERIC(10,2)  NOT NULL DEFAULT 0,
    refunded_at     TIMESTAMPTZ,
    metadata        JSONB          NOT NULL DEFAULT '{}',
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id),
    FOREIGN KEY (order_id)  REFERENCES orders.orders(id)
);

CREATE INDEX idx_payments_tenant  ON payments.payments(tenant_id, created_at DESC);
CREATE INDEX idx_payments_order   ON payments.payments(order_id);
CREATE INDEX idx_payments_status  ON payments.payments(tenant_id, status);
CREATE INDEX idx_payments_gateway ON payments.payments(gateway_ref)
    WHERE gateway_ref IS NOT NULL;


CREATE TABLE IF NOT EXISTS payments.payment_events (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID        NOT NULL,
    payment_id        UUID        NOT NULL,
    event_type        TEXT        NOT NULL,
    provider          TEXT,
    provider_event_id TEXT,
    payload           JSONB       NOT NULL DEFAULT '{}',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)  REFERENCES tenant.restaurants(id),
    FOREIGN KEY (payment_id) REFERENCES payments.payments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_payment_events_payment ON payments.payment_events(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_events_tenant  ON payments.payment_events(tenant_id, created_at DESC);


-- ============================================================
-- DINING SCHEMA
-- ============================================================

CREATE TABLE dining.tables (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID         NOT NULL,
    location_id UUID         NOT NULL,
    name        TEXT,
    capacity    INTEGER,
    floor       TEXT,
    position    TEXT,
    status      table_status NOT NULL DEFAULT 'available',
    qr_code     TEXT,
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
    deleted_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)   REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (location_id) REFERENCES tenant.locations(id)
);

CREATE INDEX idx_tables_location ON dining.tables(location_id) WHERE deleted_at IS NULL;


-- reservation_id FK wired after dining.reservations.
CREATE TABLE dining.sessions (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID        NOT NULL,
    location_id    UUID,
    table_id       UUID        NOT NULL,
    reservation_id UUID,
    covers         SMALLINT,
    opened_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at      TIMESTAMPTZ,
    total_billed   NUMERIC(10,2),
    metadata       JSONB       NOT NULL DEFAULT '{}',
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
-- Prevents two open sessions on the same table simultaneously.
CREATE UNIQUE INDEX idx_sessions_table_open
    ON dining.sessions(table_id)
    WHERE closed_at IS NULL AND deleted_at IS NULL;


CREATE TABLE dining.reservations (
    id                  UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID               NOT NULL,
    location_id         UUID,
    customer_id         UUID,
    table_id            UUID,
    party_size          INTEGER,
    reservation_time    TIMESTAMPTZ,
    status              reservation_status NOT NULL DEFAULT 'pending',
    CONSTRAINT chk_reservation_time CHECK (
        status = 'pending' OR reservation_time IS NOT NULL
    ),
    source              TEXT,
    occasion            TEXT,
    dietary_notes       TEXT,
    deposit_amount      NUMERIC(10,2)      NOT NULL DEFAULT 0,
    deposit_paid        BOOLEAN            NOT NULL DEFAULT FALSE,
    deposit_payment_id  UUID,
    confirmation_code   TEXT UNIQUE,
    reminder_sent       BOOLEAN            NOT NULL DEFAULT FALSE,
    cancelled_at        TIMESTAMPTZ,
    cancellation_reason TEXT,
    metadata            JSONB              NOT NULL DEFAULT '{}',
    deleted_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)          REFERENCES tenant.restaurants(id),
    FOREIGN KEY (location_id)        REFERENCES tenant.locations(id),
    FOREIGN KEY (customer_id)        REFERENCES customer.customers(id),
    FOREIGN KEY (table_id)           REFERENCES dining.tables(id),
    FOREIGN KEY (deposit_payment_id) REFERENCES payments.payments(id)
);

CREATE INDEX idx_reservations_tenant        ON dining.reservations(tenant_id, reservation_time DESC);
CREATE INDEX idx_reservations_customer      ON dining.reservations(customer_id);
CREATE INDEX idx_reservations_status        ON dining.reservations(tenant_id, status);
CREATE INDEX idx_reservations_time          ON dining.reservations(tenant_id, reservation_time)      WHERE deleted_at IS NULL;
CREATE INDEX idx_reservations_tenant_status_time ON dining.reservations(tenant_id, status, reservation_time DESC) WHERE deleted_at IS NULL;


-- Wire reservation_id FK on dining.sessions now that reservations exists.
ALTER TABLE dining.sessions
    ADD CONSTRAINT fk_session_reservation
        FOREIGN KEY (reservation_id) REFERENCES dining.reservations(id);


CREATE TABLE dining.waitlist (
    id          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID            NOT NULL,
    location_id UUID,
    customer_id UUID,
    party_size  INTEGER,
    joined_at   TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    quoted_wait SMALLINT,
    notified_at TIMESTAMPTZ,
    seated_at   TIMESTAMPTZ,
    status      waitlist_status NOT NULL DEFAULT 'waiting',
    deleted_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)   REFERENCES tenant.restaurants(id),
    FOREIGN KEY (location_id) REFERENCES tenant.locations(id),
    FOREIGN KEY (customer_id) REFERENCES customer.customers(id)
);

CREATE INDEX idx_waitlist_tenant ON dining.waitlist(tenant_id, joined_at DESC);
CREATE INDEX idx_waitlist_active ON dining.waitlist(tenant_id)
    WHERE status = 'waiting' AND deleted_at IS NULL;


CREATE TABLE dining.reviews (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL,
    order_id        UUID,
    session_id      UUID,
    customer_id     UUID,
    rating          SMALLINT CHECK (rating          BETWEEN 1 AND 5),
    food_rating     SMALLINT CHECK (food_rating     BETWEEN 1 AND 5),
    service_rating  SMALLINT CHECK (service_rating  BETWEEN 1 AND 5),
    ambience_rating SMALLINT CHECK (ambience_rating BETWEEN 1 AND 5),
    delivery_rating SMALLINT CHECK (delivery_rating BETWEEN 1 AND 5),
    comment         TEXT,
    source          TEXT        NOT NULL DEFAULT 'platform',
    is_published    BOOLEAN     NOT NULL DEFAULT FALSE,
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
CREATE INDEX idx_reviews_tenant_time ON dining.reviews(tenant_id, created_at DESC) WHERE deleted_at IS NULL;
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

CREATE TABLE catering.enquiry_forms (
    id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID    NOT NULL UNIQUE,
    standard_fields   JSONB   NOT NULL DEFAULT '{}',
    custom_fields     JSONB   NOT NULL DEFAULT '[]',
    thank_you_message TEXT,
    notify_email      TEXT,
    notify_whatsapp   TEXT,
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    deleted_at        TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);


-- event_id FK wired after catering.events.
CREATE TABLE catering.leads (
    id                  UUID                 PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID                 NOT NULL,
    contact_name        TEXT                 NOT NULL,
    contact_phone       TEXT                 NOT NULL,
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
    custom_fields       JSONB                NOT NULL DEFAULT '{}',
    status              catering_lead_status NOT NULL DEFAULT 'new',
    assigned_staff_id   UUID,
    follow_up_at        TIMESTAMPTZ,
    customer_id         UUID,
    event_id            UUID,
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

CREATE INDEX idx_leads_tenant            ON catering.leads(tenant_id, created_at DESC)          WHERE deleted_at IS NULL;
CREATE INDEX idx_leads_status            ON catering.leads(tenant_id, status)                   WHERE deleted_at IS NULL;
CREATE INDEX idx_leads_tenant_status_time ON catering.leads(tenant_id, status, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_leads_customer ON catering.leads(customer_id);
CREATE INDEX idx_leads_followup ON catering.leads(tenant_id, follow_up_at)
    WHERE follow_up_at IS NOT NULL AND status NOT IN ('converted','lost');


CREATE TABLE catering.lead_notes (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID        NOT NULL,
    lead_id      UUID        NOT NULL,
    staff_id     UUID        NOT NULL,
    note         TEXT        NOT NULL,
    follow_up_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (lead_id)   REFERENCES catering.leads(id)     ON DELETE CASCADE,
    FOREIGN KEY (staff_id)  REFERENCES tenant.staff(id)
);

CREATE INDEX idx_lead_notes_lead ON catering.lead_notes(lead_id);


CREATE TABLE catering.events (
    id                 UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID                  NOT NULL,
    location_id        UUID,
    customer_id        UUID                  NOT NULL,
    lead_id            UUID,
    event_name         TEXT,
    event_type         TEXT,
    guest_count        INTEGER,
    event_date_from    DATE                  NOT NULL,
    event_date_to      DATE                  NOT NULL,
    CONSTRAINT chk_event_date_range CHECK (event_date_to >= event_date_from),
    venue_address      TEXT,
    setup_time         TIMESTAMPTZ,
    start_time         TIMESTAMPTZ,
    end_time           TIMESTAMPTZ,
    status             catering_event_status NOT NULL DEFAULT 'confirmed',
    advance_amount     NUMERIC(10,2)         NOT NULL DEFAULT 0,
    advance_paid       BOOLEAN               NOT NULL DEFAULT FALSE,
    advance_payment_id UUID,
    notes              TEXT,
    assigned_staff_id  UUID,
    metadata           JSONB                 NOT NULL DEFAULT '{}',
    deleted_at         TIMESTAMPTZ,
    created_at         TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
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


CREATE TABLE catering.event_days (
    id                UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID                  NOT NULL,
    event_id          UUID                  NOT NULL,
    event_date        DATE                  NOT NULL,
    day_label         TEXT,
    guest_count       INTEGER,
    venue_address     TEXT,
    setup_time        TIMESTAMPTZ,
    start_time        TIMESTAMPTZ,
    end_time          TIMESTAMPTZ,
    notes             TEXT,
    assigned_staff_id UUID,
    status            catering_event_status NOT NULL DEFAULT 'confirmed',
    metadata          JSONB                 NOT NULL DEFAULT '{}',
    deleted_at        TIMESTAMPTZ,
    created_at        TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
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


CREATE TABLE catering.quotes (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID         NOT NULL,
    lead_id        UUID         NOT NULL,
    event_id       UUID,
    event_day_id   UUID,
    version        SMALLINT     NOT NULL DEFAULT 1,
    status         quote_status NOT NULL DEFAULT 'draft',
    total_amount   NUMERIC(10,2),
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
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)    REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (lead_id)      REFERENCES catering.leads(id),
    FOREIGN KEY (event_id)     REFERENCES catering.events(id),
    FOREIGN KEY (event_day_id) REFERENCES catering.event_days(id)
);

CREATE INDEX idx_quotes_lead   ON catering.quotes(lead_id);
CREATE INDEX idx_quotes_event  ON catering.quotes(event_id);
CREATE INDEX idx_quotes_status ON catering.quotes(tenant_id, status);


-- package_id FK wired after catering.packages.
CREATE TABLE catering.quote_items (
    id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID          NOT NULL,
    quote_id     UUID          NOT NULL,
    description  TEXT          NOT NULL,
    menu_item_id UUID,
    package_id   UUID,
    quantity     INTEGER       NOT NULL DEFAULT 1,
    unit_price   NUMERIC(10,2) NOT NULL,
    total_price  NUMERIC(10,2) GENERATED ALWAYS AS (unit_price * quantity) STORED,
    notes        TEXT,
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)    REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (quote_id)     REFERENCES catering.quotes(id)    ON DELETE CASCADE,
    FOREIGN KEY (menu_item_id) REFERENCES menu.menu_items(id)
);

CREATE INDEX idx_quote_items_quote ON catering.quote_items(quote_id);


CREATE TABLE catering.packages (
    id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID          NOT NULL,
    name           TEXT          NOT NULL,
    description    TEXT,
    price_per_head NUMERIC(10,2) NOT NULL,
    min_guests     INTEGER,
    max_guests     INTEGER,
    is_active      BOOLEAN       NOT NULL DEFAULT TRUE,
    deleted_at     TIMESTAMPTZ,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX idx_packages_tenant ON catering.packages(tenant_id) WHERE deleted_at IS NULL;


ALTER TABLE catering.quote_items
    ADD CONSTRAINT fk_quote_item_package
        FOREIGN KEY (package_id) REFERENCES catering.packages(id);


CREATE TABLE catering.package_items (
    id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID          NOT NULL,
    package_id          UUID          NOT NULL,
    menu_item_id        UUID          NOT NULL,
    quantity_per_head   NUMERIC(5,2)  NOT NULL DEFAULT 1,
    unit_price_per_head NUMERIC(10,2),
    notes               TEXT,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)    REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (package_id)   REFERENCES catering.packages(id)  ON DELETE CASCADE,
    FOREIGN KEY (menu_item_id) REFERENCES menu.menu_items(id)
);

CREATE INDEX idx_package_items_package ON catering.package_items(package_id);


-- ============================================================
-- INSIGHTS SCHEMA
-- ============================================================

CREATE TABLE insights.daily_metrics (
    id          UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID                NOT NULL,
    location_id UUID,
    metric_date DATE                NOT NULL,
    metric_type insight_metric_type NOT NULL,
    value       NUMERIC(14,4)       NOT NULL,
    breakdown   JSONB,
    computed_at TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
    created_at  TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
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


CREATE TABLE insights.item_performance (
    id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID          NOT NULL,
    menu_item_id  UUID          NOT NULL,
    metric_date   DATE          NOT NULL,
    units_sold    INTEGER       NOT NULL DEFAULT 0,
    gross_revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
    refund_count  INTEGER       NOT NULL DEFAULT 0,
    avg_rating    NUMERIC(3,2),
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, menu_item_id, metric_date),
    FOREIGN KEY (tenant_id)    REFERENCES tenant.restaurants(id),
    FOREIGN KEY (menu_item_id) REFERENCES menu.menu_items(id)
);

CREATE INDEX idx_item_perf_tenant ON insights.item_performance(tenant_id, metric_date DESC);
CREATE INDEX idx_item_perf_item   ON insights.item_performance(menu_item_id);


CREATE TABLE insights.review_summary (
    id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID          NOT NULL UNIQUE,
    total_reviews INTEGER       NOT NULL DEFAULT 0,
    avg_rating    NUMERIC(3,2),
    five_star     INTEGER       NOT NULL DEFAULT 0,
    four_star     INTEGER       NOT NULL DEFAULT 0,
    three_star    INTEGER       NOT NULL DEFAULT 0,
    two_star      INTEGER       NOT NULL DEFAULT 0,
    one_star      INTEGER       NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id)
);


CREATE TABLE insights.events (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    entity_type TEXT        NOT NULL,
    entity_id   UUID,
    event_type  TEXT        NOT NULL,
    payload     JSONB       NOT NULL DEFAULT '{}',
    actor_id    UUID,
    session_ref TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id)
);

CREATE INDEX idx_insights_events_tenant ON insights.events(tenant_id, created_at DESC);
CREATE INDEX idx_insights_events_entity ON insights.events(entity_type, entity_id);
CREATE INDEX idx_insights_events_type   ON insights.events(tenant_id, event_type);


CREATE TABLE IF NOT EXISTS insights.menu_views (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID        NOT NULL,
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


CREATE TABLE IF NOT EXISTS insights.customer_segments (
    id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID          NOT NULL,
    customer_id UUID          NOT NULL,
    segment_key TEXT          NOT NULL,
    score       NUMERIC(10,4),
    updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, customer_id, segment_key),
    FOREIGN KEY (tenant_id)   REFERENCES tenant.restaurants(id),
    FOREIGN KEY (customer_id) REFERENCES customer.customers(id)
);

CREATE INDEX IF NOT EXISTS idx_customer_segments_tenant   ON insights.customer_segments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_customer_segments_customer ON insights.customer_segments(customer_id);


CREATE TABLE IF NOT EXISTS insights.customer_events (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    customer_id UUID,
    event_type  TEXT        NOT NULL,
    event_value NUMERIC,
    metadata    JSONB       NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)   REFERENCES tenant.restaurants(id),
    FOREIGN KEY (customer_id) REFERENCES customer.customers(id)
);

CREATE INDEX IF NOT EXISTS idx_customer_events_tenant   ON insights.customer_events(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_events_customer ON insights.customer_events(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_events_type     ON insights.customer_events(tenant_id, event_type);


-- ============================================================
-- PLATFORM SCHEMA (remaining tables)
-- ============================================================

CREATE TABLE platform.event_outbox (
    id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID          NOT NULL,
    event_type     TEXT          NOT NULL,
    aggregate_type TEXT          NOT NULL,
    aggregate_id   UUID          NOT NULL,
    payload        JSONB         NOT NULL DEFAULT '{}',
    status         outbox_status NOT NULL DEFAULT 'pending',
    retry_count    SMALLINT      NOT NULL DEFAULT 0
                       CHECK (retry_count >= 0 AND retry_count <= 25),
    error_detail   TEXT,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    processed_at   TIMESTAMPTZ,
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id)
);

CREATE INDEX idx_outbox_pending ON platform.event_outbox(created_at, retry_count)
    WHERE status IN ('pending','failed');
CREATE INDEX idx_outbox_tenant  ON platform.event_outbox(tenant_id, created_at DESC);


CREATE TABLE IF NOT EXISTS platform.events (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID        NOT NULL,
    event_type    TEXT        NOT NULL,
    event_version INT         NOT NULL DEFAULT 1,
    entity_type   TEXT,
    entity_id     UUID,
    payload       JSONB       NOT NULL DEFAULT '{}',
    processed     BOOLEAN     NOT NULL DEFAULT FALSE,
    processed_at  TIMESTAMPTZ,
    occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id)
);

CREATE INDEX IF NOT EXISTS idx_platform_events_tenant  ON platform.events(tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_events_type    ON platform.events(event_type);
CREATE INDEX IF NOT EXISTS idx_platform_events_entity  ON platform.events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_platform_events_pending ON platform.events(tenant_id)
    WHERE processed = FALSE;


CREATE TABLE platform.webhooks (
    id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID    NOT NULL,
    url         TEXT    NOT NULL,
    secret      TEXT,
    event_types TEXT[],
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    deleted_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX idx_webhooks_tenant ON platform.webhooks(tenant_id) WHERE deleted_at IS NULL;


CREATE TABLE platform.webhook_deliveries (
    id            UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
    outbox_id     UUID     NOT NULL,
    webhook_id    UUID     NOT NULL,
    http_status   SMALLINT,
    response_body TEXT,
    attempt_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    duration_ms   INTEGER,
    FOREIGN KEY (outbox_id)  REFERENCES platform.event_outbox(id),
    FOREIGN KEY (webhook_id) REFERENCES platform.webhooks(id)
);

CREATE INDEX idx_webhook_deliveries_outbox ON platform.webhook_deliveries(outbox_id);


CREATE TABLE platform.notification_templates (
    id                  UUID                 PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID                 NOT NULL,
    name                TEXT                 NOT NULL,
    trigger_event       TEXT                 NOT NULL,
    channel             notification_channel NOT NULL,
    language            TEXT                 NOT NULL DEFAULT 'en',
    subject             TEXT,
    body_template       TEXT                 NOT NULL,
    wa_template_name    TEXT,
    wa_template_lang    TEXT DEFAULT 'en',
    wa_component_params JSONB DEFAULT '[]',
    is_active           BOOLEAN              NOT NULL DEFAULT TRUE,
    is_system           BOOLEAN              NOT NULL DEFAULT FALSE,
    preview_vars        JSONB                NOT NULL DEFAULT '{}',
    deleted_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
    created_by          UUID,
    UNIQUE (tenant_id, trigger_event, channel, language),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX idx_notif_templates_tenant ON platform.notification_templates(tenant_id);
CREATE INDEX idx_notif_templates_event  ON platform.notification_templates(trigger_event);
CREATE INDEX idx_notif_templates_active ON platform.notification_templates(tenant_id, channel)
    WHERE is_active = TRUE AND deleted_at IS NULL;


-- Outbound customer communications (WhatsApp/SMS/email dispatch records).
-- Distinct from notifications.notifications (in-app staff dashboard feed).
CREATE TABLE platform.notifications (
    id                   UUID                 PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID                 NOT NULL,
    template_id          UUID,
    customer_id          UUID,
    staff_id             UUID,
    recipient_phone      TEXT,
    recipient_email      TEXT,
    recipient_push_token TEXT,
    channel              notification_channel NOT NULL,
    subject              TEXT,
    body                 TEXT                 NOT NULL,
    trigger_event        TEXT,
    entity_type          TEXT,
    entity_id            UUID,
    status               notification_status  NOT NULL DEFAULT 'queued',
    provider             TEXT,
    provider_msg_id      TEXT,
    sent_at              TIMESTAMPTZ,
    delivered_at         TIMESTAMPTZ,
    failed_at            TIMESTAMPTZ,
    failure_reason       TEXT,
    metadata             JSONB                NOT NULL DEFAULT '{}',
    created_at           TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
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


CREATE TABLE platform.notification_engagement (
    id                UUID                         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID                         NOT NULL,
    notification_id   UUID                         NOT NULL,
    customer_id       UUID,
    engagement_type   notification_engagement_type NOT NULL,
    link_url          TEXT,
    reply_body        TEXT,
    provider          TEXT,
    provider_event_id TEXT,
    raw_payload       JSONB                        NOT NULL DEFAULT '{}',
    occurred_at       TIMESTAMPTZ                  NOT NULL DEFAULT NOW(),
    created_at        TIMESTAMPTZ                  NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)       REFERENCES tenant.restaurants(id),
    FOREIGN KEY (notification_id) REFERENCES platform.notifications(id),
    FOREIGN KEY (customer_id)     REFERENCES customer.customers(id)
);

CREATE UNIQUE INDEX idx_engagement_dedup
    ON platform.notification_engagement(provider, provider_event_id)
    WHERE provider_event_id IS NOT NULL;
CREATE INDEX idx_notif_engagement_notification ON platform.notification_engagement(notification_id);
CREATE INDEX idx_notif_engagement_customer     ON platform.notification_engagement(customer_id);
CREATE INDEX idx_notif_engagement_type         ON platform.notification_engagement(tenant_id, engagement_type);
CREATE INDEX idx_notif_engagement_occurred     ON platform.notification_engagement(tenant_id, occurred_at DESC);


CREATE TABLE platform.audit_log (
    id           UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID,
    actor_id     UUID,
    actor_type   audit_actor_type NOT NULL DEFAULT 'staff',
    action       TEXT             NOT NULL,
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


CREATE TABLE IF NOT EXISTS platform.usage_events (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    metric_key  TEXT        NOT NULL,
    quantity    INTEGER     NOT NULL DEFAULT 1 CHECK (quantity > 0),
    entity_type TEXT,
    entity_id   UUID,
    metadata    JSONB       NOT NULL DEFAULT '{}',
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id)
);

CREATE INDEX IF NOT EXISTS idx_usage_events_tenant ON platform.usage_events(tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_events_metric ON platform.usage_events(metric_key);


CREATE TABLE IF NOT EXISTS platform.usage_ledger (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID        NOT NULL,
    metric_key   TEXT        NOT NULL,
    period_start DATE        NOT NULL,
    period_end   DATE        NOT NULL,
    quantity     BIGINT      NOT NULL DEFAULT 0,
    billed       BOOLEAN     NOT NULL DEFAULT FALSE,
    metadata     JSONB       NOT NULL DEFAULT '{}',
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


CREATE TABLE IF NOT EXISTS platform.api_keys (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    key_hash    TEXT        NOT NULL,
    name        TEXT,
    permissions TEXT[],
    revoked_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_api_key_hash UNIQUE (key_hash),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON platform.api_keys(tenant_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON platform.api_keys(tenant_id)
    WHERE revoked_at IS NULL;


-- [V20-07] Tenant data export request tracker (v18).
CREATE TABLE IF NOT EXISTS platform.export_jobs (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID        NOT NULL REFERENCES tenant.restaurants(id),
    export_type  TEXT        NOT NULL DEFAULT 'full',
    status       TEXT        NOT NULL DEFAULT 'pending',
    storage_path TEXT,
    requested_by UUID,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_export_jobs_tenant
    ON platform.export_jobs(tenant_id, requested_at DESC);


-- [V20-08] DPDP Act compliance workflow (v18).
CREATE TABLE IF NOT EXISTS platform.customer_data_requests (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id   UUID        NOT NULL REFERENCES customer.customers(id),
    tenant_id     UUID        NOT NULL REFERENCES tenant.restaurants(id),
    request_type  TEXT        NOT NULL,
    status        TEXT        NOT NULL DEFAULT 'pending',
    requested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cdr_customer
    ON platform.customer_data_requests(customer_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_cdr_tenant
    ON platform.customer_data_requests(tenant_id, requested_at DESC);


-- [V20-09] Cross-tenant aggregated intelligence — intentionally has NO tenant FK.
CREATE TABLE IF NOT EXISTS platform.benchmarks (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    metric_name  TEXT        NOT NULL,
    dimension    TEXT        NOT NULL,
    value        NUMERIC     NOT NULL,
    sample_count INTEGER     NOT NULL,
    period_start DATE        NOT NULL,
    period_end   DATE        NOT NULL,
    computed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_benchmarks_metric
    ON platform.benchmarks(metric_name, dimension, period_end DESC);


-- Wire deferred FK: customer.feedback → platform.notifications
ALTER TABLE customer.feedback
    ADD CONSTRAINT fk_feedback_notification
        FOREIGN KEY (notification_id) REFERENCES platform.notifications(id);


-- ============================================================
-- INVENTORY SCHEMA
-- ============================================================

CREATE TABLE IF NOT EXISTS inventory.items (
    id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID          NOT NULL,
    name                TEXT          NOT NULL,
    unit                TEXT,
    low_stock_threshold NUMERIC(12,3),
    metadata            JSONB         NOT NULL DEFAULT '{}',
    deleted_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenant.restaurants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_inventory_items_tenant ON inventory.items(tenant_id)
    WHERE deleted_at IS NULL;


CREATE TABLE IF NOT EXISTS inventory.movements (
    id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID          NOT NULL,
    inventory_item_id UUID          NOT NULL,
    movement_type     TEXT          NOT NULL,
    quantity          NUMERIC(12,3) NOT NULL,
    reference_type    TEXT,
    reference_id      UUID,
    notes             TEXT,
    metadata          JSONB         NOT NULL DEFAULT '{}',
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)         REFERENCES tenant.restaurants(id),
    FOREIGN KEY (inventory_item_id) REFERENCES inventory.items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_item   ON inventory.movements(inventory_item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_tenant ON inventory.movements(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_ref    ON inventory.movements(reference_type, reference_id)
    WHERE reference_id IS NOT NULL;


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
-- NOTIFICATIONS SCHEMA  [V20-10]
-- In-app staff dashboard notification feed.
-- Distinct from platform.notifications (outbound customer comms).
-- ============================================================

-- [V20-10] In-app staff alert store. 90-day TTL enforced via expires_at.
CREATE TABLE IF NOT EXISTS notifications.notifications (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL REFERENCES tenant.restaurants(id),
    type        TEXT        NOT NULL,
    priority    TEXT        NOT NULL DEFAULT 'INFO',
    title       TEXT        NOT NULL,
    body        TEXT,
    entity_type TEXT,
    entity_id   UUID,
    actor_type  TEXT,
    actor_id    UUID,
    metadata    JSONB       NOT NULL DEFAULT '{}',
    read_at     TIMESTAMPTZ,
    expires_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_tenant_unread
    ON notifications.notifications(tenant_id, created_at DESC)
    WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_tenant
    ON notifications.notifications(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_expires
    ON notifications.notifications(expires_at)
    WHERE expires_at IS NOT NULL;


-- ============================================================
-- UPDATED_AT TRIGGER
-- Automatically sets updated_at = NOW() on every UPDATE.
-- Applied to all tables with an updated_at column.
-- [V12-01] CREATE OR REPLACE TRIGGER is idempotent on PG 14+.
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
              'inventory','notifications'
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
-- SEED: schema_migrations tracking  [V20-12]
-- Records all migrations that are absorbed into this schema file.
-- A fresh install immediately knows its migration state.
-- ============================================================

INSERT INTO platform.schema_migrations (version, name) VALUES
    ('v1',  'initial-schema'),
    ('v2',  'core-tables'),
    ('v3',  'brand-schema'),
    ('v4',  'menu-schema'),
    ('v5',  'customer-schema'),
    ('v6',  'orders-schema'),
    ('v7',  'payments-schema'),
    ('v8',  'platform-schema'),
    ('v9',  'tables-reviews-delivery'),
    ('v10', 'column-renames-domain'),
    ('v11', 'schema-unification'),
    ('v12', 'canonical-consolidation'),
    ('v13', 'dine-in-session-link'),
    ('v14', 'staff-password-hash'),
    ('v15', 'plan-varchar-tiers'),
    ('v16', 'presence-content-brand'),
    ('v17', 'razorpay-idempotency'),
    ('v18', 'governance-dpdp'),
    ('v19', 'notifications-schema'),
    ('v20', 'foundation-consolidation')
ON CONFLICT (version) DO NOTHING;


-- ============================================================
-- SCHEMA SUMMARY — V20
-- ============================================================
-- Schema        Table                          Classification
-- ────────────  ─────────────────────────────  ──────────────
-- tenant        restaurants                    ACTIVE
-- tenant        locations                      ACTIVE
-- tenant        domains                        ACTIVE
-- tenant        operating_hours                PLANNED
-- tenant        virtual_brands                 PLANNED
-- tenant        integrations                   ACTIVE
-- tenant        roles                          PLANNED
-- tenant        permissions                    PLANNED
-- tenant        staff                          ACTIVE  [V20-01 password_hash]
-- tenant        staff_roles                    PLANNED
-- tenant        staff_locations                PLANNED
-- tenant        staff_sessions                 PLANNED
-- tenant        tax_rules                      PLANNED
-- tenant        tax_rule_items                 PLANNED
-- tenant        subscriptions                  PLANNED
-- tenant        feature_flags                  PLANNED
-- tenant        notification_preferences       ACTIVE  [V20-11]
-- brand         themes                         ACTIVE
-- brand         assets                         ACTIVE
-- brand         seo                            ACTIVE
-- brand         contact_links                  ACTIVE
-- brand         announcements                  ACTIVE  [V20-02 image_url]
-- menu          menus                          ACTIVE
-- menu          categories                     ACTIVE
-- menu          menu_items                     ACTIVE
-- menu          item_variants                  ACTIVE
-- menu          customization_groups           ACTIVE
-- menu          customization_options          ACTIVE
-- menu          item_availability              PLANNED
-- menu          combos                         PLANNED
-- menu          combo_slots                    PLANNED
-- menu          combo_slot_options             PLANNED
-- menu          menu_schedules                 PLANNED
-- customer      customers                      ACTIVE
-- customer      addresses                      ACTIVE
-- customer      loyalty_accounts               PLANNED
-- customer      loyalty_transactions           PLANNED
-- customer      feedback                       PLANNED
-- customer      interaction_log                PLANNED
-- customer      identities                     PLANNED
-- customer      consent_history                ACTIVE  [V20-06]
-- orders        orders                         ACTIVE
-- orders        order_items                    ACTIVE
-- orders        order_item_customizations      ACTIVE
-- orders        order_taxes                    PLANNED
-- orders        order_discounts                PLANNED
-- orders        coupons                        PLANNED
-- orders        delivery_jobs                  PLANNED
-- orders        order_events                   PLANNED
-- payments      payments                       ACTIVE
-- payments      payment_events                 PLANNED
-- dining        tables                         ACTIVE
-- dining        sessions                       ACTIVE
-- dining        reservations                   ACTIVE
-- dining        waitlist                       PLANNED
-- dining        reviews                        ACTIVE
-- catering      enquiry_forms                  PLANNED
-- catering      leads                          ACTIVE
-- catering      lead_notes                     PLANNED
-- catering      events                         PLANNED
-- catering      event_days                     PLANNED
-- catering      quotes                         PLANNED
-- catering      quote_items                    PLANNED
-- catering      packages                       PLANNED
-- catering      package_items                  PLANNED
-- insights      daily_metrics                  PLANNED
-- insights      item_performance               PLANNED
-- insights      review_summary                 PLANNED
-- insights      events                         PLANNED
-- insights      menu_views                     PLANNED
-- insights      customer_segments              PLANNED
-- insights      customer_events                PLANNED
-- platform      event_outbox                   PLANNED
-- platform      events                         PLANNED
-- platform      webhooks                       PLANNED
-- platform      webhook_deliveries             PLANNED
-- platform      notification_templates         PLANNED
-- platform      notifications                  ACTIVE  (outbound comms)
-- platform      notification_engagement        PLANNED
-- platform      audit_log                      ACTIVE
-- platform      usage_events                   PLANNED
-- platform      usage_ledger                   PLANNED
-- platform      api_keys                       PLANNED
-- platform      export_jobs                    ACTIVE  [V20-07]
-- platform      customer_data_requests         ACTIVE  [V20-08]
-- platform      benchmarks                     PLANNED [V20-09]
-- platform      schema_migrations              NEW     [V20-12]
-- inventory     items                          PLANNED
-- inventory     movements                      PLANNED
-- inventory     stock_levels (VIEW)            PLANNED
-- notifications notifications                  ACTIVE  [V20-10]
-- ============================================================
-- Total: 86 tables + 1 view across 12 schemas
-- Active: 22 tables  |  Planned: 64 tables  |  New: 1 table
-- ============================================================
