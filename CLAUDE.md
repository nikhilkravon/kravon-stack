# Kravon — Engineering Handoff

## 1. Executive Summary

Kravon is a **multi-tenant Restaurant Operating System** sold as SaaS to Indian restaurants.

- **Who uses it:** Restaurant operators (dashboard), their customers (ordering/tables/catering frontends)
- **Architecture:** Node.js/Express modular monolith + vanilla JS frontends + Railway PostgreSQL
- **Multi-tenancy:** Every request resolves a tenant via slug/subdomain → `req.tenant`. All queries are scoped by `tenant_id`.
- **Deployment:** Backend on Railway, frontend on Vercel. Single backend process serves all tenants.
- **Auth:** JWT (15 min) + SHA-256 hashed refresh tokens (30 day) in `tenant.staff_sessions`
- **Scale:** Early production. Real tenants, real orders. One Node process, one Postgres instance.
- **Maturity:** Core platform complete. Operational completeness in progress. Self-serve onboarding is the main remaining market gap.
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

**P0 — Next to build:**
- Kitchen order actions (confirm/ready from kitchen view) — **NEXT**
- Tables auto-refresh (live polling on kitchen + tables views)

**P1 — Next:**
- Self-serve onboarding (sign-up → restaurant creation → first config) — biggest market gap
- Razorpay end-to-end validation

**P2 — Backlog:**
- Founder Command Center (cross-tenant health dashboard)
- Billing ledger + plan upgrades

**Not a priority (founder decision):**
- Reservation ↔ Session linking

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
          dine-in.js              ← QR ordering, kitchen, sessions, bill, bill/render
          settlement.js           ← settlement engine + invoice render
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
        notification.listeners.js ← events → in-app + WhatsApp (generator discriminator comments)
        notification.service.js   ← writes to notifications.notifications
        notify.service.js         ← unified dispatcher: WA / webhook / email (email wired, not yet called)
        bill.renderer.js          ← renderSessionBill() + renderInvoiceSnapshot() → self-contained HTML
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
| `billing.*` | settlements, settlement_lines, payments, invoices, settlement_revisions |
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

**Domain events** — `utils/events.js` (Node EventEmitter). `notification.listeners.js` maps events → channels via generator discriminator comments (`// Bell: ✅  WA: ✅ (owner)`). Outbox is the durable fallback for cross-process delivery.

**Notification channels** — `notify.service.js` is the unified dispatcher. Each exported function documents its channel matrix. Email infra (`integrations/email.js` via Resend) is imported but not yet called from any listener — ready to wire.

**Zod validation** — All write endpoints validate request body before touching the DB. Schema lives in the route file.

**Response envelope** — `{ ok: true, ... }` on success. `{ error: string }` on failure. Never break this convention.

**Paise invariant** — All monetary amounts stored and computed as integer paise. `calc.paise()`, `calc.toRupees()` in `domains/billing/calculator.js`. Never store floats.

**Settlement engine** — `domains/billing/service.js`. Key invariants: `guardEditable()` blocks writes on finalized/voided; `_recalcAndSave()` recomputes totals from lines after every change; `ROLE_CAPS` map controls which staff roles can perform which billing actions; `paid_paise` floored at 0 (refunds cannot push it negative).

**Bill rendering** — `services/bill.renderer.js`. Two functions: `renderSessionBill(bill, restaurant)` for dine-in/live bills; `renderInvoiceSnapshot(snapshot, invoiceNumber, generatedAt)` for finalized settlement invoices. Returns self-contained HTML with inline CSS, print-optimised at 320px (receipt width). No PDF library — browser handles print natively.

---

## 10. Capabilities (Built)

- Multi-tenant backend: all routes, domain services, repositories
- JWT auth + refresh tokens + session revocation + password reset
- Order creation: idempotency, GST calculation, Razorpay integration
- Event outbox: durable delivery with exponential backoff
- Presence/brand editor: transactional, Zod-validated
- Per-tenant rate limiting (orders: 30/min, auth: 10/min)
- In-app notification system (bell feed)
- WhatsApp + webhook dispatch; email infra wired (Resend), not yet called
- Customer CRM + DPDP governance
- Insights / analytics dashboard
- QR dine-in: sessions, unified `/boot` endpoint, kitchen view with action buttons, bill request
- Kitchen view: `tables[]` (dine-in by session) + `queue[]` (delivery/pickup); 10s auto-poll; action buttons (confirm → preparing → ready); bill_requested badge
- Catering lead pipeline with scoring
- Settlement engine: draft → open → finalized → voided; lines, discounts, comps, payments, audit trail, invoice generation
- GST bill render: `GET /dine-in/bill/render?session_id=` and `GET /settlements/:id/invoice/:invoiceId/render` — printable HTML
- Bill History view: expand-to-detail, Print Bill button
- Operator dashboard: 12 views, vanilla JS SPA
- Customer-facing frontends: presence, orders, tables, catering, review
- Staff management: role-based, transactional role changes, audit logged

---

## 11. Known Gaps (Ranked)

1. **Tables auto-refresh** — kitchen and table views poll at 10s but tables *dashboard* view has no live polling
2. **Self-serve onboarding** — no sign-up flow or restaurant creation wizard (biggest market gap)
3. **Razorpay** — webhook handler implemented; no confirmed live end-to-end payment tested
4. **Customers list** — missing `total_spend`, `order_count`, `last_order_at`
5. **`unique_customers` metric** — misleading label (sums daily new acquisitions, not DISTINCT count)
6. **`/config` duplication** — `flatItems` + `categories` return same items twice; `is_customizable` + `customise` are identical booleans
7. **Billing** — no subscription management or plan upgrade flow
8. **Email notifications** — Resend infra wired, no listener calls it yet (order receipt, reservation confirm, catering ack)

---

## 12. Known Operational Gaps

These affect live restaurant workflows:

- **Tables dashboard auto-refresh** — kitchen auto-polls (10s), but the tables view in the dashboard requires manual reload
- **Razorpay production validation** — webhook handler implemented; no confirmed live payment flow tested end-to-end
- **Email channel** — infra exists (`integrations/email.js`, Resend), imported in `notify.service.js`, but no listener calls it

---

## 13. Local Dev

```bash
# Backend — connects to Railway DB via DATABASE_URL in .env
cd kravon-engine/backend && npm run dev    # nodemon, port 3000

# Frontend
cd kravon-engine/frontend && npm start     # port 8000, ?slug=royal-tandoor
```

No Docker. Both services run directly against Railway PostgreSQL.
