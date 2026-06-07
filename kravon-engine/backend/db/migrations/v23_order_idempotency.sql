-- v23: order idempotency key
-- Prevents duplicate orders from double-tap / network retry.
-- Client generates a UUID before submission and sends it as the
-- Idempotency-Key header. The service writes it here; a duplicate
-- key returns the existing order instead of creating a new one.

ALTER TABLE orders.orders
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency
  ON orders.orders (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND deleted_at IS NULL;

INSERT INTO platform.schema_migrations (version, description)
VALUES ('v23', 'order-idempotency-key')
ON CONFLICT (version) DO NOTHING;
