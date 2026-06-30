# Kravon Codebase — Complete Production Code Review

**Reviewed:** Backend (100%), Frontend dashboard JS (sampled), Schema (100%)
**Date:** 2026-07-01
**Reviewer:** Claude Sonnet 4.6 (max-effort local review)

---

## Executive Summary

Kravon is a well-structured solo-built SaaS platform with disciplined patterns throughout — consistent multi-tenancy, Zod validation on all write paths, transactional discipline in most places, and appropriate fire-and-forget architecture for notifications. For a solo founder's first production system, this is genuinely strong work.

However, the review found **8 Critical and 12 High severity issues**, several of which involve real production data corruption risk and active security vulnerabilities. The most dangerous cluster is a **pricing data integrity issue** (delivery fee divided by 100 in config but used raw in order creation), two **missing tenant_id filters** in SQL (cross-tenant data exposure), a **premature invoice snapshot** (stale data baked into finalized invoices), and a **double WhatsApp notification** firing on every order. These must be fixed before meaningful production load.

The platform is **not safe to scale** without addressing the Critical/High issues. Once those are fixed, it's solid enough to operate real restaurants at moderate volume.

---

## Scores

| Dimension | Score | Rationale |
|-----------|-------|-----------|
| **Architecture** | 8/10 | Excellent modular monolith. Clean domain separation. Outbox pattern is right. Event bus well-scoped. |
| **Code Quality** | 7/10 | Consistent patterns, good Zod coverage. Several partial transaction wraps and copy-paste accumulation. |
| **Production Readiness** | 5/10 | Critical pricing bug, cross-tenant SQL gap, double notifications, and PII logging active in production. |
| **Security** | 6/10 | Strong crypto, bcrypt, HMAC webhook. But: Razorpay secret on every req.tenant, no refresh token rate limit, PII logged to stdout. |
| **Scalability** | 6/10 | Acceptable at 100 tenants. CORS thundering herd and LIMIT-less exports will break at scale. Kitchen 200-order cap is a near-term operational ceiling. |
| **Maintainability** | 8/10 | Very clean for a solo project. Minimal duplication. Good file organization. Event bus makes channels easy to add. |

---

## Top 25 Issues (Ranked by Severity)

---

### CRITICAL

---

**Issue 1 — Delivery fee pricing inconsistency (data corruption)**
- **File:** `api/routes/config.js`, `domains/ordering/service.js`
- **Function:** `buildConfig()` vs `createOnlineOrder()`
- **Problem:** `config.js` divides `delivery_fee` and `free_delivery_above` by 100 before returning them to the frontend (`deliveryFee: r.delivery_fee / 100`). But `ordering/service.js` reads `tenant.delivery_fee` directly from `req.tenant` (built by `buildTenant()` which reads the raw JSONB value). If the DB stores `3900` (paise-style), the customer's cart shows ₹0.39 but the order is charged ₹3900.
- **Why critical:** Every delivery order with a configured fee charges the wrong amount. Also breaks the `free_delivery_above` threshold logic.
- **Real scenario:** Restaurant enters delivery fee as ₹39. DB stores `39`. Config shows ₹0.39 to customer. Order charges ₹39. Customer sees ₹0.39 on the menu, gets charged ₹39. Chargeback risk, trust destruction.
- **Fix:** Determine the canonical unit (paise or rupees), store consistently, and divide/multiply in exactly one place.

---

**Issue 2 — GST calculation uses floating point (paise invariant violation)**
- **File:** `domains/ordering/service.js`
- **Function:** `_calculateOrderTotals()`
- **Problem:**
  ```js
  taxAmount = parseFloat((subtotal * totalRate / 100).toFixed(2)); // float
  const total = subtotal + deliveryFee + taxAmount; // float addition
  ```
  Violates the documented paise invariant. Floating point rounding accumulates across many orders. Tax misreporting is a GST compliance issue.
- **Fix:** Convert everything to integer paise before arithmetic. Use `Math.round(subtotal * totalRate / 100)` in paise.

---

**Issue 3 — `confirmByRazorpayOrderId` has no tenant_id filter (cross-tenant)**
- **File:** `domains/ordering/repository.js`
- **Function:** `confirmByRazorpayOrderId()`
- **Problem:**
  ```sql
  WHERE metadata->>'razorpay_order_id' = $2
    AND status = 'pending'  -- no tenant_id filter
  ```
  A crafted webhook payload could confirm a pending order belonging to a different tenant.
- **Why critical:** Cross-tenant order manipulation via payment webhook. Financial and data integrity.
- **Fix:** Add `AND tenant_id = $1` to the WHERE clause.

---

**Issue 4 — `updatePaidPaise` missing tenant_id filter (cross-tenant)**
- **File:** `domains/billing/repository.js`
- **Function:** `updatePaidPaise()`
- **Problem:**
  ```sql
  WHERE id = $1  -- missing AND tenant_id = $2
  ```
  Settlement payment updates are unscoped. A settlement ID from one tenant could manipulate another tenant's settlement.
- **Fix:** Add `AND tenant_id = $2` and pass `tenantId` as second parameter.

---

**Issue 5 — Invoice snapshot built outside transaction (stale data in finalized invoices)**
- **File:** `domains/billing/service.js`
- **Function:** `generateInvoice()`
- **Problem:** Snapshot is constructed via pool reads (outside any transaction). A concurrent payment recorded between the read and the write will be missing from the finalized invoice — a legal/tax document contradiction.
- **Fix:** Move snapshot data reads inside the `BEGIN..COMMIT` block using the same `client`, with `FOR UPDATE` on the settlement header.

---

**Issue 6 — Double WhatsApp notification on every order**
- **File:** `domains/ordering/service.js` + `services/notification.listeners.js`
- **Function:** `createOnlineOrder()` + `order.created` listener
- **Problem:** `createOnlineOrder()` calls `notifyService.orderConfirmed()` directly for COD/offline orders. The outbox then delivers the `order.created` event, triggering the listener which calls `notify.orderConfirmed()` again. Two kitchen WA messages per order.
- **Why critical:** 100 orders/day = 200 WA messages. Notification fatigue, Meta rate limit risk.
- **Fix:** Remove the direct `notifyService.orderConfirmed()` call from `createOnlineOrder()`. Let the outbox listener handle all cases.

---

**Issue 7 — PII logged to stdout in production**
- **File:** `api/routes/dine-in.js` line 167
- **Function:** `POST /order` handler
- **Problem:**
  ```js
  console.log('[dine-in/order] body:', JSON.stringify(req.body));
  ```
  Includes `guest_name`, `guest_phone`, and order items. Railway logs these to persistent storage.
- **Why critical:** DPDP compliance violation. Customer phone numbers in plaintext logs.
- **Fix:** Remove these debug `console.log` lines.

---

**Issue 8 — `insertOrder` hardcodes `'web'` channel (silent data loss)**
- **File:** `domains/ordering/repository.js`
- **Function:** `insertOrder()`
- **Problem:**
  ```sql
  VALUES ($1,$2,$3,'web',$4,...)  -- channel hardcoded
  ```
  The `channel` parameter is passed in but silently ignored. All orders saved as `channel='web'`. Analytics, kitchen routing labels, and channel reports are all wrong.
- **Fix:** Pass `channel` as a proper query parameter.

---

### HIGH

---

**Issue 9 — No rate limiting on `POST /auth/refresh`**
- **File:** `api/routes/auth.js`
- **Problem:** `/login`, `/forgot-password`, `/reset-password` all have `authLimiter` (10/min). `/refresh` has none. Attacker can brute-force refresh tokens at unlimited speed.
- **Fix:** Apply `authLimiter` to `POST /refresh`.

---

**Issue 10 — `closeSession` settlement created after COMMIT (crash-unsafe)**
- **File:** `domains/dining/sessions.js`
- **Function:** `closeSession()`
- **Problem:** Session committed as closed, then settlement creation attempted outside the transaction. A crash between COMMIT and settlement creation leaves the session closed with no settlement. Restaurant cannot bill that table.
- **Fix:** Move settlement creation inside the transaction, or add a compensating flow: auto-create settlement on bill view if one doesn't exist for a closed session.

---

**Issue 11 — `clearTenantCache` only clears slug key, not domain key**
- **File:** `api/middleware/tenant.js`
- **Function:** `clearTenantCache()`
- **Problem:** Domain-resolved entries cached under `__domain__:hostname`. `clearTenantCache(slug)` only deletes the slug-keyed entry. Settings updates don't invalidate domain-accessed requests for up to 60 seconds.
- **Fix:** Also delete `__domain__:${domainValue}` from the cache.

---

**Issue 12 — Export queries have no LIMIT (OOM risk)**
- **File:** `api/routes/settings.js`
- **Function:** `POST /settings/export`
- **Problem:** Customer export queries have no LIMIT. A restaurant with 50K customers and 200K orders loads all rows into Node memory simultaneously, crashing the process and taking all other tenants offline.
- **Fix:** Stream the response with cursor pagination, or add a hard row cap and return a job ID for async delivery.

---

**Issue 13 — Kitchen view hard-capped at 200 orders (silent data loss)**
- **File:** `domains/dining/kitchen.js`
- **Problem:** Both `queue[]` and `tables[]` queries use `LIMIT 200`. A busy restaurant with >200 active orders silently loses older orders from the kitchen display. They go unprepared.
- **Fix:** Add pagination or at minimum use `ORDER BY created_at ASC` so the oldest (most urgent) orders stay visible.

---

**Issue 14 — CORS thundering herd on cache expiry**
- **File:** `api/middleware/cors.js`
- **Problem:** No mutex on the 5-minute CORS origin refresh. On expiry, all concurrent requests simultaneously fire DB queries. Under moderate load this exhausts the 10-connection pool and fails other requests.
- **Fix:** Use a `let _refreshing = false` flag to coalesce concurrent refreshes, returning the stale value until the single refresh completes.

---

**Issue 15 — Bcrypt constant-time rejection uses comma operator (timing safety)**
- **File:** `api/routes/auth.js` lines 100-103
- **Function:** `POST /login`
- **Problem:**
  ```js
  : (await bcrypt.compare(password, hashToCheck), false); // comma expression
  ```
  Intent (prevent timing oracle) is correct but the mechanism is fragile. A future refactor or optimization could break it.
- **Fix:**
  ```js
  const DUMMY_HASH = '$2b$12$...'; // pre-computed at module load
  const hashToCheck = staff?.password_hash || DUMMY_HASH;
  const match = await bcrypt.compare(password, hashToCheck);
  if (!staff?.password_hash) return res.status(401)...
  ```

---

**Issue 16 — Staff PATCH runs role change and field updates in separate transactions**
- **File:** `api/routes/staff.js`
- **Function:** `PATCH /:id`
- **Problem:** A crash between the two transactions leaves staff with a new role but old name/phone. No rollback possible.
- **Fix:** Combine into a single `getClient()` transaction.

---

**Issue 17 — `deleteCustomizationGroup` partial transaction (orphaned group)**
- **File:** `api/routes/menu.js`
- **Problem:** Options are soft-deleted inside the `client` transaction. The group itself uses `repo.softDeleteCustomizationGroup(tenantId, groupId)` with the pool (outside the transaction). If the pool call fails, options are deleted but the group still exists.
- **Fix:** Pass `client` to `softDeleteCustomizationGroup`.

---

**Issue 18 — Outbox poller marks events delivered before async listeners complete**
- **File:** `services/outbox.poller.js` lines 57-65
- **Problem:** `events.emit()` is synchronous. Async listeners fire but their Promises are not awaited. `UPDATE ... SET status = 'delivered'` runs immediately. If an async listener fails (WA API, DB write), the outbox event is already marked delivered and will never retry.
- **Fix:** Build a custom async event bus that awaits all handler promises before returning from `emit()`. Or mark delivered at the outbox level only, and handle retries within individual channels.

---

**Issue 19 — `updateLine` doesn't enforce DISCOUNT negative amount**
- **File:** `domains/billing/repository.js`
- **Function:** `updateLine()`
- **Problem:** `insertLine()` forces `amount_paise = -Math.abs(amount_paise)` for DISCOUNT lines. `updateLine()` does not. Staff can edit a DISCOUNT to have a positive amount, turning it into a hidden charge.
- **Fix:** Apply the same enforcement in `updateLine()`.

---

**Issue 20 — Razorpay key secret exposed on every `req.tenant` object**
- **File:** `api/middleware/tenant.js`
- **Function:** `buildTenant()`
- **Problem:** `razorpay_key_secret` (AES-256-GCM ciphertext) is attached to `req.tenant` on every request, accessible in every handler and domain service.
- **Fix:** Exclude it from `req.tenant`. Fetch lazily in `razorpay.js#createPayment()` only when needed.

---

### MEDIUM

---

**Issue 21 — `resolveMenuItems` false error on duplicate cart item IDs**
- **File:** `domains/ordering/service.js`
- **Function:** `resolveMenuItems()`
- **Problem:** `if (dbRes.rows.length !== itemIds.length)` fails when a customer adds the same item UUID twice (different customizations, same ID). Order rejected with "Some items not found" even though the item exists.
- **Fix:** `const uniqueIds = [...new Set(itemIds)]` before querying.

---

**Issue 22 — `POST /reservations` has no rate limiting**
- **File:** `api/routes/dine-in.js` line 303
- **Problem:** Public endpoint, no rate limit. Attacker can flood the reservation table with fake bookings.
- **Fix:** Apply `publicLimiter`.

---

**Issue 23 — `avg_order_value` metric unit ambiguous**
- **File:** `jobs/aggregate-daily-metrics.js` line 63
- **Problem:** `AVG(total_amount)` unit is undocumented. If `total_amount` is paise, the metric is paise. The frontend may treat it as rupees.
- **Fix:** Document the unit. Store in paise and divide in the display layer consistently.

---

**Issue 24 — `new_customers` metric counts first order in window, not lifetime**
- **File:** `jobs/aggregate-daily-metrics.js` lines 85-97
- **Problem:** Finds the minimum `created_at` within the lookback window. A customer who ordered 6 months ago counts as "new" again if their first order in the 2-day window is isolated.
- **Fix:** Filter on customers whose absolute first-ever order falls within the window.

---

**Issue 25 — `returning_customers` grouped by last order date (misleading)**
- **File:** `jobs/aggregate-daily-metrics.js` lines 100-120
- **Problem:** Returning customers attributed to the date of their most recent order in the window, not their return date. Insights chart shows wrong spike days.
- **Fix:** Group by first order date within the window to show when customers actually returned.

---

## Top 25 Improvements by ROI

1. Fix delivery_fee unit inconsistency (Issue 1) — do first, every delivery order is priced wrong
2. Remove PII stdout logging (Issue 7) — two lines, DPDP compliance, immediate
3. Add tenant_id to `confirmByRazorpayOrderId` and `updatePaidPaise` (Issues 3, 4) — two WHERE clause additions
4. Fix double WhatsApp notification (Issue 6) — remove one direct call in `createOnlineOrder`
5. Fix GST calculation to use integer paise (Issue 2) — `Math.round(subtotal * rate / 100)` in paise
6. Move invoice snapshot inside transaction (Issue 5) — reads within the same `BEGIN..COMMIT`
7. Rate-limit POST /auth/refresh (Issue 9) — apply existing `authLimiter`
8. Fix `insertOrder` channel parameter (Issue 8) — pass variable instead of hardcoded `'web'`
9. Add LIMIT to settings export (Issue 12) — paginate or stream to prevent OOM
10. Fix `clearTenantCache` for domain entries (Issue 11) — also delete `__domain__:` key
11. Raise kitchen LIMIT or paginate (Issue 13) — 200-order cap reachable at a single busy venue
12. Add export rate limiting — at most 1 export per 5 minutes per tenant
13. CORS mutex guard (Issue 14) — `let _refreshing = false` prevents thundering herd
14. Fix `deleteCustomizationGroup` transaction (Issue 17) — pass `client` to group delete
15. Fix `updateLine` DISCOUNT enforcement (Issue 19) — mirror `insertLine` logic
16. Fix staff PATCH double transaction (Issue 16) — single `getClient()` transaction
17. Fix bcrypt dummy hash pattern (Issue 15) — pre-computed `DUMMY_HASH` constant
18. Fix `closeSession` settlement timing (Issue 10) — move inside transaction or compensating flow
19. Remove Razorpay secret from req.tenant (Issue 20) — lazy fetch per call
20. Fix `resolveMenuItems` duplicate check (Issue 21) — deduplicate with `Set`
21. Rate-limit POST /reservations (Issue 22) — apply `publicLimiter`
22. Fix `new_customers` metric (Issue 24) — lifetime first-order filter
23. Fix outbox poller async delivery (Issue 18) — await async listener promises before marking delivered
24. Settings cache bust for notification settings (CLAUDE.md known gap) — call `bustConfigCache` in `/settings/notifications` PATCH
25. Tables dashboard auto-refresh (CLAUDE.md known gap) — 10s polling matching kitchen view

---

## What Breaks First at Scale

### At 100 restaurants
- **Double WhatsApp notifications** immediately visible — every order sends two kitchen pings
- **Delivery fee pricing bug** — affects every restaurant that configures a fee
- **PII in logs** — every dine-in order logs guest phone numbers to Railway

### At 1,000 restaurants
- **CORS thundering herd** — 5-minute cache expiry under concurrent load exhausts the 10-connection pool, taking all tenants offline
- **Settings export OOM** — a restaurant with 50K customers crashes the Node process on export
- **Kitchen 200-order LIMIT** — a busy lunch service silently drops orders from the display
- **In-memory tenant cache** (max 500 entries) becomes a hot eviction target; 8-query fanout per miss

### At 10,000 restaurants
- **Single Node process** with max 10 DB connections hits the hard ceiling; pool exhausted under load
- **`aggregate-daily-metrics.js` setInterval drift** — job may overlap with itself at scale, running two concurrent full-table scans of `orders.orders`
- **`loadTenantForNotify` N+1** — each `order.created` fires 2 DB queries; at scale this dominates DB load

---

## Module Production Readiness

### Ready to ship

| Module | Status |
|--------|--------|
| Auth (login/refresh/logout/password reset) | ✅ Ready — needs refresh rate limit |
| Menu CRUD | ✅ Ready — minor group delete transaction bug |
| Tables/Sessions (open/close/bill/boot) | ✅ Ready — settlement timing gap |
| Kitchen view | ✅ Ready — 200-order cap is operational, not a bug |
| Reservations | ✅ Ready — needs rate limit on public POST |
| Catering leads | ✅ Ready |
| Customers/CRM | ✅ Ready — DPDP workflow correct |
| In-app notifications (bell) | ✅ Ready |
| Audit log | ✅ Ready |
| Bill renderer | ✅ Ready |
| Presence/Brand editor | ✅ Ready |
| Staff management | ⚠️ Minor — double-transaction on PATCH |
| WhatsApp notifications | ⚠️ Minor — double notification bug |

### Should Not Ship As-Is

| Module | Reason |
|--------|--------|
| **Order creation** | 🔴 CRITICAL — wrong delivery fee, float GST, hardcoded channel |
| **Settlement / Invoice** | 🔴 CRITICAL — snapshot outside transaction, missing tenant_id filter |
| **Razorpay webhook** | 🔴 HIGH — missing tenant_id on order confirm, double WA on payment |
| **Data export** | 🔴 HIGH — no LIMIT, OOM risk |
| **Insights/metrics job** | ⚠️ Medium — `new_customers` semantically wrong, unit ambiguity |
| **Dine-in /order endpoint** | ⚠️ Medium — PII logging to stdout |

---

## Architectural Observations

**Strengths:**
- Event outbox pattern is correctly implemented — durable delivery is the right architecture for a solo system
- Multi-tenancy is airtight at the middleware level; the two SQL gaps are the only breaks in tenant isolation
- Zod validation on every write path is excellent discipline
- `billing/calculator.js` is a well-isolated pure function — easy to trust
- Feature flags enforced at `requireFeature()` middleware, not scattered across domain code

**Structural concerns:**
- The async/EventEmitter mismatch means the outbox's delivery guarantee does not extend to notification channels; "delivered" in the outbox does not mean WA/webhook/bell were actually attempted
- `loadTenantForNotify()` fires 2 DB queries per `order.created` event; embed tenant data in the outbox payload at order creation time to eliminate this N+1
- `catering/service.js` creates the catering event after the lead UPDATE commits (non-transactional) — same pattern as session close/settlement; a confirmed lead can exist with no event record
