# Final Testing — V1

None of these were run against a live n8n/Telegram/PostgreSQL stack (no
live credentials exist in this build environment), so every row is marked
**REQUIRES MANUAL TEST**. The "Expected Result" column describes the
designed behavior to verify against.

| # | Test | Input (example) | Expected Result | Pass/Fail |
|---|------|------|------|------|
| 1 | Add lead | "Add ABC School as a ₹25,000 website lead" | New row in `leads`, status `NEW`, confirmation message | REQUIRES MANUAL TEST |
| 2 | List leads | "Show my active leads" | Telegram list of non-WON/LOST leads | REQUIRES MANUAL TEST |
| 3 | Get lead | "Show ABC School" | Full lead detail card | REQUIRES MANUAL TEST |
| 4 | Update lead | "Update ABC School's email to x@y.com" | Only email column changes | REQUIRES MANUAL TEST |
| 5 | Change status | "Move ABC School to proposal" | Status → `PROPOSAL_SENT` directly (no approval needed) | REQUIRES MANUAL TEST |
| 6 | Change deal value | "Change ABC School value to ₹35,000" | If change ≤30%, direct update; if >30%, approval flow triggers instead | REQUIRES MANUAL TEST |
| 7 | Record interaction | "I contacted ABC School today" | Interaction row inserted, `last_contact_at` updated, follow-up created for +3 days | REQUIRES MANUAL TEST |
| 8 | Add note | "ABC School needs the website before October" | Note row inserted, no status/date side effects | REQUIRES MANUAL TEST |
| 9 | Get history | "Show ABC School history" | Chronological interaction list | REQUIRES MANUAL TEST |
| 10 | Create follow-up | "Follow up with ABC School in 5 days" | `follow_ups` row with `due_at` = now+5d, `leads.next_follow_up_at` synced | REQUIRES MANUAL TEST |
| 11 | Complete follow-up | "Mark ABC School follow-up done" | Pending follow-up → `COMPLETED`, lead status bumped if it was NEW/CONTACTED | REQUIRES MANUAL TEST |
| 12 | Scheduler fires | Follow-up `due_at` in the past | Reminder Telegram message with YES/NO buttons sent within one scheduler interval | REQUIRES MANUAL TEST |
| 13 | YES tap | Tap ✅ YES on a reminder | Follow-up → `COMPLETED`, lead status → `REPLIED`, no new follow-up created | REQUIRES MANUAL TEST |
| 14 | NO tap | Tap ❌ NO on a reminder | Old follow-up cancelled, new `PENDING` follow-up created with `attempt_number` + 1 | REQUIRES MANUAL TEST |
| 15 | Duplicate reminder prevention | Scheduler runs twice before response | Second run does not re-send (due_at snoozed +12h after first send) | REQUIRES MANUAL TEST |
| 16 | Daily priorities | "What should I focus on today?" or 8am trigger | Bucketed list (overdue/due-today/proposal/qualified) + pipeline total | REQUIRES MANUAL TEST |
| 17 | Pipeline analytics | "Show my pipeline" | Per-status counts and values from SQL, not AI | REQUIRES MANUAL TEST |
| 18 | Revenue analytics | "What's my revenue this month?" | WON deals this calendar month, summed in SQL | REQUIRES MANUAL TEST |
| 19 | Lead analytics | "How many leads do I have?" | Totals + win rate from SQL | REQUIRES MANUAL TEST |
| 20 | Approval — approve | Tap ✅ Approve on a WON confirmation | `leads.status` → `WON` only after tap, not before | REQUIRES MANUAL TEST |
| 21 | Approval — reject | Tap ❌ Reject | No DB change, rejection message shown | REQUIRES MANUAL TEST |
| 22 | Invalid callback | Malformed/unrecognized `callback_data` | Silently ignored (routed to no-op), no crash | REQUIRES MANUAL TEST |
| 23 | Duplicate callback | Tap the same button twice quickly | Second tap returns "already handled" / stale-record message, no double-write | REQUIRES MANUAL TEST |
| 24 | Missing information | "Add a lead" (no name) | Bot asks for the missing `business_name` instead of guessing | REQUIRES MANUAL TEST |
| 25 | Unknown command | "What's the weather" | Routed to `UNKNOWN`, generic help message | REQUIRES MANUAL TEST |
| 26 | Missing lead | "Show XYZ Corp" (doesn't exist) | "I couldn't find a lead called..." message | REQUIRES MANUAL TEST |
| 27 | Duplicate lead | "Add ABC School..." when it already exists | Blocked with a duplicate warning, no second row inserted | REQUIRES MANUAL TEST |
| 28 | Invalid status | AI extracts a status outside the allowed enum | Stripped by validation in the router; falls back to a clarification request | REQUIRES MANUAL TEST |
| 29 | Database failure handling | Postgres temporarily unreachable | Node fails safely, generic "⚠️ I couldn't complete that action" surfaces — no SQL error, no stack trace, no credentials shown | REQUIRES MANUAL TEST |

## Suggested test order

1. `LEVEL_2_Telegram_Test` alone — confirms bot token + chat wiring.
2. `LEVEL_4` via `LEVEL_3` — add/list/get/update/status/value.
3. `LEVEL_5` — interaction + note + history, confirm follow-up auto-creation.
4. `LEVEL_6` — manual create/complete follow-up commands.
5. `LEVEL_7_Followup_Scheduler` + `LEVEL_7_Followup_Callback` — force a
   follow-up's `due_at` into the past via SQL, wait for the scheduler tick,
   tap both YES and NO on separate test leads.
6. `LEVEL_10_Human_Approval` — trigger a WON status change and a >30% value
   change, test Approve, Reject, and a stale-record scenario (edit the lead
   in SQL between request and tap).
7. `LEVEL_8_Daily_Priorities` and `LEVEL_9_Analytics`.
8. Error paths (#22–29) last, since some require deliberately breaking
   something (bad credential, malformed callback, etc).
