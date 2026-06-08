# Frontend ↔ Backend Exposure Audit
**Kravon Restaurant SaaS Platform**
**Date:** 2026-06-08

---

## Audit Methodology

Five simultaneous lenses:
- **Product Architect** — system-level consistency, duplication, SSoT
- **API Designer** — contract stability, shape uniformity, versioning risk
- **Frontend Engineer** — consumption patterns, waterfall calls, shape ergonomics
- **Restaurant Operator** — workflow completeness, UX dead-ends
- **Customer** — ordering UX, error recovery, trust signals

---

## A. Operator Workflows

### A1. Onboarding / Settings
- `PATCH /presence` covers brand, social, gallery, story — well-structured
- No authenticated `GET /config/settings` for the settings form to boot from; dashboard reads from `GET /config` (public endpoint) to populate forms — tenant_id, capabilities.plan, GSTIN, and Razorpay key_id are all in the public response
- `bustConfigCache` must be called after every write; currently only `PATCH /presence` and menu writes call it; settings writes (`PATCH /settings/restaurant`, `PATCH /settings/notifications`) do not
- **Missing endpoint:** `GET /settings` (authenticated) that returns only operator-visible config without sensitive/public info commingled

### A2. Menu Management
- `GET /menu`, `POST /menu/items`, `PATCH /menu/items/:id`, `DELETE /menu/items/:id` — complete CRUD
- `GET /config` returns `flatItems` + `categories` — same items in two shapes, duplication not needed
- `is_customizable` (boolean) + `customise` (boolean) on every menu item — identical semantics, two fields
- `getItemDetail` fires 1 (item) + 1 (variants) + 1 (groups) + N (options per group) queries sequentially — N+1 pattern degrades at 4+ modifier groups

### A3. Order Management
- `GET /orders` returns `id`, `status`, `total`, `channel`, `created_at` — **missing** `items`, `payment_method`, `table_identifier`
- `GET /orders/:id` returns full order — frontend must make per-order calls for details, preventing a useful order list view
- `POST /orders` (online) response shape differs from `POST /dine-in/order` response shape for same conceptual object
- No server-sent events or polling endpoint for order status changes — frontend must poll at interval

### A4. Kitchen View
- `GET /dine-in/kitchen` returns `{ tables, queue }` — functional
- Missing `bill_requested` flag on table object — kitchen/floor staff have no visibility into which tables have requested the bill
- Missing `order_count` per table in summary — staff must count queue items manually
- No distinction between new/in-progress orders in queue response

### A5. Tables & Sessions
- `GET /tables` returns tables with `session` embedded — good
- `GET /tables/sessions` returns active sessions — **redundant** with `GET /tables`; callers read `tables[].session`
- `POST /tables/sessions` opens a session; `DELETE /tables/sessions/:id` closes — complete
- `GET /dine-in/session?table_id=` + `GET /dine-in/session/:id/orders` — 2 sequential calls to boot QR scanner; customer waits for both before seeing menu

### A6. Catering / Leads
- `POST /leads` returns `tier` (internal scoring field) to public submitter — information leak
- `lead.status_updated` review request fires when `status === 'converted'` in listener, but `catering/service.js` sets `status = 'confirmed'` — review emails never fire for catering confirmations
- `custom_fields` JSONB stores `score`, `tier`, `ref`, `budget`, `headcount` — these should be top-level columns for queryability and index support

### A7. Customers / CRM
- `GET /customers` returns `id`, `name`, `phone`, `email`, `created_at` — **missing** `total_spend`, `order_count`, `last_order_at`
- Customers with orders appear in list; customers without do not — no distinction
- DPDP endpoints (`DELETE /customers/:id/data`, `POST /customers/:id/anonymize`) correctly gated to `owner`/`admin` roles

### A8. Insights
- `GET /insights/orders` runs two queries (orders + reservations) and merges in JS — should be one pivoted SQL query; current approach can miss rows if ordering differs
- `unique_customers` in summary is actually a sum of daily new acquisitions, not a `COUNT(DISTINCT customer_id)` across the period — misleading label
- Inline SQL in `insights.js` route for leads (`leadsRes` query) — business logic in route layer, not service

---

## B. Customer Workflows

### B1. Online Ordering
- `GET /config` (public) → menu boot; `POST /orders` → order creation — minimal, functional
- `POST /orders` rate limit: 30/min per tenant — correct scope
- Idempotency key: column and unique index added in v23 migration — customer can safely retry
- No order status polling endpoint exposed to customer — no way to show "confirmed / preparing / ready"
- No `GET /orders/:id` for customer (unauthenticated); confirmation page has no data after redirect

### B2. QR / Dine-In
- Customer scans QR → `GET /dine-in/session?table_id=` (session status) → `GET /dine-in/session/:id/orders` (existing orders) — **2 sequential network calls** before menu is interactive
- Should be: `GET /dine-in/session?table_id=` returns `{ status, session, orders }` — single call
- `POST /dine-in/order` idempotency: no idempotency key on dine-in orders — double-tap on mobile can duplicate
- Bill request: `POST /dine-in/session/:id/bill-request` exists but no polling endpoint for request status

### B3. Reservations
- `POST /reservations` returns internal UUID to customer — not useful; should return confirmation number
- `POST /reservations` has no rate limiting — reservation spam possible
- No `GET /reservations/:id` for customer to check their booking status

### B4. Catering Inquiry
- `POST /leads` returns `tier` (internal score) — strip before response
- No confirmation email trigger documented for lead submission (review request fires on confirmation, not submission)

---

## C. Endpoint Consistency

| Area | Create | Read (list) | Read (detail) | Update | Delete |
|------|--------|-------------|---------------|--------|--------|
| Menu items | POST /menu/items | GET /menu | GET /menu/items/:id | PATCH /menu/items/:id | DELETE /menu/items/:id |
| Orders | POST /orders | GET /orders | GET /orders/:id | PATCH /orders/:id/status | — |
| Leads | POST /leads | GET /leads | GET /leads/:id | PATCH /leads/:id | — |
| Tables | POST /tables | GET /tables | — | PATCH /tables/:id | DELETE /tables/:id |
| Staff | POST /staff | GET /staff | — | PATCH /staff/:id | DELETE /staff/:id |
| Customers | — | GET /customers | GET /customers/:id | — | DELETE /customers/:id/data |
| Reviews | POST /reviews | GET /reviews | — | PATCH /reviews/:id | — |

**Gaps:**
- `GET /tables/:id` missing — can only read a table through the full list
- `GET /staff/:id` missing — same issue
- Customers have no create path (auto-created from orders) but no explicit documentation of this

### Response Shape Inconsistencies

- `POST /orders` → `{ order }` (nested)
- `POST /dine-in/order` → `{ orderId, status, ... }` (flat) — same concept, different envelope
- `GET /orders` list → no items; `GET /orders/:id` detail → full items
- `POST /leads` → `{ lead, tier }` — tier is internal
- `POST /reservations` → raw UUID
- Error responses: some return `{ error: string }`, some return `{ error, details }`, some return `{ message }` — no consistent shape

---

## D. Frontend Consumption Patterns

### D1. Boot Sequence (Operator Dashboard)
```
1. POST /auth/refresh           — get access token
2. GET  /config                 — tenant + menu + settings (396 lines)
3. GET  /tables                 — table layout
4. GET  /orders?status=pending  — active orders
```
Step 2 returns the full public config including menu — redundant for operator who already knows the menu. A separate `GET /settings` for operator settings would separate concerns.

### D2. Boot Sequence (QR Customer)
```
1. GET /config                          — full menu + tenant info
2. GET /dine-in/session?table_id=X      — session status
3. GET /dine-in/session/:id/orders      — existing orders on session
```
Calls 2 and 3 are sequential (need session ID from call 2 to make call 3). This is a 3-call waterfall before the customer can order. Merging calls 2+3 removes one RTT.

### D3. Kitchen Polling
Frontend polls `GET /dine-in/kitchen` every 5s. No ETag or `Last-Modified` support — every poll returns full payload regardless of changes. At 10 active tables × 5s = ~120 req/min/kitchen screen.

### D4. Config Cache
Config is cached in-memory with 60s TTL. `bustConfigCache(tenantId)` invalidates immediately. After menu or presence writes, config is stale for up to 60s if bust is not called. Currently only presence and menu routes call bust; settings routes do not.

---

## E. Operator Projection (What operators see vs. what they need)

| Feature | Available | Missing |
|---------|-----------|---------|
| Order list | status, total, channel | items, payment method, table |
| Kitchen | queue, table list | bill_requested flag, order count per table |
| Customer list | name, phone, email | spend, order count, last order |
| Insights summary | revenue, orders, leads | correct unique customer count |
| Lead pipeline | stage, notes | direct columns for budget/headcount |
| Settings form | writes work | no clean read endpoint, public config used |

---

## F. Customer Projection (What customers see vs. what they need)

| Touchpoint | Available | Missing |
|------------|-----------|---------|
| Order confirmation | orderId | order status after submission |
| QR ordering | table context | session order history in single call |
| Reservation | raw UUID | human confirmation number |
| Catering form | submission accepted | confirmation email on submission |

---

## G. Redundancy and Duplication

1. **`flatItems` + `categories`** in `GET /config` — same menu items in two shapes. `flatItems` is a flat array by category; `categories` is nested with items. Frontend only needs one.
2. **`is_customizable` + `customise`** on every menu item — both boolean, identical value. Remove `customise`.
3. **`GET /tables/sessions`** redundant with `GET /tables` — sessions are embedded in table objects.
4. **Notification listener re-queries order** — `notification.listeners.js` re-fetches the full order from DB on every `order.created` event even though the payload already has all required fields.
5. **Two-query merge in `getOrdersByDay`** — could be a single pivoted query.
6. **`getItemDetail` N+1** — 1 query per modifier group for options.

---

## H. Single Source of Truth Analysis

| Data | SSoT Location | Risk |
|------|--------------|------|
| Restaurant name | `tenant.restaurants.name` | Also in `hero.headline` via presence — can drift |
| Hero image | `brand.assets WHERE type='banner'` | Also in `settings.hero_image` — two write paths |
| Story | `settings.presence.story` | Fallback reads `settings.story_headline` + `settings.story_body` — legacy fields not cleaned up |
| Social links | `brand.contact_links` | WhatsApp also computed from `wa_number` on restaurant row |
| Config | DB → in-memory cache (60s TTL) | Cache not busted on settings writes |
| Lead scoring | `custom_fields.score` / `custom_fields.tier` | Should be `leads.score`, `leads.tier` columns |

---

## Top 20 Improvements (Ranked by Impact / Effort)

| # | Finding | Impact | Effort | Fix |
|---|---------|--------|--------|-----|
| 1 | Catering review request bug (`'converted'` vs `'confirmed'`) | High | 1 min | Change condition in `notification.listeners.js:178` |
| 2 | QR boot 2→1 call | High | 2 hrs | Merge session status + orders into single response |
| 3 | `getItemDetail` N+1 | High | 2 hrs | Single LEFT JOIN for groups + options |
| 4 | Orders list missing items/payment/table | High | 1 hr | Add JOIN to orders list query |
| 5 | `POST /leads` leaks `tier` | Medium-High | 15 min | Remove `tier` from create response |
| 6 | `unique_customers` misleading label | Medium | 30 min | Rename or fix to real DISTINCT count |
| 7 | Dine-in order idempotency missing | Medium | 1 hr | Add `idempotency_key` to `POST /dine-in/order` |
| 8 | Reservations no rate limit | Medium | 30 min | Add `rateLimit` middleware to POST /reservations |
| 9 | `GET /tables/sessions` redundant | Low-Med | 15 min | Deprecate; document sessions are in tables[] |
| 10 | `flatItems` + `categories` duplication | Low-Med | 1 hr | Return only `categories`; remove flatItems |
| 11 | `is_customizable` + `customise` duplication | Low | 15 min | Remove `customise` field from item projection |
| 12 | Notification listener re-queries order | Low-Med | 30 min | Use outbox payload fields directly |
| 13 | `bustConfigCache` not called in settings writes | Medium | 30 min | Add bust call to `PATCH /settings/restaurant` and `/notifications` |
| 14 | `tenant_id` + `capabilities.plan` in public config | Medium | 1 hr | Move to authenticated settings endpoint |
| 15 | `custom_fields` score/tier/budget/headcount not columns | Low-Med | 2 hrs | Migration + repo update for lead scoring |
| 16 | Customers list missing spend/count/last_order | High UX | 1 hr | Add aggregation query to customer list |
| 17 | `kitchen` missing `bill_requested` flag | High UX | 30 min | Add to kitchen query and response |
| 18 | Response shape inconsistency (order create) | Medium | 1 hr | Unify `POST /orders` and `POST /dine-in/order` envelope |
| 19 | Legacy story fields (`story_headline`, `story_body`) not cleaned up | Low | 30 min | Migration to move to `presence.story`, remove fallbacks |
| 20 | Inline SQL in insights route (`leadsRes`) | Low | 30 min | Move to `intelligence/service.js` |

---

## Summary

The platform is architecturally sound — DDD structure, thin routes, service layer, event outbox, transaction safety all in place. The issues are concentrated in three clusters:

**Data exposure:** Public config leaks internal fields; leads response leaks scoring tier; misleading metrics label.

**Waterfall / N+1 patterns:** QR boot, getItemDetail, orders list detail, kitchen polling — all addressable with targeted JOIN or endpoint merges.

**Duplication / drift:** flatItems+categories, is_customizable+customise, legacy story fields, redundant sessions endpoint — each exists because new structure was added without removing the old.

None of these require architectural changes. The highest-ROI single fix is item #1 (catering review bug) — 1 line, restores a revenue-impacting notification flow that has been silently broken.
