# Credential Setup

No credentials are hard-coded anywhere in this project. You must configure
three credentials in n8n, plus one config value, before activating anything.

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
2. Run `/database/database_schema.sql` against it.
3. In n8n: **Credentials → New → Postgres** → host, port, database, user,
   password, SSL as required by your provider.
4. Name it `Postgres account` and select it in every Postgres node across
   all 10 workflows (use n8n's "swap credential" bulk option if available,
   or update per-node).

## 4. Your personal Telegram chat ID (config value, not a secret)

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

## After all four are configured

Open every workflow once, resolve any red "select a credential" warnings,
save, then activate in this order (see main README for the full
explanation): `LEVEL_2` (test only, deactivate after confirming) →
`LEVEL_4`–`LEVEL_10` (sub-workflows, no need to activate individually since
they're invoked via Execute Workflow) → `LEVEL_3`, `LEVEL_7_Scheduler`,
`LEVEL_8` (these three need to be **Active**).
