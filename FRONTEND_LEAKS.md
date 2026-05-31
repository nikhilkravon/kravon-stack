# Frontend Leaks Audit — Kravon Stack
Date: 2026-05-31 | Phase 1 of Frontend Hardening Plan

---

## What counts as a leak

A **backend concept leak** is any place where UI code exposes, assumes, or directly wires to:
- Raw DB column names (`fulfillment_type`, `tenant_id`, `customer_id`)
- Internal enum values shown as-is to users (`dine_in`, `out_for_delivery`, `no_show`)
- Deep nested config traversal that breaks if the config shape changes
- Business rules embedded in presentation logic (status transitions, pipeline order)
- API error messages surfaced raw to the user
- `alert()` / `confirm()` calls blocking the UI thread

---

## CRITICAL — Breaks UX immediately

| # | File | Line | Problem | Fix |
|---|---|---|---|---|
| C1 | `dashboard/assets/js/views/orders.js` | 175 | `alert('Failed: ' + err.message)` — raw API error in a blocking dialog | Replace with toast notification |
| C2 | `dashboard/assets/js/views/reservations.js` | 129 | `alert('Failed: ' + err.message)` — same pattern | Replace with toast |
| C3 | `dashboard/assets/js/views/catering.js` | 186 | `alert('Failed: ' + err.message)` — same pattern | Replace with toast |
| C4 | `dashboard/assets/js/views/menu.js` | ~180 | `confirm('Delete this item?')` / `confirm('Delete this category?')` — browser native dialog | Replace with modal confirmation |
| C5 | `dashboard/index.html` | 113 | `window.KRAVON_API_BASE = 'http://localhost:3000'` hardcoded in HTML | Must be replaced at deploy time with actual API URL |

---

## HIGH — Backend concepts visible to users

| # | File | Line | Leak | Proposed abstraction |
|---|---|---|---|---|
| H1 | `dashboard/views/overview.js` | 52 | Column header reads `"Surface"` — internal term. Raw `fulfillment_type` values (`dine_in`, `delivery`) shown without display mapping | Map to `"Channel"` + human labels: `Dine-in`, `Delivery`, `Takeaway` |
| H2 | `dashboard/views/orders.js` | 53–58 | `_surface()` reads `o.fulfillment_type` and `o.channel` directly, falls through to raw value | Centralise in a `displayChannel(order)` helper |
| H3 | `dashboard/views/orders.js` | 43–50 | `_badge()` maps DB status strings (`out_for_delivery`, `pending`) to CSS classes using hard-coded string comparisons — duplicated in overview.js | Single `statusBadge(status)` utility |
| H4 | `dashboard/views/overview.js` | 13–14 | `_statusBadge()` maps only `placed/preparing/delivered/cancelled` — `confirmed`, `ready`, `out_for_delivery` fall through to `badge-pending` (wrong colour) | Complete the map |
| H5 | `dashboard/views/settings.js` | 19 | `const caps = config.capabilities || {}` — then reads `caps.website`, `caps.orderManagement`, `caps.tables`, `caps.catering`, `caps.analytics` directly — if config shape changes this silently shows wrong state | Abstract behind `hasFeature(config, 'tables')` |
| H6 | `dashboard/views/settings.js` | 29–41 | Reads `config.brand?.name`, `config.brand?.tagline`, `config.contact?.email`, `config.hours?.display`, `config.order?.deliveryFee`, `config.order?.freeDeliveryAbove` — 6 different nested config paths, all silent-fail on shape change | Use a `getConfigField(config, path, fallback)` accessor |
| H7 | `dashboard/views/catering.js` | 59–66 | `_cf(lead, key)` reads `lead.custom_fields` JSONB — parses it inline in the view to recover `company`, `ref`, `score`, `tier` that were stored there at creation | Backend should return these as top-level fields; view should not parse JSONB |
| H8 | `dashboard/views/reservations.js` | 7–13 | `STATUS_CLASS` maps reservation DB statuses to order badge classes (`placed`, `preparing`, `delivered`) — wrong semantic re-use | Dedicated reservation status colours |
| H9 | `dashboard/views/catering.js` | 19–27 | `STATUS_CLASS` maps lead pipeline statuses to order badge classes — same wrong re-use | Dedicated lead pipeline colours |
| H10 | `dashboard/views/orders.js` | 196 | `ord.channel` and `ord.fulfillment_type` shown raw in detail expand panel (`dine_in`, `qr`) | Map through display helpers before rendering |
| H11 | `dashboard/app.js` | 52 | `$('dash-restaurant-name').textContent = slug` — shows the URL slug (`spice-of-india`) not the restaurant display name | Load and display `staff.restaurantName` or fetch from config |

---

## MEDIUM — Business rules embedded in UI

| # | File | Line | Leak | Fix |
|---|---|---|---|---|
| M1 | `dashboard/views/orders.js` | 7–31 | `STATUS_NEXT` and `ACTION_LABELS` — full order lifecycle state machine in the view | Move to a shared `orderFSM.js` or at minimum a constants file |
| M2 | `dashboard/views/catering.js` | 7–35 | Full catering pipeline (`PIPELINE`, `ADVANCE_LABELS`, `STATUS_LABELS`) — same pattern | Move to constants |
| M3 | `dashboard/views/orders.js` | 70–75 | `_tabStatus()` maps tab names to API `status` query values — UI knows API filter semantics | Abstract behind `tabToApiFilter(tab)` |
| M4 | `dashboard/views/catering.js` | 94–101 | `_buildUrl()` constructs raw API query strings in the view | Abstract behind `buildLeadsUrl(filter, page)` |
| M5 | `dashboard/views/reservations.js` | 44–56 | `_actionButtons()` encodes the reservation state machine inline (pending→confirmed, confirmed→seated, etc.) | Move to a constant map |
| M6 | `dashboard/views/insights.js` | 39–73 | Chart.js config (colours, fonts, scales) hardcoded inline | Move to a `chartDefaults` config object |

---

## LOW — Cosmetic / polish leaks

| # | File | Line | Leak | Fix |
|---|---|---|---|---|
| L1 | `dashboard/views/orders.js` | 101 | `"No orders found"` in a plain `<td>` — not an empty state component | Use proper empty state with icon + copy |
| L2 | `dashboard/views/reservations.js` | 69 | Same — `"No reservations found"` as bare text | Empty state component |
| L3 | `dashboard/views/catering.js` | 119 | `"No leads found"` as bare text | Empty state component |
| L4 | `dashboard/views/overview.js` | 48 | `"No orders yet"` as bare `div.empty-state` with no CTA | Add "View all orders" CTA |
| L5 | `dashboard/views/overview.js` | 96 | `"Failed to load overview: " + err.message` — raw error message | Friendly error: "Couldn't load dashboard. Try refreshing." |
| L6 | `dashboard/views/settings.js` | 11 | Settings view bypasses `Api.rGet()` and constructs its own raw `fetch()` call with manual base URL — inconsistency | Use `Api.rGet('/config')` |
| L7 | `dashboard/views/menu.js` | 27 | Edit/Delete buttons use emoji (✏ 🗑) as labels — no accessible text | Use SVG icons with `aria-label` |
| L8 | `dashboard/views/presence.js` | 48 | `"No orders found"` in the loading skeleton uses raw pixel heights (`height:120px`) inline | Use CSS classes |
| L9 | `dashboard/app.js` | 57 | `// plan comes from config; we don't load it here` — plan badge always shows "starter" until Settings loads | Load plan on boot from staff JWT or config |
| L10 | `dashboard/index.html` | 25 | Login slug input `placeholder="e.g. spice-garden"` — internal URL concept exposed as UX hint | Change to `"Your restaurant URL"` with a `?` tooltip |
| L11 | `dashboard/views/orders.js` | 193–195 | `ord.metadata?.delivery_address` — reading internal `metadata` JSONB in the view | Backend should return delivery address as a top-level field |

---

## Summary by priority

| Priority | Count | Action |
|---|---|---|
| Critical (C) | 5 | Fix before any UX work — blocking or hardcoded |
| High (H) | 11 | Fix in Phase 2-3 — visible to users, semantic errors |
| Medium (M) | 6 | Fix in Phase 3 — maintainability, not immediately user-visible |
| Low (L) | 11 | Fix in Phase 4-9 — polish |

Total leaks found: **33**
