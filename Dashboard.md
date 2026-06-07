Kravon Dashboard — How It Works
Architecture
Single-page application (SPA) with hash-based routing. One shell (index.html), 12 view modules each owning their own render/bind/poll lifecycle, and a shared API wrapper that handles token refresh transparently.

Authentication & Session
Token Model:

Access Token (AT) — 15-minute JWT, stored in memory only (never persisted to disk)
Refresh Token (RT) — 30-day lifetime, stored in HttpOnly cookie (JavaScript cannot read it)
Auth.getToken() silently refreshes the AT if it expires within 60 seconds
Login Flow:

Operator enters restaurant slug + email + password
POST /v1/auth/login → server returns AT, sets RT cookie
AT decoded to extract slug, staffId, roles; stored in localStorage for display only
Session Expiry:

If AT refresh fails (RT also expired) → all tokens cleared, user redirected to login
Password reset uses URL param ?reset=TOKEN&slug=SLUG, clears token from URL on success
Navigation
12 views in the sidebar — hash-based navigation (#orders, #menu, etc.):

Nav Item	View	Who Primarily Uses It
Overview	Dashboard home stats	Operator
Orders	Order management + alerts	Operator
Menu	Menu editing	Operator
Reservations	Guest reservation pipeline	Operator
Tables	Dine-in session management	Operator / Floor Staff
Kitchen	KDS (kitchen display)	Kitchen Staff
Catering	Leads pipeline	Operator / Sales
Insights	Revenue analytics	Operator
Customers	Customer directory	Operator
Staff	Team management	Manager/Owner
Personalisation	Public site branding	Owner
Settings	Config (fees, GST, payments)	Owner
View-by-View Breakdown
Overview
Loads on every visit. Reads:

/insights/summary → revenue, order count, repeat customers, catering leads (30-day window)
/orders?limit=5 → last 5 orders in a table
/insights/tonight → live covers, open tables, tonight's revenue
No polling. Click a row to see order details inline.

Orders — the most complex view
State: current tab (All / Live / Completed / Cancelled), page, search string

Real-time polling every 10 seconds:

Compares previous order count to new count
If count increased and you're not on a terminal-status tab: increments _newCount badge
Page title changes to (N) New Orders — Kravon
Fires audio alert (2-tone 880→660 Hz) and browser desktop notification if enabled
Audio and notifications require a one-time user gesture to unlock (button in view)
Row interaction:

Click row → expands inline detail (address, phone, special instructions)
Items lazy-loaded on expand via /orders/:id/items
Status buttons vary by order type:

Delivery: pending → confirmed → preparing → ready → out_for_delivery → completed
Dine-in: pending → confirmed → preparing → ready → completed
Catering: pending → confirmed → completed
Stale order warnings: Orders stuck >15 min in pending/confirmed, or >20 min preparing, get an orange timestamp.

Search: Debounced 300ms, filters by customer name or phone.

Menu
Full CRUD for the entire menu tree: categories → items → variants → customizations.

Data model:

Category contains items
Item has variants (alternative sizes/options with flat price) and customization groups (add-ons, radio or checkbox, required or optional)
Workflow:

Accordion view — click category header to expand its items
Add/Edit item opens a 3-tab modal: Details, Variants, Customizations
Availability toggle next to each item → immediate PATCH (no save button needed)
Any save reloads the full menu tree from server
No polling.

Reservations
Pipeline tabs: All / Upcoming / Confirmed / Pending / Cancelled

Status flow: pending → confirmed → seated → completed (or cancelled / no-show)

Seat action is the key interconnection: when an operator clicks "Seat" on a confirmed reservation, a modal appears listing available tables. Selecting a table:

POST /dine-in/session/open — opens a table session
PATCH /dine-in/reservations/:id — marks reservation as seated
This is the bridge between Reservations and Tables.

Tables
Polls every 15 seconds. Grid of cards, one per table.

Card states:

Available: shows "Open Session" button with covers input
Occupied: shows session duration (with urgency badges at 60 and 90 min), running total, live order feed, bill-requested alert if guest asked for the bill, guest name if billing started
Reserved / Cleaning: status badge only
Actions:

Open session → POST /dine-in/session/open with cover count
Close session → confirmation → POST /dine-in/session/close
View Bill → modal with itemized breakdown (orders grouped, total, duration, covers)
Show QR → modal with table QR code (links to customer ordering page)
Download QR Sheet → opens printable sheet of all tables' QR codes (auto-triggers print dialog)
Edit/Delete table → modal form, PUT/DELETE /tables/:id
Session orders are lazy-loaded when the card is rendered (GET /dine-in/session/orders?session_id=).

Kitchen (KDS)
Polls every 10 seconds. Purpose-built for kitchen staff — no editing, only status advancement.

Shows tables with active orders grouped under them. Each order card shows:

Items + quantities + any notes (notes in orange)
Age indicator (green <5 min, orange ≥5 min, red ≥10 min confirmed / ≥20 min preparing)
One action button: "Start Preparing" (confirmed → preparing) or "Mark Ready" (preparing → ready)
Live dot in toolbar pulses and shows time since last sync.

Catering
Pipeline tabs: All / New / In Progress / Confirmed / Lost

Status flow: new → contacted → proposal_sent → negotiating → confirmed (or lost from any state)

Expandable rows show full lead details: phone, email, guest count range, budget range, source, notes. Operator advances status through pipeline buttons or clicks red "Reject" to mark lost.

Insights
Three tabs: 7d / 30d / 90d. Switching tab reloads /insights/orders?days=N and redraws the Chart.js line chart (revenue by day). Stat cards mirror Overview. Chart.js is lazy-loaded from CDN if not already present.

Customers
Search-and-browse with lazy-loaded detail. Click any row → first-expand fetches GET /customers/:id (full record + order history). Notes textarea is editable and saved via PATCH /customers/:id. All other fields read-only.

Staff
Owner/manager only view. Add staff via modal (name, email, role, password). Edit to update name, phone, or set a new password. Deactivate/Activate via confirmation modal. Current logged-in user cannot deactivate themselves (button hidden).

Personalisation (Presence)
Ten sections, each with its own Save button, each PATCHes only its own key to /presence:

Branding (logo, hero image)
Basics (name, tagline, city, hours, delivery zone)
Contact (phone, WhatsApp, email, address, Google Maps URL)
Social & Listings (Instagram, Facebook, Google Business, Zomato, Swiggy, TripAdvisor)
Hero Text (headline, subheadline)
Our Story (section title, body paragraphs, story image)
Signature Dishes (repeating: name, description, image — add/remove)
Gallery (three groups: food, ambience, people — each an array of image URLs with upload)
Promotions & Features (repeating: title, description, image, CTA, active toggle)
Milestones / Timeline (repeating: year, event — add/remove)
Image uploads use Api.rUploadImage(file) → multipart POST → returns URL which is injected into the relevant field.

Settings
Eight sections, some with Save buttons, some with immediate-effect toggles:

Section	Save Behavior
Delivery Pricing	Form submit
GST	Form submit, GSTIN validated with regex
Ordering	Toggle → immediate PATCH (no button)
Reservations	Add/remove time slots + Save button
Reviews	Form submit (star threshold + Google URL)
Razorpay Payments	Form submit; secret field blank = keep existing
Plan & Products	Read-only display
Security (change password)	Form submit → POST /v1/auth/change-password → toast → reload
Polling Summary
View	Interval	Endpoint	Effect
Orders	10s	/orders?...	Count-diff triggers badge + audio + notification
Tables	15s	/tables	Refreshes all card states and session data
Kitchen	10s	/dine-in/kitchen	Refreshes all order cards + age indicators
Notifications	60s	/notifications?unread=true	Updates bell badge count
All pollers use a MutationObserver to detect when the view is unmounted from the DOM and stop themselves — no memory leaks.

Key Data Interconnections
Orders ↔ Tables: Table session aggregates its orders; Kitchen groups orders by table
Reservations → Tables: Seating a reservation calls /dine-in/session/open, bridging the two views
Menu → Orders: Item names appear in order detail; availability toggle affects what customers can order
Orders → Customers: order_count, total_spent, last_order_at on customer records are server-side aggregates from orders
All Views → Overview: The overview stat cards and tonight panel are summaries of the entire system state
Tables → Kitchen: Both read active dine-in sessions; kitchen advances prep status that reflects back to table order feeds
Operator vs Customer Division
Operators (staff/manager/owner) only — dashboard:

Every view in this dashboard
All CRUD on menu, staff, tables, config
Status advancement on orders, reservations, catering leads, kitchen items
Viewing bills, generating/printing QR codes
Editing presence content and settings
Customers (external — not dashboard):

Place orders (online ordering product)
Make table reservations (via presence page)
Scan table QR to order dine-in (tables product)
Submit catering enquiries (form on presence page)
View restaurant info (presence/public site)
Customers never touch this dashboard. Their actions arrive as data (orders, reservations, leads) that operators then act upon.