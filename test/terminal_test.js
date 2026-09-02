const DatabaseAdapter = require('./db_adapter');
const N8nRuntime = require('./n8n_runtime');

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m'
};

async function runTerminalTests() {
  console.log(`\n${COLORS.bright}${COLORS.cyan}================================================================${COLORS.reset}`);
  console.log(`${COLORS.bright}${COLORS.cyan}     TELEGRAM CHATBOT TERMINAL MESSAGE VERIFICATION${COLORS.reset}`);
  console.log(`${COLORS.bright}${COLORS.cyan}================================================================${COLORS.reset}\n`);

  const db = new DatabaseAdapter();
  const runtime = new N8nRuntime(db);

  // Setup initial base state for continuity
  db.reset();
  const baseLead = db.seedLead({
    business_name: 'ABC School',
    status: 'CONTACTED',
    deal_value: 25000,
    service: 'Website',
    updated_at: '2026-09-01T12:00:00.000Z'
  });
  db.seedLead({
    business_name: 'Apex Academy',
    status: 'PROPOSAL_SENT',
    deal_value: 50000,
    service: 'App Development'
  });

  const testMessages = [
    {
      num: 1,
      type: 'message',
      input: '/help',
      expectedAction: 'Help Command Menu',
      check: (msg) => msg && msg.text.includes('FREELANCE ASSISTANT')
    },
    {
      num: 2,
      type: 'message',
      input: 'xyz123',
      expectedAction: 'Unrecognized Message (Clarification)',
      check: (msg) => msg && msg.text.includes("didn't understand that")
    },
    {
      num: 3,
      type: 'message',
      input: 'Show my active leads',
      expectedAction: 'LIST_LEADS -> Format List',
      check: (msg) => msg && msg.text.includes('ABC School') && msg.text.includes('Apex Academy')
    },
    {
      num: 4,
      type: 'message',
      input: 'Show ABC School',
      expectedAction: 'GET_LEAD -> Lead Detail Card',
      check: (msg) => msg && msg.text.includes('ABC School') && msg.text.includes('CONTACTED')
    },
    {
      num: 5,
      type: 'message',
      input: "Update ABC School's service to SEO",
      expectedAction: 'UPDATE_LEAD -> Update Lead Fields',
      check: (msg) => {
        const rows = db.query('SELECT service FROM leads WHERE business_name = ?', ['ABC School']);
        return msg && /updated/i.test(msg.text) && rows[0]?.service === 'SEO';
      }
    },
    {
      num: 6,
      type: 'message',
      input: 'I spoke to ABC School today about the SEO project',
      expectedAction: 'RECORD_INTERACTION -> Log Interaction',
      check: (msg) => {
        const rows = db.query("SELECT * FROM interactions WHERE content LIKE '%SEO project%'");
        return msg && msg.text.includes('Logged interaction') && rows.length > 0;
      }
    },
    {
      num: 7,
      type: 'message',
      input: 'Remind me to call ABC School tomorrow at 10 AM',
      expectedAction: 'CREATE_FOLLOW_UP -> Upsert Follow-up',
      check: (msg) => {
        const rows = db.query("SELECT * FROM follow_ups WHERE lead_id = (SELECT id FROM leads WHERE business_name = 'ABC School')");
        return msg && msg.text.includes('Follow-up for') && rows.length > 0;
      }
    },
    {
      num: 8,
      type: 'message',
      input: 'Show my follow-ups',
      expectedAction: 'LIST_FOLLOW_UPS -> List Reminders',
      check: (msg) => msg && msg.text.includes('ABC School')
    },
    {
      num: 9,
      type: 'message',
      input: 'What should I do today?',
      expectedAction: 'DAILY_PRIORITY -> Daily Priorities Report',
      check: (msg) => msg && msg.text.includes("TODAY'S PRIORITIES")
    },
    {
      num: 10,
      type: 'message',
      input: 'Show my pipeline',
      expectedAction: 'PIPELINE_ANALYTICS -> Pipeline Breakdown',
      check: (msg) => msg && msg.text.includes('Pipeline') && msg.text.includes('Total active pipeline')
    },
    {
      num: 11,
      type: 'message',
      input: 'Add a new lead',
      expectedAction: 'ADD_LEAD (Incomplete) -> Prompt for Business Name',
      check: (msg) => {
        const pending = db.query("SELECT * FROM pending_actions WHERE command = 'ADD_LEAD'");
        return msg && msg.text.includes("What's the business name?") && pending.length > 0;
      }
    },
    {
      num: 12,
      type: 'callback',
      button: 'Follow-up YES Button',
      setup: (test) => {
        let fu = db.query("SELECT id FROM follow_ups WHERE lead_id = ? AND status = 'PENDING'", [baseLead.id])[0];
        if (!fu) fu = db.seedFollowUp({ lead_id: baseLead.id, status: 'PENDING' });
        test.callbackData = `fu:${fu.id}:${baseLead.id}:Y`;
      },
      expectedAction: 'LEVEL_7 Callback -> Mark Completed & Update Lead to REPLIED',
      check: (msg) => {
        const rows = db.query("SELECT status FROM leads WHERE business_name = 'ABC School'");
        return msg && msg.text.includes('REPLIED') && rows[0]?.status === 'REPLIED';
      }
    },
    {
      num: 13,
      type: 'callback',
      button: 'Follow-up NO Button (Snooze)',
      setup: (test) => {
        db.query('DELETE FROM follow_ups WHERE lead_id = ?', [baseLead.id]);
        const fu = db.seedFollowUp({ lead_id: baseLead.id, status: 'PENDING', attempt_number: 1 });
        test.callbackData = `fu:${fu.id}:${baseLead.id}:N`;
      },
      expectedAction: 'LEVEL_7 Callback -> Cancel current & schedule attempt 2',
      check: (msg) => {
        const rows = db.query("SELECT attempt_number FROM follow_ups WHERE lead_id = ? AND status = 'PENDING'", [baseLead.id]);
        return msg && msg.text.includes('Next reminder') && rows[0]?.attempt_number === 2;
      }
    },
    {
      num: 14,
      type: 'callback',
      button: 'Human Approval Approve (A)',
      setup: (test) => {
        const lead = db.seedLead({ business_name: 'Big Client', status: 'PROPOSAL_SENT', updated_at: '2026-09-01T12:00:00.000Z' });
        const v = new Date(lead.updated_at).toISOString().replace(/[:]/g, '');
        test.callbackData = `appr:${lead.id}:status:WON:${v}:A`;
      },
      expectedAction: 'LEVEL_10 Approval -> Mark Lead WON & Set won_at timestamp',
      check: (msg) => {
        const rows = db.query("SELECT status, won_at FROM leads WHERE business_name = 'Big Client'");
        return msg && /approved/i.test(msg.text) && rows[0]?.status === 'WON' && !!rows[0]?.won_at;
      }
    },
    {
      num: 15,
      type: 'callback',
      button: 'Human Approval Reject (R)',
      setup: (test) => {
        const lead = db.seedLead({ business_name: 'Reject Client', status: 'PROPOSAL_SENT', updated_at: '2026-09-01T12:00:00.000Z' });
        const v = new Date(lead.updated_at).toISOString().replace(/[:]/g, '');
        test.callbackData = `appr:${lead.id}:status:WON:${v}:R`;
      },
      expectedAction: 'LEVEL_10 Approval -> Reject status change without DB modification',
      check: (msg) => {
        const rows = db.query("SELECT status FROM leads WHERE business_name = 'Reject Client'");
        return msg && /rejected/i.test(msg.text) && rows[0]?.status === 'PROPOSAL_SENT';
      }
    }
  ];

  let passed = 0;
  let failed = 0;

  for (const t of testMessages) {
    runtime.sentMessages = [];
    if (t.setup) t.setup(t);

    let payload;
    if (t.type === 'callback') {
      payload = {
        update_id: 20000 + t.num,
        callback_query: {
          id: `cb_${t.num}`,
          from: { id: 987654321, first_name: 'Tester' },
          message: { message_id: 500 + t.num, chat: { id: 987654321 }, text: 'Previous message' },
          data: t.callbackData
        }
      };
    } else {
      payload = {
        update_id: 10000 + t.num,
        message: {
          message_id: 100 + t.num,
          from: { id: 987654321, first_name: 'Tester' },
          chat: { id: 987654321, type: 'private' },
          text: t.input
        }
      };
    }

    let ok = false;
    let replyMsg = null;
    let errStr = null;

    try {
      await runtime.executeWorkflow('LEVEL_3_AI_Command_Router_FINAL', payload);
      replyMsg = runtime.sentMessages[runtime.sentMessages.length - 1];
      ok = t.check(replyMsg);
    } catch (e) {
      errStr = e.message;
    }

    if (ok) {
      passed++;
      const label = t.type === 'callback' ? `[BUTTON] ${t.button}` : `"${t.input}"`;
      console.log(`${COLORS.green}✔ [${t.num}] PASS${COLORS.reset} ${COLORS.bright}${label}${COLORS.reset}`);
      console.log(`     ${COLORS.gray}Action:${COLORS.reset} ${t.expectedAction}`);
      console.log(`     ${COLORS.magenta}Telegram Reply:${COLORS.reset} ${replyMsg?.text.replace(/\n/g, ' ')}\n`);
    } else {
      failed++;
      const label = t.type === 'callback' ? `[BUTTON] ${t.button}` : `"${t.input}"`;
      console.log(`${COLORS.red}✖ [${t.num}] FAIL${COLORS.reset} ${COLORS.bright}${label}${COLORS.reset}`);
      console.log(`     ${COLORS.gray}Expected:${COLORS.reset} ${t.expectedAction}`);
      console.log(`     ${COLORS.red}Got:${COLORS.reset} ${replyMsg ? replyMsg.text : errStr}\n`);
    }
  }

  console.log(`${COLORS.bright}================================================================${COLORS.reset}`);
  console.log(`  Tests Passed: ${COLORS.green}${passed}/${testMessages.length}${COLORS.reset}`);
  console.log(`  Tests Failed: ${failed > 0 ? COLORS.red : COLORS.green}${failed}${COLORS.reset}`);
  console.log(`${COLORS.bright}================================================================${COLORS.reset}\n`);

  return { passed, failed, total: testMessages.length };
}

if (require.main === module) {
  runTerminalTests().catch(console.error);
}

module.exports = runTerminalTests;
