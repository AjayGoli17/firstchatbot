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
-- calendar_event_id links a PENDING follow-up to its Google Calendar
-- reminder event (see LEVEL_6_Followup_Management), so reschedules/cancels
-- update or delete the same event instead of creating duplicates.
-- If this table already exists from a prior install, run
-- database_migration_002_calendar_event_id.sql instead of this file.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS follow_ups (
    id                  BIGSERIAL PRIMARY KEY,
    lead_id             BIGINT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    due_at              TIMESTAMPTZ NOT NULL,
    attempt_number      INTEGER NOT NULL DEFAULT 1 CHECK (attempt_number >= 1),
    status              TEXT NOT NULL DEFAULT 'PENDING',
    last_notified_at    TIMESTAMPTZ,
    calendar_event_id   TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at        TIMESTAMPTZ,

    CONSTRAINT chk_followups_status CHECK (
        status IN ('PENDING','COMPLETED','CANCELLED')
    )
);

CREATE INDEX IF NOT EXISTS idx_followups_lead_id ON follow_ups(lead_id);
CREATE INDEX IF NOT EXISTS idx_followups_due_status ON follow_ups(status, due_at);
CREATE INDEX IF NOT EXISTS idx_followups_notified ON follow_ups(status, due_at, last_notified_at);

-- Only one PENDING follow-up per lead at a time (prevents duplicate reminders)
CREATE UNIQUE INDEX IF NOT EXISTS uq_followups_one_pending_per_lead
    ON follow_ups(lead_id)
    WHERE status = 'PENDING';

-- ------------------------------------------------------------
-- Table: processed_updates
-- Idempotency guard: LEVEL_3 inserts the Telegram update_id here
-- before doing anything else. A duplicate/retried webhook delivery
-- hits the PK conflict and the workflow stops silently, so the same
-- message can never create two leads, two follow-ups, or two
-- Calendar events.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS processed_updates (
    update_id    BIGINT PRIMARY KEY,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_processed_updates_time ON processed_updates (processed_at);

-- ------------------------------------------------------------
-- Table: pending_actions
-- User and chat scoped: the in-progress intent while a required field is
-- still missing (e.g. "Add CBS School" -> waiting on "service"). Read
-- and cleared by LEVEL_3 on the next message from that user/chat; ignored
-- automatically after 15 minutes so it can never trap a chat forever.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pending_actions (
    chat_id    TEXT NOT NULL,
    user_id    TEXT NOT NULL DEFAULT '',
    command    TEXT NOT NULL,
    parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
    missing    JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chat_id, user_id)
);

-- ------------------------------------------------------------
-- Table: error_log
-- Written by LEVEL_11_Error_Handler, which is wired as the n8n
-- "Error Workflow" (Workflow Settings -> Error Workflow) for every
-- other workflow, so any unhandled node failure lands here and also
-- sends you one friendly Telegram alert instead of a stack trace.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS error_log (
    id             BIGSERIAL PRIMARY KEY,
    workflow_name  TEXT,
    node_name      TEXT,
    error_message  TEXT,
    occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_error_log_time ON error_log (occurred_at);

-- ------------------------------------------------------------
-- Table: standalone_notes (LEVEL 12)
-- Independent personal notes/snippets with strict user isolation.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS standalone_notes (
    id          BIGSERIAL PRIMARY KEY,
    user_id     TEXT NOT NULL,
    content     TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_standalone_notes_user ON standalone_notes(user_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_standalone_notes_updated_at ON standalone_notes;
CREATE TRIGGER trg_standalone_notes_updated_at
    BEFORE UPDATE ON standalone_notes
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- Table: standalone_reminders (LEVEL 13)
-- Independent personal time-based reminders.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS standalone_reminders (
    id                          BIGSERIAL PRIMARY KEY,
    user_id                     TEXT NOT NULL,
    chat_id                     TEXT NOT NULL,
    content                     TEXT NOT NULL,
    reminder_at                 TIMESTAMPTZ NOT NULL,
    status                      TEXT NOT NULL DEFAULT 'PENDING',
    notified_at                 TIMESTAMPTZ,
    google_calendar_event_id    TEXT,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_standalone_reminders_status CHECK (
        status IN ('PENDING','COMPLETED','CANCELLED')
    )
);
CREATE INDEX IF NOT EXISTS idx_standalone_reminders_user_due ON standalone_reminders(user_id, status, reminder_at);
CREATE INDEX IF NOT EXISTS idx_standalone_reminders_due ON standalone_reminders(status, notified_at, reminder_at);
CREATE INDEX IF NOT EXISTS idx_standalone_reminders_gcal ON standalone_reminders(google_calendar_event_id) WHERE google_calendar_event_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_standalone_reminders_updated_at ON standalone_reminders;
CREATE TRIGGER trg_standalone_reminders_updated_at
    BEFORE UPDATE ON standalone_reminders
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- Table: personal_daily_tasks (LEVEL 14)
-- Independent personal daily to-dos and task checklists.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS personal_daily_tasks (
    id              BIGSERIAL PRIMARY KEY,
    user_id         TEXT NOT NULL,
    chat_id         TEXT NOT NULL,
    task_date       DATE NOT NULL DEFAULT CURRENT_DATE,
    content         TEXT NOT NULL,
    priority        TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('HIGH','MEDIUM','LOW')),
    status          TEXT NOT NULL DEFAULT 'PENDING',
    notified_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_personal_daily_tasks_status CHECK (
        status IN ('PENDING','COMPLETED','CANCELLED')
    )
);
CREATE INDEX IF NOT EXISTS idx_personal_daily_tasks_user_date ON personal_daily_tasks(user_id, task_date, priority, status);
CREATE INDEX IF NOT EXISTS idx_personal_daily_tasks_due ON personal_daily_tasks(task_date, status, notified_at);

DROP TRIGGER IF EXISTS trg_personal_daily_tasks_updated_at ON personal_daily_tasks;
CREATE TRIGGER trg_personal_daily_tasks_updated_at
    BEFORE UPDATE ON personal_daily_tasks
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

COMMIT;
