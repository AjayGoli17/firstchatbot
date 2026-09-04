-- ============================================================
-- Migration 006: Task Priority, Notification State & Pending Actions Scoping
-- ============================================================

BEGIN;

-- 1. Add priority column to personal_daily_tasks
ALTER TABLE personal_daily_tasks
ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('HIGH','MEDIUM','LOW'));

CREATE INDEX IF NOT EXISTS idx_personal_daily_tasks_priority ON personal_daily_tasks(user_id, task_date, priority);

-- 2. Add last_notified_at to follow_ups
ALTER TABLE follow_ups
ADD COLUMN IF NOT EXISTS last_notified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_followups_notified ON follow_ups(status, due_at, last_notified_at);

-- 3. Add user_id to pending_actions if not present
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'pending_actions' AND column_name = 'user_id'
    ) THEN
        ALTER TABLE pending_actions ADD COLUMN user_id TEXT NOT NULL DEFAULT '';
        ALTER TABLE pending_actions DROP CONSTRAINT IF EXISTS pending_actions_pkey;
        ALTER TABLE pending_actions ADD PRIMARY KEY (chat_id, user_id);
    END IF;
END $$;

COMMIT;
