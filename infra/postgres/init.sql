-- Initial schema for the events database.
-- Extended with queue, idempotency and DLQ structures.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type            TEXT NOT NULL,
    payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
    tenant_id       TEXT,
    event_id        UUID,
    status          TEXT NOT NULL DEFAULT 'pending',
    attempt_count   INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lease_until     TIMESTAMPTZ,
    last_error      TEXT,
    processed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE events ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS event_id UUID;
ALTER TABLE events ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE events ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE events ADD COLUMN IF NOT EXISTS lease_until TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS idempotency_keys (
    tenant_id     TEXT NOT NULL,
    event_id      UUID NOT NULL,
    state         TEXT NOT NULL DEFAULT 'pending',
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, event_id)
);

CREATE TABLE IF NOT EXISTS dlq_events (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      TEXT NOT NULL,
    event_id       UUID NOT NULL,
    type           TEXT NOT NULL,
    payload        JSONB NOT NULL,
    attempt_count  INTEGER NOT NULL,
    failure_reason TEXT NOT NULL,
    moved_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_status_next_attempt
  ON events (status, next_attempt_at);

CREATE INDEX IF NOT EXISTS idx_events_lease_until
  ON events (lease_until);

CREATE INDEX IF NOT EXISTS idx_events_tenant_event
  ON events (tenant_id, event_id);

CREATE INDEX IF NOT EXISTS idx_dlq_events_moved_at
  ON dlq_events (moved_at DESC);
