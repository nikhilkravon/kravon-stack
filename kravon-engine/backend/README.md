# kravon-core

Backend platform for Kravon. Runs on Railway. Serves all restaurant tenants.

## Stack
- Node.js + Express
- Postgres (Railway managed)
- Razorpay SDK (server-side only)
- Meta WhatsApp Cloud API
- Resend (email)

## Setup

```bash
npm install
cp .env.example .env
# Fill in DATABASE_URL, JWT_SECRET, ADMIN_API_KEY, ENCRYPTION_KEY
node db/migrate.js          # create tables
node db/seeds/dead-flat-co.js  # seed first restaurant
npm run dev
```

## Adding a new restaurant

1. Create a seed file in `db/seeds/<restaurant-slug>.js` (copy dead-flat-co.js)
2. Run: `node db/seeds/<restaurant-slug>.js`
3. Set Razorpay keys via: `PUT /v1/admin/restaurants/:id` (or update DB directly)
4. That's it — no code changes needed

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/restaurants/:slug/config` | Full config for frontend renderer |
| POST | `/v1/restaurants/:slug/orders` | Create order + Razorpay order |
| POST | `/v1/restaurants/:slug/leads` | Submit catering lead |
| GET | `/v1/restaurants/:slug/insights/summary` | Analytics (auth required) |
| POST | `/v1/webhooks/razorpay` | Payment confirmation webhook |
| GET/POST | `/v1/admin/restaurants` | Tenant management |

## Environment Variables

See `.env.example` for required variables.
`ENCRYPTION_KEY` must be a 64-char hex string: `openssl rand -hex 32`

## Railway deployment notes

- In Railway, set the following Environment Variables (Project > Variables) before deploying:
	- `DATABASE_URL` — your Postgres connection string
	- `JWT_SECRET`, `ADMIN_API_KEY`, `ENCRYPTION_KEY` — secrets used by the app
	- `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`, `BUCKET`, `ENDPOINT`, `REGION` (or `AWS_REGION`) — for S3-compatible image uploads
	- `PORT` is optional; Railway sets it automatically

After adding variables, click **Deploy Changes**. Check the server logs for the startup line that contains `[s3] resolved region=` to confirm S3 config.
