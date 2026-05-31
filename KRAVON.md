# Kravon Platform

Kravon is a multi-tenant restaurant SaaS built by one person. It gives restaurants a branded presence page, online ordering, QR dine-in, catering lead capture, and a full owner dashboard — all under one platform, billed by plan tier.

---

## What it does

A restaurant signs up and gets a slug (`spice-of-india`). From that slug, the platform serves:

| Product | URL | Who sees it |
|---|---|---|
| Presence | `/presence/?slug=…` | Guests — branded landing page |
| Orders | `/orders/?slug=…` | Guests — delivery / pickup |
| Tables | `/tables/?slug=…` | Guests — QR dine-in ordering |
| Catering | `/catering/?slug=…` | Guests — event lead form |
| Dashboard | `/dashboard/` | Owner / staff — management SPA |

Every product boots from a single `GET /v1/restaurants/:slug/config` call that returns the full CONFIG object — menu, capabilities, brand, contact, hours, payment methods. No product has its own bootstrap request.

---

## Plans

| Plan | What's included |
|---|---|
| Starter | Presence + WhatsApp ordering |
| Growth | Presence + Razorpay online orders + order dashboard |
| Pro | Growth + QR tables + dine-in sessions + kitchen view |
| Enterprise | Pro + insights analytics + staff accounts |

Plan is stored as `tenant.restaurants.plan VARCHAR(20)`. Feature flags (`has_orders`, `has_tables`, `has_catering`, `has_insights`) gate backend routes via `requireFeature()` middleware. `CONFIG.capabilities.checkoutStrategy` is either `'whatsapp'` (Starter) or `'orders'` (Growth+) — the Presence frontend uses this to decide where the cart goes.

---

## Architecture

### Stack

- **Backend** — Node.js / Express, port 3000. No ORM. Raw `pg` queries throughout.
- **Database** — PostgreSQL on Railway. v12 multi-schema design.
- **Frontend** — Vanilla JS, static HTML, zero bundler, zero framework. Dev server on port 8000.

### Database schemas

```
tenant.*    — restaurants, locations, staff, roles, integrations, staff_sessions
menu.*      — menus, categories, menu_items, item_variants, customization_groups, customization_options
orders.*    — orders, order_items
dining.*    — tables, sessions
brand.*     — assets, contact_links, announcements, seo, themes
catering.*  — leads
customer.*  — customers
```

Every table has `tenant_id`, `deleted_at` (soft delete), `created_at`, `updated_at`. Nothing is hard-deleted.

### Tenant resolution

Every restaurant-scoped request goes through `resolveRestaurant` middleware in `tenant.js`. It resolves the tenant from (in order): `:slug` URL param → Kravon subdomain (`slug.kravon.in`) → custom domain (stored in `settings.domain`). The resolved `req.tenant` object is a flat struct assembled from six parallel DB queries — no N+1s.

### Config assembly

`GET /v1/restaurants/:slug/config` is public and cached for 60 seconds per tenant. It joins `brand.assets`, `tenant.locations`, `tenant.integrations`, `brand.contact_links`, `brand.seo`, and `brand.announcements` alongside the menu tree — all in two queries. Output shape:

```
config.brand          — name, tagline, logoUrl
config.capabilities   — feature flags, plan, checkoutStrategy
config.contact        — phone, email, waNumber, address, city
config.hours          — display, openUntil, navBadge
config.order          — deliveryFee, freeDeliveryAbove, currency
config.tables         — paymentMode, razorpayKeyId, reviewThreshold
config.categories[]   — full menu tree with items
config.hero           — image, headline, sub
config.story          — headline, body[], facts[]
config.gallery        — food[], ambience[], people[]
config.featured[]     — active promos / announcements
config.signatureDishes[]
config.timeline[]
```

The cache is busted on every `PATCH /config` and `PATCH /presence`.

---

## Backend routes

```
POST   /v1/auth/login
POST   /v1/auth/refresh
POST   /v1/auth/logout
POST   /v1/auth/change-password

GET    /v1/restaurants/:slug/config
PATCH  /v1/restaurants/:slug/config          — requireRestaurantAuth

GET    /v1/restaurants/:slug/presence        — requireRestaurantAuth
PATCH  /v1/restaurants/:slug/presence        — requireRestaurantAuth

GET    /v1/restaurants/:slug/menu/categories
POST   /v1/restaurants/:slug/menu/categories
PUT    /v1/restaurants/:slug/menu/categories/:id
DELETE /v1/restaurants/:slug/menu/categories/:id
POST   /v1/restaurants/:slug/menu/items
PUT    /v1/restaurants/:slug/menu/items/:id
DELETE /v1/restaurants/:slug/menu/items/:id
PATCH  /v1/restaurants/:slug/menu/items/:id/availability
GET    /v1/restaurants/:slug/menu/items/:id  — variants + customizations

GET    /v1/restaurants/:slug/orders          — requireFeature(has_orders)
POST   /v1/restaurants/:slug/orders
GET    /v1/restaurants/:slug/orders/:id

GET    /v1/restaurants/:slug/insights/summary   — requireFeature(has_insights)
GET    /v1/restaurants/:slug/insights/orders

GET    /v1/restaurants/:slug/dine-in/kitchen    — requireFeature(has_tables)
POST   /v1/restaurants/:slug/dine-in/session/open
POST   /v1/restaurants/:slug/dine-in/session/close
GET    /v1/restaurants/:slug/dine-in/bill
GET    /v1/restaurants/:slug/dine-in/reservations
PATCH  /v1/restaurants/:slug/dine-in/reservations/:id

GET    /v1/restaurants/:slug/tables             — requireFeature(has_tables)
POST   /v1/restaurants/:slug/tables
PUT    /v1/restaurants/:slug/tables/:id
DELETE /v1/restaurants/:slug/tables/:id

GET    /v1/restaurants/:slug/staff
POST   /v1/restaurants/:slug/staff
PATCH  /v1/restaurants/:slug/staff/:id
DELETE /v1/restaurants/:slug/staff/:id

GET    /v1/restaurants/:slug/customers
GET    /v1/restaurants/:slug/customers/:id
PATCH  /v1/restaurants/:slug/customers/:id

POST   /v1/restaurants/:slug/leads              — requireFeature(has_catering)
GET    /v1/restaurants/:slug/leads
PATCH  /v1/restaurants/:slug/leads/:id

GET    /v1/restaurants/:slug/reviews            — requireFeature(has_tables)
POST   /v1/restaurants/:slug/reviews

GET    /v1/restaurants/:slug/insights/summary
GET    /v1/restaurants/:slug/insights/orders

POST   /v1/webhooks/razorpay
GET    /v1/admin/…                              — ADMIN_API_KEY header
GET    /health
```

---

## Auth

JWT-based. Access token (15 min) lives in memory only — never written to storage. Refresh token (30 days) is a 32-byte random hex, SHA-256 hashed before storage in `tenant.staff_sessions`. Issued as an HttpOnly cookie and also returned in the JSON body for backward compat.

On any 401 mid-session, `api.js` retries once after a silent refresh. If the refresh also fails, `App.sessionExpired()` clears storage and shows the login screen.

JWT payload: `{ staffId, tenantId, slug, roles }`.

Password changes revoke all existing sessions immediately.

---

## Owner Dashboard

A vanilla JS SPA. No React, no Vue, no build step. `index.html` loads scripts in order; each view is a module IIFE that exports `{ init(el) }`. Navigation is hash-based (`#orders`, `#menu`, etc.). `app.js` owns the router.

### Views

| View | What it does |
|---|---|
| Overview | Stat cards (orders, revenue, covers, leads) + last 5 orders |
| Orders | Paginated order list, tab filters by status, search by name/phone |
| Menu | Accordion categories, add/edit/delete modals, inline availability toggle, drag-to-reorder, image upload, addons + spice levels |
| Reservations | Paginated reservations, status actions (confirm / seat / complete / cancel / no-show) |
| Tables | Floor grid with live session state, QR code modal, open/close session, bill viewer |
| Kitchen | Live order board per table, auto-refreshes every 30 s |
| Catering | Lead pipeline (new → contacted → proposal sent → negotiating → confirmed / lost) |
| Insights | 30-day stat cards + Chart.js revenue line chart |
| Customers | CRM list with order stats, expandable history, inline notes |
| Staff | List + add/edit/deactivate/delete team members |
| Personalisation | Branding (logo, hero image), Basics, Contact, Social links, Story, Signature dishes, Gallery, Promotions, Milestones |
| Settings | Delivery pricing, Reviews (Google redirect threshold), Razorpay payments, Plan & products, Security (change password) |

### View pattern

Every view follows the same shape:

```js
const FooView = (() => {
  async function init(el) {
    el.innerHTML = skeleton;
    try {
      const data = await Api.rGet('/foo');
      el.innerHTML = render(data);
      bindEvents(el);
    } catch (err) {
      el.innerHTML = DashUI.errorState(err.message);
    }
  }
  return { init };
})();
```

### API helpers

```js
Api.rGet('/orders?page=1')              // GET /v1/restaurants/:slug/orders?page=1
Api.rPost('/menu/items', body)
Api.rPatch('/config', body)
Api.rPut('/tables/:id', body)
Api.rDel('/menu/categories/:id')
```

The slug is injected automatically from `Auth.state().slug`.

---

## Personalisation → Presence pipeline

Owners edit brand content in the Personalisation view. Each section saves independently to `PATCH /v1/restaurants/:slug/presence`. The backend writes to the correct normalised table:

| Section | DB destination |
|---|---|
| Branding (logo, hero image) | `brand.assets` (type = `logo` / `banner`) |
| Basics (name, tagline, city, hours, delivery zone) | `tenant.restaurants` + `tenant.locations` |
| Contact (phone, address, email, WhatsApp, Maps URL) | `tenant.locations` + `brand.contact_links` + `settings` JSONB |
| Social links | `brand.contact_links` (platform = instagram / zomato / etc.) |
| Story, signature dishes, milestones, timeline | `settings.presence` JSONB |
| Gallery | `brand.assets` (type = `gallery`, metadata.category = food / ambience / people) |
| Promotions | `brand.announcements` |

After every save, the 60-second config cache is busted. The Presence frontend re-fetches on next load and renders the updated content — logo in the nav, hero image as the banner, everything else in its section.

---

## Presence frontend

The presence page (`/presence/`) is a pure marketing site — no cart, no auth. It boots by fetching `/config`, then calls a series of `render*()` functions that insert sections into the DOM in order: Nav → Hero → Story → Signature Dishes → Gallery → Promotions → Timeline → Contact → Footer.

Logo is rendered conditionally: if `C.brand.logoUrl` exists, an `<img class="p-nav-logo">` is inserted alongside the restaurant name in the nav. Hero image comes from `C.hero.image`. All content sections are skipped if their data arrays are empty, so a restaurant with no gallery doesn't get a broken empty grid.

---

## Settings vs Personalisation — clear split

**Personalisation** owns everything the guest sees: brand identity, content, imagery, copy.

**Settings** owns everything operational: delivery pricing, payment credentials, review redirect, plan tier, and account security.

There is no overlap. Fields that affect the guest-facing page are not duplicated in Settings.

---

## Data design notes

- `orders.orders.channel` — `web | qr | whatsapp | phone | pos`
- `orders.orders.fulfillment_type` — `delivery | pickup | dine_in | catering`
- `orders.orders.status` — `pending | confirmed | preparing | ready | out_for_delivery | delivered | completed | cancelled | refunded`
- Razorpay key secret is AES-256 encrypted at rest via `utils/crypto.js` before storage in `tenant.integrations`
- All config writes (PATCH /config, PATCH /presence) bust the 60s in-memory config cache immediately
- Catering leads live in `catering.leads`, not `orders.orders` — different schema, different pipeline
- Reservations live in `dining.reservations` via the dine-in router — separate from table sessions

---

## Running locally

```bash
# Backend
cd kravon-engine/backend
cp .env.example .env   # set DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY, ADMIN_API_KEY
node server.js          # → http://localhost:3000

# Frontend
cd kravon-engine/frontend
node server.js          # → http://localhost:8000

# Dashboard
open http://localhost:8000/dashboard/
```

---

## What's next

- Self-serve onboarding — sign-up form → restaurant creation → first config wizard
- Billing integration — Razorpay subscriptions tied to plan tier
