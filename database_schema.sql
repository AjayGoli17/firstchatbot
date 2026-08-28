-- ============================================================
-- Personal Freelance Operations Assistant V1 — Database Schema
-- PostgreSQL 13+
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- Extensions
-- ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for gen_random_uuid() if ever needed

-- ------------------------------------------------------------
-- Function: auto-update updated_at
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- Table: leads
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leads (
    id                  BIGSERIAL PRIMARY KEY,
    business_name       TEXT NOT NULL,
    contact_name        TEXT,
    email               TEXT,
    phone               TEXT,
    service             TEXT,
    status              TEXT NOT NULL DEFAULT 'NEW',
    deal_value          NUMERIC(14,2) DEFAULT 0 CHECK (deal_value >= 0),
    currency            TEXT NOT NULL DEFAULT 'INR',
    last_contact_at     TIMESTAMPTZ,
    next_follow_up_at   TIMESTAMPTZ,
    won_at              TIMESTAMPTZ,
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_leads_status CHECK (
        status IN ('NEW','CONTACTED','REPLIED','QUALIFIED','PROPOSAL_SENT','NEGOTIATION','WON','LOST')
    ),
    -- Prevent obvious accidental duplicates: same business name (case-insensitive)
    CONSTRAINT uq_leads_business_name UNIQUE (business_name)
);

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_next_follow_up_at ON leads(next_follow_up_at);
CREATE INDEX IF NOT EXISTS idx_leads_business_name_lower ON leads (LOWER(business_name));
CREATE INDEX IF NOT EXISTS idx_leads_won_at ON leads(won_at);

DROP TRIGGER IF EXISTS trg_leads_updated_at ON leads;
CREATE TRIGGER trg_leads_updated_at
    BEFORE UPDATE ON leads
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- Table: interactions
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS interactions (
    id                  BIGSERIAL PRIMARY KEY,
    lead_id             BIGINT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    interaction_type    TEXT NOT NULL,
    content              TEXT,
    interaction_date    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_interactions_type CHECK (
        interaction_type IN ('CONTACT','REPLY','NOTE','CALL','MEETING','PROPOSAL','OTHER')
    )
);

CREATE INDEX IF NOT EXISTS idx_interactions_lead_id ON interactions(lead_id);
CREATE INDEX IF NOT EXISTS idx_interactions_date ON interactions(interaction_date);

-- ------------------------------------------------------------
-- Table: follow_ups
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS follow_ups (
    id                  BIGSERIAL PRIMARY KEY,
    lead_id             BIGINT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    due_at              TIMESTAMPTZ NOT NULL,
    attempt_number      INTEGER NOT NULL DEFAULT 1 CHECK (attempt_number >= 1),
    status              TEXT NOT NULL DEFAULT 'PENDING',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at        TIMESTAMPTZ,

    CONSTRAINT chk_followups_status CHECK (
        status IN ('PENDING','COMPLETED','CANCELLED')
    )
);

CREATE INDEX IF NOT EXISTS idx_followups_lead_id ON follow_ups(lead_id);
CREATE INDEX IF NOT EXISTS idx_followups_due_status ON follow_ups(status, due_at);

-- Only one PENDING follow-up per lead at a time (prevents duplicate reminders)
CREATE UNIQUE INDEX IF NOT EXISTS uq_followups_one_pending_per_lead
    ON follow_ups(lead_id)
    WHERE status = 'PENDING';

COMMIT;
