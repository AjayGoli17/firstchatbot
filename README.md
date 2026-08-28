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

## Setup

1. Create a database (e.g. `freelance_ops`) in your PostgreSQL instance
   (local, Supabase, Neon, Railway, RDS, etc.).
2. Run:
   ```bash
   psql "<your-connection-string>" -f database_schema.sql
   ```
3. Confirm tables exist:
   ```sql
   \dt
   ```
4. Create a PostgreSQL credential in n8n pointing at this database. Use a
   role with only the privileges needed (INSERT/SELECT/UPDATE on these three
   tables) rather than a superuser, if your hosting provider allows it.

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
