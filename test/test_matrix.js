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
      const lead = db.seedLead({ business_name: 'Big Client', status: 'PROPOSAL_SENT', updated_at: '2026-09-01T12:00:00.000Z' });
      const v = new Date(lead.updated_at).toISOString().replace(/[:]/g, '');
      test.callbackData = `appr:${lead.id}:status:WON:${v}:A`;
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
      const lead = db.seedLead({ business_name: 'Big Client', status: 'PROPOSAL_SENT', updated_at: '2026-09-01T12:00:00.000Z' });
      const v = new Date(lead.updated_at).toISOString().replace(/[:]/g, '');
      test.callbackData = `appr:${lead.id}:status:WON:${v}:R`;
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
  }
];

module.exports = testMatrix;
