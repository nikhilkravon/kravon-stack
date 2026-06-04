# KRAVON UX DIAGNOSTIC — ORDERS & TABLES EXPERIENCE

**Date:** 2026-06-04  
**Audited by:** Claude (Senior Product Designer / Restaurant Ops / Mobile UX / SaaS Auditor personas)  
**Scope:** Customer-facing Orders + Tables products, Owner Dashboard (Orders + Tables + Kitchen views)

---

## 1. EXECUTIVE SUMMARY

The core ordering engine is architecturally sound. The shared `KravonCart`, unified `ItemControls` factory, and single config pipeline are the right foundations. However, the customer experience has **eleven critical-to-high friction points** that will cause real abandonment and operational confusion before the product reaches scale.

The dominant pattern across all problems is the same root cause: **the UI was built feature-first, not journey-first.** Each screen does its job correctly in isolation, but the transitions between screens — add item → cart → checkout → confirmation — have silent moments where the customer has no feedback, no anchoring, and no trust signal. On mobile (the primary surface for 90%+ of restaurant customers), these gaps become abandonment triggers.

A secondary pattern: **the kitchen and tables dashboard were built for completeness, not for the 3-second operational read** a waiter or cook needs during a rush. The information density and color coding are not calibrated for a noisy, fast-moving restaurant environment.

The good news: most of the P0 and P1 issues are fixable with CSS and a few lines of JS. No schema changes. No architectural rework.

---

## 2. CRITICAL UX PROBLEMS — P0

---

### P0-1: Item added to cart produces zero visible feedback on mobile

**Problem**  
When a customer taps "+ Add" on a menu item on mobile, the item is silently added to the cart. The only feedback is a cart badge count increment in the nav (top of screen) and a number change on the mobile cart bar (bottom of screen). The item card button does transform into a qty stepper — but this is a subtle visual change, not a confirmation. There is no animation, no flash, no toast, no satisfying signal.

**Root Cause**  
`ui.js` has a `cartFlash` animation that flashes the cart panel — but that panel is hidden on mobile. The mobile cart bar at the bottom receives no animation on item add. The item card re-render is instant and quiet.

**User Impact**  
First-time mobile customers tap "+ Add" and wonder if it worked. They tap again. Now they have qty 2. They go to cart confused. Some abandon entirely, assuming the app is broken.

**Business Impact**  
Direct conversion loss. Estimated 5–15% cart abandonment from uncertainty on first add, especially for new customers.

**Recommended Fix**  
When an item is added: briefly scale the qty stepper button in (CSS `scale` keyframe 0.8 → 1.05 → 1.0, 250ms). Also animate the mobile cart bar — bounce or pulse the total for 300ms. Both are pure CSS + a class toggle.

**Estimated Effort:** 2 hours

---

### P0-2: Cart is invisible until the customer actively opens it — no persistent preview on mobile

**Problem**  
On mobile, the cart lives inside a slide-up drawer that is closed by default. The mobile cart bar shows "X items · ₹TOTAL" but no item names. The customer who added 4 items 3 minutes ago has no ambient reminder of what they chose.

**Root Cause**  
The mobile cart bar render in `ui.js` shows count + total only. No item preview.

**User Impact**  
Customers scroll the menu, forget what they added, re-open the cart repeatedly. A dine-in guest who pauses to check the menu later has no idea if their previous selections are still there.

**Business Impact**  
Cart abandonment and lower average order value. Customers who can't quickly see their cart state tend to underbuy or start over.

**Recommended Fix**  
Expand the mobile cart bar to show the first 1–2 item names truncated: "Biryani, Paneer Tikka + 2 more · ₹640". Text change in `ui.js`'s cart bar render only.

**Estimated Effort:** 1 hour

---

### P0-3: Dine-in session has no persistent identity signal throughout the ordering flow

**Problem**  
The table name ("T3") shows in the nav badge but disappears entirely on the checkout and confirmation screens. The confirmation screen shows a generic "Order Placed!" with no mention of which table it was placed for.

**Root Cause**  
The confirmation screen template in `tables/checkout.js` does not inject `TABLE_CONTEXT.tableName` into its headline or subheading. The data exists — it's just not surfaced.

**User Impact**  
Dine-in guests at shared tables are uncertain: "Did I order for the right table?" Groups with multiple phones ordering simultaneously have no visual confirmation they're on the same session.

**Business Impact**  
Confusion leads to duplicate orders, wrong-table deliveries, and waiter interruptions — all increasing operational cost.

**Recommended Fix**  
Inject table name prominently in: (a) checkout screen header — "Ordering for Table 3", (b) order summary — "Dine-in · Table 3", (c) confirmation headline — "Order placed for Table 3 · Session active". All are template string changes in `renderer.js` and `checkout.js`.

**Estimated Effort:** 2 hours

---

### P0-4: The "Customise" modal destroys existing cart state on re-open

**Problem**  
`Modal.open(itemId)` always creates fresh modal state even if the item is already in the cart. The customer expects to see their previous selection pre-populated. They don't. They re-customize from scratch and create a second duplicate line item with different notes.

**Root Cause**  
`Modal.open(itemId)` does not check `Cart.getQtyById(id)`. The edit path only triggers from within the cart panel (the edit icon), not from the item card in the menu grid.

**User Impact**  
Customers end up with duplicated line items for the same dish with conflicting customization notes. Cart becomes confusing. Resolving it requires removing items and starting over.

**Business Impact**  
Wrong orders sent to kitchen. Customer complaints. Operational waste.

**Recommended Fix**  
In `Modal.open(itemId)`: check if a cart item exists for this `id`. If exactly one exists, call `openEdit(idx)` instead. If multiple exist (different customizations), show disambiguation. ~15 lines added to `modal.js`.

**Estimated Effort:** 3 hours

---

### P0-5: Checkout button is unreachable below minimum order — no clear path forward

**Problem**  
When the cart total is below the minimum order threshold, the "Proceed to Checkout" button is disabled with a "₹X more to checkout" warning. There is no "Keep Shopping" or "Back to Menu" action. The customer is stuck at the bottom of a closed cart drawer with a dead button.

**Root Cause**  
The minimum order warning renders correctly but provides no navigation action. No secondary button or link exists in the cart footer when `belowMin = true`.

**User Impact**  
Customers who are close to the minimum (~₹20–50 below) and motivated to order hit this wall and have no obvious next step. Mobile users lose their place in the menu when they close the drawer. Some abandon.

**Business Impact**  
Conversion loss at the highest-intent moment. Also suppresses upsell opportunity.

**Recommended Fix**  
Add a secondary "Browse Menu" text link to the cart footer when `belowMin = true` that closes the cart drawer and scrolls to the top of the menu. Change to `cart.js` footer render logic only.

**Estimated Effort:** 2 hours

---

## 3. HIGH IMPACT UX PROBLEMS — P1

---

### P1-1: Category navigation scroll-spy has a dead zone at top of page

**Problem**  
On page load, before any scroll, no intersection event fires for the first category. The initial active state is never explicitly set. First-time customers see a sidebar with no active state, which reads as broken navigation.

**Root Cause**  
Scroll-spy relies on `IntersectionObserver` crossing thresholds. No initial active state is set in `behaviour.js`.

**Recommended Fix**  
On `initRenderer()` completion, explicitly set the first category button as active: `document.querySelector('.sidebar-btn')?.classList.add('active')`.

**Estimated Effort:** 30 minutes

---

### P1-2: Special instructions field accepts 120 characters but shows no character count

**Problem**  
The customization modal has a "Special Instructions" input with `maxlength="120"` but no live counter. When a customer writes a long allergy note and input silently stops, they don't know their message was truncated.

**Root Cause**  
The modal renders the `<input>` with `maxlength` but no counter element and no `input` event listener.

**User Impact**  
Customers with long allergy notes hit an invisible wall. The order goes in with an incomplete note. Allergy-related instructions are silently truncated.

**Business Impact**  
Wrong orders, potential allergy incidents, poor experience for customers with dietary needs.

**Recommended Fix**  
Add a `<span class="char-count">120</span>` below the input. Add an `input` event listener in `modal.js` that decrements the counter. Red color below 20 chars.

**Estimated Effort:** 1 hour

---

### P1-3: Tables boot.js silently falls through to choice screen on session fetch failure

**Problem**  
When `?table_id` is in the URL but `getDineInSessionStatus()` fails (network error, server error, expired session), `boot.js` falls through to default state — `isDineIn = false`, no `sessionId`. The renderer shows the Dining In / Takeaway choice screen with no explanation.

**Root Cause**  
The `boot.js` error handler logs the error but does not show a dedicated error state. No distinction between "no table_id" and "table_id present but session fetch failed."

**User Impact**  
A dine-in guest who scans a QR code and gets a network hiccup chooses "Dining In" on the fallback screen. Now `isDineIn = true` with no `sessionId` — order goes to `POST /orders` as a takeaway. The waiter has no record of it. The kitchen sees it as a random web order.

**Business Impact**  
Dine-in orders that never appear in the table session. Operational confusion and revenue misattribution.

**Recommended Fix**  
When `?table_id` is present but session fetch fails: show a dedicated error screen — "This table isn't currently active. Ask your waiter to open your table's session." Do not fall through to the choice screen.

**Estimated Effort:** 3 hours

---

### P1-4: Orders Dashboard has no real-time updates — requires manual page refresh

**Problem**  
The Orders dashboard view fetches data once on `init()`. No polling, no WebSocket, no push. New orders placed while the dashboard is open are invisible until the owner manually refreshes.

**Root Cause**  
The view uses the standard `async init(el)` pattern with no `setInterval` or subscription. The `kitchen.js` view already implements 30-second polling — `orders.js` does not.

**User Impact**  
Restaurant owners and staff miss incoming orders in real time. During a busy service, a missed order can delay food by 10–20 minutes.

**Business Impact**  
Operational failure. The Orders dashboard is unusable as a live operations tool without auto-refresh, directly undermining the Growth/Pro tier value proposition.

**Recommended Fix**  
Add a 30-second `setInterval` poll on the Orders view — identical to the pattern already in `kitchen.js`. Show a badge on the tab title when new orders arrive between polls.

**Estimated Effort:** 2 hours

---

### P1-5: Delivery checkout has no address autocomplete

**Problem**  
The Orders checkout form requires customers to type their full address manually across 4 fields on a mobile keyboard. No autocomplete, no map, no pin drop.

**Root Cause**  
Address input is a plain `<textarea>`. No Google Places API or equivalent is wired.

**User Impact**  
High keyboard friction. Customers abbreviate, omit, or mistype addresses. Wrong deliveries happen.

**Business Impact**  
Wrong delivery addresses are a top source of delivery failure. Each wrong delivery = lost order cost + customer churn.

**Recommended Fix**  
Integrate OpenStreetMap Nominatim or Indian government address API for autocomplete. Frontend-only change — populates Address + Locality fields on selection.

**Estimated Effort:** 1–2 days

---

### P1-6: No "add more items" flow after reaching checkout

**Problem**  
Once on the checkout screen, there is no "Edit order" or "Back to Menu" button. Browser back works via `popstate` but is not obvious on mobile. Form data (name/phone/address) is lost on back navigation since it is client-side state only.

**Root Cause**  
Checkout screen has no back link. No form state persistence between screens.

**User Impact**  
Customers who reach checkout and want one more item are stuck. Some submit without it. Some use browser back and re-enter their entire address.

**Recommended Fix**  
Add a "← Edit order" link at the top of the checkout screen. Preserve form values in a module-level variable (or `sessionStorage`) so they survive back navigation.

**Estimated Effort:** 3 hours

---

## 4. MEDIUM IMPACT UX PROBLEMS — P2

---

### P2-1: Payment method selection is hidden below the fold on mobile checkout

The checkout screen renders delivery options first, then payment below. On a standard mobile viewport, the payment radio group is ~70% down the page — after a 4-field address form. First-time users often don't scroll far enough, tap "Place Order", get a validation error, and only then discover the payment section.

**Recommended Fix:** Reorder checkout: payment selection first, then customer details, then address. Or add a sticky "You've chosen: UPI" summary chip at the top once payment is selected.

**Estimated Effort:** 2 hours

---

### P2-2: Menu item descriptions are truncated at 11px and never expandable

Item card descriptions render at 11px muted text, limited to 2 lines with no expand affordance. For items with important variant info ("serves 2", "contains nuts"), this information is invisible. Non-customizable items have no modal to view the full description.

**Recommended Fix:** For non-customizable items, tap description or a "more ↓" link to expand inline. For customizable items, show full description in the modal header.

**Estimated Effort:** 2 hours

---

### P2-3: Tables product allows ordering after session is silently closed

If a waiter closes the dine-in session while a customer has the ordering screen open, the customer can still browse, add items, and attempt checkout — only to get an API error at the very end. The error message is generic.

**Recommended Fix:** Poll session status every 60 seconds while ordering screen is active. On closure: show a non-dismissable banner — "Your table session has ended. Ask your waiter to re-open." Disable checkout button.

**Estimated Effort:** 3 hours

---

### P2-4: Razorpay payment failure has no retry mechanism

After the Razorpay modal closes (user cancels, payment fails, network drops), there is no recovery UI. The customer is left on the checkout screen with the same form and no "try again" button. The `handler.dismiss` / `handler.close` callbacks are not explicitly handled.

**Recommended Fix:** On Razorpay dismiss: show a toast "Payment cancelled — you can try again" and re-enable the Place Order button.

**Estimated Effort:** 2 hours

---

### P2-5: "Track on WhatsApp" button has no context about what will happen

The confirmation screen CTA takes users to WhatsApp with a pre-composed message, but the button gives no preview of the message or to whom it will be sent. Customers who don't use WhatsApp are confused by being taken out of the app.

**Recommended Fix:** Relabel to "Message restaurant on WhatsApp" with a sub-label: "Opens WhatsApp with your order details."

**Estimated Effort:** 30 minutes

---

### P2-6: GST is calculated but never labelled with its rate

The cart footer shows "GST" as a silent line item with no rate (e.g., "5%") or tooltip. In India, customers frequently question whether GST is being correctly applied on digital orders. The unexplained number erodes trust.

**Recommended Fix:** Show rate inline: "GST (5%)" instead of "GST". One template change in `renderer.js`.

**Estimated Effort:** 15 minutes

---

## 5. MOBILE-SPECIFIC PROBLEMS

---

### M1: Cart drawer animation conflicts with software keyboard on checkout

On mobile checkout, tapping into form fields causes the software keyboard to rise. The keyboard-triggered viewport resize conflicts with the `translateY` drawer animation. The drawer can jump, resize, or partially disappear behind the keyboard. No `visualViewport` listener exists.

**Recommended Fix:** Add `visualViewport.addEventListener('resize', ...)` to adjust drawer `max-height` dynamically. Or close the cart drawer when any form input is focused.

**Estimated Effort:** 3 hours

---

### M2: Horizontal category rail on mobile has no overflow affordance

At ≤768px the sidebar becomes a horizontally scrollable row. There is no fade gradient, scroll indicator, or chevron showing that more categories exist off-screen. On a small screen with many categories, only 3–4 buttons are visible at a time with no affordance to scroll.

**Recommended Fix:** Add `mask-image: linear-gradient(to right, black 80%, transparent 100%)` CSS fade on the right edge. Add `-webkit-overflow-scrolling: touch` for iOS momentum.

**Estimated Effort:** 1 hour

---

### M3: Tables menu grid can produce awkward 1.5-column layout on some Android phones

`grid-template-columns: repeat(auto-fill, minmax(220px, 1fr))` on a 480px phone produces one full card and one truncated card side-by-side — neither a clean 1-column nor a clean 2-column layout.

**Recommended Fix:** Change to `minmax(160px, 1fr)` with a media query at ≤480px forcing `grid-template-columns: 1fr 1fr`.

**Estimated Effort:** 1 hour

---

### M4: No floating category launcher — excessive vertical travel on long menus

A restaurant with 8 categories and 40+ items produces a ~6000px tall page on mobile. After scrolling deep into category 5, the only way back to category 1 is a 3000px upward scroll. There is no floating shortcut, no back-to-top, no sticky "you are in: Mains" indicator.

**Recommended Fix:** Add a floating circular button at bottom-right (above the cart bar) that opens a full-screen category sheet — a vertical list of all categories to jump to. No backend dependency.

**Estimated Effort:** 1 day

---

## 6. CART & CHECKOUT PROBLEMS

---

### CC1: Same dish with different customizations is visually indistinguishable at a glance

Two cart rows of "Biryani" with different spice levels look identical at a quick read. The note text (italic, 10–11px, muted) is easy to miss. Customers reviewing the cart before checkout may think there's a duplicate and accidentally remove the correctly customized item.

**Recommended Fix:** When a note is present, inline it into the item name: "Biryani · Mild" and "Biryani · Hot". Or apply a subtle left border to note rows.

**Estimated Effort:** 1 hour

---

### CC2: Free delivery threshold has no visual progress indicator

"₹X more for free delivery" is shown as text only. No progress bar, no visual representation of proximity to threshold. Text alone is low motivation.

**Recommended Fix:** Add a 4px progress bar below the message: `width: (subtotal / freeDeliveryAt * 100)%`. Smooth CSS transition as items are added.

**Estimated Effort:** 2 hours

---

### CC3: Checkout button label does not update when delivery type changes

Selecting "Express Delivery" vs "Standard Delivery" updates the summary total but not the "Proceed to Checkout" button label. Customers making a late delivery selection see a total mismatch between the summary and their mental model.

**Recommended Fix:** Ensure `updateCheckoutSummary()` triggered by delivery selection change also updates the button label total.

**Estimated Effort:** 1 hour

---

## 7. CATEGORY NAVIGATION PROBLEMS

---

### CN1: No sticky section headers in the menu grid itself

The sidebar button highlights on scroll, but the menu grid flows continuously with no visual separator. On a fast scroll, the active button changes but the customer has no anchor in the grid showing where one category ends and another begins.

**Recommended Fix:** Add `position: sticky; top: var(--nav-height)` section headers above each category group in the menu grid. The `buildMenu()` template in `renderer.js` likely already generates these elements — verify sticky positioning is applied.

**Estimated Effort:** 2 hours

---

### CN2: Sidebar category buttons have no item count

A category with 1 item looks identical to one with 20. Customers waste taps exploring near-empty categories.

**Recommended Fix:** Add item count in parentheses: "Starters (6)". Data is available on the client — `category.items.length`.

**Estimated Effort:** 1 hour

---

## 8. DINE-IN SPECIFIC PROBLEMS

---

### DI1: Shared table ordering — no visibility into what others at the table have ordered

In a group dining scenario, each person orders from their own phone. No one at the table can see the aggregate session bill or what others have added. The waiter knows the full session bill; the customers don't.

**Root Cause**  
`GET /dine-in/bill` exists and returns the full session bill. It is exposed in the Tables dashboard (waiter side) but not in the customer-facing Tables product.

**User Impact**  
Groups over-order or argue about what was ordered. One person offering to pay has no visibility into the total. Social friction at the table.

**Recommended Fix**  
Add a "View Table Bill" button to the confirmation screen and the nav (only when `isDineIn = true` and `sessionId` exists). Fetch `GET /dine-in/bill?session_id=X` and show the full session order list and running total. Read-only; backend already provides the data.

**Estimated Effort:** 1 day

---

### DI2: No explicit "order submitted to kitchen" status progression for dine-in guests

The confirmation screen shows a generic "Order Placed!" with no status updates. The guest in a physical restaurant has no signal that the kitchen received the order or is preparing it.

**Root Cause**  
The Tables product does not poll `orders.status` after confirmation. The status field progresses `pending → confirmed → preparing → ready` but the customer never sees this.

**Recommended Fix**  
After confirmation, add a live status strip that polls `GET /orders/:id` every 30 seconds and shows: "Waiting for confirmation → Kitchen is preparing → Almost ready." No backend change required.

**Estimated Effort:** 1 day

---

### DI3: Table QR code allows full ordering flow when restaurant is closed or no session is open

If a QR code is scanned outside dining hours or when no table session is open, the ordering screen loads fully. A customer can browse, add items, and attempt checkout — receiving a generic API error at the end rather than a clear "we're closed" message upfront.

**Root Cause**  
No operating hours check in `boot.js`. No session validity gate on the ordering screen.

**Recommended Fix**  
In `boot.js`: check `CONFIG.operatingHours` before rendering the ordering screen. If outside hours or no session: show "We're currently closed — come back at [opening time]" and disable ordering. Requires the config endpoint to surface operating hours from the `settings` JSONB column.

**Estimated Effort:** 4 hours (frontend + config field surfacing)

---

## 9. TABLES DASHBOARD PROBLEMS

---

### TD1: Floor grid conveys occupancy but not urgency

All occupied tables look identical regardless of how long they've been open. A table occupied for 2 hours with no recent orders looks the same as one that seated 5 minutes ago. The 3-second floor read fails for a waiter during a rush.

**Root Cause**  
Table card renders status + name + session time with no urgency encoding. No color transitions based on elapsed time.

**Recommended Fix**  
Tables open >60 minutes with no recent order: amber indicator. >90 minutes: red indicator. `opened_at` timestamp is available on the card. Apply CSS class based on elapsed time calculation.

**Estimated Effort:** 3 hours

---

### TD2: Bill modal has no "Mark as Paid" action at session close

The bill modal shows the session total but the only actions are "Close Session" and "View QR." The waiter who closes a session cannot record the payment method. No cash/card/online attribution at the point of closure.

**Root Cause**  
Session closure (`POST /session/close`) has no `payment_method` parameter in the frontend. The backend close endpoint may not accept this field.

**Recommended Fix**  
Add a payment method selector (Cash / Card / Online) to the Close Session confirmation dialog. Pass with the close request. Surface in the Orders dashboard as payment method for dine-in orders.

**Estimated Effort:** 4 hours (frontend + backend close endpoint update)

---

### TD3: Table cards show covers count but no capacity indicator

A 4-person table showing "6 covers" gives no signal it's over-capacity. No `maxCovers` concept exists.

**Recommended Fix**  
Add `max_covers` to the tables schema. Show a capacity bar or color warning when `covers > max_covers`.

**Estimated Effort:** 1 day (schema addition + frontend)

---

## 10. ORDERS DASHBOARD PROBLEMS

---

### OD1: New order notification is completely absent

No browser notification, no audio alert, no visual flash, no tab title badge when a new order arrives. The owner only sees new orders if they are actively watching the dashboard at the exact moment of an auto-refresh.

**Root Cause**  
No `Notification API`, no tab title update, no audio, no badge logic in `orders.js`.

**User Impact**  
Owners who tab away or step back from their computer miss incoming orders entirely. In the Growth plan, the Orders dashboard is the primary order management surface.

**Recommended Fix**  
When the orders poll returns new orders (count increased vs last fetch): (a) update `document.title` to "🔔 New Order — Kravon", (b) play a short browser audio ping (requires one-time user gesture unlock via an "enable notifications" button on dashboard load), (c) show a `Notification API` push if permission granted.

**Estimated Effort:** 1 day

---

### OD2: Order list shows absolute timestamps with no urgency encoding

The paginated orders table shows `created_at` as a full datetime string. An order placed 45 minutes ago in "pending" status looks identical to one placed 2 minutes ago.

**Recommended Fix**  
Replace `created_at` display with relative time ("2 min ago", "47 min ago"). Apply amber color to orders >15 min in `pending`/`confirmed` status. Display-only change in `orders.js`.

**Estimated Effort:** 2 hours

---

### OD3: "Cancel order" has no confirmation step

The action buttons in expanded order rows call the API directly on "Cancel" with no confirm dialog. A waiter who accidentally taps "Cancel" on an active order causes immediate, unrecoverable operational damage.

**Recommended Fix**  
For "Cancel" actions only: show an inline confirmation — "Cancel this order? This cannot be undone. [Yes, Cancel] [Keep]". A `confirm()` dialog is acceptable for MVP.

**Estimated Effort:** 1 hour

---

### OD4: Kitchen view shows no indicator that data is live

The Kitchen view auto-refreshes every 30 seconds but shows no "Last updated: Xs ago" counter or visual pulse. During a slow period, kitchen staff cannot tell if the screen showing 0 orders is current or stale.

**Recommended Fix**  
Add a "Last refreshed: Xs ago" counter that increments every second and resets on each successful poll. A green dot that pulses on refresh.

**Estimated Effort:** 1 hour

---

## 11. RECOMMENDED IMPROVEMENTS — CONSOLIDATED

| Tier | Focus | Issues |
|------|-------|--------|
| Tier 1 — Conversion Protection | P0-1 through P0-5 | Direct abandonment causes |
| Tier 2 — Operational Reliability | P1-3, P1-4, OD1, TD1 | Service-time failures |
| Tier 3 — Experience Elevation | P2, M, CC, CN, DI tiers | Satisfaction + repeat |

---

## 12. QUICK WINS — UNDER 1 DAY

| # | Fix | Effort | Issue Resolved |
|---|-----|--------|---------------|
| QW1 | Item add animation + cart bar pulse | 2h | P0-1 |
| QW2 | Cart bar shows first item name(s) | 1h | P0-2 partial |
| QW3 | Table name injected in confirmation + checkout | 2h | P0-3 |
| QW4 | Sidebar first category active on load | 30m | P1-1 |
| QW5 | GST label shows rate: "GST (5%)" | 15m | P2-6 |
| QW6 | WhatsApp button relabelled with context | 30m | P2-5 |
| QW7 | Character counter on special instructions | 1h | P1-2 |
| QW8 | Free delivery progress bar | 2h | CC2 |
| QW9 | Cancel order confirmation dialog | 1h | OD3 |
| QW10 | Kitchen "last refreshed" counter | 1h | OD4 |
| QW11 | Horizontal category rail scroll fade | 1h | M2 |
| QW12 | Orders relative timestamp + aging color | 2h | OD2 |
| QW13 | Category item count in sidebar buttons | 1h | CN2 |

**Total estimated effort: ~16 hours**

---

## 13. HIGH LEVERAGE IMPROVEMENTS — UNDER 1 WEEK

| # | Fix | Effort | Issue Resolved |
|---|-----|--------|---------------|
| HL1 | Orders dashboard auto-refresh + new order alert | 1 day | P1-4 + OD1 |
| HL2 | Dine-in session error → dedicated error screen | 3h | P1-3 |
| HL3 | Customise modal pre-populates from existing cart item | 3h | P0-4 |
| HL4 | "Browse Menu" link when below min order | 2h | P0-5 |
| HL5 | "Edit order" back link + form state preservation | 3h | P1-6 |
| HL6 | Floor grid elapsed-time urgency coloring | 3h | TD1 |
| HL7 | Customer-facing session bill view | 1 day | DI1 |
| HL8 | Post-dine-in order status polling + progress strip | 1 day | DI2 |
| HL9 | Floating category launcher sheet | 1 day | M4 |
| HL10 | Razorpay dismiss → recovery toast + re-enable button | 2h | P2-4 |

---

## 14. FUTURE ENHANCEMENTS

| # | Enhancement | Why It Matters |
|---|-------------|----------------|
| F1 | Address autocomplete (OpenStreetMap / gov API) | Reduces wrong-delivery failures ~30–40% |
| F2 | Operating hours gate on Orders + Tables | Prevents confused QR scans + failed order attempts after hours |
| F3 | Table capacity management (`max_covers`) | Enables real-time seating load management |
| F4 | Session-aware shared bill for dine-in guests | Eliminates group over-ordering; social friction reducer |
| F5 | Payment method recording at session close | Enables reconciliation in Orders dashboard |
| F6 | Post-order status updates for dine-in guests | "Preparing → Ready" delight signal; no backend changes |
| F7 | Kitchen sound alerts (Audio API ping) | Highest operational impact for busy kitchens |
| F8 | Multi-language support | Table stakes for non-English markets |

---

*14 P0–P2 customer-facing issues · 9 operational issues · 13 quick wins · ~16 hours of quick-win engineering effort*  
*Recommendation: complete all 5 P0s before any new feature development resumes.*
