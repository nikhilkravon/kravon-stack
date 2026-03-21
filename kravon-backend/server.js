require('dotenv').config();

const fastify = require('fastify')({ logger: true });
const PORT = process.env.PORT || 3000;

// ─── Plugins ─────────────────────────────────────────────────────────────────

// CORS
fastify.register(require('@fastify/cors'), {
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});

// Database — decorates fastify.db with the pg Pool
fastify.register(require('./src/plugins/db'));

// ─── Routes ──────────────────────────────────────────────────────────────────

// Health check
fastify.get('/health', async (_request, _reply) => ({
  status: 'ok',
  timestamp: new Date(),
}));

// Presence API endpoint
fastify.get('/api/presence/:slug', async (request, reply) => {
  const { slug } = request.params;
  // Mock data - in production, fetch from database based on slug
  return {
    restaurant: {
      id: 1,
      slug: slug,
      name: 'Spice of India',
      settings: {
        currency: 'INR',
        timezone: 'Asia/Kolkata',
        loyalty_points_per_rupee: 1
      }
    },
    theme: {
      primary_color: '#c0392b',
      secondary_color: '#f5f0e8',
      accent_color: '#e67e22',
      font_heading: 'Playfair Display',
      font_body: 'Inter',
      button_style: 'rounded',
      card_style: 'elevated'
    },
    assets: {
      logo: {
        url: 'https://via.placeholder.com/200x80/ffffff/000000?text=Spice+of+India',
        alt_text: 'Spice of India Logo'
      },
      banner: {
        url: 'https://via.placeholder.com/1200x600/e67e22/ffffff?text=Restaurant+Banner'
      },
      og_image: {
        url: 'https://via.placeholder.com/1200x630/c0392b/ffffff?text=Spice+of+India'
      }
    },
    seo: {
      meta_title: 'Spice of India - Authentic Indian Cuisine',
      meta_description: 'Experience the finest Indian cuisine at Spice of India. Order online for delivery or dine-in.',
      og_title: 'Spice of India Restaurant',
      og_description: 'Authentic Indian food with modern twist'
    },
    contact_links: [
      { platform: 'whatsapp', url: 'https://wa.me/919876543210', display_label: 'Order on WhatsApp' },
      { platform: 'zomato', url: 'https://zomato.com/spice-of-india', display_label: 'Zomato' },
      { platform: 'google_maps', url: 'https://maps.google.com/?q=Spice+of+India', display_label: 'Find Us' }
    ],
    announcements: [
      {
        title: 'New Menu Items!',
        body: 'Try our new Biryani specials this week',
        cta_label: 'View Menu',
        cta_url: '#menu',
        starts_at: '2026-03-20T00:00:00Z',
        ends_at: '2026-03-27T23:59:59Z'
      }
    ],
    operating_hours: [
      { day_of_week: 0, opens_at: '11:00', closes_at: '23:00', is_closed: false },
      { day_of_week: 1, opens_at: '11:00', closes_at: '23:00', is_closed: false },
      { day_of_week: 2, opens_at: '11:00', closes_at: '23:00', is_closed: false },
      { day_of_week: 3, opens_at: '11:00', closes_at: '23:00', is_closed: false },
      { day_of_week: 4, opens_at: '11:00', closes_at: '23:00', is_closed: false },
      { day_of_week: 5, opens_at: '11:00', closes_at: '23:00', is_closed: false },
      { day_of_week: 6, opens_at: '11:00', closes_at: '23:00', is_closed: false }
    ],
    reviews: {
      total_reviews: 1250,
      avg_rating: 4.5,
      five_star: 850,
      four_star: 300,
      three_star: 80,
      two_star: 15,
      one_star: 5
    },
    menu: [
      {
        category: {
          id: 1,
          name: 'Appetizers',
          description: 'Start your meal with our delicious starters'
        },
        items: [
          {
            id: 1,
            name: 'Paneer Tikka',
            description: 'Marinated cottage cheese grilled to perfection',
            image_url: 'https://via.placeholder.com/300x200/8B4513/ffffff?text=Paneer+Tikka',
            food_type: 'veg',
            price: 280,
            has_variants: false,
            is_available: true,
            tags: ['spicy', 'grilled'],
            variants: []
          },
          {
            id: 2,
            name: 'Chicken 65',
            description: 'Spicy fried chicken bites with curry leaves',
            image_url: 'https://via.placeholder.com/300x200/DC143C/ffffff?text=Chicken+65',
            food_type: 'non_veg',
            price: 320,
            has_variants: false,
            is_available: true,
            tags: ['spicy', 'crispy'],
            variants: []
          }
        ]
      },
      {
        category: {
          id: 2,
          name: 'Main Course',
          description: 'Our signature dishes'
        },
        items: [
          {
            id: 3,
            name: 'Butter Chicken',
            description: 'Creamy tomato-based curry with tender chicken',
            image_url: 'https://via.placeholder.com/300x200/FF6347/ffffff?text=Butter+Chicken',
            food_type: 'non_veg',
            price: 450,
            has_variants: true,
            is_available: true,
            tags: ['creamy', 'popular'],
            variants: [
              { id: 1, name: 'Full Portion', price: 450 },
              { id: 2, name: 'Half Portion', price: 280 }
            ]
          },
          {
            id: 4,
            name: 'Paneer Butter Masala',
            description: 'Rich and creamy paneer curry',
            image_url: 'https://via.placeholder.com/300x200/FFD700/000000?text=Paneer+Butter+Masala',
            food_type: 'veg',
            price: 380,
            has_variants: false,
            is_available: true,
            tags: ['creamy', 'vegetarian'],
            variants: []
          }
        ]
      }
    ]
  };
});

// API v1 routes (uncomment as modules are built out)
// fastify.register(require('./src/routes/restaurants'), { prefix: '/api/v1/restaurants' });
// fastify.register(require('./src/routes/menus'),       { prefix: '/api/v1/menus' });
// fastify.register(require('./src/routes/orders'),      { prefix: '/api/v1/orders' });
// fastify.register(require('./src/routes/auth'),        { prefix: '/api/v1/auth' });

// ─── Start ───────────────────────────────────────────────────────────────────

const start = async () => {
  try {
    await fastify.listen({ port: Number(PORT), host: '0.0.0.0' });
    fastify.log.info(`🍽️  Kravon backend listening on http://localhost:${PORT}`);
    fastify.log.info(`   Health check → http://localhost:${PORT}/health`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
