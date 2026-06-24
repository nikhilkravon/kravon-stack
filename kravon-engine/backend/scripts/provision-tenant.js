'use strict';

/**
 * provision-tenant.js
 *
 * Creates a new restaurant + owner staff account via the admin API.
 * Use this for assisted onboarding — run it once per new tenant.
 *
 * Usage:
 *   node scripts/provision-tenant.js \
 *     --slug=spice-garden \
 *     --name="Spice Garden" \
 *     --plan=pro \
 *     --staff-name="Rahul Sharma" \
 *     --staff-email=rahul@spicegarden.in \
 *     --staff-password=changeme123 \
 *     [--wa-number=9876543210] \
 *     [--city=Mumbai] \
 *     [--tagline="Authentic North Indian Cuisine"] \
 *     [--api=http://localhost:3000]
 *
 * Plans:  starter | growth | pro | enterprise
 * Flags set by plan:
 *   starter    → has_presence
 *   growth     → has_presence + has_orders
 *   pro        → has_presence + has_orders + has_tables
 *   enterprise → all flags
 *
 * ADMIN_API_KEY must be set in .env or the environment.
 */

require('dotenv').config();

const https = require('https');
const http  = require('http');
const { URL } = require('url');

/* ── CLI args ──────────────────────────────────────────────────────────────── */
function arg(name) {
  const flag = `--${name}=`;
  const found = process.argv.find(a => a.startsWith(flag));
  return found ? found.slice(flag.length) : null;
}

const slug          = arg('slug');
const name          = arg('name');
const plan          = arg('plan')          || 'pro';
const staffName     = arg('staff-name');
const staffEmail    = arg('staff-email');
const staffPassword = arg('staff-password');
const waNumber      = arg('wa-number')     || null;
const city          = arg('city')          || null;
const tagline       = arg('tagline')       || null;
const apiBase       = (arg('api') || process.env.ADMIN_API_BASE || 'http://localhost:3000').replace(/\/$/, '');

if (!slug || !name || !staffEmail || !staffPassword || !staffName) {
  console.error(`
Usage: node scripts/provision-tenant.js \\
  --slug=<slug> \\
  --name="<Restaurant Name>" \\
  --staff-name="<Owner Name>" \\
  --staff-email=<email> \\
  --staff-password=<password> \\
  [--plan=pro] \\
  [--wa-number=9876543210] \\
  [--city=Mumbai] \\
  [--tagline="..."] \\
  [--api=http://localhost:3000]
`);
  process.exit(1);
}

const ADMIN_KEY = process.env.ADMIN_API_KEY;
if (!ADMIN_KEY) {
  console.error('ADMIN_API_KEY is not set. Add it to your .env file.');
  process.exit(1);
}

/* ── Plan → feature flags ─────────────────────────────────────────────────── */
const PLAN_FLAGS = {
  starter:    { has_presence: true,  has_orders: false, has_tables: false, has_catering: false, has_insights: false },
  growth:     { has_presence: true,  has_orders: true,  has_tables: false, has_catering: false, has_insights: false },
  pro:        { has_presence: true,  has_orders: true,  has_tables: true,  has_catering: true,  has_insights: false },
  enterprise: { has_presence: true,  has_orders: true,  has_tables: true,  has_catering: true,  has_insights: true  },
};

if (!PLAN_FLAGS[plan]) {
  console.error(`Invalid plan: ${plan}. Valid plans: starter, growth, pro, enterprise`);
  process.exit(1);
}

/* ── HTTP helper ──────────────────────────────────────────────────────────── */
function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const url       = new URL(apiBase + path);
    const transport = url.protocol === 'https:' ? https : http;
    const payload   = JSON.stringify(body);

    const options = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname + url.search,
      method,
      headers: {
        'Content-Type':       'application/json',
        'Content-Length':     Buffer.byteLength(payload),
        'x-kravon-admin-key': ADMIN_KEY,
      },
    };

    const req = transport.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/* ── Main ─────────────────────────────────────────────────────────────────── */
async function main() {
  const flags = PLAN_FLAGS[plan];

  console.log(`\nProvisioning tenant: ${slug} (${plan} plan)`);
  console.log(`API: ${apiBase}\n`);

  /* 1. Create restaurant */
  const restaurantBody = {
    slug,
    name,
    plan,
    ...flags,
    ...(tagline   && { tagline }),
    ...(city      && { city }),
    ...(waNumber  && { wa_number: waNumber }),
  };

  console.log('1. Creating restaurant…');
  const r1 = await apiRequest('POST', '/v1/admin/restaurants', restaurantBody);

  if (r1.status === 409) {
    console.error(`   ✗ Restaurant with slug "${slug}" already exists.`);
    process.exit(1);
  }
  if (r1.status !== 201) {
    console.error(`   ✗ Failed (${r1.status}):`, JSON.stringify(r1.body, null, 2));
    process.exit(1);
  }

  const restaurant = r1.body.restaurant;
  console.log(`   ✓ Restaurant created — tenant_id: ${restaurant.id || restaurant.tenant_id || '(see DB)'}`);

  /* 2. Create owner staff */
  console.log('2. Creating owner staff account…');
  const r2 = await apiRequest('POST', '/v1/admin/staff', {
    slug,
    name:     staffName,
    email:    staffEmail,
    password: staffPassword,
  });

  if (r2.status === 409) {
    console.error(`   ✗ Staff with email "${staffEmail}" already exists for this restaurant.`);
    process.exit(1);
  }
  if (r2.status !== 201) {
    console.error(`   ✗ Failed (${r2.status}):`, JSON.stringify(r2.body, null, 2));
    process.exit(1);
  }

  console.log(`   ✓ Staff account created — ${staffEmail}`);

  /* 3. Summary */
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Tenant provisioned: ${name}
  Slug:               ${slug}
  Plan:               ${plan}
  Features:           ${Object.entries(flags).filter(([, v]) => v).map(([k]) => k.replace('has_', '')).join(', ')}

  Dashboard:          (frontend URL)/dashboard/?slug=${slug}
  Config API:         ${apiBase}/v1/restaurants/${slug}/config

  Owner login:
    Email:    ${staffEmail}
    Password: ${staffPassword}

  Next steps:
    1. Log in to the dashboard and complete Personalisation (logo, hero, story)
    2. Add menu categories and items
    3. Configure settings (delivery fees, operating hours)
    ${flags.has_tables ? '4. Add tables (Tables view → + Add table)' : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

main().catch(err => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
