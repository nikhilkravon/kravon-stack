# Dashboard UX Checklist — Kravon Stack
Date: 2026-05-31 | Phase 3 of Frontend Hardening Plan

Status key: ✅ Pass · ⚠ Needs fix · ❌ Broken · ➡ Deferred

---

## Shell & Navigation

| Item | Status | Notes |
|---|---|---|
| Sidebar shows restaurant display name | ⚠ | Shows URL slug (`spice-of-india`) not display name (`Spice of India`) |
| Sidebar shows correct plan badge | ⚠ | Always shows "starter" until Settings view loads |
| Plan badge capitalised | ⚠ | Shows raw lowercase enum value |
| Active nav item highlighted | ✅ | Blue underline + white text |
| Hash routing works (back button) | ✅ | `hashchange` listener in place |
| Page title updates on navigate | ✅ | `dash-view-title` updates correctly |
| Logout clears session | ✅ | Calls Auth.logout() + location.reload() |
| Session expiry handled | ✅ | api.js retries once, then App.sessionExpired() |
| Header is sticky | ✅ | `position: sticky; top: 0` |
| Sidebar is sticky | ✅ | `position: sticky; height: 100vh` |

---

## Login

| Item | Status | Notes |
|---|---|---|
| Shows Kravon logo | ✅ | SVG inline |
| Three fields: slug, email, password | ✅ | Correctly labelled |
| Slug field placeholder is user-friendly | ⚠ | Shows `"e.g. spice-garden"` — should say `"Your restaurant URL"` |
| Error message shown inline | ✅ | `#login-error` paragraph |
| Submit button disables during request | ✅ | `btn.disabled = true` |
| Button text changes to "Signing in…" | ✅ | Good loading feedback |
| Autocomplete attributes set | ✅ | `autocomplete="organization"`, `email`, `current-password` |
| `novalidate` allows custom error display | ✅ | Present on form |

---

## Overview

| Item | Status | Notes |
|---|---|---|
| 4 stat cards with skeleton loading | ✅ | Shimmer animation |
| Revenue displays in ₹ with locale formatting | ✅ | `toLocaleString('en-IN')` |
| Recent orders table loads | ✅ | 5 most recent |
| Status badges cover all statuses | ⚠ | `confirmed`, `ready`, `out_for_delivery` fall through to `badge-pending` (orange) |
| "See all →" link navigates to Orders | ✅ | `App.navigate('orders')` |
| Empty state when no orders | ⚠ | `"No orders yet"` — plain div, no icon or CTA |
| Error state | ⚠ | Shows raw error message including `err.message` |
| Column header says "Surface" | ⚠ | Should say "Channel" |

---

## Orders

| Item | Status | Notes |
|---|---|---|
| Tab filters: All / Live / Completed / Cancelled | ✅ | Correct |
| Search by name / phone | ✅ | 300ms debounce |
| Skeleton loading on tab switch | ✅ | |
| Pagination Prev/Next | ✅ | Buttons disable at bounds |
| Order count shown | ✅ | `"N orders"` |
| Status badges | ⚠ | `ready` and `out_for_delivery` both map to `badge-preparing` (blue) — correct but `ready` deserves distinct treatment |
| Action buttons: Accept / Preparing / Ready / etc | ✅ | State machine correct |
| Cancel action is danger style | ✅ | `btn-danger` |
| Row click expands detail | ✅ | Toggle open/close |
| Detail: items lazy loaded | ✅ | Only fetched when row opened |
| Detail: raw `fulfillment_type` shown | ⚠ | Shows `dine_in` not `Dine-in` |
| Detail: raw `channel` shown | ⚠ | Shows `qr`, `web` not display labels |
| Action failure handling | ❌ | `alert()` — blocking browser dialog |
| Empty state | ⚠ | Plain `"No orders found"` inside `<td>`, no icon, no context |
| Error state | ⚠ | `"Error: " + err.message` — raw API error |

---

## Menu

| Item | Status | Notes |
|---|---|---|
| Categories accordion | ✅ | Chevron toggle, open/close |
| Item count per category | ✅ | `(N)` next to category name |
| Availability toggle (86'd) | ✅ | Green toggle, immediate API call |
| Veg/non-veg/egg/vegan dots | ✅ | Colour coded |
| Unavailable items show strikethrough | ✅ | `.menu-item-unavailable` |
| Add category modal | ✅ | Name + description fields |
| Edit category modal | ✅ | Pre-fills current values |
| Add item modal | ✅ | Name, price, description, food type, availability |
| Edit item modal | ✅ | Pre-fills values |
| Delete category | ⚠ | Uses `confirm()` — native browser dialog |
| Delete item | ⚠ | Uses `confirm()` — native browser dialog |
| Edit/delete buttons use emoji (✏ 🗑) | ⚠ | No accessible text/aria-label |
| Empty state (no categories) | ⚠ | No dedicated empty state when menu is empty |
| Error state on load failure | ⚠ | Raw error message |

---

## Reservations

| Item | Status | Notes |
|---|---|---|
| Tab filters: Upcoming / Confirmed / Pending / Cancelled / All | ✅ | Correct |
| Confirmation code shown | ✅ | Falls back to ID slice |
| Party size shows "pax" suffix | ✅ | |
| Date/time formatted for en-IN locale | ✅ | |
| Status badges | ⚠ | Re-uses order badge classes (`placed`, `preparing`, `delivered`) — semantically wrong |
| Action buttons: Confirm / Seat / No-show / Cancel | ✅ | State machine correct |
| Row click expands detail | ✅ | |
| Detail shows email, occasion, dietary notes | ✅ | |
| Action failure handling | ❌ | `alert()` |
| Empty state | ⚠ | Plain `"No reservations found"` in `<td>` |
| Error state | ⚠ | Raw error message |

---

## Catering

| Item | Status | Notes |
|---|---|---|
| Tab filters: All / New / In Progress / Confirmed / Lost | ✅ | |
| Lead ref shown | ✅ | Falls back to ID slice |
| Company name shown | ✅ | Parsed from `custom_fields` JSONB |
| Event date range | ✅ | |
| Pipeline advance buttons | ✅ | Correct state machine |
| "Reject" (Lost) action | ✅ | Danger style |
| Status badge colours | ⚠ | Re-uses order colours — `proposal_sent` shows blue "preparing" badge |
| Detail expand: phone, email, budget, source | ✅ | |
| Notes shown in detail | ✅ | |
| Action failure handling | ❌ | `alert()` |
| Empty state | ⚠ | Plain text in `<td>` |
| Error state | ⚠ | Raw error message |

---

## Insights

| Item | Status | Notes |
|---|---|---|
| 4 stat cards | ✅ | Revenue, Orders, Repeat customers, Leads |
| Lead tier breakdown (hot/warm/cool) | ✅ | Colour dots |
| Time range selector: 7d / 30d / 90d | ✅ | |
| Revenue line chart | ✅ | Chart.js loaded on demand from CDN |
| Chart empty state (no data) | ⚠ | Canvas renders with empty axes — no message |
| Skeleton loading on stat cards | ✅ | |
| Error state | ⚠ | Raw error in `#insights-stats` div |

---

## Personalisation (Presence Editor)

| Item | Status | Notes |
|---|---|---|
| Sections: Basics, Contact, Social, Hero, Story, Dishes, Gallery, Promotions, Milestones | ✅ | All present |
| Per-section save buttons | ✅ | Each section saves independently |
| Save shows "Saving…" during request | ✅ | |
| Save shows "Saved." on success | ✅ | Auto-hides after 2.5s |
| Error shown per section | ✅ | |
| Skeleton loading on init | ✅ | |
| Gallery add/remove image URLs | ✅ | |
| Signature dish add/remove rows | ✅ | |
| Promotions add/remove | ✅ | |
| Milestones add/remove | ✅ | |
| Error state on load failure | ⚠ | `"Failed to load: " + err.message` — raw |

---

## Settings

| Item | Status | Notes |
|---|---|---|
| Restaurant name, tagline, email, hours fields | ✅ | |
| Delivery fee + free delivery above fields | ✅ | |
| Products enabled list | ✅ | ✓/✕ with colour |
| Plan badge | ⚠ | Shows raw lowercase plan value |
| Form submit disables button | ✅ | |
| Success message shown | ✅ | Green text, auto-hides |
| Error shown | ✅ | Red text |
| Loads config via raw `fetch()` not `Api.rGet()` | ⚠ | Inconsistent with all other views |

---

## Cross-cutting issues

| Item | Status | Affects |
|---|---|---|
| `alert()` for action failures | ❌ | Orders, Reservations, Catering |
| `confirm()` for destructive actions | ❌ | Menu |
| Raw error messages shown to user | ⚠ | All views |
| Empty states are bare text in `<td>` | ⚠ | Orders, Reservations, Catering |
| Empty states have no icon or CTA | ⚠ | All views |
| Status badge map incomplete | ⚠ | Overview, Orders |
| DB enum values shown in UI | ⚠ | Orders detail, Overview |
| Sidebar restaurant name = slug | ⚠ | Shell |
| Plan badge always "starter" until Settings loads | ⚠ | Shell |

---

## Fix priority order

1. ❌ Replace all `alert()` / `confirm()` with toast + modal confirmation — **blocks commercial feel**
2. ⚠ Fix status badge completeness — wrong colours destroy trust
3. ⚠ Fix empty states — add icon + copy + CTA
4. ⚠ Fix error messages — friendly copy, not raw API strings
5. ⚠ Fix sidebar restaurant name — slug ≠ display name
6. ⚠ Fix settings to use `Api.rGet()` + fix plan badge
7. ⚠ Fix DB enum labels in order detail panel
