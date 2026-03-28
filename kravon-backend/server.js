require('dotenv').config();

const fastify = require('fastify')({ logger: true });
const PORT = process.env.PORT || 3000;

// ─── Plugins ─────────────────────────────────────────────────────────────────

// Security headers
fastify.register(require('@fastify/helmet'), {
  // Allow Google Fonts from the frontend
  contentSecurityPolicy: false,
});

// CORS — never wildcard in production; always set CORS_ORIGIN in .env
const corsOrigin = process.env.CORS_ORIGIN;
if (!corsOrigin && process.env.NODE_ENV === 'production') {
  console.error('[STARTUP] CORS_ORIGIN must be set in production. Refusing to start.');
  process.exit(1);
}
fastify.register(require('@fastify/cors'), {
  origin: corsOrigin || false,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});

// Rate limiting — global default
fastify.register(require('@fastify/rate-limit'), {
  max: 100,
  timeWindow: '1 minute',
  errorResponseBuilder: (_req, context) => ({
    statusCode: 429,
    error: 'Too Many Requests',
    message: `Rate limit exceeded. Retry after ${context.after}.`,
  }),
});

// Database — decorates fastify.db with the pg Pool
fastify.register(require('./src/plugins/db'));

// ─── Slug validation ─────────────────────────────────────────────────────────

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function validateSlug(slug) {
  return typeof slug === 'string' && slug.length >= 2 && slug.length <= 80 && SLUG_RE.test(slug);
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// Health check
fastify.get('/health', async (_request, _reply) => ({
  status: 'ok',
  timestamp: new Date(),
}));

// Presence API endpoint — fetches real data from DB
fastify.get('/api/presence/:slug', async (request, reply) => {
  const { slug } = request.params;

  if (!validateSlug(slug)) {
    return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid slug format.' });
  }

  const { db } = fastify;

  // 1. Restaurant (tenant)
  const { rows: [restaurant] } = await db.query(
    `SELECT id, slug, name, settings
       FROM tenant.restaurants
      WHERE slug = $1
        AND status = 'active'
        AND deleted_at IS NULL`,
    [slug]
  );

  if (!restaurant) {
    return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Restaurant not found.' });
  }

  const tenantId = restaurant.id;

  // 2. Parallel fetch of all supporting data
  const [
    themeResult,
    assetsResult,
    seoResult,
    contactLinksResult,
    announcementsResult,
    operatingHoursResult,
    reviewSummaryResult,
    menuResult,
  ] = await Promise.all([
    db.query(
      `SELECT primary_color, secondary_color, accent_color,
              font_heading, font_body, button_style, card_style
         FROM brand.themes
        WHERE tenant_id = $1 AND deleted_at IS NULL`,
      [tenantId]
    ),
    db.query(
      `SELECT type, url, alt_text
         FROM brand.assets
        WHERE tenant_id = $1 AND deleted_at IS NULL`,
      [tenantId]
    ),
    db.query(
      `SELECT meta_title, meta_description, og_title, og_description, og_image_url
         FROM brand.seo
        WHERE tenant_id = $1 AND deleted_at IS NULL`,
      [tenantId]
    ),
    db.query(
      `SELECT platform, url, display_label
         FROM brand.contact_links
        WHERE tenant_id = $1 AND deleted_at IS NULL
        ORDER BY position`,
      [tenantId]
    ),
    db.query(
      `SELECT title, body, cta_label, cta_url, starts_at, ends_at
         FROM brand.announcements
        WHERE tenant_id = $1
          AND is_active = TRUE
          AND deleted_at IS NULL
          AND (starts_at IS NULL OR starts_at <= NOW())
          AND (ends_at   IS NULL OR ends_at   >= NOW())
        ORDER BY starts_at DESC NULLS LAST`,
      [tenantId]
    ),
    db.query(
      `SELECT day_of_week,
              TO_CHAR(opens_at,  'HH24:MI') AS opens_at,
              TO_CHAR(closes_at, 'HH24:MI') AS closes_at,
              is_closed
         FROM tenant.operating_hours oh
         JOIN tenant.locations l ON l.id = oh.location_id
        WHERE oh.tenant_id = $1
          AND l.deleted_at IS NULL
        ORDER BY day_of_week`,
      [tenantId]
    ),
    db.query(
      `SELECT total_reviews, avg_rating, five_star, four_star, three_star, two_star, one_star
         FROM insights.review_summary
        WHERE tenant_id = $1`,
      [tenantId]
    ),
    db.query(
      `SELECT
           c.id   AS category_id,
           c.name AS category_name,
           c.description AS category_description,
           i.id, i.name, i.description, i.image_url,
           i.food_type, i.price, i.has_variants, i.is_available, i.tags,
           COALESCE(
             JSON_AGG(
               JSON_BUILD_OBJECT(
                 'id',    v.id,
                 'name',  v.name,
                 'price', v.price
               ) ORDER BY v.sort_order
             ) FILTER (WHERE v.id IS NOT NULL),
             '[]'
           ) AS variants
         FROM menu.menus m
         JOIN menu.categories c
           ON c.menu_id = m.id AND c.deleted_at IS NULL AND c.is_active = TRUE
         JOIN menu.menu_items i
           ON i.category_id = c.id AND i.deleted_at IS NULL
         LEFT JOIN menu.item_variants v
           ON v.menu_item_id = i.id AND v.deleted_at IS NULL AND v.is_available = TRUE
        WHERE m.tenant_id = $1
          AND m.deleted_at IS NULL
          AND m.is_active  = TRUE
        GROUP BY c.id, c.name, c.description, c.position,
                 i.id, i.name, i.description, i.image_url,
                 i.food_type, i.price, i.has_variants, i.is_available, i.tags, i.sort_order
        ORDER BY c.position, i.sort_order`,
      [tenantId]
    ),
  ]);

  // ─── Shape the response ─────────────────────────────────────────────────────

  const theme = themeResult.rows[0] || {};

  // Group assets by type
  const assetsByType = {};
  for (const a of assetsResult.rows) {
    assetsByType[a.type] = a;
  }

  const seo = seoResult.rows[0] || {};
  const reviews = reviewSummaryResult.rows[0] || null;

  // Group menu items by category
  const categoryMap = new Map();
  for (const row of menuResult.rows) {
    if (!categoryMap.has(row.category_id)) {
      categoryMap.set(row.category_id, {
        category: {
          id:          row.category_id,
          name:        row.category_name,
          description: row.category_description,
        },
        items: [],
      });
    }
    categoryMap.get(row.category_id).items.push({
      id:           row.id,
      name:         row.name,
      description:  row.description,
      image_url:    row.image_url,
      food_type:    row.food_type,
      price:        row.price !== null ? Number(row.price) : null,
      has_variants: row.has_variants,
      is_available: row.is_available,
      tags:         row.tags || [],
      variants:     row.variants,
    });
  }

  return {
    restaurant: {
      id:       restaurant.id,
      slug:     restaurant.slug,
      name:     restaurant.name,
      settings: restaurant.settings,
    },
    theme: {
      primary_color:   theme.primary_color   || null,
      secondary_color: theme.secondary_color || null,
      accent_color:    theme.accent_color    || null,
      font_heading:    theme.font_heading    || null,
      font_body:       theme.font_body       || null,
      button_style:    theme.button_style    || 'rounded',
      card_style:      theme.card_style      || 'elevated',
    },
    assets: {
      logo:     assetsByType['logo']   ? { url: assetsByType['logo'].url,   alt_text: assetsByType['logo'].alt_text }   : null,
      banner:   assetsByType['banner'] ? { url: assetsByType['banner'].url }                                             : null,
      og_image: assetsByType['logo']   ? { url: seo.og_image_url || assetsByType['banner']?.url || null }               : null,
    },
    seo: {
      meta_title:       seo.meta_title       || restaurant.name,
      meta_description: seo.meta_description || null,
      og_title:         seo.og_title         || seo.meta_title   || restaurant.name,
      og_description:   seo.og_description   || seo.meta_description || null,
    },
    contact_links:   contactLinksResult.rows,
    announcements:   announcementsResult.rows,
    operating_hours: operatingHoursResult.rows.map((r) => ({
      day_of_week: r.day_of_week,
      opens_at:    r.opens_at,
      closes_at:   r.closes_at,
      is_closed:   r.is_closed,
    })),
    reviews: reviews ? {
      total_reviews: reviews.total_reviews,
      avg_rating:    reviews.avg_rating !== null ? Number(reviews.avg_rating) : null,
      five_star:     reviews.five_star,
      four_star:     reviews.four_star,
      three_star:    reviews.three_star,
      two_star:      reviews.two_star,
      one_star:      reviews.one_star,
    } : null,
    menu: Array.from(categoryMap.values()),
  };
});

// ─── Start ───────────────────────────────────────────────────────────────────

const start = async () => {
  try {
    await fastify.listen({ port: Number(PORT), host: '0.0.0.0' });
    fastify.log.info(`Kravon backend listening on http://localhost:${PORT}`);
    fastify.log.info(`Health check -> http://localhost:${PORT}/health`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
