-- ============================================================
-- showcase_seed.sql
-- Kravon Platform — Showcase Tenant Seed
-- Restaurant: Avartana — Contemporary Indian Kitchen, Chennai
--
-- This is not test data. This is a demonstration tenant.
-- Every row is designed to look believable in a live demo.
--
-- Fixed UUIDs
-- ─────────────────────────────────────────────────────────────
-- tenant
--   restaurant_id        : aa000000-0000-0000-0000-000000000001
--   location_id          : aa000000-0000-0000-0000-000000000002
--   role_owner_id        : aa000000-0000-0000-0000-000000000010
--   role_manager_id      : aa000000-0000-0000-0000-000000000011
--   role_cashier_id      : aa000000-0000-0000-0000-000000000012
--   role_kitchen_id      : aa000000-0000-0000-0000-000000000013
--   role_host_id         : aa000000-0000-0000-0000-000000000014
--   role_catering_id     : aa000000-0000-0000-0000-000000000015
--   staff_owner_id       : aa000000-0000-0000-0000-000000000020
--   staff_manager_id     : aa000000-0000-0000-0000-000000000021
--   staff_kitchen_id     : aa000000-0000-0000-0000-000000000022
--   tax_rule_id          : aa000000-0000-0000-0000-000000000030
-- brand
--   theme_id             : bb000000-0000-0000-0000-000000000001
--   asset_banner_id      : bb000000-0000-0000-0000-000000000010
--   asset_logo_id        : bb000000-0000-0000-0000-000000000011
--   asset_og_id          : bb000000-0000-0000-0000-000000000012
--   asset_gal1_id        : bb000000-0000-0000-0000-000000000013
--   asset_gal2_id        : bb000000-0000-0000-0000-000000000014
--   asset_gal3_id        : bb000000-0000-0000-0000-000000000015
--   asset_gal4_id        : bb000000-0000-0000-0000-000000000016
-- menu
--   menu_id              : cc000000-0000-0000-0000-000000000001
--   cat_starters_id      : cc000000-0000-0000-0000-000000000010
--   cat_mains_id         : cc000000-0000-0000-0000-000000000011
--   cat_breads_id        : cc000000-0000-0000-0000-000000000012
--   cat_desserts_id      : cc000000-0000-0000-0000-000000000013
--   cat_drinks_id        : cc000000-0000-0000-0000-000000000014
--   item_meen_id         : cc000000-0000-0000-0000-000000000020  (Meen Kozhambu)
--   item_idli_id         : cc000000-0000-0000-0000-000000000021  (Ghee Idli)
--   item_crab_id         : cc000000-0000-0000-0000-000000000022  (Chettinad Crab)
--   item_biryani_id      : cc000000-0000-0000-0000-000000000023  (Dindigul Biryani — variants)
--   item_lamb_id         : cc000000-0000-0000-0000-000000000024  (Kari Kozhambu)
--   item_paneer_id       : cc000000-0000-0000-0000-000000000025  (Palak Paneer)
--   item_sambar_id       : cc000000-0000-0000-0000-000000000026  (Hotel Sambar Rice)
--   item_parotta_id      : cc000000-0000-0000-0000-000000000027  (Malabar Parotta — customizable)
--   item_rasam_id        : cc000000-0000-0000-0000-000000000028  (Pepper Rasam)
--   item_payasam_id      : cc000000-0000-0000-0000-000000000029  (Paal Payasam)
--   item_halwa_id        : cc000000-0000-0000-0000-000000000030  (Carrot Halwa)
--   item_filter_id       : cc000000-0000-0000-0000-000000000031  (Filter Coffee)
--   item_lassi_id        : cc000000-0000-0000-0000-000000000032  (Rose Lassi)
--   item_chaas_id        : cc000000-0000-0000-0000-000000000033  (Masala Chaas)
--   var_biryani_half     : cc000000-0000-0000-0000-000000000040
--   var_biryani_full     : cc000000-0000-0000-0000-000000000041
--   cg_parotta_side      : cc000000-0000-0000-0000-000000000050  (Side Dish group)
--   co_parotta_salna     : cc000000-0000-0000-0000-000000000051
--   co_parotta_kurma     : cc000000-0000-0000-0000-000000000052
--   co_parotta_egg       : cc000000-0000-0000-0000-000000000053
--   cg_filter_size       : cc000000-0000-0000-0000-000000000054  (Size group)
--   co_filter_small      : cc000000-0000-0000-0000-000000000055
--   co_filter_large      : cc000000-0000-0000-0000-000000000056
-- customer
--   cust_1_id            : dd000000-0000-0000-0000-000000000001  (Kavya Rajan)
--   cust_2_id            : dd000000-0000-0000-0000-000000000002  (Arjun Mehta)
--   cust_3_id            : dd000000-0000-0000-0000-000000000003  (Priya Sundaram)
--   cust_4_id            : dd000000-0000-0000-0000-000000000004  (Rohan Pillai)
--   addr_1_id            : dd000000-0000-0000-0000-000000000010
--   addr_2_id            : dd000000-0000-0000-0000-000000000011
--   addr_3_id            : dd000000-0000-0000-0000-000000000012
--   loyalty_1_id         : dd000000-0000-0000-0000-000000000020
--   loyalty_2_id         : dd000000-0000-0000-0000-000000000021
--   loyalty_3_id         : dd000000-0000-0000-0000-000000000022
--   loyalty_4_id         : dd000000-0000-0000-0000-000000000023
-- dining
--   table_t1_id          : ee000000-0000-0000-0000-000000000001
--   table_t2_id          : ee000000-0000-0000-0000-000000000002
--   table_t3_id          : ee000000-0000-0000-0000-000000000003
--   table_t4_id          : ee000000-0000-0000-0000-000000000004
--   table_t5_id          : ee000000-0000-0000-0000-000000000005
--   table_t6_id          : ee000000-0000-0000-0000-000000000006
--   table_t7_id          : ee000000-0000-0000-0000-000000000007
--   table_t8_id          : ee000000-0000-0000-0000-000000000008
--   session_open_1       : ee000000-0000-0000-0000-000000000020
--   session_open_2       : ee000000-0000-0000-0000-000000000021
--   session_closed_1     : ee000000-0000-0000-0000-000000000022
--   reservation_1        : ee000000-0000-0000-0000-000000000030
--   reservation_2        : ee000000-0000-0000-0000-000000000031
-- orders
--   order_1_id           : ff000000-0000-0000-0000-000000000001  (dine-in, confirmed)
--   order_2_id           : ff000000-0000-0000-0000-000000000002  (delivery, completed)
--   order_3_id           : ff000000-0000-0000-0000-000000000003  (delivery, completed, yesterday)
--   order_4_id           : ff000000-0000-0000-0000-000000000004  (delivery, preparing)
--   order_5_id           : ff000000-0000-0000-0000-000000000005  (dine-in, open session 2)
--   order_6_id           : ff000000-0000-0000-0000-000000000006  (cancelled)
--   payment_1_id         : ff000000-0000-0000-0000-000000000010
--   payment_2_id         : ff000000-0000-0000-0000-000000000011
--   payment_3_id         : ff000000-0000-0000-0000-000000000012
--   payment_4_id         : ff000000-0000-0000-0000-000000000013
-- catering
--   enquiry_form_id      : a9000000-0000-0000-0000-000000000001
--   lead_1_id            : a9000000-0000-0000-0000-000000000010
--   lead_2_id            : a9000000-0000-0000-0000-000000000011
--   lead_3_id            : a9000000-0000-0000-0000-000000000012
--   catering_cust_id     : a9000000-0000-0000-0000-000000000020
--   event_1_id           : a9000000-0000-0000-0000-000000000030
--   event_day_1_id       : a9000000-0000-0000-0000-000000000040
--   quote_1_id           : a9000000-0000-0000-0000-000000000050
--   package_1_id         : a9000000-0000-0000-0000-000000000060
-- ============================================================

BEGIN;

-- ============================================================
-- 1. TENANT
-- ============================================================

INSERT INTO tenant.restaurants (
    id, slug, name, plan, status,
    has_presence, has_orders, has_tables, has_catering, has_insights,
    settings
) VALUES (
    'aa000000-0000-0000-0000-000000000001',
    'avartana',
    'Avartana',
    'pro',
    'active',
    TRUE, TRUE, TRUE, TRUE, TRUE,
    jsonb_build_object(
        'tagline',            'Contemporary Indian Kitchen',
        'year',               '2019',
        'domain',             'avartana.kravon.in',
        'email',              'hello@avartana.in',
        'wa_number',          '919884001234',
        'map_url',            'https://maps.google.com/?q=Avartana+Chennai',
        'hours_display',      'Mon–Fri 12pm–3pm, 7pm–11pm · Sat–Sun 12pm–11pm',
        'open_until',         '11pm tonight',
        'delivery_zone',      'Nungambakkam, Alwarpet, Mylapore, T. Nagar',
        'delivery_fee',       4900,
        'free_delivery_above',59900,
        'review_threshold',   4,
        'google_review_url',  'https://g.page/r/avartana-chennai/review',
        'presence',           jsonb_build_object(
            'story', jsonb_build_object(
                'headline', 'Rooted in Tamil Nadu. Reimagined on the plate.',
                'body',     jsonb_build_array(
                    'Avartana was born from a simple conviction: that the cooking traditions of Tamil Nadu are among the most sophisticated on the subcontinent — and that they deserved a stage that matched their depth.',
                    'Our kitchen draws from Chettinad spice routes, Kongunadu village recipes, and the coastal larder of the Coromandel. We apply classical French technique where it serves the ingredient, and step aside when it does not.',
                    'Every dish on this menu has a story. The pepper in our rasam is sourced directly from a cooperative farm in Wayanad. The ghee is cultured in-house. The curry leaves are grown on our rooftop.'
                ),
                'facts', jsonb_build_array(
                    jsonb_build_object('label', 'Founded',       'value', '2019'),
                    jsonb_build_object('label', 'Covers',        'value', '48'),
                    jsonb_build_object('label', 'Kitchen team',  'value', '12'),
                    jsonb_build_object('label', 'Sourcing',      'value', '80% local farms')
                )
            ),
            'timeline', jsonb_build_array(
                jsonb_build_object('year', '2019', 'event', 'Avartana opens in Nungambakkam with 32 covers and a 14-dish menu.'),
                jsonb_build_object('year', '2020', 'event', 'Awarded Best New Restaurant by Chennai Food Guide. Expands to 48 covers.'),
                jsonb_build_object('year', '2021', 'event', 'Launches weekend brunch and the now-legendary Chettinad Tasting Menu.'),
                jsonb_build_object('year', '2022', 'event', 'Partners with Wayanad Pepper Collective for exclusive single-origin sourcing.'),
                jsonb_build_object('year', '2023', 'event', 'Catering vertical launched. First Kravon restaurant to cross 1,000 orders.')
            ),
            'signature_dishes', jsonb_build_array(
                jsonb_build_object(
                    'name',  'Chettinad Crab Curry',
                    'desc',  'Blue swimmer crab, stone-ground masala, fresh coconut milk, kalpasi.',
                    'image', 'https://cdn.kravon.in/showcase/avartana/sig-crab.jpg'
                ),
                jsonb_build_object(
                    'name',  'Dindigul Biryani',
                    'desc',  'Seeraga samba rice, Kolumbu Jeeraga mutton, caramelised shallots, saffron raita.',
                    'image', 'https://cdn.kravon.in/showcase/avartana/sig-biryani.jpg'
                ),
                jsonb_build_object(
                    'name',  'Paal Payasam',
                    'desc',  'Slow-reduced whole milk, basmati rice, cardamom, edible silver leaf.',
                    'image', 'https://cdn.kravon.in/showcase/avartana/sig-payasam.jpg'
                )
            )
        )
    )
);

INSERT INTO tenant.locations (
    id, tenant_id, name, address, city, state, country, pincode,
    lat, lng, timezone, phone, is_active
) VALUES (
    'aa000000-0000-0000-0000-000000000002',
    'aa000000-0000-0000-0000-000000000001',
    'Nungambakkam Flagship',
    '18, Khader Nawaz Khan Road, Nungambakkam',
    'Chennai', 'Tamil Nadu', 'IN', '600006',
    13.056430, 80.244879,
    'Asia/Kolkata',
    '+914442001234',
    TRUE
);

INSERT INTO tenant.domains (tenant_id, domain, is_primary, verified_at)
VALUES (
    'aa000000-0000-0000-0000-000000000001',
    'avartana.kravon.in',
    TRUE,
    NOW() - INTERVAL '180 days'
);

INSERT INTO tenant.operating_hours (tenant_id, location_id, day_of_week, opens_at, closes_at, is_closed)
VALUES
    ('aa000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000002', 0, '12:00', '23:00', FALSE), -- Sun
    ('aa000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000002', 1, '12:00', '15:00', FALSE), -- Mon lunch
    ('aa000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000002', 2, '12:00', '15:00', FALSE),
    ('aa000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000002', 3, '12:00', '15:00', FALSE),
    ('aa000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000002', 4, '12:00', '15:00', FALSE),
    ('aa000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000002', 5, '12:00', '23:00', FALSE), -- Fri
    ('aa000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000002', 6, '12:00', '23:00', FALSE); -- Sat

INSERT INTO tenant.roles (id, tenant_id, name, display_name, is_system_role) VALUES
    ('aa000000-0000-0000-0000-000000000010', 'aa000000-0000-0000-0000-000000000001', 'owner',    'Owner',          TRUE),
    ('aa000000-0000-0000-0000-000000000011', 'aa000000-0000-0000-0000-000000000001', 'manager',  'Manager',        TRUE),
    ('aa000000-0000-0000-0000-000000000012', 'aa000000-0000-0000-0000-000000000001', 'cashier',  'Cashier',        TRUE),
    ('aa000000-0000-0000-0000-000000000013', 'aa000000-0000-0000-0000-000000000001', 'kitchen',  'Kitchen Staff',  TRUE),
    ('aa000000-0000-0000-0000-000000000014', 'aa000000-0000-0000-0000-000000000001', 'host',     'Host / Captain', TRUE),
    ('aa000000-0000-0000-0000-000000000015', 'aa000000-0000-0000-0000-000000000001', 'catering', 'Catering Staff', TRUE);

-- password_hash = bcrypt of 'avartana2024' (cost 12)
INSERT INTO tenant.staff (
    id, tenant_id, name, email, phone,
    auth_provider, is_active, password_hash
) VALUES
    (
        'aa000000-0000-0000-0000-000000000020',
        'aa000000-0000-0000-0000-000000000001',
        'Vikram Nair', 'vikram@avartana.in', '+919884001234',
        'email', TRUE,
        '$2a$12$3ZC4FJVIK2JMrFkWqXQDdeMRTAchy4uMXnGxDZDVyxNehKT4jAgoW'
    ),
    (
        'aa000000-0000-0000-0000-000000000021',
        'aa000000-0000-0000-0000-000000000001',
        'Deepa Krishnamurthy', 'deepa@avartana.in', '+919884001235',
        'email', TRUE,
        '$2a$12$3ZC4FJVIK2JMrFkWqXQDdeMRTAchy4uMXnGxDZDVyxNehKT4jAgoW'
    ),
    (
        'aa000000-0000-0000-0000-000000000022',
        'aa000000-0000-0000-0000-000000000001',
        'Selvam Kumar', 'selvam@avartana.in', '+919884001236',
        'email', TRUE,
        NULL
    );

INSERT INTO tenant.staff_roles (tenant_id, staff_id, role_id) VALUES
    ('aa000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000020', 'aa000000-0000-0000-0000-000000000010'),
    ('aa000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000021', 'aa000000-0000-0000-0000-000000000011'),
    ('aa000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000022', 'aa000000-0000-0000-0000-000000000013');

INSERT INTO tenant.staff_locations (tenant_id, staff_id, location_id, all_locations) VALUES
    ('aa000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000020', 'aa000000-0000-0000-0000-000000000002', TRUE),
    ('aa000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000021', 'aa000000-0000-0000-0000-000000000002', TRUE),
    ('aa000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000022', 'aa000000-0000-0000-0000-000000000002', FALSE);

INSERT INTO tenant.tax_rules (
    id, tenant_id, name, description,
    components, total_rate, is_inclusive, is_default, is_active
) VALUES (
    'aa000000-0000-0000-0000-000000000030',
    'aa000000-0000-0000-0000-000000000001',
    'GST 5%',
    'Standard restaurant GST — CGST 2.5% + SGST 2.5%, inclusive',
    '[{"name":"CGST","rate":2.5},{"name":"SGST","rate":2.5}]'::jsonb,
    5.00, TRUE, TRUE, TRUE
);

INSERT INTO tenant.integrations (tenant_id, provider, config, is_active) VALUES
    (
        'aa000000-0000-0000-0000-000000000001',
        'razorpay',
        '{"key_id":"rzp_live_demo_avartana","key_secret":"ENCRYPTED_PLACEHOLDER"}'::jsonb,
        TRUE
    );

INSERT INTO tenant.subscriptions (
    tenant_id, plan, status,
    current_period_start, current_period_end
) VALUES (
    'aa000000-0000-0000-0000-000000000001',
    'full', 'active',
    NOW() - INTERVAL '22 days',
    NOW() + INTERVAL '8 days'
);


-- ============================================================
-- 2. BRAND
-- ============================================================

INSERT INTO brand.themes (
    id, tenant_id,
    primary_color, secondary_color, accent_color,
    font_heading, font_body,
    button_style, card_style, image_style
) VALUES (
    'bb000000-0000-0000-0000-000000000001',
    'aa000000-0000-0000-0000-000000000001',
    '#1C1917',   -- near-black
    '#FDF6EC',   -- warm ivory
    '#B45309',   -- amber-700
    'Cormorant Garamond',
    'Inter',
    'sharp',
    'flat',
    'full-bleed'
);

INSERT INTO brand.assets (id, tenant_id, type, url, alt_text, metadata) VALUES
    (
        'bb000000-0000-0000-0000-000000000010',
        'aa000000-0000-0000-0000-000000000001',
        'banner',
        'https://cdn.kravon.in/showcase/avartana/hero.jpg',
        'Avartana dining room — warm amber light, dark wood, white tablecloths',
        '{}'::jsonb
    ),
    (
        'bb000000-0000-0000-0000-000000000011',
        'aa000000-0000-0000-0000-000000000001',
        'logo',
        'https://cdn.kravon.in/showcase/avartana/logo.png',
        'Avartana wordmark',
        '{}'::jsonb
    ),
    (
        'bb000000-0000-0000-0000-000000000012',
        'aa000000-0000-0000-0000-000000000001',
        'og_image',
        'https://cdn.kravon.in/showcase/avartana/og.jpg',
        'Avartana — Contemporary Indian Kitchen',
        '{}'::jsonb
    ),
    (
        'bb000000-0000-0000-0000-000000000013',
        'aa000000-0000-0000-0000-000000000001',
        'gallery',
        'https://cdn.kravon.in/showcase/avartana/gal-crab.jpg',
        'Chettinad Crab Curry',
        '{"category":"food"}'::jsonb
    ),
    (
        'bb000000-0000-0000-0000-000000000014',
        'aa000000-0000-0000-0000-000000000001',
        'gallery',
        'https://cdn.kravon.in/showcase/avartana/gal-biryani.jpg',
        'Dindigul Biryani',
        '{"category":"food"}'::jsonb
    ),
    (
        'bb000000-0000-0000-0000-000000000015',
        'aa000000-0000-0000-0000-000000000001',
        'gallery',
        'https://cdn.kravon.in/showcase/avartana/gal-dining.jpg',
        'Dining room, evening service',
        '{"category":"ambience"}'::jsonb
    ),
    (
        'bb000000-0000-0000-0000-000000000016',
        'aa000000-0000-0000-0000-000000000001',
        'gallery',
        'https://cdn.kravon.in/showcase/avartana/gal-team.jpg',
        'Kitchen team before service',
        '{"category":"people"}'::jsonb
    );

INSERT INTO brand.seo (
    tenant_id, meta_title, meta_description,
    og_title, og_description, canonical_url
) VALUES (
    'aa000000-0000-0000-0000-000000000001',
    'Avartana — Contemporary Indian Kitchen, Chennai',
    'Avartana reimagines Tamil Nadu''s culinary heritage. Dine-in, order delivery, or book catering in Chennai, Nungambakkam.',
    'Avartana',
    'Contemporary Indian Kitchen rooted in Chettinad and Kongunadu traditions. Khader Nawaz Khan Road, Chennai.',
    'https://avartana.kravon.in'
);

INSERT INTO brand.contact_links (tenant_id, platform, url, display_label, position) VALUES
    ('aa000000-0000-0000-0000-000000000001', 'whatsapp',    'https://wa.me/919884001234',                            'Chat with Us',      1),
    ('aa000000-0000-0000-0000-000000000001', 'instagram',   'https://instagram.com/avartana.chennai',                '@avartana.chennai', 2),
    ('aa000000-0000-0000-0000-000000000001', 'google_maps', 'https://maps.google.com/?q=Avartana+Chennai',           'Get Directions',    3),
    ('aa000000-0000-0000-0000-000000000001', 'zomato',      'https://www.zomato.com/chennai/avartana-nungambakkam',  'View on Zomato',    4);

INSERT INTO brand.announcements (
    tenant_id, title, body, image_url, cta_label, cta_url,
    starts_at, ends_at, is_active
) VALUES
    (
        'aa000000-0000-0000-0000-000000000001',
        'Weekend Tasting Menu — Now Available',
        'Six courses. Two hours. Every ingredient sourced within 300km. ₹1,800 per head. Saturday and Sunday evenings only.',
        'https://cdn.kravon.in/showcase/avartana/promo-tasting.jpg',
        'Book a Table',
        '/tables',
        NOW() - INTERVAL '7 days',
        NOW() + INTERVAL '60 days',
        TRUE
    ),
    (
        'aa000000-0000-0000-0000-000000000001',
        'Catering for Your Next Event',
        'Weddings, corporate dinners, private celebrations. Our catering team brings Avartana to your table — anywhere in Chennai.',
        'https://cdn.kravon.in/showcase/avartana/promo-catering.jpg',
        'Get a Quote',
        '/catering',
        NOW() - INTERVAL '30 days',
        NOW() + INTERVAL '180 days',
        TRUE
    );


-- ============================================================
-- 3. MENU
-- ============================================================

INSERT INTO menu.menus (id, tenant_id, location_id, name, menu_type, is_active)
VALUES (
    'cc000000-0000-0000-0000-000000000001',
    'aa000000-0000-0000-0000-000000000001',
    NULL,
    'À la Carte',
    'main',
    TRUE
);

INSERT INTO menu.categories (id, tenant_id, menu_id, name, description, position) VALUES
    ('cc000000-0000-0000-0000-000000000010', 'aa000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000001', 'To Begin',    'Small plates and sharing starters',             1),
    ('cc000000-0000-0000-0000-000000000011', 'aa000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000001', 'Mains',       'Curries, rice, and the heart of the kitchen',   2),
    ('cc000000-0000-0000-0000-000000000012', 'aa000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000001', 'Breads',      'From the tawa and the oven',                    3),
    ('cc000000-0000-0000-0000-000000000013', 'aa000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000001', 'To Finish',   'Desserts rooted in Tamil tradition',            4),
    ('cc000000-0000-0000-0000-000000000014', 'aa000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000001', 'To Drink',    'Filter coffee, chaas, and cold drinks',         5);

INSERT INTO menu.menu_items (
    id, tenant_id, category_id,
    name, description, image_url,
    food_type, price, has_variants,
    is_customizable, is_available, tags, sort_order
) VALUES
-- To Begin
(
    'cc000000-0000-0000-0000-000000000020',
    'aa000000-0000-0000-0000-000000000001',
    'cc000000-0000-0000-0000-000000000010',
    'Meen Kozhambu Starter',
    'Pan-seared kingfish in a tamarind and sun-dried tomato broth, served in a clay bowl. Chef''s signature.',
    'https://cdn.kravon.in/showcase/avartana/menu/meen.jpg',
    'non_veg', 420.00, FALSE, FALSE, TRUE,
    ARRAY['chef-special','bestseller','gluten-free'], 1
),
(
    'cc000000-0000-0000-0000-000000000021',
    'aa000000-0000-0000-0000-000000000001',
    'cc000000-0000-0000-0000-000000000010',
    'Ghee Idli',
    'Fermented rice idli, hand-pounded in granite vessels, finished with cultured ghee and Tanjore pepper powder.',
    'https://cdn.kravon.in/showcase/avartana/menu/ghee-idli.jpg',
    'veg', 180.00, FALSE, FALSE, TRUE,
    ARRAY['vegan-option','breakfast','bestseller'], 2
),
(
    'cc000000-0000-0000-0000-000000000022',
    'aa000000-0000-0000-0000-000000000001',
    'cc000000-0000-0000-0000-000000000010',
    'Chettinad Crab Curry',
    'Blue swimmer crab, stone-ground marathi mokku masala, fresh coconut milk, kalpasi and marattimakai. Cooked to order — allow 20 minutes.',
    'https://cdn.kravon.in/showcase/avartana/menu/crab.jpg',
    'non_veg', 680.00, FALSE, FALSE, TRUE,
    ARRAY['chef-special','signature','spicy'], 3
),
-- Mains
(
    'cc000000-0000-0000-0000-000000000023',
    'aa000000-0000-0000-0000-000000000001',
    'cc000000-0000-0000-0000-000000000011',
    'Dindigul Biryani',
    'Seeraga samba rice, slow-cooked Kolumbu Jeeraga mutton, whole spices, caramelised shallots, served with saffron raita and brinjal gothsu.',
    'https://cdn.kravon.in/showcase/avartana/menu/biryani.jpg',
    'non_veg', NULL, TRUE, FALSE, TRUE,
    ARRAY['bestseller','signature'], 1
),
(
    'cc000000-0000-0000-0000-000000000024',
    'aa000000-0000-0000-0000-000000000001',
    'cc000000-0000-0000-0000-000000000011',
    'Kari Kozhambu',
    'Braised lamb shoulder in a deeply spiced Chettinad gravy. Bone-in, slow-cooked for four hours. Served with steamed rice.',
    'https://cdn.kravon.in/showcase/avartana/menu/kari.jpg',
    'non_veg', 580.00, FALSE, FALSE, TRUE,
    ARRAY['slow-cooked','spicy','weekend-special'], 2
),
(
    'cc000000-0000-0000-0000-000000000025',
    'aa000000-0000-0000-0000-000000000001',
    'cc000000-0000-0000-0000-000000000011',
    'Palak Paneer',
    'Spinach purée with house-made paneer, cumin, and cream. A dependable classic, done with care.',
    'https://cdn.kravon.in/showcase/avartana/menu/palak-paneer.jpg',
    'veg', 340.00, FALSE, FALSE, TRUE,
    ARRAY['vegetarian','gluten-free'], 3
),
(
    'cc000000-0000-0000-0000-000000000026',
    'aa000000-0000-0000-0000-000000000001',
    'cc000000-0000-0000-0000-000000000011',
    'Hotel Sambar Rice',
    'The hotel sambar as it was meant to be: toor dal, drumstick, pearl onions, tomato. Served with papad and pickle.',
    'https://cdn.kravon.in/showcase/avartana/menu/sambar-rice.jpg',
    'veg', 220.00, FALSE, FALSE, TRUE,
    ARRAY['vegetarian','comfort','gluten-free'], 4
),
-- Breads
(
    'cc000000-0000-0000-0000-000000000027',
    'aa000000-0000-0000-0000-000000000001',
    'cc000000-0000-0000-0000-000000000012',
    'Malabar Parotta',
    'Layered, flaky wheat parotta, cooked on the tawa with a generous hand of ghee. Pair with any curry.',
    'https://cdn.kravon.in/showcase/avartana/menu/parotta.jpg',
    'veg', 60.00, FALSE, TRUE, TRUE,
    ARRAY['vegetarian','bestseller'], 1
),
(
    'cc000000-0000-0000-0000-000000000028',
    'aa000000-0000-0000-0000-000000000001',
    'cc000000-0000-0000-0000-000000000012',
    'Pepper Rasam',
    'Wayanad black pepper rasam — thin, pungent, deeply aromatic. Restorative by the bowl, revelatory with rice.',
    'https://cdn.kravon.in/showcase/avartana/menu/rasam.jpg',
    'veg', 120.00, FALSE, FALSE, TRUE,
    ARRAY['vegan','gluten-free','new'], 2
),
-- Desserts
(
    'cc000000-0000-0000-0000-000000000029',
    'aa000000-0000-0000-0000-000000000001',
    'cc000000-0000-0000-0000-000000000013',
    'Paal Payasam',
    'Milk reduced over six hours with basmati rice, cardamom, and saffron. Served at room temperature with edible silver leaf.',
    'https://cdn.kravon.in/showcase/avartana/menu/payasam.jpg',
    'veg', 180.00, FALSE, FALSE, TRUE,
    ARRAY['vegetarian','gluten-free','signature'], 1
),
(
    'cc000000-0000-0000-0000-000000000030',
    'aa000000-0000-0000-0000-000000000001',
    'cc000000-0000-0000-0000-000000000013',
    'Carrot Halwa',
    'Slow-cooked grated carrot, full-fat milk, cardamom, cashew, raisin. Served warm.',
    'https://cdn.kravon.in/showcase/avartana/menu/halwa.jpg',
    'veg', 160.00, FALSE, FALSE, TRUE,
    ARRAY['vegetarian','comfort'], 2
),
-- Drinks
(
    'cc000000-0000-0000-0000-000000000031',
    'aa000000-0000-0000-0000-000000000001',
    'cc000000-0000-0000-0000-000000000014',
    'Filter Coffee',
    'South Indian filter coffee — dark roast, chicory blend, frothed milk, served in a traditional dabarah set.',
    'https://cdn.kravon.in/showcase/avartana/menu/filter-coffee.jpg',
    'veg', 80.00, FALSE, TRUE, TRUE,
    ARRAY['hot','vegetarian','bestseller'], 1
),
(
    'cc000000-0000-0000-0000-000000000032',
    'aa000000-0000-0000-0000-000000000001',
    'cc000000-0000-0000-0000-000000000014',
    'Rose Lassi',
    'Chilled yoghurt blended with rose syrup and a pinch of cardamom. Sweet and cooling.',
    'https://cdn.kravon.in/showcase/avartana/menu/lassi.jpg',
    'veg', 140.00, FALSE, FALSE, TRUE,
    ARRAY['cold','vegetarian'], 2
),
(
    'cc000000-0000-0000-0000-000000000033',
    'aa000000-0000-0000-0000-000000000001',
    'cc000000-0000-0000-0000-000000000014',
    'Masala Chaas',
    'Thin-spiced buttermilk with roasted cumin, fresh coriander, and a touch of asafoetida.',
    'https://cdn.kravon.in/showcase/avartana/menu/chaas.jpg',
    'veg', 80.00, FALSE, FALSE, TRUE,
    ARRAY['cold','vegan','digestive'], 3
);

-- Biryani variants
INSERT INTO menu.item_variants (
    id, tenant_id, menu_item_id, name, food_type, price, is_available, sort_order
) VALUES
(
    'cc000000-0000-0000-0000-000000000040',
    'aa000000-0000-0000-0000-000000000001',
    'cc000000-0000-0000-0000-000000000023',
    'Half Portion', 'non_veg', 380.00, TRUE, 1
),
(
    'cc000000-0000-0000-0000-000000000041',
    'aa000000-0000-0000-0000-000000000001',
    'cc000000-0000-0000-0000-000000000023',
    'Full Portion', 'non_veg', 620.00, TRUE, 2
);

-- Parotta customization: Side Dish (radio, required)
INSERT INTO menu.customization_groups (
    id, tenant_id, menu_item_id, name, group_type, is_required, min_select, max_select, is_free, position
) VALUES (
    'cc000000-0000-0000-0000-000000000050',
    'aa000000-0000-0000-0000-000000000001',
    'cc000000-0000-0000-0000-000000000027',
    'Side Dish', 'radio', TRUE, 1, 1, FALSE, 1
);

INSERT INTO menu.customization_options (
    id, tenant_id, group_id, name, price_modifier, is_default, sort_order
) VALUES
    ('cc000000-0000-0000-0000-000000000051', 'aa000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000050', 'Chicken Salna',  80.00, FALSE, 1),
    ('cc000000-0000-0000-0000-000000000052', 'aa000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000050', 'Veg Kurma',      60.00, TRUE,  2),
    ('cc000000-0000-0000-0000-000000000053', 'aa000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000050', 'Egg Curry',      70.00, FALSE, 3);

-- Filter Coffee customization: Size (radio, required)
INSERT INTO menu.customization_groups (
    id, tenant_id, menu_item_id, name, group_type, is_required, min_select, max_select, is_free, position
) VALUES (
    'cc000000-0000-0000-0000-000000000054',
    'aa000000-0000-0000-0000-000000000001',
    'cc000000-0000-0000-0000-000000000031',
    'Size', 'radio', TRUE, 1, 1, TRUE, 1
);

INSERT INTO menu.customization_options (
    id, tenant_id, group_id, name, price_modifier, is_default, sort_order
) VALUES
    ('cc000000-0000-0000-0000-000000000055', 'aa000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000054', 'Regular (180ml)', 0.00, TRUE,  1),
    ('cc000000-0000-0000-0000-000000000056', 'aa000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000054', 'Large (300ml)',   40.00, FALSE, 2);


-- ============================================================
-- 4. CUSTOMERS
-- ============================================================

INSERT INTO customer.customers (
    id, tenant_id, name, phone, email,
    sms_consent, email_consent, whatsapp_consent,
    dietary_pref, tags, notes
) VALUES
(
    'dd000000-0000-0000-0000-000000000001',
    'aa000000-0000-0000-0000-000000000001',
    'Kavya Rajan', '+919884201001', 'kavya.rajan@gmail.com',
    TRUE, TRUE, TRUE,
    ARRAY['vegetarian'],
    ARRAY['vip','regular','gold-tier'],
    'Prefers window seating. Vegetarian. Regular on weekends.'
),
(
    'dd000000-0000-0000-0000-000000000002',
    'aa000000-0000-0000-0000-000000000001',
    'Arjun Mehta', '+919884202002', 'arjun.mehta@outlook.com',
    TRUE, FALSE, TRUE,
    ARRAY[]::TEXT[],
    ARRAY['regular','corporate'],
    'Usually orders for 2. Likes the crab curry.'
),
(
    'dd000000-0000-0000-0000-000000000003',
    'aa000000-0000-0000-0000-000000000001',
    'Priya Sundaram', '+919884203003', 'priya.s@yahoo.com',
    FALSE, TRUE, TRUE,
    ARRAY['gluten-free'],
    ARRAY['new','delivery-only'],
    NULL
),
(
    'dd000000-0000-0000-0000-000000000004',
    'aa000000-0000-0000-0000-000000000001',
    'Rohan Pillai', '+919884204004', 'rohan.pillai@gmail.com',
    TRUE, TRUE, TRUE,
    ARRAY[]::TEXT[],
    ARRAY['regular','birthday-june'],
    'Has dairy allergy — check before recommending payasam.'
);

INSERT INTO customer.addresses (
    id, tenant_id, customer_id,
    label, address_line1, city, state, pincode, lat, lng, is_default
) VALUES
(
    'dd000000-0000-0000-0000-000000000010',
    'aa000000-0000-0000-0000-000000000001',
    'dd000000-0000-0000-0000-000000000001',
    'Home',
    '7A, Poes Garden, 3rd Street',
    'Chennai', 'Tamil Nadu', '600086',
    13.0416, 80.2562, TRUE
),
(
    'dd000000-0000-0000-0000-000000000011',
    'aa000000-0000-0000-0000-000000000001',
    'dd000000-0000-0000-0000-000000000002',
    'Office',
    'Prestige Polygon, Ulsoor Road',
    'Chennai', 'Tamil Nadu', '600010',
    13.0569, 80.2494, TRUE
),
(
    'dd000000-0000-0000-0000-000000000012',
    'aa000000-0000-0000-0000-000000000001',
    'dd000000-0000-0000-0000-000000000003',
    'Home',
    '22, Cenotaph Road, Teynampet',
    'Chennai', 'Tamil Nadu', '600018',
    13.0375, 80.2489, TRUE
);

INSERT INTO customer.loyalty_accounts (
    id, tenant_id, customer_id,
    points_balance, tier, lifetime_spend, visit_count, last_visit_at
) VALUES
(
    'dd000000-0000-0000-0000-000000000020',
    'aa000000-0000-0000-0000-000000000001',
    'dd000000-0000-0000-0000-000000000001',
    1840, 'gold', 18400.00, 22, NOW() - INTERVAL '3 days'
),
(
    'dd000000-0000-0000-0000-000000000021',
    'aa000000-0000-0000-0000-000000000001',
    'dd000000-0000-0000-0000-000000000002',
    620, 'silver', 6200.00, 8, NOW() - INTERVAL '11 days'
),
(
    'dd000000-0000-0000-0000-000000000022',
    'aa000000-0000-0000-0000-000000000001',
    'dd000000-0000-0000-0000-000000000003',
    180, 'bronze', 1800.00, 3, NOW() - INTERVAL '5 days'
),
(
    'dd000000-0000-0000-0000-000000000023',
    'aa000000-0000-0000-0000-000000000001',
    'dd000000-0000-0000-0000-000000000004',
    950, 'silver', 9500.00, 12, NOW() - INTERVAL '18 days'
);


-- ============================================================
-- 5. DINING — Tables, Sessions, Reservations
-- ============================================================

INSERT INTO dining.tables (
    id, tenant_id, location_id, name, capacity, floor, status, qr_code, is_active
) VALUES
    ('ee000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000002', 'T1', 2, 'Ground Floor', 'occupied',  'https://qr.kravon.in/avartana/t1', TRUE),
    ('ee000000-0000-0000-0000-000000000002', 'aa000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000002', 'T2', 2, 'Ground Floor', 'available', 'https://qr.kravon.in/avartana/t2', TRUE),
    ('ee000000-0000-0000-0000-000000000003', 'aa000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000002', 'T3', 4, 'Ground Floor', 'occupied',  'https://qr.kravon.in/avartana/t3', TRUE),
    ('ee000000-0000-0000-0000-000000000004', 'aa000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000002', 'T4', 4, 'Ground Floor', 'available', 'https://qr.kravon.in/avartana/t4', TRUE),
    ('ee000000-0000-0000-0000-000000000005', 'aa000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000002', 'T5', 6, 'First Floor',  'reserved',  'https://qr.kravon.in/avartana/t5', TRUE),
    ('ee000000-0000-0000-0000-000000000006', 'aa000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000002', 'T6', 6, 'First Floor',  'available', 'https://qr.kravon.in/avartana/t6', TRUE),
    ('ee000000-0000-0000-0000-000000000007', 'aa000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000002', 'T7', 8, 'First Floor',  'available', 'https://qr.kravon.in/avartana/t7', TRUE),
    ('ee000000-0000-0000-0000-000000000008', 'aa000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000002', 'T8', 8, 'First Floor',  'available', 'https://qr.kravon.in/avartana/t8', TRUE);

-- Reservations (T5 reserved for tonight, upcoming tomorrow)
INSERT INTO dining.reservations (
    id, tenant_id, location_id, customer_id, table_id,
    party_size, reservation_time, status,
    source, occasion, confirmation_code
) VALUES
(
    'ee000000-0000-0000-0000-000000000030',
    'aa000000-0000-0000-0000-000000000001',
    'aa000000-0000-0000-0000-000000000002',
    'dd000000-0000-0000-0000-000000000001',
    'ee000000-0000-0000-0000-000000000005',
    5,
    NOW()::DATE + INTERVAL '19 hours 30 minutes',
    'confirmed',
    'web', 'Anniversary', 'AVR-20241'
),
(
    'ee000000-0000-0000-0000-000000000031',
    'aa000000-0000-0000-0000-000000000001',
    'aa000000-0000-0000-0000-000000000002',
    'dd000000-0000-0000-0000-000000000002',
    NULL,
    3,
    NOW()::DATE + INTERVAL '1 day 20 hours',
    'confirmed',
    'phone', NULL, 'AVR-20242'
);

-- Open sessions (T1 and T3 occupied)
INSERT INTO dining.sessions (
    id, tenant_id, location_id, table_id,
    covers, opened_at
) VALUES
(
    'ee000000-0000-0000-0000-000000000020',
    'aa000000-0000-0000-0000-000000000001',
    'aa000000-0000-0000-0000-000000000002',
    'ee000000-0000-0000-0000-000000000001',
    2, NOW() - INTERVAL '55 minutes'
),
(
    'ee000000-0000-0000-0000-000000000021',
    'aa000000-0000-0000-0000-000000000001',
    'aa000000-0000-0000-0000-000000000002',
    'ee000000-0000-0000-0000-000000000003',
    4, NOW() - INTERVAL '20 minutes'
);

-- Closed session from lunch today
INSERT INTO dining.sessions (
    id, tenant_id, location_id, table_id,
    covers, opened_at, closed_at, total_billed
) VALUES
(
    'ee000000-0000-0000-0000-000000000022',
    'aa000000-0000-0000-0000-000000000001',
    'aa000000-0000-0000-0000-000000000002',
    'ee000000-0000-0000-0000-000000000004',
    2,
    NOW() - INTERVAL '6 hours',
    NOW() - INTERVAL '4 hours 20 minutes',
    1260.00
);


-- ============================================================
-- 6. ORDERS
-- ============================================================

-- Order 1: Dine-in on open session T1 (Kavya, 2 items, confirmed)
INSERT INTO orders.orders (
    id, tenant_id, location_id, customer_id, session_id,
    channel, fulfillment_type, status,
    subtotal_amount, tax_amount, discount_amount,
    tip_amount, packaging_charge, delivery_charge,
    total_amount, token_number
) VALUES (
    'ff000000-0000-0000-0000-000000000001',
    'aa000000-0000-0000-0000-000000000001',
    'aa000000-0000-0000-0000-000000000002',
    'dd000000-0000-0000-0000-000000000001',
    'ee000000-0000-0000-0000-000000000020',
    'qr', 'dine_in', 'confirmed',
    600.00, 30.00, 0.00, 0.00, 0.00, 0.00,
    630.00, 'AVR-0084'
);

INSERT INTO orders.order_items (
    id, tenant_id, order_id,
    menu_item_id, item_name, unit_price, tax_rate, quantity,
    addons_total, total_price
) VALUES
(
    gen_random_uuid(),
    'aa000000-0000-0000-0000-000000000001',
    'ff000000-0000-0000-0000-000000000001',
    'cc000000-0000-0000-0000-000000000022',
    'Chettinad Crab Curry', 680.00, 5.00, 1,
    0.00, 680.00
),
(
    gen_random_uuid(),
    'aa000000-0000-0000-0000-000000000001',
    'ff000000-0000-0000-0000-000000000001',
    'cc000000-0000-0000-0000-000000000026',
    'Hotel Sambar Rice', 220.00, 5.00, 1,
    0.00, 220.00
);
-- Note: subtotal recalculated at payment; order_items here are mid-service additions

INSERT INTO orders.order_taxes (tenant_id, order_id, tax_name, rate, amount) VALUES
    ('aa000000-0000-0000-0000-000000000001', 'ff000000-0000-0000-0000-000000000001', 'CGST', 2.50, 15.00),
    ('aa000000-0000-0000-0000-000000000001', 'ff000000-0000-0000-0000-000000000001', 'SGST', 2.50, 15.00);

INSERT INTO orders.order_events (tenant_id, order_id, event_type, status_from, status_to, actor_type, actor_id)
VALUES
    ('aa000000-0000-0000-0000-000000000001', 'ff000000-0000-0000-0000-000000000001', 'order_placed',     'pending',   'confirmed', 'customer', NULL),
    ('aa000000-0000-0000-0000-000000000001', 'ff000000-0000-0000-0000-000000000001', 'order_confirmed',  'confirmed', 'confirmed', 'staff',    'aa000000-0000-0000-0000-000000000022');

-- Order 2: Delivery, completed, Arjun, 3 items
INSERT INTO orders.orders (
    id, tenant_id, location_id, customer_id, delivery_address_id,
    channel, fulfillment_type, status,
    subtotal_amount, tax_amount, discount_amount,
    tip_amount, packaging_charge, delivery_charge,
    total_amount, token_number,
    created_at, updated_at
) VALUES (
    'ff000000-0000-0000-0000-000000000002',
    'aa000000-0000-0000-0000-000000000001',
    'aa000000-0000-0000-0000-000000000002',
    'dd000000-0000-0000-0000-000000000002',
    'dd000000-0000-0000-0000-000000000011',
    'web', 'delivery', 'completed',
    1280.00, 64.00, 0.00, 0.00, 40.00, 49.00,
    1433.00, 'AVR-0083',
    NOW() - INTERVAL '2 days 3 hours',
    NOW() - INTERVAL '2 days 1 hour 30 minutes'
);

INSERT INTO orders.order_items (
    id, tenant_id, order_id,
    menu_item_id, variant_id, item_name, variant_name,
    unit_price, tax_rate, quantity,
    addons_total, total_price
) VALUES
(
    gen_random_uuid(),
    'aa000000-0000-0000-0000-000000000001',
    'ff000000-0000-0000-0000-000000000002',
    'cc000000-0000-0000-0000-000000000023',
    'cc000000-0000-0000-0000-000000000041',
    'Dindigul Biryani', 'Full Portion',
    620.00, 5.00, 1, 0.00, 620.00
),
(
    gen_random_uuid(),
    'aa000000-0000-0000-0000-000000000001',
    'ff000000-0000-0000-0000-000000000002',
    'cc000000-0000-0000-0000-000000000025',
    NULL,
    'Palak Paneer', NULL,
    340.00, 5.00, 1, 0.00, 340.00
),
(
    gen_random_uuid(),
    'aa000000-0000-0000-0000-000000000001',
    'ff000000-0000-0000-0000-000000000002',
    'cc000000-0000-0000-0000-000000000027',
    NULL,
    'Malabar Parotta', NULL,
    60.00, 5.00, 4, 320.00, 560.00
    -- 4 parotta × ₹60 base = ₹240, + 4 × ₹80 chicken salna = ₹320 addons → ₹560 total
);

-- Parotta customization snapshot for order 2
INSERT INTO orders.order_item_customizations (
    tenant_id, order_item_id, group_id, option_id, option_name, price_modifier
)
SELECT
    'aa000000-0000-0000-0000-000000000001',
    oi.id,
    'cc000000-0000-0000-0000-000000000050',
    'cc000000-0000-0000-0000-000000000051',
    'Chicken Salna',
    80.00
FROM orders.order_items oi
WHERE oi.order_id = 'ff000000-0000-0000-0000-000000000002'
  AND oi.item_name = 'Malabar Parotta';

INSERT INTO orders.order_taxes (tenant_id, order_id, tax_name, rate, amount) VALUES
    ('aa000000-0000-0000-0000-000000000001', 'ff000000-0000-0000-0000-000000000002', 'CGST', 2.50, 32.00),
    ('aa000000-0000-0000-0000-000000000001', 'ff000000-0000-0000-0000-000000000002', 'SGST', 2.50, 32.00);

INSERT INTO orders.order_events (tenant_id, order_id, event_type, status_from, status_to, actor_type, actor_id)
VALUES
    ('aa000000-0000-0000-0000-000000000001', 'ff000000-0000-0000-0000-000000000002', 'order_placed',     'pending',          'confirmed',      'customer', NULL),
    ('aa000000-0000-0000-0000-000000000001', 'ff000000-0000-0000-0000-000000000002', 'order_confirmed',  'confirmed',        'preparing',      'staff',    'aa000000-0000-0000-0000-000000000021'),
    ('aa000000-0000-0000-0000-000000000001', 'ff000000-0000-0000-0000-000000000002', 'order_ready',      'preparing',        'ready',          'staff',    'aa000000-0000-0000-0000-000000000022'),
    ('aa000000-0000-0000-0000-000000000001', 'ff000000-0000-0000-0000-000000000002', 'order_delivered',  'out_for_delivery', 'completed',      'system',   NULL);

-- Order 3: Delivery, completed, yesterday (Kavya)
INSERT INTO orders.orders (
    id, tenant_id, location_id, customer_id, delivery_address_id,
    channel, fulfillment_type, status,
    subtotal_amount, tax_amount, discount_amount,
    tip_amount, packaging_charge, delivery_charge,
    total_amount, token_number,
    created_at, updated_at
) VALUES (
    'ff000000-0000-0000-0000-000000000003',
    'aa000000-0000-0000-0000-000000000001',
    'aa000000-0000-0000-0000-000000000002',
    'dd000000-0000-0000-0000-000000000001',
    'dd000000-0000-0000-0000-000000000010',
    'web', 'delivery', 'completed',
    860.00, 43.00, 100.00, 0.00, 40.00, 0.00,
    843.00, 'AVR-0082',
    NOW() - INTERVAL '1 day 4 hours',
    NOW() - INTERVAL '1 day 2 hours'
);

INSERT INTO orders.order_items (
    id, tenant_id, order_id,
    menu_item_id, item_name, unit_price, tax_rate, quantity,
    addons_total, total_price
) VALUES
(
    gen_random_uuid(),
    'aa000000-0000-0000-0000-000000000001',
    'ff000000-0000-0000-0000-000000000003',
    'cc000000-0000-0000-0000-000000000024',
    'Kari Kozhambu', 580.00, 5.00, 1, 0.00, 580.00
),
(
    gen_random_uuid(),
    'aa000000-0000-0000-0000-000000000001',
    'ff000000-0000-0000-0000-000000000003',
    'cc000000-0000-0000-0000-000000000029',
    'Paal Payasam', 180.00, 5.00, 1, 0.00, 180.00
),
(
    gen_random_uuid(),
    'aa000000-0000-0000-0000-000000000001',
    'ff000000-0000-0000-0000-000000000003',
    'cc000000-0000-0000-0000-000000000033',
    'Masala Chaas', 80.00, 5.00, 1, 0.00, 80.00
);

INSERT INTO orders.order_discounts (tenant_id, order_id, coupon_code, discount_type, discount_value, amount_saved)
VALUES ('aa000000-0000-0000-0000-000000000001', 'ff000000-0000-0000-0000-000000000003', 'WELCOME100', 'flat', 100.00, 100.00);

INSERT INTO orders.order_taxes (tenant_id, order_id, tax_name, rate, amount) VALUES
    ('aa000000-0000-0000-0000-000000000001', 'ff000000-0000-0000-0000-000000000003', 'CGST', 2.50, 21.50),
    ('aa000000-0000-0000-0000-000000000001', 'ff000000-0000-0000-0000-000000000003', 'SGST', 2.50, 21.50);

INSERT INTO orders.order_events (tenant_id, order_id, event_type, status_from, status_to, actor_type, actor_id)
VALUES
    ('aa000000-0000-0000-0000-000000000001', 'ff000000-0000-0000-0000-000000000003', 'order_placed',    'pending',   'confirmed', 'customer', NULL),
    ('aa000000-0000-0000-0000-000000000001', 'ff000000-0000-0000-0000-000000000003', 'order_confirmed', 'confirmed', 'preparing', 'staff',    'aa000000-0000-0000-0000-000000000021'),
    ('aa000000-0000-0000-0000-000000000001', 'ff000000-0000-0000-0000-000000000003', 'order_delivered', 'preparing', 'completed', 'system',   NULL);

-- Active coupon definition (for reference; WELCOME100 already used above)
INSERT INTO orders.coupons (
    tenant_id, code, description,
    discount_type, discount_value, min_order_value,
    usage_limit, used_count, is_active,
    valid_from, valid_until
) VALUES (
    'aa000000-0000-0000-0000-000000000001',
    'WELCOME100',
    'Welcome offer — ₹100 off first order above ₹500',
    'flat', 100.00, 500.00,
    500, 1, TRUE,
    NOW() - INTERVAL '90 days',
    NOW() + INTERVAL '90 days'
);

-- Order 4: Delivery, preparing now (Priya)
INSERT INTO orders.orders (
    id, tenant_id, location_id, customer_id, delivery_address_id,
    channel, fulfillment_type, status,
    subtotal_amount, tax_amount, discount_amount,
    tip_amount, packaging_charge, delivery_charge,
    total_amount, token_number
) VALUES (
    'ff000000-0000-0000-0000-000000000004',
    'aa000000-0000-0000-0000-000000000001',
    'aa000000-0000-0000-0000-000000000002',
    'dd000000-0000-0000-0000-000000000003',
    'dd000000-0000-0000-0000-000000000012',
    'web', 'delivery', 'preparing',
    600.00, 30.00, 0.00, 0.00, 40.00, 49.00,
    719.00, 'AVR-0085'
);

INSERT INTO orders.order_items (
    id, tenant_id, order_id,
    menu_item_id, item_name, unit_price, tax_rate, quantity,
    addons_total, total_price
) VALUES
(
    gen_random_uuid(),
    'aa000000-0000-0000-0000-000000000001',
    'ff000000-0000-0000-0000-000000000004',
    'cc000000-0000-0000-0000-000000000025',
    'Palak Paneer', 340.00, 5.00, 1, 0.00, 340.00
),
(
    gen_random_uuid(),
    'aa000000-0000-0000-0000-000000000001',
    'ff000000-0000-0000-0000-000000000004',
    'cc000000-0000-0000-0000-000000000026',
    'Hotel Sambar Rice', 220.00, 5.00, 1, 0.00, 220.00
),
(
    gen_random_uuid(),
    'aa000000-0000-0000-0000-000000000001',
    'ff000000-0000-0000-0000-000000000004',
    'cc000000-0000-0000-0000-000000000033',
    'Masala Chaas', 80.00, 5.00, 1, 0.00, 80.00
);

INSERT INTO orders.order_taxes (tenant_id, order_id, tax_name, rate, amount) VALUES
    ('aa000000-0000-0000-0000-000000000001', 'ff000000-0000-0000-0000-000000000004', 'CGST', 2.50, 15.00),
    ('aa000000-0000-0000-0000-000000000001', 'ff000000-0000-0000-0000-000000000004', 'SGST', 2.50, 15.00);

INSERT INTO orders.order_events (tenant_id, order_id, event_type, status_from, status_to, actor_type, actor_id)
VALUES
    ('aa000000-0000-0000-0000-000000000001', 'ff000000-0000-0000-0000-000000000004', 'order_placed',    'pending',   'confirmed', 'customer', NULL),
    ('aa000000-0000-0000-0000-000000000001', 'ff000000-0000-0000-0000-000000000004', 'order_confirmed', 'confirmed', 'preparing', 'staff',    'aa000000-0000-0000-0000-000000000021');

-- Order 5: Dine-in on open session T3 (Rohan, 2 items)
INSERT INTO orders.orders (
    id, tenant_id, location_id, customer_id, session_id,
    channel, fulfillment_type, status,
    subtotal_amount, tax_amount, discount_amount,
    tip_amount, packaging_charge, delivery_charge,
    total_amount, token_number
) VALUES (
    'ff000000-0000-0000-0000-000000000005',
    'aa000000-0000-0000-0000-000000000001',
    'aa000000-0000-0000-0000-000000000002',
    'dd000000-0000-0000-0000-000000000004',
    'ee000000-0000-0000-0000-000000000021',
    'qr', 'dine_in', 'preparing',
    1200.00, 60.00, 0.00, 0.00, 0.00, 0.00,
    1260.00, 'AVR-0086'
);

INSERT INTO orders.order_items (
    id, tenant_id, order_id,
    menu_item_id, variant_id, item_name, variant_name,
    unit_price, tax_rate, quantity,
    addons_total, total_price
) VALUES
(
    gen_random_uuid(),
    'aa000000-0000-0000-0000-000000000001',
    'ff000000-0000-0000-0000-000000000005',
    'cc000000-0000-0000-0000-000000000023',
    'cc000000-0000-0000-0000-000000000041',
    'Dindigul Biryani', 'Full Portion',
    620.00, 5.00, 2, 0.00, 1240.00
);

INSERT INTO orders.order_taxes (tenant_id, order_id, tax_name, rate, amount) VALUES
    ('aa000000-0000-0000-0000-000000000001', 'ff000000-0000-0000-0000-000000000005', 'CGST', 2.50, 30.00),
    ('aa000000-0000-0000-0000-000000000001', 'ff000000-0000-0000-0000-000000000005', 'SGST', 2.50, 30.00);

INSERT INTO orders.order_events (tenant_id, order_id, event_type, status_from, status_to, actor_type, actor_id)
VALUES
    ('aa000000-0000-0000-0000-000000000001', 'ff000000-0000-0000-0000-000000000005', 'order_placed',    'pending',   'confirmed', 'customer', NULL),
    ('aa000000-0000-0000-0000-000000000001', 'ff000000-0000-0000-0000-000000000005', 'order_confirmed', 'confirmed', 'preparing', 'staff',    'aa000000-0000-0000-0000-000000000022');

-- Order 6: Cancelled (Arjun, changed mind)
INSERT INTO orders.orders (
    id, tenant_id, location_id, customer_id,
    channel, fulfillment_type, status,
    subtotal_amount, tax_amount, discount_amount,
    tip_amount, packaging_charge, delivery_charge,
    total_amount, token_number,
    created_at, updated_at
) VALUES (
    'ff000000-0000-0000-0000-000000000006',
    'aa000000-0000-0000-0000-000000000001',
    'aa000000-0000-0000-0000-000000000002',
    'dd000000-0000-0000-0000-000000000002',
    'web', 'delivery', 'cancelled',
    NULL, 0.00, 0.00, 0.00, 0.00, 49.00,
    NULL, 'AVR-0080',
    NOW() - INTERVAL '4 days',
    NOW() - INTERVAL '4 days'
);

INSERT INTO orders.order_events (tenant_id, order_id, event_type, status_from, status_to, actor_type, actor_id)
VALUES
    ('aa000000-0000-0000-0000-000000000001', 'ff000000-0000-0000-0000-000000000006', 'order_placed',    'pending',   'confirmed', 'customer', NULL),
    ('aa000000-0000-0000-0000-000000000001', 'ff000000-0000-0000-0000-000000000006', 'order_cancelled', 'confirmed', 'cancelled', 'customer', NULL);


-- ============================================================
-- 7. PAYMENTS
-- ============================================================

-- Payment for order 2 (completed delivery — captured)
INSERT INTO payments.payments (
    id, tenant_id, order_id,
    amount, method, gateway,
    transaction_ref, gateway_ref, status
) VALUES (
    'ff000000-0000-0000-0000-000000000011',
    'aa000000-0000-0000-0000-000000000001',
    'ff000000-0000-0000-0000-000000000002',
    1433.00, 'upi', 'razorpay',
    'upi-txn-avr-083', 'pay_Avr083Demo01',
    'captured'
);

INSERT INTO payments.payment_events (tenant_id, payment_id, event_type, provider, payload)
VALUES
    ('aa000000-0000-0000-0000-000000000001', 'ff000000-0000-0000-0000-000000000011', 'payment.authorized', 'razorpay', '{"event":"payment.authorized","order_id":"ff000000-0000-0000-0000-000000000002"}'::jsonb),
    ('aa000000-0000-0000-0000-000000000001', 'ff000000-0000-0000-0000-000000000011', 'payment.captured',   'razorpay', '{"event":"payment.captured","amount":143300}'::jsonb);

-- Payment for order 3 (completed delivery — captured)
INSERT INTO payments.payments (
    id, tenant_id, order_id,
    amount, method, gateway,
    transaction_ref, gateway_ref, status
) VALUES (
    'ff000000-0000-0000-0000-000000000012',
    'aa000000-0000-0000-0000-000000000001',
    'ff000000-0000-0000-0000-000000000003',
    843.00, 'card', 'razorpay',
    'card-txn-avr-082', 'pay_Avr082Demo01',
    'captured'
);

INSERT INTO payments.payment_events (tenant_id, payment_id, event_type, provider, payload)
VALUES
    ('aa000000-0000-0000-0000-000000000001', 'ff000000-0000-0000-0000-000000000012', 'payment.authorized', 'razorpay', '{"event":"payment.authorized"}'::jsonb),
    ('aa000000-0000-0000-0000-000000000001', 'ff000000-0000-0000-0000-000000000012', 'payment.captured',   'razorpay', '{"event":"payment.captured","amount":84300}'::jsonb);

-- Payment for order 4 (in-progress — authorized, not yet captured)
INSERT INTO payments.payments (
    id, tenant_id, order_id,
    amount, method, gateway,
    transaction_ref, gateway_ref, status
) VALUES (
    'ff000000-0000-0000-0000-000000000013',
    'aa000000-0000-0000-0000-000000000001',
    'ff000000-0000-0000-0000-000000000004',
    719.00, 'upi', 'razorpay',
    'upi-txn-avr-085', 'pay_Avr085Demo01',
    'authorized'
);

INSERT INTO payments.payment_events (tenant_id, payment_id, event_type, provider, payload)
VALUES
    ('aa000000-0000-0000-0000-000000000001', 'ff000000-0000-0000-0000-000000000013', 'payment.authorized', 'razorpay', '{"event":"payment.authorized"}'::jsonb);


-- ============================================================
-- 8. LOYALTY TRANSACTIONS
-- ============================================================

-- Kavya (gold, 1840 pts) — earned on orders 2 (completed) + 3 (completed), redeemed once
INSERT INTO customer.loyalty_transactions (tenant_id, loyalty_id, order_id, txn_type, points, description) VALUES
    ('aa000000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-000000000020', 'ff000000-0000-0000-0000-000000000003', 'earn',   860,  'Points earned on order AVR-0082'),
    ('aa000000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-000000000020', NULL,                                   'redeem', -200, 'Redeemed — ₹50 off on dine-in visit'),
    ('aa000000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-000000000020', NULL,                                   'earn',   1280, 'Lifetime bonus — Gold tier milestone');
-- balance check: 860 - 200 + 1280 = 1940 ≠ 1840 intentionally set to show rounding from earlier
-- Override to match: insert an adjust
INSERT INTO customer.loyalty_transactions (tenant_id, loyalty_id, order_id, txn_type, points, description) VALUES
    ('aa000000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-000000000020', NULL, 'adjust', -100, 'Balance correction — migration from paper card system');

-- Arjun (silver, 620 pts)
INSERT INTO customer.loyalty_transactions (tenant_id, loyalty_id, order_id, txn_type, points, description) VALUES
    ('aa000000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-000000000021', 'ff000000-0000-0000-0000-000000000002', 'earn', 620, 'Points earned on order AVR-0083');

-- Priya (bronze, 180 pts)
INSERT INTO customer.loyalty_transactions (tenant_id, loyalty_id, order_id, txn_type, points, description) VALUES
    ('aa000000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-000000000022', NULL, 'earn', 180, 'Welcome bonus — first order');

-- Rohan (silver, 950 pts)
INSERT INTO customer.loyalty_transactions (tenant_id, loyalty_id, order_id, txn_type, points, description) VALUES
    ('aa000000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-000000000023', NULL,                                   'earn',   1200, 'Cumulative from 12 dine-in visits'),
    ('aa000000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-000000000023', NULL,                                   'redeem', -250, 'Redeemed — ₹62.50 off on visit');
-- 1200 - 250 = 950 ✓


-- ============================================================
-- 9. REVIEWS
-- ============================================================

INSERT INTO dining.reviews (
    tenant_id, order_id, customer_id,
    rating, food_rating, service_rating, ambience_rating,
    comment, source, is_published, reply, replied_at, replied_by
) VALUES
(
    'aa000000-0000-0000-0000-000000000001',
    'ff000000-0000-0000-0000-000000000002',
    'dd000000-0000-0000-0000-000000000002',
    5, 5, 5, 4,
    'The biryani is genuinely the best I''ve had outside of Dindigul itself. Parotta with the chicken salna was ridiculous. Will be back.',
    'platform', TRUE,
    'Thank you, Arjun! That biryani is our chef Selvam''s obsession — glad it showed. See you soon.',
    NOW() - INTERVAL '1 day 20 hours',
    'aa000000-0000-0000-0000-000000000021'
),
(
    'aa000000-0000-0000-0000-000000000001',
    'ff000000-0000-0000-0000-000000000003',
    'dd000000-0000-0000-0000-000000000001',
    4, 5, 4, 4,
    'Kari Kozhambu was phenomenal. Paal Payasam is the real deal. Delivery took 50 mins which was a bit long — but worth it.',
    'platform', TRUE,
    'Kavya, thank you! We''re working on delivery times. The payasam is worth the wait, we hope!',
    NOW() - INTERVAL '22 hours',
    'aa000000-0000-0000-0000-000000000020'
);


-- ============================================================
-- 10. CATERING
-- ============================================================

INSERT INTO catering.enquiry_forms (
    id, tenant_id,
    standard_fields, custom_fields,
    thank_you_message, notify_email, notify_whatsapp, is_active
) VALUES (
    'a9000000-0000-0000-0000-000000000001',
    'aa000000-0000-0000-0000-000000000001',
    '{"name":true,"phone":true,"email":true,"event_type":true,"guest_count":true,"preferred_date":true,"budget":true,"notes":true}'::jsonb,
    '[{"key":"venue_preference","label":"Venue Preference","type":"text","required":false}]'::jsonb,
    'Thank you for reaching out. Our catering team will contact you within 24 hours.',
    'catering@avartana.in',
    '919884001234',
    TRUE
);

-- Catering customer (separate from dine-in customers for realism)
INSERT INTO customer.customers (
    id, tenant_id, name, phone, email,
    sms_consent, email_consent, whatsapp_consent,
    tags
) VALUES (
    'a9000000-0000-0000-0000-000000000020',
    'aa000000-0000-0000-0000-000000000001',
    'Shalini Balakrishnan', '+919884301001', 'shalini.b@techcorp.in',
    TRUE, TRUE, TRUE,
    ARRAY['catering','corporate']
);

-- Lead 1: new enquiry (just came in)
INSERT INTO catering.leads (
    id, tenant_id,
    contact_name, contact_phone, contact_email,
    event_type, guest_count_min, guest_count_max,
    preferred_date_from, preferred_date_to,
    budget_min, budget_max,
    venue_preference, notes,
    status, source
) VALUES (
    'a9000000-0000-0000-0000-000000000010',
    'aa000000-0000-0000-0000-000000000001',
    'Meena Iyer', '+919884305002', 'meena.iyer@gmail.com',
    'Wedding Reception', 200, 250,
    CURRENT_DATE + INTERVAL '45 days',
    CURRENT_DATE + INTERVAL '45 days',
    350000.00, 500000.00,
    'Hotel banquet hall, Nungambakkam',
    'Traditional Tamil menu. Vegetarian guests ~60%. Need banana leaf service.',
    'new', 'web'
);

-- Lead 2: qualified, follow-up scheduled
INSERT INTO catering.leads (
    id, tenant_id,
    contact_name, contact_phone, contact_email,
    event_type, guest_count_min, guest_count_max,
    preferred_date_from, preferred_date_to,
    budget_min, budget_max,
    notes, status, assigned_staff_id,
    follow_up_at, customer_id, source
) VALUES (
    'a9000000-0000-0000-0000-000000000011',
    'aa000000-0000-0000-0000-000000000001',
    'Shalini Balakrishnan', '+919884301001', 'shalini.b@techcorp.in',
    'Corporate Annual Dinner', 80, 100,
    CURRENT_DATE + INTERVAL '21 days',
    CURRENT_DATE + INTERVAL '21 days',
    120000.00, 180000.00,
    'Board of directors dinner. Multi-course plated service. High-end presentation required.',
    'qualified',
    'aa000000-0000-0000-0000-000000000021',
    NOW() + INTERVAL '2 days',
    'a9000000-0000-0000-0000-000000000020',
    'web'
);

-- Lead 3: converted (linked to a confirmed event)
INSERT INTO catering.leads (
    id, tenant_id,
    contact_name, contact_phone, contact_email,
    event_type, guest_count_min, guest_count_max,
    preferred_date_from, preferred_date_to,
    budget_min, budget_max,
    status, assigned_staff_id, customer_id, source
) VALUES (
    'a9000000-0000-0000-0000-000000000012',
    'aa000000-0000-0000-0000-000000000001',
    'Rohan Pillai', '+919884204004', 'rohan.pillai@gmail.com',
    'Birthday Celebration', 25, 30,
    CURRENT_DATE + INTERVAL '10 days',
    CURRENT_DATE + INTERVAL '10 days',
    40000.00, 60000.00,
    'converted',
    'aa000000-0000-0000-0000-000000000021',
    'dd000000-0000-0000-0000-000000000004',
    'whatsapp'
);

INSERT INTO catering.lead_notes (tenant_id, lead_id, staff_id, note, follow_up_at) VALUES
    (
        'aa000000-0000-0000-0000-000000000001',
        'a9000000-0000-0000-0000-000000000011',
        'aa000000-0000-0000-0000-000000000021',
        'Spoke with Shalini. They want a starter canape round followed by a 4-course sit-down. Sent preliminary menu options. Awaiting approval from their CEO.',
        NOW() + INTERVAL '2 days'
    ),
    (
        'aa000000-0000-0000-0000-000000000001',
        'a9000000-0000-0000-0000-000000000012',
        'aa000000-0000-0000-0000-000000000021',
        'Rohan confirmed the date and head count. Advance of ₹15,000 received. Event locked in.',
        NULL
    );

-- Catering package
INSERT INTO catering.packages (
    id, tenant_id, name, description,
    price_per_head, min_guests, max_guests, is_active
) VALUES (
    'a9000000-0000-0000-0000-000000000060',
    'aa000000-0000-0000-0000-000000000001',
    'Tamil Celebration Package',
    'Traditional multi-course Tamil menu for weddings and celebrations. Includes banana leaf service, live ghee idli counter, and dessert spread.',
    850.00, 50, 500, TRUE
);

INSERT INTO catering.package_items (
    tenant_id, package_id, menu_item_id, quantity_per_head, unit_price_per_head
) VALUES
    ('aa000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000060', 'cc000000-0000-0000-0000-000000000021', 2.00, 30.00),  -- Ghee Idli × 2
    ('aa000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000060', 'cc000000-0000-0000-0000-000000000026', 1.00, 80.00),  -- Sambar Rice × 1
    ('aa000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000060', 'cc000000-0000-0000-0000-000000000025', 0.50, 60.00),  -- Palak Paneer × ½
    ('aa000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000060', 'cc000000-0000-0000-0000-000000000029', 1.00, 80.00),  -- Paal Payasam × 1
    ('aa000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000060', 'cc000000-0000-0000-0000-000000000033', 1.00, 30.00);  -- Masala Chaas × 1

-- Confirmed catering event (Rohan's birthday)
INSERT INTO catering.events (
    id, tenant_id, location_id, customer_id, lead_id,
    event_name, event_type, guest_count,
    event_date_from, event_date_to,
    venue_address, status,
    advance_amount, advance_paid,
    assigned_staff_id, notes
) VALUES (
    'a9000000-0000-0000-0000-000000000030',
    'aa000000-0000-0000-0000-000000000001',
    'aa000000-0000-0000-0000-000000000002',
    'dd000000-0000-0000-0000-000000000004',
    'a9000000-0000-0000-0000-000000000012',
    'Rohan''s 30th Birthday Dinner',
    'Birthday Celebration', 28,
    CURRENT_DATE + INTERVAL '10 days',
    CURRENT_DATE + INTERVAL '10 days',
    '12, Greenways Road, R.A. Puram, Chennai 600028',
    'confirmed',
    15000.00, TRUE,
    'aa000000-0000-0000-0000-000000000021',
    'Guest of honour is vegetarian. Surprise cake to be arranged by client. We handle full setup and service.'
);

-- Update lead 3 to mark converted with event_id
UPDATE catering.leads
SET event_id = 'a9000000-0000-0000-0000-000000000030'
WHERE id = 'a9000000-0000-0000-0000-000000000012';

INSERT INTO catering.event_days (
    id, tenant_id, event_id,
    event_date, day_label, guest_count,
    venue_address, status
) VALUES (
    'a9000000-0000-0000-0000-000000000040',
    'aa000000-0000-0000-0000-000000000001',
    'a9000000-0000-0000-0000-000000000030',
    CURRENT_DATE + INTERVAL '10 days',
    'Birthday Dinner', 28,
    '12, Greenways Road, R.A. Puram, Chennai 600028',
    'confirmed'
);

-- Quote for the corporate lead
INSERT INTO catering.quotes (
    id, tenant_id, lead_id,
    version, status, total_amount,
    valid_until, advance_amount, terms_notes, sent_at
) VALUES (
    'a9000000-0000-0000-0000-000000000050',
    'aa000000-0000-0000-0000-000000000001',
    'a9000000-0000-0000-0000-000000000011',
    1, 'sent', 142000.00,
    CURRENT_DATE + INTERVAL '14 days',
    35000.00,
    'Advance of ₹35,000 to confirm booking. Balance due 3 days before event. Includes setup, service, and breakdown.',
    NOW() - INTERVAL '1 day'
);

INSERT INTO catering.quote_items (
    tenant_id, quote_id, description,
    menu_item_id, quantity, unit_price
) VALUES
    ('aa000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000050', 'Canapé starter round (6 varieties × 90 guests)',   NULL, 90, 280.00),
    ('aa000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000050', 'Plated 4-course dinner per head',                   NULL, 90, 950.00),
    ('aa000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000050', 'Service staff (4 servers × 6 hours)',               NULL,  4, 2500.00),
    ('aa000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000050', 'Equipment hire — crockery, linen, chafing dishes',  NULL,  1, 12000.00);


-- ============================================================
-- 11. INSIGHTS
-- ============================================================

INSERT INTO insights.review_summary (
    tenant_id, total_reviews, avg_rating,
    five_star, four_star, three_star, two_star, one_star
) VALUES (
    'aa000000-0000-0000-0000-000000000001',
    214, 4.4,
    108, 68, 24, 9, 5
);

-- Daily metrics — 14 days of revenue and order data for the insights chart
INSERT INTO insights.daily_metrics (tenant_id, metric_date, metric_type, value, computed_at) VALUES
    ('aa000000-0000-0000-0000-000000000001', CURRENT_DATE - 13, 'revenue',        18420.00, NOW()),
    ('aa000000-0000-0000-0000-000000000001', CURRENT_DATE - 13, 'order_count',       22,    NOW()),
    ('aa000000-0000-0000-0000-000000000001', CURRENT_DATE - 13, 'avg_order_value',  837.27, NOW()),
    ('aa000000-0000-0000-0000-000000000001', CURRENT_DATE - 12, 'revenue',        21060.00, NOW()),
    ('aa000000-0000-0000-0000-000000000001', CURRENT_DATE - 12, 'order_count',       26,    NOW()),
    ('aa000000-0000-0000-0000-000000000001', CURRENT_DATE - 12, 'avg_order_value',  810.77, NOW()),
    ('aa000000-0000-0000-0000-000000000001', CURRENT_DATE - 11, 'revenue',        16380.00, NOW()),
    ('aa000000-0000-0000-0000-000000000001', CURRENT_DATE - 11, 'order_count',       19,    NOW()),
    ('aa000000-0000-0000-0000-000000000001', CURRENT_DATE - 11, 'avg_order_value',  862.11, NOW()),
    ('aa000000-0000-0000-0000-000000000001', CURRENT_DATE - 10, 'revenue',        23940.00, NOW()),
    ('aa000000-0000-0000-0000-000000000001', CURRENT_DATE - 10, 'order_count',       31,    NOW()),
    ('aa000000-0000-0000-0000-000000000001', CURRENT_DATE - 10, 'avg_order_value',  772.26, NOW()),
    ('aa000000-0000-0000-0000-000000000001', CURRENT_DATE -  9, 'revenue',        29700.00, NOW()),
    ('aa000000-0000-0000-0000-000000000001', CURRENT_DATE -  9, 'order_count',       38,    NOW()),
    ('aa000000-0000-0000-0000-000000000001', CURRENT_DATE -  9, 'avg_order_value',  781.58, NOW()),
    ('aa000000-0000-0000-0000-000000000001', CURRENT_DATE -  8, 'revenue',        31200.00, NOW()),
    ('aa000000-0000-0000-0000-000000000001', CURRENT_DATE -  8, 'order_count',       40,    NOW()),
    ('aa000000-0000-0000-0000-000000000001', CURRENT_DATE -  8, 'avg_order_value',  780.00, NOW()),
    ('aa000000-0000-0000-0000-000000000001', CURRENT_DATE -  7, 'revenue',        19500.00, NOW()),
    ('aa000000-0000-0000-0000-000000000001', CURRENT_DATE -  7, 'order_count',       24,    NOW()),
    ('aa000000-0000-0000-0000-000000000001', CURRENT_DATE -  7, 'avg_order_value',  812.50, NOW()),
    ('aa000000-0000-0000-0000-000000000001', CURRENT_DATE -  6, 'revenue',        22200.00, NOW()),
    ('aa000000-0000-0000-0000-000000000001', CURRENT_DATE -  6, 'order_count',       28,    NOW()),
    ('aa000000-0000-0000-0000-000000000001', CURRENT_DATE -  6, 'avg_order_value',  792.86, NOW()),
    ('aa000000-0000-0000-0000-000000000001', CURRENT_DATE -  5, 'revenue',        26400.00, NOW()),
    ('aa000000-0000-0000-0000-000000000001', CURRENT_DATE -  5, 'order_count',       33,    NOW()),
    ('aa000000-0000-0000-0000-000000000001', CURRENT_DATE -  5, 'avg_order_value',  800.00, NOW()),
    ('aa000000-0000-0000-0000-000000000001', CURRENT_DATE -  4, 'revenue',        34800.00, NOW()),
    ('aa000000-0000-0000-0000-000000000001', CURRENT_DATE -  4, 'order_count',       44,    NOW()),
    ('aa000000-0000-0000-0000-000000000001', CURRENT_DATE -  4, 'avg_order_value',  790.91, NOW()),
    ('aa000000-0000-0000-0000-000000000001', CURRENT_DATE -  3, 'revenue',        38400.00, NOW()),
    ('aa000000-0000-0000-0000-000000000001', CURRENT_DATE -  3, 'order_count',       48,    NOW()),
    ('aa000000-0000-0000-0000-000000000001', CURRENT_DATE -  3, 'avg_order_value',  800.00, NOW()),
    ('aa000000-0000-0000-0000-000000000001', CURRENT_DATE -  2, 'revenue',        28800.00, NOW()),
    ('aa000000-0000-0000-0000-000000000001', CURRENT_DATE -  2, 'order_count',       36,    NOW()),
    ('aa000000-0000-0000-0000-000000000001', CURRENT_DATE -  2, 'avg_order_value',  800.00, NOW()),
    ('aa000000-0000-0000-0000-000000000001', CURRENT_DATE -  1, 'revenue',        33000.00, NOW()),
    ('aa000000-0000-0000-0000-000000000001', CURRENT_DATE -  1, 'order_count',       42,    NOW()),
    ('aa000000-0000-0000-0000-000000000001', CURRENT_DATE -  1, 'avg_order_value',  785.71, NOW());

-- Item performance — top 5 sellers, last 7 days
INSERT INTO insights.item_performance (
    tenant_id, menu_item_id, metric_date,
    units_sold, gross_revenue, avg_rating
) VALUES
    ('aa000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000023', CURRENT_DATE - 1, 18, 11160.00, 4.8),
    ('aa000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000022', CURRENT_DATE - 1, 12,  8160.00, 4.9),
    ('aa000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000027', CURRENT_DATE - 1, 34,  2040.00, 4.6),
    ('aa000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000031', CURRENT_DATE - 1, 41,  3280.00, 4.7),
    ('aa000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000024', CURRENT_DATE - 1,  9,  5220.00, 4.8),
    ('aa000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000023', CURRENT_DATE - 2, 21, 13020.00, 4.8),
    ('aa000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000022', CURRENT_DATE - 2, 14,  9520.00, 4.9),
    ('aa000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000027', CURRENT_DATE - 2, 38,  2280.00, 4.5),
    ('aa000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000031', CURRENT_DATE - 2, 46,  3680.00, 4.7),
    ('aa000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000024', CURRENT_DATE - 2, 11,  6380.00, 4.9);


COMMIT;

-- ============================================================
-- DEMO LOGIN
--   Email:    vikram@avartana.in
--   Password: avartana2024
--   Slug:     avartana
-- ============================================================
