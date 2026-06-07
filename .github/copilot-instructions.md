# Kravon Stack — Copilot Instructions

## What this is

Kravon is a multi-tenant restaurant SaaS platform. A single deployment serves many restaurants. Each restaurant is identified by a `slug` (e.g. `spice-of-india`).

## Monorepo layout

```
kravon-engine/
├── backend/          — Node.js / Express API (port 3000)
│   ├── server.js     — entry point, all route mounts
│   ├── api/
│   │   ├── middleware/
│   │   │   ├── auth.js      — requireAuth, requireRestaurantAuth
│   │   │   └── tenant.js    — resolveRestaurant → req.tenant
│   │   └── routes/          — one file per feature domain
│   └── db/
│       ├── pool.js           — pg connection pool
│       ├── migrations/       — run with node db/migrations/<file>.js
│       └── seeds/            — seed data scripts
└── frontend/         — Vanilla JS, static HTML, no bundler (port 8000)
    ├── server.js     — static file server; replaces %%PLACEHOLDERS%% in HTML
    ├── dashboard/    — staff SPA (auth-gated)
    ├── tables/       — QR dine-in ordering (public, guest-facing)
    ├── orders/       — delivery ordering (public)
    ├── presence/     — restaurant landing page (public)
    ├── catering/     — catering lead form (public)
    └── shared/js/    — cart.js, item-controls.js, kravon.js (shared across frontends)
```

## Backend

### Route pattern

All restaurant-scoped routes follow:
```
/v1/restaurants/:slug/<feature>
```
Middleware chain: `resolveRestaurant` → (optionally `requireFeature('has_X')`) → `requireRestaurantAuth` → handler.

```js
app.use('/v1/restaurants/:slug/dine-in',  resolveRestaurant, requireFeature('has_tables'), dineInRoutes);
app.use('/v1/restaurants/:slug/tables',   resolveRestaurant, requireFeature('has_tables'), tablesRoutes);
app.use('/v1/restaurants/:slug/menu',     resolveRestaurant, menuRoutes);
app.use('/v1/restaurants/:slug/orders',   resolveRestaurant, requireFeature('has_orders'), orderRoutes);
app.use('/v1/restaurants/:slug/insights', resolveRestaurant, requireFeature('has_insights'), insightRoutes);
app.use('/v1/restaurants/:slug/leads',    resolveRestaurant, requireFeature('has_catering'), leadRoutes);
app.use('/v1/restaurants/:slug/staff',    resolveRestaurant, staffRoutes);
app.use('/v1/restaurants/:slug/customers',resolveRestaurant, customersRoutes);
app.use('/v1/auth', authRoutes);
```

### Auth

- JWT: `{ staffId, tenantId, slug, roles }` — use `req.auth.tenantId` (not `restaurantId`)
- Access token: 15-min, in-memory on client
- Refresh token: 30-day, `HttpOnly` cookie + `localStorage.krv_rt`
- Rate limits: auth 10 req/min, order placement 20 req/min (per IP)

### Database schema

PostgreSQL multi-schema layout:

| Schema | Tables |
|--------|--------|
| `tenant` | `restaurants`, `staff`, `staff_sessions` |
| `menu` | `menus`, `categories`, `menu_items` |
| `orders` | `orders` |
| `dining` | `sessions`, (orders via orders schema) |
| `customer` | `customers` |
| `catering` | `leads` |
| `brand` | `assets` |
| `platform` | `schema_migrations` |

**Critical column names — `orders.orders`:**
- `channel` ENUM: `web | qr | whatsapp | phone | pos`
- `fulfillment_type` ENUM: `delivery | pickup | dine_in | catering`
- `status` ENUM: `pending | confirmed | preparing | ready | out_for_delivery | delivered | completed | cancelled | refunded`
- Customer info via FK: `customer_id → customer.customers(id, name, phone, email)`

**`dining.sessions` state machine:**
- `session_status`: `open → bill_requested → closed → paid`
- Bill tracking: `bill_requested_at TIMESTAMPTZ`, `bill_requested_by TEXT`, `bill_owner_name TEXT`, `bill_owner_phone TEXT`

**`tenant.restaurants`:**
- Operational config in `settings` JSONB column
- Feature flags: `has_orders`, `has_tables`, `has_catering`, `has_insights` BOOLEAN
- `plan` VARCHAR(20): `starter | growth | pro | enterprise`

**Always add `deleted_at IS NULL` guards** — all major tables are soft-deleted.

**Menu:** `menu.menus → menu.categories → menu.menu_items`. Categories require `menu_id` FK — use `getOrCreateMenu(tenantId)` helper.

### Running locally

```bash
# Backend (from kravon-engine/backend/)
node server.js   # port 3000, reads .env in this directory

# Frontend (from kravon-engine/frontend/)
node server.js   # port 8000
```

## Frontend

### No framework, no bundler

All frontend JS is plain ES5/ES6 IIFEs loaded via `<script>` tags. No React, no Vue, no TypeScript, no webpack/Vite. Do not introduce build tools.

### Environment variable injection

`frontend/server.js` replaces placeholders in HTML at request time:

| Placeholder | Env var | Default |
|-------------|---------|---------|
| `%%KRAVON_API_URL%%` | `BACKEND_URL` | `http://localhost:3000` |
| `%%KRAVON_FRONTEND_URL%%` | `FRONTEND_URL` | `http://localhost:8000` |
| `%%RESTAURANT_SLUG%%` | `RESTAURANT_SLUG` | `''` |

These become `window.KRAVON_API_BASE`, `window.KRAVON_FRONTEND_BASE` in the browser.

**Production frontend URL:** `https://kravon-frontend-production.up.railway.app`

### Dashboard SPA

`frontend/dashboard/` is a hash-router SPA. All views follow this exact pattern:

```js
const FooView = (() => {
  async function init(el) {
    el.innerHTML = '<skeleton>';          // render immediately
    try {
      const data = await Api.rGet('/foo');
      el.innerHTML = render(data);
      bindEvents(el);
    } catch (err) {
      el.innerHTML = `<div class="empty-state">Error: ${err.message}</div>`;
    }
  }
  return { init };
})();
```

**Dashboard API helpers (`api.js`):**
```js
Api.rGet('/menu/categories')          // GET /v1/restaurants/:slug/menu/categories
Api.rPost('/menu/items', body)        // POST ...
Api.rPut('/menu/items/:id', body)
Api.rPatch('/menu/items/:id/availability', body)
Api.rDel('/menu/categories/:id')
```
The `:slug` is injected automatically from `Auth.state().slug`.

**Auth state in dashboard:**
```js
Auth.isLoggedIn()    // true if AT in memory or krv_staff in localStorage
Auth.state()         // { slug, staff: { name, email, roles } }
Auth.getToken()      // returns AT, auto-refreshes if near expiry
```

**Hash navigation quirk:** Setting `location.hash = '#tables'` when already on `#tables` does NOT fire `hashchange`. To force a view reload, navigate away first (`#overview`), wait for it to settle, then navigate back.

**OverviewView race condition:** `OverviewView.init()` is async (3 parallel API calls). If you change the hash while it is in flight, the `Promise.all` resolve will overwrite `el.innerHTML` with the overview grid. Wait for `#dash-content` to contain `'Revenue'` before navigating away from `#overview`.

### Tables UI (guest-facing QR ordering)

`frontend/tables/` — screens: `#guest-popup-overlay` → `#screenOrdering` → `#screenCheckout` → `#screenConfirm`

- Guest identity collected via `#guestName`, `#guestPhone`, submitted via `#guestPopupBtn`
- `#navCartBtn` appears in all three screens — scope selectors to `#screenOrdering #navCartBtn`
- Cart drawer open button: `[data-action="go-checkout"]`
- Order placement: `[data-action="place-order"]`
- Bill request: `#requestBillBarBtn` (ordering screen) or `#billRequestBtn` (confirm screen)

### QR code URL format

```
{FRONTEND_URL}/tables/?slug={restaurant_slug}&table_id={table_uuid}
```

Generated in `frontend/dashboard/assets/js/views/tables.js` using `window.KRAVON_FRONTEND_BASE`. Set `FRONTEND_URL` env var on the frontend Railway service to fix localhost QR codes in production.

## CSS design system

All dashboard styles are in `frontend/dashboard/assets/css/dashboard.css`.

Key tokens:
```css
--sidebar-w: 220px;   --header-h: 56px;
--gray-900   /* sidebar bg */
--gray-50    /* main bg */
--blue-600   /* primary action */
--green-600  /* available / success */
--red-500    /* danger / non-veg */
--amber-600  /* warning / egg */
```

Badge classes: `.badge-delivered`, `.badge-preparing`, `.badge-placed`, `.badge-pending`
Bill alert: `.bill-requested-alert`
Table card states: `.table-card--occupied`, `.table-card--available`, `.table-card--urgent`, `.table-card--warning`

## Testing

Playwright E2E suite in `kravon-engine/tests/`. 11 scenarios covering a full restaurant day.

```bash
cd kravon-engine/tests
npx playwright test --workers=1   # always 1 worker — rate limiter is 20 req/min
```

Test fixtures: `fixtures/pages.ts` (CustomerPage, DashboardPage POMs), `fixtures/api.ts` (direct API helpers), `fixtures/env.ts` (SLUG, DASHBOARD_URL, tableUrl).

**Key constraints:**
- Always `workers=1` — concurrent workers hit the order rate limiter
- Batch order placement in groups of ≤15 with 2s gaps between batches
- `ensureTableClosed()` before any test that assumes a clean table state
- Dashboard polling interval is 15s — use `dashboardPage.refresh()` (hash round-trip) instead of waiting for the poll timer

## Conventions

- No comments that explain what the code does — only add a comment when the WHY is non-obvious
- No TypeScript in the frontend — plain JS only
- No ORM — raw SQL with `pg` pool
- All DB queries must include `deleted_at IS NULL` where applicable
- Never hardcode `localhost` in frontend source — use `window.KRAVON_API_BASE` / `window.KRAVON_FRONTEND_BASE`
- Prefer editing existing files to creating new ones
- No half-finished implementations — if you can't complete it, say so
