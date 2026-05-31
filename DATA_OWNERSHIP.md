# Kravon Data Ownership

Audit date: 2026-05-30

Rule: every business concept below has exactly one canonical owner. Other layers may cache, derive, display, or snapshot it, but must not own it.

## Tenant Identity

| Business concept | Canonical owner | Readers/consumers | Notes |
|---|---|---|---|
| Restaurant tenant id | `tenant.restaurants.id` | All tenant-scoped tables and APIs | Do not expose as `rest_id`; use `tenant_id` externally if needed |
| Restaurant slug | `tenant.restaurants.slug` | URL routing, auth, frontend boot | Unique public tenant identifier |
| Restaurant legal/display name | `tenant.restaurants.name` | `/config.brand.name`, dashboard, public frontend | Do not duplicate in `brand` or settings |
| Tenant status | `tenant.restaurants.status` | admin, route guards | Controls active/suspended lifecycle |
| Commercial plan | `tenant.subscriptions.plan` | admin, billing, entitlement service | `tenant.restaurants.plan` should be derived or removed |
| Tenant domain | `tenant.domains.domain` | tenant middleware | Do not store in `settings.domain` |

## Entitlements and Features

| Business concept | Canonical owner | Readers/consumers | Notes |
|---|---|---|---|
| Product entitlements | Derived from `tenant.subscriptions.plan` plus explicit overrides | `requireFeature`, `/config.capabilities` | Avoid editing feature booleans directly |
| Feature override | `tenant.feature_flags` | entitlement service | Use only for temporary per-tenant overrides |
| Public frontend capabilities | `/config.capabilities` | frontend modules | Derived contract, not storage |
| Legacy product booleans | Transitional only: `tenant.restaurants.has_*` | current `requireFeature` | Remove after entitlement service exists |

## Location and Contact

| Business concept | Canonical owner | Readers/consumers | Notes |
|---|---|---|---|
| Primary location | `tenant.locations` row selected as primary/active | `/config.location`, Presence contact | Add explicit primary marker if multiple active locations exist |
| Address | `tenant.locations.address` | Presence, dashboard settings | Do not store in `settings.address` |
| City/state/country/pincode | `tenant.locations.*` | Presence, SEO, delivery | Do not store in restaurant settings |
| Public phone | `tenant.locations.phone` | `/config.contact.phone` | If per-location phone differs from brand phone, name both concepts explicitly |
| Public email | Proposed: `brand.contact_links` with `platform='email'` or first-class `tenant.locations.email` | `/config.contact.email` | Current `settings.email` is not ideal |
| WhatsApp number/link | `brand.contact_links` with `platform='whatsapp'` | Presence CTA, shared footer | Store normalized URL; derive number for display |
| Google Maps URL | `brand.contact_links` with `platform='maps'` | Presence contact | Do not store as `settings.map_url` |
| Operating hours | `tenant.operating_hours` | `/config.hours` | Derive display strings from structured rows |
| Timezone | `tenant.locations.timezone` | hours, scheduling | Do not store separately in frontend config |

## Brand and Marketing

| Business concept | Canonical owner | Readers/consumers | Notes |
|---|---|---|---|
| Tagline | Proposed: `brand.themes` should not own copy; use `tenant.restaurants.settings.brand_tagline` only if accepted as allowed settings key, or add first-class brand copy table | `/config.brand.tagline`, hero subheadline | Current `brand.seo.meta_description` fallback must stop |
| Brand theme colors/fonts | `brand.themes` | `/config.theme` or `/config.brand.theme` | Frontend should not hardcode tenant colors |
| Logo asset | `brand.assets` where `type='logo'` | header/footer/meta | One active logo per tenant |
| Hero/banner image | `brand.assets` where `type='banner'` | Presence hero, OG optional | Do not duplicate as `hero.image` storage |
| Gallery images | `brand.assets` where `type='gallery'` and `metadata.category` | Presence gallery | Constrain categories |
| SEO metadata | `brand.seo` | HTML meta/OG/Twitter | SEO only, not tagline |
| Announcements/promos | `brand.announcements` | Presence featured/promos | If "featured" differs from announcements, create separate owner |

## Presence Product

Presence is a marketing product. Its public read contract should be a section of `GET /config`, but storage must remain owned by canonical tables.

| Presence concept | Canonical owner | Current duplicate/shadow | Recommended contract field |
|---|---|---|---|
| Hero headline | `tenant.restaurants.name` only if headline is restaurant name; otherwise add dedicated brand copy owner | `presence.hero.headline`, dashboard writes name | `presence.hero.headline` derived |
| Hero subheadline | Dedicated brand/presence copy owner required | `settings.tagline`, `brand.seo.meta_description`, `brand.tagline` | `presence.hero.subheadline` |
| Hero image | `brand.assets(type='banner')` | `hero.image` derived | `presence.hero.image` |
| Story title | Dedicated Presence copy owner required; transitional `settings.story_headline` | `settings.story_headline`, v11 flat column history | `presence.story.title` |
| Story body | Dedicated Presence copy owner required; transitional `settings.story_body` | `settings.story_body` | `presence.story.body` |
| Story facts | Dedicated Presence copy owner required; transitional `settings.story_facts` | `settings.story_facts` | `presence.story.facts` |
| Signature dishes | Prefer `menu.menu_items` with curated metadata or a dedicated marketing collection | `settings.signature_dishes` | `presence.signatureDishes` |
| Gallery | `brand.assets(type='gallery')` | `presence.gallery` derived | `presence.gallery` |
| Featured cards | `brand.announcements` if these are promos/events | `presence.featured` derived | `presence.featured` |
| Timeline | Dedicated Presence copy owner required; transitional `settings.timeline` | `settings.timeline` | `presence.timeline` |
| Contact block | `tenant.locations` plus `brand.contact_links` | `settings.email`, `settings.map_url`, `settings.phone` fallbacks | `presence.contact` |

## Menu and Item Customization

| Business concept | Canonical owner | Readers/consumers | Notes |
|---|---|---|---|
| Menu collection | `menu.menus` | dashboard menu, config | Create a primary menu per tenant/location |
| Category | `menu.categories` | config, dashboard, frontend | Keep `description`, `position`, `is_active` names consistently |
| Menu item | `menu.menu_items` | orders, tables, presence, dashboard | Use v12 names only |
| Item base price | `menu.menu_items.price` | order service, renderer | Money unit must be documented as rupees decimal or paise integer, not both |
| Variant price | `menu.item_variants.price` | customization modal/order validation | Required when `has_variants=true` |
| Item availability | `menu.menu_items.is_available` plus optional `menu.item_availability` schedule | menu route/order service | Clarify immediate toggle vs scheduled availability |
| Customization groups/options | `menu.customization_groups`, `menu.customization_options` | modal/order service | Remove global `ADDONS` and `SPICE_LEVELS`; model them as customization groups |
| Food type | `menu.menu_items.food_type`, variant/option food type where needed | menu UI | Enum must be documented once |
| Tags/allergens/calories/prep time | `menu.menu_items` | UI/filters/future | Keep optional |

## Orders and Payments

| Business concept | Canonical owner | Readers/consumers | Notes |
|---|---|---|---|
| Order header | `orders.orders` | dashboard orders, insights, webhooks | No public `orders` table |
| Order line item | `orders.order_items` | kitchen/bill/history | Snapshot item names/prices here |
| Order customization | `orders.order_item_customizations` | kitchen/bill/history | Do not hide customizations only in metadata |
| Customer snapshot | `orders.orders.metadata.customer_*` only if intentionally historical | order detail | If frequently queried, add first-class snapshot columns |
| Fulfillment type | `orders.orders.fulfillment_type` | orders/tables/dine-in | Values: delivery, pickup, dine_in, etc. |
| Delivery charges | `orders.orders.delivery_charge` | checkout, insights | Config owner should be delivery settings, not order row |
| Tax amount | `orders.orders.tax_amount` plus `orders.order_taxes` | order service | Tax rules own calculation |
| Payment record | `payments.payments` | webhooks, dashboard | Do not store payment state only in order metadata |
| Payment events | `payments.payment_events` | webhook audit | Store raw provider payload here |
| Razorpay tenant keys | `tenant.integrations(provider='razorpay').config` | payment integration | Remove settings fallbacks |

## Dining and Reservations

| Business concept | Canonical owner | Readers/consumers | Notes |
|---|---|---|---|
| Dining table | `dining.tables` | QR/session routes | Keep QR code here or derive from table id and slug |
| Open session | `dining.sessions` | QR order flow/kitchen/bill | Link orders by `orders.orders.session_id` |
| Reservation | `dining.reservations` | public reservation form/dashboard future | Customer profile is optional but preferred |
| Waitlist | `dining.waitlist` | future tables product | Keep if product is planned |
| Dining review | `dining.reviews` | review route | Merge or distinguish from `customer.feedback` |
| Review threshold | Proposed: `tenant.restaurants.settings.review_threshold` allowed key, or dining review config table | reviews route/config | Current settings fallback is acceptable only if documented |
| Google review URL | `brand.contact_links(platform='google_review')` or review config | review redirect | Do not keep in generic settings forever |

## Catering

| Business concept | Canonical owner | Readers/consumers | Notes |
|---|---|---|---|
| Catering public page content | Dedicated owner required; transitional `tenant.restaurants.settings.catering` | catering frontend | Current settings blob is a shadow CMS |
| Catering enquiry form schema | `catering.enquiry_forms` | catering frontend | Frontend should render from this, not settings |
| Catering lead | `catering.leads` | lead service, insights | Keep |
| Lead note | `catering.lead_notes` | dashboard future | Keep |
| Catering event | `catering.events` | future CRM | Keep if roadmap |
| Event day | `catering.event_days` | future CRM | Keep if roadmap |
| Quote | `catering.quotes` | future CRM | Keep if roadmap |
| Quote line | `catering.quote_items` | future CRM | Keep if roadmap |
| Catering package | `catering.packages` | frontend/dashboard future | Move package content here |
| Package items | `catering.package_items` | package composition | Keep |

## Customers and Analytics

| Business concept | Canonical owner | Readers/consumers | Notes |
|---|---|---|---|
| Customer profile | `customer.customers` | orders/reservations/leads | Keep |
| Customer address | `customer.addresses` | delivery | Use instead of loose delivery address when user account exists |
| Loyalty balance | `customer.loyalty_accounts` | future loyalty | Keep if planned |
| Loyalty ledger | `customer.loyalty_transactions` | future loyalty | Keep |
| General feedback | Choose one: `customer.feedback` or `dining.reviews` | reviews/CRM | Do not keep overlapping review systems |
| Customer interaction | `customer.interaction_log` | insights/CRM | Keep if events are emitted |
| Daily metrics | `insights.daily_metrics` | insights dashboard | Either populate or compute live, not both without policy |
| Item performance | `insights.item_performance` | insights dashboard | Same |
| Review summary | `insights.review_summary` | config/insights future | Same |
| Analytics events | Choose `insights.events` for analytics | tracking | Do not duplicate with platform event outbox |

## Platform and Operations

| Business concept | Canonical owner | Readers/consumers | Notes |
|---|---|---|---|
| Outbox event | `platform.event_outbox` | webhook dispatcher | Operational delivery queue |
| Audit event | `platform.audit_log` | admin/security | Write all admin mutations here |
| Webhook config | Choose `platform.webhooks` | webhook dispatcher | Remove `tenant.integrations(provider='webhook')` or use integrations only for providers |
| Webhook delivery attempt | `platform.webhook_deliveries` | ops/debug | Keep with webhook config |
| Notification template | `platform.notification_templates` | notify service | Wire notify service |
| Notification send | `platform.notifications` | notify service | Record every send |
| Notification engagement | `platform.notification_engagement` | provider callbacks | Keep |
| Usage event | `platform.usage_events` | billing | Keep if subscriptions use it |
| Usage ledger | `platform.usage_ledger` | billing | Keep |
| Tenant API key | `platform.api_keys` | external API | Keep |
| Inventory item | `inventory.items` | inventory module future | Keep only if module is planned |
| Inventory movement | `inventory.movements` | inventory module future | Keep only if module is planned |

## Derived Contracts

These are not owners. They should be generated from owners above.

| Derived contract | Source owners | Consumers |
|---|---|---|
| `GET /config` | tenant, brand, menu, integrations, locations, hours, product entitlements | public frontend modules |
| `/config.capabilities` | subscription/entitlement service | frontend routing/CTAs |
| `/config.contact` | locations + contact links | public frontend |
| `/config.hours` | operating hours | public frontend |
| `/config.menu` | menu tables | public frontend |
| `/config.presence` or current top-level Presence sections | brand assets, announcements, Presence copy owner, locations/contact links | Presence frontend |
| Dashboard view models | API read endpoints | dashboard |

## Explicit Non-Owners

The following must not own business data:

- HTML placeholders.
- Frontend constants.
- `window.CONFIG` and other browser globals.
- Static files under `kravon-engine/configs` unless they are generated read-only snapshots.
- `README.md`, `STATUS.txt`, `DEV_HANDOFF.txt`.
- Seed files after initial load.
- Order metadata except for deliberately historical snapshots.
- Environment variables except secrets/runtime/platform configuration.

