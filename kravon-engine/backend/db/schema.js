/**
 * DB SCHEMA — schema.js
 * Canonical SQL for a fresh Kravon platform database.
 * Run via: node db/migrate.js
 * Safe to re-run — all statements use IF NOT EXISTS.
 *
 * Column naming conventions (V10):
 *   rest_id      — foreign key to restaurants.rest_id on every child table
 *   price_paise  — monetary values always stored in paise (₹1 = 100 paise)
 *   total_amount — order total (explicit, not ambiguous "total")
 *   headcount    — number of guests on catering leads (replaces "pax")
 *
 * Multi-tenant isolation:
 *   Every table carries rest_id. No query may omit it — doing so would
 *   return or mutate data across tenants.
 */

'use strict';

const SCHEMA = `

/* ─── Restaurants ──────────────────────────────────────────────────────────
   One row per tenant. slug is the URL-safe identifier used in every API
   path: /v1/restaurants/:slug/...
   razorpay_key_secret is stored encrypted (AES-256-GCM via utils/crypto.js).
   domain stores the restaurant's custom domain for Host-header resolution.
──────────────────────────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS restaurants (
  rest_id              SERIAL PRIMARY KEY,
  slug                 VARCHAR(80)  NOT NULL UNIQUE,
  domain               VARCHAR(200) UNIQUE,              -- e.g. "burgerhouse.in"
  name                 VARCHAR(120) NOT NULL,
  tagline              VARCHAR(200),
  year                 VARCHAR(4),

  -- Contact
  phone                VARCHAR(30),
  wa_number            VARCHAR(20),           -- digits only, country code, no +
  email                VARCHAR(120),
  address              TEXT,
  city                 VARCHAR(100),
  delivery_zone        VARCHAR(200),

  -- Hours
  hours_display        VARCHAR(100),
  open_until           VARCHAR(40),

  -- Product flags (server-enforced via requireFeature middleware)
  has_presence         BOOLEAN DEFAULT TRUE,   -- always on; Presence is the base product
  has_tables           BOOLEAN DEFAULT FALSE,
  has_orders           BOOLEAN DEFAULT FALSE,
  has_catering         BOOLEAN DEFAULT FALSE,
  has_insights         BOOLEAN DEFAULT FALSE,

  -- Payment gateway (secret stored encrypted)
  razorpay_key_id      VARCHAR(40),
  razorpay_key_secret  TEXT,

  -- Tables product config
  review_threshold     SMALLINT DEFAULT 4,      -- star gate: below → private, at/above → Google
  google_review_url    VARCHAR(300),

  -- Outbound webhook (n8n / Zapier compatible)
  webhook_url          VARCHAR(300),            -- fires on every confirmed order and lead

  -- Delivery fee (per-tenant, in paise)
  delivery_fee         INT DEFAULT 4900,        -- ₹49 default
  free_delivery_above  INT DEFAULT 49900,       -- ₹499 default

  -- CORS
  allowed_origin       VARCHAR(200),

  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

/* ─── Menu categories ─────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS menu_categories (
  id          SERIAL PRIMARY KEY,
  rest_id     INT NOT NULL REFERENCES restaurants(rest_id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  subtitle    VARCHAR(200),
  sort_order  INT DEFAULT 0,
  active      BOOLEAN DEFAULT TRUE
);

/* ─── Menu items ──────────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS menu_items (
  id           SERIAL PRIMARY KEY,
  rest_id      INT NOT NULL REFERENCES restaurants(rest_id) ON DELETE CASCADE,
  category_id  INT NOT NULL REFERENCES menu_categories(id) ON DELETE CASCADE,
  name         VARCHAR(150) NOT NULL,
  price_paise  INT NOT NULL,               -- always paise; divide by 100 for display
  description  TEXT,
  image        VARCHAR(20),                -- emoji or asset path
  image_bg     VARCHAR(200),              -- CSS gradient string
  badge        VARCHAR(50),
  badge_style  VARCHAR(20),
  customisable BOOLEAN DEFAULT FALSE,
  active       BOOLEAN DEFAULT TRUE,
  sort_order   INT DEFAULT 0
);

/* ─── Menu add-ons ────────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS menu_addons (
  id          SERIAL PRIMARY KEY,
  rest_id     INT NOT NULL REFERENCES restaurants(rest_id) ON DELETE CASCADE,
  label       VARCHAR(100) NOT NULL,
  price_paise INT DEFAULT 0,
  active      BOOLEAN DEFAULT TRUE,
  sort_order  INT DEFAULT 0
);

/* ─── Spice levels ────────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS spice_levels (
  id         SERIAL PRIMARY KEY,
  rest_id    INT NOT NULL REFERENCES restaurants(rest_id) ON DELETE CASCADE,
  label      VARCHAR(50) NOT NULL,
  sort_order INT DEFAULT 0
);

/* ─── Customers ───────────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS customers (
  id             SERIAL PRIMARY KEY,
  rest_id        INT NOT NULL REFERENCES restaurants(rest_id) ON DELETE CASCADE,
  phone          VARCHAR(20) NOT NULL,
  name           VARCHAR(120),
  order_count    INT DEFAULT 0,
  total_spent    INT DEFAULT 0,      -- paise
  first_order_at TIMESTAMPTZ,
  last_order_at  TIMESTAMPTZ,
  UNIQUE (rest_id, phone)
);

/* ─── Orders ──────────────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS orders (
  id                  SERIAL PRIMARY KEY,
  rest_id             INT NOT NULL REFERENCES restaurants(rest_id) ON DELETE CASCADE,
  customer_id         INT REFERENCES customers(id),

  -- Surface: which product created this order
  order_surface       VARCHAR(20),   -- 'tables' | 'orders'
  table_identifier    VARCHAR(20),   -- 'T4' | 'takeaway' | NULL (delivery orders)

  -- Customer snapshot at time of order
  customer_name       VARCHAR(120) NOT NULL,
  customer_phone      VARCHAR(20)  NOT NULL,
  delivery_address    TEXT,          -- NULL for Tables orders
  delivery_locality   VARCHAR(100),
  delivery_landmark   VARCHAR(200),

  -- Cart (JSON snapshot — items are snapshotted so menu changes don't alter history)
  items_json          JSONB NOT NULL,  -- [{id, name, price, qty, note, addons}]
  special_notes       TEXT,

  -- Pricing (all paise)
  subtotal            INT NOT NULL,
  delivery_fee        INT NOT NULL DEFAULT 0,
  gst                 INT NOT NULL DEFAULT 0,  -- retained for historical rows; V10 sets 0
  total_amount        INT NOT NULL,

  -- Delivery
  delivery_type       VARCHAR(20) DEFAULT 'standard',

  -- Payment
  payment_method      VARCHAR(30) NOT NULL,
  payment_status      VARCHAR(20) NOT NULL DEFAULT 'pending',
  razorpay_order_id   VARCHAR(80),
  razorpay_payment_id VARCHAR(80),

  -- Lifecycle: pending_payment → confirmed → preparing → out_for_delivery → delivered | cancelled
  status              VARCHAR(30) NOT NULL DEFAULT 'pending_payment',

  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

/* ─── Catering leads ──────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS catering_leads (
  id         SERIAL PRIMARY KEY,
  rest_id    INT NOT NULL REFERENCES restaurants(rest_id) ON DELETE CASCADE,

  ref        VARCHAR(30) UNIQUE NOT NULL,  -- e.g. DFC-1A2B3C

  -- Contact
  name       VARCHAR(120) NOT NULL,
  company    VARCHAR(150),
  email      VARCHAR(120) NOT NULL,
  phone      VARCHAR(20)  NOT NULL,

  -- Brief
  budget     VARCHAR(30),
  headcount  VARCHAR(20),    -- number of guests (was "pax")
  event_type VARCHAR(50),
  date_start DATE,
  date_end   DATE,
  notes      TEXT,

  -- Scoring
  score      SMALLINT,
  tier       VARCHAR(10),    -- hot | warm | cool

  -- CRM lifecycle: new → contacted → proposal_sent → won | lost
  status     VARCHAR(20) DEFAULT 'new',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

/* ─── Reviews ─────────────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS reviews (
  id               SERIAL PRIMARY KEY,
  rest_id          INT NOT NULL REFERENCES restaurants(rest_id) ON DELETE CASCADE,
  order_id         INT REFERENCES orders(id),

  stars            SMALLINT NOT NULL CHECK (stars BETWEEN 1 AND 5),
  feedback         TEXT,              -- captured privately when below threshold
  order_surface    VARCHAR(20),
  table_identifier VARCHAR(20),

  created_at       TIMESTAMPTZ DEFAULT NOW()
);

/* ─── Indexes ─────────────────────────────────────────────────────────────── */
CREATE INDEX IF NOT EXISTS idx_orders_rest        ON orders(rest_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_phone       ON orders(rest_id, customer_phone);
CREATE INDEX IF NOT EXISTS idx_orders_status      ON orders(rest_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_surface     ON orders(rest_id, order_surface);
CREATE INDEX IF NOT EXISTS idx_orders_table       ON orders(rest_id, table_identifier) WHERE table_identifier IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_rest         ON catering_leads(rest_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_status       ON catering_leads(rest_id, status);
CREATE INDEX IF NOT EXISTS idx_customers_rest     ON customers(rest_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_cat     ON menu_items(category_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_reviews_rest       ON reviews(rest_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurants_domain ON restaurants(domain) WHERE domain IS NOT NULL;

`;

module.exports = SCHEMA;
