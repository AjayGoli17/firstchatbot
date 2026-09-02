const { DatabaseSync } = require('node:sqlite');

class DatabaseAdapter {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.initSchema();
  }

  initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS leads (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        business_name       TEXT NOT NULL UNIQUE,
        contact_name        TEXT,
        email               TEXT,
        phone               TEXT,
        service             TEXT,
        status              TEXT NOT NULL DEFAULT 'NEW',
        deal_value          REAL DEFAULT 0,
        currency            TEXT NOT NULL DEFAULT 'INR',
        last_contact_at     TEXT,
        next_follow_up_at   TEXT,
        won_at              TEXT,
        notes               TEXT,
        created_at          TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS interactions (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        lead_id             INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        interaction_type    TEXT NOT NULL,
        content             TEXT,
        interaction_date    TEXT NOT NULL DEFAULT (datetime('now')),
        created_at          TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS follow_ups (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        lead_id             INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        due_at              TEXT NOT NULL,
        attempt_number      INTEGER NOT NULL DEFAULT 1,
        status              TEXT NOT NULL DEFAULT 'PENDING',
        calendar_event_id   TEXT,
        created_at          TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at        TEXT
      );

      CREATE UNIQUE INDEX IF NOT EXISTS uq_followups_lead_pending
        ON follow_ups(lead_id)
        WHERE status = 'PENDING';

      CREATE TABLE IF NOT EXISTS processed_updates (
        update_id           INTEGER PRIMARY KEY,
        processed_at        TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS pending_actions (
        chat_id             TEXT PRIMARY KEY,
        command             TEXT NOT NULL,
        parameters          TEXT NOT NULL DEFAULT '{}',
        missing             TEXT NOT NULL DEFAULT '[]',
        updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS error_log (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        workflow_name       TEXT,
        node_name           TEXT,
        error_message       TEXT,
        occurred_at         TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  reset() {
    this.db.exec(`
      DELETE FROM interactions;
      DELETE FROM follow_ups;
      DELETE FROM leads;
      DELETE FROM processed_updates;
      DELETE FROM pending_actions;
      DELETE FROM error_log;
    `);
  }

  query(pgSql, params = []) {
    let sql = pgSql.trim();

    // 1. Handle CTE queries in Level 7 Callback
    if (sql.startsWith('WITH upd AS') && sql.includes('UPDATE follow_ups') && sql.includes('UPDATE leads')) {
      const fuId = params[0];
      const fuRows = this.query(
        "UPDATE follow_ups SET status = 'COMPLETED', completed_at = datetime('now') WHERE id = ? AND status = 'PENDING' RETURNING lead_id",
        [fuId]
      );
      if (fuRows.length === 0) return [];
      const leadId = fuRows[0].lead_id;
      return this.query(
        "UPDATE leads SET status = 'REPLIED', last_contact_at = datetime('now'), next_follow_up_at = NULL WHERE id = ? RETURNING business_name",
        [leadId]
      );
    }

    if (sql.startsWith('WITH cancelled AS') && sql.includes('UPDATE follow_ups') && sql.includes('INSERT INTO follow_ups')) {
      const fuId = params[0];
      const leadParam = params[1];
      const attemptNumber = params[2] || 2;
      const cancelledRows = this.query(
        "UPDATE follow_ups SET status = 'CANCELLED' WHERE id = ? RETURNING lead_id",
        [fuId]
      );
      if (cancelledRows.length === 0) return [];
      const leadId = cancelledRows[0].lead_id || leadParam;
      return this.query(
        "INSERT INTO follow_ups (lead_id, due_at, attempt_number, status) VALUES (?, datetime('now', '+3 days'), ?, 'PENDING') RETURNING due_at",
        [leadId, attemptNumber]
      );
    }

    // 2. Handle Upsert Followup in LEVEL_6 and LEVEL_5
    if (sql.includes('INSERT INTO follow_ups') && sql.includes('ON CONFLICT')) {
      const leadId = params[0];
      const dueAt = params[1] || new Date().toISOString();
      const existing = this.query("SELECT id FROM follow_ups WHERE lead_id = ? AND status = 'PENDING' LIMIT 1", [leadId]);
      if (existing.length > 0) {
        if (sql.includes('DO UPDATE')) {
          return this.query("UPDATE follow_ups SET due_at = ? WHERE id = ? RETURNING *", [dueAt, existing[0].id]);
        } else {
          return [];
        }
      } else {
        return this.query("INSERT INTO follow_ups (lead_id, due_at, attempt_number, status) VALUES (?, ?, 1, 'PENDING') RETURNING *", [leadId, dueAt]);
      }
    }

    // 3. Syntax translations for SQLite compatibility
    // Date/interval transformations
    sql = sql.replace(/now\(\)\s*::\s*date/gi, "date('now')");
    sql = sql.replace(/now\(\)\s*\+\s*interval\s*'3 days'/gi, "datetime('now', '+3 days')");
    sql = sql.replace(/now\(\)\s*\+\s*interval\s*'12 hours'/gi, "datetime('now', '+12 hours')");
    sql = sql.replace(/now\(\)\s*\+\s*interval\s*'1 day'/gi, "datetime('now', '+1 day')");
    sql = sql.replace(/now\(\)\s*-\s*interval\s*'15 minutes'/gi, "datetime('now', '-15 minutes')");
    sql = sql.replace(/date_trunc\('month',\s*now\(\)\)/gi, "datetime('now', 'start of month')");
    sql = sql.replace(/now\(\)/gi, "datetime('now')");

    // Replace PostgreSQL typecasts like ::date
    sql = sql.replace(/([a-zA-Z0-9_.]+)::date/gi, "date($1)");
    sql = sql.replace(/::numeric/gi, '');
    sql = sql.replace(/::integer/gi, '');
    sql = sql.replace(/::text/gi, '');

    // Normalize date comparisons for SQLite (datetime(col) <= datetime(...))
    sql = sql.replace(/([a-zA-Z0-9_.]+)\.due_at\s*<=\s*datetime\('now'\)/gi, "datetime($1.due_at) <= datetime('now')");
    sql = sql.replace(/([a-zA-Z0-9_.]+)\.due_at\s*<\s*datetime\('now'\)/gi, "datetime($1.due_at) < datetime('now')");
    sql = sql.replace(/([a-zA-Z0-9_.]+)\.next_follow_up_at\s*<=\s*datetime\('now',\s*'\+1 day'\)/gi, "datetime($1.next_follow_up_at) <= datetime('now', '+1 day')");
    sql = sql.replace(/([a-zA-Z0-9_.]+)\.next_follow_up_at\s*<\s*datetime\('now'\)/gi, "datetime($1.next_follow_up_at) < datetime('now')");
    sql = sql.replace(/won_at\s*>=\s*datetime\('now',\s*'start of month'\)/gi, "datetime(won_at) >= datetime('now', 'start of month')");

    // Convert $1, $2, ... to ?
    const paramIndices = [];
    sql = sql.replace(/\$([0-9]+)/g, (match, p1) => {
      paramIndices.push(parseInt(p1, 10) - 1);
      return '?';
    });

    const orderedParams = paramIndices.length > 0 
      ? paramIndices.map(idx => (params[idx] !== undefined ? params[idx] : null))
      : params;

    try {
      const stmt = this.db.prepare(sql);
      const isSelect = /^\s*(SELECT|WITH)\s/i.test(sql) || /RETURNING/i.test(sql);
      if (isSelect) {
        return stmt.all(...orderedParams).map(row => ({ ...row }));
      } else {
        const info = stmt.run(...orderedParams);
        return [{ changes: info.changes, lastInsertRowid: info.lastInsertRowid }];
      }
    } catch (err) {
      err.query = sql;
      err.params = orderedParams;
      throw err;
    }
  }

  seedLead(lead) {
    const defaultLead = {
      business_name: 'Acme Corp',
      status: 'NEW',
      deal_value: 10000,
      currency: 'INR',
      ...lead
    };
    const rows = this.query(
      `INSERT INTO leads (business_name, contact_name, email, phone, service, status, deal_value, currency, notes, next_follow_up_at, won_at, last_contact_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      [
        defaultLead.business_name,
        defaultLead.contact_name || null,
        defaultLead.email || null,
        defaultLead.phone || null,
        defaultLead.service || null,
        defaultLead.status,
        defaultLead.deal_value,
        defaultLead.currency,
        defaultLead.notes || null,
        defaultLead.next_follow_up_at || null,
        defaultLead.won_at || null,
        defaultLead.last_contact_at || null,
        defaultLead.updated_at || new Date().toISOString()
      ]
    );
    return rows[0];
  }

  seedFollowUp(followup) {
    const rows = this.query(
      `INSERT INTO follow_ups (lead_id, due_at, attempt_number, status, calendar_event_id)
       VALUES (?, ?, ?, ?, ?) RETURNING *`,
      [
        followup.lead_id,
        followup.due_at || new Date().toISOString(),
        followup.attempt_number || 1,
        followup.status || 'PENDING',
        followup.calendar_event_id || null
      ]
    );
    return rows[0];
  }

  seedInteraction(interaction) {
    const rows = this.query(
      `INSERT INTO interactions (lead_id, interaction_type, content, interaction_date)
       VALUES (?, ?, ?, ?) RETURNING *`,
      [
        interaction.lead_id,
        interaction.interaction_type || 'CONTACT',
        interaction.content || null,
        interaction.interaction_date || new Date().toISOString()
      ]
    );
    return rows[0];
  }

  seedPendingAction(pending) {
    this.query(
      `INSERT INTO pending_actions (chat_id, command, parameters, missing, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT (chat_id) DO UPDATE SET command = excluded.command, parameters = excluded.parameters, missing = excluded.missing, updated_at = datetime('now')`,
      [
        String(pending.chat_id),
        pending.command,
        JSON.stringify(pending.parameters || {}),
        JSON.stringify(pending.missing || [])
      ]
    );
  }
}

module.exports = DatabaseAdapter;
