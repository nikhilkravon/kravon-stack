
-- ============================================================
-- kravon_schema_v9_upgrade_pg17.sql
-- Target: PostgreSQL 17
-- Upgrade layer for kravon_schema_v8
-- Adds SaaS infrastructure, event architecture, AI data layer,
-- inventory subsystem, and operational audit streams.
-- Safe to run after V8.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS inventory;

-- ============================================================
-- TENANT SAAS LAYER
-- ============================================================

CREATE TABLE IF NOT EXISTS tenant.subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    plan restaurant_plan NOT NULL,
    billing_provider TEXT,
    provider_subscription_id TEXT,
    status TEXT NOT NULL
        CHECK (status IN ('trial','active','past_due','cancelled','paused')),
    trial_ends_at TIMESTAMPTZ,
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN DEFAULT FALSE,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)
        REFERENCES tenant.restaurants(id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant
ON tenant.subscriptions(tenant_id);

-- ============================================================
-- FEATURE FLAGS
-- ============================================================

CREATE TABLE IF NOT EXISTS tenant.feature_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    feature_key TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    config JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (tenant_id, feature_key),
    FOREIGN KEY (tenant_id)
        REFERENCES tenant.restaurants(id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_feature_flags_tenant
ON tenant.feature_flags(tenant_id);

-- ============================================================
-- PLATFORM USAGE METERING
-- ============================================================

CREATE TABLE IF NOT EXISTS platform.usage_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    metric_key TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    entity_type TEXT,
    entity_id UUID,
    metadata JSONB NOT NULL DEFAULT '{}',
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)
        REFERENCES tenant.restaurants(id)
);

CREATE INDEX IF NOT EXISTS idx_usage_events_tenant
ON platform.usage_events(tenant_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_usage_events_metric
ON platform.usage_events(metric_key);

-- ============================================================
-- PLATFORM EVENT BUS
-- ============================================================

CREATE TABLE IF NOT EXISTS platform.events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    event_type TEXT NOT NULL,
    entity_type TEXT,
    entity_id UUID,
    payload JSONB NOT NULL DEFAULT '{}',
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)
        REFERENCES tenant.restaurants(id)
);

CREATE INDEX IF NOT EXISTS idx_platform_events_tenant
ON platform.events(tenant_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_events_type
ON platform.events(event_type);

-- ============================================================
-- ORDER LIFECYCLE EVENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS orders.order_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    order_id UUID NOT NULL,
    event_type TEXT NOT NULL,
    status_from order_status,
    status_to order_status,
    actor_type audit_actor_type,
    actor_id UUID,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id)
        REFERENCES tenant.restaurants(id),
    FOREIGN KEY (order_id)
        REFERENCES orders.orders(id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_order_events_order
ON orders.order_events(order_id);

CREATE INDEX IF NOT EXISTS idx_order_events_tenant
ON orders.order_events(tenant_id, created_at DESC);

-- ============================================================
-- PAYMENT EVENT LOG
-- ============================================================

CREATE TABLE IF NOT EXISTS payments.payment_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    payment_id UUID NOT NULL,
    event_type TEXT NOT NULL,
    provider TEXT,
    provider_event_id TEXT,
    payload JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (tenant_id)
        REFERENCES tenant.restaurants(id),
    FOREIGN KEY (payment_id)
        REFERENCES payments.payments(id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_payment_events_payment
ON payments.payment_events(payment_id);

-- ============================================================
-- CUSTOMER IDENTITY GRAPH
-- ============================================================

CREATE TABLE IF NOT EXISTS customer.identities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    customer_id UUID NOT NULL,
    identity_type TEXT NOT NULL,
    identity_value TEXT NOT NULL,
    verified BOOLEAN DEFAULT FALSE,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (tenant_id, identity_type, identity_value),
    FOREIGN KEY (tenant_id)
        REFERENCES tenant.restaurants(id),
    FOREIGN KEY (customer_id)
        REFERENCES customer.customers(id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_customer_identities_customer
ON customer.identities(customer_id);

-- ============================================================
-- INVENTORY SYSTEM
-- ============================================================

CREATE TABLE IF NOT EXISTS inventory.items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    name TEXT NOT NULL,
    unit TEXT,
    current_stock NUMERIC(12,3),
    low_stock_threshold NUMERIC(12,3),
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (tenant_id)
        REFERENCES tenant.restaurants(id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_inventory_items_tenant
ON inventory.items(tenant_id);

CREATE TABLE IF NOT EXISTS inventory.movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    inventory_item_id UUID NOT NULL,
    movement_type TEXT NOT NULL,
    quantity NUMERIC(12,3) NOT NULL,
    reference_type TEXT,
    reference_id UUID,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (tenant_id)
        REFERENCES tenant.restaurants(id),
    FOREIGN KEY (inventory_item_id)
        REFERENCES inventory.items(id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_item
ON inventory.movements(inventory_item_id);

-- ============================================================
-- AI / ANALYTICS LAYER
-- ============================================================

CREATE TABLE IF NOT EXISTS insights.menu_views (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    menu_item_id UUID,
    customer_id UUID,
    source TEXT,
    session_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (tenant_id)
        REFERENCES tenant.restaurants(id),
    FOREIGN KEY (menu_item_id)
        REFERENCES menu.menu_items(id),
    FOREIGN KEY (customer_id)
        REFERENCES customer.customers(id)
);

CREATE INDEX IF NOT EXISTS idx_menu_views_tenant
ON insights.menu_views(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS insights.customer_segments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    customer_id UUID NOT NULL,
    segment_key TEXT NOT NULL,
    score NUMERIC(10,4),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (tenant_id, customer_id, segment_key),
    FOREIGN KEY (tenant_id)
        REFERENCES tenant.restaurants(id),
    FOREIGN KEY (customer_id)
        REFERENCES customer.customers(id)
);

CREATE INDEX IF NOT EXISTS idx_customer_segments_tenant
ON insights.customer_segments(tenant_id);

-- ============================================================
-- API KEYS
-- ============================================================

CREATE TABLE IF NOT EXISTS platform.api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    key_hash TEXT NOT NULL,
    name TEXT,
    permissions TEXT[],
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (tenant_id)
        REFERENCES tenant.restaurants(id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_api_keys_tenant
ON platform.api_keys(tenant_id);

-- ============================================================
-- END OF V9 UPGRADE
-- ============================================================
