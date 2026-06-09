# Kravon — Engineering Handoff

## 1. Executive Summary

Kravon is a **multi-tenant Restaurant Operating System** sold as SaaS to Indian restaurants.

- **Who uses it:** Restaurant operators (dashboard), their customers (ordering/tables/catering frontends)
- **Architecture:** Node.js/Express modular monolith + vanilla JS frontends + Railway PostgreSQL
- **Multi-tenancy:** Every request resolves a tenant via slug/subdomain → `req.tenant`. All queries are scoped by `tenant_id`.
- **Deployment:** Backend on Railway, frontend on Vercel. Single backend process serves all tenants.
- **Auth:** JWT (15 min) + SHA-256 hashed refresh tokens (30 day) in `tenant.staff_sessions`
- **Scale:** Early production. Real tenants, real orders. One Node process, one Postgres instance.
- **Maturity:** Core platform complete. Working on operational completeness and self-serve onboarding.
- **Built by:** Solo founder (Nikhil). Pragmatic, fast, production-focused.

---

## 2. Product Philosophy

Kravon is a **Restaurant Operating System** — not a POS, not a website builder, not a food marketplace.

**Core principle: one order engine, many contexts.**

Delivery, Pickup, QR Dine-In, and Catering are different *contexts* of the same order flow — not separate systems. They share `orders.orders`, `orders.order_items`, and the same order creation pipeline.

- **Tables provide context.** A table session groups dine-in orders. It doesn't replace the order.
- **Orders drive commerce.** All revenue, all fulfilment, all notifications flow through `orders.orders`.
- **Plans gate features.** A restaurant's plan determines which products they can access. Feature flags (`has_orders`, `has_tables`, `has_catering`, `has_insights`) enforce this at the API layer.

---

## 3. Founder Context

Solo-built. Recommend the **smallest change that solves the problem.**

- Speed over perfection
- Production readiness over elegance
- Extend existing patterns before introducing new ones
- Do not add abstractions unless they eliminate duplication across 3+ callsites

---

## 4. Architectural Constraints

**Do not recommend unless explicitly asked:**

- Microservices or service extraction
- Kubernetes or container orchestration
- React, Next.js, or any JS framework rewrite
- TypeScript migration
- ORM (Prisma, Drizzle, Sequelize)
- Replacing PostgreSQL
- Replacing the in-process event bus with an external queue (Kafka, RabbitMQ, SQS)

Current scale does not justify any of these. The existing stack handles the load and is well-understood by the founder.

---

## 5. Platform Model

```
tenant.restaurants
  └── plan: starter | growth | pro | enterprise
  └── has_orders | has_tables | has_catering | has_insights  (feature flags)
```

| Plan | Unlocks |
|------|---------|
| Starter | Presence website + WhatsApp ordering |
| Growth | Razorpay payments + order dashboard |
| Pro | QR tables + dine-in kitchen |
| Enterprise | Analytics + staff accounts |

Feature gates are enforced in `server.js` via `requireFeature('has_tables')` before the route handler runs. **This is a hard architectural boundary — never bypass it.**

---

## 6. Current Priorities

**P0 — In progress, unblock first:**
- Kitchen order actions (confirm/ready from kitchen view)
- Tables auto-refresh (live polling on dashboard)
- Reservation ↔ Session linking
- GST bill generation

**P1 — Next:**
- Founder Command Center (cross-tenant health dashboard)
- Usage analytics per tenant
- Tenant health monitoring

**P2 — Backlog:**
- Self-serve onboarding (sign-up → restaurant creation → first config)
- Billing ledger + plan upgrades

**Do not introduce new modules unless explicitly requested.**

---

## 7. Repo Structure

```
kravon-stack/
  kravon-engine/
    backend/
      server.js                   ← entry point, all route mounts, feature gates
      api/
        middleware/
          tenant.js               ← resolveRestaurant → req.tenant
          auth.js                 ← requireRestaurantAuth (reads req.auth.tenantId)
          feature.js              ← requireFeature('has_tables') etc.
        routes/                   ← thin handlers, delegate to domain services
          config.js               ← GET /config (public) + bustConfigCache()
          orders.js               ← create + list + detail + status update
          dine-in.js              ← QR ordering, kitchen, sessions, bill
          leads.js                ← catering pipeline
          presence.js             ← brand/content editor
          insights.js             ← analytics dashboard
          [auth|menu|tables|staff|customers|settings|notifications|reviews|webhooks|admin].js
      domains/                    ← all business logic lives here
        catalog/                  ← menu items, categories, customizations
        catering/                 ← lead pipeline, scoring
        customer/                 ← CRM, DPDP governance
        dining/                   ← sessions, kitchen, reservations
        identity/                 ← auth repository
        intelligence/             ← analytics queries
        notifications/            ← in-app notifications
        ordering/                 ← order creation, outbox enqueue
        presence/                 ← brand content editor
        tenancy/                  ← restaurant settings
      services/
        notification.listeners.js ← events → in-app + WhatsApp
        notification.service.js   ← writes to notifications.notifications
        notify.service.js         ← WhatsApp / webhook dispatch
        outbox.poller.js          ← polls event_outbox every 5s
      db/
        pool.js                   ← query(), getClient()
        migrate.js                ← applies kravon_schema_v20.sql
        migrations/               ← v20–v23, run in order
        seeds/                    ← royal-tandoor, dead-flat-co test tenants
      jobs/
        aggregate-daily-metrics.js
    frontend/
      dashboard/                  ← operator SPA (12 views, vanilla JS)
      presence/                   ← restaurant landing page
      orders/                     ← delivery ordering
      tables/                     ← QR dine-in
      catering/                   ← lead capture form
      review/                     ← post-order review
      shared/js/
        item-controls.js          ← makeRenderer(cfg) — shared add/qty buttons
        cart.js                   ← KravonCart engine
        kravon.js                 ← scroll reveal, toast, utilities
      server.js                   ← static file server + env var injection
    docs/
      frontend-backend-audit.md   ← full API exposure audit
```

---

## 8. Database

Multi-schema PostgreSQL (v20). All queries scoped by `tenant_id`.

| Schema | Key tables |
|--------|-----------|
| `tenant.*` | restaurants, staff, roles, staff_sessions, locations |
| `menu.*` | menus, categories, menu_items, item_variants, customization_groups, customization_options |
| `orders.*` | orders, order_items |
| `dining.*` | sessions, tables, reservations, reviews |
| `brand.*` | assets, contact_links, announcements |
| `catering.*` | leads, events |
| `customer.*` | customers, data_requests |
| `notifications.*` | notifications |
| `platform.*` | event_outbox, schema_migrations, audit_log, export_jobs |

**`orders.orders` critical columns:**
- `channel` — `web | qr | whatsapp | phone | pos`
- `fulfillment_type` — `delivery | pickup | dine_in | catering`
- `status` — `pending | confirmed | preparing | ready | out_for_delivery | delivered | completed | cancelled | refunded`
- `metadata` JSONB — holds `customer_name`, `customer_phone`, `payment_method`, `table_identifier`, `gst` snapshot

**`tenant.restaurants`:**
- `plan` VARCHAR(20): `starter | growth | pro | enterprise`
- `has_orders`, `has_tables`, `has_catering`, `has_insights` — feature flag booleans
- `settings` JSONB — operational config (hours, delivery fees, GST, Razorpay key, etc.)

---

## 9. Key Engineering Patterns

**Tenant resolution** — `resolveRestaurant` middleware populates `req.tenant` (tenant_id, slug, settings, feature flags). Every restaurant-scoped route depends on it.

**Config cache** — In-memory Map, 60s TTL. Call `bustConfigCache(tenantId)` after any catalog, presence, or settings write. Import from `api/routes/config.js`.

**Transactions** — `getClient()` from `db/pool.js`. Always: `BEGIN` → work → `COMMIT`, with `ROLLBACK` in catch and `client.release()` in finally.

**Event outbox** — Enqueue into `platform.event_outbox` *inside the same transaction* as the domain write (`domains/ordering/outbox.js`). `outbox.poller.js` delivers with `SELECT FOR UPDATE SKIP LOCKED` every 5s. Durable — survives process restart.

**Domain events** — `utils/events.js` (Node EventEmitter). `notification.listeners.js` maps events → in-app notifications + WhatsApp. Immediate, in-process. Outbox is the durable fallback for cross-process delivery.

**Zod validation** — All write endpoints validate request body before touching the DB. Schema lives in the route file.

**Response envelope** — `{ ok: true, ... }` on success. `{ error: string }` on failure. Never break this convention.

---

## 10. Capabilities (Built)

- Multi-tenant backend: all routes, domain services, repositories
- JWT auth + refresh tokens + session revocation + password reset
- Order creation: idempotency, GST calculation, Razorpay integration
- Event outbox: durable delivery with exponential backoff
- Presence/brand editor: transactional, Zod-validated
- Per-tenant rate limiting (orders: 30/min, auth: 10/min)
- In-app notification system (bell feed)
- WhatsApp + webhook dispatch
- Customer CRM + DPDP governance
- Insights / analytics dashboard
- QR dine-in: sessions, kitchen view, bill request
- Catering lead pipeline with scoring
- Operator dashboard: 12 views, vanilla JS SPA
- Customer-facing frontends: presence, orders, tables, catering, review

---

## 11. Known Gaps (Ranked)

1. **Kitchen actions** — staff can view queue but cannot confirm/ready orders from kitchen UI
2. **Tables auto-refresh** — dashboard table view requires manual refresh
3. **Reservation ↔ Session** — no link between a reservation and the dining session it becomes
4. **GST bill generation** — snapshot stored in metadata but no bill render endpoint
5. **QR boot** — `GET /dine-in/session?table_id=` needs to return `{ status, session, orders }` in one call (currently 2 sequential calls)
6. **Customers list** — missing `total_spend`, `order_count`, `last_order_at`
7. **Kitchen `bill_requested`** — flag not surfaced in kitchen view
8. **Settings cache bust** — `PATCH /settings/restaurant` and `/notifications` don't call `bustConfigCache`
9. **`unique_customers` metric** — misleading label (sums daily new acquisitions, not DISTINCT count)
10. **`/config` duplication** — `flatItems` + `categories` return same items twice; `is_customizable` + `customise` are identical booleans
11. **Self-serve onboarding** — no sign-up flow or restaurant creation wizard
12. **Billing** — no subscription management or plan upgrade flow
13. **Razorpay** — zero real transactions verified end-to-end

---

## 12. Known Operational Gaps

These affect live restaurant workflows and influence many future decisions:

- **Kitchen status updates** — orders confirmed/readied via dashboard only, not from kitchen screen
- **Tables auto-refresh** — kitchen and table views require manual reload; no live polling
- **Reservation → Session workflow** — reservations exist but don't automatically open a dining session
- **Bill generation** — GST snapshot is stored in `orders.orders.metadata` but there is no `/bill` endpoint that renders it
- **Razorpay production validation** — webhook handler is implemented; no confirmed live payment flow tested

---

## 13. Local Dev

```bash
# Backend — connects to Railway DB via DATABASE_URL in .env
cd kravon-engine/backend && npm run dev    # nodemon, port 3000

# Frontend
cd kravon-engine/frontend && npm start     # port 8000, ?slug=royal-tandoor
```

No Docker. Both services run directly against Railway PostgreSQL.
