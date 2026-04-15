# Kravon Platform — API Reference

Base URL: `https://api.kravon.in`

All restaurant-scoped routes are prefixed: `/v1/restaurants/:slug/`

---

## Public Routes

### GET /health
Returns server status. No auth required. Used by Railway health checks.

```json
{ "status": "ok", "ts": 1718000000000 }
```

---

## Restaurant-Scoped Routes

### GET /v1/restaurants/:slug/config
Returns the full restaurant config for the frontend renderer.
No authentication required. All products boot from this endpoint.

**Response:**
```json
{
  "ok": true,
  "config": {
    "restaurant_id": 17,
    "slug": "burgerhouse",
    "brand": { "name": "Burger House", "tagline": "..." },
    "contact": { "phone": "+91...", "waNumber": "91..." },
    "hours": { "display": "...", "openUntil": "..." },
    "products": { "presence": true, "tables": true, "orders": false, "catering": true },
    "tables": { "paymentMode": "razorpay", "reviewThreshold": 4 },
    "menu": [ { "id": 1, "name": "Burgers", "items": [...] } ],
    "addons": [ { "label": "Extra cheese", "price": 40 } ],
    "spiceLevels": ["Mild", "Medium", "Hot"]
  }
}
```

---

### POST /v1/restaurants/:slug/orders
Creates an order. Requires `has_orders` feature flag.

Handles both surfaces via `order_surface` discriminated union.

**Tables order (dine-in / takeaway):**
```json
{
  "order_surface":    "tables",
  "customer_name":    "Rahul Sharma",
  "customer_phone":   "9876543210",
  "table_identifier": "T4",
  "items": [
    { "id": 1, "name": "Classic Burger", "price": 299, "qty": 2 }
  ],
  "payment_method": "offline"
}
```

**Delivery order:**
```json
{
  "order_surface":    "orders",
  "customer_name":    "Priya Mehta",
  "customer_phone":   "9876543210",
  "delivery_address": "12 MG Road",
  "items": [
    { "id": 1, "name": "Classic Burger", "price": 299, "qty": 1 }
  ],
  "delivery_type":    "standard",
  "payment_method":   "upi"
}
```

**Response (Razorpay payment):**
```json
{
  "ok": true,
  "order_id": 112,
  "razorpay_order_id": "order_abc123",
  "razorpay_key_id":   "rzp_live_xyz",
  "total": 29900
}
```

**Response (offline/COD):**
```json
{
  "ok": true,
  "order_id": 113,
  "razorpay_order_id": null,
  "razorpay_key_id":   null,
  "total": 29900
}
```

---

### POST /v1/restaurants/:slug/reviews
Captures a post-order review. Requires `has_tables` feature flag.

```json
{
  "order_id":         112,
  "stars":            4,
  "feedback":         "Great food!",
  "order_surface":    "tables",
  "table_identifier": "T4"
}
```

**Response:**
```json
{
  "ok": true,
  "above_threshold": true,
  "google_review_url": "https://g.page/r/..."
}
```

`google_review_url` is only populated when `stars >= review_threshold`.
The frontend uses this to decide whether to show the Google review nudge.

---

### POST /v1/restaurants/:slug/leads
Submits a catering enquiry. Requires `has_catering` feature flag.

```json
{
  "name":       "Vikram Nair",
  "company":    "Acme Corp",
  "email":      "vikram@acme.com",
  "phone":      "9876543210",
  "budget":     "2.5-5L",
  "pax":        "150-300",
  "event_type": "corporate-offsite",
  "date_start": "2025-09-01",
  "date_end":   "2025-09-03",
  "notes":      "South Indian preferred."
}
```

**Response:**
```json
{
  "ok":   true,
  "ref":  "DFC-1A2B3C",
  "tier": "hot"
}
```

---

### GET /v1/restaurants/:slug/insights/summary
Returns 30-day analytics summary. Requires `has_insights` flag + JWT.

```
Authorization: Bearer <jwt>
```

**Response:**
```json
{
  "ok": true,
  "period": "30d",
  "orders": {
    "total_orders": 145,
    "gross_revenue": 4350000,
    "avg_order_value": 30000,
    "unique_customers": 98
  },
  "leads": { "total_leads": 12, "hot": 3, "warm": 6, "cool": 3 },
  "customers": { "repeat_customers": 44 }
}
```

---

## Inbound Webhook

### POST /v1/webhooks/razorpay
Receives `payment.captured` events from Razorpay.
Validates HMAC signature using `RAZORPAY_WEBHOOK_SECRET` before processing.
Configure this URL in the Razorpay dashboard: `https://api.kravon.in/v1/webhooks/razorpay`

---

## Admin Routes

Protected by `x-kravon-admin-key` header. Kravon team only.

### GET /v1/admin/restaurants
Lists all restaurants.

### POST /v1/admin/restaurants
Onboards a new restaurant.

### PUT /v1/admin/restaurants/:id
Updates restaurant fields (e.g. domain, razorpay keys, webhook_url).

---

## Outbound Webhook Events

Every confirmed order and catering lead fires a POST to `restaurant.webhook_url`.

**order.confirmed:**
```json
{
  "type":     "order.confirmed",
  "rest_id":  17,
  "order_id": 112,
  "ts":       1718000000000
}
```

**lead.created:**
```json
{
  "type":    "lead.created",
  "rest_id": 17,
  "lead_id": 8,
  "ts":      1718000000000
}
```

Both events fire regardless of whether anything listens. See `backend/integrations/webhook.js`.
