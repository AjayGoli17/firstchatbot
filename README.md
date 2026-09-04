# Database — Personal Freelance Operations Assistant V1

PostgreSQL is the single source of truth. No AI component ever writes to it
directly — n8n workflows execute all validated SQL.

## Tables

### `leads`
One row per lead/client. `status` is constrained to:
`NEW, CONTACTED, REPLIED, QUALIFIED, PROPOSAL_SENT, NEGOTIATION, WON, LOST`.

`won_at` is stamped once, only when a status change to `WON` is approved
(see `LEVEL_10_Human_Approval`'s "Apply Approved Change" node). Revenue
analytics (`LEVEL_9`) reports off this column rather than `updated_at`, so a
later note or interaction logged against an already-won lead doesn't get
miscounted as revenue in the month it was touched.

`business_name` has a unique constraint (case-sensitive at the DB level;
duplicate checking in the n8n workflow does a case-insensitive lookup first
so near-duplicates are caught before insert).

### `interactions`
Append-only log of everything that happened with a lead.
`interaction_type` is constrained to:
`CONTACT, REPLY, NOTE, CALL, MEETING, PROPOSAL, OTHER`.

### `follow_ups`
Tracks reminders. `status` is constrained to `PENDING, COMPLETED, CANCELLED`.
A **partial unique index** (`uq_followups_one_pending_per_lead`) guarantees a
lead can never have more than one `PENDING` follow-up at once — this is the
mechanism that prevents duplicate reminders, instead of relying on n8n Wait
nodes or in-memory state.

### `standalone_notes` (LEVEL 12)
Stores independent personal notes and snippets isolated by `user_id`.

### `standalone_reminders` (LEVEL 13)
Stores independent personal reminders with `reminder_at`, `status`, `notified_at`, and `google_calendar_event_id` for two-way synchronization with Google Calendar.

### `personal_daily_tasks` (LEVEL 14)
Stores personal daily to-dos and checklist items isolated by `user_id` and `task_date`.

## Google Calendar Integration (Level 13)

Level 13 Standalone Reminders is integrated with Google Calendar via n8n's Google Calendar OAuth2 node:

1. **Google Calendar OAuth2 credential**: Configure a `googleCalendarOAuth2Api` credential named `"Google Calendar account"` in n8n.
2. **Primary Calendar**: Events are synchronized to the user's primary Google Calendar by default.
3. **Event Format**:
   - **Summary**: Reminder text/content
   - **Description**: `"Created by Nexo Telegram Bot"`
   - **Start**: `reminder_at` timestamp (Timezone: `Asia/Kolkata` / GMT+05:30)
   - **End**: 5 minutes after `reminder_at`
4. **Resilience & Fallback**: If Google Calendar synchronization fails, the PostgreSQL reminder is still saved, and a warning note is returned to Telegram.
5. **Scheduler Independence**: The Level 13 Telegram Reminder Scheduler continues to notify users independently via Telegram without creating duplicate calendar events.
6. **Deletion Sync**: Deleting a reminder (`DELETE_REMINDER` or `DELETE_ALL_REMINDERS`) automatically deletes the corresponding event from Google Calendar if `google_calendar_event_id` exists.

## Setup & Migrations

1. Create a database (e.g. `freelance_ops`) in your PostgreSQL instance
   (local, Supabase, Neon, Railway, RDS, etc.).
2. For fresh databases, run the complete schema:
   ```bash
   psql "<your-connection-string>" -f database_schema.sql
   ```
3. For existing deployments, apply migrations in sequence:
   ```bash
   psql "<your-connection-string>" -f database_migration_003_conversation_state.sql
   psql "<your-connection-string>" -f database_migration_004_standalone_notes_reminders_tasks.sql
   psql "<your-connection-string>" -f database_migration_005_google_calendar_reminders.sql
   ```
4. Create n8n credentials for PostgreSQL (`postgres`), Telegram (`telegramApi`), and Google Calendar (`googleCalendarOAuth2Api`).

## Notes on design choices

- `BIGSERIAL` ids — simple, sortable, sufficient for a single-user tool.
- `TIMESTAMPTZ` everywhere — avoids timezone ambiguity between your local
  time and n8n Cloud's server time.
- `CHECK` constraints enforce the allowed enum-like values directly in the
  database, so even if the AI or a workflow bug produces a bad value, the
  insert/update fails safely rather than corrupting data.
- `ON DELETE CASCADE` on `interactions.lead_id` and `follow_ups.lead_id` —
  deleting a lead cleans up its history. (V1 does not expose a "delete lead"
  command, but the constraint keeps the schema consistent if you ever add
  one manually.)
