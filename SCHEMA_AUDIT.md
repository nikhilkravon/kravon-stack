# Kravon Schema Audit

Audit date: 2026-05-30

Scope: `kravon-engine/backend`, `kravon-engine/frontend`, `kravon-engine/configs`, and database schema/migration files.

This audit is documentation only. It does not change application code or database shape.

## Executive Findings

1. There are two competing database models in the repo.
   - `kravon-engine/backend/db/schema/kravon_schema_v12.sql` defines the intended multi-schema UUID model.
   - `kravon-engine/backend/db/schema.js` defines an older flat public-schema model.
   - `kravon-engine/backend/db/migrate.js` imports `schema.js`, not `schema/kravon_schema_v12.sql`.
   - Several routes query v12 tables, while `dine-in.js`, `cors.js`, and older migrations still query flat tables.
   - Recommended action: make v12 the sole canonical schema, replace `schema.js` with a loader for v12 SQL, and retire flat-schema migrations/routes.

2. `tenant.restaurants.settings` is overloaded.
   - It stores operational values, contact fallbacks, Presence content, delivery config, payment fallbacks, story fields, timeline, map URL, and catering page content.
   - Recommended action: keep `settings` only for low-risk tenant preferences that do not deserve first-class schema ownership; migrate business concepts to their canonical tables.

3. `/config` is the de facto frontend contract, but it includes compatibility aliases and UI copy.
   - Examples: `rest_id`, `customisable`, `customise`, hardcoded order copy, hardcoded static sections, empty `addons`, empty `spiceLevels`.
   - Recommended action: version and formalize `/config` as the single public read contract, then remove aliases after frontend consumers are updated.

4. Presence content is partially normalized and partially JSONB.
   - Hero headline edits write `tenant.restaurants.name`.
   - Hero subheadline writes `settings.tagline`, while public config reads tagline from `brand.seo.meta_description || settings.tagline || tenant.restaurants.name`.
   - Gallery uses `brand.assets`.
   - Featured uses `brand.announcements`.
   - Story/timeline/signature dishes use `tenant.restaurants.settings`.
   - Recommended action: define one Presence contract and one owner per field before any additional Presence work.

5. Feature state exists in multiple forms.
   - Product booleans on `tenant.restaurants`: `has_presence`, `has_orders`, `has_tables`, `has_catering`, `has_insights`.
   - `tenant.feature_flags`.
   - `tenant.subscriptions.plan`.
   - Static config snapshots under `kravon-engine/configs`.
   - `/config.products` and `/config.capabilities`.
   - Recommended action: subscriptions own commercial plan; product booleans own coarse entitlements or are derived from plan; `feature_flags` should only be temporary overrides; frontend reads only `capabilities`.

## Configuration Sources

| Source | Current owner claim | Consumers | Duplication risk | Recommended action |
|---|---|---|---|---|
| `tenant.restaurants` columns | Tenant identity, status, product flags, settings JSONB | tenant middleware, auth, admin, config, dashboard | High because settings shadows many tables | Keep identity/status/plan; reduce settings |
| `tenant.restaurants.settings` | Misc tenant config and content | tenant middleware, config route, presence route, seeds | Very high | Split into canonical owners; document allowed keys |
| `brand.themes` | Visual identity | Intended `/config`, not fully wired in current route | Medium | Keep as canonical theme owner and include in `/config` |
| `brand.assets` | Logo/banner/gallery/OG images | tenant middleware, presence route, `/config` | Medium | Keep assets canonical; define `type` and `metadata` contract |
| `brand.seo` | SEO metadata | tenant middleware, seeds | Medium; meta description used as tagline | Keep only SEO; do not use as tagline |
| `brand.contact_links` | WhatsApp/social/map links | tenant middleware, presence route | Medium; phone/email/address elsewhere | Keep external links only |
| `tenant.locations` | Physical location/contact/hours context | tenant middleware, presence route, admin | Medium; settings also stores address/phone/hours | Keep address/phone/city/timezone/location data here |
| `tenant.operating_hours` | Structured hours per location | seeds/schema only, not current `/config` | High; hours_display/open_until live in settings/old schema | Use as canonical hours owner; derive display text |
| `tenant.integrations` | Razorpay/webhook/provider config | tenant middleware, admin | Medium; settings fallback exists | Keep integrations canonical; remove settings fallbacks |
| Environment variables | Platform secrets/runtime config | server, pool, integrations, frontend boot | Low/medium | Keep only deployment/runtime concerns |
| `kravon-engine/configs/*.json` | Static snapshots/reference | validate script/docs, not live app | Medium if edited as live config | Keep as generated snapshots only or remove |
| Frontend globals | API base and slug | all public modules | Medium | Keep bootstrap-only: `KRAVON_API_URL`, `RESTAURANT_SLUG_ENV` |
| `frontend/config/restaurant-config.schema.json` | Old `/config` contract | docs/reference | High; stale relative to current response | Replace with generated/current schema |

## Canonical Schema Inventory

Canonical target file: `kravon-engine/backend/db/schema/kravon_schema_v12.sql`.

The following inventory lists tables and columns from the v12 schema. JSONB structures are called out separately below.

### tenant

| Table | Columns | Owner | Consumers | Risk | Recommended action |
|---|---|---|---|---|---|
| `tenant.restaurants` | `id`, `slug`, `name`, `plan`, `status`, `has_presence`, `has_orders`, `has_tables`, `has_catering`, `has_insights`, `settings`, `deleted_at`, `created_at`, `updated_at`, `created_by`, `updated_by` | Tenant identity and product entitlement | tenant middleware, auth, admin, config, presence | High due to `settings` and feature duplication | Keep identity/status; clarify plan/feature ownership; restrict settings |
| `tenant.locations` | `id`, `tenant_id`, `name`, `address`, `city`, `state`, `country`, `pincode`, `lat`, `lng`, `timezone`, `phone`, `is_active`, `metadata`, `deleted_at`, `created_at`, `updated_at` | Physical/service locations | tenant middleware, admin, presence contact | Medium because settings duplicates phone/address/city/email | Keep as location/contact owner; define metadata keys |
| `tenant.domains` | `id`, `tenant_id`, `domain`, `is_primary`, `verified_at`, `deleted_at`, `created_at`, `updated_at` | Tenant domain mapping | Intended tenant resolution | High because middleware reads `settings->>'domain'` | Use this table in middleware; remove settings domain |
| `tenant.operating_hours` | `id`, `tenant_id`, `location_id`, `day_of_week`, `opens_at`, `closes_at`, `is_closed`, `created_at`, `updated_at` | Structured hours | Not used by current route | High because display hours live elsewhere | Make canonical and derive `hours.display` |
| `tenant.virtual_brands` | `id`, `tenant_id`, `kitchen_location_id`, `restaurant_id`, `display_name`, `is_active`, `deleted_at`, `created_at`, `updated_at` | Virtual brand relation | No active consumer found | Medium | Keep only if roadmap requires virtual brands |
| `tenant.integrations` | `id`, `tenant_id`, `provider`, `config`, `is_active`, `deleted_at`, `created_at`, `updated_at` | Provider credentials/config | tenant middleware, admin | Medium due to settings fallback | Keep canonical; validate provider config shape |
| `tenant.roles` | `id`, `tenant_id`, `name`, `display_name`, `description`, `is_system_role`, `is_active`, `deleted_at`, `created_at`, `updated_at`, `created_by` | Role definitions | auth/admin | Low | Keep |
| `tenant.permissions` | `id`, `tenant_id`, `role_id`, `permission_key`, `created_at` | Permission grants | auth/admin future | Low | Keep |
| `tenant.staff` | `id`, `tenant_id`, `name`, `email`, `phone`, `pin`, `auth_provider`, `auth_uid`, `avatar_url`, `is_active`, `last_login_at`, `metadata`, `deleted_at`, `created_at`, `updated_at`, `created_by`, `updated_by`, plus migration-added `password_hash` | Staff identity/auth | auth, admin | Medium; `pin` vs `password_hash` must be explicit | Keep both only if POS PIN remains distinct |
| `tenant.staff_roles` | `id`, `tenant_id`, `staff_id`, `role_id`, `assigned_at`, `assigned_by` | Staff role assignments | auth | Low | Keep |
| `tenant.staff_locations` | `id`, `tenant_id`, `staff_id`, `location_id`, `all_locations`, `created_at` | Staff location access | Future/admin | Low | Keep |
| `tenant.staff_sessions` | `id`, `tenant_id`, `staff_id`, `session_token`, `device_info`, `expires_at`, `revoked_at`, `created_at` | Refresh sessions | auth | Low | Keep |
| `tenant.tax_rules` | `id`, `tenant_id`, `name`, `description`, `components`, `total_rate`, `is_inclusive`, `is_default`, `is_active`, `deleted_at`, `created_at`, `updated_at`, `created_by` | Tax definitions | Intended order pricing | Medium; active order service hardcodes tax as zero | Keep and wire into pricing |
| `tenant.tax_rule_items` | `id`, `tenant_id`, `tax_rule_id`, `menu_item_id`, `category_id`, `combo_id`, `created_at` | Tax applicability | No active consumer found | Medium | Keep if tax service is implemented |
| `tenant.subscriptions` | `id`, `tenant_id`, `plan`, `billing_provider`, `provider_subscription_id`, `status`, `trial_ends_at`, `current_period_start`, `current_period_end`, `cancel_at_period_end`, `metadata`, `created_at`, `updated_at` | Billing subscription | Not active in feature gating | High because `restaurants.plan` and booleans duplicate it | Decide plan owner; derive entitlements |
| `tenant.feature_flags` | `id`, `tenant_id`, `feature_key`, `enabled`, `config`, `created_at`, `updated_at` | Overrides | Not active in `requireFeature` | High if used alongside booleans | Use only for overrides or remove |

### brand

| Table | Columns | Owner | Consumers | Risk | Recommended action |
|---|---|---|---|---|---|
| `brand.themes` | `id`, `tenant_id`, `primary_color`, `secondary_color`, `accent_color`, `font_heading`, `font_body`, `button_style`, `card_style`, `image_style`, `custom_css`, `deleted_at`, `created_at`, `updated_at` | Visual brand system | Seeds/schema; not fully in current `/config` | Medium | Include in `/config.brand.theme` |
| `brand.assets` | `id`, `tenant_id`, `type`, `url`, `alt_text`, `metadata`, `deleted_at`, `created_at`, `updated_at` | Logo/banner/gallery/OG asset registry | tenant middleware, presence route | Medium; asset type is free-form | Keep and constrain type/metadata |
| `brand.seo` | `id`, `tenant_id`, `meta_title`, `meta_description`, `og_title`, `og_description`, `og_image_url`, `twitter_handle`, `canonical_url`, `schema_org_json`, `deleted_at`, `created_at`, `updated_at` | SEO only | tenant middleware, config | High because `meta_description` acts as tagline | Remove tagline fallback from SEO |
| `brand.contact_links` | `id`, `tenant_id`, `platform`, `url`, `display_label`, `position`, `deleted_at`, `created_at`, `updated_at` | External contact/social links | tenant middleware, presence | Medium | Keep for links only; phone/email remain elsewhere |
| `brand.announcements` | `id`, `tenant_id`, `title`, `body`, `cta_label`, `cta_url`, `starts_at`, `ends_at`, `is_active`, `deleted_at`, `created_at`, `updated_at`, plus migration-added `image_url` | Announcements/promos | presence route, config | Medium; reused as Presence featured content | Either keep as announcements or rename contract to featured announcements |

### menu

| Table | Columns | Owner | Consumers | Risk | Recommended action |
|---|---|---|---|---|---|
| `menu.menus` | `id`, `tenant_id`, `location_id`, `name`, `menu_type`, `is_active`, `metadata`, `deleted_at`, `created_at`, `updated_at` | Menu collections | menu route creates first menu | Low | Keep |
| `menu.categories` | `id`, `tenant_id`, `menu_id`, `name`, `description`, `image_url`, `position`, `is_active`, `deleted_at`, `created_at`, `updated_at` | Menu categories | `/config`, `/menu/categories`, dashboard | Low | Keep |
| `menu.menu_items` | `id`, `tenant_id`, `category_id`, `name`, `description`, `image_url`, `food_type`, `price`, `has_variants`, `is_customizable`, `is_available`, `allergens`, `tags`, `prep_time_mins`, `calories`, `sort_order`, `metadata`, `deleted_at`, `created_at`, `updated_at` | Sellable menu item base | order service, config, menu, frontends | Medium; aliases and price conventions vary | Keep; standardize frontend field names |
| `menu.item_variants` | `id`, `tenant_id`, `menu_item_id`, `name`, `food_type`, `price`, `is_available`, `sort_order`, `deleted_at`, `created_at`, `updated_at` | Variant pricing/options | config item detail, customization modal | Low | Keep |
| `menu.customization_groups` | `id`, `tenant_id`, `menu_item_id`, `name`, `group_type`, `is_required`, `min_select`, `max_select`, `is_free`, `position`, `deleted_at`, `created_at`, `updated_at` | Customization groups | config item detail | Low | Keep |
| `menu.customization_options` | `id`, `tenant_id`, `group_id`, `name`, `price_modifier`, `food_type`, `is_default`, `is_available`, `sort_order`, `deleted_at`, `created_at`, `updated_at` | Customization options | config item detail | Low | Keep |
| `menu.item_availability` | `id`, `tenant_id`, `menu_item_id`, `day_of_week`, `available_from`, `available_until`, `created_at` | Time-based item availability | No active consumer | Medium | Keep only if product will use schedules |
| `menu.combos` | `id`, `tenant_id`, `category_id`, `name`, `description`, `image_url`, `food_type`, `price`, `is_available`, `tags`, `sort_order`, `deleted_at`, `created_at`, `updated_at` | Combos | No active consumer | Medium | Keep if roadmap requires combos |
| `menu.combo_slots` | `id`, `tenant_id`, `combo_id`, `name`, `quantity`, `position`, `created_at` | Combo slot definitions | No active consumer | Medium | Same as combos |
| `menu.combo_slot_options` | `id`, `tenant_id`, `slot_id`, `menu_item_id`, `variant_id`, `created_at` | Combo choices | No active consumer | Medium | Same as combos |
| `menu.menu_schedules` | `id`, `tenant_id`, `menu_id`, `location_id`, `name`, `days_of_week`, `time_from`, `time_until`, `date_from`, `date_until`, `priority`, `is_active`, `deleted_at`, `created_at`, `updated_at`, `created_by` | Menu scheduling | No active consumer | Medium | Keep only if boot/config uses it |

### customer

| Table | Columns | Owner | Consumers | Risk | Recommended action |
|---|---|---|---|---|---|
| `customer.customers` | `id`, `tenant_id`, `name`, `phone`, `email`, `preferred_name`, `date_of_birth`, `anniversary`, `dietary_pref`, `tags`, `notes`, `sms_consent`, `email_consent`, `whatsapp_consent`, `metadata`, `deleted_at`, `created_at`, `updated_at` | Customer profile | order service, dine-in reservations | Low | Keep |
| `customer.addresses` | `id`, `tenant_id`, `customer_id`, `label`, `address_line1`, `address_line2`, `city`, `state`, `pincode`, `lat`, `lng`, `is_default`, `deleted_at`, `created_at`, `updated_at` | Customer addresses | Not active in order create | Medium | Use for delivery address or keep snapshot-only explicitly |
| `customer.loyalty_accounts` | `id`, `tenant_id`, `customer_id`, `points_balance`, `tier`, `lifetime_spend`, `visit_count`, `last_visit_at`, `deleted_at`, `created_at`, `updated_at` | Loyalty state | No active consumer | Medium | Keep if loyalty roadmap is committed |
| `customer.loyalty_transactions` | `id`, `tenant_id`, `loyalty_id`, `order_id`, `txn_type`, `points`, `description`, `created_at` | Loyalty ledger | No active consumer | Medium | Same as loyalty |
| `customer.feedback` | `id`, `tenant_id`, `customer_id`, `entity_type`, `entity_id`, `rating`, `nps_score`, `comment`, `tags`, `channel`, `notification_id`, `solicited_at`, `responded_at`, `is_public`, `metadata`, `deleted_at`, `created_at`, `updated_at` | General feedback | Not used; `dining.reviews` is used | High | Decide feedback vs dining reviews boundary |
| `customer.interaction_log` | `id`, `tenant_id`, `customer_id`, `interaction_type`, `entity_type`, `entity_id`, `value`, `points_delta`, `channel`, `location_id`, `metadata`, `occurred_at`, `created_at` | Customer events | No active consumer | Medium | Keep if insights will consume |
| `customer.identities` | `id`, `tenant_id`, `customer_id`, `identity_type`, `identity_value`, `verified`, `metadata`, `created_at`, `updated_at` | External identities | No active consumer | Low | Keep if auth/CRM roadmap requires |

### orders and payments

| Table | Columns | Owner | Consumers | Risk | Recommended action |
|---|---|---|---|---|---|
| `orders.orders` | `id`, `tenant_id`, `location_id`, `customer_id`, `session_id`, `delivery_address_id`, `channel`, `fulfillment_type`, `status`, `scheduled_at`, `subtotal_amount`, `tax_amount`, `discount_amount`, `tip_amount`, `packaging_charge`, `delivery_charge`, `total_amount`, `special_instructions`, `token_number`, `source_ref`, `metadata`, `deleted_at`, `created_at`, `updated_at` | Order header | order service, orders route, insights, webhooks | High because flat `orders` table still queried in dine-in | Use only `orders.orders`; move snapshots out of metadata only when needed |
| `orders.order_items` | `id`, `tenant_id`, `order_id`, `menu_item_id`, `variant_id`, `combo_id`, `item_name`, `variant_name`, `unit_price`, `tax_rate`, `quantity`, `base_price`, `addons_total`, `total_price`, `special_note`, `created_at` | Order line items | order service | Low | Keep |
| `orders.order_item_customizations` | `id`, `tenant_id`, `order_item_id`, `group_id`, `option_id`, `option_name`, `price_modifier`, `created_at` | Order item customizations | Not active; service stores addons in metadata | High | Write customization rows or remove until used |
| `orders.order_taxes` | `id`, `tenant_id`, `order_id`, `tax_name`, `rate`, `amount`, `created_at` | Tax ledger | Not active | Medium | Wire from tax rules |
| `orders.order_discounts` | `id`, `tenant_id`, `order_id`, `coupon_code`, `discount_type`, `discount_value`, `amount_saved`, `created_at` | Discount ledger | Not active | Medium | Keep if coupon service exists |
| `orders.coupons` | `id`, `tenant_id`, `code`, `description`, `discount_type`, `discount_value`, `min_order_value`, `max_discount`, `usage_limit`, `used_count`, `valid_from`, `valid_until`, `is_active`, `deleted_at`, `created_at`, `updated_at` | Coupons | Not active | Medium | Keep if orders roadmap includes coupons |
| `orders.delivery_jobs` | `id`, `tenant_id`, `order_id`, `provider`, `provider_job_id`, `tracking_url`, `rider_name`, `rider_phone`, `estimated_time`, `picked_up_at`, `delivered_at`, `status`, `raw_webhook`, `created_at`, `updated_at` | Delivery integration jobs | Not active | Low | Keep |
| `orders.order_events` | `id`, `tenant_id`, `order_id`, `event_type`, `status_from`, `status_to`, `actor_type`, `actor_id`, `metadata`, `created_at` | Order lifecycle events | Not active | Medium | Emit events from order/status changes |
| `payments.payments` | `id`, `tenant_id`, `order_id`, `amount`, `tip_amount`, `tax_amount`, `method`, `gateway`, `transaction_ref`, `gateway_ref`, `status`, `refunded_amount`, `refunded_at`, `metadata`, `deleted_at`, `created_at`, `updated_at` | Payment records | webhook route partly updates order metadata/status instead | High | Make this canonical for payment state |
| `payments.payment_events` | `id`, `tenant_id`, `payment_id`, `event_type`, `provider`, `provider_event_id`, `payload`, `created_at` | Payment event log | Not active | Medium | Write from webhook handler |

### dining

| Table | Columns | Owner | Consumers | Risk | Recommended action |
|---|---|---|---|---|---|
| `dining.tables` | `id`, `tenant_id`, `location_id`, `name`, `capacity`, `floor`, `position`, `status`, `qr_code`, `is_active`, `deleted_at`, `created_at`, `updated_at` | Physical tables | dine-in route | Low | Keep |
| `dining.sessions` | `id`, `tenant_id`, `location_id`, `table_id`, `reservation_id`, `covers`, `opened_at`, `closed_at`, `total_billed`, `metadata`, `deleted_at`, `created_at`, `updated_at` | Dining sessions | dine-in route | Medium; order linkage mixed with flat orders | Keep and link to `orders.orders.session_id` |
| `dining.reservations` | `id`, `tenant_id`, `location_id`, `customer_id`, `table_id`, `party_size`, `reservation_time`, `status`, `source`, `occasion`, `dietary_notes`, `deposit_amount`, `deposit_paid`, `deposit_payment_id`, `confirmation_code`, `reminder_sent`, `cancelled_at`, `cancellation_reason`, `metadata`, `deleted_at`, `created_at`, `updated_at` | Reservations | dine-in public reservation route | Low | Keep |
| `dining.waitlist` | `id`, `tenant_id`, `location_id`, `customer_id`, `party_size`, `joined_at`, `quoted_wait`, `notified_at`, `seated_at`, `status`, `deleted_at`, `created_at`, `updated_at` | Waitlist | No active consumer | Medium | Keep if tables roadmap includes waitlist |
| `dining.reviews` | `id`, `tenant_id`, `order_id`, `session_id`, `customer_id`, `rating`, `food_rating`, `service_rating`, `ambience_rating`, `delivery_rating`, `comment`, `source`, `is_published`, `reply`, `replied_at`, `replied_by`, `deleted_at`, `created_at`, `updated_at` | Dining/order reviews | reviews route | Medium; overlaps `customer.feedback` | Keep as review owner or merge into feedback |

### catering

| Table | Columns | Owner | Consumers | Risk | Recommended action |
|---|---|---|---|---|---|
| `catering.enquiry_forms` | `id`, `tenant_id`, `standard_fields`, `custom_fields`, `thank_you_message`, `notify_email`, `notify_whatsapp`, `is_active`, `deleted_at`, `created_at`, `updated_at` | Catering form schema | Not active; frontend uses `settings.catering` | High | Move form schema here or remove |
| `catering.leads` | `id`, `tenant_id`, `contact_name`, `contact_phone`, `contact_email`, `event_type`, `guest_count_min`, `guest_count_max`, `preferred_date_from`, `preferred_date_to`, `budget_min`, `budget_max`, `venue_preference`, `notes`, `custom_fields`, `status`, `assigned_staff_id`, `follow_up_at`, `customer_id`, `event_id`, `source`, `utm_source`, `utm_medium`, `deleted_at`, `created_at`, `updated_at` | Catering lead records | lead service, insights | Low | Keep |
| `catering.lead_notes` | `id`, `tenant_id`, `lead_id`, `staff_id`, `note`, `follow_up_at`, `created_at` | Lead notes | No active consumer | Low | Keep |
| `catering.events` | `id`, `tenant_id`, `location_id`, `customer_id`, `lead_id`, `event_name`, `event_type`, `guest_count`, `event_date_from`, `event_date_to`, `venue_address`, `setup_time`, `start_time`, `end_time`, `status`, `advance_amount`, `advance_paid`, `advance_payment_id`, `notes`, `assigned_staff_id`, `metadata`, `deleted_at`, `created_at`, `updated_at` | Catering events | No active consumer | Medium | Keep if catering CRM will use |
| `catering.event_days` | `id`, `tenant_id`, `event_id`, `event_date`, `day_label`, `guest_count`, `venue_address`, `setup_time`, `start_time`, `end_time`, `notes`, `assigned_staff_id`, `status`, `metadata`, `deleted_at`, `created_at`, `updated_at` | Multi-day event schedule | No active consumer | Medium | Keep |
| `catering.quotes` | `id`, `tenant_id`, `lead_id`, `event_id`, `event_day_id`, `version`, `status`, `total_amount`, `valid_until`, `advance_amount`, `terms_notes`, `sent_at`, `accepted_at`, `deleted_at`, `created_at`, `updated_at` | Catering quotes | No active consumer | Medium | Keep if quote module will ship |
| `catering.quote_items` | `id`, `tenant_id`, `quote_id`, `description`, `menu_item_id`, `package_id`, `quantity`, `unit_price`, `total_price`, `notes`, `created_at` | Quote lines | No active consumer | Medium | Keep |
| `catering.packages` | `id`, `tenant_id`, `name`, `description`, `price_per_head`, `min_guests`, `max_guests`, `is_active`, `deleted_at`, `created_at`, `updated_at` | Catering packages | No active consumer | Medium; frontend content uses settings | Move package-like content here |
| `catering.package_items` | `id`, `tenant_id`, `package_id`, `menu_item_id`, `quantity_per_head`, `unit_price_per_head`, `notes`, `created_at` | Package composition | No active consumer | Medium | Keep with packages |

### insights, platform, inventory

| Table | Columns | Owner | Consumers | Risk | Recommended action |
|---|---|---|---|---|---|
| `insights.daily_metrics` | `id`, `tenant_id`, `location_id`, `metric_date`, `metric_type`, `value`, `breakdown`, `computed_at`, `created_at` | Materialized daily metrics | Not active; route computes live | Medium | Choose live aggregation or materialization |
| `insights.item_performance` | `id`, `tenant_id`, `menu_item_id`, `metric_date`, `units_sold`, `gross_revenue`, `refund_count`, `avg_rating`, `created_at` | Item metrics | Not active | Medium | Keep if jobs populate |
| `insights.review_summary` | `id`, `tenant_id`, `total_reviews`, `avg_rating`, `five_star`, `four_star`, `three_star`, `two_star`, `one_star`, `created_at`, `updated_at` | Review summary | Seeds/schema | Medium | Use or compute from reviews |
| `insights.events` | `id`, `tenant_id`, `entity_type`, `entity_id`, `event_type`, `payload`, `actor_id`, `session_ref`, `created_at` | Analytics events | Not active | Medium | Keep if event tracking is implemented |
| `insights.menu_views` | `id`, `tenant_id`, `menu_item_id`, `customer_id`, `source`, `session_id`, `created_at` | Menu view tracking | Not active | Medium | Add tracking or remove |
| `insights.customer_segments` | `id`, `tenant_id`, `customer_id`, `segment_key`, `score`, `updated_at`, `created_at` | Customer segmentation | Not active | Low | Keep if CRM roadmap |
| `insights.customer_events` | `id`, `tenant_id`, `customer_id`, `event_type`, `event_value`, `metadata`, `created_at` | Customer analytics events | Not active | Low | Keep if CRM roadmap |
| `platform.event_outbox` | `id`, `tenant_id`, `event_type`, `aggregate_type`, `aggregate_id`, `payload`, `status`, `retry_count`, `error_detail`, `created_at`, `processed_at` | Outbox | webhook/notify intended | Medium | Wire events or remove duplicate `platform.events` |
| `platform.events` | `id`, `tenant_id`, `event_type`, `event_version`, `entity_type`, `entity_id`, `payload`, `processed`, `processed_at`, `occurred_at`, `created_at` | Event log | Not active | High overlap with outbox/insights events | Decide one event store per purpose |
| `platform.webhooks` | `id`, `tenant_id`, `url`, `secret`, `event_types`, `is_active`, `deleted_at`, `created_at`, `updated_at` | Outbound webhook config | Not active; tenant integrations also has webhook config | High | Keep one webhook config owner |
| `platform.webhook_deliveries` | `id`, `outbox_id`, `webhook_id`, `http_status`, `response_body`, `attempt_at`, `duration_ms` | Delivery attempts | Not active | Medium | Keep with platform.webhooks if used |
| `platform.notification_templates` | `id`, `tenant_id`, `name`, `trigger_event`, `channel`, `language`, `subject`, `body_template`, `wa_template_name`, `wa_template_lang`, `wa_component_params`, `is_active`, `is_system`, `preview_vars`, `deleted_at`, `created_at`, `updated_at`, `created_by` | Notification templates | Not active | Medium | Wire notify service or keep planned |
| `platform.notifications` | `id`, `tenant_id`, `template_id`, `customer_id`, `staff_id`, `recipient_phone`, `recipient_email`, `recipient_push_token`, `channel`, `subject`, `body`, `trigger_event`, `entity_type`, `entity_id`, `status`, `provider`, `provider_msg_id`, `sent_at`, `delivered_at`, `failed_at`, `failure_reason`, `metadata`, `created_at`, `updated_at` | Sent notifications | notify service sends directly | Medium | Record sends here |
| `platform.notification_engagement` | `id`, `tenant_id`, `notification_id`, `customer_id`, `engagement_type`, `link_url`, `reply_body`, `provider`, `provider_event_id`, `raw_payload`, `occurred_at`, `created_at` | Notification engagement | Not active | Low | Keep if notifications are retained |
| `platform.audit_log` | `id`, `tenant_id`, `actor_id`, `actor_type`, `action`, `entity_type`, `entity_id`, `before_state`, `after_state`, `ip_address`, `user_agent`, `created_at` | Audit trail | Not active | Medium | Add writes for admin mutations |
| `platform.usage_events` | `id`, `tenant_id`, `metric_key`, `quantity`, `entity_type`, `entity_id`, `metadata`, `occurred_at` | Usage event stream | Not active | Medium | Keep if billing uses it |
| `platform.usage_ledger` | `id`, `tenant_id`, `metric_key`, `period_start`, `period_end`, `quantity`, `billed`, `metadata`, `created_at`, `updated_at` | Billable usage ledger | Not active | Medium | Keep with subscriptions |
| `platform.api_keys` | `id`, `tenant_id`, `key_hash`, `name`, `permissions`, `revoked_at`, `created_at`, `updated_at` | Tenant API keys | Not active | Low | Keep |
| `inventory.items` | `id`, `tenant_id`, `name`, `unit`, `low_stock_threshold`, `metadata`, `deleted_at`, `created_at`, `updated_at` | Inventory items | Not active | Medium | Keep stub only if near-term |
| `inventory.movements` | `id`, `tenant_id`, `inventory_item_id`, `movement_type`, `quantity`, `reference_type`, `reference_id`, `notes`, `metadata`, `created_at` | Inventory movement ledger | Not active | Medium | Keep with inventory |

## Legacy Flat Schema Inventory

File: `kravon-engine/backend/db/schema.js`

This schema conflicts with the v12 multi-schema model. It defines flat public tables including:

| Table | Key columns | Current risk | Recommended action |
|---|---|---|---|
| `restaurants` | `rest_id`, `slug`, `domain`, `name`, `tagline`, contact columns, product booleans, Razorpay columns, review fields, webhook URL, delivery fee columns, `allowed_origin` | Duplicates `tenant.restaurants`, `tenant.locations`, `tenant.integrations`, `tenant.domains`, and settings | Retire after migration to v12 |
| `menu_categories` | `id`, `tenant_id`, `name`, `subtitle`, `sort_order`, `active` | Duplicates `menu.categories` and mixes UUID tenant with public table | Retire |
| `menu_items` | `id`, `tenant_id`, `category_id`, `name`, `price_paise`, image/badge/customisable fields | Duplicates `menu.menu_items`; uses paise while v12 uses numeric rupees | Retire and standardize money |
| `item_variants` | `id`, `tenant_id`, `menu_item_id`, `name`, `food_type`, `price` | Duplicates `menu.item_variants` | Retire |
| `customization_groups` | `id`, `menu_item_id`, `name`, `group_type`, `is_required`, `sort_order` | Duplicates v12, missing tenant_id | Retire |
| `customization_options` | `id`, `group_id`, `name`, `price_modifier`, `is_default`, `sort_order` | Duplicates v12, missing tenant_id | Retire |
| `menu_addons` | `id`, `tenant_id`, `label`, `price_paise` | No v12 direct equivalent; frontend still expects addons | Decide whether addons are customization options or remove |
| `spice_levels` | `id`, `tenant_id`, `label`, `sort_order` | No v12 direct equivalent; frontend still expects spice levels | Decide whether spice is customization group |
| `customers` | `id`, `rest_id`, `phone`, `name`, counts/spend | Duplicates `customer.customers`; aggregates belong in insights | Retire |
| `orders` | public order table with `items_json`, `rest_id`, `session_id` migration | Duplicates `orders.orders`; still referenced by dine-in route | Migrate and retire |
| `catering_leads` | public leads table | Duplicates `catering.leads` | Retire |
| `reviews` | public reviews table | Duplicates `dining.reviews` and `customer.feedback` | Retire |

## JSONB Structure Inventory

| Field | Observed keys/shape | Consumers | Duplication risk | Recommended action |
|---|---|---|---|---|
| `tenant.restaurants.settings` | `domain`, `phone`, `address`, `city`, `email`, `wa_number`, `tagline`, `year`, `razorpay_key_id`, `razorpay_key_secret`, `webhook_url`, `delivery_fee`, `free_delivery_above`, `review_threshold`, `google_review_url`, `hours_display`, `open_until`, `delivery_zone`, `map_url`, `story_headline`, `story_body`, `story_facts`, `timeline`, `signature_dishes`, `catering` | tenant middleware, config, presence, dashboard settings, seeds | Very high | Publish an allowed-key list, then migrate domain/contact/payment/hours out |
| `tenant.locations.metadata` | `email` fallback observed | tenant middleware | Medium | Avoid contact email here unless explicitly a location email |
| `tenant.integrations.config` | Razorpay: `key_id`, `key_secret`; webhook: `url` | tenant middleware/admin | Low if provider-specific | Keep and validate by provider |
| `tenant.staff.metadata` | Unspecified | none active | Low | Keep generic |
| `tenant.staff_sessions.device_info` | `ip`, `userAgent` | auth | Low | Keep |
| `tenant.tax_rules.components` | Array of tax component names/rates | seeds/schema | Low | Keep |
| `tenant.feature_flags.config` | Unspecified | none active | Medium | Use only for override metadata |
| `brand.assets.metadata` | `category` for gallery: `food`, `ambience`, `people` | tenant middleware/presence | Medium | Constrain by asset type |
| `brand.seo.schema_org_json` | Schema.org object | SEO | Low | Keep |
| `menu.menus.metadata` | Unspecified | none active | Low | Keep generic |
| `menu.menu_items.metadata` | Unspecified | none active | Low | Keep generic |
| `orders.orders.metadata` | customer snapshot, table identifier, delivery fields, payment method, razorpay_order_id | order service, webhooks | High | Move payment refs to payments and define snapshot contract |
| `orders.order_events.metadata` | Unspecified | none active | Low | Keep |
| `payments.payments.metadata` | Unspecified | none active | Low | Keep |
| `payments.payment_events.payload` | Gateway event payload | intended webhook | Low | Keep |
| `dining.sessions.metadata` | Unspecified | none active | Low | Keep |
| `dining.reservations.metadata` | Empty object in route | reservation route | Low | Keep |
| `catering.enquiry_forms.standard_fields` | Field config object | not active | Medium | Make canonical form schema or remove |
| `catering.enquiry_forms.custom_fields` | Array of custom field definitions | not active | Medium | Same |
| `catering.leads.custom_fields` | Submitted custom answers | lead service | Low | Keep if enquiry form remains |
| `catering.events.metadata` | Unspecified | none active | Low | Keep |
| `catering.event_days.metadata` | Unspecified | none active | Low | Keep |
| `insights.daily_metrics.breakdown` | Metric breakdown | not active | Low | Keep if populated |
| `insights.events.payload` | Event payload | not active | Medium | Avoid overlap with `platform.events` |
| `insights.customer_events.metadata` | Unspecified | not active | Low | Keep |
| `platform.event_outbox.payload` | Outbox event payload | not active | Medium | Keep if outbox implemented |
| `platform.events.payload` | Event payload | not active | High | Distinguish from outbox/insights or remove |
| `platform.notification_templates.wa_component_params` | WhatsApp template params | not active | Low | Keep |
| `platform.notification_templates.preview_vars` | Preview variables | not active | Low | Keep |
| `platform.notifications.metadata` | Provider/send metadata | not active | Low | Keep |
| `platform.notification_engagement.raw_payload` | Provider callback payload | not active | Low | Keep |
| `platform.audit_log.before_state` / `after_state` | Entity snapshots | not active | Low | Keep |
| `platform.usage_events.metadata` | Usage metadata | not active | Low | Keep |
| `platform.usage_ledger.metadata` | Billing metadata | not active | Low | Keep |
| `inventory.items.metadata` | Unspecified | not active | Low | Keep |
| `inventory.movements.metadata` | Unspecified | not active | Low | Keep |

## Feature Flags and Product Entitlements

| Concept | Current representations | Consumers | Risk | Recommended action |
|---|---|---|---|---|
| Presence enabled | `tenant.restaurants.has_presence`, config snapshots, `/config.products.presence`, `/config.capabilities.website` | server route gates not applied to Presence; frontend CTAs | Medium | Treat Presence as base product; remove boolean or derive it |
| Orders enabled | `has_orders`, `/config.products.orders`, `/config.capabilities.orderManagement`, `requireFeature('has_orders')` | orders routes/frontends | Medium | Keep one server entitlement, expose capability only |
| Tables enabled | `has_tables`, `/config.products.tables`, `/config.capabilities.tables`, `requireFeature('has_tables')` | tables/dine-in/reviews | Medium | Keep one server entitlement, expose capability only |
| Catering enabled | `has_catering`, `/config.products.catering`, `/config.capabilities.catering` | leads/catering | Medium | Keep one server entitlement, expose capability only |
| Insights enabled | `has_insights`, `/config.products.insights`, `/config.capabilities.analytics` | insights/dashboard | Medium | Keep one server entitlement, expose capability only |
| Plan | `tenant.restaurants.plan`, `tenant.subscriptions.plan`, migration-derived values | dashboard settings, config | High | Use subscription plan as commercial source; derive capabilities |
| Fine flags | `tenant.feature_flags` | not active | High if later layered blindly | Use only as explicit overrides with audit trail |

## Frontend Assumption Inventory

| Area | Assumption | Owner consumed | Duplication risk | Recommended action |
|---|---|---|---|---|
| Global boot | `window.CONFIG`, `window.MENU`, `window.ADDONS`, `window.SPICE_LEVELS` | `/config` response | Medium | Keep `CONFIG`; phase out globals for menu/addons/spice |
| Menu shape | `window.MENU = _config.menu.items || _config.menu` | `/config.menu.items` and old array shape | High | One menu shape: categories plus items |
| Item customizability | `customisable`, `customise`, `is_customizable` | `/config` aliases | High | Use only `is_customizable` |
| Product availability | Frontend uses both `products` and `capabilities` | `/config` | Medium | Use only `capabilities` |
| Presence hero | Falls back to `brand.name`, `brand.tagline`, local hero SVG | `/config.hero`, local assets | Medium | Legitimate UI fallback for missing image; remove content fallback if required fields |
| Presence contact | Reads `C.contact` and `C.location`; local `pc = {}` placeholder exists | `/config` | Medium | Use one contact object in config |
| Orders pricing | Reads `CONFIG.orders.deliveryStandard`, `deliveryExpress`, `freeDeliveryAt`, `gstRate` | `/config.orders` | Medium | Move business pricing under `config.fulfillment.delivery` |
| Tables order flow | Uses `C.tables.paymentMode`, `reviewThreshold`, `googleReviewUrl` | `/config.tables` | Low/medium | Keep tables config but derive from canonical integrations/reviews |
| Catering content | Renderer expects rich config content under settings-derived payload | `settings.catering` | High | Move page content to a named owner or documented config object |
| Dashboard settings | Writes `name`, `tagline`, `email`, `hours_display`, delivery fields to `/config` | `tenant.restaurants` and settings | High | PATCH `/config` should route each field to canonical owner |
| Dashboard Presence | Writes full Presence content to `/presence` | Multiple owners | Medium/high | Prefer PATCH `/config/presence` or fold into PATCH `/config` contract |
| API base | Hardcoded `http://localhost:3000` fallback in multiple files | environment/bootstrap | Low for dev, medium for production | Centralize boot config |

## API Contract Inventory

| Endpoint | Current ownership | Response/request overlap | Recommended action |
|---|---|---|---|
| `GET /v1/restaurants/:slug/config` | Public aggregate contract | Assembles tenant, brand, menu, presence, catering, orders UI copy | Keep as single public read contract; version schema |
| `PATCH /v1/restaurants/:slug/config` | Admin settings updates | Writes `name` to column and other fields to `settings` | Keep, but route fields to canonical owners |
| `GET /v1/restaurants/:slug/config/items/:id` | Item customization detail | Path appears under config route but is menu data | Move to `/menu/items/:id` |
| `GET /v1/restaurants/:slug/menu/categories` | Menu management/public list | Duplicates menu section in `/config` | Keep for dashboard/editor; ensure shape matches config |
| Menu write endpoints | Dashboard menu editor | Canonical owner is `menu.*` | Keep |
| `GET/PATCH /v1/restaurants/:slug/presence` | Dashboard Presence editor | Duplicates config/presence content and writes multiple owners | Fold into canonical config write contract or keep as editor facade only |
| `POST /v1/restaurants/:slug/orders` | Public order create | Shared for delivery and tables; dine-in also has separate `/dine-in/order` | Keep delivery/table order create; unify dine-in order path |
| `POST /v1/restaurants/:slug/dine-in/order` | Public session order | Uses flat schema references | Rewrite to v12 `orders.orders` or remove |
| `GET /v1/restaurants/:slug/insights/*` | Admin live analytics | Duplicates potential `insights.*` materialized tables | Decide live vs materialized |
| `POST /v1/restaurants/:slug/leads` | Catering lead create | Uses `catering.leads`; content form config elsewhere | Keep |
| `POST /v1/restaurants/:slug/reviews` | Review create | Uses `dining.reviews`; overlaps feedback | Decide review owner |
| `POST /v1/webhooks/razorpay` | Payment webhook | Updates order metadata/status; payment tables unused | Make `payments.*` canonical |

## Hardcoded Default Classification

### Legitimate UI fallbacks

These are acceptable when they prevent blank UI without claiming business ownership:

- Local placeholders in form controls, such as example names, URLs, phone formats, and notes.
- Empty UI states such as "No categories yet" or "Your cart is empty".
- Rendering fallbacks for absent optional images, if product requirements allow optional imagery.
- Dev-only API base fallback to `http://localhost:3000`, if never used in production bundles.

### Architectural compensation

These should be removed or moved to canonical data owners:

- `schema.js` flat schema used by `migrate.js` while v12 schema is documented as canonical.
- `rest_id` alias for UUID tenant id in v12 objects.
- `customisable` and `customise` aliases for `is_customizable`.
- `/config` hardcoded business copy for order flow, delivery ETA, payment labels, WhatsApp messages, and footer/branding copy.
- `/config` empty `addons` and `spiceLevels` while frontend still depends on these globals.
- `settings` fallbacks for `phone`, `address`, `city`, `domain`, Razorpay keys, webhook URL, and WhatsApp number.
- `tenant.middleware` using `brand.seo.meta_description` as tagline.
- `dine-in.js` flat table references: `orders`, `menu_items`, `rest_id`, `price_paise`, `items_json`.
- `cors.js` reading `allowed_origin` from flat `restaurants`.
- Static `configs/*.json` if treated as editable live config.

## Dead or Stale Code Candidates

These require confirmation before deletion, but are strong candidates:

- `kravon-engine/backend/db/schema.js`: old flat schema.
- `kravon-engine/backend/db/fix_schema.js`: old flat menu table patcher.
- Flat-schema migrations `v9`, `v10-domain`, `v10-column-rename`, `v11-story`, and parts of `v13-dine-in`.
- Inspect/debug scripts that assume public `restaurants` or flat tables.
- `frontend/config/restaurant-config.schema.json`: stale relative to current `/config`.
- `kravon-engine/configs/*.json`: keep only if generated snapshots; otherwise remove as shadow config.
- `presence/assets/js/checkout.js` payment verify path references `/payments/verify`, which is not mounted in current server.
- `orders/assets/js/modal.js` and `tables/assets/js/modal.js` still depend on `ADDONS`/`SPICE_LEVELS`, while `/config` returns empty arrays.

