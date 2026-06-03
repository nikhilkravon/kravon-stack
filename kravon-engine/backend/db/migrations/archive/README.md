# Migration Archive

These migrations are historical. They were applied incrementally to bring the
database from its initial state to the V20 baseline.

**Do not run these against a V20+ database.** All changes they contain are
fully absorbed into `kravon_schema_v20.sql`.

| File | What it did |
|------|-------------|
| v9-tables.js | Added reviews table, has_tables/delivery columns, order_surface |
| v10-column-rename.js | Renamed restaurant_id → tenant_id, price → price_paise, etc. |
| v10-domain.js | Added custom domain support |
| v11-story.js | Added story_headline, story_body, story_facts, map_url |
| v13-dine-in.js | Linked orders to dining sessions, added deleted_at on orders |
| v14-staff-password.js | Added password_hash to tenant.staff |
| v15-plan.js | Converted plan column from ENUM to VARCHAR(20) with tier values |
| v16-presence-content.js | Added image_url to brand.announcements |
| v17-razorpay-idempotency.js | Added functional indexes on metadata Razorpay fields |
| v18-governance.js | Added consent_history, export_jobs, customer_data_requests, benchmarks |
| v19-notifications.js | Added notifications schema, notifications table, notification_preferences |
| kravon_schema_v12.sql | Previous canonical schema (superseded by kravon_schema_v20.sql) |
