-- ============================================================
-- kravon_seed_v12.sql
-- Dummy data for frontend development
-- Compatible with: kravon_schema_v12.sql (PostgreSQL 17)
--
-- What's seeded:
--   1. tenant        → 1 restaurant, 1 location, operating hours, domain
--   2. brand         → theme, logo asset, SEO, social links, announcement
--   3. tenant        → 2 staff (owner + manager), roles, tax rule (GST 5%)
--   4. menu          → 1 menu, 3 categories, 8 items (mix of simple + variant)
--   5. customer      → 1 customer, 1 address, loyalty account
--   6. dining        → 3 tables, 1 open session
--   7. orders        → 1 confirmed order with 2 line items, tax, payment
--   8. insights      → review_summary pre-populated
--
-- Run order follows schema dependency chain.
-- All UUIDs are fixed so you can reference them across files.
-- ============================================================

BEGIN;

-- ============================================================
-- FIXED UUIDs (reference freely in your frontend fixtures)
-- ============================================================

-- tenant
-- restaurant_id   : a1000000-0000-0000-0000-000000000001
-- location_id     : a2000000-0000-0000-0000-000000000001
-- staff_owner_id  : a3000000-0000-0000-0000-000000000001
-- staff_mgr_id    : a3000000-0000-0000-0000-000000000002
-- role_owner_id   : a4000000-0000-0000-0000-000000000001
-- role_mgr_id     : a4000000-0000-0000-0000-000000000002
-- tax_rule_id     : a5000000-0000-0000-0000-000000000001

-- brand
-- theme_id        : b1000000-0000-0000-0000-000000000001
-- logo_asset_id   : b2000000-0000-0000-0000-000000000001

-- menu
-- menu_id         : c1000000-0000-0000-0000-000000000001
-- cat_starters_id : c2000000-0000-0000-0000-000000000001
-- cat_mains_id    : c2000000-0000-0000-0000-000000000002
-- cat_drinks_id   : c2000000-0000-0000-0000-000000000003
-- item_paneer_id  : c3000000-0000-0000-0000-000000000001
-- item_wings_id   : c3000000-0000-0000-0000-000000000002
-- item_dal_id     : c3000000-0000-0000-0000-000000000003
-- item_biryani_id : c3000000-0000-0000-0000-000000000004 (has_variants)
-- item_burger_id  : c3000000-0000-0000-0000-000000000005
-- item_pasta_id   : c3000000-0000-0000-0000-000000000006
-- item_lassi_id   : c3000000-0000-0000-0000-000000000007
-- item_cola_id    : c3000000-0000-0000-0000-000000000008
-- var_biriyani_r  : c4000000-0000-0000-0000-000000000001  (Regular ₹280)
-- var_biriyani_l  : c4000000-0000-0000-0000-000000000002  (Large   ₹380)

-- customer
-- customer_id     : d1000000-0000-0000-0000-000000000001
-- address_id      : d2000000-0000-0000-0000-000000000001
-- loyalty_id      : d3000000-0000-0000-0000-000000000001

-- dining
-- table_t1_id     : e1000000-0000-0000-0000-000000000001
-- table_t2_id     : e1000000-0000-0000-0000-000000000002
-- table_t3_id     : e1000000-0000-0000-0000-000000000003
-- session_id      : e2000000-0000-0000-0000-000000000001

-- orders
-- order_id        : f1000000-0000-0000-0000-000000000001
-- order_item_1    : f2000000-0000-0000-0000-000000000001
-- order_item_2    : f2000000-0000-0000-0000-000000000002
-- payment_id      : f3000000-0000-0000-0000-000000000001


-- ============================================================
-- 1. TENANT
-- ============================================================

INSERT INTO tenant.restaurants (
    id, slug, name, plan, status,
    has_presence, has_orders, has_tables, has_catering, has_insights,
    settings
) VALUES (
    'a1000000-0000-0000-0000-000000000001',
    'spice-of-india',
    'Spice of India',
    'full',
    'active',
    TRUE, TRUE, TRUE, FALSE, TRUE,
    '{
        "currency": "INR",
        "timezone": "Asia/Kolkata",
        "order_token_prefix": "SOI",
        "loyalty_points_per_rupee": 1,
        "loyalty_redemption_rate": 0.25
    }'::jsonb
);

INSERT INTO tenant.locations (
    id, tenant_id, name, address, city, state, country, pincode,
    lat, lng, timezone, phone, is_active
) VALUES (
    'a2000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001',
    'Bandra West Flagship',
    '14, Hill Road, Bandra West',
    'Mumbai', 'Maharashtra', 'IN', '400050',
    19.059984, 72.836710,
    'Asia/Kolkata',
    '+912267891234',
    TRUE
);

-- Domain
INSERT INTO tenant.domains (
    id, tenant_id, domain, is_primary, verified_at
) VALUES (
    gen_random_uuid(),
    'a1000000-0000-0000-0000-000000000001',
    'spiceofindia.kravon.in',
    TRUE,
    NOW()
);

-- Operating hours (Mon–Fri 11:00–23:00, Sat–Sun 10:00–23:30)
INSERT INTO tenant.operating_hours (tenant_id, location_id, day_of_week, opens_at, closes_at)
VALUES
    ('a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 0, '10:00', '23:30'), -- Sun
    ('a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 1, '11:00', '23:00'), -- Mon
    ('a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 2, '11:00', '23:00'), -- Tue
    ('a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 3, '11:00', '23:00'), -- Wed
    ('a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 4, '11:00', '23:00'), -- Thu
    ('a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 5, '11:00', '23:30'), -- Fri
    ('a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 6, '10:00', '23:30'); -- Sat

-- Roles
INSERT INTO tenant.roles (id, tenant_id, name, display_name, is_system_role) VALUES
    ('a4000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'owner',   'Owner',   TRUE),
    ('a4000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'manager', 'Manager', TRUE),
    (gen_random_uuid(),                      'a1000000-0000-0000-0000-000000000001', 'cashier', 'Cashier', TRUE),
    (gen_random_uuid(),                      'a1000000-0000-0000-0000-000000000001', 'kitchen', 'Kitchen Staff', TRUE);

-- Staff
INSERT INTO tenant.staff (
    id, tenant_id, name, email, phone, auth_provider, is_active
) VALUES
    (
        'a3000000-0000-0000-0000-000000000001',
        'a1000000-0000-0000-0000-000000000001',
        'Rahul Sharma', 'rahul@spiceofindia.in', '+919820001001',
        'email', TRUE
    ),
    (
        'a3000000-0000-0000-0000-000000000002',
        'a1000000-0000-0000-0000-000000000001',
        'Priya Nair', 'priya@spiceofindia.in', '+919820001002',
        'email', TRUE
    );

INSERT INTO tenant.staff_roles (tenant_id, staff_id, role_id) VALUES
    ('a1000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000001'),
    ('a1000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000002', 'a4000000-0000-0000-0000-000000000002');

INSERT INTO tenant.staff_locations (tenant_id, staff_id, location_id, all_locations) VALUES
    ('a1000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', TRUE),
    ('a1000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', FALSE);

-- Tax rule — GST 5% (CGST 2.5% + SGST 2.5%), inclusive
INSERT INTO tenant.tax_rules (
    id, tenant_id, name, description,
    components, total_rate, is_inclusive, is_default, is_active
) VALUES (
    'a5000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001',
    'GST 5%',
    'Standard restaurant GST: CGST 2.5% + SGST 2.5%',
    '[{"name":"CGST","rate":2.5},{"name":"SGST","rate":2.5}]'::jsonb,
    5.00, TRUE, TRUE, TRUE
);

-- Subscription
INSERT INTO tenant.subscriptions (
    tenant_id, plan, status,
    trial_ends_at, current_period_start, current_period_end
) VALUES (
    'a1000000-0000-0000-0000-000000000001',
    'full', 'active',
    NULL,
    NOW() - INTERVAL '15 days',
    NOW() + INTERVAL '15 days'
);


-- ============================================================
-- 2. BRAND
-- ============================================================

INSERT INTO brand.themes (
    id, tenant_id,
    primary_color, secondary_color, accent_color,
    font_heading, font_body,
    button_style, card_style
) VALUES (
    'b1000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001',
    '#C0392B',   -- deep red
    '#F5F0E8',   -- warm cream
    '#E67E22',   -- amber
    'Playfair Display',
    'Inter',
    'rounded',
    'elevated'
);

INSERT INTO brand.assets (id, tenant_id, type, url, alt_text) VALUES
    (
        'b2000000-0000-0000-0000-000000000001',
        'a1000000-0000-0000-0000-000000000001',
        'logo',
        'https://cdn.kravon.in/demo/spiceofindia/logo.png',
        'Spice of India logo'
    ),
    (
        gen_random_uuid(),
        'a1000000-0000-0000-0000-000000000001',
        'banner',
        'https://cdn.kravon.in/demo/spiceofindia/banner.jpg',
        'Spice of India hero banner'
    ),
    (
        gen_random_uuid(),
        'a1000000-0000-0000-0000-000000000001',
        'og_image',
        'https://cdn.kravon.in/demo/spiceofindia/og.jpg',
        'Spice of India OG image'
    );

INSERT INTO brand.seo (tenant_id, meta_title, meta_description, og_title, og_description) VALUES (
    'a1000000-0000-0000-0000-000000000001',
    'Spice of India — Authentic Indian Cuisine, Bandra West',
    'Order online or book a table at Spice of India. Authentic North & South Indian food in Bandra West, Mumbai.',
    'Spice of India',
    'Mumbai''s favourite neighbourhood Indian restaurant. Fresh, bold, real.'
);

INSERT INTO brand.contact_links (tenant_id, platform, url, display_label, position) VALUES
    ('a1000000-0000-0000-0000-000000000001', 'instagram',   'https://instagram.com/spiceofindia_bandra', '@spiceofindia_bandra', 1),
    ('a1000000-0000-0000-0000-000000000001', 'zomato',      'https://zomato.com/spiceofindia',          'View on Zomato',       2),
    ('a1000000-0000-0000-0000-000000000001', 'google_maps', 'https://maps.google.com/?q=spiceofindia',  'Get Directions',       3),
    ('a1000000-0000-0000-0000-000000000001', 'whatsapp',    'https://wa.me/912267891234',               'Chat with Us',         4);

INSERT INTO brand.announcements (
    tenant_id, title, body, cta_label, cta_url,
    starts_at, ends_at, is_active
) VALUES (
    'a1000000-0000-0000-0000-000000000001',
    '🎉 Weekend Brunch Special',
    'Join us Saturday & Sunday 10am–1pm for our unlimited brunch buffet at ₹799 per head.',
    'Book a Table',
    '/tables',
    NOW() - INTERVAL '1 day',
    NOW() + INTERVAL '30 days',
    TRUE
);


-- ============================================================
-- 3. MENU
-- ============================================================

INSERT INTO menu.menus (id, tenant_id, location_id, name, menu_type, is_active) VALUES (
    'c1000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001',
    NULL,   -- applies to all locations
    'Main Menu',
    'main',
    TRUE
);

-- Categories
INSERT INTO menu.categories (id, tenant_id, menu_id, name, description, position) VALUES
    ('c2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'Starters',   'Small plates to get things going', 1),
    ('c2000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'Mains',      'Curries, rice, and the good stuff',  2),
    ('c2000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'Drinks',     'Fresh juices, lassi, and coolers',   3);

-- Menu Items
-- Starters (simple priced)
INSERT INTO menu.menu_items (
    id, tenant_id, category_id,
    name, description, image_url,
    food_type, price, has_variants,
    is_customizable, is_available, tags, sort_order
) VALUES
(
    'c3000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001',
    'c2000000-0000-0000-0000-000000000001',
    'Paneer Tikka',
    'Chunks of cottage cheese marinated in spiced yoghurt, grilled in tandoor.',
    'https://cdn.kravon.in/demo/spiceofindia/menu/paneer-tikka.jpg',
    'veg', 280.00, FALSE,
    FALSE, TRUE, ARRAY['tandoor','bestseller'], 1
),
(
    'c3000000-0000-0000-0000-000000000002',
    'a1000000-0000-0000-0000-000000000001',
    'c2000000-0000-0000-0000-000000000001',
    'Chicken Wings',
    'Crispy wings tossed in our house chilli garlic sauce. 6 pcs.',
    'https://cdn.kravon.in/demo/spiceofindia/menu/chicken-wings.jpg',
    'non_veg', 320.00, FALSE,
    FALSE, TRUE, ARRAY['crispy','spicy'], 2
),
-- Mains
(
    'c3000000-0000-0000-0000-000000000003',
    'a1000000-0000-0000-0000-000000000001',
    'c2000000-0000-0000-0000-000000000002',
    'Dal Makhani',
    'Slow-cooked black lentils in a rich buttery tomato gravy.',
    'https://cdn.kravon.in/demo/spiceofindia/menu/dal-makhani.jpg',
    'veg', 260.00, FALSE,
    FALSE, TRUE, ARRAY['comfort','bestseller'], 1
),
(
    -- Biryani has variants — price lives on variants, NULL here
    'c3000000-0000-0000-0000-000000000004',
    'a1000000-0000-0000-0000-000000000001',
    'c2000000-0000-0000-0000-000000000002',
    'Chicken Biryani',
    'Fragrant basmati rice layered with spiced chicken and slow-cooked dum style.',
    'https://cdn.kravon.in/demo/spiceofindia/menu/chicken-biryani.jpg',
    'non_veg', NULL, TRUE,
    FALSE, TRUE, ARRAY['dum','bestseller'], 2
),
(
    'c3000000-0000-0000-0000-000000000005',
    'a1000000-0000-0000-0000-000000000001',
    'c2000000-0000-0000-0000-000000000002',
    'Veggie Burger',
    'House-made potato-pea patty, chipotle mayo, pickled onions, brioche bun.',
    'https://cdn.kravon.in/demo/spiceofindia/menu/veggie-burger.jpg',
    'veg', 220.00, FALSE,
    FALSE, TRUE, ARRAY['fusion'], 3
),
(
    'c3000000-0000-0000-0000-000000000006',
    'a1000000-0000-0000-0000-000000000001',
    'c2000000-0000-0000-0000-000000000002',
    'Penne Arrabbiata',
    'Penne in a fiery tomato-chilli sauce with fresh basil.',
    'https://cdn.kravon.in/demo/spiceofindia/menu/pasta.jpg',
    'veg', 290.00, FALSE,
    FALSE, TRUE, ARRAY['italian','fusion'], 4
),
-- Drinks
(
    'c3000000-0000-0000-0000-000000000007',
    'a1000000-0000-0000-0000-000000000001',
    'c2000000-0000-0000-0000-000000000003',
    'Sweet Lassi',
    'Chilled blended yoghurt with sugar and a hint of cardamom.',
    'https://cdn.kravon.in/demo/spiceofindia/menu/lassi.jpg',
    'veg', 120.00, FALSE,
    FALSE, TRUE, ARRAY['cold','refreshing'], 1
),
(
    'c3000000-0000-0000-0000-000000000008',
    'a1000000-0000-0000-0000-000000000001',
    'c2000000-0000-0000-0000-000000000003',
    'Masala Cola',
    'Chilled cola with a dash of chaat masala, lemon and mint. Acquired taste, guaranteed.',
    'https://cdn.kravon.in/demo/spiceofindia/menu/masala-cola.jpg',
    'veg', 90.00, FALSE,
    FALSE, TRUE, ARRAY['cold','desi'], 2
);

-- Variants for Chicken Biryani
INSERT INTO menu.item_variants (
    id, tenant_id, menu_item_id, name, food_type, price, is_available, sort_order
) VALUES
(
    'c4000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001',
    'c3000000-0000-0000-0000-000000000004',
    'Regular (500g)', 'non_veg', 280.00, TRUE, 1
),
(
    'c4000000-0000-0000-0000-000000000002',
    'a1000000-0000-0000-0000-000000000001',
    'c3000000-0000-0000-0000-000000000004',
    'Large (750g)', 'non_veg', 380.00, TRUE, 2
);


-- ============================================================
-- 4. CUSTOMER
-- ============================================================

INSERT INTO customer.customers (
    id, tenant_id, name, phone, email,
    sms_consent, email_consent, whatsapp_consent,
    dietary_pref, tags
) VALUES (
    'd1000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001',
    'Aisha Kapoor',
    '+919820005001',
    'aisha.kapoor@example.com',
    TRUE, TRUE, TRUE,
    ARRAY['vegetarian'],
    ARRAY['vip','regular']
);

INSERT INTO customer.addresses (
    id, tenant_id, customer_id,
    label, address_line1, city, state, pincode,
    lat, lng, is_default
) VALUES (
    'd2000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001',
    'd1000000-0000-0000-0000-000000000001',
    'Home',
    'Flat 4B, Sea View Apartments, Carter Road',
    'Mumbai', 'Maharashtra', '400050',
    19.062, 72.831,
    TRUE
);

INSERT INTO customer.loyalty_accounts (
    id, tenant_id, customer_id,
    points_balance, tier, lifetime_spend, visit_count
) VALUES (
    'd3000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001',
    'd1000000-0000-0000-0000-000000000001',
    740,
    'silver',
    3420.00,
    9
);


-- ============================================================
-- 5. DINING — Tables & Session
-- ============================================================

INSERT INTO dining.tables (
    id, tenant_id, location_id, name, capacity, floor, status, qr_code
) VALUES
(
    'e1000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001',
    'a2000000-0000-0000-0000-000000000001',
    'T1', 2, 'Ground Floor', 'occupied',
    'https://cdn.kravon.in/qr/spiceofindia/t1.png'
),
(
    'e1000000-0000-0000-0000-000000000002',
    'a1000000-0000-0000-0000-000000000001',
    'a2000000-0000-0000-0000-000000000001',
    'T2', 4, 'Ground Floor', 'available',
    'https://cdn.kravon.in/qr/spiceofindia/t2.png'
),
(
    'e1000000-0000-0000-0000-000000000003',
    'a1000000-0000-0000-0000-000000000001',
    'a2000000-0000-0000-0000-000000000001',
    'T3', 6, 'First Floor',  'available',
    'https://cdn.kravon.in/qr/spiceofindia/t3.png'
);

-- Open session on T1
INSERT INTO dining.sessions (
    id, tenant_id, location_id, table_id,
    covers, opened_at
) VALUES (
    'e2000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001',
    'a2000000-0000-0000-0000-000000000001',
    'e1000000-0000-0000-0000-000000000001',
    2,
    NOW() - INTERVAL '30 minutes'
);


-- ============================================================
-- 6. ORDER + PAYMENT
-- ============================================================

-- Confirmed dine-in order on the open session
INSERT INTO orders.orders (
    id, tenant_id, location_id, customer_id, session_id,
    channel, fulfillment_type, status,
    subtotal_amount, tax_amount, discount_amount,
    tip_amount, packaging_charge, delivery_charge,
    total_amount, token_number
) VALUES (
    'f1000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001',
    'a2000000-0000-0000-0000-000000000001',
    'd1000000-0000-0000-0000-000000000001',
    'e2000000-0000-0000-0000-000000000001',
    'qr',
    'dine_in',
    'confirmed',
    560.00,   -- 280 + 280 (Paneer Tikka × 1 + Biryani Regular × 1)
    28.00,    -- 5% GST inclusive, shown separately here for illustrative split
    0.00,
    0.00,
    0.00,
    0.00,
    588.00,
    'SOI-0042'
);

-- Order line item 1: Paneer Tikka × 1
INSERT INTO orders.order_items (
    id, tenant_id, order_id,
    menu_item_id, variant_id,
    item_name, variant_name,
    unit_price, tax_rate, quantity,
    addons_total, total_price
) VALUES (
    'f2000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001',
    'f1000000-0000-0000-0000-000000000001',
    'c3000000-0000-0000-0000-000000000001',
    NULL,
    'Paneer Tikka', NULL,
    280.00, 5.00, 1,
    0.00,
    280.00   -- (280.00 * 1) + 0.00
);

-- Order line item 2: Chicken Biryani Regular × 1
INSERT INTO orders.order_items (
    id, tenant_id, order_id,
    menu_item_id, variant_id,
    item_name, variant_name,
    unit_price, tax_rate, quantity,
    addons_total, total_price
) VALUES (
    'f2000000-0000-0000-0000-000000000002',
    'a1000000-0000-0000-0000-000000000001',
    'f1000000-0000-0000-0000-000000000001',
    'c3000000-0000-0000-0000-000000000004',
    'c4000000-0000-0000-0000-000000000001',
    'Chicken Biryani', 'Regular (500g)',
    280.00, 5.00, 1,
    0.00,
    280.00
);

-- Tax breakdown
INSERT INTO orders.order_taxes (tenant_id, order_id, tax_name, rate, amount) VALUES
    ('a1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'CGST', 2.50, 14.00),
    ('a1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'SGST', 2.50, 14.00);

-- Order event
INSERT INTO orders.order_events (
    tenant_id, order_id, event_type,
    status_from, status_to, actor_type, actor_id
) VALUES (
    'a1000000-0000-0000-0000-000000000001',
    'f1000000-0000-0000-0000-000000000001',
    'order_confirmed',
    'pending', 'confirmed',
    'staff', 'a3000000-0000-0000-0000-000000000002'
);

-- Payment (UPI, captured)
INSERT INTO payments.payments (
    id, tenant_id, order_id,
    amount, method, gateway,
    transaction_ref, gateway_ref,
    status
) VALUES (
    'f3000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001',
    'f1000000-0000-0000-0000-000000000001',
    588.00,
    'upi',
    'razorpay',
    'upi-txn-20240321-001',
    'pay_RazDemo001',
    'captured'
);

-- Loyalty points earned for this order (1 pt per ₹)
INSERT INTO customer.loyalty_transactions (
    tenant_id, loyalty_id, order_id,
    txn_type, points, description
) VALUES (
    'a1000000-0000-0000-0000-000000000001',
    'd3000000-0000-0000-0000-000000000001',
    'f1000000-0000-0000-0000-000000000001',
    'earn',
    560,   -- on subtotal, not tax
    'Points earned on order SOI-0042'
);


-- ============================================================
-- 7. INSIGHTS — review summary pre-populated
-- ============================================================

INSERT INTO insights.review_summary (
    tenant_id, total_reviews, avg_rating,
    five_star, four_star, three_star, two_star, one_star
) VALUES (
    'a1000000-0000-0000-0000-000000000001',
    142, 4.3,
    68, 46, 18, 7, 3
);


COMMIT;

-- ============================================================
-- QUICK REFERENCE — what you can now render in the frontend
-- ============================================================
--
-- /presence   → brand.themes, brand.assets, brand.seo,
--               brand.contact_links, brand.announcements,
--               tenant.restaurants (name, settings)
--               tenant.operating_hours
--               insights.review_summary (rating widget)
--
-- /menu       → menu.menus → menu.categories → menu.menu_items
--               menu.item_variants (for Biryani)
--
-- /tables     → dining.tables (T1 occupied, T2/T3 available)
--               dining.sessions (open session on T1)
--
-- /orders     → orders.orders (SOI-0042, confirmed)
--               orders.order_items (2 line items)
--               orders.order_taxes (CGST + SGST)
--               payments.payments (UPI captured)
--
-- /customers  → customer.customers (Aisha Kapoor)
--               customer.loyalty_accounts (740 pts, Silver)
--               customer.addresses (Home, Carter Road)
-- ============================================================
