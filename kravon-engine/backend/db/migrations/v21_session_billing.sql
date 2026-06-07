-- ============================================================
-- MIGRATION v21 — Session billing: identity, state, bill request
-- ============================================================

-- 1. Bill owner + bill-request tracking on sessions
ALTER TABLE dining.sessions
    ADD COLUMN bill_owner_name     TEXT,
    ADD COLUMN bill_owner_phone    TEXT,
    ADD COLUMN bill_requested_at   TIMESTAMPTZ,
    ADD COLUMN bill_requested_by   TEXT,   -- first name of requester, for display
    ADD COLUMN session_status      TEXT NOT NULL DEFAULT 'open'
        CHECK (session_status IN ('open', 'bill_requested', 'closed', 'paid'));

-- Index for dashboard polling: quickly find sessions with pending bill requests
CREATE INDEX idx_sessions_bill_requested
    ON dining.sessions(tenant_id, bill_requested_at)
    WHERE bill_requested_at IS NOT NULL AND closed_at IS NULL AND deleted_at IS NULL;

-- 2. Per-order guest identity for dine-in (name + phone stored on order metadata)
--    Already in metadata JSONB — no schema change needed. We'll store as:
--    metadata->>'guest_name', metadata->>'guest_phone'
