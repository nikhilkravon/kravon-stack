# Kravon Platform — Onboarding

## New Developer Setup

### 1. Clone and install

```bash
git clone https://github.com/tengle-tech/kravon-platform
cd kravon-platform/backend
npm install
cp .env.example .env
```

### 2. Fill in .env

```
DATABASE_URL=postgresql://user:password@host:5432/kravon
JWT_SECRET=<openssl rand -hex 32>
ADMIN_API_KEY=<openssl rand -hex 32>
ENCRYPTION_KEY=<openssl rand -hex 32>   # must be exactly 64 hex chars (32 bytes)
RAZORPAY_WEBHOOK_SECRET=<from Razorpay dashboard>
WHATSAPP_TOKEN=                          # leave blank for local dev
WHATSAPP_PHONE_ID=                       # leave blank for local dev
```

### 3. Run migrations and seed

```bash
node db/migrate.js                    # creates all tables
node db/migrations/v10-domain.js      # adds domain column (if upgrading from V9)
node db/seeds/dead-flat-co.js         # seeds demo restaurant
npm run dev                           # starts on :3000
```

### 4. Verify

```bash
curl http://localhost:3000/health
# → { "status": "ok" }

curl http://localhost:3000/v1/restaurants/dead-flat-co/config
# → { "ok": true, "config": { ... } }
```

---

## Onboarding a New Restaurant

### Step 1 — Seed the restaurant

Copy `backend/db/seeds/dead-flat-co.js` to `backend/db/seeds/{slug}.js`.
Fill in the restaurant data. Run:

```bash
node db/seeds/burger-house.js
```

### Step 2 — Set Razorpay keys (if using Orders or Tables with online payment)

```bash
curl -X PUT https://api.kravon.in/v1/admin/restaurants/{id} \
  -H "x-kravon-admin-key: YOUR_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "razorpay_key_id": "rzp_live_...", "razorpay_key_secret": "..." }'
```

The secret is encrypted before being stored. It never leaves the backend in plaintext.

### Step 3 — Set custom domain (optional)

```bash
curl -X PUT https://api.kravon.in/v1/admin/restaurants/{id} \
  -H "x-kravon-admin-key: YOUR_ADMIN_KEY" \
  -d '{ "domain": "burgerhouse.in" }'
```

### Step 4 — Deploy frontend

1. Fork / clone `kravon-platform/frontend/`
2. Create a new Vercel project pointing at the frontend folder
3. Set environment variables in Vercel:
   ```
   RESTAURANT_SLUG = burger-house
   KRAVON_API_URL  = https://api.kravon.in
   ```
4. Deploy — no code changes needed between restaurants

### Step 5 — Generate table QR codes (Tables product only)

```bash
node backend/scripts/generate-qr.js \
  --domain https://burgerhouse.in \
  --tables 12 \
  --name "Burger House" \
  --out ./burger-house-qr.html
```

Open the HTML file in a browser and print. Cut to A6, laminate.

### Step 6 — Validate config

```bash
node backend/scripts/validate-config.js --slug burger-house
# → validates live API response against V10 spec
```

### Step 7 — Configure webhook (optional)

Set `webhook_url` in the DB for n8n / Zapier integration:

```bash
curl -X PUT https://api.kravon.in/v1/admin/restaurants/{id} \
  -H "x-kravon-admin-key: YOUR_ADMIN_KEY" \
  -d '{ "webhook_url": "https://n8n.yourdomain.com/webhook/kravon" }'
```

Every confirmed order and catering lead will POST to this URL.

---

## Frontend Product URLs

| URL        | Product  | File                       |
|------------|----------|----------------------------|
| `/`        | Presence | `presence/index.html`      |
| `/order`   | Tables / Orders | `tables/index.html` or `orders/index.html` |
| `/catering`| Catering | `catering/index.html`      |
| `/insights`| Insights | `insights/index.html`      |

---

## Environment Variables Reference

| Variable                 | Required | Description |
|--------------------------|----------|-------------|
| `DATABASE_URL`           | ✓        | Postgres connection string |
| `JWT_SECRET`             | ✓        | Signs admin JWT tokens |
| `ADMIN_API_KEY`          | ✓        | Protects `/v1/admin` routes |
| `ENCRYPTION_KEY`         | ✓        | 64-char hex — encrypts Razorpay secrets |
| `RAZORPAY_WEBHOOK_SECRET`| ✓        | Platform-wide Razorpay webhook HMAC secret |
| `WHATSAPP_TOKEN`         | —        | Meta Cloud API bearer token |
| `WHATSAPP_PHONE_ID`      | —        | Meta Cloud API phone ID |
| `RESEND_API_KEY`         | —        | Email via Resend |
| `EMAIL_FROM`             | —        | Sender address (default: noreply@kravon.in) |
| `KRAVON_DOMAIN`          | —        | Platform domain for subdomain resolution (default: kravon.in) |
| `NODE_ENV`               | —        | `production` or `development` |
| `PORT`                   | —        | HTTP port (default: 3000) |
