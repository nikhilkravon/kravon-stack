# KRAVON ARCHITECTURE ROADMAP

*Derived from ARCHITECTURE_AUDIT.md — June 2026*
*Horizon: First 100 restaurants. Optimize for correctness, reliability, developer velocity.*

---

## PRIORITIZATION FRAMEWORK

Every finding is classified against three constraints:

- **Production reliability** — will this cause a live incident in the first 100 restaurants?
- **Developer velocity** — will this slow down every future feature?
- **Correctness** — is the system lying about its own state?

Scale is not a constraint at 100 restaurants. Correctness and maintainability are.

---

## FULL FINDING REGISTRY

### F01 — Dual Order Creation Paths

**Audit finding:** Two routes (`POST /orders` and `POST /dine-in/order`) both create `orders.orders` records with separate validation, event logic, and business rules.

**Classification: P0**

**Justification:**
This is not a future problem. It is a present one. Every time a bug is fixed in one order path, the other path silently retains the bug. Every new field on an order (discount logic, loyalty points, tax rule) must be added in two places. The paths will diverge. They are already diverging — the dine-in path has different Zod validation, different event emission, and different customer creation behavior than the online path. At 100 restaurants with mixed dine-in and delivery usage, this produces inconsistent order records and corrupted analytics.

**Engineering effort:** Medium (3–5 days). Extract shared creation logic into `services/order.service.js`. Both routes become thin wrappers calling the same service with a `channel` parameter.

**Architectural impact:** High. Fixes the most critical domain ownership violation. Enables all future order features to be built once.

**Risk if left unchanged:** High. Two code paths maintaining the same domain object is the definition of divergence debt. The first production bug that manifests differently on dine-in vs. delivery will take days to diagnose because there is no single place to look.

---

### F02 — Customer Identity Explosion

**Audit finding:** Customers are created as side effects in four different places with no canonical deduplication. One real customer becomes multiple database records.

**Classification: P0**

**Justification:**
This is a data correctness problem, not a scale problem. At 100 restaurants, if even one restaurant onboards 500 customers through a mix of QR dine-in and online ordering, they have 500–1,500 customer records where 500 should exist. Loyalty points are on the wrong record. CRM shows incomplete history. Analytics double-counts. Every future "smart" feature (personalization, campaigns, loyalty tiers) is built on poisoned data. The longer this runs, the more corrupt the data becomes and the harder it is to clean up.

**Engineering effort:** Small-Medium (2–3 days). Implement `CustomerService.findOrCreate(tenantId, { phone, email })`. Replace the four inline customer creation patterns with a single call. No schema change required.

**Architectural impact:** High. Single most important unlock for CRM, Loyalty, and Insights correctness.

**Risk if left unchanged:** Very High. Data corruption compounds over time. Retroactive deduplication at 10,000 customer records is a manual, error-prone operation. Retroactive deduplication at 1,000,000 records is a project.

---

### F03 — No Idempotency on Order Creation

**Audit finding:** `POST /orders` has no idempotency key. A double-tap or network retry creates two orders and two payment intents.

**Classification: P0**

**Justification:**
This is a production incident waiting to happen on day one at any restaurant with moderate mobile traffic. Slow 4G connections, back-button behavior, and iOS Safari's aggressive request retry behavior all cause duplicate submissions. Two orders = two charges = one furious customer = one chargeback. This is not a scale problem. This is a launch-day problem.

**Engineering effort:** Small (1 day). Accept `Idempotency-Key` header on `POST /orders`. Store key in `orders.orders` with a unique index. Return existing order on duplicate key. Client generates UUID before submission.

**Architectural impact:** Low. Narrow, surgical fix. No structural change.

**Risk if left unchanged:** Very High. First week of live usage at a real restaurant will surface this.

---

### F04 — Payment Webhook Mutates Order Status Directly

**Audit finding:** The Razorpay webhook handler directly updates `orders.orders.payment_status` and advances order status. Payment domain is mutating the Ordering domain.

**Classification: P0**

**Justification:**
The ownership violation is not the problem right now — the atomicity is. If the webhook handler updates `payments.payments` (payment captured) and then the subsequent `orders.orders` status update fails, the system has a payment with no corresponding order advancement. The order is stuck in `pending` indefinitely. The customer was charged. The restaurant never received the order. This is a silent data inconsistency that requires manual intervention to fix and is invisible until a customer complains.

**Engineering effort:** Small (1–2 days). Wrap both updates in a single database transaction. If the transaction fails, the webhook returns a non-200 and Razorpay retries. Idempotent via `payments.payment_events.provider_event_id`.

**Architectural impact:** Low now, foundational later. The transaction fix is the immediate need. The event-driven refactor (Payment emits event, Order reacts) is P2.

**Risk if left unchanged:** High. Silent money-in, no-order-created scenario. Discovered by an angry customer, not by monitoring.

---

### F05 — Split Kitchen (Dine-in Only KDS)

**Audit finding:** `GET /dine-in/kitchen` only returns dine-in orders. Delivery and pickup orders are invisible to the kitchen endpoint.

**Classification: P0**

**Justification:**
Any restaurant taking both dine-in and delivery orders — which is the primary use case for KRAVON's Pro tier — has a broken kitchen workflow on day one. Kitchen staff need to make food. They do not care about the channel. Forcing them to watch two screens (Kitchen view for dine-in, Orders view for delivery) is a workflow failure that will cause missed orders and complaints during the first real service.

**Engineering effort:** Small-Medium (2 days). New `GET /kitchen` endpoint that queries all active orders regardless of channel, with `channel` and `table_identifier` fields in the response. Dashboard Kitchen view updated to call the new endpoint.

**Architectural impact:** Medium. Corrects a fundamental product assumption. Unblocks the KDS as a standalone feature.

**Risk if left unchanged:** Very High. First restaurant deployment will expose this immediately.

---

### F06 — `dine-in.js` Route File Does Too Much

**Audit finding:** Sessions, order creation, kitchen data, reservations, and billing all live in one route file. Four different subdomains, one file.

**Classification: P1**

**Justification:**
This is not causing production failures today but it is killing developer velocity. Every new dine-in feature requires touching a 600-line file with four different concerns. Merge conflicts will appear as soon as a second developer touches it. The file is already on a path to 2,000 lines. At P1 rather than P0 because F01 (order creation unification) will naturally reduce one of the four concerns when implemented, and the remaining split is a clean refactor that can follow.

**Engineering effort:** Small (1–2 days). Pure file split. No logic changes. Extract: `routes/sessions.js`, `routes/kitchen.js`, `routes/dining-orders.js`. Reservations already feels like it belongs in its own file.

**Architectural impact:** Medium. Improves navigability and single-responsibility. Enables kitchen route to evolve independently.

**Risk if left unchanged:** Medium. Developer velocity degrades linearly as the file grows. Not an incident risk.

---

### F07 — `platform.audit_log` Has No Partition Strategy

**Audit finding:** Highest-volume table in the system. No time-based partitioning. Will become unqueryable at scale.

**Classification: P1**

**Justification:**
At 100 restaurants doing a conservative 500 mutations/day, this table grows at 50,000 rows/day. That is 18M rows/year. Postgres handles this fine without partitioning. At 1,000 restaurants it is 180M rows/year. At 10,000 it is 1.8B rows/year. The partitioning strategy needs to be in place before the table is large, because retrofitting partitions onto a populated table requires a rewrite of the table with downtime. P1 because it is not a today problem at 100 restaurants but it is a before-growth problem.

**Engineering effort:** Small (1 day). Add `PARTITION BY RANGE (created_at)` in a migration. Monthly partitions. Create a partition management job.

**Architectural impact:** High at scale, neutral at 100 restaurants. The value is that it is cheap to do now and expensive to do later.

**Risk if left unchanged:** Low now. Critical at 1,000+ restaurants.

---

### F08 — Insights Summary Does Live Queries Against `orders.*`

**Audit finding:** `/insights/summary` likely aggregates live order data on every request rather than querying pre-built `insights.daily_metrics`.

**Classification: P1**

**Justification:**
At 100 restaurants with moderate order volume, this is a slow endpoint (200–500ms) but not a failure. At 1,000 restaurants with concurrent dashboard opens (staff starting their day), this becomes a full-table-scan thundering herd on `orders.*`. P1 because it needs to be fixed before growth, not because it is broken now. The infrastructure (`insights.daily_metrics`) already exists — the aggregation job just needs to be written.

**Engineering effort:** Medium (3–4 days). Write a daily aggregation job (Node.js cron or Postgres scheduled function). Update `/insights/summary` to query `insights.daily_metrics` instead of raw orders. Handle today's partial data by combining pre-aggregated history with a live query for the current day.

**Architectural impact:** High. Changes the insights query from O(orders) to O(days). Enables sub-50ms insights responses at any scale.

**Risk if left unchanged:** Medium now. High at growth stage.

---

### F09 — No Notification Automation (Templates Without Triggers)

**Audit finding:** `platform.notification_templates` exists with `trigger_event` column. Nothing fires the templates. WhatsApp order confirmations, reservation confirmations, and reminders are in the schema but not in the code.

**Classification: P1**

**Justification:**
This is a broken product promise. Any restaurant demo or sales conversation about KRAVON will include "customers get WhatsApp confirmations." The infrastructure exists. The product does not. At 100 restaurants, the absence of automated notifications is a daily complaint driver. P1 rather than P0 because it does not cause data corruption or financial errors — it is a missing feature, not a broken one.

**Engineering effort:** Medium (3–5 days). Implement `NotificationService` that listens for domain events (order created, reservation confirmed) and dispatches templates to the configured channel. Wire WhatsApp Business API or SMS provider.

**Architectural impact:** Medium. Completes the notification infrastructure loop. Unlocks a category of restaurant communication.

**Risk if left unchanged:** Medium. Customer-facing gap. Will surface in first sales conversations.

---

### F10 — Catering Pipeline Has No Operational Handoff

**Audit finding:** When a catering lead converts to "won," no order is created. The sale ends in `catering.*` with no operational consequence.

**Classification: P1**

**Justification:**
The catering module is marketed as a pipeline tool, and as a pipeline tool it works. The gap is that "converted" is a dead end. A restaurant owner who closes a catering event still has to manually track the actual execution. This is acceptable for a v1 but it limits the module's value proposition significantly. P1 because it is a product gap, not a correctness issue.

**Engineering effort:** Medium (2–3 days). On `lead.status = converted`, create a `catering.events` record. Add a UI path from the lead to the event. Eventually link events to orders.

**Architectural impact:** Medium. Completes the catering lifecycle. Sets up the eventual `catering.events → orders.orders` FK.

**Risk if left unchanged:** Low for data integrity. Medium for product value.

---

### F11 — `notifications.notifications` vs `platform.notifications` Naming Collision

**Audit finding:** Two tables with "notifications" in two different schemas serving two different purposes. Will cause bugs as the codebase grows.

**Classification: P1**

**Justification:**
This is a naming clarity issue that becomes a bug source when the team grows or when refactoring touches "notifications" generically. The fix is a migration rename, which is safe and low-risk with proper deployment coordination. P1 because it is cheap to fix and expensive in confusion costs over time.

**Engineering effort:** Small (0.5 days). Schema migration renaming `notifications.notifications` → `notifications.staff_feed`. Update all references.

**Architectural impact:** Low. Pure clarity improvement.

**Risk if left unchanged:** Low now. Grows linearly with codebase size.

---

### F12 — Presence Route Mutates Two Schemas Without Explicit Transaction

**Audit finding:** `PATCH /presence` updates `brand.*` and `tenant.settings` JSONB simultaneously. If the second write fails, partial state is written.

**Classification: P1**

**Justification:**
Partial presence updates are visible to customers (wrong logo + old colors). The fix is wrapping the writes in a transaction, which is small work. P1 rather than P0 because presence changes are infrequent (not a hot path) and partial failures require both a brand write AND a settings write to succeed/fail independently — which is possible but not common.

**Engineering effort:** Small (0.5 days). Wrap `PATCH /presence` handler in `BEGIN/COMMIT`.

**Architectural impact:** Low. Correctness fix.

**Risk if left unchanged:** Low probability, medium consequence when it occurs.

---

### F13 — Reservation Has No Table Assignment or Session Link

**Audit finding:** `dining.reservations` has no FK to `dining.tables` or `dining.sessions`. Confirmed reservations float with no operational grounding.

**Classification: P1**

**Justification:**
For a restaurant actively managing reservations, this forces manual cross-referencing between the reservations view and the tables view. The FK constraints and the "seat now" UX that auto-opens a session are the natural completion of the reservation feature. P1 because reservations work as a tracking tool without this — the gap is operational efficiency, not data corruption.

**Engineering effort:** Medium (2–3 days). Add `table_id` (nullable) to `dining.reservations`. Add `reservation_id` (nullable) to `dining.sessions`. Build "Seat Now" action in the reservations view.

**Architectural impact:** Medium. Completes the reservation → session lifecycle.

**Risk if left unchanged:** Medium. Manual workflow that will frustrate operators in production.

---

### F14 — `inventory.*` Is a Ghost Domain

**Audit finding:** Schema exists, no UI, no API routes, no integration with order creation.

**Classification: P1 (Delete)**

**Justification:**
A ghost domain is worse than no domain. It implies capability that does not exist. Any engineer reading the schema assumes inventory is operational. Any operator who discovers the tables assumes data should be there. The correct move is to delete the schema now, document the feature as roadmap, and rebuild it properly when building it for real.

**Engineering effort:** Small (0.5 days). Migration dropping `inventory.*`. Update schema docs.

**Architectural impact:** Positive. Reduces false surface area.

**Risk if left unchanged:** Low functionally. Medium in developer confusion and operator expectation management.

---

### F15 — Feature Flag Dual System (`has_*` columns + `tenant.feature_flags` table)

**Audit finding:** Boolean columns on `tenant.restaurants` (`has_orders`, `has_tables`, etc.) coexist with a `tenant.feature_flags` table. Route middleware uses the boolean columns. Two systems can drift.

**Classification: P2**

**Justification:**
The boolean columns work correctly today. The drift risk only materializes when someone adds a new feature and uses the wrong system. This is a refactor-when-convenient, not a fix-now. P2 because the current implementation is consistent within itself — the middleware always reads from the boolean columns. The `feature_flags` table may be unused or for a different purpose.

**Engineering effort:** Medium (2 days). Migrate middleware to use `feature_flags` table. Backfill existing tenants. Drop boolean columns.

**Architectural impact:** Medium. Unifies feature gating. Enables self-service module activation in future.

**Risk if left unchanged:** Low. Will become Medium when new features are added.

---

### F16 — `menu.menus` Top-Level Entity Is Orphaned

**Audit finding:** `menu.menus` exists but every query hits `menu.categories` directly. The top-level menu entity is never enforced.

**Classification: P2**

**Justification:**
The current behavior is consistent — every query just bypasses the `menus` level. This only becomes a problem when KRAVON needs to support multiple menus per restaurant (breakfast vs. dinner vs. catering) with different active schedules. The infrastructure (`menu.menu_schedules`) already exists for this. P2 because enforcing the menu layer is a feature (multi-menu support) disguised as a bug fix.

**Engineering effort:** Medium (2–3 days). Update all category queries to filter by `menu_id`. Build menu selection UI. Wire `menu.menu_schedules` to auto-switch active menu.

**Architectural impact:** High when implemented. Enables breakfast/lunch/dinner menus, catering-specific menus, and time-based menu switching.

**Risk if left unchanged:** Low now. Blocks a high-value feature later.

---

### F17 — Config Endpoint Returns Everything

**Audit finding:** `GET /config` is every product's bootstrap payload — brand + full menu + hours + features + tax + payment config in one response.

**Classification: P2**

**Justification:**
At 100 restaurants this is fast because menus are small and the cache handles it. The problem surfaces at 300+ items per restaurant or at cache miss storms. P2 because the cache is working correctly and the endpoint is reliable. The split into `GET /config/brand`, `GET /config/menu`, `GET /config/settings` is an optimization, not a fix.

**Engineering effort:** Large (1 week). Each product must be updated to call multiple endpoints. Cache strategy must be redesigned per resource type.

**Architectural impact:** High at scale. Neutral at 100 restaurants.

**Risk if left unchanged:** Low at 100 restaurants. Medium at 500+.

---

### F18 — Identity Domain Bleeding into Tenant Schema

**Audit finding:** `tenant.staff`, `tenant.roles`, `tenant.permissions` are really an Identity domain but live in `tenant.*`.

**Classification: P2**

**Justification:**
The current schema works correctly. Staff, roles, and permissions are scoped to tenants and the queries are straightforward. The extraction to `identity.*` is an architectural purity improvement that pays off when KRAVON adds SSO, staff shared across locations, or platform-level staff (support agents). None of these are 100-restaurant problems.

**Engineering effort:** Large (1 week+). Schema migration + all query updates.

**Architectural impact:** High long-term. Neutral now.

**Risk if left unchanged:** Low at current scale.

---

### F19 — Event Bus Is External-Only

**Audit finding:** `platform.event_outbox` is used for external webhooks but not for internal domain coordination. Side effects are inline.

**Classification: P2**

**Justification:**
Internal event-driven architecture is the right long-term design. It is not the right immediate design for a solo-developed system at 100 restaurants. The complexity cost (async coordination, ordering guarantees, debugging event chains) exceeds the benefit until the team grows or the number of integration points increases significantly. Inline side effects are synchronous, debuggable, and correct for the current scale.

**Engineering effort:** Large (2+ weeks). Fundamental change to how domains communicate.

**Architectural impact:** Very high. Enables true module independence.

**Risk if left unchanged:** Low at current scale. Medium at team scale.

---

### F20 — No Shared Frontend Design System

**Audit finding:** Five SPAs with no shared CSS or component library. Each reimplements buttons, modals, forms, error states.

**Classification: P2**

**Justification:**
CSS duplication is a real cost but not a production reliability risk. The correct fix (shared design tokens + component library) is a multi-week project that should be done when the product surfaces are stable. P2 because visual inconsistency is a product quality problem, not a correctness or reliability problem.

**Engineering effort:** Large (2–3 weeks). Extract `design-tokens.css`. Build `KravonUI` shared components.

**Architectural impact:** High for product quality and brand consistency.

**Risk if left unchanged:** Low for reliability. High for brand coherence at customer-facing scale.

---

### F21 — Catering → Orders FK Missing

**Audit finding:** `catering.events` has no FK to `orders.orders`. Converted catering has no operational record.

**Classification: P2**

**Justification:**
Related to F10 but this is the schema-level consequence. Until catering events need to produce orders (fulfillment tracking, kitchen coordination), the FK is not needed. P2 because the use case (catering fulfillment through the order system) does not exist yet and building the FK without the feature is premature.

**Engineering effort:** Small schema change. Medium feature work when built.

**Architectural impact:** Medium. Completes the catering lifecycle.

**Risk if left unchanged:** Low. Catering module remains a sales pipeline.

---

### IGNORE LIST

**`tenant.restaurants.settings` JSONB sprawl** — Ignore. JSONB settings are the correct pattern for configuration that evolves. The right fix is documentation of the schema, not structural change. Premature normalization of JSONB config is worse than the JSONB itself.

**No TypeScript** — Ignore. Zod at the boundary + disciplined vanilla JS is working. A TypeScript migration is a large effort with no immediate correctness benefit in a codebase where the primary risk is business logic, not type errors.

**Polling vs. WebSockets** — Ignore. 10s polling is correct at 100 restaurants. WebSockets add infrastructure complexity (connection management, reconnection, pub/sub coordination) that is not justified until latency complaints emerge from real operators.

**GraphQL / API federation** — Ignore. REST is correct for this use case. GraphQL adds tooling complexity with no benefit at this scale.

**`insights.customer_segments` with no segmentation UI** — Ignore. Schema ahead of product. Acceptable.

---

## RANKED IMPLEMENTATION ROADMAP

### TIER 0 — DO BEFORE FIRST RESTAURANT GOES LIVE

| # | Finding | Effort | Why Now |
|---|---|---|---|
| 1 | F03 — Idempotency on order creation | 1 day | First live transaction will expose this |
| 2 | F04 — Atomicity of payment webhook | 1–2 days | Silent money-in/no-order is unrecoverable without manual intervention |
| 3 | F05 — Unified kitchen endpoint | 2 days | Pro tier restaurants will hit this on day one |

### TIER 1 — FIRST SPRINT AFTER LAUNCH

| # | Finding | Effort | Why This Sprint |
|---|---|---|---|
| 4 | F01 — Unified order creation (`OrderService`) | 3–5 days | All other order features depend on this being single-source |
| 5 | F02 — `CustomerService.findOrCreate` | 2–3 days | Every day of delay = more duplicate records to eventually clean |
| 6 | F06 — Split `dine-in.js` route | 1–2 days | Immediate velocity improvement for all dine-in work |

### TIER 2 — BEFORE 25 RESTAURANTS

| # | Finding | Effort | Why Before 25 |
|---|---|---|---|
| 7 | F09 — Notification automation (order + reservation) | 3–5 days | Customer expectation at first sales demo |
| 8 | F12 — Transaction wrap on `PATCH /presence` | 0.5 days | Cheap fix, correctness guarantee |
| 9 | F11 — Rename notification tables | 0.5 days | Cheap, prevents future confusion |
| 10 | F14 — Delete `inventory.*` ghost schema | 0.5 days | Removes false capability surface |
| 11 | F13 — Reservation → table + session link | 2–3 days | Operational efficiency for first restaurants actively using reservations |

### TIER 3 — BEFORE 100 RESTAURANTS

| # | Finding | Effort | Why Before 100 |
|---|---|---|---|
| 12 | F08 — Insights aggregation job | 3–4 days | Endpoint becomes slow at higher order volumes |
| 13 | F07 — `audit_log` partition strategy | 1 day | Do before the table is large |
| 14 | F10 — Catering operational handoff | 2–3 days | Completes the module's value proposition |

### TIER 4 — GROWTH ARCHITECTURE (Post-100)

| # | Finding | Effort |
|---|---|---|
| 15 | F15 — Unify feature flag system | 2 days |
| 16 | F16 — Enforce `menu.menus` entity (multi-menu support) | 2–3 days |
| 17 | F17 — Split `/config` endpoint | 1 week |
| 18 | F19 — Internal event bus | 2+ weeks |
| 19 | F18 — Extract Identity domain | 1 week+ |
| 20 | F20 — Shared frontend design system | 2–3 weeks |

---

## HIGHEST-VALUE ITEM: F01 — UNIFIED ORDER CREATION

*This is the right first refactor. Here is the full case for it.*

---

### WHY F01 AND NOT F03 OR F05

F03 (idempotency) and F04 (payment atomicity) are Tier 0 — they ship before the first restaurant. They are surgical, narrow, and do not require architectural thinking. They are bugs, not design decisions.

F01 is the load-bearing refactor. It is the one that:
- Directly enables F02 (customer identity is resolved in one place)
- Directly enables F09 (notifications fire from one place)
- Makes every future order feature a single implementation
- Ends the most dangerous divergence pattern in the codebase

It is also the refactor with the clearest return on investment.

---

### CURRENT STATE ANALYSIS

**Two code paths create `orders.orders`:**

**Path A** — `routes/orders.js` → `POST /v1/restaurants/:slug/orders`
- Serves: online delivery, pickup
- Validates: Zod `discriminatedUnion` on `order_surface: 'orders'`
- Customer: phone-based `findOrCreate` (inline SQL)
- Events: creates `orders.order_events` entry (inline)
- Notifications: none wired
- Channel: `web`, `qr`, `whatsapp`, `phone`, `pos`
- Payment: Razorpay initiation or COD

**Path B** — `routes/dine-in.js` → `POST /v1/restaurants/:slug/dine-in/order`
- Serves: dine-in QR orders
- Validates: Zod `discriminatedUnion` on `order_surface: 'tables'`
- Customer: guest name + phone (separate inline SQL, possibly different dedup logic)
- Events: creates `orders.order_events` entry (inline, possibly different shape)
- Notifications: none wired
- Channel: always `qr`
- Payment: offline only
- Extra: must validate session exists and is open

**What they share:**
- Both write to `orders.orders`
- Both write to `orders.order_items`
- Both write to `orders.order_item_customizations`
- Both apply tax rules (same logic, duplicated)
- Both should apply loyalty (neither does yet)
- Both should emit the same `order.created` domain event

**What diverges today:**
- Customer creation logic (same intent, different SQL)
- Tax calculation (same logic, different code)
- Event shape (same table, possibly different metadata)
- Coupon validation (online path may have it; dine-in path may not)

**What will diverge tomorrow:**
- Loyalty point earning (must be added to both)
- Inventory deduction (must be added to both)
- Upsell logic (must be added to both)
- Any new discount type (must be added to both)

---

### TARGET ARCHITECTURE

```
routes/orders.js           (online delivery/pickup)
  └─ POST /orders ──────────────────────────────────┐
                                                    ↓
routes/dining-orders.js    (dine-in QR)         OrderService.create({
  └─ POST /dine-in/order ───────────────────────→   tenantId,
                                                    channel,       // 'qr' | 'web' | 'whatsapp'
                                                    fulfillmentType, // 'dine_in' | 'delivery' | 'pickup'
                                                    surface,       // 'tables' | 'orders'
                                                    sessionId,     // only for dine_in
                                                    customer,      // { phone, name, email? }
                                                    items,
                                                    couponCode?,
                                                    specialNotes?,
                                                    paymentMethod,
                                                    deliveryAddress?, // only for delivery
                                                  })
                                                    ↓
                                                    1. Resolve customer (CustomerService)
                                                    2. Validate session if dine_in
                                                    3. Resolve menu items + prices
                                                    4. Apply tax rules
                                                    5. Apply coupon if provided
                                                    6. Create order + items in transaction
                                                    7. Emit OrderCreated event
                                                    8. Return order
```

The route handlers become:

```javascript
// routes/orders.js
router.post('/', requireRestaurantAuth, async (req, res) => {
  const body = OnlineOrderSchema.parse(req.body);
  const order = await OrderService.create({
    tenantId: req.tenant.id,
    channel: body.channel,
    fulfillmentType: body.fulfillment_type,
    surface: 'orders',
    customer: { phone: body.customer_phone, name: body.customer_name },
    items: body.items,
    deliveryAddress: body.delivery_address,
    paymentMethod: body.payment_method,
  });
  res.status(201).json({ order });
});

// routes/dining-orders.js
router.post('/', async (req, res) => {
  const body = DineInOrderSchema.parse(req.body);
  const order = await OrderService.create({
    tenantId: req.tenant.id,
    channel: 'qr',
    fulfillmentType: 'dine_in',
    surface: 'tables',
    sessionId: body.session_id,
    customer: { phone: body.guest_phone, name: body.guest_name },
    items: body.items,
    specialNotes: body.special_notes,
    paymentMethod: 'offline',
  });
  res.status(201).json({ order });
});
```

The service contains all business logic. The routes contain only parsing and HTTP concerns.

---

### MIGRATION PLAN

**Phase 1 — Create the service (no route changes)**
1. Create `services/order.service.js`
2. Extract the online order creation logic into `OrderService.create()`
3. Update `routes/orders.js` to call `OrderService.create()` instead of inline SQL
4. Deploy. Behavior is identical. Online orders now go through the service.
5. Run against staging. Verify order records are identical.

**Phase 2 — Port dine-in orders to the service**
1. Identify all logic in `dine-in.js` POST handler that is order-specific
2. Ensure `OrderService.create()` accepts `sessionId` and handles session validation
3. Update `routes/dine-in.js` POST handler to call `OrderService.create()`
4. Deploy. Behavior is identical. Both paths now go through the service.
5. The two paths now share: customer resolution, tax calculation, event emission, coupon validation.

**Phase 3 — Consolidate and clean**
1. Extract customer creation into `CustomerService.findOrCreate()` (this is F02)
2. Move tax calculation into `TaxService` or a utility called by `OrderService`
3. Verify `order_events` entries are identical shape for both channels
4. Delete duplicated SQL from route handlers

**No database migrations required. No API changes. No frontend changes.**

The migration is entirely internal. The API surface is unchanged. The database schema is unchanged. The only change is that business logic moves from route handlers into a service.

---

### IMPLEMENTATION PLAN

**Day 1 — Scaffold and port online orders**

Create `kravon-engine/backend/services/order.service.js`:

```javascript
// services/order.service.js

const { pool } = require('../db/pool');
const { logAudit } = require('../utils/audit');
const { emitEvent } = require('../utils/events');

async function create(params) {
  const {
    tenantId,
    channel,
    fulfillmentType,
    surface,
    sessionId = null,
    customer,
    items,
    couponCode = null,
    specialNotes = null,
    paymentMethod,
    deliveryAddress = null,
  } = params;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Resolve customer identity (stub for now; F02 will replace)
    const customerId = await resolveCustomer(client, tenantId, customer);

    // 2. Validate session if dine_in
    if (fulfillmentType === 'dine_in') {
      await validateSession(client, tenantId, sessionId);
    }

    // 3. Resolve items, prices, tax
    const { lineItems, subtotal, taxTotal, taxes } = 
      await resolveItemsAndTax(client, tenantId, items);

    // 4. Apply coupon
    const { discountTotal, discountRecord } = couponCode
      ? await applyCoupon(client, tenantId, couponCode, subtotal)
      : { discountTotal: 0, discountRecord: null };

    const total = subtotal + taxTotal - discountTotal;

    // 5. Insert order
    const { rows: [order] } = await client.query(`
      INSERT INTO orders.orders (
        tenant_id, customer_id, session_id, channel, fulfillment_type,
        order_surface, status, payment_method, payment_status,
        subtotal, tax_total, discount_total, total,
        delivery_address, special_notes
      ) VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,'pending',$8,$9,$10,$11,$12,$13)
      RETURNING *
    `, [
      tenantId, customerId, sessionId, channel, fulfillmentType,
      surface, paymentMethod,
      subtotal, taxTotal, discountTotal, total,
      deliveryAddress ? JSON.stringify(deliveryAddress) : null,
      specialNotes,
    ]);

    // 6. Insert line items
    await insertLineItems(client, order.id, lineItems);

    // 7. Insert tax breakdown
    await insertTaxes(client, order.id, taxes);

    // 8. Insert discount record if coupon was applied
    if (discountRecord) {
      await insertDiscount(client, order.id, discountRecord);
    }

    // 9. Emit order created event
    await client.query(`
      INSERT INTO orders.order_events (order_id, tenant_id, event_type, status_to, actor_type)
      VALUES ($1, $2, 'order_created', 'pending', 'customer')
    `, [order.id, tenantId]);

    await client.query('COMMIT');

    emitEvent('order.created', { orderId: order.id, tenantId, channel });

    return order;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { create };
```

**Day 2 — Port dine-in orders, add session validation**

Update `routes/dine-in.js` POST `/order` handler to call `OrderService.create()`. Add session existence check inside the service. Deploy.

**Day 3 — Verify and clean**

Run both order paths in staging. Compare order records. Verify `order_events` shape is consistent. Remove duplicated inline SQL from both route handlers. Add integration test for each path calling the service.

---

### PROOF THE REFACTOR IS WORTH DOING

**Before this refactor:**
- Adding loyalty point earning requires editing two files in two different places
- Adding a new discount type requires editing two files
- A bug in tax calculation exists in two places
- The customer creation logic (F02) cannot be unified without this refactor first
- The notification system (F09) must hook into two different places to fire on order creation
- A developer reading the codebase cannot find "where orders are created" — there are two answers

**After this refactor:**
- Adding loyalty point earning is one change in `order.service.js`
- Adding a new discount type is one change
- Tax calculation bug is fixed once
- F02 (CustomerService) slots directly into step 1 of the service
- F09 (NotificationService) hooks into the single `emitEvent('order.created', ...)` call
- A developer reading the codebase finds "where orders are created" in 10 seconds

**The refactor has zero API surface changes. Zero database changes. Zero frontend changes.**

It is pure internal reorganization with a direct, measurable payoff on the next five features built after it.

The engineering investment is 3 days. The return is every order-related feature thereafter costs half as much to build and carries half the bug surface.

It is the right first move.

---

*Next: after F01 ships, F02 (CustomerService) slots directly in as step 1 of the order service. The two highest-risk findings in the audit resolve as a sequence, not in parallel.*
