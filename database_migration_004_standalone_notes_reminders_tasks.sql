-- ============================================================
-- Migration 004 — Standalone Notes, Reminders, and Daily Tasks
-- Levels 12, 13, 14
-- Safe to run multiple times (idempotent).
-- Run this against the SAME PostgreSQL database as database_schema.sql.
-- ============================================================

BEGIN;

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
    id              BIGSERIAL PRIMARY KEY,
    user_id         TEXT NOT NULL,
    chat_id         TEXT NOT NULL,
    content         TEXT NOT NULL,
    reminder_at     TIMESTAMPTZ NOT NULL,
    status          TEXT NOT NULL DEFAULT 'PENDING',
    notified_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_standalone_reminders_status CHECK (
        status IN ('PENDING','COMPLETED','CANCELLED')
    )
);

CREATE INDEX IF NOT EXISTS idx_standalone_reminders_user_due ON standalone_reminders(user_id, status, reminder_at);
CREATE INDEX IF NOT EXISTS idx_standalone_reminders_due ON standalone_reminders(status, notified_at, reminder_at);

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
    status          TEXT NOT NULL DEFAULT 'PENDING',
    notified_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_personal_daily_tasks_status CHECK (
        status IN ('PENDING','COMPLETED','CANCELLED')
    )
);

CREATE INDEX IF NOT EXISTS idx_personal_daily_tasks_user_date ON personal_daily_tasks(user_id, task_date, status);
CREATE INDEX IF NOT EXISTS idx_personal_daily_tasks_due ON personal_daily_tasks(task_date, status, notified_at);

DROP TRIGGER IF EXISTS trg_personal_daily_tasks_updated_at ON personal_daily_tasks;
CREATE TRIGGER trg_personal_daily_tasks_updated_at
    BEFORE UPDATE ON personal_daily_tasks
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

COMMIT;
