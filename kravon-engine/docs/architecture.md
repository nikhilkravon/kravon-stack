# Kravon Platform — Architecture

## Overview

Kravon is a multi-tenant infrastructure platform for local food businesses. Every restaurant gets a branded website, dine-in ordering, delivery ordering, and a B2B catering funnel — all from one shared backend.

---

## Components

```
kravon-platform/
├── backend/          Node.js API on Railway
├── frontend/         Static HTML/CSS/JS on Vercel (one deploy per restaurant)
├── configs/          Per-restaurant JSON config snapshots
└── docs/             This folder
```

### Backend (Railway)
- Node.js + Express
- PostgreSQL (Railway managed)
- Zod validation on all inputs
- Razorpay SDK (server-side only — keys never touch the frontend)
- Meta WhatsApp Cloud API
- Resend (email)

### Frontend (Vercel)
- Pure HTML, CSS, vanilla JS — no frameworks
- One Vercel deployment per restaurant
- Each product lives in its own folder: `presence/`, `tables/`, `orders/`, `catering/`
- Each product follows the `boot.js → renderer.js → behaviour.js` pattern
- All content comes from the API — no hardcoded restaurant data in the frontend

---

## Tenant Resolution

Every API request is resolved to a restaurant tenant before any route logic runs.

Resolution order (first match wins):

1. **URL slug** — `/v1/restaurants/burgerhouse/orders`
2. **Kravon subdomain** — `Host: burgerhouse.kravon.in`
3. **Custom domain** — `Host: burgerhouse.in` (matched against `domain` column)

The middleware attaches `req.tenant`:

```js
{
  rest_id:      17,
  slug:         "burgerhouse",
  domain:       "burgerhouse.in",
  has_presence: true,
  has_tables:   true,
  has_orders:   false,
  has_catering: true,
  has_insights: false,
  // ...full restaurant row
}
```

See: `backend/api/middleware/tenant.js`

---

## Feature Flags

Every product route is gated by `requireFeature(flag)`. If a restaurant hasn't purchased a product, the request is rejected with 403 before any service code runs.

```
/config          — no gate (all products boot from here)
/orders          — requireFeature('has_orders')
/reviews         — requireFeature('has_tables')
/leads           — requireFeature('has_catering')
/insights        — requireFeature('has_insights')
```

`has_presence` is not gated — Presence is a static HTML product with no API routes.

See: `backend/api/middleware/feature.js`

---

## Product Surfaces

| Product  | Who          | Where           | Route            |
|----------|--------------|-----------------|------------------|
| Presence | Anyone       | Home / mobile   | Static only      |
| Tables   | Walk-in      | Restaurant      | /orders (tables) |
| Orders   | Home customer| Home            | /orders (orders) |
| Catering | B2B          | Anywhere        | /leads           |

Tables and Orders share the `/orders` endpoint, differentiated by `order_surface` in the request body (`"tables"` or `"orders"`).

---

## Data Layer

- All DB queries filter by `restaurant_id` — no query can touch another tenant's rows.
- The `id` column in the `restaurants` table is aliased as `rest_id` in `req.tenant`.
- Razorpay `key_secret` is encrypted at rest with AES-256-GCM (`utils/crypto.js`).
- Schema: `backend/db/schema.js`
- Migrations: `backend/db/migrations/`

---

## Webhook System

Every confirmed order and every catering lead fires an outbound webhook to the restaurant's configured `webhook_url`.

This makes the platform n8n / Zapier / custom-script compatible out of the box. Even if no integration is connected, the event fires — ensuring future integrations never require backend changes.

```js
// Order confirmed
{ type: "order.confirmed", rest_id: 17, order_id: 112, ts: 1718000000000 }

// Lead created
{ type: "lead.created", rest_id: 17, lead_id: 8, ts: 1718000000000 }
```

See: `backend/integrations/webhook.js`

---

## File Map

```
backend/
├── server.js                    Entry point, route mounting
├── api/
│   ├── middleware/
│   │   ├── tenant.js            Tenant resolution (slug/domain/subdomain → req.tenant)
│   │   ├── feature.js           Feature flag gate (requireFeature)
│   │   ├── auth.js              JWT validation for admin/insights routes
│   │   ├── cors.js              Per-restaurant CORS origin whitelist
│   │   └── error.js             Global error handler
│   └── routes/
│       ├── config.js            GET /config — full restaurant config for frontend
│       ├── orders.js            POST /orders — Tables + Orders unified
│       ├── reviews.js           POST /reviews — Tables post-order review
│       ├── leads.js             POST /leads — Catering enquiry
│       ├── insights.js          GET /insights/* — analytics (JWT required)
│       ├── webhooks.js          POST /webhooks/razorpay — inbound Razorpay events
│       └── admin.js             POST /admin/restaurants — tenant management
├── services/
│   ├── order.service.js         Order creation lifecycle
│   ├── lead.service.js          Lead scoring + creation
│   └── notify.service.js        WA message formatting + dispatch
├── integrations/
│   ├── razorpay.js              createPayment(), getClient()
│   ├── whatsapp.js              sendOrderNotification(), sendLeadNotification()
│   ├── email.js                 sendOrderNotification(), sendLeadNotification()
│   └── webhook.js               orderConfirmed(), leadCreated() — outbound webhook bus
├── db/
│   ├── pool.js                  Shared pg connection pool
│   ├── schema.js                Full schema SQL (run via migrate.js)
│   ├── migrate.js               Schema runner
│   ├── migrations/
│   │   ├── v9-tables.js         V8 → V9 (Tables product, reviews)
│   │   └── v10-domain.js        V9 → V10 (domain column)
│   └── seeds/
│       └── dead-flat-co.js      Demo restaurant seed
├── scripts/
│   ├── generate-qr.js           QR code HTML generator for table cards
│   └── validate-config.js       Live config validator (fetches from API)
└── utils/
    └── crypto.js                AES-256-GCM encrypt/decrypt for Razorpay secrets
```
