# Kravon Dashboard — UX & Product Design Audit

Audit date: 2026-07-30

## The headline finding

**There is no role-based product today. There's one app with a static, always-visible 15-item sidebar, and a role field that's cosmetic everywhere except the settlement editor.**

A kitchen-role login sees Insights (revenue charts), Customers (PII + spend history), Audit Log, Website & Brand editor, Menu admin, Bill History, Invoices, and Reservations — identical to what an owner sees. The backend barely disagrees: only `staff.js` (owner/manager only) and two `customers.js` endpoints enforce `requireRole`. Everything else — Settings (GST rates, Razorpay keys, ordering on/off switch), Insights, Audit Log, Presence, Menu, Orders, Tables, Kitchen, Reservations, Bill History, Invoices, Catering — accepts any authenticated staff member regardless of role.

This isn't a rough edge. It's the single biggest gap between what CLAUDE.md's philosophy document says Kravon should be ("different products for different roles") and what ships. Everything below is organized around closing it, plus the operational redundancies the audit surfaced along the way.

---

## 1. Navigation: kill the static sidebar, generate it from role

**What exists:** `index.html:112-225` hard-codes 15 nav links in 4 groups (Operations, Customers & Sales, Digital Experience, Administration) into the DOM for every user. `app.js:100-141` never reads `Auth.state().staff.roles` before wiring nav clicks.

**Verdict: this fails almost every question in the brief.**
- Would a first-day kitchen employee understand this immediately? No — they see 15 destinations, 11 of which are irrelevant or actively confusing (why does line-cook see "Website & Brand"?).
- Can someone accidentally access functionality they shouldn't? Yes, trivially — click "Settings," see the Razorpay key field.
- Does this reflect how restaurants work? No restaurant hands a line cook the same screen as the owner.

**Recommendation:** Nav becomes a function of role, computed once at login, not a static DOM tree filtered after the fact (filtering after the fact is how you get the current bug — treat the emptiness as the constraint, not a filter step). Concretely:

| Role | Sees |
|---|---|
| Kitchen | Kitchen (as landing page). Nothing else. |
| Host | Floor/Tables, Reservations |
| Cashier | Floor/Tables, Active Bills (contextual, see §3), Customers |
| Waiter/Staff | Floor/Tables, Orders, Reservations |
| Manager | Everything operational — Overview, Orders, Tables, Kitchen, Reservations, Customers, Catering, Insights, Menu. Not Staff, not Settings' sensitive fields (Razorpay keys), not Audit Log. |
| Owner | Everything, including Staff, Settings, Audit Log, Website & Brand. |

This is a small change technically (a `ROLE_NAV` map + one filter in `app.js` before rendering nav DOM, mirroring the pattern `settlement.js` already proved out with `ROLE_CAPS`/`_can()`) but it's the highest-leverage fix in this whole audit — it's the difference between "an ERP with a login" and "a different, obvious app per role."

**Backend note:** the frontend gate is UX only, same caveat `settlement.js` already documents for its own `_can()`. The routes behind Insights, Presence, Menu, Audit Log, Settings still need `requireRole` added server-side — right now a kitchen JWT can call `GET /insights/*` or `PATCH /presence` directly, nav or no nav. This is a real gap, not just cosmetic — fix it in the same pass.

---

## 2. Landing page: stop sending everyone to Overview

**What exists:** `app.js:100-101` — `location.hash || 'overview'`, no role branching, for anyone.

Kitchen staff logging in to see 30-day revenue and repeat-customer stats is actively wrong — it's not neutral clutter, it's exposing business financials to a role that shouldn't see them and answering a question ("what's today's revenue trend?") that a line cook never asked. Per the brief's own examples:

- Kitchen → lands on Kitchen display
- Host → lands on Floor/Tables
- Cashier → lands on Floor/Tables
- Waiter → lands on Floor/Tables
- Manager/Owner → Overview

This is a one-line change once role is known at login (`ROLE_LANDING[primaryRole] || 'overview'`), but it only matters once §1's nav-gating exists — no point picking a landing page for a role that can still wander anywhere via the sidebar afterward.

---

## 3. Billing: three lists for one concept, plus a hidden nav item

**What exists:** `Settlement` (the actual bill editor) has **no sidebar entry at all** — it's only reachable by being pushed into via URL hash from four different entry points: Tables' "Close session," Tables' History tab, the separate **Bill History** nav item, and **Invoices** nav item. `bill-history.js` and Tables' History tab (`tables.js:546-669`) are near-duplicate views of the same closed-sessions list.

**This is exactly the anti-pattern the brief calls out by name:** "Invoices belong inside a completed settlement... these should not all become first-class navigation items." Right now you have three: Bill History, Invoices, and Tables→History — all pointing at overlapping data, and the one screen that's actually the workflow (Settlement) has to be smuggled in via hash params because nobody gave it a nav slot.

**What a cashier actually needs**, per the brief's own operational framing ("a cashier should never search for an invoice"):

- **Merge Bill History + Tables→History tab into one thing.** They're the same list rendered twice by two different files. Delete one. Given Tables is where the floor lives, keep the History tab *inside* Tables and delete `bill-history.js` as a nav destination — or if a full-page list view is worth keeping for date-range/CSV export (EOD reconciliation is a real, distinct job from "find today's bill"), keep exactly one of them, not both.
- **Collapse "Invoices" as a browse-everything list into "past bills," reached from Customers or from a table's/session's own history**, not a top-level destination whose only job is to be a worse index into Settlement. The "+ Manual Invoice" creation action is legitimate (walk-in cash sale with no table) — that one action can live as a button inside Tables or Bill History, it doesn't need to justify an entire nav item.
- **Give Settlement itself the nav slot** conceptually — rename the mental model from "Invoices" (a database noun) to **"Active Bills"** (what the brief explicitly asks cashiers to land on), scoped to *currently open* settlements, with closed/historical ones one tap away via a tab, not a separate page.

Net: **Bill History, Invoices, and Tables→History collapse into: Tables (with an inline History tab) + Active Bills.** Two things instead of four.

---

## 4. Kitchen view — the one screen that's already right, undo the surroundings

**What exists:** `kitchen.js` itself is genuinely well-scoped: table/order cards, prep actions, delivery/pickup queue, 10s poll, no financial or admin leakage. This is the one view in the whole app that matches the brief's ideal.

**The problem is entirely external to this file** — the static sidebar puts 14 other destinations one click away from a kitchen login, and nothing stops a kitchen-role JWT from calling `/insights/*`, `/presence`, `/audit-log`, `/customers` directly. Fix is §1 (nav) + backend `requireRole` on those routes — kitchen.js itself needs no changes.

---

## 5. Settlement's `_can()` pattern is correct — copy it, don't reinvent

`settlement.js:61-76` mirrors backend `ROLE_CAPS` client-side for UX, with the backend as authority. This is the right shape for the whole app. Two things to fix while extending it:

- **`ROLE_CAPS` is missing `host` and `catering` as intentional zero-billing roles** — already correct, they're `new Set([])`. Good, no change needed there.
- **The Staff admin role picker offers a `staff` role** (`staff.js:118-127`) **that doesn't exist in the seeded role set or either `ROLE_CAPS` map.** An owner can create a staff member with role "staff" today and that person will fail every capability check silently (empty set fallback) with no explanation. Either add `staff` as a real seventh role with defined caps and nav, or remove it from the dropdown — right now it's a trap. Given the brief's role list (waiter/cashier/kitchen/host/catering/manager/owner), I'd guess "staff" was meant to be "waiter" and was never renamed — worth a 30-second check against what `owner` actually intends day to day.

---

## 6. Screen-by-screen verdict (the brief's 8 questions, condensed)

| Screen | Should exist? | Verdict |
|---|---|---|
| **Overview** | Yes, for owner/manager only | Fine as owner/manager landing. Should not be reachable by kitchen/host/cashier at all — it's a business-health screen, not an operational one. |
| **Orders** | Yes | Legitimate distinct queue (multi-fulfillment-type), keep for waiter/manager/owner. Not needed for kitchen (Kitchen view already shows their queue) or cashier (they work from Tables). |
| **Tables** | Yes — core screen | Should be the landing page for host/cashier/waiter. Absorb the History tab as the single closed-session view (see §3). |
| **Kitchen** | Yes — core screen | Already correct. Should be kitchen's *only* nav item and landing page. |
| **Reservations** | Yes | Keep for host/manager/owner. Not needed for kitchen/cashier. |
| **Bill History** | Merge into Tables | Duplicate of Tables→History. Kill as separate nav item. |
| **Invoices** | Rename/collapse | Becomes "Active Bills," scoped and contextual — not a raw settlement-table browser. See §3. |
| **Customers** | Yes | Cashier/manager/owner. Not kitchen/host. |
| **Catering Leads** | Yes | Manager/owner only — this is a sales pipeline, not floor ops. |
| **Insights** | Yes, but gate it | Owner/manager only, both frontend nav and backend route. Currently anyone can see revenue. |
| **Website & Brand** | Yes, but gate it | Owner only. Zero operational staff need this mid-shift. |
| **Menu** | Yes, but gate it | Owner/manager only — a waiter should never "86" a dish from the nav; that action belongs inside Orders/Kitchen contextually if it needs to exist at all for floor staff. |
| **Staff** | Yes, already gated server-side | Fix frontend to match — don't even show the nav item to non-owner/manager. |
| **Settings** | Yes, but gate it | Owner only — Razorpay keys and GST config are not manager-level, let alone cashier-level. |
| **Audit Log** | Yes, but gate it | Owner only. Currently anyone can read the full audit trail including price overrides and voids. |
| **Settlement** | Yes — give it real estate | Currently nav-orphaned; it's the actual workflow behind "Active Bills." |

---

## What to do first, in order

1. **Role-gate the nav** (`app.js` + a `ROLE_NAV`/`ROLE_LANDING` map) — biggest impact, smallest diff, directly copies the pattern `settlement.js` already validated.
2. **Add backend `requireRole` to Insights, Presence, Audit Log, Settings write routes** — closes the actual security/data-exposure gap, not just the UX one.
3. **Collapse Bill History + Tables→History + Invoices into Tables (History tab) + Active Bills** — removes a whole duplicate screen and turns three navigation hops into one.
4. **Fix or remove the phantom `staff` role** in the Staff admin dropdown before someone gets silently locked out of everything.
5. **Role-based landing pages** — cheap, but sequence it after #1 or it's cosmetic.

---

## Appendix: ground-truth inventory (as of audit date)

### Navigation structure
`index.html:112-225` — 15 static nav links in 4 groups, identical for every user:

**Operations:** Overview, Orders, Tables, Kitchen, Reservations, Bill History, Invoices
**Customers & Sales:** Customers, Catering Leads, Insights
**Digital Experience:** Website & Brand, Menu
**Administration:** Staff, Settings, Audit Log

16 views are registered in `app.js:15-36`; `Settlement` has no nav link (reachable only via URL hash).

### Every view/screen

| File | Nav label | Description |
|---|---|---|
| `overview.js` | Overview | 30-day stat cards, "Tonight" panel, recent-orders table |
| `orders.js` | Orders | Full order queue, all fulfillment types, tabs, search, status advance |
| `tables.js` | Tables | Floor-plan grid, sessions, QR codes, table CRUD, History tab |
| `kitchen.js` | Kitchen | Table/order cards, prep actions, delivery/pickup queue, 10s poll |
| `reservations.js` | Reservations | Reservation list, confirm/seat/no-show/cancel, table-picker modal |
| `bill-history.js` | Bill History | Closed sessions, filters, EOD summary, CSV export, links to Settlement |
| `invoices.js` | Invoices | All settlements (any source), filters, "+ Manual Invoice" |
| `customers.js` | Customers | CRM list, order history, notes |
| `catering.js` | Catering Leads | Lead pipeline, stage advance, spawn Settlement from confirmed lead |
| `insights.js` | Insights | Revenue/channel/hourly charts (Chart.js via CDN), top items, occupancy |
| `presence.js` | Website & Brand | Public site content editor |
| `menu.js` | Menu | Category/item CRUD, availability toggle, food-type, channel visibility |
| `staff.js` | Staff | Roster, add/edit modal with role picker, activate/deactivate |
| `settings.js` | Settings | Delivery pricing, GST, ordering toggle, reservations config, Razorpay keys, own password |
| `audit-log.js` | Audit Log | Event log, filters, before/after JSON diff |
| `settlement.js` | *(no nav link)* | Bill/settlement editor: lines, discounts, payments, finalize/void, invoice |
| `notifications.js` | *(header bell, not sidebar)* | Notification dropdown |

### Role model

Six seeded roles (`db/migrations/v22-seed-roles.js:5-36`): `owner`, `manager`, `cashier`, `kitchen`, `host`, `catering`.

Only real granular capability matrix exists in `domains/billing/service.js:32-66` (`ROLE_CAPS`), enforced inside settlement service functions. Mirrored client-side in `settlement.js:61-76` for UX only — this is the **only** view with role-based UI gating.

Backend `requireRole` exists only on: `staff.js` (list: owner/manager; create/edit/delete: owner), `customers.js` (export/delete-request/correct: owner/admin), `settings.js` (export: owner/admin). Every other route (`audit-log.js`, `config.js`, `dine-in.js`, `insights.js`, `leads.js`, `menu.js`, `notifications.js`, `orders.js`, `presence.js`, `tables.js`) only requires `requireRestaurantAuth` — any authenticated staff, any role.

`staff.js:118-127` role picker offers `staff, manager, kitchen, cashier, host, catering` — `staff` is not a seeded role and has no entry in either `ROLE_CAPS` map (silent capability trap). `owner` is not selectable in the dropdown.

### Billing click path

No dedicated nav item for Settlement. Four entry points, all landing on `SettlementView`:
- **Tables** → "Close session" → auto-navigates to Settlement if `settlement_id` returned
- **Tables → History tab / Bill History** → row expand → "Open Settlement Editor →" link
- **Invoices** → row click, or "+ Manual Invoice" button
- **Catering** → confirmed lead → "Create Settlement →" button

Inside Settlement: line items → totals → payments/refund → Finalize & Close → Generate Invoice (only after finalize) → print.

Most common path (cashier closing a table) is reasonably contextual. Finding a bill *after the fact* requires checking one of three overlapping lists (Tables→History, Bill History, Invoices).

### Kitchen view

`kitchen.js` itself is well-scoped — no financial/admin leakage, correct data only. But kitchen-role logins are not blocked from any other nav item or route (only Settlement's capability set is empty for `kitchen`); the static sidebar and unguarded backend routes expose Insights, Customers, Audit Log, Presence, etc. to kitchen logins.

### Landing/default view

`app.js:100-101` — `location.hash || 'overview'`, identical for every role. No role-based default route exists.
