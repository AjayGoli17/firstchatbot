# Credential Setup

No credentials are hard-coded anywhere in this project. You must configure
four credentials in n8n, plus one config value, before activating anything.

## 1. Telegram

1. Message **@BotFather** on Telegram → `/newbot` → follow prompts → copy the
   bot token.
2. In n8n: **Credentials → New → Telegram API** → paste the token → Save.
   Name it exactly `Telegram account` (or rename the credential reference
   inside each imported workflow's Telegram/Telegram Trigger nodes to match
   whatever name you choose).
3. Every workflow that uses a Telegram node currently references a
   placeholder credential id (`REPLACE_ME`). After import, open each
   Telegram / Telegram Trigger node and select your real credential from the
   dropdown — n8n will not run with the placeholder.

## 2. OpenAI

1. Create an API key at platform.openai.com.
2. In n8n: **Credentials → New → Header Auth** (used by the HTTP Request
   node that calls OpenAI directly). Set:
   - Name: `Authorization`
   - Value: `Bearer <your-api-key>`
3. Name the credential `OpenAI API Key` and select it in the **OpenAI
   Command Router** HTTP Request node inside `LEVEL_3_AI_Command_Router`.

## 3. PostgreSQL

1. Provision a Postgres database (local, Supabase, Neon, Railway, RDS —
   anything n8n Cloud can reach over the network).
2. Run `database_schema.sql` against it (fresh install), or, if you already
   ran it before, run `database_migration_002_calendar_event_id.sql` to add
   the new `calendar_event_id` column used by the Google Calendar sync in
   `LEVEL_6_Followup_Management`.
3. In n8n: **Credentials → New → Postgres** → host, port, database, user,
   password, SSL as required by your provider.
4. Name it `Postgres account` and select it in every Postgres node across
   all 10 workflows (use n8n's "swap credential" bulk option if available,
   or update per-node).

## 4. Google Calendar

1. In n8n: **Credentials → New → Google Calendar API (OAuth2)** → follow the
   OAuth flow to connect the Google account you want reminders created in.
2. Name it `Google Calendar account` and select it in the calendar nodes in
   `LEVEL_6_Followup_Management` (`Create Calendar Event`, `Update Calendar
   Event`, `Create Calendar Event (Update)`, `Delete Calendar Event`) —
   these currently reference the placeholder credential id `REPLACE_ME`.
3. All calendar nodes use the `primary` calendar by default. Change the
   `calendar` field on those nodes if you want reminders in a different
   calendar.

## 5. Your personal Telegram chat ID (config value, not a secret)

The scheduled workflows (`LEVEL_7_Followup_Scheduler`,
`LEVEL_8_Daily_Priorities` morning branch) push messages to you without you
having sent anything first, so they need to know your chat ID up front.

1. Message your bot once (e.g. "hi").
2. Temporarily activate `LEVEL_2_Telegram_Test` and send another message —
   the echo reply / execution log will show your `chat.id`.
3. In n8n Cloud: **Settings → Variables** → add `PERSONAL_CHAT_ID` with that
   numeric value. The scheduler and daily-priorities workflows reference it
   as `{{$env.PERSONAL_CHAT_ID}}`.
   - If your n8n plan doesn't support environment variables, replace the
     `{{$env.PERSONAL_CHAT_ID}}` expression in those two nodes with the
     literal chat ID instead.

## 6. Link the AI Command Router sub-workflow

`LEVEL_3_AI_Command_Router_FINAL` no longer runs the Gemini call inline — it
calls the new **`AI_COMMAND_ROUTER`** workflow (`LEVEL_3B_AI_Command_Router.json`)
via Execute Workflow, the same way it already calls Level 4/5/6/8/9.

1. Import `LEVEL_3B_AI_Command_Router.json` first and note its workflow ID
   (visible in the URL bar once opened, e.g. `.../workflow/AbCd1234`).
2. Open `LEVEL_3_AI_Command_Router_FINAL`, find the **Execute AI Command
   Router** node, and set its workflow reference from the placeholder
   `REPLACE_ME_AI_ROUTER_WORKFLOW_ID` to the real ID (or just re-pick it
   from the dropdown — n8n lists it by name).
3. Configure the Header Auth credential from section 2 above on the
   **Gemini Command Router** HTTP Request node inside this new workflow
   (it moved there along with the node).

## 7. Wire the centralized Error Handler

`LEVEL_11_Error_Handler.json` is a small workflow with an **Error Trigger**
node. Instead of Execute-Workflow calls, n8n invokes it automatically
whenever any other workflow throws an unhandled error.

1. Import `LEVEL_11_Error_Handler.json`.
2. Configure its **Log Error** node with the same `Postgres account`
   credential, and **Send Error Alert** with the same `Telegram account`
   credential (it also uses `{{$env.PERSONAL_CHAT_ID}}`, see section 5).
3. For **every other workflow** (`LEVEL_3`–`LEVEL_10`): open **Workflow
   Settings → Error Workflow** and select `LEVEL_11_Error_Handler` from the
   dropdown. This is a per-workflow n8n setting, not something that can be
   baked into the JSON export, so it must be set once per workflow after
   import.

## After everything above is configured

Run `database_migration_003_conversation_state.sql` (or the full
`database_schema.sql` on a fresh install) to add the `processed_updates`,
`pending_actions`, and `error_log` tables used by the duplicate-message
guard, multi-turn clarification, and error logging respectively.

Open every workflow once, resolve any red "select a credential" warnings,
save, then activate in this order (see main README for the full
explanation): `LEVEL_2` (test only, deactivate after confirming) →
`LEVEL_3B_AI_Command_Router`, `LEVEL_4`–`LEVEL_11` (sub-workflows /
error handler, no need to activate individually since they're invoked via
Execute Workflow or the Error Workflow setting) → `LEVEL_3`,
`LEVEL_7_Scheduler`, `LEVEL_8` (these three need to be **Active**).
