# kravon-restaurant-template

Frontend website template. Deploy to Vercel. One deployment per restaurant.

## Setup

```bash
# In Vercel environment variables (NOT .env file in production):
RESTAURANT_SLUG=dead-flat-co
KRAVON_API_URL=https://api.kravon.in
```

## Deploying a new restaurant

1. Fork / clone this repo
2. Set `RESTAURANT_SLUG` and `KRAVON_API_URL` in Vercel env vars
3. Deploy

No code changes required between restaurants.
All content comes from the API.

## Pages

| URL path | File | Product |
|----------|------|---------|
| `/` | `presence/index.html` | Presence (WhatsApp ordering) |
| `/order` | `orders/index.html` | Orders (direct checkout) |
| `/catering` | `catering/index.html` | Catering (B2B leads) |
| `/insights` | `insights/index.html` | Insights (analytics) |

## What changed from V7

| File | Change |
|------|--------|
| `config/config.js` | **Removed.** Config comes from API via `api-client/kravon-api.js` |
| `*/boot.js` | **New.** Fetches config async, then initialises renderer + behaviour |
| `orders/assets/js/checkout.js` | `placeOrder()` now POSTs to API and opens Razorpay modal |
| `catering/assets/js/behaviour.js` | `submitForm()` now POSTs to `/leads` API |
| All other JS/CSS | **Unchanged from V7** |
