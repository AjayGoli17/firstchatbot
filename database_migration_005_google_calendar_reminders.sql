-- ============================================================
-- Migration 005 — Google Calendar Integration for Standalone Reminders
-- Level 13
-- Safe to run multiple times (idempotent).
-- Run this against the SAME PostgreSQL database as database_schema.sql.
-- ============================================================

BEGIN;

-- Add nullable google_calendar_event_id to standalone_reminders
ALTER TABLE standalone_reminders
ADD COLUMN IF NOT EXISTS google_calendar_event_id TEXT;

-- Index for calendar event lookups and cleanup
CREATE INDEX IF NOT EXISTS idx_standalone_reminders_gcal
ON standalone_reminders (google_calendar_event_id)
WHERE google_calendar_event_id IS NOT NULL;

COMMIT;
