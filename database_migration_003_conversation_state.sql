-- ============================================================
-- Migration 003 — idempotency, conversation state, error logging
-- Safe to run multiple times (idempotent).
-- Run this against the SAME database as database_schema.sql.
-- ============================================================

BEGIN;

-- Prevents a retried/duplicated Telegram webhook update from being
-- processed twice by LEVEL_3 (e.g. double lead creation, double
-- calendar event creation on a rapid double-send).
CREATE TABLE IF NOT EXISTS processed_updates (
    update_id    BIGINT PRIMARY KEY,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_processed_updates_time ON processed_updates (processed_at);

-- One row per chat: holds the in-progress intent while the AI Router
-- is still waiting on a missing field (e.g. business_name captured,
-- waiting for "service"). Cleared once the action completes or the
-- user cancels; ignored automatically after 15 minutes.
CREATE TABLE IF NOT EXISTS pending_actions (
    chat_id    TEXT PRIMARY KEY,
    command    TEXT NOT NULL,
    parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
    missing    JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Centralized error log written by LEVEL_11_Error_Handler, which is
-- wired as the n8n "Error Workflow" for every other workflow.
CREATE TABLE IF NOT EXISTS error_log (
    id             BIGSERIAL PRIMARY KEY,
    workflow_name  TEXT,
    node_name      TEXT,
    error_message  TEXT,
    occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_error_log_time ON error_log (occurred_at);

COMMIT;
