# Mobile Responsiveness Audit — Kravon Stack
Date: 2026-05-31 | Phase 6 of Frontend Hardening Plan

Tested at: 375px (iPhone SE), 390px (iPhone 14), 430px (iPhone 14 Pro Max), 768px (iPad)
Status key: ✅ Pass · ⚠ Needs fix · ❌ Broken

---

## Dashboard

The dashboard is an owner-facing admin tool. Primary use is desktop. Mobile is secondary but must not be broken.

| Component | 375px | 768px | Notes |
|---|---|---|---|
| Sidebar | ❌ | ⚠ | Sidebar is always visible, takes 220px — on 375px only 155px of content visible |
| Stat grid (4 columns) | ❌ | ⚠ | 4-column grid overflows on small screens |
| Orders table | ⚠ | ✅ | `overflow-x: auto` on `.table-wrap` — scrollable but no visual affordance |
| Tab bar overflow | ⚠ | ✅ | Tabs can overflow on narrow screens |
| Forms (Settings, Presence) | ✅ | ✅ | `max-width: 560px` / `720px` limits work |
| `.form-row` (2-column grid) | ⚠ | ✅ | Side-by-side fields too narrow at 375px |
| Modals | ✅ | ✅ | `max-width: 480px; width: 100%` |
| Modal on 375px | ⚠ | ✅ | No horizontal padding — modal touches screen edges |

**Critical fixes for dashboard mobile:**
1. Sidebar must collapse on mobile (hamburger or bottom nav)
2. `.stat-grid` must be `repeat(2, 1fr)` on mobile, `repeat(1, 1fr)` on very small
3. `.form-row` must stack to single column below 500px
4. Modal needs `margin: 16px` on mobile to avoid edge-to-edge

---

## Presence

Restaurant's public-facing landing page. Mobile is primary — most guests visit on phones.

| Component | 375px | 768px | Notes |
|---|---|---|---|
| Navigation | ✅ | ✅ | Hamburger menu present |
| Hero section | ✅ | ✅ | Full-width, image scales |
| Menu grid | ✅ | ✅ | Single column on mobile |
| Cart bar (sticky bottom) | ✅ | ✅ | Fixed at bottom, correct |
| Customization modal | ✅ | ✅ | Full-height slide-up on mobile |
| Gallery grid | ✅ | ✅ | Responsive columns |
| CTA buttons | ✅ | ✅ | Full-width on mobile |
| Touch targets | ✅ | ✅ | 44px minimum met |
| Checkout form | ✅ | ✅ | Single column |
| Reservation form | ✅ | ✅ | Single column |
| Font sizes readable | ✅ | ✅ | 16px+ body text |
| No horizontal scroll | ✅ | ✅ | |

**Result: Presence is mobile-ready. No critical fixes needed.**

---

## Orders (Delivery)

Customers place delivery orders. Mobile is primary.

| Component | 375px | 768px | Notes |
|---|---|---|---|
| Category sidebar | ⚠ | ✅ | Sidebar collapses on mobile — category buttons shown as horizontal scroll strip |
| Menu grid | ✅ | ✅ | Single column on mobile |
| Cart panel | ✅ | ✅ | Mobile: sticky bottom bar + slide-up drawer |
| Checkout screen | ✅ | ✅ | Single column form |
| Delivery option cards | ✅ | ✅ | Full-width |
| Payment method cards | ✅ | ✅ | Full-width |
| Order summary | ✅ | ✅ | |
| Confirmation screen | ✅ | ✅ | |
| Razorpay modal | ✅ | ✅ | Razorpay handles its own responsive behaviour |
| Touch targets on add/qty buttons | ✅ | ✅ | |
| Keyboard overlap on forms | ⚠ | ✅ | Address fields may be obscured when keyboard is open — no `scroll-into-view` on focus |

**Result: Orders is largely mobile-ready. One minor keyboard overlap fix.**

---

## Tables (Dine-in QR)

Customers scan QR at table and order. Mobile is the ONLY surface — no desktop use case.

| Component | 375px | 768px | Notes |
|---|---|---|---|
| Choice screen (Dine-in / Takeaway) | ✅ | ✅ | Clean two-button layout |
| Navigation (category sidebar) | ⚠ | ✅ | Sidebar collapses to horizontal strip — strip can overflow if many categories |
| Menu grid | ✅ | ✅ | Single column |
| Mobile cart bar | ✅ | ✅ | Fixed bottom |
| Checkout form | ✅ | ✅ | |
| Payment options | ✅ | ✅ | |
| Confirmation + review | ✅ | ✅ | |
| Star rating touch targets | ✅ | ✅ | Large enough |
| Session status check on load | ✅ | ✅ | |

**Result: Tables is mobile-optimised. Category strip overflow is minor.**

---

## Catering

Event enquiry form. Mixed mobile/desktop traffic.

| Component | 375px | 768px | Notes |
|---|---|---|---|
| Hero section | ✅ | ✅ | |
| Package tier cards | ⚠ | ✅ | 3-column grid can be tight at 768px |
| Enquiry form | ✅ | ✅ | Single column |
| Date pickers | ✅ | ✅ | Native `<input type="date">` |
| Submit button | ✅ | ✅ | Full-width |
| Confirmation screen | ✅ | ✅ | |
| WhatsApp CTA | ✅ | ✅ | Opens wa.me deep link |

**Result: Catering is largely mobile-ready. Package grid minor fix at tablet size.**

---

## Priority fixes

### P1 — Must fix before launch
| Fix | File | Why |
|---|---|---|
| Dashboard sidebar collapse on mobile | `dashboard.css` + `app.js` | 220px sidebar makes dashboard unusable on phones |
| Dashboard `.stat-grid` responsive breakpoint | `dashboard.css` | 4-column grid overflows below ~900px |
| Dashboard `.form-row` stacks on mobile | `dashboard.css` | 2-column form rows too narrow below 500px |

### P2 — Fix in polish phase
| Fix | File | Why |
|---|---|---|
| Dashboard modal edge padding on mobile | `dashboard.css` | Modal touches screen edges at 375px |
| Orders keyboard scroll-into-view on form focus | `orders/checkout.js` | Fields hidden behind keyboard on some devices |
| Catering package grid breakpoint | `catering/base.css` | 3-column tight at 768px |
| Tables category strip: scroll indicator | `tables/tables.css` | No affordance that strip is scrollable |

### P3 — Nice to have
| Fix | File | Why |
|---|---|---|
| Dashboard mobile: persistent bottom nav instead of sidebar | `dashboard.css` | Better thumb reach on phones |
| Add `meta theme-color` to all pages | all `index.html` | Browser chrome matches brand colour |
| Add `loading="lazy"` to gallery images | `presence/renderer.js` | Faster page load on slow connections |
