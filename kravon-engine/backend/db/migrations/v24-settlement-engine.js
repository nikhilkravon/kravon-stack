/**
 * MIGRATION — v24-settlement-engine.js
 *
 * Creates the billing.settlements sub-schema:
 *
 *   billing.settlements          — one per session (or catering lead), lifecycle header
 *   billing.settlement_lines     — every billable row (immutable once finalized)
 *   billing.settlement_revisions — append-only change history
 *   billing.invoices             — read-only fiscal documents generated from settlements
 *   billing.payments             — one or many payments against a settlement
 *
 * Design principles:
 *   - Orders are NEVER modified by this schema.
 *   - Amounts stored as INTEGER PAISE (paise = 1/100 rupee) to avoid float drift.
 *   - Settlements are immutable once status = 'finalized'.
 *   - Invoices are generated from finalized settlements and are never edited.
 *   - All tables are tenant-scoped.
 *
 * Idempotent — safe to re-run.
 * Usage: node db/migrations/v24-settlement-engine.js
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { getClient } = require('../pool');

const STEPS = [

  ['Create billing schema',
    `CREATE SCHEMA IF NOT EXISTS billing`],

  // ── billing.settlements ─────────────────────────────────────────────────────
  ['Create billing.settlements',
    `CREATE TABLE IF NOT EXISTS billing.settlements (
       id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       tenant_id       UUID NOT NULL,

       -- Source context — exactly one must be non-null
       session_id      UUID,          -- dining.sessions.id
       order_id        UUID,          -- orders.orders.id (delivery/pickup)
       lead_id         UUID,          -- catering.leads.id

       -- Lifecycle
       -- draft → open → finalized → (voided)
       status          TEXT NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','open','finalized','voided')),

       -- Financial summary (denormalised from lines, recalculated on every line change)
       -- All amounts in PAISE (integer)
       subtotal_paise        INTEGER NOT NULL DEFAULT 0,
       discount_paise        INTEGER NOT NULL DEFAULT 0,
       service_charge_paise  INTEGER NOT NULL DEFAULT 0,
       packaging_paise       INTEGER NOT NULL DEFAULT 0,
       tax_paise             INTEGER NOT NULL DEFAULT 0,
       tip_paise             INTEGER NOT NULL DEFAULT 0,
       round_off_paise       INTEGER NOT NULL DEFAULT 0,
       total_paise           INTEGER NOT NULL DEFAULT 0,
       paid_paise            INTEGER NOT NULL DEFAULT 0,

       -- GST snapshot at time of finalization
       gst_snapshot    JSONB,

       -- Notes / reference
       notes           TEXT,
       internal_ref    TEXT,

       -- Who created / finalized it
       created_by      UUID,
       finalized_by    UUID,
       voided_by       UUID,
       void_reason     TEXT,

       finalized_at    TIMESTAMPTZ,
       voided_at       TIMESTAMPTZ,
       created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       deleted_at      TIMESTAMPTZ
     )`],

  ['settlements: tenant index',
    `CREATE INDEX IF NOT EXISTS idx_settlements_tenant
     ON billing.settlements(tenant_id, status, created_at DESC)
     WHERE deleted_at IS NULL`],

  ['settlements: session index',
    `CREATE INDEX IF NOT EXISTS idx_settlements_session
     ON billing.settlements(session_id)
     WHERE session_id IS NOT NULL AND deleted_at IS NULL`],

  ['settlements: order index',
    `CREATE INDEX IF NOT EXISTS idx_settlements_order
     ON billing.settlements(order_id)
     WHERE order_id IS NOT NULL AND deleted_at IS NULL`],

  // ── billing.settlement_lines ────────────────────────────────────────────────
  ['Create billing.settlement_lines',
    `CREATE TABLE IF NOT EXISTS billing.settlement_lines (
       id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       tenant_id       UUID NOT NULL,
       settlement_id   UUID NOT NULL REFERENCES billing.settlements(id),

       -- Line classification
       line_type       TEXT NOT NULL
                       CHECK (line_type IN (
                         'ORDER_ITEM',
                         'MANUAL_ITEM',
                         'PRICE_OVERRIDE',
                         'DISCOUNT',
                         'COMPLIMENTARY_ITEM',
                         'SERVICE_CHARGE',
                         'DELIVERY_CHARGE',
                         'PACKAGING',
                         'TAX',
                         'ROUND_OFF',
                         'TIP',
                         'ADJUSTMENT'
                       )),

       -- Source reference (nullable — set for ORDER_ITEM lines)
       source_order_id      UUID,
       source_order_item_id UUID,

       -- Display
       description     TEXT NOT NULL,

       -- Quantities and pricing (PAISE)
       quantity        NUMERIC(10,3) NOT NULL DEFAULT 1,
       unit_price_paise INTEGER,          -- null for percentage lines
       amount_paise    INTEGER NOT NULL,  -- final line amount (may be negative for discounts)

       -- Percentage-based lines (discounts, service charges, taxes)
       percent         NUMERIC(6,4),      -- e.g. 0.09 for 9%
       applies_to      TEXT,             -- 'subtotal' | 'line:uuid'

       -- Tax metadata
       tax_name        TEXT,             -- 'CGST' | 'SGST' | 'IGST'
       tax_rate        NUMERIC(6,4),

       -- Complimentary / voided
       is_comp         BOOLEAN NOT NULL DEFAULT FALSE,
       comp_reason     TEXT,

       -- Sort order for display
       sort_order      INTEGER NOT NULL DEFAULT 0,

       -- Soft-delete (removing a line marks it deleted; never physically removed)
       deleted_at      TIMESTAMPTZ,
       created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`],

  ['settlement_lines: settlement FK index',
    `CREATE INDEX IF NOT EXISTS idx_settlement_lines_settlement
     ON billing.settlement_lines(settlement_id)
     WHERE deleted_at IS NULL`],

  // ── billing.settlement_revisions ────────────────────────────────────────────
  ['Create billing.settlement_revisions',
    `CREATE TABLE IF NOT EXISTS billing.settlement_revisions (
       id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       tenant_id       UUID NOT NULL,
       settlement_id   UUID NOT NULL REFERENCES billing.settlements(id),

       revision_number INTEGER NOT NULL,
       actor_id        UUID,            -- tenant.staff.id
       actor_type      TEXT NOT NULL DEFAULT 'staff',

       -- What changed
       change_type     TEXT NOT NULL,  -- 'line_add' | 'line_remove' | 'line_edit' | 'status_change' | 'note_change'
       line_id         UUID,           -- which line was affected (nullable for header changes)
       before_state    JSONB,
       after_state     JSONB,
       reason          TEXT,

       created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`],

  ['settlement_revisions: settlement index',
    `CREATE INDEX IF NOT EXISTS idx_settlement_revisions_settlement
     ON billing.settlement_revisions(settlement_id, revision_number)`],

  ['settlement_revisions: unique revision per settlement',
    `CREATE UNIQUE INDEX IF NOT EXISTS uidx_settlement_revisions_number
     ON billing.settlement_revisions(settlement_id, revision_number)`],

  // ── billing.invoices ─────────────────────────────────────────────────────────
  ['Create billing.invoices',
    `CREATE TABLE IF NOT EXISTS billing.invoices (
       id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       tenant_id       UUID NOT NULL,
       settlement_id   UUID NOT NULL REFERENCES billing.settlements(id),

       -- Monotonically increasing invoice number per tenant
       invoice_number  TEXT NOT NULL,

       -- Complete fiscal snapshot (never changes after generation)
       snapshot        JSONB NOT NULL,

       -- Version (if settlement is reopened and re-finalized, a new invoice is issued)
       version         INTEGER NOT NULL DEFAULT 1,

       generated_by    UUID,
       generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`],

  ['invoices: settlement index',
    `CREATE INDEX IF NOT EXISTS idx_invoices_settlement
     ON billing.invoices(settlement_id)`],

  ['invoices: tenant + number index',
    `CREATE INDEX IF NOT EXISTS idx_invoices_tenant_number
     ON billing.invoices(tenant_id, invoice_number)`],

  // Invoice number sequence per tenant (uses a simple counter in platform.settings
  // to avoid cross-tenant sequence conflicts)
  ['Create billing.invoice_counters',
    `CREATE TABLE IF NOT EXISTS billing.invoice_counters (
       tenant_id   UUID PRIMARY KEY,
       last_number INTEGER NOT NULL DEFAULT 0
     )`],

  // ── billing.payments ─────────────────────────────────────────────────────────
  ['Create billing.payments',
    `CREATE TABLE IF NOT EXISTS billing.payments (
       id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       tenant_id       UUID NOT NULL,
       settlement_id   UUID NOT NULL REFERENCES billing.settlements(id),

       method          TEXT NOT NULL
                       CHECK (method IN ('cash','card','upi','wallet','advance','other')),
       amount_paise    INTEGER NOT NULL CHECK (amount_paise > 0),
       reference       TEXT,           -- UPI transaction id, card last4, etc.
       notes           TEXT,

       recorded_by     UUID,
       recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`],

  ['payments: settlement index',
    `CREATE INDEX IF NOT EXISTS idx_payments_settlement
     ON billing.payments(settlement_id)`],

];

(async () => {
  console.log('Running V24 migration (settlement engine)...\n');
  const client = await getClient();
  try {
    await client.query('BEGIN');
    for (const [label, sql] of STEPS) {
      try {
        await client.query(sql);
        console.log(`  ✓ ${label}`);
      } catch (err) {
        console.error(`  ✗ ${label}: ${err.message}`);
        throw err;
      }
    }
    await client.query('COMMIT');
    console.log('\n  ✓ All steps applied.\n');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\nV24 FAILED — rolled back.');
    console.error(err.message);
    client.release();
    process.exit(1);
  }
  try {
    await client.query(
      `INSERT INTO platform.schema_migrations (version, name)
       VALUES ('v24', 'settlement-engine')
       ON CONFLICT (version) DO NOTHING`
    );
    console.log('  ✓ Recorded in platform.schema_migrations');
  } catch (err) {
    console.warn('  ! Could not record in schema_migrations:', err.message);
  }
  client.release();
  console.log('\nV24 complete.');
  process.exit(0);
})();
