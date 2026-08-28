# Fixes Applied

Changes made to the original V1 build after a correctness review. Nothing
here changes the architecture or command set — these are bug fixes only.

## 1. Approval callback_data collided with ISO timestamp colons (critical)
**Files:** `LEVEL_10_Human_Approval.json`

The Approve/Reject callback_data was built as
`appr:<leadId>:<field>:<newValue>:<isoTimestamp>:<A|R>` and parsed with
`split(':')`. Since `isoTimestamp` (e.g. `2026-08-27T14:05:30.123Z`) itself
contains colons, splitting shattered the string into extra fragments,
scrambling the parsed version and decision fields. In practice this made
the staleness check fail every time, so every Approve/Reject tap was
rejected as "record changed, please retry" — the approval flow could never
actually complete.

**Fix:** strip colons out of the timestamp before it goes into
callback_data (`Build Approval Request`), and re-insert them when parsing
(`Parse Approval Callback`), so the reconstructed value is a valid ISO
timestamp again for the staleness comparison and the SQL parameter.

## 2. Multi-statement parameterized query would fail against Postgres
**Files:** `LEVEL_7_Followup_Callback.json`

"Create Next Followup" ran `UPDATE ...; INSERT ...` as one parameterized
query string. Postgres's extended query protocol (what parameterized
queries use) only permits a single statement per call — this would throw
"cannot insert multiple commands into a prepared statement" at runtime.

**Fix:** combined into a single statement using a CTE
(`WITH cancelled AS (UPDATE ... RETURNING lead_id) INSERT ... SELECT ...
FROM cancelled`), which does both writes atomically in one call.

## 3. Daily Priorities chatId lookup could throw
**Files:** `LEVEL_8_Daily_Priorities.json`

"Format Daily Priorities" resolved chatId with
`$('Resolve Chat Id (Morning)').first() ? ... : ...`. Referencing a node
that didn't execute in the current run (e.g. the Morning branch, when the
workflow was triggered on-demand instead of by the 8am schedule) throws in
n8n rather than evaluating to a falsy value — breaking the on-demand
"what should I focus on today" command.

**Fix:** wrapped each node lookup in try/catch so an un-executed branch
returns `undefined` instead of throwing, then falls back to the other
resolver.

## 4. Revenue analytics keyed off `updated_at` instead of a real "won" date
**Files:** `database_schema.sql`, `LEVEL_10_Human_Approval.json`,
`LEVEL_9_Analytics.json`

"Revenue this month" filtered `WON` leads by `updated_at >=
date_trunc('month', now())`. But `updated_at` bumps on *any* edit to the
lead row (logging an interaction, adding a note, editing a field) — so a
deal won in June could show up as this month's revenue just because it got
touched again in August.

**Fix:** added a `won_at TIMESTAMPTZ` column to `leads`, stamped once by
`LEVEL_10`'s "Apply Approved Change" node only when a status change to
`WON` is approved. `LEVEL_9`'s revenue query now filters on `won_at`
instead of `updated_at`.

**If you already ran the original `database_schema.sql`:** run this against
your existing database instead of re-running the whole file:
```sql
ALTER TABLE leads ADD COLUMN IF NOT EXISTS won_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_leads_won_at ON leads(won_at);
```

## 5. Cosmetic: literal `\n` in the test bot's echo message
**Files:** `LEVEL_2_Telegram_Test.json`

The echo message used `\\n` (a literal backslash followed by "n"), which
n8n's expression text doesn't unescape into a line break — so it printed
as visible `\n` rather than a newline. Test-only workflow, no functional
impact. Fixed to use an actual newline.
