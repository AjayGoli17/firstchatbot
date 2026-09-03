const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class N8nRuntime {
  constructor(dbAdapter, options = {}) {
    this.db = dbAdapter;
    this.options = options;
    this.workflows = new Map();
    this.sentMessages = [];
    this.calendarEvents = [];
    this.env = {
      PERSONAL_CHAT_ID: '987654321',
      ...(options.env || {})
    };
    this.aiMockHandler = options.aiMockHandler || this.defaultAiIntentClassifier.bind(this);
    this.loadAllWorkflows();
  }

  loadAllWorkflows() {
    const baseDir = path.resolve(__dirname, '..');
    const files = fs.readdirSync(baseDir).filter(f => f.endsWith('.json') && f.startsWith('LEVEL_'));
    for (const file of files) {
      try {
        const fullPath = path.join(baseDir, file);
        const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
        const name = data.name || path.basename(file, '.json');
        this.workflows.set(name, data);
        this.workflows.set(path.basename(file, '.json'), data);
        this.workflows.set(file, data);
      } catch (e) {
        console.error(`Error loading workflow file ${file}:`, e.message);
      }
    }
  }

  getWorkflow(identifier) {
    if (!identifier) return null;
    return (
      this.workflows.get(identifier) ||
      this.workflows.get(String(identifier).replace(/\.json$/, '')) ||
      null
    );
  }

  createEvalContext(currentJson, nodeOutputs, inputItems = null) {
    const items = inputItems || (currentJson ? [{ json: currentJson }] : []);
    const nodeLookup = (nodeName) => {
      const out = nodeOutputs[nodeName] || [];
      return {
        first: () => out[0] || { json: {} },
        all: () => out,
        item: out[0] || { json: {} }
      };
    };
    const inputHelper = {
      first: () => items[0] || { json: {} },
      all: () => items,
      item: items[0] || { json: {} }
    };
    return vm.createContext({
      $json: currentJson || {},
      $input: inputHelper,
      $: nodeLookup,
      $env: this.env,
      console,
      Date,
      JSON,
      Math,
      Number,
      String,
      Array,
      Object,
      RegExp,
      isNaN,
      parseInt,
      parseFloat
    });
  }

  evaluateExpr(exprStr, currentJson, nodeOutputs, inputItems = null) {
    if (typeof exprStr !== 'string') return exprStr;
    if (!exprStr.startsWith('=')) return exprStr;

    const ctx = this.createEvalContext(currentJson, nodeOutputs, inputItems);

    let raw = exprStr.slice(1).trim();
    if (raw.startsWith('{{') && raw.endsWith('}}') && raw.indexOf('{{', 2) === -1) {
      const code = raw.slice(2, -2).trim();
      try {
        return vm.runInContext(code, ctx);
      } catch (err) {
        return undefined;
      }
    }

    return raw.replace(/\{\{([\s\S]+?)\}\}/g, (_, code) => {
      try {
        const val = vm.runInContext(code.trim(), ctx);
        return val !== undefined && val !== null ? String(val) : '';
      } catch (e) {
        return '';
      }
    });
  }

  evaluateValue(val, currentJson, nodeOutputs, inputItems = null) {
    if (typeof val === 'string') {
      return this.evaluateExpr(val, currentJson, nodeOutputs, inputItems);
    }
    if (Array.isArray(val)) {
      return val.map(v => this.evaluateValue(v, currentJson, nodeOutputs, inputItems));
    }
    if (val && typeof val === 'object') {
      const res = {};
      for (const [k, v] of Object.entries(val)) {
        res[k] = this.evaluateValue(v, currentJson, nodeOutputs, inputItems);
      }
      return res;
    }
    return val;
  }

  async executeWorkflow(workflowOrName, triggerData = {}, triggerNodeName = null) {
    const wf = typeof workflowOrName === 'string' ? this.getWorkflow(workflowOrName) : workflowOrName;
    if (!wf) {
      throw new Error(`Workflow not found: ${workflowOrName}`);
    }

    const nodeOutputs = {};
    const nodesByName = new Map();
    for (const node of wf.nodes) {
      nodesByName.set(node.name, node);
    }

    let startNode = null;
    if (triggerNodeName) {
      startNode = nodesByName.get(triggerNodeName);
    } else {
      startNode = wf.nodes.find(n =>
        n.type === 'n8n-nodes-base.telegramTrigger' ||
        n.type === 'n8n-nodes-base.executeWorkflowTrigger' ||
        n.type === 'n8n-nodes-base.scheduleTrigger' ||
        n.type === 'n8n-nodes-base.errorTrigger'
      ) || wf.nodes[0];
    }

    if (!startNode) {
      throw new Error(`No trigger node found in workflow: ${wf.name}`);
    }

    const initialItems = Array.isArray(triggerData) 
      ? triggerData 
      : [{ json: triggerData }];

    nodeOutputs[startNode.name] = initialItems;

    const queue = [{ node: startNode, inputItems: initialItems }];
    let lastOutput = initialItems;

    while (queue.length > 0) {
      const { node, inputItems } = queue.shift();
      const nodeName = node.name;

      let outputResult;
      try {
        outputResult = await this.executeNode(node, inputItems, nodeOutputs, wf);
      } catch (err) {
        if (node.continueOnFail) {
          outputResult = {
            main: [[{ json: { error: err.message, node: node.name } }]]
          };
        } else {
          await this.handleWorkflowError(err, wf.name, node.name);
          throw err;
        }
      }

      const connections = wf.connections && wf.connections[nodeName];
      const mainOutputs = outputResult.main || [];

      const primaryItems = (mainOutputs[0] && mainOutputs[0].length > 0)
        ? mainOutputs[0]
        : (mainOutputs.find(arr => arr && arr.length > 0) || []);

      nodeOutputs[nodeName] = primaryItems;
      if (primaryItems.length > 0) {
        lastOutput = primaryItems;
      }

      if (connections && connections.main) {
        for (let outputIndex = 0; outputIndex < connections.main.length; outputIndex++) {
          const targets = connections.main[outputIndex] || [];
          const itemsForBranch = mainOutputs[outputIndex] || [];

          if (itemsForBranch.length > 0) {
            for (const target of targets) {
              const targetNode = nodesByName.get(target.node);
              if (targetNode) {
                queue.push({ node: targetNode, inputItems: itemsForBranch });
              }
            }
          }
        }
      }
    }

    return {
      lastOutput,
      nodeOutputs,
      sentMessages: this.sentMessages,
      calendarEvents: this.calendarEvents
    };
  }

  async executeNode(node, inputItems, nodeOutputs, wf) {
    const currentJson = inputItems[0] ? inputItems[0].json : {};
    const params = node.parameters || {};

    switch (node.type) {
      case 'n8n-nodes-base.telegramTrigger':
      case 'n8n-nodes-base.executeWorkflowTrigger':
      case 'n8n-nodes-base.scheduleTrigger':
      case 'n8n-nodes-base.errorTrigger': {
        return { main: [inputItems] };
      }

      case 'n8n-nodes-base.code': {
        const jsCode = params.jsCode || '';
        const ctx = this.createEvalContext(currentJson, nodeOutputs, inputItems);
        let result = vm.runInContext(`(function() {\n${jsCode}\n})()`, ctx);
        if (!Array.isArray(result)) {
          result = result ? [{ json: result }] : [{ json: {} }];
        }
        return { main: [result] };
      }

      case 'n8n-nodes-base.if': {
        const conditions = params.conditions || {};
        const condList = conditions.conditions || [];
        const combinator = conditions.combinator || 'and';
        const typeValidation = conditions.options && conditions.options.typeValidation === 'strict' ? 'strict' : 'loose';

        let results = [];
        for (const c of condList) {
          const leftVal = this.evaluateValue(c.leftValue, currentJson, nodeOutputs, inputItems);
          const rightVal = this.evaluateValue(c.rightValue, currentJson, nodeOutputs, inputItems);
          const op = (c.operator && c.operator.operation) || 'equals';

          let matched = false;
          if (op === 'true') {
            matched = leftVal === true || String(leftVal) === 'true';
          } else if (op === 'equals') {
            if (typeValidation === 'strict') {
              matched = leftVal === rightVal;
            } else {
              matched = String(leftVal).toLowerCase() === String(rightVal).toLowerCase();
            }
          } else if (op === 'notEquals') {
            if (typeValidation === 'strict') {
              matched = leftVal !== rightVal;
            } else {
              matched = String(leftVal).toLowerCase() !== String(rightVal).toLowerCase();
            }
          } else if (op === 'notEmpty') {
            matched = leftVal !== undefined && leftVal !== null && leftVal !== '' && (Array.isArray(leftVal) ? leftVal.length > 0 : true);
          } else if (op === 'empty') {
            matched = leftVal === undefined || leftVal === null || leftVal === '' || (Array.isArray(leftVal) && leftVal.length === 0);
          } else if (op === 'gt') {
            matched = Number(leftVal) > Number(rightVal);
          } else if (op === 'lt') {
            matched = Number(leftVal) < Number(rightVal);
          } else {
            matched = leftVal == rightVal;
          }
          results.push(matched);
        }

        const isTrue = combinator === 'or' 
          ? results.some(Boolean)
          : results.every(Boolean);

        return isTrue
          ? { main: [inputItems, []] } // Branch 0: True
          : { main: [[], inputItems] }; // Branch 1: False
      }

      case 'n8n-nodes-base.switch': {
        let branchIndex = 0;
        if (params.mode === 'expression' && params.output) {
          const evaluated = this.evaluateExpr(params.output, currentJson, nodeOutputs, inputItems);
          branchIndex = typeof evaluated === 'number' ? evaluated : parseInt(evaluated, 10) || 0;
        }
        const numOutputs = params.numberOutputs || 6;
        const main = Array.from({ length: numOutputs }, () => []);
        if (branchIndex >= 0 && branchIndex < numOutputs) {
          main[branchIndex] = inputItems;
        } else if (main.length > 0) {
          main[main.length - 1] = inputItems;
        }
        return { main };
      }

      case 'n8n-nodes-base.postgres': {
        const query = params.query || '';
        let allRows = [];
        const itemsToProcess = inputItems.length > 0 ? inputItems : [{ json: {} }];

        for (const item of itemsToProcess) {
          const itemJson = item.json || {};
          let queryParams = [];
          if (params.options && params.options.queryReplacement) {
            queryParams = this.evaluateValue(params.options.queryReplacement, itemJson, nodeOutputs, [item]);
          }
          if (!Array.isArray(queryParams)) {
            queryParams = [queryParams];
          }

          try {
            const rows = this.db.query(query, queryParams);
            allRows.push(...rows);
          } catch (dbErr) {
            if (node.continueOnFail) {
              allRows.push({ error: dbErr.message });
            } else {
              throw dbErr;
            }
          }
        }

        let outputItems = [];
        if (allRows.length > 0) {
          outputItems = allRows.map(r => ({ json: r }));
        } else if (node.alwaysOutputData || params.alwaysOutputData) {
          outputItems = [{ json: {} }];
        }

        return { main: [outputItems] };
      }

      case 'n8n-nodes-base.executeWorkflow': {
        let targetWfIdentifier = '';
        if (params.workflowId) {
          targetWfIdentifier = typeof params.workflowId === 'object' ? params.workflowId.value : params.workflowId;
        }
        targetWfIdentifier = this.evaluateValue(targetWfIdentifier, currentJson, nodeOutputs, inputItems);

        let subInputs = {};
        if (params.workflowInputs && params.workflowInputs.value) {
          subInputs = this.evaluateValue(params.workflowInputs.value, currentJson, nodeOutputs, inputItems);
        } else {
          subInputs = { ...currentJson };
        }

        const subResult = await this.executeWorkflow(targetWfIdentifier, subInputs);
        const out = subResult.lastOutput && subResult.lastOutput.length > 0
          ? subResult.lastOutput
          : [{ json: {} }];
        return { main: [out] };
      }

      case 'n8n-nodes-base.httpRequest': {
        const url = params.url || '';
        if (url.includes('generativelanguage.googleapis.com') || node.name === 'Gemini Command Router') {
          const reqBody = currentJson.requestBody || {};
          const userText = reqBody.userText || currentJson.text || '';
          
          let aiResponse;
          try {
            aiResponse = await this.aiMockHandler(userText, reqBody.systemPrompt);
          } catch (aiErr) {
            if (node.continueOnFail) {
              return { main: [[{ json: { error: { code: 500, message: aiErr.message } } }]] };
            }
            throw aiErr;
          }

          const outputPayload = {
            candidates: [
              {
                content: {
                  parts: [
                    { text: JSON.stringify(aiResponse) }
                  ]
                }
              }
            ]
          };
          return { main: [[{ json: outputPayload }]] };
        }

        return { main: [[{ json: { status: 200 } }]] };
      }

      case 'n8n-nodes-base.telegram': {
        const operation = params.operation || 'sendMessage';
        const chatId = this.evaluateValue(params.chatId, currentJson, nodeOutputs, inputItems);
        const text = this.evaluateValue(params.text, currentJson, nodeOutputs, inputItems);
        const additionalFields = params.additionalFields ? this.evaluateValue(params.additionalFields, currentJson, nodeOutputs, inputItems) : {};
        const replyMarkup = params.replyMarkup ? this.evaluateValue(params.replyMarkup, currentJson, nodeOutputs, inputItems) : undefined;

        const effectiveText = (operation === 'answerCallbackQuery' && !text)
          ? currentJson.text
          : (text !== undefined && text !== '' ? text : currentJson.text);

        const sent = {
          nodeName: node.name,
          chatId: chatId !== undefined ? chatId : currentJson.chatId,
          text: (operation === 'answerCallbackQuery') ? (text || 'OK') : effectiveText,
          additionalFields,
          replyMarkup,
          timestamp: new Date().toISOString()
        };
        this.sentMessages.push(sent);

        return {
          main: [[{
            json: {
              ...currentJson,
              chatId: chatId !== undefined ? chatId : currentJson.chatId,
              text: effectiveText,
              ok: true,
              result: {
                message_id: currentJson.messageId || Math.floor(Math.random() * 100000) + 1,
                chat: { id: chatId !== undefined ? chatId : currentJson.chatId },
                text: effectiveText
              }
            }
          }]]
        };
      }

      case 'n8n-nodes-base.googleCalendar': {
        const eventId = 'mock_gcal_evt_' + Math.random().toString(36).substring(2, 9);
        this.calendarEvents.push({
          nodeName: node.name,
          operation: params.operation || 'create',
          eventId
        });
        return {
          main: [[{
            json: {
              id: eventId,
              htmlLink: `https://calendar.google.com/event?eid=${eventId}`
            }
          }]]
        };
      }

      case 'n8n-nodes-base.noOp':
      default: {
        return { main: [inputItems] };
      }
    }
  }

  async handleWorkflowError(err, workflowName, nodeName) {
    try {
      this.db.query(
        'INSERT INTO error_log (workflow_name, node_name, error_message, occurred_at) VALUES (?, ?, ?, datetime("now"))',
        [workflowName, nodeName, err.message]
      );
      this.sentMessages.push({
        nodeName: 'Error Handler Alert',
        chatId: this.env.PERSONAL_CHAT_ID,
        text: `⚠️ Error in ${workflowName} (${nodeName}): ${err.message}`
      });
    } catch (e) {
      // ignore
    }
  }

  defaultAiIntentClassifier(text, systemPrompt) {
    const raw = (text || '').trim();
    const lower = raw.toLowerCase();

    // 1. Keyword direct rules
    if (lower === '/help' || lower === 'help' || lower === '/start') {
      return { command: 'UNKNOWN', confidence: 0, parameters: {} };
    }
    if (['cancel', 'nevermind', 'never mind', 'stop'].includes(lower)) {
      return { command: 'UNKNOWN', confidence: 0, parameters: {} };
    }

    // 1.5. Safety Confirmations for Delete
    if (/^confirm\s+delete\s+all\s+leads$/i.test(lower) || /^confirm\s+delete\s+every\s+lead$/i.test(lower)) {
      return { command: 'DELETE_ALL_LEADS', confidence: 1, parameters: { confirmed: true } };
    }
    if (/^confirm\s+delete\s+lead\s+(.+)$/i.test(lower)) {
      const m = raw.match(/^confirm\s+delete\s+lead\s+(.+)$/i);
      return { command: 'DELETE_LEAD', confidence: 1, parameters: { business_name: m ? m[1].trim() : '', confirmed: true } };
    }
    if (/^confirm\s+delete\s+all\s+follow[- ]?ups$/i.test(lower)) {
      return { command: 'DELETE_ALL_FOLLOWUPS', confidence: 1, parameters: { confirmed: true } };
    }
    if (/^confirm\s+delete\s+all\s+interactions$/i.test(lower)) {
      return { command: 'DELETE_ALL_INTERACTIONS', confidence: 1, parameters: { confirmed: true } };
    }
    if (/^confirm\s+delete\s+all\s+notes$/i.test(lower)) {
      return { command: 'DELETE_ALL_STANDALONE_NOTES', confidence: 1, parameters: { confirmed: true } };
    }
    if (/^confirm\s+delete\s+all\s+reminders$/i.test(lower)) {
      return { command: 'DELETE_ALL_REMINDERS', confidence: 1, parameters: { confirmed: true } };
    }
    if (/^confirm\s+delete\s+all\s+tasks$/i.test(lower)) {
      return { command: 'DELETE_ALL_TASKS', confidence: 1, parameters: { confirmed: true } };
    }
    if (/^confirm\s+delete\s+everything$/i.test(lower)) {
      return { command: 'DELETE_EVERYTHING', confidence: 1, parameters: { confirmed: true } };
    }

    // 1.6. Unconfirmed Delete / Remove Commands
    if (/(?:delete|remove)\s+(?:all|every)\s+leads?/i.test(lower)) {
      return { command: 'DELETE_ALL_LEADS', confidence: 0.95, parameters: { confirmed: false } };
    }
    if (/(?:delete|remove)\s+(?:all|every)\s+follow[- ]?ups?/i.test(lower)) {
      return { command: 'DELETE_ALL_FOLLOWUPS', confidence: 0.95, parameters: { confirmed: false } };
    }
    if (/(?:delete|remove)\s+(?:all|every)\s+interactions?/i.test(lower)) {
      return { command: 'DELETE_ALL_INTERACTIONS', confidence: 0.95, parameters: { confirmed: false } };
    }
    if (/(?:delete|remove)\s+(?:all|every)\s+notes?/i.test(lower)) {
      return { command: 'DELETE_ALL_STANDALONE_NOTES', confidence: 0.95, parameters: { confirmed: false } };
    }
    if (/(?:delete|remove)\s+(?:all|every)\s+reminders?/i.test(lower)) {
      return { command: 'DELETE_ALL_REMINDERS', confidence: 0.95, parameters: { confirmed: false } };
    }
    if (/(?:delete|remove)\s+(?:all|every)\s+tasks(?:\s+for\s+([A-Za-z0-9\s,]+))?/i.test(lower)) {
      const m = raw.match(/(?:delete|remove)\s+(?:all|every)\s+tasks(?:\s+for\s+([A-Za-z0-9\s,]+))?/i);
      return { command: 'DELETE_ALL_TASKS', confidence: 0.95, parameters: { task_date: m && m[1] ? m[1].trim() : '', confirmed: false } };
    }
    if (/(?:delete|remove)\s+everything/i.test(lower)) {
      return { command: 'DELETE_EVERYTHING', confidence: 0.95, parameters: { confirmed: false } };
    }
    if (/(?:delete|remove)\s+note\s+(?:#)?([0-9]+)/i.test(lower)) {
      const m = raw.match(/(?:delete|remove)\s+note\s+(?:#)?([0-9]+)/i);
      return {
        command: 'DELETE_STANDALONE_NOTE',
        confidence: 0.95,
        parameters: { note_id: m ? parseInt(m[1], 10) : '' }
      };
    }
    if (/(?:delete|remove)\s+reminder\s+(?:#)?([0-9]+)/i.test(lower)) {
      const m = raw.match(/(?:delete|remove)\s+reminder\s+(?:#)?([0-9]+)/i);
      return {
        command: 'DELETE_REMINDER',
        confidence: 0.95,
        parameters: { reminder_id: m ? parseInt(m[1], 10) : '' }
      };
    }
    if (/(?:delete|remove)\s+task\s+(?:#)?([0-9]+)/i.test(lower)) {
      const m = raw.match(/(?:delete|remove)\s+task\s+(?:#)?([0-9]+)/i);
      return {
        command: 'DELETE_TASK',
        confidence: 0.95,
        parameters: { task_id: m ? parseInt(m[1], 10) : '' }
      };
    }
    if (/(?:delete|remove|cancel)\s+follow[- ]?up\s+(?:for\s+)?([A-Za-z0-9\s&'-]+)/i.test(lower)) {
      const m = raw.match(/(?:delete|remove|cancel)\s+follow[- ]?up\s+(?:for\s+)?([A-Za-z0-9\s&'-]+)/i);
      return {
        command: 'DELETE_FOLLOW_UP',
        confidence: 0.95,
        parameters: { business_name: m ? m[1].trim() : '' }
      };
    }
    if (/(?:delete|remove)\s+lead\s+([A-Za-z0-9\s&'-]+)/i.test(lower)) {
      const m = raw.match(/(?:delete|remove)\s+lead\s+([A-Za-z0-9\s&'-]+)/i);
      return {
        command: 'DELETE_LEAD',
        confidence: 0.95,
        parameters: { business_name: m ? m[1].trim() : '', confirmed: false }
      };
    }
    if (/^(?:delete|remove)\s+([A-Za-z0-9\s&'-]+)$/i.test(lower)) {
      const m = raw.match(/^(?:delete|remove)\s+([A-Za-z0-9\s&'-]+)$/i);
      const target = m ? m[1].trim() : '';
      if (!/^(all|everything|every)/i.test(target)) {
        return {
          command: 'AMBIGUOUS_DELETE',
          confidence: 0.5,
          parameters: { business_name: target }
        };
      }
    }

    // 2. Interaction History Intents (Checked before GET_LEAD)
    if (/show\s+(my\s+)?history\s+with|what\s+happened\s+with|history\s+(?:for|with)/i.test(lower)) {
      const m = raw.match(/(?:history with|history for|happened with)\s+([A-Za-z0-9\s&'-]+)/i);
      return {
        command: 'GET_LEAD_HISTORY',
        confidence: 0.9,
        parameters: {
          business_name: m ? m[1].trim() : ''
        }
      };
    }
    if (/i\s+spoke\s+to|had\s+a\s+call\s+with|met\s+with|emailed|called|record\s+an\s+interaction\s+with/i.test(lower)) {
      const m = raw.match(/(?:spoke to|call with|met with|emailed|called|interaction with)\s+([A-Za-z0-9\s&'-]+?)(?:\s+today|\s+yesterday|\s+discussing|\s+about|\s*$)/i);
      const biz = m ? m[1].trim() : '';
      return {
        command: 'RECORD_INTERACTION',
        confidence: 0.9,
        parameters: {
          business_name: biz,
          interaction_type: lower.includes('call') ? 'CALL' : (lower.includes('meet') ? 'MEETING' : 'CONTACT'),
          content: raw
        }
      };
    }
    if (/add\s+note\s+for\s+([A-Za-z0-9\s&'-]+?):/i.test(lower) || /add\s+a\s+note\s+(?:that|for)\s+([A-Za-z0-9\s&'-]+?)\s+(wants|needs|is|requested|agreed|said|next)/i.test(lower)) {
      const m = raw.match(/for\s+([A-Za-z0-9\s&'-]+?):/i) || raw.match(/(?:for|that|to)\s+([A-Za-z0-9\s&'-]+?)\s+(wants|needs|is|requested|agreed|said|next)/i);
      const biz = m ? m[1].trim() : 'ABC School';
      return {
        command: 'ADD_NOTE',
        confidence: 0.9,
        parameters: {
          business_name: biz,
          notes: raw
        }
      };
    }

    // 2.5. Standalone Notes Intents (LEVEL 12)
    if (/show\s+(my\s+)?notes|list\s+(my\s+)?notes|view\s+notes|my\s+notes/i.test(lower)) {
      return { command: 'LIST_STANDALONE_NOTES', confidence: 0.95, parameters: {} };
    }
    if (/note\s+down\s+|save\s+note|take\s+a\s+note|add\s+note/i.test(lower) || (raw.includes('\n') && !/lead|pipeline|follow[- ]?up\s+with|tasks?\s+for|daily\s+tasks?/i.test(lower))) {
      return {
        command: 'ADD_STANDALONE_NOTE',
        confidence: 0.9,
        parameters: {
          content: raw
        }
      };
    }

    // 2.6. Standalone Reminders Intents (LEVEL 13)
    if (/show\s+(my\s+)?reminders|list\s+(my\s+)?reminders|my\s+reminders|view\s+reminders/i.test(lower)) {
      return { command: 'LIST_REMINDERS', confidence: 0.95, parameters: {} };
    }
    if (/remind\s+me\s+on\s+([A-Za-z0-9\s,]+)\s+to\s+(.+)/i.test(lower)) {
      const m = raw.match(/remind\s+me\s+on\s+([A-Za-z0-9\s,]+)\s+to\s+(.+)/i);
      return {
        command: 'CREATE_REMINDER',
        confidence: 0.9,
        parameters: {
          reminder_text: m ? m[2].trim() : raw,
          follow_up_date: '2026-09-07T10:00:00+05:30'
        }
      };
    }
    if (/remind\s+me\s+tomorrow\s+(?:at\s+[0-9A-Za-z:]+\s+)?to\s+(.+)/i.test(lower) && !/call\s+[A-Za-z0-9\s&'-]+(?:\s+tomorrow|\s+at)/i.test(lower)) {
      const m = raw.match(/remind\s+me\s+tomorrow\s+(?:at\s+[0-9A-Za-z:]+\s+)?to\s+(.+)/i);
      return {
        command: 'CREATE_REMINDER',
        confidence: 0.9,
        parameters: {
          reminder_text: m ? m[1].trim() : raw,
          follow_up_date: '2026-09-04T10:00:00+05:30'
        }
      };
    }
    if (/remind\s+me\s+to\s+(.+)/i.test(lower) && !/remind\s+me\s+to\s+call\s+[A-Za-z0-9\s&'-]+\s+tomorrow/i.test(lower)) {
      const m = raw.match(/remind\s+me\s+to\s+(.+)/i);
      return {
        command: 'CREATE_REMINDER',
        confidence: 0.9,
        parameters: {
          reminder_text: m ? m[1].trim() : raw,
          follow_up_date: '2026-09-04T10:00:00+05:30'
        }
      };
    }

    // 2.7. Personal Daily Tasks Intents (LEVEL 14)
    if (/complete\s+task\s+(?:#)?([0-9]+)|finish\s+task\s+(?:#)?([0-9]+)|mark\s+task\s+(?:#)?([0-9]+)\s+as\s+done/i.test(lower)) {
      const m = raw.match(/(?:task\s+(?:#)?([0-9]+))/i);
      return {
        command: 'COMPLETE_TASK',
        confidence: 0.95,
        parameters: { task_id: m ? parseInt(m[1], 10) : '' }
      };
    }
    if (/update\s+task\s+(?:#)?([0-9]+)\s+(?:to\s+)?(.+)/i.test(lower)) {
      const m = raw.match(/update\s+task\s+(?:#)?([0-9]+)\s+(?:to\s+)?(.+)/i);
      return {
        command: 'UPDATE_TASK',
        confidence: 0.95,
        parameters: {
          task_id: m ? parseInt(m[1], 10) : '',
          task_name: m ? m[2].trim() : ''
        }
      };
    }
    if (/tasks?\s+for\s+([A-Za-z0-9\s,]+)\s*\n/i.test(raw) || /daily\s+tasks?\s+for\s+([A-Za-z0-9\s,]+):?/i.test(raw)) {
      const m = raw.match(/(?:tasks?\s+for|daily\s+tasks?\s+for)\s+([A-Za-z0-9\s,]+)/i);
      const targetDate = m ? m[1].trim() : 'today';
      const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
      const items = lines.filter(l => !/^(?:tasks?\s+for|daily\s+tasks?)/i.test(l));
      return {
        command: 'CREATE_DAILY_TASKS',
        confidence: 0.95,
        parameters: {
          due_date: targetDate.toLowerCase().includes('sep 5') ? '2026-09-05' : '2026-09-03',
          tasks: items
        }
      };
    }
    if (/add\s+task(?:\s+for\s+([A-Za-z0-9\s,]+))?:\s*(.+)/i.test(lower) || /new\s+task:\s*(.+)/i.test(lower)) {
      const m = raw.match(/add\s+task(?:\s+for\s+([A-Za-z0-9\s,]+))?:\s*(.+)/i) || raw.match(/new\s+task:\s*(.+)/i);
      return {
        command: 'ADD_TASK',
        confidence: 0.95,
        parameters: {
          due_date: m && m[1] && m[1].includes('Sep 5') ? '2026-09-05' : '2026-09-03',
          task_name: m ? (m[2] || m[1]).trim() : ''
        }
      };
    }
    if (/show\s+today'?s\s+tasks|show\s+tasks\s+for\s+([A-Za-z0-9\s,]+)|show\s+my\s+tasks\s+tomorrow|show\s+my\s+tasks|list\s+tasks|my\s+tasks/i.test(lower)) {
      const m = raw.match(/tasks\s+for\s+([A-Za-z0-9\s,]+)/i);
      let date = '2026-09-03';
      if (lower.includes('sep 5')) date = '2026-09-05';
      if (lower.includes('tomorrow')) date = '2026-09-04';
      return {
        command: 'LIST_TASKS',
        confidence: 0.95,
        parameters: {
          due_date: date
        }
      };
    }

    // 3. Analytics Intents
    if (/pipeline|show\s+my\s+pipeline/i.test(lower)) {
      return { command: 'PIPELINE_ANALYTICS', confidence: 0.95, parameters: {} };
    }
    if (/revenue|how\s+much\s+did\s+i\s+make|money\s+made/i.test(lower)) {
      return { command: 'REVENUE_ANALYTICS', confidence: 0.95, parameters: {} };
    }
    if (/lead\s+analytics|conversion\s+rate|lead\s+stats/i.test(lower)) {
      return { command: 'LEAD_ANALYTICS', confidence: 0.95, parameters: {} };
    }

    // 4. Daily Priorities
    if (/what\s+should\s+i\s+do\s+today|what\s+to\s+do\s+today|show\s+my\s+daily\s+priorities|daily\s+priorities|focus\s+on\s+today/i.test(lower)) {
      return { command: 'DAILY_PRIORITY', confidence: 0.95, parameters: {} };
    }

    // 5. Follow-up Management Intents
    if (/remind\s+me\s+to\s+call|create\s+a\s+follow[- ]?up|set\s+follow[- ]?up|follow[- ]?up\s+for/i.test(lower)) {
      const m = raw.match(/(?:call|with|for)\s+([A-Za-z0-9\s&'-]+?)(?:\s+tomorrow|\s+next|\s+at|\s+on|\s*$)/i);
      return {
        command: 'CREATE_FOLLOW_UP',
        confidence: 0.9,
        parameters: {
          business_name: m ? m[1].trim() : '',
          follow_up_date: 'tomorrow 10am'
        }
      };
    }
    if (/completed\s+follow[- ]?up|finished\s+(the\s+)?follow[- ]?up|mark\s+follow[- ]?up\s+(as\s+)?complete/i.test(lower)) {
      const m = raw.match(/(?:with|for)\s+([A-Za-z0-9\s&'-]+)/i);
      return {
        command: 'COMPLETE_FOLLOW_UP',
        confidence: 0.9,
        parameters: {
          business_name: m ? m[1].trim() : ''
        }
      };
    }
    if (/show\s+(my\s+)?follow[- ]?ups|list\s+(my\s+)?follow[- ]?ups|what\s+follow[- ]?ups/i.test(lower)) {
      const filter = lower.includes('overdue') ? 'OVERDUE' : (lower.includes('today') ? 'TODAY' : 'ALL');
      return {
        command: 'LIST_FOLLOW_UPS',
        confidence: 0.95,
        parameters: { filter }
      };
    }
    if (/move\s+my\s+([A-Za-z0-9\s&'-]+?)\s+follow[- ]?up\s+to|reschedule\s+([A-Za-z0-9\s&'-]+?)\s+follow[- ]?up/i.test(lower)) {
      const m = raw.match(/(?:move my|reschedule)\s+([A-Za-z0-9\s&'-]+?)\s+follow[- ]?up/i);
      return {
        command: 'UPDATE_FOLLOW_UP',
        confidence: 0.9,
        parameters: {
          business_name: m ? m[1].trim() : '',
          follow_up_date: '2pm'
        }
      };
    }
    if (/cancel\s+the\s+([A-Za-z0-9\s&'-]+?)\s+follow[- ]?up|cancel\s+follow[- ]?up\s+for\s+([A-Za-z0-9\s&'-]+)/i.test(lower)) {
      const m = raw.match(/cancel\s+(?:the\s+)?([A-Za-z0-9\s&'-]+?)\s+follow[- ]?up/i) || raw.match(/for\s+([A-Za-z0-9\s&'-]+)/i);
      return {
        command: 'CANCEL_FOLLOW_UP',
        confidence: 0.9,
        parameters: {
          business_name: m ? m[1].trim() : ''
        }
      };
    }

    // 6. Lead Management Intents
    if (/show\s+(my\s+)?(active\s+)?leads|list\s+(my\s+)?(active\s+)?leads|what\s+leads\s+do\s+i\s+have|view\s+leads/i.test(lower)) {
      return { command: 'LIST_LEADS', confidence: 0.95, parameters: {} };
    }
    if (lower === 'add a lead' || lower === 'add lead' || lower === 'add a new lead' || lower === 'create a lead' || lower === 'create a new lead' || lower === 'new lead') {
      return {
        command: 'ADD_LEAD',
        confidence: 0.4,
        parameters: {}
      };
    }
    if (/\b(add|create|new)\s+(.*)\b(lead|client)\b/i.test(lower) || /\badd\s+([A-Za-z0-9\s&'-]+?)\s+as\s+a\b/i.test(lower)) {
      const bizMatch = raw.match(/(?:add|create|new)\s+([A-Za-z0-9\s&'-]+?)\s+(?:as\s+a|as|lead|client)/i) ||
                       raw.match(/lead\s+(?:named|for|called)?\s*([A-Za-z0-9\s&'-]+?)(?:\\s+as\s+|\\s+with\s+|\\s+worth\s+|\\s*$)/i);
      const serviceMatch = raw.match(/\b(website|seo|app|mobile app|consulting|design|marketing)\b/i);

      let business_name = bizMatch ? bizMatch[1].replace(/^(a|the|new)\s+/i, '').trim() : undefined;
      if (business_name && (business_name.toLowerCase() === 'lead' || business_name.toLowerCase() === 'new lead' || business_name.toLowerCase() === 'new')) business_name = undefined;

      let deal_value = undefined;
      if (raw.includes('₹') || raw.includes('$') || /\b[0-9,]{4,}\b/.test(raw)) {
        const numStr = raw.replace(/[^0-9]/g, '');
        if (numStr) deal_value = Number(numStr);
      }

      const params = {};
      if (business_name) params.business_name = business_name;
      if (deal_value !== undefined) params.deal_value = deal_value;
      if (serviceMatch) params.service = serviceMatch[1];

      return {
        command: 'ADD_LEAD',
        confidence: business_name ? 0.95 : 0.4,
        parameters: params
      };
    }
    if (/update\s+([A-Za-z0-9\s&'-]+?)(?:'s)?\s+(email|phone|contact|service|notes)/i.test(lower) || /change\s+(email|phone|contact|service)\s+for\s+([A-Za-z0-9\s&'-]+)/i.test(lower)) {
      const emailMatch = raw.match(/[\w.-]+@[\w.-]+\.\w+/);
      const phoneMatch = raw.match(/\b[0-9]{10}\b/);
      const serviceMatch = raw.match(/service\s+to\s+([A-Za-z0-9\s&'-]+)/i);
      const bizMatch = raw.match(/update\s+([A-Za-z0-9\s&'-]+?)(?:'s)?\s+(?:email|phone|contact|service)/i) || raw.match(/for\s+([A-Za-z0-9\s&'-]+)/i);

      const params = { business_name: bizMatch ? bizMatch[1].trim() : '' };
      if (emailMatch) params.email = emailMatch[0];
      if (phoneMatch) params.phone = phoneMatch[0];
      if (serviceMatch) params.service = serviceMatch[1].trim();

      return {
        command: 'UPDATE_LEAD',
        confidence: 0.9,
        parameters: params
      };
    }
    if (/(move|change|set|mark)\s+([A-Za-z0-9\s&'-]+?)\s+(to|as|status to)\s+([A-Za-z\s]+)/i.test(lower)) {
      const m = raw.match(/(?:move|change|set|mark)\s+([A-Za-z0-9\s&'-]+?)\s+(?:to|as|status to)\s+([A-Za-z\s]+)/i);
      const biz = m ? m[1].trim() : '';
      const statusRaw = m ? m[2].trim().toUpperCase() : '';
      return {
        command: 'CHANGE_STATUS',
        confidence: 0.95,
        parameters: {
          business_name: biz,
          status: statusRaw
        }
      };
    }
    if (/(change|update|set)\s+([A-Za-z0-9\s&'-]+?)\s+(?:deal\s+value|value)\s+to\s+([0-9,₹$]+)/i.test(lower)) {
      const m = raw.match(/(?:change|update|set)\s+([A-Za-z0-9\s&'-]+?)\s+(?:deal\s+value|value)\s+to\s+([0-9,₹$]+)/i);
      const biz = m ? m[1].trim() : '';
      const num = m ? Number(m[2].replace(/[^0-9]/g, '')) : 0;
      return {
        command: 'UPDATE_DEAL_VALUE',
        confidence: 0.95,
        parameters: {
          business_name: biz,
          deal_value: num
        }
      };
    }
    if (/^(show|tell me about|details for|get|view)\s+([A-Za-z0-9\s&'-]+?)$/i.test(lower) && !lower.includes('lead') && !lower.includes('follow') && !lower.includes('pipeline') && !lower.includes('revenue') && !lower.includes('analytics') && !lower.includes('priorit')) {
      const m = raw.match(/^(?:show|tell me about|details for|get|view)\s+([A-Za-z0-9\s&'-]+)$/i);
      return {
        command: 'GET_LEAD',
        confidence: 0.9,
        parameters: { business_name: m ? m[1].trim() : '' }
      };
    }

    // 7. Fallback Unknown
    return { command: 'UNKNOWN', confidence: 0, parameters: {} };
  }
}

module.exports = N8nRuntime;
