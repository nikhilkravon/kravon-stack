# KRAVON ARCHITECTURE CRITIQUE

*A second architect attacks CANONICAL_ARCHITECTURE.md*
*No defense of prior decisions. Optimize for shipping, not elegance.*

---

## OPENING STATEMENT

CANONICAL_ARCHITECTURE.md is a well-designed document for a team of eight engineers at a Series A company with 500 paying restaurants.

KRAVON is a solo-founder product trying to reach its first 100 restaurants.

These are different problems. The document solves the wrong one.

The document is not wrong about what KRAVON should eventually become. It is wrong about when those decisions need to be made, and it would cause a solo founder to spend six months reorganizing code that already works instead of six months acquiring customers.

Good architecture at the wrong time is just expensive refactoring with extra steps.

---

## ATTACK 1 — OVER-ENGINEERING FOR CURRENT STAGE

### Nine canonical domains is four too many.

At 100 restaurants, the operational complexity does not justify nine separate domains with formal ownership boundaries, event contracts, and service interfaces.

**Payment** is not a domain at this scale. It is three tables and one webhook handler. Calling it a domain implies it has enough independent complexity to justify a `PaymentService` abstraction, separate from ordering. It does not. Payment at this scale is: "Did Razorpay confirm the charge? Yes → mark order paid. No → mark order failed." That is two conditional branches. It is not a domain.

**Catering** is not a domain at this scale. It is a CRM pipeline with a form. It has nine tables and zero operational coupling to the rest of the system. Giving it domain status implies it will evolve independently of Ordering and Customer. At 100 restaurants, it will not. It will stay exactly as it is.

**Intelligence** is not a domain at 100 restaurants. It is a reporting module. Calling it a domain with its own schema, event subscriptions, and aggregation jobs implies you have the infrastructure to run background jobs reliably. You may not. It implies you have enough query volume to justify pre-aggregation. You do not. At 100 restaurants, a fast live query against orders is perfectly fine.

**The right number of domains for 100 restaurants: five.**
Tenant, Catalog, Ordering, Dining, Customer.
Everything else is a module or utility.

---

### "Platform Services" as formal interfaces is premature.

The document defines eight platform services with formal `Interface:` contracts:

```
Communications.send({ tenantId, recipientType, recipientId, templateKey, ... })
EventBus.emit(eventType, payload, { tenantId, entityId, idempotencyKey })
Audit.log({ tenantId, actorType, actorId, action, ... })
```

At 100 restaurants, these are utility functions in `utils/`. They do not need formal service interfaces, dependency injection, or contract documentation. A `sendNotification(phone, template, vars)` function in `utils/comms.js` solves the same problem with zero ceremony.

Formal service interfaces are valuable when:
- Multiple teams need to agree on a contract
- Services might be extracted to separate deployment units
- Consumer-driven contract testing is required

None of these apply. There is one engineer. There is one deployment. There are no contracts to agree on.

---

### The API route restructure is six weeks of migration for zero user-facing value.

The document proposes restructuring all API routes from:
```
/v1/restaurants/:slug/dine-in/kitchen
/v1/restaurants/:slug/orders
```
to:
```
/v1/restaurants/:slug/dining/sessions
/v1/restaurants/:slug/catalog/items
```

This is a breaking change to every API consumer. Every frontend product must be updated. The config cache must be invalidated. The kravon-api.js client must be rewritten. The Zod validation schemas must be renamed.

The user benefit: zero. No operator ever sees an API URL. No customer ever sees an API URL.

The developer benefit: theoretical tidiness that provides no velocity improvement at current scale.

This is the most expensive low-value recommendation in the document.

---

## ATTACK 2 — DOMAINS THAT SHOULD BE MERGED

### Tenant and Identity should not be separated yet.

The document proposes extracting `identity.*` (staff, roles, permissions) from `tenant.*` because "auth and RBAC are platform primitives, not tenant configuration concerns."

This is architecturally correct and operationally irrelevant for the next 24 months.

The case for separation requires:
- Staff shared across multiple tenants (not in roadmap)
- SSO integration (not in roadmap)
- Platform-level staff accounts that span tenants (admin team, support agents)

Until one of these is true, splitting Tenant and Identity adds a join on every auth check and a schema migration with no benefit.

**Merge verdict: keep staff/roles/permissions in `tenant.*` until there is a concrete use case for separation.**

### Payment should stay inside Ordering until it can't.

Payment is currently two tables and one webhook. The document wants it to be a separate domain with formal event contracts: `payment.captured → Ordering reacts`.

The problem: Ordering and Payment are 100% coupled. Every Payment record has an `order_id`. Every Order record has a `payment_status`. They move together. Separating them does not decouple complexity — it distributes it across two places with an event in between.

The correct test: "Can I change the Payment schema without changing the Order schema?" At this stage, no. They are one thing.

**Merge verdict: keep payments inside Ordering's service layer until payment complexity (multi-payment per order, partial payments, split bills) forces the separation.**

### Catering and Customer should share a service layer, not separate domains.

Catering is a customer acquisition funnel. Its core entities (Lead, Event, Quote) are all variations of "a customer relationship at different stages of commitment." The separation into a full domain implies Catering has independent lifecycle, independent mutations, and independent consumers.

It does not. When a lead converts, it touches Customer (same person), Ordering (produces an order), and Communications (sends a message). Catering does not own any of the downstream consequences of its own primary event. That is not a domain. That is a module with a CRM interface.

**Merge verdict: Catering is a module built on Customer + Ordering. It does not need domain status.**

---

## ATTACK 3 — FAKE DOMAINS

### Intelligence is not a domain. It is a read model.

A domain owns state. Intelligence owns no state — it derives state from other domains. You cannot create an Intelligence entity. You cannot mutate an Intelligence entity. You can only read pre-computed summaries of other domains' activity.

The document even acknowledges this: "Intelligence never queries operational tables at read time. It consumes events and aggregates offline."

A thing that only reads and derives is a **read model** or a **reporting layer**. It is not a domain. Calling it a domain gives it false equal standing with Ordering and Customer, which would be catastrophic if an engineer treated it as such and tried to "protect Intelligence's data" from Ordering.

**Verdict: Intelligence is a reporting module. Its pre-computed tables are materialized views or aggregation targets. It is not a peer domain.**

### Communications is not a domain. It is a utility with persistence.

A domain owns business concepts. Communications owns no business concept — it is infrastructure for message dispatch. It has no lifecycle. A "message" is not a business entity in the same sense that an "order" or a "customer" is. Nobody manages their communications. Communications happens as a side effect of other things.

The document puts Communications in "Platform Services," which is correct. But then it gives it a formal `Interface:` contract, data ownership (`comms.*` schema), and event subscriptions. That is domain-level treatment for a utility.

`comms.*` schema is correct. `comms.templates`, `comms.outbound`, `comms.staff_feed` should exist. But the sending logic is a utility function, not a service with a contract. At this scale, the difference matters because formal services invite over-abstraction.

**Verdict: Communications is a utility with its own schema. Not a service with a contract. Not a domain.**

---

## ATTACK 4 — PREMATURE ABSTRACTIONS

### The event-driven architecture is 18 months early.

The document's internal event bus design is elegant. Every domain emits typed events. Subscribers react asynchronously. Side effects are decoupled. The system becomes composable.

It is also the single most dangerous recommendation in the document for a solo founder.

Event-driven architecture introduces:
- **Non-linear debugging.** When an order is created and the loyalty points are not awarded, the bug is in a subscriber somewhere. The call stack is broken. You trace through event logs instead of stack traces. This is dramatically harder than reading a synchronous function call.
- **Ordering guarantees.** Events must arrive in order. The current outbox handles this, but every subscriber must be idempotent. Writing idempotent event handlers is harder than writing request handlers.
- **Visibility.** A synchronous call either succeeds or throws. An asynchronous event either delivers or sits in the outbox silently. The failure modes are less obvious.
- **Testing complexity.** Unit testing synchronous code is straightforward. Unit testing event subscribers requires mocking the event bus and testing that the right events are emitted and the right side effects occur.

At 100 restaurants, none of the scale benefits justify this complexity. The document recommends internal event-driven patterns for: Communications, Intelligence, Loyalty, Kitchen. All four of these can be synchronous function calls in the order service. The code is five lines. The event-driven alternative is fifty lines with an async infrastructure dependency.

**Verdict: Internal event bus is a P2 that CANONICAL_ARCHITECTURE.md incorrectly treats as a design principle.**

### The `CustomerService.findOrCreate()` contract is correct but the formality is wrong.

The canonical document specifies:
```
CustomerService.findOrCreate(tenantId, { phone, email }) → canonical customer_id
```

This is right. The fix to customer deduplication is right. But the prescription that this becomes a formal `CustomerService` with a defined interface is unnecessary ceremony for a utility that is four SQL lines.

```javascript
// This is the entire CustomerService at this scale:
async function findOrCreate(tenantId, phone, name) {
  const { rows } = await pool.query(
    `INSERT INTO customer.customers (tenant_id, phone, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, phone) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [tenantId, phone, name]
  );
  return rows[0].id;
}
```

This is a function in `utils/customer.js`, not a service with a contract. The fix is four lines. The ceremony is thirty pages of architecture documentation.

### The `catalog.*` rename is architecturally pure and operationally expensive.

The argument for renaming `menu.*` to `catalog.*` is correct: `catalog` is a better conceptual name for the domain that manages all sellable items. A restaurant has a catalog from which menus are composed.

The cost: every query in the codebase references `menu.categories`, `menu.items`, `menu.item_variants`. There are likely 200+ references across route files, services, and utility functions. A schema rename requires:
1. A migration that renames the schema (one line)
2. Updating every single query (200+ changes)
3. Updating every frontend API client reference (if exposed in responses)
4. Updating all documentation

The user-facing benefit: zero. Operators never see schema names.
The developer benefit: future engineers find the name `catalog` more accurate than `menu`.

For a solo founder, this is a two-day rename of something that was never causing bugs. It is architectural housekeeping optimized for a team that does not yet exist.

**Verdict: correct direction, wrong time. Rename when the `menu.*` limitation actually causes a developer to make a mistake. Not before.**

---

## ATTACK 5 — PLATFORM SERVICES THAT SHOULD BE UTILITIES

### Audit should be a middleware function, not a service.

The document proposes:
```
Audit.log({ tenantId, actorType, actorId, action, entityType, entityId, before, after })
```

`utils/audit.js` already does this. The function is called at mutation points. It writes to `platform.audit_log`. This is correct and complete as a utility.

Making it a "Service" implies it could be extracted, versioned, or contracted against. Audit logging will never be extracted from the monolith at this scale. Making it a service does not add capability — it adds naming ceremony.

### Encryption should be a module export, not a service.

`utils/crypto.js` exists. It does AES-256 encrypt/decrypt. It is called when reading/writing integration secrets. This is correct. It does not need to become `Encryption.encrypt()` with a formal service interface.

### Media should be a middleware + utility, not a service.

Image upload is a multipart POST handler + a call to object storage. At 100 restaurants, this is `utils/media.js` or middleware. Making it a `MediaService` with a formal interface implies it will have multiple implementations, versioned contracts, or consumer agreements. It will not.

### Compliance should be route handlers + utility, not a service.

DPDP compliance is: two API endpoints (`/data-request`, `/export`) + utility functions to write consent records. The existing infrastructure (`platform.export_jobs`, `customer.consent_history`) is correct. Making this a `Compliance` service interface is over-formalized for what amounts to three functions and two admin endpoints.

**Rule: if a "service" will never have more than one implementation, will never be dependency-injected, and will never be tested with a mock — it is a utility, not a service.**

---

## ATTACK 6 — EVENT-DRIVEN PATTERNS TO DEFER

The following events from the canonical document should remain **synchronous function calls** for the next 18 months:

| Canonical Event | Simpler Alternative |
|---|---|
| `order.created → Communications.send()` | Call `sendOrderConfirmation(order)` at end of order creation |
| `order.created → Intelligence` | Write to `intelligence.daily_metrics` in a 5-minute cron job |
| `order.created → Loyalty.earn()` | Call `awardPoints(customerId, orderTotal)` at end of order creation |
| `payment.captured → Ordering.advance()` | Wrap both in one database transaction |
| `reservation.confirmed → Communications.send()` | Call `sendReservationConfirmation(reservation)` inline |
| `lead.converted → Ordering.create()` | Call `OrderService.create()` directly in the lead conversion handler |
| `session.closed → Intelligence` | Same cron job approach as order metrics |
| `customer.created → Communications.send()` | Call `sendWelcomeMessage(customer)` inline |

In every case: a synchronous function call in the appropriate service handler is simpler, debuggable in a stack trace, testable with standard mocks, and zero-infrastructure.

The event bus should be reserved for its current correct use: **external webhook delivery**. That is the one place where async, retry-capable, outbox-backed delivery is genuinely necessary. Everything else can be synchronous until it cannot.

---

## ATTACK 7 — RECOMMENDATIONS THAT SLOW VELOCITY

### The four-sprint migration plan.

Sprint 1: 2 weeks. Sprint 2: 3 weeks. Sprint 3: 4 weeks. Sprint 4: ongoing.

That is nine weeks of architectural work before the product changes for operators.

During those nine weeks:
- No new menu features
- No improvements to the reservation flow
- No notification automation (deferred to Sprint 3)
- No customer-facing improvements

A restaurant operator does not care that orders are created through a unified `OrderService`. They care whether their kitchen gets the order in time.

**The right approach for 100 restaurants: Sprint 1 only (2 weeks of bug fixes), then build product.**

### The canonical API route structure.

Restructuring routes to `/catalog/`, `/dining/sessions/`, `/intelligence/` is clean domain naming. It is also a two-week migration that breaks every existing frontend API call, invalidates all existing API documentation, and changes nothing operators experience.

**Defer indefinitely. Prefix new routes correctly. Do not rename existing routes that work.**

### The dashboard navigation restructure.

SERVE / SELL / KNOW / BUILD / MANAGE is a better information architecture than the current grouping. It is also a UX change that requires updating the dashboard router, the nav component, the hash routing table, and re-verifying every view.

At 100 restaurants, operators are learning KRAVON's current navigation. Changing it mid-adoption creates support load for zero revenue gain.

**Defer until user research shows the current navigation is a friction point.**

---

## ATTACK 8 — ELEGANT BUT COMMERCIALLY UNNECESSARY

### The `Benchmark` entity in Intelligence.

`Benchmark` stores anonymized cross-tenant metrics: "your revenue is X% above similar restaurants." This is a beautiful feature. It requires:
- Aggregating across all tenants (privacy implications)
- Defining "similar restaurants" (clustering problem)
- Keeping the data fresh (background job)
- Presenting it meaningfully in the UI (data visualization problem)

At 100 restaurants, you have sample sizes too small for meaningful benchmarking. The feature is architecturally forward-thinking and commercially irrelevant until at least 500 restaurants.

### The `MenuView` implicit engagement signal.

`MenuView` tracks which items were viewed by which customer in which session. This enables "most-viewed items" analytics, implicit preference learning, and future personalization.

This requires: capturing view events on the customer-facing menu surface, linking them to customer identity at the session level, storing them efficiently (high volume), and actually using them in a meaningful recommendation or insight.

At 100 restaurants with basic analytics needs, this is surveillance infrastructure with no dashboard consumer. It adds tracking complexity to the menu surface for a signal nobody is reading.

### The `CustomerIdentity` entity as a separate deduplication table.

The canonical document proposes `CustomerIdentity` as a separate entity for "alternative lookup keys" — verified phone, verified email — used for deduplication.

At this scale, customer identity is: one phone number per customer per tenant. `UNIQUE(tenant_id, phone)` on the customers table is the entire identity resolution system. A separate `CustomerIdentity` table adds a join on every customer lookup to solve a problem that a unique constraint already solves.

`CustomerIdentity` becomes necessary when:
- A customer can have multiple phones
- A customer can switch phones
- Identity must survive phone number changes
- OAuth identity must be linked to the same customer

None of these are problems at 100 restaurants. The unique constraint is sufficient.

### The nine-section Platform Services layer.

EventBus, Communications, Audit, FeatureFlags, Metering, Encryption, Compliance, Media — eight formal platform services with defined interfaces.

Six of these are `utils/` files. Two of them (EventBus for external webhooks, Audit) are already implemented correctly. The naming ceremony of calling them "Platform Services" adds documentation overhead with no implementation change.

---

## ATTACK 9 — WHAT A PRAGMATIC FOUNDER WOULD DO DIFFERENTLY

A pragmatic founder building for the first 100 restaurants makes three different bets than the architect:

**Bet 1: Correctness over elegance.**
The architect wants nine clean domains with formal ownership. The founder wants zero duplicate orders, correct payment capture, and a kitchen that shows all orders. Fix the three bugs. Ship. Do not refactor the architecture.

**Bet 2: Customer feedback over theoretical completeness.**
The architect proposes Loyalty, Inventory, Staff Scheduling, Multi-location, Developer API as future modules. The founder does not know which of these the first 100 restaurants will actually pay for. Build zero of them until five restaurants ask for the same thing.

**Bet 3: Speed of iteration over purity of abstraction.**
The architect wants a single `OrderService` that all order creation paths go through. The founder wants to be able to add a new order channel in a day. A unified service makes that faster if the service is already built. It makes that slower if building the service is the prerequisite to shipping the channel.

**What a pragmatic founder builds differently:**

1. **No schema renames.** `menu.*` stays `menu.*`. The schema name has never caused a bug. Renaming it causes 200 query changes and two days of work.

2. **No domain extraction.** `tenant.staff` stays where it is. Identity extraction is a 24-month problem.

3. **Cron jobs before background job infrastructure.** Insights aggregation is a pg-cron job or a setInterval in the server. It does not need a worker process, a job queue, or retry infrastructure. Not yet.

4. **One function, not one service.** `findOrCreate` is in `utils/customer.js`. Not `CustomerService`. The distinction matters because "service" implies interface, contract, and abstraction. A utility implies: it does one thing, call it.

5. **Four bugs fixed before any refactoring.** Idempotency. Payment atomicity. Kitchen channels. Presence transaction. These are production correctness issues. They ship before any of the architectural work.

6. **Notification automation is a feature, not a platform.** Wire WhatsApp confirmations with a direct provider call in the order handler. It is ten lines of code and `axios.post(whatsappApi, ...)`. The Communications service, template engine, and multi-channel dispatch is what WhatsApp looks like after 10,000 restaurants. At 100 restaurants, it looks like a function call.

---

## ATTACK 10 — IF YOU HAD TO CUT 30%

Remove these from the canonical architecture entirely:

1. **All formal service interfaces** (Communications, Audit, Encryption, Compliance, Media, Metering, FeatureFlags as `Service` pattern). Keep the functionality. Demote to `utils/`.

2. **Intelligence as a domain**. It is a reporting module. Its schema is correct. Its domain status is not.

3. **Catering as a domain**. It is a module. Demote it.

4. **Payment as a standalone domain**. Merge back into Ordering's service layer.

5. **The canonical API route restructure** (`/catalog/`, `/dining/sessions/`, etc.). Defer permanently.

6. **`CustomerIdentity` as a separate entity**. Replace with `UNIQUE(tenant_id, phone)`.

7. **`MenuView` implicit engagement tracking**. Remove until someone asks for it.

8. **`Benchmark` entity in Intelligence**. Remove until 500 restaurants.

9. **The internal event bus for all cross-domain communication**. Keep external webhook outbox. Make everything else a function call.

10. **Schema renames** (`menu.*` → `catalog.*`, `notifications.*` cleanup as a sprint). Do the cleanup. Do not make it a sprint.

What remains after the 30% cut:
- Five domains (Tenant, Catalog, Ordering, Dining, Customer)
- Three utilities elevated from utils (findOrCreate, OrderService functions, audit logging)
- Intelligence as a reporting module with a cron aggregation job
- Communications as a utility with a `comms.*` schema
- Catering as a module with its own schema
- Four correctness fixes before anything else
- Dashboard navigation cleaned up opportunistically

---

## PART A — THE IDEAL ARCHITECTURE

*Correct for 100 restaurants. Designed to survive 10,000.*

**Five Core Domains:**

| Domain | Owns |
|---|---|
| Tenant | Restaurant config, plan, integrations, settings, feature flags |
| Catalog | All sellable items, menus, availability, surface visibility |
| Ordering | Orders, items, discounts, taxes, delivery, order lifecycle |
| Dining | Tables, sessions, reservations, waitlist, reviews |
| Customer | Identity, loyalty, consent, interaction log |

**Three Domain-Adjacent Modules (have their own schemas, not core domains):**

| Module | Built On |
|---|---|
| Catering | Customer + Ordering |
| Intelligence | Ordering + Dining + Customer (event-fed aggregation) |
| Identity/RBAC | Tenant (staff, roles, permissions — promoted to own schema when multi-tenant identity is needed) |

**Platform Utilities (utils/, not services):**

- `utils/comms.js` — sends messages via WhatsApp/SMS/email. Has `comms.*` schema.
- `utils/audit.js` — logs mutations to `platform.audit_log`
- `utils/crypto.js` — AES-256 encrypt/decrypt
- `utils/events.js` — writes to `platform.event_outbox` for external webhooks
- `utils/features.js` — checks `tenant.feature_flags`

**Schema Map:**

```
tenant.*        — restaurant, location, settings, plan, feature_flags, integrations, domains
catalog.*       — menus, categories, items, variants, customizations, combos, availability
orders.*        — orders, order_items, customizations, taxes, discounts, delivery_jobs,
                  order_events, payments, payment_events, coupons
dining.*        — tables, sessions, reservations, waitlist, reviews
customer.*      — customers, addresses, loyalty_accounts, loyalty_transactions,
                  consent_history, interaction_log
catering.*      — leads, lead_notes, events, event_days, quotes, quote_items, packages
intelligence.*  — daily_metrics, item_performance, review_summary, customer_segments
comms.*         — templates, outbound, staff_feed, engagement
platform.*      — event_outbox, audit_log, schema_migrations, export_jobs, data_requests,
                  webhooks, webhook_deliveries, api_keys, usage_events, usage_ledger
```

**Note:** `payments.*` merged into `orders.*` — they are the same domain at this scale.

**API Routes:** No restructure from current. Add new routes correctly namespaced. Do not rename working routes.

**Event bus:** External webhooks only. All internal side effects are synchronous function calls.

**Aggregation:** One pg-cron job or Node setInterval that populates `intelligence.daily_metrics` nightly.

---

## PART B — THE MINIMUM VIABLE ARCHITECTURE

*The smallest coherent architecture that prevents the worst outcomes.*

**Fix these four things. Nothing else is architecture. Everything else is features.**

**1. Idempotency on order creation.**
`orders.orders` gets an `idempotency_key` column with a `UNIQUE(tenant_id, idempotency_key)` index. Client sends a UUID. Duplicate request returns existing order.

**2. Payment webhook atomicity.**
The Razorpay webhook wraps `payments.payments` update AND `orders.orders.payment_status` update in a single transaction. One fails, both fail, Razorpay retries.

**3. Kitchen shows all channels.**
One `GET /kitchen` endpoint that returns all active orders regardless of channel. Two lines of SQL change.

**4. `findOrCreate` for customers.**
One function. Four lines. No more duplicate customer records. Call it everywhere a customer is created.

**That is the MVA. Everything else is a feature decision, not an architecture decision.**

If you ship these four fixes and nothing else from either architecture document, KRAVON is:
- Correct (no duplicate orders, no lost payments)
- Operationally coherent (kitchen sees all orders)
- Data-clean (one customer record per person)

The rest is preference.

---

## PART C — THE ARCHITECTURE YOU WOULD ACTUALLY BUILD FOR 12 MONTHS

*Pragmatic. Incremental. No rewrites. No sprints dedicated to architecture.*

**Month 1-2: Correctness**

Ship the four MVA fixes. They are bugs. Fix bugs before anything else.

Additionally:
- Wrap `PATCH /presence` in a transaction (30 minutes)
- Rename `notifications.notifications` → `notifications.staff_feed` in one migration (1 hour)
- Delete `inventory.*` (30 minutes)
- Unify feature flag checks to use `tenant.feature_flags` table (1 day)

**Month 2-4: Single Source of Truth**

Extract order creation logic into `services/order.service.js`. Not because of domain ownership theory. Because in month 3 you will want to add loyalty points to orders and you will not want to add that logic in two places.

Add `utils/customer.js` with `findOrCreate`. Wire it into order creation, dine-in session, reservation creation.

Split `dine-in.js` into three files. This is a velocity fix, not an architecture fix.

**Month 3-5: Notifications**

Wire WhatsApp order confirmations. Direct provider call in the order completion path. Not a Communications service. Not a template engine. A function that sends a WhatsApp message.

Wire reservation confirmations the same way.

Add to `comms.outbound` for delivery tracking and debugging.

When you have five different notification types, extract to a template-based system. Not before.

**Month 4-6: Intelligence**

Write a nightly pg-cron job that populates `intelligence.daily_metrics` from `orders.*`. Update `/insights/summary` to read from the pre-aggregated table. Add today's partial data via a fast live query.

Add `platform.audit_log` monthly partitioning.

**Month 6-9: Product**

Build what paying restaurants ask for.

If five restaurants ask for loyalty: build the loyalty module on top of `customer.loyalty_accounts` (schema already exists).

If five restaurants ask for better reservations: build table assignment + session auto-open.

If five restaurants ask for catering quotes: build the quote builder.

Do not build features speculatively. Build what restaurants are paying for.

**Month 9-12: Platform Primitives (only if growing)**

If you have 50+ restaurants and a second engineer:
- Extract `identity.*` from `tenant.*`
- Build the internal event bus for Communications and Intelligence
- Design the `catalog.*` rename and execute it
- Build the Plan & Billing self-service view

If you are still solo: skip all of this. Keep shipping product.

**The 12-month schema state:**

Same as today, minus `inventory.*`, plus:
- `idempotency_key` on `orders.orders`
- `findOrCreate` unique constraint on `customer.customers`
- Monthly partitions on `platform.audit_log`
- `notifications.staff_feed` (renamed)
- `intelligence.daily_metrics` being populated by a cron job
- `comms.outbound` being written to on every notification sent

That is the full schema delta. No renames. No schema moves. No domain extractions.

**The 12-month code state:**

- `services/order.service.js` — unified order creation
- `utils/customer.js` — findOrCreate
- `routes/sessions.js`, `routes/kitchen.js`, `routes/dining-orders.js` (split from dine-in.js)
- `jobs/aggregate-daily-metrics.js` — nightly cron
- Direct notification calls in order and reservation handlers

That is 5 new files and 3 refactored files. Not a rewrite.

---

## THE FIVE BIGGEST MISTAKES FROM FOLLOWING CANONICAL_ARCHITECTURE.MD TOO LITERALLY

### Mistake 1: Treating architectural work as product work.

The canonical document describes nine sprints of migration work. If a founder treats this as the product roadmap, they will spend six months making code cleaner for future engineers who do not yet exist, while restaurants wait for features they are asking for today.

Architecture is infrastructure for product velocity. If the architecture work does not result in product shipping faster, it was the wrong architecture work at the wrong time.

### Mistake 2: Waiting for the event bus before building notifications.

The document implies that notification automation should be built as part of the Communications service, which should listen to domain events from the event bus. A literal reading means: you cannot have WhatsApp order confirmations until you have a working internal event bus.

The internal event bus is a P2 item. WhatsApp confirmations are a P1 item. A restaurant that does not get order confirmations is a restaurant that churns.

**Do not let infrastructure design block product delivery.**

### Mistake 3: Renaming things that work before the team exists to benefit from the names.

`menu.*` → `catalog.*`. `notifications.*` consolidation. API route restructure. All of these are documentation benefits — they make the codebase more readable for future engineers.

There are no future engineers yet.

The cost of renaming is real (200 query changes, 2 days of work, potential bugs in the rename). The benefit is theoretical (future engineers find the names cleaner). At a solo stage, this trade is always wrong.

Rename when the old name causes a real engineer to make a real mistake. Not before.

### Mistake 4: Treating "domain" as a status symbol.

The canonical document elevates Intelligence, Catering, and Payment to domain status. A literal reading means these get the same treatment as Ordering and Customer: formal ownership, service interfaces, event contracts, no direct cross-domain writes.

Payment is three tables. Catering is a CRM form. Intelligence is a reporting module. Giving them domain status means a future engineer spends time designing "what events does Intelligence emit?" and "who can mutate Payment entities?" — questions with obvious answers that do not need architectural ceremony.

Not everything that has its own schema needs to be a domain. Schema boundaries are an organizational convenience. Domain boundaries are a conceptual commitment. Know the difference.

### Mistake 5: Building the architecture for the team you want instead of the team you have.

CANONICAL_ARCHITECTURE.md is designed for a team of engineers working in parallel, who need formal contracts to prevent stepping on each other, who need domain ownership rules because multiple people mutate the same data.

That team does not exist yet.

The document's domain ownership rules ("no domain writes to another domain's tables"), formal event contracts, and service interfaces only pay off when violated — which requires multiple engineers working simultaneously on the same codebase.

Solo, these rules are overhead. You know where everything is. You wrote everything. The discipline that prevents teams from breaking each other is unnecessary friction when you are not yet a team.

Build the architecture for the team you have. Build the migration path for the team you will have.

The architecture you need in 24 months should be derivable from the architecture you build today — not a rewrite of it. The canonical document gets this right in principle. The mistake is building all of it now.

---

## FINAL VERDICT

CANONICAL_ARCHITECTURE.md describes the right destination.

It describes the wrong journey.

The destination — nine canonical domains, formal event contracts, platform services, module architecture — is where KRAVON should be at 1,000 restaurants with a six-person engineering team.

The journey — four sprints of migration work, schema renames, API restructuring, service interface design — is the wrong path for a solo founder at zero to 100 restaurants.

**The right journey:**

Fix the four correctness bugs. Build one service (OrderService). Add one utility (findOrCreate). Everything else is a feature or a deferral.

Architecture that ships slowly is architecture that gets replaced before it matters.

The best architecture for KRAVON right now is: the one that exists today, with four bugs fixed, that lets a founder spend the next six months talking to restaurants instead of talking to code.

---

*The canonical document should be on the wall, not in the sprint.*
