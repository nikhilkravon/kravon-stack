# Kravon Backend

> Restaurant SaaS platform API — built with Node.js, Fastify & PostgreSQL.

---

## Quick Start

### Prerequisites
- **Node.js** ≥ 18
- **PostgreSQL** ≥ 14
- **npm** ≥ 9

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env with your database credentials and secrets
```

### 3. Run in development
```bash
npm run dev        # starts with nodemon (hot-reload)
```

### 4. Run in production
```bash
npm start
```

---

## Project Structure

```
kravon-backend/
├── server.js                   # Entry point — Fastify instance, plugins, routes, listen
├── src/
│   ├── db/
│   │   └── index.js            # pg Pool, query(), getClient(), withTransaction()
│   ├── plugins/
│   │   └── db.js               # Fastify plugin — decorates instance with fastify.db
│   ├── routes/                 # Fastify route definitions (one file per resource)
│   ├── controllers/            # Request handlers — delegate to services, send replies
│   └── services/               # Business logic — all direct DB interaction lives here
├── .env.example                # Environment variable template
├── .gitignore
└── package.json
```

---

## API Endpoints

| Method | Path      | Description                                  |
|--------|-----------|----------------------------------------------|
| GET    | `/health` | Health check — returns `{ status, timestamp }` |

> API v1 routes will be mounted under `/api/v1/` as features are added.

---

## Environment Variables

| Variable        | Description                            | Default       |
|-----------------|----------------------------------------|---------------|
| `PORT`          | Server port                            | `3000`        |
| `NODE_ENV`      | `development` \| `production`          | `development` |
| `CORS_ORIGIN`   | Allowed CORS origin(s)                 | `*`           |
| `DB_HOST`       | PostgreSQL host                        | `localhost`   |
| `DB_PORT`       | PostgreSQL port                        | `5432`        |
| `DB_USER`       | PostgreSQL user                        | —             |
| `DB_PASSWORD`   | PostgreSQL password                    | —             |
| `DB_NAME`       | PostgreSQL database name               | —             |
| `DB_SSL`        | Enable SSL (`"true"` / `"false"`)      | `false`       |
| `JWT_SECRET`    | Secret key for signing JWTs            | —             |
| `JWT_EXPIRES_IN`| JWT expiry duration (e.g. `7d`)        | `7d`          |

---

## Using `fastify.db` in Routes

The database pool is available on every Fastify instance via the `db` decorator registered in `src/plugins/db.js`:

```js
// src/routes/restaurants.js
module.exports = async function (fastify) {
  fastify.get('/', async (request, reply) => {
    const { rows } = await fastify.db.query('SELECT * FROM restaurants');
    return rows;
  });
};
```

For transactions:

```js
const result = await fastify.db.withTransaction(async (client) => {
  await client.query('INSERT INTO orders ...');
  await client.query('UPDATE inventory ...');
  return result;
});
```

---

## Scripts

| Command       | Description                      |
|---------------|----------------------------------|
| `npm run dev` | Start dev server with hot-reload |
| `npm start`   | Start production server          |

---

## License

MIT © Kravon Team
