# TEST_PLAN.md — Real Telegram End-to-End Testing

No live n8n/Telegram/PostgreSQL execution was performed to produce this
document — it was built from static analysis of the workflow JSON only.
Every row below still needs to be run against your published n8n Cloud
instance. **JSON fixes completed. Live n8n testing is still required.**

For every test: send the message from the real Telegram chat (not
"Execute step"), then check n8n → Executions for the run, and if nothing
arrives in Telegram, open that execution and look at the "Node to inspect
if it fails" column below first — those are exactly the nodes touched in
Phase 2.

| Test ID | Telegram message | Expected AI command | Expected workflow | Expected Telegram response | Expected DB change | Node to inspect if it fails |
|---|---|---|---|---|---|---|
| TEST-01 | `/start` | n/a (not routed through AI) | LEVEL_3 only | Bot greets / falls to Help-style message | none | `Extract Input`, `Send Response` |
| TEST-02 | `hi` | UNKNOWN (low confidence) | LEVEL_3 → LEVEL_3B | Clarification message ("I didn't understand that…") | none (no pending_actions row for UNKNOWN) | `Build Clarification Message`, `Send Clarification` |
| TEST-03 | Show my leads | LIST_LEADS | LEVEL_3 → LEVEL_4 | List of non-WON/LOST leads | none | `List Leads`, `Format List`, `Normalize Result` |
| TEST-04 | Show my active leads | LIST_LEADS (`_invalidStatus: ACTIVE` present but unused — by design, not a bug) | LEVEL_3 → LEVEL_4 | Same list as TEST-03 | none | `Parse and Validate AI Output` (LEVEL_3B), `List Leads` |
| TEST-05 | Add ABC School as a ₹25,000 website lead | ADD_LEAD | LEVEL_3 → LEVEL_4 | "Lead added" confirmation | New row in `leads`, status `NEW`, deal_value 25000 | `Insert Lead`, `Build Add Confirmation` |
| TEST-06 | Show ABC School | GET_LEAD | LEVEL_3 → LEVEL_4 | Lead detail card | none | `Find Lead By Name`, `Format Lead Detail` |
| TEST-07 | Move ABC School to proposal | CHANGE_STATUS | LEVEL_3 → LEVEL_4 (may route to LEVEL_10 if approval required) | Status confirmation | `leads.status` → `PROPOSAL_SENT` | `Update Status Direct`, `Status Confirmation` |
| TEST-08 | Record an interaction with ABC School | RECORD_INTERACTION | LEVEL_3 → LEVEL_5 | "Logged interaction…" confirmation | New `interactions` row, `leads.last_contact_at` updated, follow-up auto-created | **`Update Last Contact`, `Sync Next Follow Up On Lead` (fixed in Phase 2 — this was the confirmed silent-failure point)** |
| TEST-09 | Create a follow-up for ABC School tomorrow | CREATE_FOLLOW_UP | LEVEL_3 → LEVEL_6 | "Follow-up set for…" confirmation | New/updated `follow_ups` row, `leads.next_follow_up_at` synced | `Upsert Followup`, `Sync Lead Next Follow Up` (fixed) |
| TEST-10 | Show my follow-ups | LIST_FOLLOW_UPS | LEVEL_3 → LEVEL_6 | Follow-up list | none | `Query Follow-ups`, `Format Follow-up List` |
| TEST-11 | What should I do today? | DAILY_PRIORITY | LEVEL_3 → LEVEL_8 | Bucketed priorities + pipeline total | none | `Query Priorities`, `Format Daily Priorities` |
| TEST-12 | Show my analytics | PIPELINE_ANALYTICS / REVENUE_ANALYTICS / LEAD_ANALYTICS (depends on phrasing) | LEVEL_3 → LEVEL_9 | Analytics summary | none | `Route Report Type`, matching `Format * Report` node |
| TEST-13 | Help | n/a (`/help` shortcut, bypasses AI) | LEVEL_3 only | Full command list | none | `Is Help Command`, `Build Help Message`, `Send Help` |
| TEST-14 | Cancel | n/a (keyword shortcut, bypasses AI) | LEVEL_3 only | "Okay, cancelled." | Any `pending_actions` row for this chat deleted | **`Clear Pending Action (Cancel)` (fixed in Phase 2), `Build Cancel Message`** |
| TEST-15 | asdkjfh qwoeiur (nonsense) | UNKNOWN | LEVEL_3 → LEVEL_3B | Clarification / "I didn't understand" message | none | `Needs Clarification`, `Build Clarification Message` |

## Additional tests

| Test ID | Scenario | How to trigger | Expected result | Node to inspect if it fails |
|---|---|---|---|---|
| TEST-16 | Missing required field | "Add a lead" (no business name) | Bot asks "What's the business name?"; if you then reply with just the name, the lead should be created using the merged answer | **`Upsert Pending Action` (fixed), `Build Standard Envelope` (fixed), `Merge Pending Answer`** |
| TEST-17 | Empty lead list | Run TEST-03 against a fresh DB with 0 leads | Friendly "no leads yet" message, not a blank message or crash | `Format List` |
| TEST-18 | Empty follow-up list | Run TEST-10 with 0 pending follow-ups | Friendly "no follow-ups" message | `Format Follow-up List` |
| TEST-19 | Duplicate lead | Repeat TEST-05 for the same business name | "Already exists" warning, no second row inserted | `Check Duplicate Lead`, `Build Duplicate Message` |
| TEST-20 | Lead not found | "Show XYZ Corp" (doesn't exist) | "I couldn't find a lead called…" message | `Lead Not Found (Get)` |
| TEST-21 | Scheduled follow-up fires | Set a `follow_ups.due_at` to a past timestamp, wait for the Schedule Trigger | Reminder message with YES/NO buttons sent to `PERSONAL_CHAT_ID` | `Get Due Followups`, `Send Reminder` |
| TEST-22 | Duplicate reminder prevention | Let the scheduler run twice before answering | Second run does not re-send (due_at snoozed +12h) | `Snooze To Avoid Duplicate Send` (left unchanged — verified as a safe terminal side-effect node, no downstream consumer) |
| TEST-23 | Follow-up callback — NO tapped | Tap ❌ NO on a reminder | "Next reminder set for…" message, new PENDING follow-up created | **`Sync Lead Next Follow Up` in LEVEL_7_Followup_Callback (fixed)** |
| TEST-24 | Human approval — approve | Trigger a change requiring approval (e.g. large deal-value change), tap ✅ Approve | Change applied, confirmation edited in place | `Apply Approved Change` |
| TEST-25 | Human approval — reject | Tap ❌ Reject | No DB change, rejection message shown | `Edit Approval Message` |
| TEST-26 | AI/Gemini failure | Temporarily break the Gemini API key/credential, send any command | Bot replies "I couldn't reach the AI service. Please try again in a moment." — not silence, not a raw error | `Parse and Validate AI Output` (`systemError: true` path) |
| TEST-27 | Database failure | Temporarily revoke the Postgres credential, send any command | `LEVEL_11_Error_Handler` fires, generic "Something went wrong" alert sent to `PERSONAL_CHAT_ID`, row written to `error_log` | Confirm LEVEL_11 is wired as the **Error Workflow** in every workflow's Settings (not visible in JSON — must check in n8n Cloud UI) |
| TEST-28 | Missing chatId | Not directly triggerable from Telegram; code-review only | No workflow should ever call Telegram with an empty `chat_id` | Re-verify `Build Standard Envelope`/`Build Clarification Message` after Phase 2 fix always resolve `chatId` from an upstream node, never from a Postgres write node's own output |
| TEST-29 | Child workflow failure | Temporarily rename/break one Execute Workflow reference | Should not go completely silent — ideally routes to LEVEL_11 | `Route Command`, each `Execute *` node's error output |

## Suggested run order
1. TEST-13, TEST-01 (no DB writes, confirms basic Telegram round-trip)
2. TEST-03, TEST-17 (read-only, confirms list formatting)
3. TEST-05, TEST-19 (write path + duplicate guard)
4. TEST-06, TEST-20
5. TEST-07
6. TEST-08 ← **highest-value test, this was the confirmed broken path**
7. TEST-09, TEST-10, TEST-18
8. TEST-16 (multi-turn clarification path — second most important, was also broken)
9. TEST-11, TEST-12
10. TEST-14, TEST-15, TEST-02
11. TEST-21–TEST-23 (scheduler/callback — needs a real past-due follow-up in the DB)
12. TEST-24–TEST-25 (approval flow)
13. TEST-26–TEST-29 (failure-injection tests, do these last since they involve breaking credentials temporarily)
