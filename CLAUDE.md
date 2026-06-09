# Kravon Stack — Claude Handoff

## What this is

Multi-tenant restaurant SaaS. Solo-built by Nikhil. Node.js backend + vanilla JS frontend + Railway PostgreSQL.

- **Backend:** `kravon-engine/backend/` — Node.js/Express, port 3000, run `npm run dev`
- **Frontend:** `kravon-engine/frontend/` — static HTML/JS, port 8000, run `npm start`
- **DB:** Railway PostgreSQL — `DATABASE_URL` in `kravon-engine/backend/.env`
- **Deployed:** Railway (backend), Vercel (frontend)

---

## Repo structure

```
kravon-stack/
  kravon-engine/
    backend/
      server.js                      ← entry point, all route mounts
      api/
        middleware/
          tenant.js                  ← resolveRestaurant → req.tenant
          auth.js                    ← requireRestaurantAuth (checks req.auth.tenantId)
          feature.js                 ← requireFeature('has_tables') etc.
        routes/
          config.js                  ← GET /config (public), bustConfigCache()
          auth.js                    ← login/refresh/logout
          menu.js                    ← full menu CRUD
          orders.js                  ← create + list + detail
          presence.js                ← PATCH /presence (brand/content editor)
          leads.js                   ← catering lead pipeline
          dine-in.js                 ← QR ordering, kitchen, sessions
          tables.js                  ← table CRUD
          insights.js                ← analytics dashboard
          customers.js               ← CRM + DPDP governance
          staff.js                   ← staff management
          settings.js                ← restaurant settings
          notifications.js           ← in-app bell feed
          reviews.js                 ← review submission + list
          webhooks.js                ← Razorpay webhook handler
          admin.js                   ← internal admin (API key gated)
      domains/
        catalog/                     ← menu items, categories, customizations
        catering/                    ← lead pipeline, scoring
        customer/                    ← CRM, DPDP
        dining/                      ← sessions, kitchen, reservations
        identity/                    ← auth repository
        intelligence/                ← analytics queries
        notifications/               ← in-app notifications
        ordering/                    ← order creation, outbox
        presence/                    ← brand content editor
        tenancy/                     ← restaurant settings
      services/
        notification.listeners.js    ← maps events → in-app + WhatsApp
        notification.service.js      ← writes to notifications.notifications
        notify.service.js            ← WhatsApp / webhook dispatch
        outbox.poller.js             ← durable event delivery (polls every 5s)
      db/
        pool.js                      ← pg pool, query(), getClient()
        migrate.js                   ← applies kravon_schema_v20.sql
        migrations/                  ← v20 through v23 (run in order)
        seeds/                       ← royal-tandoor, dead-flat-co test tenants
      jobs/
        aggregate-daily-metrics.js   ← daily analytics rollup
    frontend/
      dashboard/                     ← operator dashboard SPA (12 views)
      presence/                      ← restaurant landing page
      orders/                        ← delivery ordering
      tables/                        ← QR dine-in ordering
      catering/                      ← catering lead form
      review/                        ← post-order review page
      shared/
        js/
          item-controls.js           ← makeRenderer(cfg) — shared add/qty buttons
          cart.js                    ← KravonCart engine
          kravon.js                  ← scroll reveal, toast utilities
      server.js                      ← static file server with env var injection
    docs/
      api-reference.md
      architecture.md
      frontend-backend-audit.md      ← full API exposure audit (2026-06-08)
    tests/
      specs/                         ← Playwright E2E scenario specs
```

---

## Database — v20 schema

Multi-schema PostgreSQL. Key schemas:

| Schema | Purpose |
|--------|---------|
| `tenant.*` | restaurants, staff, roles, sessions, locations |
| `menu.*` | menus, categories, items, variants, customization_groups, customization_options |
| `orders.*` | orders, order_items |
| `dining.*` | sessions, tables, reservations, reviews |
| `brand.*` | assets (logo/hero/gallery), contact_links, announcements |
| `catering.*` | leads, events |
| `customer.*` | customers, data_requests |
| `notifications.*` | notifications |
| `platform.*` | event_outbox, schema_migrations, audit_log, export_jobs |

**Critical column names — `orders.orders`:**
- `channel` ENUM: `web | qr | whatsapp | phone | pos`
- `fulfillment_type` ENUM: `delivery | pickup | dine_in | catering`
- `status` ENUM: `pending | confirmed | preparing | ready | out_for_delivery | delivered | completed | cancelled | refunded`
- Customer info: via FK `customer_id` → `customer.customers`
- Customer name/phone/payment_method/table_identifier stored in `metadata` JSONB

**`tenant.restaurants`:**
- `plan` VARCHAR(20): `starter | growth | pro | enterprise`
- `has_orders`, `has_tables`, `has_catering`, `has_insights` BOOLEAN feature flags
- Operational config in `settings` JSONB

---

## Auth

- JWT access token: 15 min, carries `{ staffId, tenantId, slug, roles }`
- Refresh token: 30-day, SHA-256 hashed, stored in `tenant.staff_sessions`
- `requireRestaurantAuth` checks `req.auth.tenantId` (not `restaurantId`)
- Login: `POST /v1/auth/login` — slug + email + password
- Logout: `POST /v1/auth/logout` — revokes current token only; `{ logoutAll: true }` revokes all

---

## Key patterns

**Tenant resolution:** Every restaurant route passes through `resolveRestaurant` middleware → `req.tenant` contains tenant object with `tenant_id`, `slug`, `settings`, feature flags.

**Config cache:** In-memory Map, 60s TTL. Call `bustConfigCache(tenantId)` after any catalog or presence write. Import from `api/routes/config.js`.

**Transactions:** Use `getClient()` from `db/pool.js`. Always `try/catch` with `ROLLBACK` in catch, `client.release()` in finally.

**Event outbox:** Write events to `platform.event_outbox` inside the same transaction as the domain write using `domains/ordering/outbox.js`. `outbox.poller.js` delivers them every 5s with `SELECT FOR UPDATE SKIP LOCKED`.

**Domain events:** `utils/events.js` (Node EventEmitter). `notification.listeners.js` maps events → in-app notifications + WhatsApp. Listeners registered at server boot.

**Zod validation:** All write endpoints validate with Zod schemas before touching the DB.

---

## Subscription plans

| Plan | Features |
|------|---------|
| Starter | Presence website + WhatsApp ordering |
| Growth | Website + Razorpay + Order dashboard |
| Pro | Growth + QR Tables + dine-in |
| Enterprise | Pro + analytics + staff accounts |

Feature gates: `requireFeature('has_tables')` etc. in `server.js` route mounts.

---

## What's been built

- Full multi-tenant backend: all routes, domain services, repositories
- JWT auth with refresh tokens, session revocation, password reset
- Order creation with idempotency key, GST calculation, Razorpay integration
- Event outbox pattern for durable event delivery (`platform.event_outbox`)
- Presence/brand editor with Zod validation and transaction safety
- Per-tenant rate limiting (order: 30/min, auth: 10/min)
- In-app notification system (bell feed)
- WhatsApp + webhook dispatch via `notify.service.js`
- Customer CRM + DPDP governance endpoints
- Insights / analytics dashboard
- QR dine-in: sessions, kitchen view, bill request
- Catering lead pipeline with scoring
- Full operator dashboard (12 views, vanilla JS SPA)
- All customer-facing frontends (presence, orders, tables, catering, review)
- v20–v23 database migrations

---

## What's NOT done yet

1. **Self-serve onboarding** — sign-up flow, restaurant creation, first config wizard
2. **Billing integration** — subscription management, plan upgrades
3. **QR boot merge** — `GET /dine-in/session?table_id=` should return `{ status, session, orders }` in one call (currently 2 sequential calls)
4. **Customers list enrichment** — missing `total_spend`, `order_count`, `last_order_at` in `GET /customers`
5. **Kitchen `bill_requested` flag** — not surfaced in kitchen view
6. **`unique_customers` metric** — misleading label in insights (sums daily new, not DISTINCT count)
7. **Settings cache bust** — `PATCH /settings/restaurant` and `PATCH /settings/notifications` don't call `bustConfigCache`
8. **Authenticated settings endpoint** — no clean `GET /settings` for operator; dashboard reads public `/config`
9. **`flatItems` + `categories` duplication** in `/config` response — same items returned twice
10. **`is_customizable` + `customise` field duplication** — both boolean, same value, on every menu item
11. **Run v23 migration in production** — `idempotency_key` column still needs to be applied
12. **Razorpay end-to-end test** — zero real transactions verified

---

## Recent fixes (this session — 2026-06-10)

- `notification.listeners.js` — catering review request now fires on `'confirmed'` (was `'converted'`, silently broken)
- `catalog/config-service.js getItemDetail` — N+1 fixed: 3 parallel queries instead of 1+N
- `ordering/repository.js listPaginated` — orders list now includes `items`, `payment_method`, `table_identifier`
- `leads.js POST` — stripped internal `tier` field from public response
- DB scripts (`reset_db.sh`, `seed_db.sh`, `Makefile`, `docker-compose.yml`) — fixed UTF-16 encoding → UTF-8

---

## Running locally

```bash
# Backend (connects to Railway DB via DATABASE_URL in .env)
cd kravon-engine/backend
npm run dev        # nodemon, port 3000

# Frontend
cd kravon-engine/frontend
npm start          # port 8000, ?slug=royal-tandoor to load a tenant
```

No Docker needed — both services run directly against Railway PostgreSQL.

---

## Style / conventions

- No comments unless WHY is non-obvious
- No TypeScript — plain Node.js throughout
- Thin routes — all business logic in domain services
- Repositories own all SQL — services never write raw queries
- `bustConfigCache(tenantId)` must be called after any catalog or settings write
- Response envelope: `{ ok: true, ... }` for success; `{ error: string }` for failures
