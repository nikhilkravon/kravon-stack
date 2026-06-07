# KRAVON GOD MODE ARCHITECTURE REVIEW

*June 2026 — Platform Audit*

---

## PHASE 1 — DOMAIN MODEL TRUTH

### Canonical Domain Map

**DOMAIN: TENANT**
- **Owns:** Identity, plan, feature flags, subscription, integrations config, API keys, billing periods
- **Never owns:** Menu content, order history, customer data, operational state
- **Consumed by:** Every domain (tenant_id is universal FK)
- **Mutated by:** Admin, Settings, Auth
- **Verdict:** Clean. This is the root. It is correct.

**DOMAIN: IDENTITY / AUTH**
- **Owns:** Staff credentials, JWT sessions, OAuth identities, permissions, roles
- **Never owns:** Business logic, tenant configuration, or operational permissions (it should only say *who*, not *what they can do*)
- **Consumed by:** Every admin endpoint
- **Mutated by:** Auth routes, Staff management
- **Verdict:** Fragile. Roles and permissions live in `tenant.*` but auth lives in `auth.js` middleware. There is no clean boundary. `tenant.staff`, `tenant.roles`, `tenant.permissions` are really an **Identity** domain bleeding into **Tenant**.

**DOMAIN: BRAND**
- **Owns:** Logos, colors, themes, SEO metadata, announcement banners, contact links
- **Never owns:** Menu content, operational hours, pricing, presence *layout* decisions
- **Consumed by:** Presence (renders brand), Orders (header/theme), Tables (header/theme)
- **Mutated by:** Personalisation view
- **Verdict:** Schema is correct. But `brand.*` tables and `settings.presence` JSONB are split ownership of the same concept. Presence content lives partly in `brand.*` and partly in `tenant.restaurants.settings` JSONB. **This is duplicated ownership.**

**DOMAIN: PRESENCE**
- **Owns:** Which content surfaces are shown, in what order, with what content
- **Never owns:** Brand assets (those belong to Brand), menu data (that belongs to Menu), hours (those belong to Tenant)
- **Consumed by:** Presence SPA, Orders SPA (borrows brand header)
- **Mutated by:** Personalisation view
- **Verdict:** Presence is not a domain. It is a **surface**. It has no tables of its own (it reads from `brand.*` and `tenant.settings`). The `presence.js` route is a thin aggregator pretending to be a domain. This creates a hidden dependency where PATCH /presence mutates two schemas simultaneously with no transaction boundary visible to the caller.

**DOMAIN: MENU**
- **Owns:** Items, variants, customizations, combos, availability schedules, surface visibility
- **Never owns:** Pricing rules for specific channels (that is a pricing domain), order history, inventory counts
- **Consumed by:** Presence, Orders, Tables, Catering, Kitchen, Insights
- **Mutated by:** Menu view (dashboard)
- **Verdict:** Structurally sound. But `menu.menus` (the logical menu collection) is underused. Every query hits `menu.categories` directly without going through `menu.menus`. The top-level menu entity is orphaned — it exists in schema, is never meaningfully enforced in routing.

**DOMAIN: ORDERING**
- **Owns:** Order lifecycle, line items, applied discounts, taxes, fulfillment state, delivery jobs
- **Never owns:** Payment state (should be Payment domain), session state (should be Dining), customer identity
- **Consumed by:** Kitchen, Insights, Customers, Orders view, Tables view
- **Mutated by:** Orders route, Dine-in route, Webhooks route
- **Verdict:** Critically overloaded. The `orders.*` schema is correct. The problem is that `dine-in.js` route creates orders inside a dine-in session context but there is no domain service coordinating this. The order is created by the dine-in route, not the order route. **Two different code paths create the same domain object.** This is duplicated ownership in the mutation layer.

**DOMAIN: PAYMENT**
- **Owns:** Payment method, gateway transaction, amount captured, refund state
- **Never owns:** Order state (it should notify Ordering that payment occurred; it should not advance order status directly)
- **Consumed by:** Ordering, Insights
- **Mutated by:** Webhooks (Razorpay), Order creation
- **Verdict:** Correct schema. But the Razorpay webhook at `webhooks.js` directly mutates `orders.orders.payment_status`. Payment is mutating Ordering. This is an ownership violation. Payment should emit an event; Ordering should react.

**DOMAIN: DINING**
- **Owns:** Physical tables, active sessions, reservations, waitlist
- **Never owns:** Order content (that is Ordering), payment collection (that is Payment), customer identity (that is Customer)
- **Consumed by:** Kitchen, Orders view, Tables view, Insights
- **Mutated by:** Dine-in route, Tables route
- **Verdict:** Mostly clean, but `dine-in.js` route does too much. It handles session management AND order creation AND reservation management AND kitchen data AND billing. These are four different subdomain concerns inside one route file. At scale, this becomes unmaintainable.

**DOMAIN: CUSTOMER**
- **Owns:** Identity (phone, email), preferences, consent, loyalty, address book, interaction log
- **Never owns:** Order history (Ordering owns that; Customer may *read* it), session history (Dining owns that)
- **Consumed by:** Orders, Reservations, Catering, Notifications, Insights
- **Mutated by:** Customers route, implicit creation during order/reservation/lead
- **Verdict:** The **implicit creation problem**. Customers are created as side effects in four different places: order creation, dine-in session, reservation creation, lead submission. There is no `CustomerService.findOrCreate()`. There is no canonical identity resolution. Each surface creates its own customer record with its own data quality. At scale, one real customer becomes four database records.

**DOMAIN: CATERING**
- **Owns:** Sales pipeline (leads → events → quotes → contracts), packages, multi-day events
- **Never owns:** Ordering (catering orders should flow through the order domain), regular menu items
- **Consumed by:** Catering view, Insights
- **Mutated by:** Leads route
- **Verdict:** Catering is a sales pipeline masquerading as a fulfillment domain. It has no connection to `orders.*` — when a catering event converts, it does not create an order. **This is an orphaned ownership.** The lifecycle ends at "converted" with no operational handoff.

**DOMAIN: KITCHEN**
- **Owns:** Nothing. Kitchen Display System is a *view* of order state.
- **Never owns:** Order state (it should only read and react)
- **Consumed by:** Kitchen view
- **Mutated by:** Kitchen view (status updates flow back to Ordering)
- **Verdict:** Kitchen is not a domain. It is a **projection**. Its data comes from `orders.*` filtered by `dining.*` context. It has no schema. This is architecturally correct — but the kitchen route lives inside `dine-in.js`, which means Kitchen is bound to dine-in only. Kitchen should serve all order types (dine-in AND delivery AND pickup).

**DOMAIN: INSIGHTS**
- **Owns:** Aggregated metrics, item performance, customer segments, review summaries
- **Never owns:** Raw operational data (it should consume events, not join live tables)
- **Consumed by:** Insights view, Overview view
- **Mutated by:** Background aggregation jobs (implied but not visible in the codebase)
- **Verdict:** Architecture is correct in intent but incomplete in execution. `insights.daily_metrics` exists but there is no visible aggregation job that populates it. The current `/insights/summary` endpoint appears to calculate metrics on-demand by querying `orders.*` live. **At 10,000 tenants, this is a full-table-scan time bomb.**

**DOMAIN: NOTIFICATIONS**
- **Owns:** Staff in-app feed, outbound comms queue
- **Never owns:** Business logic that triggers them
- **Consumed by:** Every domain (triggered on order creation, reservation changes, etc.)
- **Mutated by:** Platform notifications queue
- **Verdict:** Split schema identity. `notifications.notifications` is the staff in-app feed. `platform.notifications` is the outbound comms queue. Two tables for notifications in two different schemas. This will confuse every engineer who touches it. **Hidden naming collision.**

**DOMAIN: INVENTORY**
- **Owns:** Stock levels, movement ledger
- **Never owns:** Menu availability (that is Menu's concern), order fulfillment
- **Consumed by:** Menu (availability check), Ordering (stock deduction)
- **Mutated by:** Inventory management (no UI exists yet)
- **Verdict:** Schema exists (`inventory.items`, `inventory.movements`, `inventory.stock_levels` view). No UI. No API routes. No integration with order creation (no stock check on order). **This is a ghost domain** — it exists in the database but has zero operational effect. It is technical debt masquerading as a feature.

---

### Domain Ownership Violations Summary

| Violation | Severity |
|---|---|
| Dine-in route creates orders (Ordering's job) | HIGH |
| Razorpay webhook mutates order status directly (Payment → Ordering ownership violation) | HIGH |
| Customer identity created in 4 different places with no canonical service | HIGH |
| Presence mutates brand.* AND tenant.settings simultaneously with no single owner | MEDIUM |
| Kitchen is bound to dine-in only; delivery orders are invisible to kitchen | HIGH |
| Catering converts to "converted" but never creates an order | MEDIUM |
| Inventory schema has zero operational coupling | MEDIUM |
| `notifications.notifications` and `platform.notifications` are conceptually identical | MEDIUM |
| `menu.menus` top-level entity is structurally present but never enforced in routing | LOW |

---

## PHASE 2 — STATE FLOW TRUTH

### Online Ordering Flow

```
Current:
Customer → GET /config → Renders menu
→ POST /orders (creates order, attempts payment intent)
→ If Razorpay: redirect to hosted checkout
→ Razorpay calls POST /webhooks/razorpay
→ Webhook directly sets orders.payment_status + order status
→ Dashboard polls GET /orders every 10s, sees new order
→ Staff accepts → PATCH /orders/:id {status: 'accepted'}
→ Staff marks ready → PATCH /orders/:id {status: 'ready'}
→ Delivery dispatched → delivery_jobs record created
→ Order completes
```

**Problems:**
1. No idempotency key on order creation. Double-tap submit creates two orders.
2. Razorpay webhook writes payment state AND advances order state in one transaction. If the order status update fails after payment is recorded, order is paid but stuck in `pending`.
3. `order_events` audit trail exists but nothing reads it. Status history is invisible in the dashboard.
4. Customer is created as a side effect of `POST /orders` with no deduplication. Phone number lookup may find the wrong customer if two tenants share a customer phone (they shouldn't, but the query needs to be explicit about `tenant_id`).
5. Polling at 10s means a 0-10s delay before staff sees a new order. At a busy restaurant, this is acceptable. At 100 simultaneous orders, polling creates 100 × N concurrent DB queries.

**Ideal:**
```
POST /orders → validate → create order (status: pending_payment)
→ emit OrderCreated event
→ Payment service handles Razorpay
→ On PaymentCaptured event → Order service advances to confirmed
→ WebSocket pushes to dashboard immediately
→ Staff sees order within 500ms
```

### Dine-In Ordering Flow

```
Current:
Guest scans QR → GET /config → See menu
→ POST /dine-in/session/open (or reuse existing session)
→ Guest enters name + phone
→ POST /dine-in/order (creates order linked to session)
→ Kitchen polls GET /dine-in/kitchen every 10s
→ Staff marks item ready → order progresses
→ Guest requests bill → POST /dine-in/session/request-bill
→ Staff closes session → POST /dine-in/session/close
→ Payment collected offline
```

**Problems:**
1. Session open uses `FOR UPDATE` row lock — correct for preventing race conditions but creates a serialization bottleneck at peak. Every simultaneous table scan waits on the lock.
2. Session total is calculated at close by summing orders. If an order is later disputed, the total is wrong retroactively.
3. No multi-payment support. One session = one bill = one payment. Split bills are impossible.
4. The guest phone number collected at order time is stored on the order but may not be linked to an existing customer record. Same person, two dine-in visits → two unconnected customer records.
5. `dine-in/kitchen` only shows dine-in orders. Delivery/pickup orders from the same kitchen are in a different view. **The kitchen is split across two views.**
6. Session status and order status are separate state machines with no explicit synchronization. A session can be "open" while all its orders are "delivered". What does "open session, all delivered orders" mean to staff? Undefined.

**Ideal:**
```
Session is a container. Orders are events within the session.
Session states: open → billing_requested → closed
Order states within session: placed → acknowledged → preparing → ready → served
Kitchen sees ALL orders regardless of channel, grouped by station/table
Session close triggers: snapshot total, lock session, accept payment(s), optionally split
```

### Reservation Lifecycle

```
Current:
Guest submits reservation form
→ POST /dine-in/reservations
→ Status: pending → confirmed → seated → completed | no_show | cancelled
→ Staff manages via Reservations view in dashboard
→ No automated reminders
→ No table assignment at booking time
→ No deposit enforcement at booking time (deposit_amount field exists, not enforced)
```

**Problems:**
1. Reservation has no link to a `dining.tables` record. You can confirm a reservation without knowing which table will seat them. Seating is a manual lookup.
2. Deposit amount is stored but there is no payment flow attached. It is a field with no operational weight.
3. No automated confirmation notification. The `platform.notification_templates` table exists with `trigger_event` column — but no trigger fires on reservation creation.
4. Reservation → Session transition is manual. Staff must manually open a session for the reserved party. The reservation record never becomes a session automatically.

**Ideal:**
```
Reservation created → notification_template triggered → guest gets WhatsApp/SMS confirmation
→ Day-of: automated reminder
→ At seating time: one-click "seat now" → opens session linked to reservation
→ Reservation.session_id populated automatically
→ No-show timer: if not seated within N minutes, auto-flag
```

### Customer Lifecycle

```
Current:
Customer is created implicitly when:
- order is placed (by phone number lookup + create)
- dine-in session is opened (guest name + phone)
- reservation is made (guest name + phone)
- catering lead is submitted (name + phone + email)

No canonical identity resolution.
No merge of duplicate records.
No lifecycle events emitted.
```

**This is the single biggest hidden risk in the entire platform.**

At 1,000 tenants × 1,000 customers each = 1,000,000 customer records. With duplicate creation, real number could be 2-4M. Loyalty points calculated on the wrong record. CRM shows incomplete order history. Analytics double-counts customers.

**Ideal:**
```
CustomerIdentity is resolved at every entry point:
findOrCreate(tenantId, {phone, email}) → single canonical customer_id
All domains reference this customer_id
Identity merging: when same phone appears with different email, flag for merge
Customer profile shows ALL interactions: orders + sessions + reservations + leads
```

### Kitchen Lifecycle

```
Current:
Kitchen view polls GET /dine-in/kitchen every 10s
Sees: orders grouped by table, with items and status
Kitchen view ONLY shows dine-in orders
Orders view shows delivery/pickup orders separately
```

**The kitchen is split.** A restaurant with two chefs — one making dine-in food, one making delivery food — both need the same KDS. Currently, they need two separate screens showing two separate views.

**Ideal:**
```
Kitchen sees ALL active orders regardless of channel
Orders tagged by: channel (dine-in/delivery/pickup) + priority + table (if applicable)
Items grouped by station (configurable per menu item)
Single source of truth for what the kitchen needs to make
```

---

## PHASE 3 — DASHBOARD TRUTH

### Current Group Structure

```
Operations: Overview, Orders, Kitchen, Tables, Reservations
Customers & Sales: Customers, Insights, Catering
Digital Experience: Menu, Personalisation
Administration: Staff, Settings, Notifications
```

### What Is Wrong

**Operations group is correct in spirit but wrong in membership.**
- Kitchen belongs to Operations ✓
- Tables belongs to Operations ✓
- Reservations belongs to Operations ✓
- Orders belongs to Operations ✓
- Overview belongs to Operations ✓
- But: "Overview" is not an operation. It is a **home screen**. It should be ungrouped, above all groups.

**"Digital Experience" is a product category, not an operational group.**
- Menu is an operational entity (what you sell) — it affects orders, kitchen, and pricing
- Personalisation is a branding function
- These should not share a group. Menu belongs closer to Operations. Personalisation belongs in Administration.

**"Customers & Sales" conflates three different intents:**
- Customers = CRM (relationship tool)
- Insights = Analytics (read-only intelligence)
- Catering = Pipeline (active sales process)
These have completely different jobs. Grouping them implies they are similar. They are not.

**"Administration" is a dumping ground.**
- Staff = Team management ✓
- Settings = Configuration ✓
- Notifications = Real-time feed ← this does not belong in Administration

### The Dashboard That Should Exist

```
HOME (always visible, ungrouped)
  → Dashboard (Overview / live stats)

SERVE (everything happening right now)
  → Kitchen (all active orders, all channels)
  → Tables (floor map + session state)
  → Orders (delivery/pickup queue)
  → Reservations (today's book)

SELL (things you configure to drive revenue)
  → Menu (items, variants, pricing, availability)
  → Catering (lead pipeline)
  → Coupons & Promotions (currently missing as a view)

KNOW (intelligence and relationships)
  → Customers (CRM)
  → Insights (analytics)
  → Reviews (currently missing as a view)

BUILD (your restaurant's identity)
  → Presence (website + branding)
  → Announcements (time-sensitive banners)

MANAGE (operations config)
  → Staff
  → Settings
  → Integrations (currently buried in Settings)
  → Plan & Billing (currently missing as a view)
```

**Views that should exist but don't:**
- Coupons & Promotions view (schema exists: `orders.coupons`)
- Reviews view (schema exists: `dining.reviews`, `customer.feedback`)
- Inventory view (schema exists: `inventory.*`)
- Integrations view (currently buried in Settings)
- Plan & Billing view (usage_ledger, subscriptions exist)
- Notifications config (templates exist: `platform.notification_templates`)

**Views that are pretending to be domains:**
- Kitchen is a view pretending to be a domain (it has a route file but no schema)
- Presence is a view pretending to be a domain (it aggregates from brand.* + settings)
- Notifications in the nav is a feed, not a management interface

**Domains pretending to be views:**
- Settings is actually three domains: Operational Config, Integration Config, Plan Config
- Personalisation is actually Brand + Presence merged into one screen

---

## PHASE 4 — PLATFORM TRUTH

### What KRAVON Actually Is

KRAVON is trying to be a **Restaurant Operating System** but the current build prioritizes the **Presence** and **Ordering** surfaces. The Operations layer (Kitchen, Tables, Sessions) is real but underpowered. The Intelligence layer (Insights) is real but thin. The Platform layer (Inventory, Notifications, Webhooks) is real but invisible to operators.

**The honest capability map:**

| Layer | Current State | Verdict |
|---|---|---|
| Presence (website) | Full | Overbuilt relative to other layers |
| Online Ordering | Full | Production-ready |
| Dine-in Ordering | Full | Production-ready |
| Catering Pipeline | Partial | Sales only, no fulfillment |
| Kitchen Display | Partial | Dine-in only |
| Table Management | Full | Production-ready |
| Reservations | Partial | Manual, no automation |
| Customer CRM | Thin | List + history, no segmentation UI |
| Loyalty | Schema only | Zero UI, zero operational coupling |
| Insights | Thin | 30-day KPIs, no drill-down |
| Notifications | Infrastructure only | Templates exist, triggers missing |
| Inventory | Schema only | Ghost feature |
| Staff & Permissions | Partial | CRUD exists, permission UI missing |
| Webhooks | Infrastructure only | No UI to manage |
| Billing | Infrastructure only | Ledger exists, no self-service |

### Platform Primitives vs Products vs Modules

**Platform Primitives** (reusable infrastructure, always on):
- Tenant resolution + isolation
- Auth + RBAC
- Audit logging
- Event outbox + webhooks
- Notification infrastructure
- Usage metering + billing
- DPDP compliance tooling

**Products** (distinct customer-facing surfaces):
- Presence (public website)
- Orders (delivery/pickup)
- Tables (dine-in QR)
- Catering (lead form)
- Dashboard (operator console)

**Modules** (optional operational features, plan-gated):
- Kitchen Display System
- Reservations
- Loyalty
- Insights / Analytics
- Inventory
- Coupons & Promotions
- Staff & RBAC
- Catering Pipeline (the sales side)

**What should be feature flags** (not plan tiers):
- GST configuration
- Multi-location
- Custom domain
- Announcement banners
- Combo meals
- Split bill

**What should be a plan tier gate:**
- Insights (data intelligence = premium)
- Inventory (operations sophistication = premium)
- Loyalty (customer retention = premium)
- Webhooks (developer access = enterprise)
- Staff RBAC (team management = pro+)

---

## PHASE 5 — DATABASE TRUTH

### Entities That Are Correct

- `tenant.restaurants` — root is clean
- `orders.orders` + `orders.order_items` + `orders.order_item_customizations` — normalized correctly
- `customer.consent_history` — append-only, correct for compliance
- `platform.event_outbox` — transactional outbox is the right pattern
- `platform.audit_log` — comprehensive, correct design
- `payments.payment_events` — dedup via provider_event_id is correct

### Entities That Are Overloaded

**`tenant.restaurants`** will become a dumping ground.
Currently holds: name, slug, plan, feature flags (`has_orders`, `has_tables`, `has_catering`, `has_insights`), settings JSONB, plus implicitly everything else via tenant_id.
The `settings` JSONB column on `tenant.restaurants` is a black hole. Every new config option goes into it with no schema enforcement. At v20, how many keys live in that JSONB? Nobody knows without querying every record.

**`platform.notifications`** (outbound) vs `notifications.notifications` (in-app).
Two schemas, conceptually identical. Staff sees one. Platform handles the other. The naming alone will cause bugs in 18 months when someone adds a feature touching "notifications" and touches the wrong table.

**`menu.menu_items`** has `food_type` for FSSAI compliance AND `surfaces[]` for channel visibility AND `is_available` for operational state AND `sort_order` for display. This is four different concerns on one entity. At scale, availability management and surface management will need their own query patterns and their conflation on one row creates update anomalies.

### Relationships That Are Weak

**`catering.events` has no FK to `orders.orders`.**
A confirmed catering event cannot produce an order. The schema does not model the relationship that must eventually exist.

**`dining.reservations` has no FK to `dining.tables`.**
You cannot enforce that a confirmed reservation has a table assigned.

**`dining.reservations` has no FK to `dining.sessions`.**
The transition from reservation to active session is invisible in the data model.

**`insights.daily_metrics` has no FK to any entity.**
The `metric_type` is an enum, but `breakdown` is free-form JSONB. This table will become a catch-all with inconsistent shapes per metric_type.

### Data That Should Be Derived

- `dining.sessions.total_billed` — should be computed from `orders.order_items` at close time, not stored
- `insights.item_performance` — should be a materialized view, not a table with stale data
- `insights.review_summary` — should be a view over `customer.feedback`
- `inventory.stock_levels` — already a view, correct

### Data That Will Become Bottlenecks

**`platform.audit_log`** at 10,000 tenants × average 1,000 mutations/day = **10,000,000 rows/day**. No partition strategy is visible. This table needs time-based partitioning on `created_at` immediately or it becomes unqueryable within 12 months.

**`orders.order_events`** — same problem. Every status transition appends a row. At 10,000 tenants × 200 orders/day × 5 events/order = **10,000,000 rows/day**.

**`insights.events`** — event stream table with no visible partition strategy.

**`customer.interaction_log`** — every menu view, every order, every visit appends a row. At scale this is the largest table in the database with no clear retention policy.

### Tables That Will Become Dumping Grounds

- `tenant.restaurants.settings` (JSONB) — already happening
- `insights.daily_metrics.breakdown` (JSONB) — will happen
- `customer.customers.tags[]` (array) — acceptable now, becomes a problem when you need to query "all customers with tag X" at scale

---

## PHASE 6 — API TRUTH

### Leaky Abstractions

**The `/config` endpoint does too much.**
`GET /v1/restaurants/:slug/config` returns: brand, menu (all items + categories + variants + customizations), hours, features, plan tier, tax settings, payment config.

This is every product's bootstrap payload in one request. It is fast for five products. At 50 products, it becomes a N-second cold start. The menu alone at a restaurant with 200 items and 20 customization groups could be 500KB of JSON.

At 10,000 tenants with a cache miss storm (e.g., after a deploy), this endpoint will bring the database to its knees.

**`PATCH /presence` mutates two schemas.**
The presence route updates `brand.*` tables AND `tenant.restaurants.settings.presence` JSONB in a single request. The caller cannot know which schema changed. If one mutation fails mid-transaction, the caller gets a 500 with partial state written (if not wrapped in an explicit transaction).

**`dine-in.js` owns four different subdomains.**
Session management, order creation, kitchen data, reservation management, and billing all live in one route file. This is a 600-line file that will become a 2,000-line file. It needs to be split into: `sessions.js`, `reservations.js` (already separate in dashboard but not in routes), `kitchen.js`, `dine-in-orders.js`.

### Endpoint Ownership Violations

**Orders are created by two routes:**
- `POST /v1/restaurants/:slug/orders` — online/delivery orders
- `POST /v1/restaurants/:slug/dine-in/order` — dine-in orders

Both create `orders.orders` records. The order domain has two entry points with different validation logic, different event emission, and different business rules. At scale, divergence between the two paths is inevitable.

**Kitchen data is served by dine-in route:**
`GET /v1/restaurants/:slug/dine-in/kitchen` — but the kitchen should see ALL orders. Delivery orders are invisible to this endpoint.

### Missing Service Boundaries

**No OrderService** — order creation logic is inline in the route handlers. When order creation logic needs to change (new discount type, new fulfillment mode), you change the route, not a service.

**No CustomerService** — customer identity resolution is inline in every route that touches a customer. `findOrCreate` logic is duplicated.

**No NotificationService** — notification triggers are ad-hoc. There is no service that says "on this event, send this template to this recipient." Templates exist in the database but nothing orchestrates them.

**No PaymentService** — payment initiation lives in the order creation route. Payment completion lives in the webhook route. These are two halves of the same service with no shared abstraction.

### The API Architecture That Should Exist

```
/v1/restaurants/:slug/
  # Core
  config         → ConfigService (split: public config vs full config)

  # Ordering (unified)
  orders/        → OrderService (all channels through one entry point)

  # Dining (split by subdomain)
  sessions/      → SessionService
  reservations/  → ReservationService
  tables/        → TableService
  kitchen/       → KitchenService (read-only projection, all channels)

  # Menu
  menu/          → MenuService

  # Customers
  customers/     → CustomerService (with identity resolution)

  # Commerce
  payments/      → PaymentService
  coupons/       → CouponService

  # Catering
  catering/
    leads/       → CateringService
    events/      → EventService
    quotes/      → QuoteService

  # Intelligence
  insights/      → InsightsService

  # Platform
  notifications/ → NotificationService
  webhooks/      → WebhookService
  staff/         → StaffService
  settings/      → SettingsService
  presence/      → PresenceService (reads from Brand + Tenant, never writes to two places)
```

### Event-Driven Opportunities

The `platform.event_outbox` exists. The `platform.events` table exists. These are the right primitives. But the event-driven pattern is only used for external webhooks, not for internal domain coordination.

**What should be event-driven internally:**

| Event | Consumers |
|---|---|
| `order.created` | NotificationService, InsightsService, KitchenService |
| `order.status_changed` | NotificationService, CustomerService (interaction log) |
| `payment.captured` | OrderService (advance status), InsightsService |
| `session.closed` | InsightsService, CustomerService (loyalty calculation) |
| `reservation.confirmed` | NotificationService (confirmation SMS/WhatsApp) |
| `lead.converted` | CateringService (create event), NotificationService |
| `customer.created` | NotificationService (welcome message) |

Currently all of these are inline side effects in route handlers. Extracting them to events makes each route handler responsible for one thing and makes the side effects auditable, testable, and composable.

---

## PHASE 7 — EXPERIENCE TRUTH

### Are We Building Five Separate Frontends?

Yes. And that is partially correct and partially a problem.

**What is correct about five SPAs:**
- Each surface serves a different user with a different device, context, and session length
- Guest on mobile (Tables, Orders) needs a fast, minimal, offline-resilient experience
- Owner on desktop (Dashboard) needs data density and keyboard efficiency
- These are genuinely different UX profiles that should not share a component library forced through the same constraints

**What is wrong about five SPAs:**
- `kravon-api.js` is shared, but CSS is not. Every surface reimplements button styles, form styles, modal patterns from scratch. This is not five products — this is five divergent implementations of the same design system.
- Brand theming (logo, colors) is fetched from the same config but applied differently in each product. When a restaurant changes their primary color, the five surfaces apply it inconsistently because each has its own CSS variable mapping.
- Error states, loading skeletons, and empty states are reimplemented in every view in every product.

### The Canonical Model

**Brand** → defines the design tokens (colors, fonts, logo)
**Experience** → defines the surface (Presence, Orders, Tables, Catering)
**Surface** → consumes Brand tokens, renders Product content
**Product** → Menu, Orders, Reservations — the actual business objects
**Module** → optional capabilities layered on a Product

```
Brand Layer:     primary_color, secondary_color, font, logo, name
                    ↓ applied to
Experience Layer: Presence Surface, Orders Surface, Tables Surface, Catering Surface
                    ↓ renders
Product Layer:    Menu, Cart, Checkout, Lead Form
                    ↓ optionally enhanced by
Module Layer:     Loyalty display, Reviews, Coupons, Upsells
```

**Today**, Brand Layer is applied inconsistently per surface.
**Today**, there is no Module Layer — capabilities are hardcoded per surface.
**Today**, there is no Experience abstraction — Presence is both a surface definition and a content management system.

The correct evolution:
1. Extract a `design-tokens.css` driven by brand config — shared across all surfaces
2. Build a `KravonUI` component library (web components or vanilla JS custom elements) for: Button, Card, Modal, Input, Toast, Skeleton — shared across all surfaces
3. Presence becomes a content configuration tool, not a product of its own
4. Each surface becomes a thin shell that: loads brand tokens, mounts the appropriate product modules, handles auth context

---

## PHASE 8 — SHOPIFY TEST

### If KRAVON Becomes "Shopify for Restaurants"

**Theme = Brand + Surface Template**
Currently: brand config is stored but not themeable. You cannot choose a "Presence theme." You get one layout with configurable content.
Missing: theme system with multiple presence layouts, color scheme variants, font pairings. This is a 6-month build.

**Block = Content Section**
Currently: Presence has 10 hardcoded sections (Hero, Story, Gallery, etc.). These cannot be reordered, hidden individually (beyond emptying their content), or duplicated.
Missing: block-based page builder where each section is an independent block with its own config. This is the core of Shopify's page editor.

**Module = Optional Operational Capability**
Currently: capabilities are boolean flags on `tenant.restaurants` (has_orders, has_tables, etc.). Installing a "module" means an engineer changes a database row.
Missing: self-service module activation, onboarding flow per module, per-module billing.

**App = Third-Party Integration**
Currently: integrations are hardcoded in `tenant.integrations` (Razorpay, delivery providers). There is no concept of a third-party app.
Missing: public API surface, OAuth for third parties, app marketplace concept. This is a 12-month build.

**Product = What Customers Buy**
Currently: four plan tiers with fixed capability bundles (Starter, Growth, Pro, Enterprise).
Missing: à la carte module activation. Shopify's power comes from letting merchants build their exact stack.

**Platform Capability = What Everything Is Built On**
KRAVON already has the right platform primitives: tenant isolation, event outbox, webhook delivery, audit logging, usage metering, DPDP compliance. These are genuine platform-grade capabilities that Shopify also has.

### What Is Missing for the Shopify Test

| Shopify Concept | KRAVON Equivalent | Status |
|---|---|---|
| Themes | Presence templates | Missing |
| Page builder | Block-based content sections | Missing |
| App store | Third-party integrations | Missing |
| Checkout extensions | Order flow customization | Missing |
| Metafields | Custom attributes on any entity | Partially (tags[], metadata JSONB) |
| Storefront API | Public read API for menu/config | Exists (but not documented/versioned) |
| Admin API | Full REST API for third parties | Exists (but no API key UI, no docs) |
| Flow (automation) | Notification triggers | Infrastructure only |
| Markets (multi-region) | Multi-location | Schema exists, UI thin |
| Analytics | Insights | Thin |

### What Is Overbuilt Relative to Shopify Stage

Nothing is truly overbuilt. The `platform.audit_log`, `customer.consent_history`, DPDP tooling — these are ahead of what most early-stage platforms build. They are correct forward bets.

### What Is Underbuilt Relative to Shopify Stage

- Self-service onboarding (no sign-up flow visible in codebase)
- Theme/template system
- Notification automation (triggers exist in schema but nothing fires them)
- Loyalty program UI (schema is complete, zero product surface)
- The public API as a documented, versioned product

---

## PHASE 9 — FOUNDER VERDICT

### 1. What Stays Exactly As It Is

- Multi-tenant isolation pattern (tenant_id everywhere, middleware enforcement)
- JWT auth + HttpOnly cookie refresh pattern
- Transactional outbox (`platform.event_outbox`) — this is the right architecture
- Audit log (`platform.audit_log`) — this is correct; just needs partitioning
- Zod discriminated union validation on order creation — elegant
- Config cache with per-tenant 60s TTL — correct for the scale
- AES-256 encryption of integration secrets at rest
- Soft deletes everywhere
- `customer.consent_history` append-only design
- `payments.payment_events` deduplication via `provider_event_id`
- `FOR UPDATE` lock on session open — correct for preventing race conditions
- DPDP compliance infrastructure — ahead of its time, keep it

### 2. What Gets Refactored Immediately

**Order creation unification.** One `OrderService` that handles all channels. The `POST /orders` and `POST /dine-in/order` routes become thin wrappers that both call `OrderService.create(params, context)`. Channel is a parameter, not a code path bifurcation.

**CustomerService identity resolution.** One `CustomerService.findOrCreate(tenantId, identifiers)` called by every route that touches a customer. Phone-based deduplication happens in one place. No more four separate customer creation paths.

**`dine-in.js` route split.** Extract `sessions.js`, `kitchen.js` (unified), `dine-in-orders.js`. Leave `reservations.js` (already philosophically separate).

**Kitchen endpoint unification.** `GET /kitchen` should query all active orders regardless of channel, with a `channel` field on each order for the UI to differentiate.

**`notifications.notifications` vs `platform.notifications` rename.** Rename `notifications.notifications` to `notifications.staff_feed`. Rename `platform.notifications` to `notifications.outbound`. Move both under one schema: `notifications.*`.

**`menu.menus` enforcement.** Every menu query should go through the logical menu entity. This is already in the schema — it just needs to be wired into the routing layer.

**Insights aggregation job.** The `/insights/summary` endpoint should query `insights.daily_metrics` (pre-aggregated), not live `orders.*`. Add a daily aggregation job that populates `insights.daily_metrics`. This changes the query from O(all orders) to O(1).

**`platform.audit_log` partitioning.** Add `PARTITION BY RANGE (created_at)` — monthly partitions. Do this before the table has more than 1M rows.

### 3. What Gets Deleted

**`has_orders`, `has_tables`, `has_catering`, `has_insights` boolean columns on `tenant.restaurants`.** Replace with a proper feature flag lookup: `SELECT feature_key FROM tenant.feature_flags WHERE tenant_id = $1 AND is_enabled = true`. The boolean columns are already partially replaced by `tenant.feature_flags` table but the route middleware uses the boolean columns. This creates two feature gate systems that can drift.

**`inventory.*` schema in its entirety** (for now). A ghost domain that does nothing creates false confidence and maintenance overhead. Remove it, document it as "roadmap Q3," and reintroduce it when building it for real.

**The `/presence` route** as a distinct concept. Merge presence management into `/brand` and `/settings`. Presence is not a domain.

### 4. What Gets Renamed

| Current | Rename To | Why |
|---|---|---|
| `notifications.notifications` | `notifications.staff_feed` | Avoid collision with outbound |
| `platform.notifications` | `notifications.outbound` | Consolidate under one schema |
| `dine-in.js` route | Split into `sessions.js` + `kitchen.js` + `dining-orders.js` | Single responsibility |
| `presence.js` route | Merge into `brand.js` | Presence is not a domain |
| `Personalisation` view in dashboard | `Presence` | The view already is the presence editor |
| `has_orders/has_tables` columns | Feature flag keys | Canonical feature gate system |

### 5. What Gets Extracted Into Domains

**Identity Domain** — Extract `tenant.staff` + `tenant.roles` + `tenant.permissions` into an `identity.*` schema. Auth and RBAC are platform primitives, not tenant configuration.

**Commerce Domain** — Extract `orders.coupons` + discount logic into a `commerce.*` domain. Pricing rules, coupons, and promotions are their own domain that Ordering consumes.

**Communications Domain** — Extract `platform.notification_templates` + `platform.notifications` + `notifications.notifications` into a unified `comms.*` domain with clear subtables: `comms.templates`, `comms.outbound`, `comms.staff_feed`, `comms.engagement`.

### 6. What Gets Consolidated

**All order creation** through `OrderService`.
**All customer creation** through `CustomerService`.
**All notification triggers** through `NotificationService`.
**All event emission** through `EventService` (already partially exists).
**Plan feature gates** through a single `FeatureService` (eliminate boolean columns).

### 7. What Becomes a Platform Capability

- Event bus (outbox + events) — already exists, needs to be used internally
- Notification delivery (templates + rendering + multi-channel dispatch)
- Usage metering + billing
- DPDP compliance tooling
- API key management
- Webhook delivery

### 8. What Becomes a Future Module

- Loyalty program (schema exists; build the product)
- Inventory management (delete schema, rebuild properly)
- Advanced CRM (customer segmentation, campaigns)
- Notification automation (trigger rules builder)
- Multi-location management
- Third-party app integrations
- Staff scheduling
- Payroll integration

---

## CRITICAL RISKS

**Risk 1 — Dual Order Creation Paths**
Two routes create `orders.orders` records with different validation, different event emission, and different business rules. This will diverge over time. One path will get a bug fix or feature that the other doesn't. By the time you notice, the two paths are incompatible.

**Risk 2 — Customer Identity Explosion**
Four creation paths with no deduplication = multiple records per real customer. Loyalty points, CRM history, analytics segments, and personalization are all poisoned by duplicate identity. This gets worse with every new integration that creates customers as a side effect.

**Risk 3 — insights.daily_metrics is Not Populated**
The analytics infrastructure exists but if `/insights/summary` is doing live queries, every Insights page load is a full-table aggregation on `orders.*`. At 10,000 tenants this is catastrophic. Verify this immediately.

**Risk 4 — platform.audit_log Will Explode**
No partition strategy on the highest-volume table in the system. This is a 12-month time bomb. Postgres does not auto-partition; you must do it before the table is large.

**Risk 5 — Config Endpoint is a Single Point of Failure**
Every product cold-starts from one endpoint that JOINs across `brand.*`, `menu.*`, `tenant.*`. A slow restaurant with 300 menu items will make this endpoint slow for everyone. Cache miss storms (deploys, server restarts) will hammer the database.

**Risk 6 — No Notification Automation**
`platform.notification_templates` exists with `trigger_event` column. Templates are defined. Nothing fires them. Restaurants expect: "order placed → customer gets WhatsApp confirmation." This is in the schema. It is not in the code. This is a broken product promise waiting to be discovered.

**Risk 7 — Catering Pipeline Has No Operational Handoff**
A catering lead converted to "won" produces no order, no kitchen task, no operational record. The sale closes in `catering.*`. Nothing happens next in the system. The catering workflow ends at the sale and the operator is on their own for fulfillment.

**Risk 8 — Split Kitchen**
The kitchen display only shows dine-in orders. A restaurant doing 40% delivery and 60% dine-in has kitchen staff watching two screens. This is a UX failure that will surface immediately in a real restaurant deployment.

**Risk 9 — Inventory is a Ghost Feature**
The inventory schema is real and complete. If an operator is demo'd the system and sees `inventory.*` tables or any reference to inventory management, they expect it to work. It does nothing. Ghost features destroy trust faster than missing features.

**Risk 10 — No Idempotency on Order Creation**
A user with a slow connection who double-taps "Place Order" creates two orders and two payment intents. This is a production incident on day one at a busy restaurant. Idempotency keys on `POST /orders` are not optional.

---

## HIDDEN GEMS

**Gem 1 — Transactional Outbox**
Most early-stage platforms skip this. You have it. It means external webhooks are reliable and retryable. It means payment events are not lost. This is a platform-grade pattern usually only seen in mature systems.

**Gem 2 — DPDP Compliance Infrastructure**
`customer.consent_history`, `platform.customer_data_requests`, `platform.export_jobs` — you built the India data privacy compliance layer before being forced to. This will become mandatory. You are ahead.

**Gem 3 — Discriminated Union Order Validation**
Using Zod `discriminatedUnion` on `order_surface` means the type system enforces that dine-in orders cannot have delivery addresses and delivery orders cannot be placed without one. This is not obvious to implement and is exactly right.

**Gem 4 — FOR UPDATE Lock on Session Open**
Prevents double-occupancy races where two phones scanning the same QR code simultaneously would create two sessions for the same table. This is a subtle concurrency bug that most developers would miss and discover in production at 2am.

**Gem 5 — Platform.schema_migrations Tracking**
You track your own migration history in the database. Fresh installs self-describe their version state. This is how you survive schema version divergence across multiple environments.

**Gem 6 — AES-256 Encryption of Integration Secrets**
Payment gateway keys are encrypted at rest in the database, not stored in environment variables or config files. This means a database dump does not expose customer payment credentials. Correct security posture.

**Gem 7 — Menu Surface Visibility Array**
`menu.categories.surfaces[]` allows the same menu to power dine-in, delivery, pickup, and catering with different item sets. This is architecturally clean. The same menu entity powers four different product surfaces through a single column. This is elegant.

**Gem 8 — Soft Deletes Everywhere**
No hard deletes. Every deletion is `deleted_at = NOW()`. Audit log is never corrupted by missing records. Historical order data references items that still exist. This is operationally correct for a system that handles financial records.

**Gem 9 — Per-Tenant Config Cache with Explicit Invalidation**
The cache is busted immediately on any PATCH to config or presence. This means operators see their changes immediately without waiting for TTL expiry. The 60s TTL only catches cases where the cache was never busted (which should not happen in normal operation). The design is correct.

**Gem 10 — Modular Dashboard View Pattern**
Each dashboard view is a self-contained IIFE with its own state, polling, and cleanup. When a view unmounts (hash route change), the MutationObserver detects it and stops the polling interval. This prevents memory leaks and runaway network requests in a long-lived SPA with no framework. This is disciplined vanilla JS architecture that most framework-free codebases get wrong.

---

## NORTH STAR ARCHITECTURE

```
┌──────────────────────────────────────────────────────────────────────┐
│                         KRAVON PLATFORM                               │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                     PLATFORM PRIMITIVES                          │ │
│  │  Identity · Tenancy · Events · Webhooks · Comms · Billing · DPDP│ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                              ↕                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │
│  │    DOMAIN    │  │    DOMAIN    │  │         DOMAIN            │   │
│  │   SERVICES   │  │   SERVICES   │  │        SERVICES           │   │
│  │              │  │              │  │                           │   │
│  │ OrderService │  │ MenuService  │  │  CustomerService          │   │
│  │ SessionSvc   │  │ CouponSvc    │  │  NotificationService      │   │
│  │ PaymentSvc   │  │ InventorySvc │  │  InsightsService          │   │
│  │ KitchenSvc   │  │              │  │                           │   │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘   │
│                              ↕                                        │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                         REST API LAYER                           │ │
│  │   Thin route handlers · Zod validation · Auth middleware         │ │
│  │   One route = one service method. No business logic in routes.   │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                              ↕                                        │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │                      EVENT BUS (internal)                         │ │
│  │   OrderCreated · PaymentCaptured · SessionClosed · LeadConverted  │ │
│  │   All domain side effects triggered by events, not inline code    │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
                              ↕
┌──────────────────────────────────────────────────────────────────────┐
│                         PRODUCT SURFACES                               │
│                                                                       │
│  Presence (website) · Orders (delivery) · Tables (QR dine-in)         │
│  Catering (lead form) · Dashboard (operator console)                  │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                     SHARED DESIGN SYSTEM                         │ │
│  │  Brand tokens (colors/fonts/logo) · KravonUI components          │ │
│  │  Applied consistently across all five surfaces                   │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
                              ↕
┌──────────────────────────────────────────────────────────────────────┐
│                         DATABASE LAYER                                │
│                                                                       │
│  identity.* · tenant.* · brand.* · menu.* · orders.* · payments.*   │
│  dining.* · customer.* · catering.* · comms.* · insights.* · inv.*  │
│                                                                       │
│  Partitioned: audit_log · order_events · interaction_log · events    │
│  Materialized: daily_metrics · item_performance · review_summary     │
└──────────────────────────────────────────────────────────────────────┘
```

### The Three Moves That Unlock Scale

**Move 1: Unify order creation.**
One service. All channels. This is the load-bearing beam of the entire platform. Every other domain consumes orders. If order creation is coherent, everything downstream becomes coherent.

**Move 2: Resolve customer identity.**
One canonical customer per tenant per phone number. This unlocks loyalty, CRM, personalization, analytics — every "smart restaurant" capability depends on knowing who the customer is. Without this, you are building intelligence on top of noise.

**Move 3: Make the event bus internal.**
Use the transactional outbox you already built for internal domain coordination, not just external webhooks. When `OrderCreated` triggers `NotificationService`, `InsightsService`, and `LoyaltyService` through the event bus instead of inline calls, every domain becomes independently deployable, independently testable, and independently scalable.

These three moves do not require a rewrite. They require discipline. The architecture already contains the seeds of all three. The platform is one refactoring cycle away from being genuinely production-grade at scale.

---

*The foundation is strong. The walls are straight. The load-bearing structure is sound. What you are fighting is the natural entropy of a solo build — concepts that started clean and drifted slightly as features were added. The drift is reversible. The foundation is not.*
