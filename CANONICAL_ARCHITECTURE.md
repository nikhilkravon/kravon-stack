# KRAVON CANONICAL ARCHITECTURE

*Greenfield design. Existing implementation is reference, not constraint.*
*Horizon: 2 years. First 100 restaurants. Built to survive 10,000.*

---

## THESIS

KRAVON is not ordering software.
KRAVON is not a website builder.
KRAVON is not a POS.

KRAVON is the operating system for an independent restaurant.

An operating system has three layers:

1. **Kernel** — Platform primitives that everything else runs on
2. **System services** — Shared capabilities that any module can call
3. **Applications** — The products operators and customers use

Everything in KRAVON maps to one of these three layers.
Nothing should exist outside them.

---

## PART 1 — WHAT IS A DOMAIN?

A domain owns a concept exclusively.

The test: if you deleted this domain, what breaks?

- Delete **Menu** → you cannot sell anything. Everything breaks.
- Delete **Ordering** → you cannot transact. Revenue stops.
- Delete **Identity** → nobody can log in or be identified.
- Delete **Kitchen** → nothing breaks in the data. Kitchen is a view.
- Delete **Presence** → the public website disappears. Orders still work.
- Delete **Catering** → the sales pipeline disappears. Core ops continue.

The domains are the things that, if deleted, break other things.
Views and products can be deleted without breaking other domains.

---

## PART 2 — CANONICAL DOMAINS

There are exactly **nine domains** in KRAVON.

```
┌─────────────────────────────────────────────────────────────────────┐
│  1. TENANT       The restaurant as a business entity                 │
│  2. IDENTITY     Who is acting — staff, customers, systems           │
│  3. CATALOG      What the restaurant sells                           │
│  4. ORDERING     The act of transacting                              │
│  5. PAYMENT      The exchange of money                               │
│  6. DINING       The physical experience of being in the restaurant  │
│  7. CUSTOMER     The people who buy                                  │
│  8. CATERING     The pipeline for events and large bookings          │
│  9. INTELLIGENCE The understanding of what has happened              │
└─────────────────────────────────────────────────────────────────────┘
```

Everything else — Kitchen, Presence, Insights views, Notifications, Inventory — is either a **Product**, a **View**, a **Platform Service**, or a **Module** built on top of these nine.

---

## PART 3 — CANONICAL ENTITIES

### DOMAIN 1: TENANT

The restaurant as a legal and operational business entity.

**Entities:**
- `Restaurant` — root entity. Slug, name, plan tier, timezone, currency, locale, status
- `Location` — physical address(es). One restaurant may have multiple locations.
- `Plan` — subscription tier. Defines which modules are accessible.
- `FeatureFlag` — per-tenant capability toggles. Overrides plan defaults.
- `Integration` — third-party connection. Razorpay, delivery providers, WhatsApp. Credentials encrypted.
- `Domain` — custom domain mapping. `table.restaurantname.com → kravon.app/restaurantname`
- `Settings` — operational configuration. Tax, fees, hours, ordering rules, currency format.
- `UsageEvent` — metered action record. Orders placed, SMS sent, exports run.
- `UsageLedger` — billing period snapshot.

**What Tenant owns:** The root of the tree. Every other entity references a `tenant_id`.

**What Tenant never owns:** Menu content, order history, customer profiles. Those are owned by their respective domains. Tenant only owns the business configuration that wraps them.

---

### DOMAIN 2: IDENTITY

Who is acting on or within the system.

**Entities:**
- `Staff` — team member record. Name, email, role, auth credentials, status.
- `Role` — named permission bundle. `admin`, `manager`, `kitchen`, `cashier`, or custom.
- `Permission` — atomic capability key. `orders.read`, `menu.write`, `insights.read`.
- `Session` — auth session. JWT lineage, refresh token, issued/revoked timestamps. (Auth session — distinct from dining session.)
- `ApiKey` — machine identity. Hash, permissions scope, revoked state.
- `OAuthIdentity` — external provider link. Google, Apple.

**What Identity owns:** Authentication, authorization, and the definition of what actions are permitted.

**What Identity never owns:** What those actions do. Identity says "this staff member can write to menu." Menu enforces what a valid menu write looks like.

**Note:** Identity currently lives in `tenant.*`. It should be its own domain. Staff belong to tenants but identity management is a platform primitive, not a tenant configuration concern.

---

### DOMAIN 3: CATALOG

What the restaurant offers for sale. The single source of truth for every surface that shows menu items.

**Entities:**
- `Menu` — a logical grouping of offerings. A restaurant may have multiple: Main, Breakfast, Catering, Seasonal. Has a `type` and a lifecycle (active, archived, draft).
- `Category` — a grouping within a menu. Starters, Mains, Desserts.
- `Item` — a sellable unit. Name, description, base price, food type, dietary tags, images.
- `Variant` — a size or type option for an item. Half / Full. Regular / Large. Priced separately.
- `CustomizationGroup` — a set of add-on choices attached to an item. "Choose your spice level." Required or optional, single or multi-select.
- `CustomizationOption` — a single choice within a group. Mild / Medium / Hot. With price modifier.
- `Combo` — a bundle of items sold together. Contains `ComboSlot` entries defining which items are eligible per slot.
- `AvailabilityRule` — when an item is available. Day of week, time range. Overrides default availability.
- `MenuSchedule` — when a whole menu is active. Breakfast menu 7–11am. Dinner menu 5pm–close.
- `SurfaceVisibility` — which channels an item or category appears on. `dine_in`, `delivery`, `pickup`, `catering`.

**What Catalog owns:** The definition of every sellable unit, its price, its modifiers, and its availability. No channel-specific pricing exists yet — that is a future Commerce domain concern.

**What Catalog never owns:** Order history, inventory levels, or which items are currently in stock. Catalog defines what can be sold. Inventory (a future module) defines what is available to sell right now.

---

### DOMAIN 4: ORDERING

The act of transacting. An order is the canonical record of a commercial intent.

**Entities:**
- `Order` — root entity. Channel, fulfillment type, status, surface, timestamps.
- `OrderItem` — a line item. References Catalog item, records the price at time of order (denormalized — critical for historical accuracy).
- `OrderItemCustomization` — a selected add-on. References group and option, records price modifier at time of order.
- `OrderTax` — tax breakdown applied to the order.
- `OrderDiscount` — a discount applied. References Commerce.Coupon if applicable.
- `OrderEvent` — immutable audit log of every status transition. Who changed it, from what, to what, when.
- `DeliveryJob` — fulfillment tracking for delivery orders. Provider, tracking ID, status.

**What Ordering owns:** The full lifecycle of a commercial transaction from placement to completion. Ordering is the source of truth for revenue.

**What Ordering never owns:** Payment state (that is Payment), session context (that is Dining), or customer identity (that is Customer). Ordering holds references — `customer_id`, `session_id`, `payment_id` — but does not own those entities.

**The order status machine:**
```
pending_payment → confirmed → accepted → preparing → ready → completed
                          ↘ cancelled
                                         ↘ failed
```

For dine-in: `placed → acknowledged → preparing → ready → served`
For delivery: `confirmed → accepted → preparing → ready → dispatched → delivered`

One state machine. Channel determines which transitions are valid.

---

### DOMAIN 5: PAYMENT

The exchange of money.

**Entities:**
- `Payment` — a payment attempt. Amount, method (UPI/card/cash/wallet), gateway, status, timestamps.
- `PaymentEvent` — gateway webhook record. Provider event ID (for idempotency), raw payload, processed flag.
- `Refund` — a refund record. Amount, reason, initiator, status.

**What Payment owns:** The financial transaction layer. Whether money moved, how much, and through what mechanism.

**What Payment never owns:** What the money was for. Payment holds an `order_id` reference. Ordering owns what the order contained. These must not cross.

**The critical boundary:** When Razorpay confirms a payment, Payment domain records the capture. Payment then emits `payment.captured`. Ordering listens and advances the order status. Payment never directly writes to `orders.orders`.

---

### DOMAIN 6: DINING

The physical experience of being in the restaurant.

**Entities:**
- `Table` — a physical table. Number, capacity, floor, zone, QR code reference, status.
- `DiningSession` — an active table occupancy. Links table to orders. Opened when guests sit, closed when they leave.
- `Reservation` — a future booking. Guest, party size, time, table assignment, deposit, status.
- `Waitlist` — a queue entry. Party waiting for a table. Quoted wait, notified timestamp, seated timestamp.
- `Review` — post-meal feedback. Food, service, ambience ratings. Published or private.

**What Dining owns:** The physical-world state of the restaurant. Tables, who is sitting at them, who has booked them, who is waiting for them.

**What Dining never owns:** The orders placed during a session (Ordering owns those). The payment collected at the end (Payment owns that). The customer who sat down (Customer owns them).

**The dining session** is a container that coordinates between Ordering, Payment, and Customer — but it does not own any of those domains' entities.

---

### DOMAIN 7: CUSTOMER

The people who transact with the restaurant.

**Entities:**
- `Customer` — the canonical identity. One record per phone number per tenant. Name, phone (verified), email, dietary preferences, tags.
- `CustomerAddress` — a saved delivery location. Geocoded, labelled, default flag.
- `LoyaltyAccount` — points balance and tier. Bronze/Silver/Gold/Platinum. One per customer per tenant.
- `LoyaltyTransaction` — immutable ledger of point movements. Earn, redeem, expire, adjust, bonus, refund.
- `ConsentRecord` — DPDP-compliant consent log. Channel, granted, source, timestamp. Append-only.
- `CustomerIdentity` — alternative lookup keys. Verified phone, verified email. Used for deduplication.
- `Interaction` — a timestamped record of any meaningful customer event. Order placed, session opened, reservation made, lead submitted. Cross-domain view materialized here.

**What Customer owns:** The persistent identity of a person who transacts with the restaurant, and their accumulated relationship history.

**What Customer never owns:** The content of their orders (Ordering), the sessions they participated in (Dining), or the leads they submitted (Catering). Customer holds references. The other domains own the records.

**The identity resolution rule:**
When any domain encounters a person identified by phone number, it calls `CustomerService.findOrCreate(tenantId, phone, name?)`. This is the single canonical entry point. No domain creates customer records directly.

---

### DOMAIN 8: CATERING

The pipeline for large bookings and events.

**Entities:**
- `Lead` — an inbound inquiry. Source, contact details, event type, rough budget, guest count, status.
- `LeadNote` — a follow-up note on a lead. Staff-authored, timestamped.
- `Event` — a confirmed catering engagement. Linked from a converted lead. Guest count, venue, dates.
- `EventDay` — a single day within a multi-day event. Separate venue, guest count, setup time.
- `Quote` — a formal proposal. Line items, total, validity, status lifecycle.
- `QuoteItem` — a line on a quote. Description, quantity, unit price. May reference Catalog items.
- `Package` — a pre-priced bundle offering. Price per head, min/max guests.
- `PackageItem` — a Catalog item included in a package.

**What Catering owns:** The entire sales and planning lifecycle for large-scale engagements, from first inquiry to confirmed event.

**What Catering never owns:** The operational execution. Once an event is confirmed, it produces an `Order` (Ordering domain) for tracking. The kitchen works orders, not events. Catering is a sales funnel. Ordering is the operational truth.

---

### DOMAIN 9: INTELLIGENCE

The understanding of what has happened.

**Entities:**
- `DailyMetric` — pre-aggregated KPI snapshot. One row per tenant per day per metric type. Never queried live.
- `ItemPerformance` — per-item sales snapshot. Units sold, revenue, refunds, average rating. Updated by aggregation job.
- `CustomerSegment` — a scored behavioral cluster. RFM scores, segment label, updated timestamp.
- `MenuView` — implicit engagement signal. Which items were viewed, by whom, in which session.
- `ReviewSummary` — aggregated rating distribution per entity. Pre-computed.
- `Benchmark` — anonymized cross-tenant metric. For "your revenue is X% above similar restaurants."

**What Intelligence owns:** Pre-computed understanding. Intelligence never queries operational tables at read time. It consumes events and aggregates offline.

**What Intelligence never owns:** Raw operational data. Intelligence does not own orders, sessions, or customers. It maintains snapshots derived from events emitted by those domains.

**The fundamental rule of Intelligence:** Every read is O(1). Every write is a background job. No Insights endpoint ever touches `orders.*` directly.

---

## PART 4 — OWNERSHIP BOUNDARIES

```
                          OWNS ──────────────────────────────────────────────────────────────────────────────────
                                                                                                                 │
                                                          Can REFERENCE   ──────────────────────────────────────┐│
                          │                               but never own   │                                     ││
                          │                                               │                                     ││
┌─────────────┬───────────┴───────────────────────────────────────────   │   ───────────────────────────────┐  ││
│  DOMAIN     │  OWNS (exclusively)                                       │   REFERENCES (reads, never writes)│  ││
├─────────────┼───────────────────────────────────────────────────────── │   ───────────────────────────────┤  ││
│ Tenant      │  Restaurant, Location, Plan, FeatureFlag,                 │   —                               │  ││
│             │  Integration, Settings, UsageEvent                        │                                   │  ││
├─────────────┼───────────────────────────────────────────────────────── │   ───────────────────────────────┤  ││
│ Identity    │  Staff, Role, Permission, AuthSession,                    │   Tenant (staff belong to tenant) │  ││
│             │  ApiKey, OAuthIdentity                                    │                                   │  ││
├─────────────┼───────────────────────────────────────────────────────── │   ───────────────────────────────┤  ││
│ Catalog     │  Menu, Category, Item, Variant,                           │   Tenant                          │  ││
│             │  CustomizationGroup, CustomizationOption,                 │                                   │  ││
│             │  Combo, AvailabilityRule, MenuSchedule                    │                                   │  ││
├─────────────┼───────────────────────────────────────────────────────── │   ───────────────────────────────┤  ││
│ Ordering    │  Order, OrderItem, OrderItemCustomization,                │   Catalog (item prices snapshot)  │  ││
│             │  OrderTax, OrderDiscount, OrderEvent, DeliveryJob         │   Customer (customer_id)          │  ││
│             │                                                           │   Dining (session_id)             │  ││
│             │                                                           │   Payment (payment_id)            │  ││
├─────────────┼───────────────────────────────────────────────────────── │   ───────────────────────────────┤  ││
│ Payment     │  Payment, PaymentEvent, Refund                            │   Ordering (order_id)             │  ││
├─────────────┼───────────────────────────────────────────────────────── │   ───────────────────────────────┤  ││
│ Dining      │  Table, DiningSession, Reservation, Waitlist, Review      │   Customer (customer_id)          │  ││
│             │                                                           │   Ordering (order_ids in session) │  ││
├─────────────┼───────────────────────────────────────────────────────── │   ───────────────────────────────┤  ││
│ Customer    │  Customer, CustomerAddress, LoyaltyAccount,               │   Tenant                          │  ││
│             │  LoyaltyTransaction, ConsentRecord,                       │                                   │  ││
│             │  CustomerIdentity, Interaction                            │                                   │  ││
├─────────────┼───────────────────────────────────────────────────────── │   ───────────────────────────────┤  ││
│ Catering    │  Lead, LeadNote, Event, EventDay,                         │   Customer (customer_id)          │  ││
│             │  Quote, QuoteItem, Package, PackageItem                   │   Catalog (item references)       │  ││
│             │                                                           │   Ordering (produced order_id)    │  ││
├─────────────┼───────────────────────────────────────────────────────── │   ───────────────────────────────┤  ││
│ Intelligence│  DailyMetric, ItemPerformance, CustomerSegment,           │   All domains (events only —      │  ││
│             │  MenuView, ReviewSummary, Benchmark                       │   never direct table reads)       │  ││
└─────────────┴───────────────────────────────────────────────────────── │   ───────────────────────────────┘  ││
```

### The Golden Rules of Ownership

**Rule 1: No domain writes to another domain's tables.**
If Ordering needs to record that a customer placed an order, it emits `order.created`. Customer domain listens and creates an `Interaction` record. Ordering does not write to `customer.interactions`.

**Rule 2: References are IDs, not joins.**
When an Order references a Customer, it stores `customer_id`. It does not join to the Customer table to get the customer's name. It stores the name at order creation time (denormalization is correct here — the customer's name at the time of order is a historical fact).

**Rule 3: The owning domain is the only one that can mutate.**
Multiple domains can read `orders.orders`. Only Ordering can write to it.

**Rule 4: Events are the only cross-domain communication channel.**
If Payment needs to tell Ordering that money was captured, it emits an event. It does not call an Ordering service method directly. This is not religious dogma — at 100 restaurants, direct service calls are fine. But the seams should be designed as if they were events, even if the initial implementation is a synchronous function call. The event interface is the contract.

---

## PART 5 — DOMAIN EVENTS

These are the canonical events the system produces. Every event has an owner (the domain that emits it) and subscribers (domains or services that react).

### Ordering Events

| Event | Owner | Subscribers |
|---|---|---|
| `order.created` | Ordering | Intelligence, Communications, Customer (interaction), Loyalty |
| `order.confirmed` | Ordering | Communications (customer notification), Kitchen projection |
| `order.accepted` | Ordering | Communications (customer notification) |
| `order.ready` | Ordering | Communications (customer notification) |
| `order.completed` | Ordering | Intelligence, Loyalty (points earn trigger) |
| `order.cancelled` | Ordering | Communications, Intelligence, Payment (refund trigger if paid) |
| `order.status_changed` | Ordering | Communications, Intelligence |

### Payment Events

| Event | Owner | Subscribers |
|---|---|---|
| `payment.initiated` | Payment | — |
| `payment.captured` | Payment | **Ordering** (advance status to confirmed), Intelligence |
| `payment.failed` | Payment | Ordering (mark as payment_failed), Communications |
| `payment.refunded` | Payment | Ordering (update order), Intelligence, Loyalty (points reversal) |

### Dining Events

| Event | Owner | Subscribers |
|---|---|---|
| `session.opened` | Dining | Intelligence |
| `session.bill_requested` | Dining | Communications (notify staff), Kitchen projection |
| `session.closed` | Dining | Intelligence, Customer (interaction), Loyalty (earn trigger) |
| `reservation.created` | Dining | Communications (confirmation to guest) |
| `reservation.confirmed` | Dining | Communications (confirmation to guest) |
| `reservation.reminder_due` | Dining | Communications (day-of reminder) |
| `reservation.seated` | Dining | — |
| `reservation.no_show` | Dining | Intelligence |

### Customer Events

| Event | Owner | Subscribers |
|---|---|---|
| `customer.created` | Customer | Communications (welcome message) |
| `customer.identified` | Customer | — |
| `loyalty.tier_upgraded` | Customer | Communications (congratulations message) |
| `loyalty.points_earned` | Customer | — |
| `loyalty.points_redeemed` | Customer | Ordering (apply discount) |

### Catering Events

| Event | Owner | Subscribers |
|---|---|---|
| `lead.created` | Catering | Communications (internal notification to staff) |
| `lead.qualified` | Catering | — |
| `lead.converted` | Catering | **Ordering** (create catering order), Intelligence |
| `quote.sent` | Catering | Communications (email quote to prospect) |
| `quote.accepted` | Catering | Catering (trigger event creation) |

### Catalog Events

| Event | Owner | Subscribers |
|---|---|---|
| `item.availability_changed` | Catalog | — (surfaces re-fetch on demand) |
| `menu.published` | Catalog | — (surfaces re-fetch on demand) |

### Tenant Events

| Event | Owner | Subscribers |
|---|---|---|
| `tenant.plan_upgraded` | Tenant | Identity (unlock permissions), Features (enable modules) |
| `tenant.module_activated` | Tenant | relevant module initialization |

---

## PART 6 — DASHBOARD PROJECTIONS

The dashboard is a **projection system**. It reads from domain data and presents operational views. It does not own any data. It is not a domain.

Every dashboard view is a named projection with a defined data source.

### View Taxonomy

**Type A — Live Operational Projections** (require polling or websocket)
These show real-time state. They are time-sensitive.

| Projection | Data Source | Update Mechanism |
|---|---|---|
| KitchenBoard | Ordering (all active orders, all channels) | WebSocket or 10s poll |
| FloorMap | Dining (tables + sessions) | WebSocket or 15s poll |
| OrderQueue | Ordering (delivery/pickup orders by status) | WebSocket or 10s poll |
| ReservationsToday | Dining (reservations for today's date) | On-demand |

**Type B — Management Projections** (read on demand, cached)
These show current configuration state. They change infrequently.

| Projection | Data Source |
|---|---|
| MenuEditor | Catalog (categories + items + variants + customizations) |
| TableManager | Dining (table configuration) |
| StaffManager | Identity (staff + roles + permissions) |
| IntegrationsManager | Tenant (integrations) |
| SettingsPanel | Tenant (settings) |
| CateringPipeline | Catering (leads by status) |
| CateringEventDetail | Catering (event + quotes) |

**Type C — Intelligence Projections** (aggregated, never live)
These show pre-computed understanding. They never touch operational tables.

| Projection | Data Source |
|---|---|
| OverviewStats | Intelligence (daily_metrics for last 30 days) |
| RevenueChart | Intelligence (daily_metrics by day) |
| ItemPerformance | Intelligence (item_performance snapshots) |
| CustomerList | Customer (paginated, with last order context) |
| CustomerProfile | Customer + Ordering (full interaction history) |
| ReviewsFeed | Dining.Review + Customer.Feedback |
| InsightsDashboard | Intelligence (all metric types) |

**Type D — Platform Management Projections**
| Projection | Data Source |
|---|---|
| PlanAndBilling | Tenant (plan, usage_ledger) |
| AuditLog | Platform (audit_log) |
| NotificationTemplates | Communications (templates) |
| WebhookManager | Platform (webhooks + deliveries) |

### Dashboard Navigation: Canonical Structure

```
HOME
  └─ Overview (Type C — live KPIs + recent orders)

SERVE
  ├─ Kitchen    (Type A — all active orders, all channels)
  ├─ Tables     (Type A — floor map + session state)
  ├─ Orders     (Type A — delivery/pickup queue)
  └─ Reservations (Type A — today + upcoming)

SELL
  ├─ Menu       (Type B — catalog editor)
  ├─ Catering   (Type B — lead pipeline)
  └─ Promotions (Type B — coupon/discount management) [future module]

KNOW
  ├─ Customers  (Type C — CRM list + profiles)
  ├─ Insights   (Type C — analytics)
  └─ Reviews    (Type C — feedback feed)

BUILD
  ├─ Presence   (Type B — public website config)
  └─ Brand      (Type B — logos, colors, SEO)

MANAGE
  ├─ Staff      (Type B — team + permissions)
  ├─ Settings   (Type B — operations config)
  ├─ Integrations (Type B — payment, delivery, comms)
  └─ Plan & Billing (Type D)
```

---

## PART 7 — CUSTOMER-FACING SURFACES

Surfaces are products. They have users, sessions, and UX flows. They are not domains.

Each surface is built from domain data. None owns any data.

### Surface 1: PRESENCE

**What it is:** The restaurant's public identity on the web.
**User:** Anyone. No auth required.
**Data:** Catalog (menu preview) + Tenant (hours, location) + Brand (assets, content, SEO)
**Session:** Stateless. Read-only.
**Purpose:** Discoverability, brand, and menu showcase.
**Not a domain:** Presence is a read-only rendering of data owned by other domains.

### Surface 2: STOREFRONT

**What it is:** Online ordering for delivery and pickup.
**User:** Customer. Phone verification for guest identity.
**Data:** Catalog (menu) + Ordering (order creation, status) + Payment (checkout)
**Session:** Cart in browser. Order linked to Customer identity on checkout.
**Purpose:** Revenue generation without requiring dine-in.
**Not a domain:** Storefront is an ordering surface. Ordering is the domain.

**Note:** Currently called "Orders." Renaming to "Storefront" clarifies it is a customer-facing surface, not the ordering domain itself.

### Surface 3: TABLE

**What it is:** QR-code dine-in experience.
**User:** Guest at a physical table. Phone captured for identity.
**Data:** Catalog (menu) + Dining (session) + Ordering (order creation)
**Session:** Table identifier from QR code. Session opened on first order or on scan.
**Purpose:** Frictionless in-restaurant ordering without staff intervention.
**Not a domain:** Table is a dine-in surface. Dining and Ordering are the domains.

### Surface 4: CATERING

**What it is:** Event inquiry and lead capture.
**User:** Event planner or individual. No auth required.
**Data:** Catering (lead creation) + Catalog (package preview) + Tenant (contact, location)
**Session:** Stateless form submission.
**Purpose:** Top-of-funnel for large bookings.
**Not a domain:** Catering surface is a form. Catering domain manages the pipeline.

### Surface 5: DASHBOARD

**What it is:** The operator console. Where the restaurant is managed.
**User:** Authenticated staff with role-based access.
**Data:** All domains, read as projections.
**Session:** Long-lived authenticated session.
**Purpose:** Complete operational control.
**Not a domain:** Dashboard is a projection system. It reads, it never owns.

### Future Surface 6: KIOSK

**What it is:** In-restaurant self-service ordering terminal.
**User:** Walk-in customer.
**Data:** Catalog + Ordering + Payment
**Session:** Per-transaction.
**Note:** The Table surface with a different UX profile. The domain work is identical.

### Future Surface 7: STAFF APP

**What it is:** Mobile app for kitchen staff, servers, and managers.
**User:** Authenticated staff.
**Data:** Ordering (kitchen status), Dining (session management), Reservations
**Session:** Authenticated, push-notification enabled.
**Note:** Mobile projection of Kitchen, Tables, and Orders views.

---

## PART 8 — PRODUCT MODULES

Modules are optional capabilities that activate on top of the platform. They are plan-gated.

A module is not a domain. A module uses domains.

### Module: KITCHEN DISPLAY SYSTEM (KDS)

**Built on:** Ordering (all active orders), Dining (session + table context)
**Adds:** Order grouping by table/station, prep-time tracking, order acknowledgment workflow
**Domain it projects:** Ordering (read-only projection)
**Plan gate:** Pro

### Module: RESERVATIONS

**Built on:** Dining (reservations + tables), Customer (identity), Communications (notifications)
**Adds:** Booking form, confirmation flow, reminder automation, table assignment, session auto-open
**Domain it extends:** Dining
**Plan gate:** Pro

### Module: LOYALTY

**Built on:** Customer (loyalty accounts + transactions), Ordering (earn/burn triggers)
**Adds:** Points earn on order completion, points display on surfaces, redemption at checkout
**Domain it extends:** Customer
**Plan gate:** Pro

### Module: COUPONS & PROMOTIONS

**Built on:** Ordering (discount application), Catalog (item-level promotions)
**Adds:** Coupon creation, BOGO rules, minimum order discounts, campaign scheduling
**Plan gate:** Growth+

### Module: INVENTORY

**Built on:** Catalog (item availability), Ordering (stock deduction)
**Adds:** Stock level tracking, low-stock alerts, auto-disable sold-out items
**Domain it extends:** Catalog (availability rules)
**Plan gate:** Pro

### Module: CATERING PIPELINE

**Built on:** Catering domain, Customer, Communications
**Adds:** Lead management UI, quote builder, event planning, package configurator
**Plan gate:** Growth+

### Module: INSIGHTS & ANALYTICS

**Built on:** Intelligence domain
**Adds:** Revenue charts, item performance, customer segments, benchmarking
**Plan gate:** Pro

### Module: NOTIFICATIONS AUTOMATION

**Built on:** Communications platform service
**Adds:** Template builder, trigger configuration, WhatsApp/SMS/email dispatch
**Plan gate:** Growth+

### Module: STAFF & RBAC

**Built on:** Identity domain
**Adds:** Role editor, permission management UI, staff performance tracking
**Plan gate:** Growth+

### Future Module: MULTI-LOCATION

**Built on:** Tenant (locations), all domains filtered by location_id
**Adds:** Per-location menu, per-location hours, cross-location reporting
**Plan gate:** Enterprise

### Future Module: DEVELOPER API

**Built on:** Platform (API keys, webhooks)
**Adds:** API key management UI, webhook configuration, event log, documentation
**Plan gate:** Enterprise

---

## PART 9 — PLATFORM SERVICES

Platform services are cross-cutting infrastructure. Every domain can call them. They own no business data.

### Service: COMMUNICATIONS

**What it does:** Sends messages to humans (staff or customers) through any channel.
**Channels:** WhatsApp, SMS, Email, Push notification, In-app feed
**Interface:**
```
Communications.send({
  tenantId,
  recipientType: 'customer' | 'staff',
  recipientId,
  templateKey,      // maps to a template in comms.templates
  channel,          // 'whatsapp' | 'sms' | 'email' | 'push' | 'in_app'
  variables,        // template interpolation values
  idempotencyKey,   // prevents duplicate sends on retry
})
```
**Data owned:** `comms.templates`, `comms.outbound`, `comms.staff_feed`, `comms.engagement`
**Triggered by:** Domain events (order.created, reservation.confirmed, etc.)

**Why this is a service, not a domain:** Communications has no business logic. It dispatches messages based on instructions from other domains. It does not decide when to send a message — it only sends when asked.

### Service: EVENT BUS

**What it does:** Decouples domain event emission from domain event consumption.
**Implementation:** Transactional outbox pattern. Events written to DB in same transaction as domain mutation. Async relay job delivers to subscribers.
**Interface:**
```
EventBus.emit(eventType, payload, { tenantId, entityId, idempotencyKey })
EventBus.subscribe(eventType, handler)  // at startup
```
**Data owned:** `platform.event_outbox`, `platform.events`
**Used by:** Every domain for cross-domain communication

### Service: AUDIT

**What it does:** Records every mutation in the system with before/after state.
**Interface:**
```
Audit.log({
  tenantId,
  actorType: 'staff' | 'customer' | 'system',
  actorId,
  action,
  entityType,
  entityId,
  before,
  after,
})
```
**Data owned:** `platform.audit_log` (partitioned by month)
**Used by:** Every route handler on every mutation

### Service: FEATURE FLAGS

**What it does:** Determines whether a tenant has access to a capability.
**Interface:**
```
Features.isEnabled(tenantId, featureKey)    // boolean
Features.require(featureKey)                // Express middleware
Features.getAll(tenantId)                   // { [key]: boolean }
```
**Data owned:** `tenant.feature_flags`
**Note:** Replaces the current boolean column system. Feature keys are strings, not columns.

### Service: USAGE METERING

**What it does:** Records metered usage for billing.
**Interface:**
```
Metering.record(tenantId, metricKey, quantity)
Metering.getUsage(tenantId, period)
```
**Data owned:** `tenant.usage_events`, `tenant.usage_ledger`

### Service: ENCRYPTION

**What it does:** Encrypts and decrypts sensitive data at rest.
**Interface:**
```
Encryption.encrypt(plaintext)  → ciphertext
Encryption.decrypt(ciphertext) → plaintext
```
**Used by:** Tenant (integration secrets), Identity (token hashes)

### Service: COMPLIANCE

**What it does:** Handles DPDP Act obligations. Data exports, deletion requests, consent management.
**Interface:**
```
Compliance.recordConsent(tenantId, customerId, type, granted, source)
Compliance.createExportJob(tenantId, customerId)
Compliance.createDeletionRequest(tenantId, customerId)
```
**Data owned:** `customer.consent_history`, `platform.export_jobs`, `platform.customer_data_requests`

### Service: MEDIA

**What it does:** Handles image upload, storage, and CDN delivery.
**Interface:**
```
Media.upload(tenantId, file, context)  → { url, key }
Media.delete(tenantId, key)
```
**Used by:** Catalog (item images), Brand (logos, banners), Catering (package images)

---

## PART 10 — FUTURE MODULE COMPATIBILITY

The canonical architecture is designed so that future modules can be added without touching domain core.

### How a new module is added

1. Define which domains it reads from (projections)
2. Define which domains it writes to (through events, not direct writes)
3. Define which platform services it uses
4. Define its own schema if it owns data
5. Register its event subscriptions at startup
6. Gate behind a feature flag

### Future Module: WAITLIST (6 months)

**Reads from:** Dining (table availability), Customer (identity)
**Writes to:** Dining.Waitlist (via its own service)
**Events produced:** `waitlist.party_added`, `waitlist.party_notified`, `waitlist.party_seated`
**Platform services:** Communications (SMS/WhatsApp when table ready)
**Schema:** `dining.waitlist` (already exists)

### Future Module: STAFF SCHEDULING (12 months)

**Reads from:** Identity (staff), Tenant (locations, hours)
**Writes to:** New `scheduling.*` schema
**Events produced:** `shift.published`, `shift.swapped`, `shift.no_show`
**Platform services:** Communications (shift reminders)

### Future Module: DELIVERY INTEGRATION (6 months)

**Reads from:** Ordering (confirmed orders), Tenant (integrations)
**Writes to:** `orders.delivery_jobs` (via Ordering domain, through event)
**Events produced:** `delivery.dispatched`, `delivery.arrived`, `delivery.failed`
**Platform services:** Communications (customer tracking updates)

### Future Module: CUSTOMER CAMPAIGNS (12 months)

**Reads from:** Customer (segments), Intelligence (behavioral data)
**Writes to:** Communications (outbound queue)
**Events produced:** `campaign.sent`, `campaign.engaged`
**Platform services:** Communications, Metering (per-message billing)
**Gate:** Enterprise

### Future Module: THIRD-PARTY APPS (18 months)

**Reads from:** All domains via public API (scoped to tenant, read-only by default)
**Writes to:** Permitted domains via scoped API keys
**Events consumed:** Via webhook subscriptions
**Platform services:** API key management, webhook delivery
**Gate:** Developer plan

### The compatibility test

Every future module should be addable by:
1. Adding a new schema (if it owns data) or new tables in an existing schema
2. Registering event subscriptions
3. Adding API routes under its namespace
4. Adding a dashboard projection
5. Adding a feature flag

No future module should require modifying a domain's core entities, core events, or core service contracts.

If adding a module requires modifying how `orders.orders` is structured, that is a sign that the module is actually a domain capability, not a module.

---

## PART 11 — WHAT CURRENT MODULES ACTUALLY ARE

This is the reclassification of every current KRAVON concept.

| Current Name | What It Actually Is | Canonical Classification |
|---|---|---|
| Ordering | The transactional domain | **Domain: Ordering** |
| Menu | The catalog domain | **Domain: Catalog** (rename) |
| Tables | A mix of Dining domain + Floor Map view | **Domain: Dining** (tables are entities) + **View: FloorMap** |
| Sessions | Core of the Dining domain | **Domain: Dining** |
| Reservations | Dining domain entity + Reservations module | **Domain: Dining** + **Module: Reservations** |
| Kitchen | A projection of the Ordering domain | **View: KitchenBoard** (not a domain) |
| Customers | The customer domain | **Domain: Customer** |
| Insights | Intelligence domain + Insights module | **Domain: Intelligence** + **Module: Insights** |
| Catering | Catering domain + Catering module | **Domain: Catering** (leads/pipeline) + **Module: Catering Pipeline** |
| Staff | Identity domain | **Domain: Identity** |
| Settings | Tenant domain configuration | **Domain: Tenant** |
| Presence | Customer-facing surface | **Surface: Presence** (not a domain) |
| Brand | Tenant-owned assets, sub-entity of Tenant | **Domain: Tenant** (brand as sub-namespace) |
| Notifications | Communications platform service | **Platform Service: Communications** |
| Inventory | Future module (currently ghost) | **Module: Inventory** (not yet built) |
| Feature Flags | Platform service capability | **Platform Service: Feature Flags** |
| Webhooks | Platform service capability | **Platform Service: Event Bus** |

---

## PART 12 — THE CANONICAL API ARCHITECTURE

Every API endpoint is owned by exactly one domain or platform service.

```
/v1/restaurants/:slug/

  # Catalog Domain
  catalog/
    menus/                      GET, POST
    menus/:id/                  GET, PATCH, DELETE
    menus/:id/categories/       GET, POST
    categories/:id/             PATCH, DELETE
    categories/:id/items/       GET, POST
    items/:id/                  GET, PATCH, DELETE
    items/:id/variants/         GET, POST, PATCH, DELETE
    items/:id/customizations/   GET, POST, PATCH, DELETE
    combos/                     GET, POST, PATCH, DELETE

  # Ordering Domain
  orders/
    /                           POST (create), GET (list)
    /:id/                       GET, PATCH (status)
    /:id/events/                GET (history)

  # Dining Domain
  dining/
    tables/                     GET, POST, PATCH, DELETE
    sessions/                   GET, POST (open)
    sessions/:id/               GET, PATCH (close, request-bill)
    sessions/:id/orders/        GET
    reservations/               GET, POST
    reservations/:id/           GET, PATCH
    waitlist/                   GET, POST
    waitlist/:id/               PATCH

  # Payment Domain
  payments/
    /:id/                       GET
    /:id/refund/                POST

  # Customer Domain
  customers/
    /                           GET (list)
    /:id/                       GET, PATCH
    /:id/interactions/          GET
    /:id/loyalty/               GET

  # Catering Domain
  catering/
    leads/                      GET, POST
    leads/:id/                  GET, PATCH
    leads/:id/notes/            POST
    events/                     GET
    events/:id/                 GET, PATCH
    quotes/                     POST
    quotes/:id/                 GET, PATCH
    packages/                   GET, POST, PATCH, DELETE

  # Intelligence Domain (read-only)
  intelligence/
    summary/                    GET
    metrics/                    GET
    items/                      GET
    customers/                  GET

  # Platform Services
  settings/                     GET, PATCH
  brand/                        GET, PATCH
  staff/                        GET, POST, PATCH, DELETE
  notifications/                GET (staff feed), PATCH (mark read)
  webhooks/                     GET, POST, PATCH, DELETE

  # Public (no auth)
  public/config/                GET (surface bootstrap)
  public/menu/                  GET
  public/reviews/               GET, POST

# Platform webhooks (external callbacks)
/webhooks/razorpay/             POST
/webhooks/delivery/             POST
/webhooks/whatsapp/             POST

# Auth
/v1/auth/
  login/                        POST
  refresh/                      POST
  logout/                       POST
```

**Principles:**
- Every endpoint belongs to one domain
- Route path reflects domain ownership
- No cross-domain mutations through a single endpoint
- Public endpoints are clearly namespaced under `/public/`
- Webhook callbacks are at root level, not under `/restaurants/:slug/`

---

## PART 13 — THE CANONICAL DATABASE ARCHITECTURE

### Schema Map

```
identity.*          Staff, Role, Permission, AuthSession, ApiKey, OAuthIdentity
tenant.*            Restaurant, Location, Plan, FeatureFlag, Integration, Settings,
                    Domain, UsageEvent, UsageLedger
catalog.*           Menu, Category, Item, Variant, CustomizationGroup,
                    CustomizationOption, Combo, ComboSlot, AvailabilityRule,
                    MenuSchedule, SurfaceVisibility
orders.*            Order, OrderItem, OrderItemCustomization, OrderTax,
                    OrderDiscount, OrderEvent, DeliveryJob, Coupon
payments.*          Payment, PaymentEvent, Refund
dining.*            Table, DiningSession, Reservation, Waitlist, Review
customer.*          Customer, CustomerAddress, LoyaltyAccount, LoyaltyTransaction,
                    ConsentRecord, CustomerIdentity, Interaction
catering.*          Lead, LeadNote, Event, EventDay, Quote, QuoteItem,
                    Package, PackageItem
intelligence.*      DailyMetric, ItemPerformance, CustomerSegment, MenuView,
                    ReviewSummary, Benchmark
comms.*             Template, Outbound, StaffFeed, Engagement
platform.*          EventOutbox, EventLog, AuditLog, SchemaVersion,
                    ExportJob, DataRequest
```

### Key Schema Decisions

**`catalog.*` (renamed from `menu.*`):**
The schema name `menu` implies a single menu. `catalog` is the correct name — it encompasses all sellable items across all menus and surfaces.

**`identity.*` (extracted from `tenant.*`):**
Staff and permissions are platform primitives, not tenant configuration. Extracting to `identity.*` makes this clear and enables future cross-tenant capabilities (support staff, shared identities).

**`comms.*` (consolidated from `platform.notifications` + `notifications.notifications`):**
One schema. `comms.templates` holds templates. `comms.outbound` holds messages sent to customers. `comms.staff_feed` holds in-app messages to staff. `comms.engagement` holds read/click tracking.

**`orders.coupon` stays in `orders.*`:**
Coupons are a Commerce concern that lives closest to Ordering. Future Commerce domain extraction would move this, but at current scale it belongs here.

**No `inventory.*` schema until the module is built:**
Ghost schemas are technical debt. The schema will be designed when the feature is designed.

### Partition Strategy (applied from day one)

```sql
-- High-volume append-only tables
platform.audit_log          PARTITION BY RANGE (created_at)  -- monthly
orders.order_events         PARTITION BY RANGE (created_at)  -- monthly
customer.interactions       PARTITION BY RANGE (created_at)  -- monthly
comms.outbound              PARTITION BY RANGE (created_at)  -- monthly
platform.event_outbox       PARTITION BY RANGE (created_at)  -- weekly
```

---

## PART 14 — NORTH STAR ARCHITECTURE DIAGRAM

```
╔══════════════════════════════════════════════════════════════════════════════╗
║                            KRAVON PLATFORM                                   ║
║                                                                              ║
║  ╔══════════════════════════════════════════════════════════════════════╗    ║
║  ║                       PLATFORM SERVICES                              ║    ║
║  ║                                                                      ║    ║
║  ║   EventBus │ Communications │ Audit │ FeatureFlags │ Metering        ║    ║
║  ║   Encryption │ Compliance │ Media                                    ║    ║
║  ╚══════════════════════════════════════════════════════════════════════╝    ║
║                                    ↕                                         ║
║  ╔════════════╗  ╔════════════╗  ╔════════════╗  ╔════════════╗             ║
║  ║  TENANT    ║  ║  IDENTITY  ║  ║  CATALOG   ║  ║  ORDERING  ║             ║
║  ╚════════════╝  ╚════════════╝  ╚════════════╝  ╚════════════╝             ║
║         ↕               ↕               ↕               ↕                   ║
║  ╔════════════╗  ╔════════════╗  ╔════════════╗  ╔════════════╗             ║
║  ║  PAYMENT   ║  ║   DINING   ║  ║  CUSTOMER  ║  ║  CATERING  ║             ║
║  ╚════════════╝  ╚════════════╝  ╚════════════╝  ╚════════════╝             ║
║                                    ↕                                         ║
║  ╔══════════════════════════════════════════════════════════════════════╗    ║
║  ║                         INTELLIGENCE                                 ║    ║
║  ║        (consumes events from all domains, never queries directly)    ║    ║
║  ╚══════════════════════════════════════════════════════════════════════╝    ║
║                                    ↕                                         ║
║  ╔══════════════════════════════════════════════════════════════════════╗    ║
║  ║                      OPTIONAL MODULES                                ║    ║
║  ║                                                                      ║    ║
║  ║   KDS │ Reservations │ Loyalty │ Coupons │ Inventory │ Insights      ║    ║
║  ║   Catering Pipeline │ Notifications Automation │ Staff RBAC          ║    ║
║  ╚══════════════════════════════════════════════════════════════════════╝    ║
║                                    ↕                                         ║
║  ╔══════════════════════════════════════════════════════════════════════╗    ║
║  ║                      PRODUCT SURFACES                                ║    ║
║  ║                                                                      ║    ║
║  ║   Presence │ Storefront │ Table │ Catering Form │ Dashboard          ║    ║
║  ║                                                                      ║    ║
║  ║   ┌──────────────────────────────────────────────────────────────┐  ║    ║
║  ║   │                   DESIGN SYSTEM                               │  ║    ║
║  ║   │   Brand tokens · KravonUI components · Shared error states    │  ║    ║
║  ║   └──────────────────────────────────────────────────────────────┘  ║    ║
║  ╚══════════════════════════════════════════════════════════════════════╝    ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

---

## PART 15 — DISTANCE FROM CURRENT STATE TO TARGET

### What is already correct

The current implementation gets more right than wrong. The distance is smaller than it appears.

| Target Architecture | Current State | Distance |
|---|---|---|
| 9 canonical domains | ~7 domains identifiable | Small |
| Separate Identity schema | Lives in `tenant.*` | Medium |
| Catalog schema (renamed from menu) | `menu.*` schema | Rename only |
| Ordering domain with OrderService | Logic in route handlers | Medium |
| Payment boundary respected | Webhook mutates order directly | Small fix |
| Dining domain complete | Complete, plus dine-in.js conflation | Small |
| Customer domain with identity resolution | Missing findOrCreate | Small |
| Catering domain with order handoff | Missing order creation on convert | Small |
| Intelligence from events, not live queries | Live queries suspected | Medium |
| Communications as platform service | Split across two schemas | Medium |
| EventBus used internally | External only | Large (P2) |
| Feature flags as service | Boolean columns + flags table | Small |
| Audit log partitioned | Not partitioned | Small |
| comms.* consolidated schema | platform.notifications + notifications.notifications | Small |
| API routes by domain | Mixed, dine-in.js conflation | Medium |
| Dashboard grouped SERVE/SELL/KNOW/BUILD/MANAGE | Operations/Customers&Sales/Digital/Admin | Small |
| KDS shows all channels | Dine-in only | Small |
| Partition strategy | None | Small |
| Design system shared across surfaces | Per-surface CSS | Large (P2) |
| Surfaces clearly not domains | Partially confused | Naming + docs |

### The Shortest Path

The distance from current to canonical is achievable in **four ordered sprints** without a rewrite.

---

**SPRINT 1 — FIX THE FOUNDATION (2 weeks)**
*Correctness. These are bugs or near-bugs.*

1. Idempotency key on order creation (F03)
2. Transaction atomicity on payment webhook (F04)
3. Unified kitchen endpoint — all channels (F05)
4. Transaction wrap on `PATCH /presence` (F12)

No schema changes. No API changes. No frontend changes.
Sprint 1 makes the platform correct.

---

**SPRINT 2 — UNIFY THE CORE (3 weeks)**
*Single source of truth. These are the load-bearing refactors.*

1. `OrderService.create()` — unify both order creation paths
2. `CustomerService.findOrCreate()` — canonical identity resolution
3. Split `dine-in.js` into `sessions.js`, `dining-orders.js`, `kitchen.js`
4. Rename `notifications.notifications` → `comms.staff_feed`, `platform.notifications` → `comms.outbound`
5. Delete `inventory.*` ghost schema
6. Migrate feature gate middleware from boolean columns to `feature_flags` table

No API surface changes. No frontend changes. One migration.
Sprint 2 makes the platform coherent.

---

**SPRINT 3 — COMPLETE THE MODULES (4 weeks)**
*Product completeness. Turn on what is already half-built.*

1. Notification automation — wire `Communications.send()` to domain events (order.created, reservation.confirmed)
2. Reservation → table assignment + session auto-open
3. Catering → order handoff on `lead.converted`
4. Insights aggregation job — populate `intelligence.daily_metrics` via background job
5. `platform.audit_log` partition strategy
6. Rename `menu.*` schema to `catalog.*` (migration + query updates)

Sprint 3 makes the platform complete for the first 100 restaurants.

---

**SPRINT 4 — BUILD THE PLATFORM (ongoing)**
*Architecture investments that pay off at scale. Begin after 25 active restaurants.*

1. Extract `identity.*` schema from `tenant.*`
2. Dashboard navigation restructure (SERVE/SELL/KNOW/BUILD/MANAGE)
3. KDS as standalone module with station grouping
4. Loyalty module — activate the existing schema with product surface
5. Design system — extract shared CSS tokens across all five surfaces
6. Internal event bus — use outbox for internal domain coordination
7. `catalog.menus` enforcement — multi-menu support
8. Plan & Billing self-service view

---

### Migration Safety

No sprint requires a breaking API change.
No sprint requires a frontend rewrite.
No sprint requires downtime.

The migration path is:
- Schema changes are additive until Sprint 3 (new columns, new tables)
- Sprint 3 includes one rename (`menu.*` → `catalog.*`) — requires query update, no API change
- Sprint 4's `identity.*` extraction is the only large schema migration — can be done with zero downtime using view aliasing during transition

The canonical architecture is not a destination that requires starting over.
It is a direction that the current codebase is already pointing toward.
The work is removing the drift, not replacing the foundation.

---

*The foundation deserves the architecture it was built for.*
