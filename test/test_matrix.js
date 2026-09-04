/**
 * Complete test matrix of all discovered user messages, actions, routing,
 * database verifications, and error cases across all 12 workflows.
 */

const testMatrix = [
  // =========================================================================
  // 1. Direct / Keyword Commands (Bypasses AI Router)
  // =========================================================================
  {
    id: 'TEST-001',
    category: 'Direct / System Commands',
    message: '/start',
    description: 'User sends /start command -> bot greets / provides guidance',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL',
    expectedRoute: 'Extract Input -> Execute AI Command Router -> Send Clarification / Guidance',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || (!msg.text.includes("didn't understand") && !msg.text.includes('FREELANCE ASSISTANT'))) {
        throw new Error(`Expected greeting / guidance message, got: ${JSON.stringify(msg)}`);
      }
    }
  },
  {
    id: 'TEST-002',
    category: 'Direct / System Commands',
    message: '/help',
    description: 'User sends /help command -> full command menu',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL',
    expectedRoute: 'Is Help Command -> Build Help Message -> Send Help',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('FREELANCE ASSISTANT') || !msg.text.includes('Leads')) {
        throw new Error(`Expected help text with categories, got: ${JSON.stringify(msg)}`);
      }
    }
  },
  {
    id: 'TEST-003',
    category: 'Direct / System Commands',
    message: 'cancel',
    description: 'User sends cancel keyword to abort pending action',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL',
    setup: (db, test) => {
      db.seedPendingAction({ chat_id: '987654321', command: 'ADD_LEAD', parameters: {}, missing: ['business_name'] });
    },
    expectedRoute: 'Is Cancel Command -> Clear Pending Action (Cancel) -> Send Cancel Message',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('cancelled')) {
        throw new Error(`Expected cancellation response, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query('SELECT * FROM pending_actions WHERE chat_id = ?', ['987654321']);
      if (rows.length > 0) {
        throw new Error('Pending action was not cleared from database on cancel');
      }
    }
  },
  {
    id: 'TEST-004',
    category: 'Direct / System Commands',
    message: 'stop',
    description: 'User sends stop keyword to abort pending action',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL',
    setup: (db, test) => {
      db.seedPendingAction({ chat_id: '987654321', command: 'ADD_LEAD', parameters: {}, missing: ['business_name'] });
    },
    expectedRoute: 'Is Cancel Command -> Clear Pending Action (Cancel) -> Send Cancel Message',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('cancelled')) {
        throw new Error(`Expected cancellation response, got: ${JSON.stringify(msg)}`);
      }
    }
  },

  // =========================================================================
  // 2. Lead Management (LEVEL_4)
  // =========================================================================
  {
    id: 'TEST-005',
    category: 'Lead Management',
    message: 'Add ABC School as a ₹25,000 website lead',
    description: 'Add a new lead with business name, deal value, and service',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_4_Lead_Management',
    expectedRoute: 'AI Router -> Execute Lead Management -> Insert Lead -> Build Add Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('Lead added') || !msg.text.includes('ABC School')) {
        throw new Error(`Expected lead added confirmation, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query('SELECT * FROM leads WHERE business_name = ?', ['ABC School']);
      if (rows.length === 0) throw new Error('Lead was not inserted into database');
      if (rows[0].deal_value !== 25000) throw new Error(`Expected deal_value 25000, got ${rows[0].deal_value}`);
      if (rows[0].status !== 'NEW') throw new Error(`Expected status NEW, got ${rows[0].status}`);
    }
  },
  {
    id: 'TEST-006',
    category: 'Lead Management',
    message: 'Add Horizon Tech as a lead',
    description: 'Add a new lead with business name only',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_4_Lead_Management',
    expectedRoute: 'AI Router -> Execute Lead Management -> Insert Lead',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('Lead added')) {
        throw new Error(`Expected lead added confirmation, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query('SELECT * FROM leads WHERE business_name = ?', ['Horizon Tech']);
      if (rows.length === 0) throw new Error('Horizon Tech lead was not inserted into database');
    }
  },
  {
    id: 'TEST-007',
    category: 'Lead Management',
    message: 'Add ABC School as a lead',
    description: 'Duplicate lead prevention (attempting to add an existing lead)',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_4_Lead_Management',
    setup: (db, test) => {
      db.seedLead({ business_name: 'ABC School', deal_value: 25000 });
    },
    expectedRoute: 'Check Duplicate Lead -> Duplicate Exists -> Build Duplicate Message',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('already exists')) {
        throw new Error(`Expected duplicate warning, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query('SELECT * FROM leads WHERE business_name = ?', ['ABC School']);
      if (rows.length !== 1) throw new Error(`Expected exactly 1 row, found ${rows.length}`);
    }
  },
  {
    id: 'TEST-008',
    category: 'Lead Management',
    message: 'Show my leads',
    description: 'List active non-won/lost leads',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_4_Lead_Management',
    setup: (db, test) => {
      db.seedLead({ business_name: 'Lead Alpha', status: 'CONTACTED', deal_value: 15000 });
      db.seedLead({ business_name: 'Lead Beta', status: 'PROPOSAL_SENT', deal_value: 40000 });
      db.seedLead({ business_name: 'Lead Won', status: 'WON', deal_value: 50000 });
    },
    expectedRoute: 'Route Lead Command (LIST_LEADS) -> List Leads -> Format List',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('Lead Alpha') || !msg.text.includes('Lead Beta')) {
        throw new Error(`Expected active leads in list, got: ${JSON.stringify(msg)}`);
      }
      if (msg.text.includes('Lead Won')) {
        throw new Error('Won lead should not appear in active leads list');
      }
    }
  },
  {
    id: 'TEST-009',
    category: 'Lead Management',
    message: 'List my active leads',
    description: 'Natural language variation for listing active leads',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_4_Lead_Management',
    setup: (db, test) => {
      db.seedLead({ business_name: 'Gamma Corp', status: 'QUALIFIED' });
    },
    expectedRoute: 'Route Lead Command (LIST_LEADS) -> List Leads -> Format List',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('Gamma Corp')) {
        throw new Error(`Expected Gamma Corp in list, got: ${JSON.stringify(msg)}`);
      }
    }
  },
  {
    id: 'TEST-010',
    category: 'Lead Management',
    message: 'Show my leads',
    description: 'List leads when database is empty (empty state handling)',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_4_Lead_Management',
    expectedRoute: 'List Leads -> Format List (empty state)',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('No active leads')) {
        throw new Error(`Expected friendly empty message, got: ${JSON.stringify(msg)}`);
      }
    }
  },
  {
    id: 'TEST-011',
    category: 'Lead Management',
    message: 'Show ABC School',
    description: 'Get details for a specific lead',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_4_Lead_Management',
    setup: (db, test) => {
      db.seedLead({ business_name: 'ABC School', status: 'CONTACTED', deal_value: 30000, service: 'Website' });
    },
    expectedRoute: 'Route Lead Command (GET_LEAD) -> Find Lead By Name -> Format Lead Detail',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('ABC School') || !msg.text.includes('CONTACTED')) {
        throw new Error(`Expected lead detail card for ABC School, got: ${JSON.stringify(msg)}`);
      }
    }
  },
  {
    id: 'TEST-012',
    category: 'Lead Management',
    message: 'Show Nonexistent Corp',
    description: 'Get details for a lead that does not exist',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_4_Lead_Management',
    expectedRoute: 'Find Lead By Name -> Lead Not Found (Get)',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes("couldn't find a lead")) {
        throw new Error(`Expected lead not found message, got: ${JSON.stringify(msg)}`);
      }
    }
  },
  {
    id: 'TEST-013',
    category: 'Lead Management',
    message: 'Update ABC School email to info@abcschool.com',
    description: 'Update lead contact fields',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_4_Lead_Management',
    setup: (db, test) => {
      db.seedLead({ business_name: 'ABC School', status: 'NEW' });
    },
    expectedRoute: 'Route Lead Command (UPDATE_LEAD) -> Update Lead Fields -> Build Update Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !/updated/i.test(msg.text)) {
        throw new Error(`Expected update confirmation, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query('SELECT email FROM leads WHERE business_name = ?', ['ABC School']);
      if (!rows[0] || rows[0].email !== 'info@abcschool.com') {
        throw new Error(`Expected email info@abcschool.com, got ${rows[0]?.email}`);
      }
    }
  },
  {
    id: 'TEST-014',
    category: 'Lead Management',
    message: 'Move ABC School to proposal sent',
    description: 'Direct status change (not requiring human approval)',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_4_Lead_Management',
    setup: (db, test) => {
      db.seedLead({ business_name: 'ABC School', status: 'CONTACTED' });
    },
    expectedRoute: 'Check Needs Approval (Status) -> Update Status Direct -> Status Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('PROPOSAL_SENT') || !msg.text.includes('moved to PROPOSAL_SENT')) {
        throw new Error(`Expected status confirmation, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query('SELECT status FROM leads WHERE business_name = ?', ['ABC School']);
      if (rows[0].status !== 'PROPOSAL_SENT') {
        throw new Error(`Expected status PROPOSAL_SENT, got ${rows[0].status}`);
      }
    }
  },
  {
    id: 'TEST-015',
    category: 'Lead Management',
    message: 'Mark ABC School as won',
    description: 'Status change to WON triggers Human Approval flow',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_4_Lead_Management -> LEVEL_10_Human_Approval',
    setup: (db, test) => {
      db.seedLead({ business_name: 'ABC School', status: 'PROPOSAL_SENT' });
    },
    expectedRoute: 'Check Needs Approval (Status) -> Request Approval (Status) -> LEVEL_10 (REQUEST)',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('Confirm this change?') || !msg.text.includes('WON')) {
        throw new Error(`Expected Human Approval request message, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query('SELECT status FROM leads WHERE business_name = ?', ['ABC School']);
      if (rows[0].status !== 'PROPOSAL_SENT') {
        throw new Error(`Status should remain PROPOSAL_SENT until approved, but was ${rows[0].status}`);
      }
    }
  },
  {
    id: 'TEST-016',
    category: 'Lead Management',
    message: 'Change ABC School deal value to 30000',
    description: 'Deal value change triggers approval or confirmation',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_4_Lead_Management',
    setup: (db, test) => {
      db.seedLead({ business_name: 'ABC School', deal_value: 20000 });
    },
    expectedRoute: 'Check Needs Approval (Value) -> Approval / Update Direct',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || (!msg.text.includes('30,000') && !msg.text.includes('Confirm this change?'))) {
        throw new Error(`Expected deal value message with 30,000, got: ${JSON.stringify(msg)}`);
      }
    }
  },

  // =========================================================================
  // 3. Interaction History (LEVEL_5)
  // =========================================================================
  {
    id: 'TEST-017',
    category: 'Interaction History',
    message: 'I spoke to ABC School today',
    description: 'Log an interaction against an existing lead',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_5_Interaction_History',
    setup: (db, test) => {
      db.seedLead({ business_name: 'ABC School', status: 'NEW' });
    },
    expectedRoute: 'Find Lead By Name -> Insert Interaction -> Update Last Contact -> Create Pending Followup -> Sync Next Follow Up',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('Logged interaction') || !msg.text.includes('ABC School')) {
        throw new Error(`Expected interaction logged confirmation, got: ${JSON.stringify(msg)}`);
      }
      const intRows = db.query('SELECT * FROM interactions WHERE lead_id = (SELECT id FROM leads WHERE business_name = ?)', ['ABC School']);
      if (intRows.length === 0) throw new Error('Interaction was not inserted into database');
      const leadRows = db.query('SELECT last_contact_at, next_follow_up_at FROM leads WHERE business_name = ?', ['ABC School']);
      if (!leadRows[0].last_contact_at) throw new Error('last_contact_at was not updated on lead');
    }
  },
  {
    id: 'TEST-018',
    category: 'Interaction History',
    message: 'Add a note that ABC School wants the website next month',
    description: 'Add a note interaction to an existing lead',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_5_Interaction_History',
    setup: (db, test) => {
      db.seedLead({ business_name: 'ABC School', status: 'CONTACTED' });
    },
    expectedRoute: 'Find Lead By Name -> Insert Note -> Update Last Contact -> Build Note Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('Note added')) {
        throw new Error(`Expected note confirmation, got: ${JSON.stringify(msg)}`);
      }
      const intRows = db.query("SELECT * FROM interactions WHERE interaction_type = 'NOTE'");
      if (intRows.length === 0) throw new Error('Note interaction was not inserted');
    }
  },
  {
    id: 'TEST-019',
    category: 'Interaction History',
    message: 'Show my history with ABC School',
    description: 'Fetch and format chronological interaction history for a lead',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_5_Interaction_History',
    setup: (db, test) => {
      const lead = db.seedLead({ business_name: 'ABC School' });
      db.seedInteraction({ lead_id: lead.id, interaction_type: 'CALL', content: 'Introductory discovery call' });
      db.seedInteraction({ lead_id: lead.id, interaction_type: 'NOTE', content: 'Requested formal quote' });
    },
    expectedRoute: 'Find Lead By Name -> Select History -> Format History',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('History — ABC School') || !msg.text.includes('Introductory discovery call')) {
        throw new Error(`Expected history list for ABC School, got: ${JSON.stringify(msg)}`);
      }
    }
  },

  // =========================================================================
  // 4. Follow-up Management (LEVEL_6)
  // =========================================================================
  {
    id: 'TEST-020',
    category: 'Follow-up Management',
    message: 'Remind me to call ABC School tomorrow at 10 AM',
    description: 'Create a new follow-up reminder for a lead',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_6_Followup_Management',
    setup: (db, test) => {
      db.seedLead({ business_name: 'ABC School', status: 'CONTACTED' });
    },
    expectedRoute: 'Find Lead By Name -> Compute Due Date -> Upsert Followup -> Sync Lead Next Follow Up -> Create Calendar Event',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('Follow-up for') || !msg.text.includes('set for')) {
        throw new Error(`Expected follow-up created confirmation, got: ${JSON.stringify(msg)}`);
      }
      const fuRows = db.query('SELECT * FROM follow_ups WHERE lead_id = (SELECT id FROM leads WHERE business_name = ?)', ['ABC School']);
      if (fuRows.length === 0) throw new Error('Follow-up was not inserted');
      if (fuRows[0].status !== 'PENDING') throw new Error(`Expected status PENDING, got ${fuRows[0].status}`);
    }
  },
  {
    id: 'TEST-021',
    category: 'Follow-up Management',
    message: 'Completed follow-up with ABC School',
    description: 'Mark pending follow-up as complete',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_6_Followup_Management',
    setup: (db, test) => {
      const lead = db.seedLead({ business_name: 'ABC School', status: 'NEW' });
      db.seedFollowUp({ lead_id: lead.id, status: 'PENDING' });
    },
    expectedRoute: 'Find Pending Followup -> Complete Followup -> Clear Lead Next Follow Up -> Build Complete Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('marked complete')) {
        throw new Error(`Expected complete confirmation, got: ${JSON.stringify(msg)}`);
      }
      const fuRows = db.query('SELECT status FROM follow_ups WHERE lead_id = (SELECT id FROM leads WHERE business_name = ?)', ['ABC School']);
      if (fuRows[0].status !== 'COMPLETED') throw new Error(`Expected status COMPLETED, got ${fuRows[0].status}`);
    }
  },
  {
    id: 'TEST-022',
    category: 'Follow-up Management',
    message: 'Show my follow-ups',
    description: 'List all pending follow-up reminders',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_6_Followup_Management',
    setup: (db, test) => {
      const l1 = db.seedLead({ business_name: 'Omega LLC' });
      const l2 = db.seedLead({ business_name: 'Apex Studio' });
      db.seedFollowUp({ lead_id: l1.id, due_at: new Date(Date.now() + 86400000).toISOString() });
      db.seedFollowUp({ lead_id: l2.id, due_at: new Date(Date.now() + 172800000).toISOString() });
    },
    expectedRoute: 'Route Followup Command (LIST_FOLLOW_UPS) -> Query Follow-ups -> Format Follow-up List',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('Omega LLC') || !msg.text.includes('Apex Studio')) {
        throw new Error(`Expected follow-ups list, got: ${JSON.stringify(msg)}`);
      }
    }
  },
  {
    id: 'TEST-023',
    category: 'Follow-up Management',
    message: 'Cancel the ABC School follow-up',
    description: 'Cancel an active pending follow-up',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_6_Followup_Management',
    setup: (db, test) => {
      const lead = db.seedLead({ business_name: 'ABC School', next_follow_up_at: '2026-09-05' });
      db.seedFollowUp({ lead_id: lead.id, status: 'PENDING' });
    },
    expectedRoute: 'Find Pending Followup (Cancel) -> Cancel Followup -> Clear Lead Next Follow Up (Cancel) -> Build Cancel Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('cancelled')) {
        throw new Error(`Expected cancel confirmation, got: ${JSON.stringify(msg)}`);
      }
      const fuRows = db.query('SELECT status FROM follow_ups WHERE lead_id = (SELECT id FROM leads WHERE business_name = ?)', ['ABC School']);
      if (fuRows[0].status !== 'CANCELLED') throw new Error(`Expected status CANCELLED, got ${fuRows[0].status}`);
    }
  },

  // =========================================================================
  // 5. Follow-up Callbacks (LEVEL_7_Followup_Callback)
  // =========================================================================
  {
    id: 'TEST-024',
    category: 'Follow-up Callbacks',
    isCallback: true,
    description: 'User taps YES on Telegram inline reminder callback',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL',
    setup: (db, test) => {
      const lead = db.seedLead({ business_name: 'ABC School', status: 'CONTACTED' });
      const fu = db.seedFollowUp({ lead_id: lead.id, status: 'PENDING' });
      test.callbackData = `fu:${fu.id}:${lead.id}:Y`;
    },
    expectedRoute: 'Route Callback Prefix (fu:) -> Execute Followup Callback -> Mark Completed And Update Lead -> Build Yes Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages.find(m => m.nodeName === 'Edit Reminder Message') || runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('REPLIED') || !msg.text.includes('ABC School')) {
        throw new Error(`Expected YES callback confirmation, got: ${JSON.stringify(msg)}`);
      }
      const fuRows = db.query("SELECT status FROM follow_ups WHERE status = 'COMPLETED'");
      if (fuRows.length === 0) throw new Error('Expected follow_up status COMPLETED');
      const leadRows = db.query('SELECT status FROM leads WHERE business_name = ?', ['ABC School']);
      if (leadRows[0].status !== 'REPLIED') throw new Error(`Expected lead status REPLIED, got ${leadRows[0].status}`);
    }
  },
  {
    id: 'TEST-025',
    category: 'Follow-up Callbacks',
    isCallback: true,
    description: 'User taps NO on Telegram inline reminder callback (snoozes/creates next reminder)',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL',
    setup: (db, test) => {
      const lead = db.seedLead({ business_name: 'ABC School', status: 'CONTACTED' });
      const fu = db.seedFollowUp({ lead_id: lead.id, status: 'PENDING', attempt_number: 1 });
      test.callbackData = `fu:${fu.id}:${lead.id}:N`;
    },
    expectedRoute: 'Route Callback Prefix (fu:) -> Execute Followup Callback -> Create Next Followup -> Sync Lead Next Follow Up -> Build No Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages.find(m => m.nodeName === 'Edit Reminder Message') || runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('Next reminder') || !msg.text.includes('ABC School')) {
        throw new Error(`Expected NO callback confirmation, got: ${JSON.stringify(msg)}`);
      }
      const oldFu = db.query("SELECT status FROM follow_ups WHERE status = 'CANCELLED'");
      if (oldFu.length === 0) throw new Error('Expected old follow-up to be CANCELLED');
    }
  },

  // =========================================================================
  // 6. Follow-up Scheduler (LEVEL_7_Followup_Scheduler)
  // =========================================================================
  {
    id: 'TEST-026',
    category: 'Follow-up Scheduler',
    description: 'Scheduled job checks overdue/due followups and sends Telegram reminder',
    workflow: 'LEVEL_7_Followup_Scheduler',
    triggerData: {},
    setup: (db, test) => {
      const lead = db.seedLead({ business_name: 'Due School' });
      db.seedFollowUp({ lead_id: lead.id, due_at: new Date(Date.now() - 3600000).toISOString(), status: 'PENDING' });
    },
    expectedRoute: 'Get Due Followups -> Snooze To Avoid Duplicate Send -> Build Reminder Payload -> Send Reminder',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('FOLLOW-UP DUE') || !msg.text.includes('Due School')) {
        throw new Error(`Expected reminder message for Due School, got: ${JSON.stringify(msg)}`);
      }
    }
  },

  // =========================================================================
  // 7. Daily Priorities (LEVEL_8)
  // =========================================================================
  {
    id: 'TEST-027',
    category: 'Daily Priorities',
    message: 'What should I do today?',
    description: 'On-demand daily priorities summary',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_8_Daily_Priorities',
    setup: (db, test) => {
      db.seedLead({ business_name: 'High Lead', status: 'PROPOSAL_SENT', deal_value: 80000, next_follow_up_at: new Date().toISOString() });
    },
    expectedRoute: 'AI Router -> Execute Daily Priorities -> Query Priorities -> Pipeline Total -> Format Daily Priorities',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes("TODAY'S PRIORITIES") || !msg.text.includes('High Lead')) {
        throw new Error(`Expected Daily Priorities report, got: ${JSON.stringify(msg)}`);
      }
      if (!msg.text.includes('Pipeline: INR 80,000')) {
        throw new Error(`Expected Pipeline total in message, got: ${msg.text}`);
      }
    }
  },

  // =========================================================================
  // 8. Analytics (LEVEL_9)
  // =========================================================================
  {
    id: 'TEST-028',
    category: 'Analytics',
    message: 'Show my pipeline',
    description: 'Pipeline analytics report grouped by status',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_9_Analytics',
    setup: (db, test) => {
      db.seedLead({ business_name: 'Lead 1', status: 'QUALIFIED', deal_value: 30000 });
      db.seedLead({ business_name: 'Lead 2', status: 'PROPOSAL_SENT', deal_value: 50000 });
    },
    expectedRoute: 'AI Router -> Execute Analytics -> Pipeline Query -> Format Pipeline Report',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('Pipeline') || !msg.text.includes('Total active pipeline')) {
        throw new Error(`Expected pipeline analytics report, got: ${JSON.stringify(msg)}`);
      }
      if (!msg.text.includes('80,000')) {
        throw new Error(`Expected total 80,000 in pipeline report, got: ${msg.text}`);
      }
    }
  },
  {
    id: 'TEST-029',
    category: 'Analytics',
    message: 'Show my revenue this month',
    description: 'Revenue analytics report for WON deals',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_9_Analytics',
    setup: (db, test) => {
      db.seedLead({ business_name: 'Won Client', status: 'WON', deal_value: 120000, won_at: new Date().toISOString() });
    },
    expectedRoute: 'AI Router -> Execute Analytics -> Revenue Query -> Format Revenue Report',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('Revenue — This Month') || !msg.text.includes('1,20,000')) {
        throw new Error(`Expected revenue report, got: ${JSON.stringify(msg)}`);
      }
    }
  },
  {
    id: 'TEST-030',
    category: 'Analytics',
    message: 'Show lead stats and conversion rate',
    description: 'Lead conversion and volume analytics report',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_9_Analytics',
    setup: (db, test) => {
      db.seedLead({ business_name: 'Client 1', status: 'WON', deal_value: 50000, won_at: new Date().toISOString() });
      db.seedLead({ business_name: 'Client 2', status: 'LOST', deal_value: 20000 });
      db.seedLead({ business_name: 'Client 3', status: 'NEW', deal_value: 10000 });
    },
    expectedRoute: 'AI Router -> Execute Analytics -> Lead Analytics Query -> Format Lead Report',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('Lead Stats') || !msg.text.includes('Win rate')) {
        throw new Error(`Expected lead stats report, got: ${JSON.stringify(msg)}`);
      }
    }
  },

  // =========================================================================
  // 9. Human Approval Flow (LEVEL_10)
  // =========================================================================
  {
    id: 'TEST-031',
    category: 'Human Approval Flow',
    isCallback: true,
    description: 'Human approval callback — tap Approve (A)',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL',
    setup: (db, test) => {
      const lead = db.seedLead({ business_name: 'Big Client', status: 'PROPOSAL_SENT', updated_at: new Date().toISOString() });
      const v = new Date(lead.updated_at).toISOString().replace(/[:]/g, '');
      test.callbackData = `appr:${lead.id}:status:WON:${v}:987654321:A`;
    },
    expectedRoute: 'Route Callback Prefix (appr:) -> Execute Approval Callback -> Apply Approved Change -> Build Approve Message',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages.find(m => m.nodeName === 'Edit Approval Message') || runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !/approved/i.test(msg.text) || !msg.text.includes('Big Client')) {
        throw new Error(`Expected approval confirmation, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query('SELECT status FROM leads WHERE business_name = ?', ['Big Client']);
      if (rows[0].status !== 'WON') throw new Error(`Expected status WON, got ${rows[0].status}`);
    }
  },
  {
    id: 'TEST-032',
    category: 'Human Approval Flow',
    isCallback: true,
    description: 'Human approval callback — tap Reject (R)',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL',
    setup: (db, test) => {
      const lead = db.seedLead({ business_name: 'Big Client', status: 'PROPOSAL_SENT', updated_at: new Date().toISOString() });
      const v = new Date(lead.updated_at).toISOString().replace(/[:]/g, '');
      test.callbackData = `appr:${lead.id}:status:WON:${v}:987654321:R`;
    },
    expectedRoute: 'Route Callback Prefix (appr:) -> Execute Approval Callback -> Build Reject Message',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages.find(m => m.nodeName === 'Edit Approval Message') || runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !/rejected/i.test(msg.text)) {
        throw new Error(`Expected rejection confirmation, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query('SELECT status FROM leads WHERE business_name = ?', ['Big Client']);
      if (rows[0].status !== 'PROPOSAL_SENT') throw new Error(`Status should remain PROPOSAL_SENT on rejection, got ${rows[0].status}`);
    }
  },

  // =========================================================================
  // 10. Multi-Turn Clarification (Pending Actions)
  // =========================================================================
  {
    id: 'TEST-033',
    category: 'Multi-Turn Clarification',
    message: 'Add a lead',
    description: 'Turn 1: Incomplete command missing business_name -> bot asks for name and saves pending action',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL',
    expectedRoute: 'Execute AI Command Router -> Needs Clarification -> Should Save Pending -> Upsert Pending Action -> Build Clarification Message',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes("What's the business name?")) {
        throw new Error(`Expected clarification question about business name, got: ${JSON.stringify(msg)}`);
      }
      const pending = db.query('SELECT * FROM pending_actions WHERE chat_id = ?', ['987654321']);
      if (pending.length === 0) throw new Error('Pending action was not saved to database');
      if (pending[0].command !== 'ADD_LEAD') throw new Error(`Expected pending command ADD_LEAD, got ${pending[0].command}`);
    }
  },
  {
    id: 'TEST-034',
    category: 'Multi-Turn Clarification',
    message: 'Zenith Academy',
    description: 'Turn 2: User provides the missing business name -> bot creates lead and clears pending action',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL',
    setup: (db, test) => {
      db.seedPendingAction({
        chat_id: '987654321',
        command: 'ADD_LEAD',
        parameters: { deal_value: 45000 },
        missing: ['business_name']
      });
    },
    expectedRoute: 'Check Pending Action -> Has Pending Action (True) -> Merge Pending Answer -> Execute Lead Management -> Insert Lead',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('Lead added') || !msg.text.includes('Zenith Academy')) {
        throw new Error(`Expected lead added confirmation for Zenith Academy, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query('SELECT * FROM leads WHERE business_name = ?', ['Zenith Academy']);
      if (rows.length === 0) throw new Error('Zenith Academy lead was not found in database');
      if (rows[0].deal_value !== 45000) throw new Error(`Expected deal_value 45000, got ${rows[0].deal_value}`);
      const pending = db.query('SELECT * FROM pending_actions WHERE chat_id = ?', ['987654321']);
      if (pending.length > 0) throw new Error('Pending action was not cleared after completion');
    }
  },

  // =========================================================================
  // 11. Error Handling & Edge Cases
  // =========================================================================
  {
    id: 'TEST-035',
    category: 'Error Handling',
    message: 'asdkjfh qwoeiur nonsense',
    description: 'Unrecognized user message -> friendly guidance message',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL',
    expectedRoute: 'Execute AI Command Router (UNKNOWN) -> Needs Clarification -> Build Clarification Message',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes("didn't understand that") || !msg.text.includes('Try something like')) {
        throw new Error(`Expected guidance message for unknown command, got: ${JSON.stringify(msg)}`);
      }
    }
  },
  {
    id: 'TEST-036',
    category: 'Error Handling',
    message: 'Show my leads',
    description: 'AI service unreachable / API error -> graceful error message with chatId preserved',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL',
    aiMockOverride: () => {
      throw new Error('API connection timeout');
    },
    expectedRoute: 'LEVEL_3B: Parse and Validate AI Output (catch systemError) -> LEVEL_3: Build Clarification Message -> Send Clarification',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes("couldn't reach the AI service")) {
        throw new Error(`Expected AI service error message, got: ${JSON.stringify(msg)}`);
      }
      if (!msg.chatId || msg.chatId === 'undefined') {
        throw new Error(`chatId was not preserved on AI error: ${msg.chatId}`);
      }
    }
  },
  {
    id: 'TEST-037',
    category: 'Error Handling',
    message: 'Show my leads',
    updateId: 99999,
    description: 'Duplicate Telegram update_id guard (processed_updates idempotency check)',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL',
    setup: (db, test) => {
      db.query('INSERT INTO processed_updates (update_id) VALUES (?)', [99999]);
    },
    expectedRoute: 'Check Duplicate Update (Conflict) -> workflow handles duplicate safely',
    verify: async (runtime, db, result) => {
      const rows = db.query('SELECT * FROM processed_updates WHERE update_id = 99999');
      if (rows.length === 0) throw new Error('processed_updates should retain update_id');
    }
  },
  {
    id: 'TEST-038',
    category: 'Error Handling',
    description: 'Centralized Error Handler (LEVEL_11_Error_Handler) logs unhandled workflow error',
    workflow: 'LEVEL_11_Error_Handler',
    triggerData: {
      workflow: { name: 'Test Workflow' },
      node: { name: 'Test Node' },
      error: { message: 'Simulated runtime error' }
    },
    expectedRoute: 'Extract Error Context -> Log Error -> Send Error Alert',
    verify: async (runtime, db, result) => {
      const rows = db.query("SELECT * FROM error_log WHERE workflow_name = 'Test Workflow'");
      if (rows.length === 0) throw new Error('Error was not logged to error_log table');
      if (!rows[0].error_message.includes('Simulated runtime error')) {
        throw new Error(`Unexpected error_message in log: ${rows[0].error_message}`);
      }
    }
  },
  {
    id: 'TEST-039',
    category: 'Telegram Echo Bot',
    message: 'ping',
    description: 'LEVEL_2 Telegram Echo Bot test',
    workflow: 'LEVEL_2_Telegram_Test',
    expectedRoute: 'Extract Message -> Send Echo',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('You said: ping')) {
        throw new Error(`Expected echo message, got: ${JSON.stringify(msg)}`);
      }
    }
  },

  // =========================================================================
  // 12. Delete Functionality (LEVEL_4, LEVEL_5, LEVEL_6)
  // =========================================================================
  {
    id: 'TEST-040',
    category: 'Delete Functionality',
    message: 'delete all leads',
    description: 'Delete all leads request -> confirmation prompt only',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_4_Lead_Management',
    setup: (db, test) => {
      db.seedLead({ business_name: 'Lead 1' });
      db.seedLead({ business_name: 'Lead 2' });
    },
    expectedRoute: 'AI Router -> Execute Lead Management -> If Delete All Leads Confirmed (False) -> Prompt Delete All Leads Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('This will permanently delete all leads') || !msg.text.includes('CONFIRM DELETE ALL LEADS')) {
        throw new Error(`Expected confirmation prompt for delete all leads, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query('SELECT * FROM leads');
      if (rows.length !== 2) {
        throw new Error(`Leads should NOT be deleted before confirmation, found: ${rows.length}`);
      }
    }
  },
  {
    id: 'TEST-041',
    category: 'Delete Functionality',
    message: 'CONFIRM DELETE ALL LEADS',
    description: 'Exact confirmation -> all leads deleted',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_4_Lead_Management',
    setup: (db, test) => {
      db.seedLead({ business_name: 'Lead 1' });
      db.seedLead({ business_name: 'Lead 2' });
    },
    expectedRoute: 'AI Router -> Execute Lead Management -> If Delete All Leads Confirmed (True) -> Delete All Leads DB -> Build Delete All Leads Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('All leads and related records have been deleted')) {
        throw new Error(`Expected delete all leads success confirmation, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query('SELECT * FROM leads');
      if (rows.length !== 0) {
        throw new Error(`Expected 0 leads after deletion, found: ${rows.length}`);
      }
    }
  },
  {
    id: 'TEST-042',
    category: 'Delete Functionality',
    message: 'delete lead Makeup Academy',
    description: 'Delete specific lead request -> confirmation prompt only',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_4_Lead_Management',
    setup: (db, test) => {
      db.seedLead({ business_name: 'Makeup Academy' });
      db.seedLead({ business_name: 'Hair Studio' });
    },
    expectedRoute: 'AI Router -> Execute Lead Management -> If Delete Lead Confirmed (False) -> Prompt Delete Lead Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('Confirm deletion of lead "Makeup Academy"') || !msg.text.includes('CONFIRM DELETE LEAD MAKEUP ACADEMY')) {
        throw new Error(`Expected confirmation prompt for Makeup Academy, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query('SELECT * FROM leads');
      if (rows.length !== 2) {
        throw new Error(`Lead should NOT be deleted before confirmation, found: ${rows.length}`);
      }
    }
  },
  {
    id: 'TEST-043',
    category: 'Delete Functionality',
    message: 'CONFIRM DELETE LEAD MAKEUP ACADEMY',
    description: 'Exact confirmation -> only specified lead deleted',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_4_Lead_Management',
    setup: (db, test) => {
      db.seedLead({ business_name: 'Makeup Academy' });
      db.seedLead({ business_name: 'Hair Studio' });
    },
    expectedRoute: 'AI Router -> Execute Lead Management -> If Delete Lead Confirmed (True) -> Delete Lead From DB -> Build Delete Lead Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('Deleted lead "Makeup Academy"')) {
        throw new Error(`Expected delete lead success confirmation, got: ${JSON.stringify(msg)}`);
      }
      const makeupRows = db.query('SELECT * FROM leads WHERE business_name = ?', ['Makeup Academy']);
      if (makeupRows.length !== 0) throw new Error('Makeup Academy should have been deleted');
      const hairRows = db.query('SELECT * FROM leads WHERE business_name = ?', ['Hair Studio']);
      if (hairRows.length !== 1) throw new Error('Hair Studio should still exist');
    }
  },
  {
    id: 'TEST-044',
    category: 'Delete Functionality',
    message: 'delete all followups',
    description: 'Delete all followups request -> confirmation prompt only',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_6_Followup_Management',
    setup: (db, test) => {
      const l = db.seedLead({ business_name: 'Test Lead' });
      db.seedFollowUp({ lead_id: l.id });
    },
    expectedRoute: 'AI Router -> Execute Followup Management -> Is Delete All Followups -> If Delete All Followups Confirmed (False) -> Prompt Delete All Followups Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('This will permanently delete all follow-ups') || !msg.text.includes('CONFIRM DELETE ALL FOLLOWUPS')) {
        throw new Error(`Expected confirmation prompt for delete all followups, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query('SELECT * FROM follow_ups');
      if (rows.length !== 1) throw new Error('Follow-ups should not be deleted before confirmation');
    }
  },
  {
    id: 'TEST-045',
    category: 'Delete Functionality',
    message: 'CONFIRM DELETE ALL FOLLOWUPS',
    description: 'Exact confirmation -> all follow-ups deleted',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_6_Followup_Management',
    setup: (db, test) => {
      const l1 = db.seedLead({ business_name: 'Lead 1', next_follow_up_at: '2026-09-05' });
      const l2 = db.seedLead({ business_name: 'Lead 2', next_follow_up_at: '2026-09-06' });
      db.seedFollowUp({ lead_id: l1.id });
      db.seedFollowUp({ lead_id: l2.id });
    },
    expectedRoute: 'AI Router -> Execute Followup Management -> Delete All Followups DB -> Clear All Leads Next Followup DB -> Build Delete All Followups Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('All follow-ups have been deleted')) {
        throw new Error(`Expected all follow-ups deleted message, got: ${JSON.stringify(msg)}`);
      }
      const fuRows = db.query('SELECT * FROM follow_ups');
      if (fuRows.length !== 0) throw new Error('Expected 0 follow-ups remaining');
      const leadRows = db.query('SELECT next_follow_up_at FROM leads WHERE next_follow_up_at IS NOT NULL');
      if (leadRows.length !== 0) throw new Error('Lead next_follow_up_at should be reset to NULL');
    }
  },
  {
    id: 'TEST-046',
    category: 'Delete Functionality',
    message: 'delete followup for Makeup Academy',
    description: 'Delete followup for specific lead -> deletes follow-up and updates lead',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_6_Followup_Management',
    setup: (db, test) => {
      const l = db.seedLead({ business_name: 'Makeup Academy', next_follow_up_at: '2026-09-10' });
      db.seedFollowUp({ lead_id: l.id, status: 'PENDING' });
    },
    expectedRoute: 'AI Router -> Execute Followup Management -> Find Lead By Name -> Route Followup Command -> Find Pending Followup (Delete) -> Delete Followup DB -> Clear Lead Next Follow Up (Delete) -> Build Delete Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('Follow-up for') || !msg.text.includes('deleted')) {
        throw new Error(`Expected follow-up deleted confirmation, got: ${JSON.stringify(msg)}`);
      }
      const fuRows = db.query('SELECT * FROM follow_ups WHERE lead_id = (SELECT id FROM leads WHERE business_name = ?)', ['Makeup Academy']);
      if (fuRows.length !== 0) throw new Error('Follow-up was not deleted');
      const leadRows = db.query('SELECT next_follow_up_at FROM leads WHERE business_name = ?', ['Makeup Academy']);
      if (leadRows[0].next_follow_up_at) throw new Error('Lead next_follow_up_at should be cleared');
    }
  },
  {
    id: 'TEST-047',
    category: 'Delete Functionality',
    message: 'delete Makeup Academy',
    description: 'Ambiguous delete command -> bot asks whether to delete lead, follow-up, or both',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL',
    expectedRoute: 'AI Router (AMBIGUOUS_DELETE) -> Needs Clarification -> Build Clarification Message -> Send Clarification',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('Do you want to delete the lead "Makeup Academy"') || !msg.text.includes('delete followup for Makeup Academy')) {
        throw new Error(`Expected ambiguous delete clarification question, got: ${JSON.stringify(msg)}`);
      }
    }
  },
  {
    id: 'TEST-048',
    category: 'Delete Functionality',
    message: 'delete everything',
    description: 'Delete everything request -> confirmation required before deletion',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_4_Lead_Management',
    setup: (db, test) => {
      const l = db.seedLead({ business_name: 'Lead 1' });
      db.seedInteraction({ lead_id: l.id, content: 'Spoke with lead' });
      db.seedFollowUp({ lead_id: l.id });
    },
    expectedRoute: 'AI Router -> Execute Lead Management -> If Delete Everything Confirmed (False) -> Prompt Delete Everything Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('This will permanently delete all data') || !msg.text.includes('CONFIRM DELETE EVERYTHING')) {
        throw new Error(`Expected confirmation prompt for delete everything, got: ${JSON.stringify(msg)}`);
      }
      const leads = db.query('SELECT * FROM leads');
      if (leads.length === 0) throw new Error('Data should NOT be deleted before confirmation');
    }
  },
  {
    id: 'TEST-049',
    category: 'Delete Functionality',
    message: 'CONFIRM DELETE EVERYTHING',
    description: 'Exact confirmation -> all data permanently deleted',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_4_Lead_Management',
    setup: (db, test) => {
      const l = db.seedLead({ business_name: 'Lead 1' });
      db.seedInteraction({ lead_id: l.id, content: 'Spoke with lead' });
      db.seedFollowUp({ lead_id: l.id });
    },
    expectedRoute: 'AI Router -> Execute Lead Management -> If Delete Everything Confirmed (True) -> Delete Everything DB -> Build Delete Everything Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('All system data (leads, follow-ups, interactions) has been permanently deleted')) {
        throw new Error(`Expected delete everything success message, got: ${JSON.stringify(msg)}`);
      }
      const leads = db.query('SELECT * FROM leads');
      if (leads.length !== 0) throw new Error('Expected 0 leads');
    }
  },
  {
    id: 'TEST-050',
    category: 'Delete Functionality',
    message: 'delete all interactions',
    description: 'Delete all interactions request -> confirmation prompt only',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_5_Interaction_History',
    setup: (db, test) => {
      const l = db.seedLead({ business_name: 'Lead 1' });
      db.seedInteraction({ lead_id: l.id, content: 'Met lead' });
    },
    expectedRoute: 'AI Router -> Execute Interaction History -> Is Delete All Interactions -> If Delete All Interactions Confirmed (False) -> Prompt Delete All Interactions Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('This will permanently delete all interaction history') || !msg.text.includes('CONFIRM DELETE ALL INTERACTIONS')) {
        throw new Error(`Expected confirmation prompt for delete all interactions, got: ${JSON.stringify(msg)}`);
      }
      const ints = db.query('SELECT * FROM interactions');
      if (ints.length === 0) throw new Error('Interactions should NOT be deleted before confirmation');
    }
  },
  {
    id: 'TEST-051',
    category: 'Delete Functionality',
    message: 'CONFIRM DELETE ALL INTERACTIONS',
    description: 'Exact confirmation -> all interactions deleted',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_5_Interaction_History',
    setup: (db, test) => {
      const l = db.seedLead({ business_name: 'Lead 1' });
      db.seedInteraction({ lead_id: l.id, content: 'Met lead' });
    },
    expectedRoute: 'AI Router -> Execute Interaction History -> Is Delete All Interactions -> If Delete All Interactions Confirmed (True) -> Delete All Interactions DB -> Build Delete All Interactions Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('All interaction history has been deleted')) {
        throw new Error(`Expected delete all interactions success message, got: ${JSON.stringify(msg)}`);
      }
      const ints = db.query('SELECT * FROM interactions');
      if (ints.length !== 0) throw new Error('Expected 0 interactions after deletion');
    }
  },
  {
    id: 'TEST-052',
    category: 'Delete Functionality',
    message: 'delete every lead',
    description: 'Natural variation: "delete every lead" -> confirmation prompt only',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_4_Lead_Management',
    setup: (db, test) => {
      db.seedLead({ business_name: 'Lead 1' });
    },
    expectedRoute: 'AI Router -> Execute Lead Management -> Prompt Delete All Leads Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('This will permanently delete all leads') || !msg.text.includes('CONFIRM DELETE ALL LEADS')) {
        throw new Error(`Expected confirmation prompt for delete every lead, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query('SELECT * FROM leads');
      if (rows.length !== 1) throw new Error('Lead should not be deleted before confirmation');
    }
  },
  {
    id: 'TEST-053',
    category: 'Delete Functionality',
    message: 'remove lead Makeup Academy',
    description: 'Natural variation: "remove lead Makeup Academy" -> confirmation prompt only',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_4_Lead_Management',
    setup: (db, test) => {
      db.seedLead({ business_name: 'Makeup Academy' });
    },
    expectedRoute: 'AI Router -> Execute Lead Management -> Prompt Delete Lead Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('Confirm deletion of lead "Makeup Academy"') || !msg.text.includes('CONFIRM DELETE LEAD MAKEUP ACADEMY')) {
        throw new Error(`Expected confirmation prompt for remove lead Makeup Academy, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query('SELECT * FROM leads');
      if (rows.length !== 1) throw new Error('Lead should not be deleted before confirmation');
    }
  },
  {
    id: 'TEST-054',
    category: 'Delete Functionality',
    message: 'delete all follow-ups',
    description: 'Natural variation: "delete all follow-ups" -> confirmation prompt only',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_6_Followup_Management',
    setup: (db, test) => {
      const l = db.seedLead({ business_name: 'Lead 1' });
      db.seedFollowUp({ lead_id: l.id });
    },
    expectedRoute: 'AI Router -> Execute Followup Management -> Prompt Delete All Followups Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('This will permanently delete all follow-ups') || !msg.text.includes('CONFIRM DELETE ALL FOLLOWUPS')) {
        throw new Error(`Expected confirmation prompt for delete all follow-ups, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query('SELECT * FROM follow_ups');
      if (rows.length !== 1) throw new Error('Follow-ups should not be deleted before confirmation');
    }
  },
  {
    id: 'TEST-055',
    category: 'Delete Functionality',
    message: 'remove all followups',
    description: 'Natural variation: "remove all followups" -> confirmation prompt only',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_6_Followup_Management',
    setup: (db, test) => {
      const l = db.seedLead({ business_name: 'Lead 1' });
      db.seedFollowUp({ lead_id: l.id });
    },
    expectedRoute: 'AI Router -> Execute Followup Management -> Prompt Delete All Followups Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('This will permanently delete all follow-ups') || !msg.text.includes('CONFIRM DELETE ALL FOLLOWUPS')) {
        throw new Error(`Expected confirmation prompt for remove all followups, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query('SELECT * FROM follow_ups');
      if (rows.length !== 1) throw new Error('Follow-ups should not be deleted before confirmation');
    }
  },
  {
    id: 'TEST-056',
    category: 'Delete Functionality',
    message: 'cancel followup for Makeup Academy',
    description: 'Natural variation: "cancel followup for Makeup Academy" -> correct cancellation/deletion',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_6_Followup_Management',
    setup: (db, test) => {
      const l = db.seedLead({ business_name: 'Makeup Academy', next_follow_up_at: '2026-09-10' });
      db.seedFollowUp({ lead_id: l.id, status: 'PENDING' });
    },
    expectedRoute: 'AI Router -> Execute Followup Management -> Cancel/Delete follow-up',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || (!msg.text.includes('deleted') && !msg.text.includes('cancelled'))) {
        throw new Error(`Expected cancel/delete confirmation, got: ${JSON.stringify(msg)}`);
      }
      const fuRows = db.query("SELECT * FROM follow_ups WHERE lead_id = (SELECT id FROM leads WHERE business_name = 'Makeup Academy') AND status = 'PENDING'");
      if (fuRows.length !== 0) throw new Error('Pending follow-up should no longer be PENDING');
    }
  },

  // =========================================================================
  // 13. Standalone Notes (LEVEL_12)
  // =========================================================================
  {
    id: 'TEST-057',
    category: 'Standalone Notes',
    message: 'note down check out Tailwind CSS v4',
    description: 'Add simple standalone note -> creates exactly one note in standalone_notes',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_12_Standalone_Notes',
    expectedRoute: 'AI Router -> Execute Standalone Notes -> Insert Standalone Note -> Format Add Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('Note saved')) {
        throw new Error(`Expected note saved confirmation, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query('SELECT * FROM standalone_notes WHERE user_id = ?', ['987654321']);
      if (rows.length !== 1) throw new Error(`Expected 1 standalone note, found ${rows.length}`);
      if (!rows[0].content.includes('Tailwind CSS v4')) throw new Error(`Unexpected note content: ${rows[0].content}`);
    }
  },
  {
    id: 'TEST-058',
    category: 'Standalone Notes',
    message: 'note down this\n\nfollow up for monday\ncbs school\nvk photography\nmghs school',
    description: 'Add multiline standalone note -> creates exactly ONE note preserving line breaks',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_12_Standalone_Notes',
    expectedRoute: 'AI Router -> Execute Standalone Notes -> Insert Standalone Note -> Format Add Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('Note saved')) {
        throw new Error(`Expected note saved confirmation, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query('SELECT * FROM standalone_notes WHERE user_id = ?', ['987654321']);
      if (rows.length !== 1) throw new Error(`Expected exactly 1 note, found ${rows.length}`);
      const content = rows[0].content;
      if (!content.includes('follow up for monday') || !content.includes('cbs school') || !content.includes('vk photography') || !content.includes('mghs school')) {
        throw new Error(`Note content did not preserve all multiline items: ${content}`);
      }
    }
  },
  {
    id: 'TEST-059',
    category: 'Standalone Notes',
    message: 'show my notes',
    description: 'List standalone notes -> numbered list for current user',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_12_Standalone_Notes',
    setup: (db, test) => {
      db.query("INSERT INTO standalone_notes (user_id, content) VALUES ('987654321', 'Note item 1')");
      db.query("INSERT INTO standalone_notes (user_id, content) VALUES ('987654321', 'Note item 2')");
    },
    expectedRoute: 'AI Router -> Execute Standalone Notes -> Query Standalone Notes -> Format Notes List',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('YOUR NOTES') || !msg.text.includes('Note item 1') || !msg.text.includes('Note item 2')) {
        throw new Error(`Expected formatted notes list, got: ${JSON.stringify(msg)}`);
      }
    }
  },
  {
    id: 'TEST-060',
    category: 'Standalone Notes',
    message: 'delete note 1',
    description: 'Delete one standalone note -> removes note and returns confirmation',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_12_Standalone_Notes',
    setup: (db, test) => {
      db.query("INSERT INTO standalone_notes (id, user_id, content) VALUES (1, '987654321', 'To be deleted')");
    },
    expectedRoute: 'AI Router -> Execute Standalone Notes -> Delete Standalone Note -> Format Delete Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('deleted')) {
        throw new Error(`Expected delete confirmation, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query('SELECT * FROM standalone_notes WHERE id = 1');
      if (rows.length !== 0) throw new Error('Note was not deleted from database');
    }
  },
  {
    id: 'TEST-061',
    category: 'Standalone Notes',
    message: 'delete note 9999',
    description: 'Attempt deletion with non-existent note ID -> returns not found message',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_12_Standalone_Notes',
    expectedRoute: 'AI Router -> Execute Standalone Notes -> Delete Standalone Note -> Format Delete Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('not found')) {
        throw new Error(`Expected note not found message, got: ${JSON.stringify(msg)}`);
      }
    }
  },
  {
    id: 'TEST-062',
    category: 'Standalone Notes',
    message: 'delete note 1',
    description: 'User isolation -> user cannot delete a note belonging to another user',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_12_Standalone_Notes',
    setup: (db, test) => {
      db.query("INSERT INTO standalone_notes (id, user_id, content) VALUES (1, 'OTHER_USER_777', 'Private Note')");
    },
    expectedRoute: 'AI Router -> Execute Standalone Notes -> Delete Standalone Note -> Format Delete Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('not found')) {
        throw new Error(`Expected note not found / unauthorized message, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query("SELECT * FROM standalone_notes WHERE id = 1 AND user_id = 'OTHER_USER_777'");
      if (rows.length !== 1) throw new Error('Other user note should remain untouched in database');
    }
  },
  {
    id: 'TEST-063',
    category: 'Standalone Notes',
    message: 'delete all notes',
    description: 'Delete all notes unconfirmed -> prompts for confirmation',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_12_Standalone_Notes',
    setup: (db, test) => {
      db.query("INSERT INTO standalone_notes (user_id, content) VALUES ('987654321', 'Note A')");
      db.query("INSERT INTO standalone_notes (user_id, content) VALUES ('987654321', 'Note B')");
    },
    expectedRoute: 'AI Router -> Execute Standalone Notes -> Check Confirm Delete All -> Format Confirm Prompt',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('CONFIRM DELETE ALL NOTES')) {
        throw new Error(`Expected confirmation prompt, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query("SELECT * FROM standalone_notes WHERE user_id = '987654321'");
      if (rows.length !== 2) throw new Error('Notes must not be deleted before confirmation');
    }
  },
  {
    id: 'TEST-064',
    category: 'Standalone Notes',
    message: 'CONFIRM DELETE ALL NOTES',
    description: 'Delete all notes confirmed -> removes only current user notes',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_12_Standalone_Notes',
    setup: (db, test) => {
      db.query("INSERT INTO standalone_notes (user_id, content) VALUES ('987654321', 'User 1 Note')");
      db.query("INSERT INTO standalone_notes (user_id, content) VALUES ('OTHER_USER', 'User 2 Note')");
    },
    expectedRoute: 'AI Router -> Execute Standalone Notes -> Delete All Notes Query -> Format Delete All Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('cleared') && !msg.text.includes('Deleted')) {
        throw new Error(`Expected delete all confirmation, got: ${JSON.stringify(msg)}`);
      }
      const userRows = db.query("SELECT * FROM standalone_notes WHERE user_id = '987654321'");
      if (userRows.length !== 0) throw new Error('Current user notes should be deleted');
      const otherRows = db.query("SELECT * FROM standalone_notes WHERE user_id = 'OTHER_USER'");
      if (otherRows.length !== 1) throw new Error('Other user notes should be preserved');
    }
  },

  // =========================================================================
  // 14. Standalone Reminders (LEVEL_13) with Google Calendar Integration
  // =========================================================================
  {
    id: 'TEST-065',
    category: 'Standalone Reminders',
    message: 'Remind me tomorrow at 3 PM to call John about the project.',
    description: 'Create personal reminder -> creates record in standalone_reminders, GCal event, and stores google_calendar_event_id',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_13_Standalone_Reminders',
    expectedRoute: 'AI Router -> Execute Standalone Reminders -> Insert Standalone Reminder -> Create Google Calendar Event -> Save GCal Event Id -> Format Create Success Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('Reminder set') || !msg.text.includes('Added to Google Calendar')) {
        throw new Error(`Expected reminder set confirmation with Google Calendar, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query("SELECT * FROM standalone_reminders WHERE user_id = '987654321'");
      if (rows.length !== 1) throw new Error(`Expected 1 reminder, found ${rows.length}`);
      if (!rows[0].content.includes('call John about the project')) throw new Error(`Unexpected reminder content: ${rows[0].content}`);
      if (!rows[0].google_calendar_event_id) throw new Error('google_calendar_event_id was not saved to database');

      // Verify Google Calendar event was dispatched
      const gcalEvents = runtime.calendarEvents.filter(e => e.operation === 'create');
      if (gcalEvents.length !== 1) throw new Error(`Expected 1 GCal create event, found ${gcalEvents.length}`);
      if (!gcalEvents[0].summary.includes('call John about the project')) throw new Error(`Unexpected GCal summary: ${gcalEvents[0].summary}`);
    }
  },
  {
    id: 'TEST-066',
    category: 'Standalone Reminders',
    message: 'Remind me on September 5 at 10 AM to send the proposal.',
    description: 'Create reminder with date/time -> creates GCal event and Telegram confirmation',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_13_Standalone_Reminders',
    expectedRoute: 'AI Router -> Execute Standalone Reminders -> Insert Standalone Reminder -> Create Google Calendar Event -> Save GCal Event Id -> Format Create Success Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('Reminder set') || !msg.text.includes('send the proposal')) {
        throw new Error(`Expected reminder set confirmation, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query("SELECT * FROM standalone_reminders WHERE user_id = '987654321'");
      if (rows.length !== 1) throw new Error(`Expected 1 reminder, found ${rows.length}`);
      if (!rows[0].google_calendar_event_id) throw new Error('google_calendar_event_id was not saved');
    }
  },
  {
    id: 'TEST-067',
    category: 'Standalone Reminders',
    message: 'show my reminders',
    description: 'List reminders -> shows formatted list with Google Calendar sync indicator',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_13_Standalone_Reminders',
    setup: (db, test) => {
      db.query("INSERT INTO standalone_reminders (user_id, chat_id, content, reminder_at, status, google_calendar_event_id) VALUES ('987654321', '987654321', 'Pay server bill', '2026-09-10T10:00:00Z', 'PENDING', 'gcal_event_123')");
    },
    expectedRoute: 'AI Router -> Execute Standalone Reminders -> Query Standalone Reminders -> Format Reminders List',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('YOUR REMINDERS') || !msg.text.includes('Pay server bill') || !msg.text.includes('Google Calendar')) {
        throw new Error(`Expected reminders list with Google Calendar tag, got: ${JSON.stringify(msg)}`);
      }
    }
  },
  {
    id: 'TEST-068',
    category: 'Standalone Reminders',
    message: 'delete reminder 1',
    description: 'Delete one reminder -> deletes PostgreSQL reminder AND corresponding Google Calendar event',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_13_Standalone_Reminders',
    setup: (db, test) => {
      db.query("INSERT INTO standalone_reminders (id, user_id, chat_id, content, reminder_at, status, google_calendar_event_id) VALUES (1, '987654321', '987654321', 'Delete me', '2026-09-10T10:00:00Z', 'PENDING', 'gcal_del_999')");
    },
    expectedRoute: 'AI Router -> Execute Standalone Reminders -> Find Reminder Before Delete -> Delete GCal Event -> Delete Standalone Reminder DB -> Format Delete Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('deleted')) {
        throw new Error(`Expected delete confirmation, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query('SELECT * FROM standalone_reminders WHERE id = 1');
      if (rows.length !== 0) throw new Error('Reminder should be deleted from database');

      // Verify Google Calendar event was deleted
      const gcalDeletes = runtime.calendarEvents.filter(e => e.operation === 'delete' && e.eventId === 'gcal_del_999');
      if (gcalDeletes.length !== 1) throw new Error('Corresponding Google Calendar event was not deleted');
    }
  },
  {
    id: 'TEST-069',
    category: 'Standalone Reminders',
    message: 'delete reminder 9999',
    description: 'Attempt invalid reminder deletion -> returns not found message',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_13_Standalone_Reminders',
    expectedRoute: 'AI Router -> Execute Standalone Reminders -> Find Reminder Before Delete -> Format Delete Not Found',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('not found')) {
        throw new Error(`Expected reminder not found message, got: ${JSON.stringify(msg)}`);
      }
    }
  },
  {
    id: 'TEST-070',
    category: 'Standalone Reminders',
    message: 'delete reminder 1',
    description: 'User isolation -> cannot delete reminder belonging to another user',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_13_Standalone_Reminders',
    setup: (db, test) => {
      db.query("INSERT INTO standalone_reminders (id, user_id, chat_id, content, reminder_at, status, google_calendar_event_id) VALUES (1, 'OTHER_USER_999', '11111', 'Private reminder', '2026-09-10T10:00:00Z', 'PENDING', 'other_gcal_evt')");
    },
    expectedRoute: 'AI Router -> Execute Standalone Reminders -> Find Reminder Before Delete -> Format Delete Not Found',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('not found')) {
        throw new Error(`Expected not found / unauthorized, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query("SELECT * FROM standalone_reminders WHERE id = 1 AND user_id = 'OTHER_USER_999'");
      if (rows.length !== 1) throw new Error('Other user reminder should remain in database');
      const gcalDeletes = runtime.calendarEvents.filter(e => e.operation === 'delete');
      if (gcalDeletes.length !== 0) throw new Error('Other user GCal event should not be deleted');
    }
  },
  {
    id: 'TEST-071',
    category: 'Standalone Reminders',
    message: 'delete all reminders',
    description: 'Delete all reminders unconfirmed -> prompts for confirmation',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_13_Standalone_Reminders',
    setup: (db, test) => {
      db.query("INSERT INTO standalone_reminders (user_id, chat_id, content, reminder_at, status) VALUES ('987654321', '987654321', 'R1', '2026-09-10T10:00:00Z', 'PENDING')");
    },
    expectedRoute: 'AI Router -> Execute Standalone Reminders -> Check Confirm Delete All -> Format Confirm Prompt',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('CONFIRM DELETE ALL REMINDERS')) {
        throw new Error(`Expected confirmation prompt, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query("SELECT * FROM standalone_reminders WHERE user_id = '987654321'");
      if (rows.length !== 1) throw new Error('Reminders should not be deleted before confirmation');
    }
  },
  {
    id: 'TEST-072',
    category: 'Standalone Reminders',
    message: 'CONFIRM DELETE ALL REMINDERS',
    description: 'Delete all reminders confirmed -> removes current user reminders and GCal events',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_13_Standalone_Reminders',
    setup: (db, test) => {
      db.query("INSERT INTO standalone_reminders (user_id, chat_id, content, reminder_at, status, google_calendar_event_id) VALUES ('987654321', '987654321', 'R1', '2026-09-10T10:00:00Z', 'PENDING', 'gcal_user1_evt')");
      db.query("INSERT INTO standalone_reminders (user_id, chat_id, content, reminder_at, status, google_calendar_event_id) VALUES ('OTHER_USER', '22222', 'R2', '2026-09-10T10:00:00Z', 'PENDING', 'gcal_user2_evt')");
    },
    expectedRoute: 'AI Router -> Execute Standalone Reminders -> Check Confirm Delete All -> Find All Reminders With GCal -> Delete All Reminders Query -> Format Delete All Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('cleared') && !msg.text.includes('Deleted')) {
        throw new Error(`Expected delete all confirmation, got: ${JSON.stringify(msg)}`);
      }
      const userRows = db.query("SELECT * FROM standalone_reminders WHERE user_id = '987654321'");
      if (userRows.length !== 0) throw new Error('Current user reminders should be deleted');
      const otherRows = db.query("SELECT * FROM standalone_reminders WHERE user_id = 'OTHER_USER'");
      if (otherRows.length !== 1) throw new Error('Other user reminders should be preserved');

      // Verify only user 1 GCal event was deleted
      const gcalDeletes = runtime.calendarEvents.filter(e => e.operation === 'delete' && e.eventId === 'gcal_user1_evt');
      if (gcalDeletes.length !== 1) throw new Error('User 1 GCal event was not deleted');
    }
  },
  {
    id: 'TEST-073',
    category: 'Standalone Reminders',
    message: 'Schedule Trigger (LEVEL_13_Reminder_Scheduler)',
    description: 'Scheduled reminder check -> sends notification and marks notified to prevent duplicates',
    workflow: 'LEVEL_13_Reminder_Scheduler',
    setup: (db, test) => {
      db.query("INSERT INTO standalone_reminders (id, user_id, chat_id, content, reminder_at, status) VALUES (10, '987654321', '987654321', 'Follow up with Vivek School', datetime('now', '-10 minutes'), 'PENDING')");
    },
    expectedRoute: 'Schedule Trigger -> Get Due Reminders -> Any Due -> Build Reminder Notification -> Send Reminder Message -> Mark Reminder Notified',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('REMINDER') || !msg.text.includes('Follow up with Vivek School')) {
        throw new Error(`Expected reminder notification, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query('SELECT * FROM standalone_reminders WHERE id = 10');
      if (rows[0].status !== 'COMPLETED' && !rows[0].notified_at) {
        throw new Error('Reminder should be marked notified/completed to prevent duplicate send');
      }
      // Scheduler should NOT create GCal events
      const gcalEvents = runtime.calendarEvents.filter(e => e.operation === 'create');
      if (gcalEvents.length !== 0) throw new Error('Scheduler should not create GCal events');
    }
  },
  {
    id: 'TEST-073B',
    category: 'Standalone Reminders',
    message: 'Remind me tomorrow at 5 PM to review contracts',
    description: 'Google Calendar API failure -> preserves PostgreSQL reminder, returns clear warning in Telegram',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_13_Standalone_Reminders',
    setup: (db, test) => {
      // Simulate GCal failure
      test._simulateGCalFailure = true;
    },
    expectedRoute: 'AI Router -> Execute Standalone Reminders -> Insert Standalone Reminder -> Create Google Calendar Event (Fails) -> Format Create Warning Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('Reminder set') || !msg.text.includes('Could not sync to Google Calendar')) {
        throw new Error(`Expected warning about GCal sync failure, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query("SELECT * FROM standalone_reminders WHERE user_id = '987654321'");
      if (rows.length !== 1) throw new Error('PostgreSQL reminder must remain saved even when GCal fails');
      if (rows[0].google_calendar_event_id) throw new Error('google_calendar_event_id should be null on failure');
    }
  },

  // =========================================================================
  // 15. Personal Daily Tasks (LEVEL_14)
  // =========================================================================
  {
    id: 'TEST-074',
    category: 'Personal Daily Tasks',
    message: 'tasks for Sep 5\n\nDSA\nDo n8n project\nComplete website',
    description: 'Create multi-item tasks for future date -> creates 3 separate records for 2026-09-05',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_14_Personal_Daily_Tasks',
    expectedRoute: 'AI Router -> Execute Personal Daily Tasks -> Bulk Insert Tasks -> Format Bulk Add Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('task(s) saved for 2026-09-05')) {
        throw new Error(`Expected 3 tasks saved confirmation, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query("SELECT * FROM personal_daily_tasks WHERE user_id = '987654321' AND task_date = '2026-09-05' ORDER BY id ASC");
      if (rows.length !== 3) throw new Error(`Expected 3 task records, found ${rows.length}`);
      if (rows[0].content !== 'DSA' || rows[1].content !== 'Do n8n project' || rows[2].content !== 'Complete website') {
        throw new Error(`Unexpected task contents: ${JSON.stringify(rows)}`);
      }
    }
  },
  {
    id: 'TEST-075',
    category: 'Personal Daily Tasks',
    message: "show today's tasks",
    description: "List tasks for today -> returns formatted numbered list",
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_14_Personal_Daily_Tasks',
    setup: (db, test) => {
      db.query("INSERT INTO personal_daily_tasks (user_id, chat_id, task_date, content, status) VALUES ('987654321', '987654321', '2026-09-03', 'Morning Yoga', 'PENDING')");
    },
    expectedRoute: 'AI Router -> Execute Personal Daily Tasks -> Query Tasks -> Format Tasks List',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('TASKS FOR 2026-09-03') || !msg.text.includes('Morning Yoga')) {
        throw new Error(`Expected tasks list for today, got: ${JSON.stringify(msg)}`);
      }
    }
  },
  {
    id: 'TEST-076',
    category: 'Personal Daily Tasks',
    message: 'show tasks for Sep 5',
    description: 'List tasks for future date -> returns tasks for 2026-09-05',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_14_Personal_Daily_Tasks',
    setup: (db, test) => {
      db.query("INSERT INTO personal_daily_tasks (user_id, chat_id, task_date, content, status) VALUES ('987654321', '987654321', '2026-09-05', 'Design System', 'PENDING')");
    },
    expectedRoute: 'AI Router -> Execute Personal Daily Tasks -> Query Tasks -> Format Tasks List',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('TASKS FOR 2026-09-05') || !msg.text.includes('Design System')) {
        throw new Error(`Expected future tasks list, got: ${JSON.stringify(msg)}`);
      }
    }
  },
  {
    id: 'TEST-077',
    category: 'Personal Daily Tasks',
    message: 'add task for Sep 5: Review website',
    description: 'Add single task for a date -> creates record in personal_daily_tasks',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_14_Personal_Daily_Tasks',
    expectedRoute: 'AI Router -> Execute Personal Daily Tasks -> Insert Single Task -> Format Single Add Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('Task added') || !msg.text.includes('Review website')) {
        throw new Error(`Expected task added confirmation, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query("SELECT * FROM personal_daily_tasks WHERE user_id = '987654321' AND task_date = '2026-09-05'");
      if (rows.length !== 1) throw new Error(`Expected 1 task for Sep 5, found ${rows.length}`);
    }
  },
  {
    id: 'TEST-078',
    category: 'Personal Daily Tasks',
    message: 'update task 2 to Complete CBS website',
    description: 'Update task content -> modifies record where id and user_id match',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_14_Personal_Daily_Tasks',
    setup: (db, test) => {
      db.query("INSERT INTO personal_daily_tasks (id, user_id, chat_id, task_date, content, status) VALUES (2, '987654321', '987654321', '2026-09-03', 'Old Task Content', 'PENDING')");
    },
    expectedRoute: 'AI Router -> Execute Personal Daily Tasks -> Update Task Query -> Format Update Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('updated') || !msg.text.includes('Complete CBS website')) {
        throw new Error(`Expected update confirmation, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query('SELECT * FROM personal_daily_tasks WHERE id = 2');
      if (rows[0].content !== 'Complete CBS website') throw new Error(`Task content was not updated: ${rows[0].content}`);
    }
  },
  {
    id: 'TEST-079',
    category: 'Personal Daily Tasks',
    message: 'complete task 2',
    description: 'Complete task -> marks status as COMPLETED',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_14_Personal_Daily_Tasks',
    setup: (db, test) => {
      db.query("INSERT INTO personal_daily_tasks (id, user_id, chat_id, task_date, content, status) VALUES (2, '987654321', '987654321', '2026-09-03', 'Deploy app', 'PENDING')");
    },
    expectedRoute: 'AI Router -> Execute Personal Daily Tasks -> Complete Task Query -> Format Complete Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('completed')) {
        throw new Error(`Expected completion confirmation, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query('SELECT * FROM personal_daily_tasks WHERE id = 2');
      if (rows[0].status !== 'COMPLETED') throw new Error(`Expected status COMPLETED, got: ${rows[0].status}`);
    }
  },
  {
    id: 'TEST-080',
    category: 'Personal Daily Tasks',
    message: 'delete task 2',
    description: 'Delete task -> removes task where id and user_id match',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_14_Personal_Daily_Tasks',
    setup: (db, test) => {
      db.query("INSERT INTO personal_daily_tasks (id, user_id, chat_id, task_date, content, status) VALUES (2, '987654321', '987654321', '2026-09-03', 'Trash me', 'PENDING')");
    },
    expectedRoute: 'AI Router -> Execute Personal Daily Tasks -> Delete Task Query -> Format Delete Task Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('deleted')) {
        throw new Error(`Expected delete confirmation, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query('SELECT * FROM personal_daily_tasks WHERE id = 2');
      if (rows.length !== 0) throw new Error('Task should be removed from database');
    }
  },
  {
    id: 'TEST-081',
    category: 'Personal Daily Tasks',
    message: 'delete task 2',
    description: 'User isolation -> cannot delete task belonging to another user',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_14_Personal_Daily_Tasks',
    setup: (db, test) => {
      db.query("INSERT INTO personal_daily_tasks (id, user_id, chat_id, task_date, content, status) VALUES (2, 'OTHER_USER_555', '99999', '2026-09-03', 'Secret task', 'PENDING')");
    },
    expectedRoute: 'AI Router -> Execute Personal Daily Tasks -> Delete Task Query -> Format Delete Task Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('not found')) {
        throw new Error(`Expected unauthorized / not found message, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query("SELECT * FROM personal_daily_tasks WHERE id = 2 AND user_id = 'OTHER_USER_555'");
      if (rows.length !== 1) throw new Error('Other user task must remain in database');
    }
  },
  {
    id: 'TEST-082',
    category: 'Personal Daily Tasks',
    message: 'delete all tasks for Sep 5',
    description: 'Delete all tasks unconfirmed -> prompts for confirmation',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_14_Personal_Daily_Tasks',
    setup: (db, test) => {
      db.query("INSERT INTO personal_daily_tasks (user_id, chat_id, task_date, content, status) VALUES ('987654321', '987654321', '2026-09-05', 'T1', 'PENDING')");
    },
    expectedRoute: 'AI Router -> Execute Personal Daily Tasks -> Check Confirm Delete All Tasks -> Format Confirm Prompt Tasks',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('CONFIRM DELETE ALL TASKS')) {
        throw new Error(`Expected confirmation prompt, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query("SELECT * FROM personal_daily_tasks WHERE user_id = '987654321' AND task_date = '2026-09-05'");
      if (rows.length !== 1) throw new Error('Tasks must not be deleted before confirmation');
    }
  },
  {
    id: 'TEST-083',
    category: 'Personal Daily Tasks',
    message: 'CONFIRM DELETE ALL TASKS',
    description: 'Delete all tasks confirmed -> deletes only current user tasks for specified date',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_14_Personal_Daily_Tasks',
    setup: (db, test) => {
      db.query("INSERT INTO personal_daily_tasks (user_id, chat_id, task_date, content, status) VALUES ('987654321', '987654321', '2026-09-03', 'User 1 Task', 'PENDING')");
      db.query("INSERT INTO personal_daily_tasks (user_id, chat_id, task_date, content, status) VALUES ('OTHER_USER', '11111', '2026-09-03', 'User 2 Task', 'PENDING')");
    },
    expectedRoute: 'AI Router -> Execute Personal Daily Tasks -> Delete All Tasks Query -> Format Delete All Tasks Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('Deleted')) {
        throw new Error(`Expected delete confirmation, got: ${JSON.stringify(msg)}`);
      }
      const userRows = db.query("SELECT * FROM personal_daily_tasks WHERE user_id = '987654321'");
      if (userRows.length !== 0) throw new Error('Current user tasks should be deleted');
      const otherRows = db.query("SELECT * FROM personal_daily_tasks WHERE user_id = 'OTHER_USER'");
      if (otherRows.length !== 1) throw new Error('Other user tasks should remain in database');
    }
  },
  {
    id: 'TEST-084',
    category: 'Personal Daily Tasks',
    message: 'Morning Schedule Trigger (LEVEL_14_Daily_Task_Scheduler)',
    description: 'Daily Task Scheduler -> sends one grouped morning briefing for incomplete tasks today',
    workflow: 'LEVEL_14_Daily_Task_Scheduler',
    setup: (db, test) => {
      db.query("INSERT INTO personal_daily_tasks (id, user_id, chat_id, task_date, content, status) VALUES (1, '987654321', '987654321', date('now'), 'DSA practice', 'PENDING')");
      db.query("INSERT INTO personal_daily_tasks (id, user_id, chat_id, task_date, content, status) VALUES (2, '987654321', '987654321', date('now'), 'Do n8n project', 'PENDING')");
    },
    expectedRoute: 'Morning Schedule Trigger -> Get Today Incomplete Tasks -> Any Tasks -> Group Tasks By User -> Send Tasks Notification -> Mark Tasks Notified',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes("TODAY'S TASKS") || !msg.text.includes('DSA practice') || !msg.text.includes('Do n8n project')) {
        throw new Error(`Expected morning task notification, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query("SELECT * FROM personal_daily_tasks WHERE task_date = date('now')");
      if (!rows[0].notified_at || !rows[1].notified_at) {
        throw new Error('Tasks must be marked notified to prevent duplicate morning notifications');
      }
    }
  },
  {
    id: 'TEST-085',
    category: 'Personal Daily Tasks',
    message: 'Morning Schedule Trigger with completed tasks',
    description: 'Daily Task Scheduler -> completed tasks are excluded from morning notification',
    workflow: 'LEVEL_14_Daily_Task_Scheduler',
    setup: (db, test) => {
      db.query("INSERT INTO personal_daily_tasks (id, user_id, chat_id, task_date, content, status) VALUES (1, '987654321', '987654321', date('now'), 'Incomplete Task', 'PENDING')");
      db.query("INSERT INTO personal_daily_tasks (id, user_id, chat_id, task_date, content, status) VALUES (2, '987654321', '987654321', date('now'), 'Completed Task', 'COMPLETED')");
    },
    expectedRoute: 'Morning Schedule Trigger -> Get Today Incomplete Tasks -> Any Tasks -> Group Tasks By User -> Send Tasks Notification -> Mark Tasks Notified',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('Incomplete Task') || msg.text.includes('Completed Task')) {
        throw new Error(`Completed tasks should not appear in morning notification: ${JSON.stringify(msg)}`);
      }
    }
  },
  {
    id: 'TEST-086',
    category: 'Personal Daily Tasks',
    message: 'Morning Schedule Trigger when no tasks exist',
    description: 'Daily Task Scheduler -> no notification sent when no tasks exist for today',
    workflow: 'LEVEL_14_Daily_Task_Scheduler',
    setup: (db, test) => {
      // Empty database
    },
    expectedRoute: 'Morning Schedule Trigger -> Get Today Incomplete Tasks -> Any Tasks (False)',
    verify: async (runtime, db, result) => {
      if (runtime.sentMessages.length > 0) {
        throw new Error(`Expected 0 messages sent when no tasks exist, got: ${runtime.sentMessages.length}`);
      }
    }
  },

  // =========================================================================
  // 13. Comprehensive Audit Verification Tests (TEST-087 to TEST-115)
  // =========================================================================

  // --- Task Priority (LEVEL 14) ---
  {
    id: 'TEST-087',
    category: 'Task Priority',
    message: 'add task for today: Finish client proposal (HIGH)',
    description: 'Add task with explicit HIGH priority -> saved with priority=HIGH and badge in confirmation',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_14_Personal_Daily_Tasks',
    expectedRoute: 'AI Router -> Execute Personal Daily Tasks -> Route Task Command -> Add Single Task -> Format Add Task Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('Task added') || !msg.text.includes('HIGH')) {
        throw new Error(`Expected task confirmation with HIGH priority, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query("SELECT * FROM personal_daily_tasks WHERE content LIKE '%Finish client proposal%'");
      if (rows.length === 0) throw new Error('Task was not inserted');
      if (rows[0].priority !== 'HIGH') throw new Error(`Expected priority HIGH, got ${rows[0].priority}`);
    }
  },
  {
    id: 'TEST-088',
    category: 'Task Priority',
    message: 'add task for today: Review open PRs',
    description: 'Add task without explicit priority -> defaults to priority=MEDIUM',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_14_Personal_Daily_Tasks',
    expectedRoute: 'AI Router -> Execute Personal Daily Tasks -> Route Task Command -> Add Single Task -> Format Add Task Confirmation',
    verify: async (runtime, db, result) => {
      const rows = db.query("SELECT * FROM personal_daily_tasks WHERE content LIKE '%Review open PRs%'");
      if (rows.length === 0) throw new Error('Task was not inserted');
      if (rows[0].priority !== 'MEDIUM') throw new Error(`Expected default priority MEDIUM, got ${rows[0].priority}`);
    }
  },
  {
    id: 'TEST-089',
    category: 'Task Priority',
    message: 'update task 1 priority to HIGH',
    description: 'Update existing task priority to HIGH -> updates priority in DB',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_14_Personal_Daily_Tasks',
    setup: (db, test) => {
      db.query("INSERT INTO personal_daily_tasks (id, user_id, chat_id, task_date, content, priority, status) VALUES (1, '987654321', '987654321', '2026-09-03', 'Existing task', 'LOW', 'PENDING')");
    },
    expectedRoute: 'AI Router -> Execute Personal Daily Tasks -> Route Task Command -> Update Task -> Format Update Task Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('updated') || !msg.text.includes('HIGH')) {
        throw new Error(`Expected update confirmation with HIGH, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query("SELECT * FROM personal_daily_tasks WHERE id = 1");
      if (rows[0].priority !== 'HIGH') throw new Error(`Expected priority HIGH, got ${rows[0].priority}`);
    }
  },
  {
    id: 'TEST-090',
    category: 'Task Priority',
    message: 'show today\'s tasks',
    description: 'List tasks formats priority badges and sorts HIGH before MEDIUM and LOW',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_14_Personal_Daily_Tasks',
    setup: (db, test) => {
      db.query("INSERT INTO personal_daily_tasks (id, user_id, chat_id, task_date, content, priority, status) VALUES (1, '987654321', '987654321', '2026-09-03', 'Low priority task', 'LOW', 'PENDING')");
      db.query("INSERT INTO personal_daily_tasks (id, user_id, chat_id, task_date, content, priority, status) VALUES (2, '987654321', '987654321', '2026-09-03', 'High priority task', 'HIGH', 'PENDING')");
      db.query("INSERT INTO personal_daily_tasks (id, user_id, chat_id, task_date, content, priority, status) VALUES (3, '987654321', '987654321', '2026-09-03', 'Medium priority task', 'MEDIUM', 'PENDING')");
    },
    expectedRoute: 'AI Router -> Execute Personal Daily Tasks -> Route Task Command -> Get Tasks For Date -> Format Tasks List',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('[HIGH]') || !msg.text.includes('[LOW]')) {
        throw new Error(`Expected priority badges in task list, got: ${JSON.stringify(msg)}`);
      }
      const highIdx = msg.text.indexOf('High priority task');
      const medIdx = msg.text.indexOf('Medium priority task');
      const lowIdx = msg.text.indexOf('Low priority task');
      if (highIdx === -1 || medIdx === -1 || lowIdx === -1 || highIdx > medIdx || medIdx > lowIdx) {
        throw new Error(`Expected HIGH task before MEDIUM before LOW task in list: ${msg.text}`);
      }
    }
  },
  {
    id: 'TEST-091',
    category: 'Task Priority',
    message: 'Morning Schedule Trigger with priorities',
    description: 'Daily Task Scheduler displays priority badges in morning notification',
    workflow: 'LEVEL_14_Daily_Task_Scheduler',
    setup: (db, test) => {
      db.query("INSERT INTO personal_daily_tasks (id, user_id, chat_id, task_date, content, priority, status) VALUES (1, '987654321', '987654321', date('now'), 'Critical bug fix', 'HIGH', 'PENDING')");
      db.query("INSERT INTO personal_daily_tasks (id, user_id, chat_id, task_date, content, priority, status) VALUES (2, '987654321', '987654321', date('now'), 'Regular docs', 'MEDIUM', 'PENDING')");
    },
    expectedRoute: 'Morning Schedule Trigger -> Get Today Incomplete Tasks -> Any Tasks -> Group Tasks By User -> Send Tasks Notification -> Mark Tasks Notified',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('[HIGH]') || !msg.text.includes('Critical bug fix')) {
        throw new Error(`Expected HIGH priority badge in morning notification, got: ${JSON.stringify(msg)}`);
      }
    }
  },

  // --- Natural Language Dates & Timezone (LEVEL 6, 13, 3) ---
  {
    id: 'TEST-092',
    category: 'Natural Language Dates',
    message: 'remind me to call ABC School tomorrow 10am',
    description: 'Follow-up creation formats both date AND time in confirmation message',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_6_Followup_Management',
    setup: (db, test) => {
      db.seedLead({ business_name: 'ABC School', status: 'NEW' });
    },
    expectedRoute: 'AI Router -> Execute Followup Management -> Compute Due Date -> Insert Follow Up -> Build Create Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('Follow-up') || !msg.text.includes('at')) {
        throw new Error(`Expected date and time in confirmation, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query("SELECT * FROM follow_ups WHERE lead_id = (SELECT id FROM leads WHERE business_name = 'ABC School')");
      if (rows.length === 0) throw new Error('Follow-up was not created');
      if (!rows[0].due_at) throw new Error('Follow-up due_at is missing');
    }
  },
  {
    id: 'TEST-093',
    category: 'Natural Language Dates',
    message: 'remind me on Monday Sep 7 at 10am to call client',
    description: 'Standalone reminder parses natural language date and time into valid ISO timestamp',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_13_Standalone_Reminders',
    expectedRoute: 'AI Router -> Execute Standalone Reminders -> Route Reminder Command -> Extract Reminder Input -> Insert Standalone Reminder -> Format Create Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('Reminder set') || !msg.text.includes('2026')) {
        throw new Error(`Expected formatted reminder confirmation, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query("SELECT * FROM standalone_reminders WHERE chat_id = '987654321'");
      if (rows.length === 0) throw new Error('Reminder was not inserted');
      if (!rows[0].reminder_at || isNaN(new Date(rows[0].reminder_at).getTime())) {
        throw new Error(`Invalid reminder_at timestamp: ${rows[0].reminder_at}`);
      }
    }
  },

  // --- Follow-up Scheduler State & Cooldown (LEVEL 7) ---
  {
    id: 'TEST-094',
    category: 'Follow-up Scheduler',
    message: 'Scheduler Notification Loop Test',
    description: 'Scheduler records last_notified_at and preserves original due_at timestamp',
    workflow: 'LEVEL_7_Followup_Scheduler',
    setup: (db, test) => {
      const pastDue = new Date(Date.now() - 3600000).toISOString();
      const lead = db.seedLead({ business_name: 'Overdue Lead' });
      db.query(`INSERT INTO follow_ups (lead_id, due_at, status, last_notified_at) VALUES (${lead.id}, '${pastDue}', 'PENDING', NULL)`);
    },
    expectedRoute: 'Check Overdue Follow-ups -> Find Overdue Followups -> Overdue Followups Found -> Send Followup Reminder Notification -> Mark Followups Notified',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('FOLLOW-UP DUE') || !msg.text.includes('Overdue Lead')) {
        throw new Error(`Expected reminder notification, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query("SELECT * FROM follow_ups WHERE lead_id = (SELECT id FROM leads WHERE business_name = 'Overdue Lead')");
      if (!rows[0].last_notified_at) {
        throw new Error('last_notified_at was not updated by scheduler');
      }
    }
  },
  {
    id: 'TEST-095',
    category: 'Follow-up Scheduler',
    message: 'Scheduler Notification Cooldown Test',
    description: 'Scheduler does not re-notify follow-ups that were notified within the last 12 hours',
    workflow: 'LEVEL_7_Followup_Scheduler',
    setup: (db, test) => {
      const pastDue = new Date(Date.now() - 3600000).toISOString();
      const recentNotified = new Date(Date.now() - 1800000).toISOString(); // 30m ago
      const lead = db.seedLead({ business_name: 'Recently Notified Lead' });
      db.query(`INSERT INTO follow_ups (lead_id, due_at, status, last_notified_at) VALUES (${lead.id}, '${pastDue}', 'PENDING', '${recentNotified}')`);
    },
    expectedRoute: 'Check Overdue Follow-ups -> Find Overdue Followups -> Overdue Followups Found (False)',
    verify: async (runtime, db, result) => {
      if (runtime.sentMessages.length > 0) {
        throw new Error(`Expected 0 messages due to 12h cooldown, got: ${runtime.sentMessages.length}`);
      }
    }
  },

  // --- Follow-up Callback Validation (LEVEL 7 Callback) ---
  {
    id: 'TEST-096',
    category: 'Callback Validation',
    message: 'Invalid Callback Payload (Wrong prefix)',
    description: 'Callback with invalid prefix is rejected cleanly without crashing',
    workflow: 'LEVEL_7_Followup_Callback',
    payload: {
      callback_query: {
        id: 'cb_inv_1',
        from: { id: 987654321, username: 'testuser' },
        message: { chat: { id: 987654321 }, message_id: 888 },
        data: 'wrong_prefix:1:1:Y'
      }
    },
    expectedRoute: 'Telegram Trigger Callback -> Parse Callback Data -> Valid Callback -> Reject Invalid Callback -> Send Invalid Callback Alert',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('Invalid or malformed')) {
        throw new Error(`Expected invalid callback rejection message, got: ${JSON.stringify(msg)}`);
      }
    }
  },
  {
    id: 'TEST-097',
    category: 'Callback Validation',
    message: 'Invalid Callback Payload (Non-integer ID)',
    description: 'Callback with non-numeric ID parameter is rejected safely',
    workflow: 'LEVEL_7_Followup_Callback',
    payload: {
      callback_query: {
        id: 'cb_inv_2',
        from: { id: 987654321, username: 'testuser' },
        message: { chat: { id: 987654321 }, message_id: 889 },
        data: 'fu:abc:1:Y'
      }
    },
    expectedRoute: 'Telegram Trigger Callback -> Parse Callback Data -> Valid Callback -> Reject Invalid Callback -> Send Invalid Callback Alert',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('Invalid or malformed')) {
        throw new Error(`Expected invalid callback rejection, got: ${JSON.stringify(msg)}`);
      }
    }
  },

  // --- Human Approval Optimistic Concurrency (LEVEL 10) ---
  {
    id: 'TEST-098',
    category: 'Human Approval Concurrency',
    isCallback: true,
    description: 'Approval applies successfully when expected updated_at timestamp matches',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL',
    setup: (db, test) => {
      const nowStr = new Date().toISOString();
      const lead = db.seedLead({ business_name: 'Tech Corp', status: 'IN_CONVERSATION', updated_at: nowStr });
      const v = new Date(lead.updated_at).toISOString().replace(/[:]/g, '');
      test.callbackData = `appr:${lead.id}:status:WON:${v}:987654321:A`;
    },
    expectedRoute: 'Route Callback Prefix (appr:) -> Execute Approval Callback -> Apply Approved Change -> Build Approve Message',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages.find(m => m.nodeName === 'Edit Approval Message') || runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !/approved/i.test(msg.text) || !msg.text.includes('Tech Corp')) {
        throw new Error(`Expected successful approval message, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query("SELECT * FROM leads WHERE business_name = 'Tech Corp'");
      if (rows[0].status !== 'WON') throw new Error(`Expected status WON, got ${rows[0].status}`);
    }
  },
  {
    id: 'TEST-099',
    category: 'Human Approval Concurrency',
    isCallback: true,
    description: 'Approval fails safely with conflict notice when expected updated_at does not match',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL',
    setup: (db, test) => {
      // Lead was modified in the interim by someone else
      const lead = db.seedLead({ business_name: 'Tech Corp', status: 'LOST', updated_at: new Date().toISOString() });
      // Stale callback data with old version timestamp
      const staleV = new Date(Date.now() - 60000).toISOString().replace(/[:]/g, '');
      test.callbackData = `appr:${lead.id}:status:WON:${staleV}:987654321:A`;
    },
    expectedRoute: 'Route Callback Prefix (appr:) -> Execute Approval Callback -> Apply Approved Change -> Build Approve Message',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages.find(m => m.nodeName === 'Edit Approval Message') || runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || (!msg.text.includes('changed since the request was made') && !msg.text.includes('modified') && !msg.text.includes('Conflict'))) {
        throw new Error(`Expected conflict rejection message, got: ${JSON.stringify(msg)}`);
      }
      const rows = db.query("SELECT * FROM leads WHERE business_name = 'Tech Corp'");
      if (rows[0].status === 'WON') throw new Error('Stale change should not overwrite existing status');
    }
  },

  // --- Telegram Deduplication & DB Failures (LEVEL 3) ---
  {
    id: 'TEST-100',
    category: 'Telegram Update Deduplication',
    message: '/help',
    updateId: 999999,
    description: 'Duplicate update_id is dropped by Restore Context and halts execution without sending responses',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL',
    setup: (db, test) => {
      db.query("INSERT INTO processed_updates (update_id) VALUES (?)", [999999]);
    },
    expectedRoute: 'Telegram Trigger -> Check Update Deduplication -> Restore Context (Empty / Halt)',
    verify: async (runtime, db, result) => {
      if (runtime.sentMessages.length > 0) {
        throw new Error(`Duplicate update must not produce any sent messages, got: ${runtime.sentMessages.length}`);
      }
    }
  },
  {
    id: 'TEST-101',
    category: 'User Scoping & Isolation',
    message: 'Sunrise Academy',
    description: 'User B answering pending action created for User A does not match User A pending action',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL',
    setup: (db, test) => {
      // Pending action created by user 11111
      db.query("INSERT INTO pending_actions (chat_id, user_id, command, parameters, missing, updated_at) VALUES ('987654321', '11111', 'ADD_LEAD', '{\"deal_value\": 5000}', '[\"business_name\"]', datetime('now'))");
    },
    triggerData: {
      update_id: 100001,
      message: {
        message_id: 124,
        from: { id: 987654321, username: 'user2' }, // user 987654321 != 11111
        chat: { id: 987654321, type: 'private' },
        text: 'Sunrise Academy'
      }
    },
    expectedRoute: 'Telegram Trigger -> Check Pending Action (Not found for user 987654321) -> AI Router',
    verify: async (runtime, db, result) => {
      // The pending action for 11111 should NOT be cleared or merged
      const rows = db.query("SELECT * FROM pending_actions WHERE user_id = '11111'");
      if (rows.length !== 1) {
        throw new Error('Pending action for user 11111 was improperly modified or cleared');
      }
    }
  },

  // --- Multi-Currency Analytics (LEVEL 8 & 9) ---
  {
    id: 'TEST-102',
    category: 'Analytics Multi-Currency',
    message: 'how much money did i make',
    description: 'Revenue analytics reports multi-currency totals without hardcoded INR',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_9_Revenue_Analytics',
    setup: (db, test) => {
      db.query("INSERT INTO leads (business_name, deal_value, currency, status, won_at, updated_at) VALUES ('USD Client', 2000, 'USD', 'WON', datetime('now'), datetime('now'))");
      db.query("INSERT INTO leads (business_name, deal_value, currency, status, won_at, updated_at) VALUES ('INR Client', 50000, 'INR', 'WON', datetime('now'), datetime('now'))");
      db.query("INSERT INTO leads (business_name, deal_value, currency, status, won_at, updated_at) VALUES ('EUR Client', 1500, 'EUR', 'WON', datetime('now'), datetime('now'))");
    },
    expectedRoute: 'AI Router -> Execute Revenue Analytics -> Fetch Revenue Stats -> Format Revenue Report',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !/Revenue/i.test(msg.text) || !msg.text.includes('USD') || !msg.text.includes('EUR') || (!msg.text.includes('INR') && !msg.text.includes('₹'))) {
        throw new Error(`Expected breakdown with USD, INR/₹, and EUR, got: ${JSON.stringify(msg)}`);
      }
    }
  },

  // --- Destructive Action Guard & Cascade (LEVEL 4) ---
  {
    id: 'TEST-103',
    category: 'Destructive Action Safety',
    message: 'delete all leads',
    description: 'Unconfirmed DELETE_ALL_LEADS returns strict confirmation prompt with keyword instructions',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_4_Lead_Management',
    setup: (db, test) => {
      db.seedLead({ business_name: 'Lead 1' });
      db.seedLead({ business_name: 'Lead 2' });
    },
    expectedRoute: 'AI Router -> Execute Lead Management -> Route Action -> Prompt Confirm Delete All',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('CONFIRM DELETE ALL LEADS')) {
        throw new Error(`Expected confirmation prompt, got: ${JSON.stringify(msg)}`);
      }
      const count = db.query('SELECT COUNT(*) as cnt FROM leads')[0].cnt;
      if (count !== 2) throw new Error('Leads must not be deleted without confirmation');
    }
  },
  {
    id: 'TEST-104',
    category: 'Destructive Action Safety',
    message: 'CONFIRM DELETE ALL LEADS',
    description: 'Confirmed DELETE_ALL_LEADS deletes all leads and cascades related interactions and followups',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_4_Lead_Management',
    setup: (db, test) => {
      const lead = db.seedLead({ business_name: 'Lead 1' });
      db.seedInteraction({ lead_id: lead.id, content: 'Called lead' });
      db.query(`INSERT INTO follow_ups (lead_id, due_at, status) VALUES (${lead.id}, '2026-09-04', 'PENDING')`);
    },
    expectedRoute: 'AI Router -> Execute Lead Management -> Route Action -> Delete All Leads Query -> Format Delete All Confirmation',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('All leads') || !msg.text.includes('deleted')) {
        throw new Error(`Expected delete all confirmation, got: ${JSON.stringify(msg)}`);
      }
      const leadCount = db.query('SELECT COUNT(*) as cnt FROM leads')[0].cnt;
      const interCount = db.query('SELECT COUNT(*) as cnt FROM interactions')[0].cnt;
      const fuCount = db.query('SELECT COUNT(*) as cnt FROM follow_ups')[0].cnt;
      if (leadCount !== 0 || interCount !== 0 || fuCount !== 0) {
        throw new Error(`Cascade failed: leads=${leadCount}, interactions=${interCount}, followups=${fuCount}`);
      }
    }
  },

  // =========================================================================
  // 14. Forensic Verification & Concurrency Tests (TEST-105 to TEST-112)
  // =========================================================================
  {
    id: 'TEST-105',
    category: 'Scheduler Race Prevention',
    message: 'Concurrent Follow-up Scheduler Execution',
    description: 'Two concurrent scheduler executions attempting to claim the same overdue follow-up -> only 1 notification sent',
    workflow: 'LEVEL_7_Followup_Scheduler',
    setup: (db, test) => {
      const pastDue = new Date(Date.now() - 3600000).toISOString();
      const lead = db.seedLead({ business_name: 'Race Followup Lead' });
      db.query(`INSERT INTO follow_ups (lead_id, due_at, status, last_notified_at) VALUES (${lead.id}, '${pastDue}', 'PENDING', NULL)`);
    },
    verify: async (runtime, db, result) => {
      // Run second concurrent instance
      const secondRuntime = new (require('./n8n_runtime'))(db);
      await secondRuntime.executeWorkflow('LEVEL_7_Followup_Scheduler', {});
      const totalSent = runtime.sentMessages.length + secondRuntime.sentMessages.length;
      if (totalSent !== 1) {
        throw new Error(`Race condition detected: expected 1 notification across concurrent runs, got ${totalSent}`);
      }
    }
  },
  {
    id: 'TEST-106',
    category: 'Scheduler Race Prevention',
    message: 'Concurrent Reminder Scheduler Execution',
    description: 'Two concurrent reminder scheduler executions -> only 1 reminder notification sent',
    workflow: 'LEVEL_13_Reminder_Scheduler',
    setup: (db, test) => {
      const pastDue = new Date(Date.now() - 60000).toISOString();
      db.query(`INSERT INTO standalone_reminders (user_id, chat_id, content, reminder_at, status, notified_at) VALUES ('987654321', '987654321', 'Submit tax form', '${pastDue}', 'PENDING', NULL)`);
    },
    verify: async (runtime, db, result) => {
      const secondRuntime = new (require('./n8n_runtime'))(db);
      await secondRuntime.executeWorkflow('LEVEL_13_Reminder_Scheduler', {});
      const totalSent = runtime.sentMessages.length + secondRuntime.sentMessages.length;
      if (totalSent !== 1) {
        throw new Error(`Race condition detected: expected 1 reminder notification across concurrent runs, got ${totalSent}`);
      }
    }
  },
  {
    id: 'TEST-107',
    category: 'Scheduler Race Prevention',
    message: 'Concurrent Daily Task Scheduler Execution',
    description: 'Two concurrent daily task scheduler executions -> only 1 morning notification sent',
    workflow: 'LEVEL_14_Daily_Task_Scheduler',
    setup: (db, test) => {
      db.query("INSERT INTO personal_daily_tasks (user_id, chat_id, task_date, content, priority, status) VALUES ('987654321', '987654321', date('now'), 'Critical bug fix', 'HIGH', 'PENDING')");
    },
    verify: async (runtime, db, result) => {
      const secondRuntime = new (require('./n8n_runtime'))(db);
      await secondRuntime.executeWorkflow('LEVEL_14_Daily_Task_Scheduler', {});
      const totalSent = runtime.sentMessages.length + secondRuntime.sentMessages.length;
      if (totalSent !== 1) {
        throw new Error(`Race condition detected: expected 1 daily task briefing across concurrent runs, got ${totalSent}`);
      }
    }
  },
  {
    id: 'TEST-108',
    category: 'Multi-User Isolation',
    message: 'Cross-user notes isolation',
    description: 'User A cannot access or delete User B notes',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_12_Standalone_Notes',
    setup: (db, test) => {
      db.query("INSERT INTO standalone_notes (id, user_id, content) VALUES (1, 'USER_B', 'User B secret note')");
    },
    triggerData: {
      update_id: 100005,
      message: {
        message_id: 125,
        from: { id: 987654321, username: 'user_a' },
        chat: { id: 987654321, type: 'private' },
        text: 'show my notes'
      }
    },
    expectedRoute: 'AI Router -> Execute Standalone Notes -> List Notes',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (msg && msg.text.includes('User B secret note')) {
        throw new Error(`Cross-user data leak: User A saw User B note: ${msg.text}`);
      }
    }
  },
  {
    id: 'TEST-109',
    category: 'Multi-User Isolation',
    message: 'Cross-user tasks isolation',
    description: 'User A listing tasks does not show User B tasks',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_14_Personal_Daily_Tasks',
    setup: (db, test) => {
      db.query("INSERT INTO personal_daily_tasks (id, user_id, chat_id, task_date, content, priority, status) VALUES (1, 'USER_B', '22222', '2026-09-03', 'User B private task', 'HIGH', 'PENDING')");
    },
    triggerData: {
      update_id: 100006,
      message: {
        message_id: 126,
        from: { id: 987654321, username: 'user_a' },
        chat: { id: 987654321, type: 'private' },
        text: 'show today\'s tasks'
      }
    },
    expectedRoute: 'AI Router -> Execute Personal Daily Tasks -> List Tasks',
    verify: async (runtime, db, result) => {
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (msg && msg.text.includes('User B private task')) {
        throw new Error(`Cross-user data leak: User A saw User B task: ${msg.text}`);
      }
    }
  },
  {
    id: 'TEST-110',
    category: 'Interaction Side Effects',
    message: 'I spoke to ABC School today (No automatic follow-up creation)',
    description: 'Logging interaction does not create an unintended 3-day follow-up',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_5_Interaction_History',
    setup: (db, test) => {
      db.seedLead({ business_name: 'ABC School', status: 'NEW' });
    },
    expectedRoute: 'Find Lead By Name -> Insert Interaction -> Update Last Contact -> Build Interaction Confirmation',
    verify: async (runtime, db, result) => {
      const fuRows = db.query("SELECT * FROM follow_ups WHERE lead_id = (SELECT id FROM leads WHERE business_name = 'ABC School')");
      if (fuRows.length > 0) {
        throw new Error('Unintended side effect: interaction logging automatically created follow-up');
      }
    }
  },
  {
    id: 'TEST-111',
    category: 'Static Reference Integrity',
    message: 'Static Workflow Integrity Check',
    description: 'Verify all Execute Workflow nodes point to valid project workflows with valid triggers',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL',
    verify: async (runtime, db, result) => {
      const fs = require('node:fs');
      const path = require('node:path');
      const baseDir = path.resolve(__dirname, '..');
      const jsonFiles = fs.readdirSync(baseDir).filter(f => f.startsWith('LEVEL_') && f.endsWith('.json'));
      const workflows = jsonFiles.map(f => JSON.parse(fs.readFileSync(path.join(baseDir, f), 'utf8')));
      const workflowNames = new Set(workflows.map(w => w.name));

      for (const wf of workflows) {
        for (const node of (wf.nodes || [])) {
          if (node.type === 'n8n-nodes-base.executeWorkflow') {
            const targetId = node.parameters && node.parameters.workflowId && (node.parameters.workflowId.value || node.parameters.workflowId);
            if (!targetId) {
              throw new Error(`Workflow ${wf.name} has executeWorkflow node ${node.name} without workflowId`);
            }
            if (!workflowNames.has(targetId)) {
              throw new Error(`Workflow ${wf.name} node ${node.name} targets non-existent workflow "${targetId}"`);
            }
          }
        }
      }
    }
  },
  {
    id: 'TEST-112',
    category: 'Human Approval Authorization',
    message: 'Unauthorized Telegram User Callback',
    description: 'Callback from unauthorized user ID is rejected with ⛔ Unauthorized',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL',
    isCallback: true,
    callerUserId: 111222333,
    setup: (db, test) => {
      const lead = db.seedLead({ business_name: 'Auth Test Lead', status: 'PROPOSAL_SENT', updated_at: new Date().toISOString() });
      test.callbackData = `appr:${lead.id}:status:WON:${new Date(lead.updated_at).toISOString().replace(/[:]/g, '')}:987654321:A`;
    },
    verify: async (runtime, db, result) => {
      const lead = db.query("SELECT status FROM leads WHERE business_name = 'Auth Test Lead'")[0];
      if (lead.status !== 'PROPOSAL_SENT') {
        throw new Error(`Unauthorized update succeeded: status changed to ${lead.status}`);
      }
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('Unauthorized')) {
        throw new Error(`Expected Unauthorized error message, got: ${msg ? msg.text : 'none'}`);
      }
    }
  },
  {
    id: 'TEST-113',
    category: 'Human Approval Authorization',
    message: 'Expired Approval Request (>15 minutes)',
    description: 'Approval callback older than 15 minutes is rejected with ⏰ Expired',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL',
    isCallback: true,
    callerUserId: 987654321,
    setup: (db, test) => {
      const expiredDate = new Date(Date.now() - 3600000).toISOString();
      const lead = db.seedLead({ business_name: 'Expiry Test Lead', status: 'PROPOSAL_SENT', updated_at: expiredDate });
      test.callbackData = `appr:${lead.id}:status:WON:${expiredDate.replace(/[:]/g, '')}:987654321:A`;
    },
    verify: async (runtime, db, result) => {
      const lead = db.query("SELECT status FROM leads WHERE business_name = 'Expiry Test Lead'")[0];
      if (lead.status !== 'PROPOSAL_SENT') {
        throw new Error(`Expired approval succeeded: status changed to ${lead.status}`);
      }
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('Expired')) {
        throw new Error(`Expected Expired error message, got: ${msg ? msg.text : 'none'}`);
      }
    }
  },
  {
    id: 'TEST-114',
    category: 'Human Approval Authorization',
    message: 'Replayed / Stale Approval Callback',
    description: 'Approval callback with stale updated_at is rejected with ⚠️ Conflict',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL',
    isCallback: true,
    callerUserId: 987654321,
    setup: (db, test) => {
      const oldDate = new Date(Date.now() - 120000).toISOString();
      const lead = db.seedLead({ business_name: 'Replay Test Lead', status: 'CONTACTED', updated_at: new Date().toISOString() });
      test.callbackData = `appr:${lead.id}:status:WON:${oldDate.replace(/[:]/g, '')}:987654321:A`;
    },
    verify: async (runtime, db, result) => {
      const lead = db.query("SELECT status FROM leads WHERE business_name = 'Replay Test Lead'")[0];
      if (lead.status !== 'CONTACTED') {
        throw new Error(`Stale/replayed approval succeeded: status changed to ${lead.status}`);
      }
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('Conflict')) {
        throw new Error(`Expected Conflict error message, got: ${msg ? msg.text : 'none'}`);
      }
    }
  },
  {
    id: 'TEST-115',
    category: 'Google Calendar Resilience',
    message: 'follow up for GCal Fail Lead tomorrow 10am',
    description: 'PostgreSQL follow-up created successfully even if Google Calendar is offline',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_6_Followup_Management',
    _simulateGCalFailure: true,
    setup: (db, test) => {
      db.seedLead({ business_name: 'GCal Fail Lead', status: 'NEW' });
    },
    expectedRoute: 'Find Lead By Name -> Compute Due Date -> Upsert Followup -> Create Calendar Event -> Build Create Confirmation',
    verify: async (runtime, db, result) => {
      const fuRows = db.query("SELECT * FROM follow_ups WHERE lead_id = (SELECT id FROM leads WHERE business_name = 'GCal Fail Lead')");
      if (fuRows.length === 0) {
        throw new Error('Follow-up was not created in database when GCal failed');
      }
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('GCal Fail Lead')) {
        throw new Error('Confirmation message not sent to user');
      }
    }
  },
  {
    id: 'TEST-116',
    category: 'Google Calendar Resilience',
    message: 'cancel followup for GCal Del Lead',
    description: 'PostgreSQL follow-up cancelled successfully even if Google Calendar deletion fails',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_6_Followup_Management',
    _simulateGCalFailure: true,
    setup: (db, test) => {
      const lead = db.seedLead({ business_name: 'GCal Del Lead', status: 'CONTACTED' });
      db.query(`INSERT INTO follow_ups (lead_id, due_at, status, calendar_event_id) VALUES (${lead.id}, datetime('now', '+2 days'), 'PENDING', 'mock_dead_event_id')`);
    },
    expectedRoute: 'Find Lead By Name -> Find Pending Followup (Delete) -> Delete Followup DB -> Clear Lead Next Follow Up (Delete) -> Build Delete Confirmation',
    verify: async (runtime, db, result) => {
      const fuRows = db.query("SELECT status FROM follow_ups WHERE lead_id = (SELECT id FROM leads WHERE business_name = 'GCal Del Lead') AND status = 'PENDING'");
      if (fuRows.length > 0) {
        throw new Error('Pending follow-up was not removed/cancelled in database when GCal failed');
      }
      const msg = runtime.sentMessages[runtime.sentMessages.length - 1];
      if (!msg || !msg.text.includes('GCal Del Lead')) {
        throw new Error('Confirmation message not sent to user');
      }
    }
  },
  {
    id: 'TEST-117',
    category: 'REPLIED Semantics',
    message: 'Complete follow-up preserves lead status (No REPLIED side effect)',
    description: 'Marking a follow-up COMPLETED does not change lead status to REPLIED',
    workflow: 'LEVEL_6_Followup_Management',
    triggerData: {
      chatId: '987654321',
      command: 'COMPLETE_FOLLOW_UP',
      parameters: { businessName: 'Semantics Complete Lead' }
    },
    setup: (db, test) => {
      const lead = db.seedLead({ business_name: 'Semantics Complete Lead', status: 'CONTACTED' });
      db.query(`INSERT INTO follow_ups (lead_id, due_at, status) VALUES (${lead.id}, datetime('now', '-1 day'), 'PENDING')`);
    },
    verify: async (runtime, db, result) => {
      const lead = db.query("SELECT status FROM leads WHERE business_name = 'Semantics Complete Lead'")[0];
      if (lead.status === 'REPLIED') {
        throw new Error('Invalid status transition: completing follow-up changed lead status to REPLIED');
      }
      if (lead.status !== 'CONTACTED') {
        throw new Error(`Expected status CONTACTED, got ${lead.status}`);
      }
    }
  },
  {
    id: 'TEST-118',
    category: 'REPLIED Semantics',
    message: 'reschedule followup for Semantics Resched Lead to next monday 10am',
    description: 'Rescheduling a follow-up does not change lead status to REPLIED',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_6_Followup_Management',
    setup: (db, test) => {
      const lead = db.seedLead({ business_name: 'Semantics Resched Lead', status: 'NEW' });
      db.query(`INSERT INTO follow_ups (lead_id, due_at, status) VALUES (${lead.id}, datetime('now', '+1 day'), 'PENDING')`);
    },
    verify: async (runtime, db, result) => {
      const lead = db.query("SELECT status FROM leads WHERE business_name = 'Semantics Resched Lead'")[0];
      if (lead.status === 'REPLIED') {
        throw new Error('Invalid status transition: rescheduling follow-up changed lead status to REPLIED');
      }
      if (lead.status !== 'NEW') {
        throw new Error(`Expected status NEW, got ${lead.status}`);
      }
    }
  },
  {
    id: 'TEST-119',
    category: 'REPLIED Semantics',
    message: 'cancel followup for Semantics Cancel Lead',
    description: 'Cancelling a follow-up does not change lead status to REPLIED',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_6_Followup_Management',
    setup: (db, test) => {
      const lead = db.seedLead({ business_name: 'Semantics Cancel Lead', status: 'NEW' });
      db.query(`INSERT INTO follow_ups (lead_id, due_at, status) VALUES (${lead.id}, datetime('now', '+1 day'), 'PENDING')`);
    },
    verify: async (runtime, db, result) => {
      const lead = db.query("SELECT status FROM leads WHERE business_name = 'Semantics Cancel Lead'")[0];
      if (lead.status === 'REPLIED') {
        throw new Error('Invalid status transition: cancelling follow-up changed lead status to REPLIED');
      }
      if (lead.status !== 'NEW') {
        throw new Error(`Expected status NEW, got ${lead.status}`);
      }
    }
  },
  {
    id: 'TEST-120',
    category: 'REPLIED Semantics',
    message: 'I called Semantics Log Lead today to discuss proposal',
    description: 'Logging an interaction does not change lead status to REPLIED',
    workflow: 'LEVEL_3_AI_Command_Router_FINAL -> LEVEL_5_Interaction_History',
    setup: (db, test) => {
      db.seedLead({ business_name: 'Semantics Log Lead', status: 'PROPOSAL_SENT' });
    },
    verify: async (runtime, db, result) => {
      const lead = db.query("SELECT status FROM leads WHERE business_name = 'Semantics Log Lead'")[0];
      if (lead.status === 'REPLIED') {
        throw new Error('Invalid status transition: logging interaction changed lead status to REPLIED');
      }
      if (lead.status !== 'PROPOSAL_SENT') {
        throw new Error(`Expected status PROPOSAL_SENT, got ${lead.status}`);
      }
    }
  }
];

module.exports = testMatrix;
